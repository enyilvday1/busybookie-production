// Initial worker lease policy. The bridge architecture (section 12) requires
// a bounded lease duration and explicit heartbeat renewal without fixing
// values; these are the initial, server-side values. Workers never choose
// them.

// A lease lasts two minutes from acquisition or from the latest heartbeat.
// Long enough for a worker to heartbeat every 30-40 seconds with margin for a
// slow round trip; short enough that a crashed worker's pre-submission lease
// is reclaimed within minutes.
export const WORKER_LEASE_DURATION_SECONDS = 120;

// INITIAL_WORKER_CONCURRENCY=1 (architecture section 8): a worker holds at
// most one current lease. A policy value, not a schema rule, so concurrency
// can be raised later by a reviewed change.
export const WORKER_MAX_CURRENT_LEASES = 1;

// Expired, never-granted leases reclaimed per acquisition request, so one
// request never sweeps an unbounded backlog.
export const WORKER_EXPIRED_LEASE_RECLAIM_LIMIT = 16;

// 256 bits from the operating system CSPRNG, base64url without padding.
export const WORKER_LEASE_TOKEN_BYTES = 32;
export const WORKER_LEASE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
