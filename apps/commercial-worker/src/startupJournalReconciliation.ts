import { AcceptanceJournalError, serializeAcceptanceRecord, type AcceptanceJournal, type AcceptanceRecord } from "./acceptanceJournal.js";
import { runAcceptanceRecoveryWithRetry, type AcceptanceRecoveryTime } from "./acceptanceRecoveryPolicy.js";
import type { WorkerControlClient } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

export type StartupJournalStatus = "CLEAR" | "UNRESOLVED_ACCEPTANCE" | "CORRUPT" | "CONFLICT";
export type StartupJournalResult = Readonly<{ status: StartupJournalStatus; quarantinedTemporaryCount: number }>;

type StartupJournalScan = StartupJournalResult & Readonly<{ unresolved: readonly AcceptanceRecord[] }>;

// Section 17 local startup phase. The journal owns filenames, parsing,
// canonical validation and filesystem I/O. Valid published acceptance is
// returned unresolved, in lexical attempt order, exactly as stored.
async function scanStartupJournal(journal: AcceptanceJournal): Promise<StartupJournalScan> {
  try {
    await journal.prepare();
  } catch {
    throw new WorkerError("STATE_ROOT_UNSUITABLE");
  }
  let quarantinedTemporaryCount = 0;
  const result = (status: StartupJournalStatus, unresolved: readonly AcceptanceRecord[] = []): StartupJournalScan =>
    Object.freeze({ status, quarantinedTemporaryCount, unresolved: Object.freeze([...unresolved]) });
  try {
    const entries = await journal.enumerate();
    const records = new Map<string, { bytes: string; record: AcceptanceRecord }>();
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
        if (inspected.status === "CONFLICTING_RECORD" || (previous !== undefined && previous.bytes !== bytes)) conflict = true;
        records.set(entry.executionAttemptId, { bytes, record: inspected.record });
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
    const unresolved = [...records.keys()].sort().map((executionAttemptId) => records.get(executionAttemptId)!.record);
    return result(unresolved.length === 0 ? "CLEAR" : "UNRESOLVED_ACCEPTANCE", unresolved);
  } catch (error) {
    if (error instanceof AcceptanceJournalError && error.code === "ACCEPTANCE_JOURNAL_CONFLICT") return result("CONFLICT");
    // Unreadable directories, failed publication/quarantine/cleanup and unknown
    // I/O errors all fail closed. No raw filesystem message or cause escapes.
    return result("CORRUPT");
  }
}

// The local phase alone: no control-plane call.
export async function reconcileStartupJournal(journal: AcceptanceJournal): Promise<StartupJournalResult> {
  const { status, quarantinedTemporaryCount } = await scanStartupJournal(journal);
  return Object.freeze({ status, quarantinedTemporaryCount });
}

export type StartupAcceptanceRecovery = AcceptanceRecoveryTime & Readonly<{ client: Pick<WorkerControlClient, "recoverAcceptance"> }>;

// Section 17 steps 3 and 4 (R44B6S): each unresolved record, in lexical
// order, is recovered under its own fresh bounded budget with exactly its
// persisted identity. SUBMITTED is acknowledged for this pass and retained;
// a terminal acknowledgement removes the exact record. Any failure stops at
// that record, retains it, and blocks new work.
async function recoverUnresolvedAcceptance(journal: AcceptanceJournal, unresolved: readonly AcceptanceRecord[], recovery: StartupAcceptanceRecovery): Promise<void> {
  for (const record of unresolved) {
    const { executionAttemptId, fencingCounter, providerExecutionId } = record;
    const acknowledgement = await runAcceptanceRecoveryWithRetry(
      (signal) => recovery.client.recoverAcceptance(executionAttemptId, fencingCounter, providerExecutionId, signal),
      recovery,
    );
    if (acknowledgement.state === "SUBMITTED") continue;
    try {
      await journal.removeAcknowledgedRecord(record);
    } catch (error) {
      throw new WorkerError(
        error instanceof AcceptanceJournalError && error.code === "ACCEPTANCE_JOURNAL_CONFLICT" ? "ACCEPTANCE_JOURNAL_CONFLICT" : "ACCEPTANCE_JOURNAL_CORRUPT",
      );
    }
  }
}

// Returns only when startup is CLEAR for this run; otherwise throws a closed
// worker code and no lease may be requested.
export async function assertStartupJournalClear(
  journal: AcceptanceJournal,
  recovery: StartupAcceptanceRecovery,
  onQuarantine: () => void = () => {},
): Promise<void> {
  const result = await scanStartupJournal(journal);
  if (result.quarantinedTemporaryCount > 0) onQuarantine();
  if (result.status === "CORRUPT") throw new WorkerError("ACCEPTANCE_JOURNAL_CORRUPT");
  if (result.status === "CONFLICT") throw new WorkerError("ACCEPTANCE_JOURNAL_CONFLICT");
  if (result.status === "UNRESOLVED_ACCEPTANCE") await recoverUnresolvedAcceptance(journal, result.unresolved, recovery);
}
