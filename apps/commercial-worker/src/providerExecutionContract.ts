// The worker's single entry to the shared provider execution ID rule
// (packages/commercial-worker-protocol, migration 0004). The journal and the
// submitted client import it from here, so the rule is never copied.
export { isProviderExecutionId, MAX_PROVIDER_EXECUTION_ID_LENGTH } from "commercial-worker-protocol";
