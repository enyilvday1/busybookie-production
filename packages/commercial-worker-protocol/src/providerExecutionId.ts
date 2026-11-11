// The provider execution ID contract shared by commercial-api (the live
// submitted route) and commercial-worker (the acceptance journal and its
// submitted client). It is exactly the migration 0004
// execution_attempts_provider_execution_id_ck rule
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md sections 17 and 18):
// opaque, 1 to 256 visible ASCII characters (0x21-0x7e), never containing
// "://". No normalisation: a value that does not already satisfy the rule is
// invalid, never trimmed or rewritten.

export const MAX_PROVIDER_EXECUTION_ID_LENGTH = 256;

const PROVIDER_EXECUTION_ID = /^[\x21-\x7e]{1,256}$/;

export function isProviderExecutionId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_EXECUTION_ID.test(value) && !value.includes("://");
}
