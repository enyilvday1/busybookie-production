import { AcceptanceJournalError, serializeAcceptanceRecord, type AcceptanceJournal, type AcceptanceRecord } from "./acceptanceJournal.js";
import { WorkerError } from "./workerError.js";

export type StartupJournalStatus = "CLEAR" | "UNRESOLVED_ACCEPTANCE" | "CORRUPT" | "CONFLICT";
export type StartupJournalResult = Readonly<{ status: StartupJournalStatus; quarantinedTemporaryCount: number }>;

// Section 17 local startup phase only. No control-plane recovery exists yet:
// every valid published acceptance remains unresolved and blocks fresh work.
// The journal owns filenames, parsing, canonical validation and filesystem I/O.
export async function reconcileStartupJournal(journal: AcceptanceJournal): Promise<StartupJournalResult> {
  try {
    await journal.prepare();
  } catch {
    throw new WorkerError("STATE_ROOT_UNSUITABLE");
  }
  let quarantinedTemporaryCount = 0;
  const result = (status: StartupJournalStatus): StartupJournalResult => Object.freeze({ status, quarantinedTemporaryCount });
  try {
    const entries = await journal.enumerate();
    const records = new Map<string, string>();
    const temporaries: { fileName: string; record: AcceptanceRecord }[] = [];
    const invalid: string[] = [];
    let corrupt = false;
    let conflict = false;
    // Inspect the whole stable snapshot before publishing anything: two valid
    // but different temporaries must never select a winner by enumeration order.
    for (const entry of entries) {
      const inspected = entry.kind === "FINAL" ? await journal.read(entry.executionAttemptId) : await journal.inspectTemporary(entry.fileName);
      if (inspected.status === "VALID_RECORD" || inspected.status === "VALID_TEMPORARY" || inspected.status === "CONFLICTING_RECORD") {
        const bytes = serializeAcceptanceRecord(inspected.record);
        const previous = records.get(entry.executionAttemptId);
        if (inspected.status === "CONFLICTING_RECORD" || (previous !== undefined && previous !== bytes)) conflict = true;
        records.set(entry.executionAttemptId, bytes);
        if (entry.kind === "TEMPORARY") temporaries.push({ fileName: entry.fileName, record: inspected.record });
      } else if (entry.kind === "TEMPORARY" && inspected.status === "INVALID_TEMPORARY") {
        invalid.push(entry.fileName);
      } else {
        // A discovered entry disappearing during inspection is not a clear scan.
        corrupt = true;
      }
    }
    if (conflict) return result("CONFLICT");
    if (corrupt) return result("CORRUPT");
    for (const fileName of invalid) {
      await journal.quarantineInvalidTemporary(fileName);
      quarantinedTemporaryCount += 1;
    }
    for (const { fileName, record } of temporaries) {
      // Never write(input): that would construct a new recordedAt and digest.
      await journal.publish(record);
      await journal.removePublishedTemporary(fileName);
    }
    return result(records.size === 0 ? "CLEAR" : "UNRESOLVED_ACCEPTANCE");
  } catch (error) {
    if (error instanceof AcceptanceJournalError && error.code === "ACCEPTANCE_JOURNAL_CONFLICT") return result("CONFLICT");
    // Unreadable directories, failed publication/quarantine/cleanup and unknown
    // I/O errors all fail closed. No raw filesystem message or cause escapes.
    return result("CORRUPT");
  }
}

export async function assertStartupJournalClear(journal: AcceptanceJournal, onQuarantine: () => void = () => {}): Promise<void> {
  const result = await reconcileStartupJournal(journal);
  if (result.quarantinedTemporaryCount > 0) onQuarantine();
  if (result.status === "UNRESOLVED_ACCEPTANCE") throw new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED");
  if (result.status === "CORRUPT") throw new WorkerError("ACCEPTANCE_JOURNAL_CORRUPT");
  if (result.status === "CONFLICT") throw new WorkerError("ACCEPTANCE_JOURNAL_CONFLICT");
}
