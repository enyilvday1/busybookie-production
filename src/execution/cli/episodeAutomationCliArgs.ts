import { ExecutionReservationEpisodeIdSchema, ExecutionReservationShotIdSchema } from "../executionReservation.schema.js";
export type EpisodeAutomationCliOptions = Readonly<{
  planPath?: string; episodeId?: string; validateOnly: boolean; planOnly: boolean; json: boolean;
  shotIds: readonly string[] | null; confirmation: "GENERATION" | "RECONCILIATION" | null;
}>;
export function parseEpisodeAutomationCliArgs(args: readonly string[]): EpisodeAutomationCliOptions {
  const seen = new Set<string>(); let planPath: string | undefined; let episodeId: string | undefined;
  let validateOnly = false; let planOnly = false; let json = false; let shotIds: string[] | null = null;
  let confirmation: "GENERATION" | "RECONCILIATION" | null = null;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (seen.has(flag)) throw new Error(`Duplicate episode automation CLI argument: ${flag}`);
    seen.add(flag);
    if (["--plan", "--episode", "--shots"].includes(flag)) {
      const value = args[++index];
      if (!value || !value.trim() || value.startsWith("--")) throw new Error(`${flag} requires ${flag === "--plan" ? "a plan file path" : "a value"}.`);
      if (value.trim() === "-") throw new Error(`${flag} does not accept stdin.`);
      if (flag === "--plan") planPath = value;
      if (flag === "--episode") episodeId = ExecutionReservationEpisodeIdSchema.parse(value);
      if (flag === "--shots") {
        shotIds = value.split(",").map(id => ExecutionReservationShotIdSchema.parse(id));
        if (new Set(shotIds).size !== shotIds.length) throw new Error("Duplicate selected shot.");
      }
    } else if (flag === "--validate-only") validateOnly = true;
    else if (flag === "--plan-only") planOnly = true;
    else if (flag === "--json") json = true;
    else if (flag === "--confirm-paid-generation" || flag === "--confirm-reconciliation") {
      if (confirmation) throw new Error("Confirmation families are mutually exclusive.");
      confirmation = flag === "--confirm-paid-generation" ? "GENERATION" : "RECONCILIATION";
    } else throw new Error(flag.startsWith("-") ? `Unknown episode automation CLI argument: ${flag.split("=")[0]}` : "Unexpected positional episode automation CLI argument.");
  }
  if (planPath === undefined && episodeId === undefined) throw new Error("--plan is required unless --episode --plan-only is supplied.");
  if (planPath !== undefined && episodeId !== undefined) throw new Error("Supply exactly one --plan or --episode.");
  if (episodeId && !planOnly) throw new Error("--episode requires --plan-only.");
  if (validateOnly && (planOnly || confirmation || episodeId || json)) throw new Error("--validate-only is structural validation of a file only.");
  if (planOnly && confirmation) throw new Error("Plan-only accepts no confirmation.");
  if (shotIds && (!planOnly || !episodeId)) throw new Error("--shots requires episode plan-only mode.");
  return Object.freeze({ ...(planPath ? { planPath } : {}), ...(episodeId ? { episodeId } : {}),
    validateOnly, planOnly, json, shotIds: shotIds ? Object.freeze(shotIds) : null, confirmation });
}
