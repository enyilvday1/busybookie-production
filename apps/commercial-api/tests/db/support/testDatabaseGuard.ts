// Fail-closed guard for the destructive real-PostgreSQL suite. Independent
// checks: an explicit opt-in flag, loopback URLs naming the approved test
// database, and the identity PostgreSQL itself reports (database, user and a
// PostgreSQL 16 server). None of them trusts the URL string alone.

export const TEST_DATABASE_KEYS = {
  migrationUrl: "COMMERCIAL_API_TEST_DATABASE_MIGRATION_URL",
  runtimeUrl: "COMMERCIAL_API_TEST_DATABASE_RUNTIME_URL",
  allowMutation: "COMMERCIAL_API_ALLOW_TEST_DATABASE_MUTATION",
} as const;

export const APPROVED_TEST_DATABASE = "busybookie_commercial_test";
export const APPROVED_MIGRATION_ROLE = "busybookie_commercial_test_migrator";
export const APPROVED_RUNTIME_ROLE = "busybookie_commercial_test_runtime";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PRODUCTION_LIKE = /prod|staging|stage|live|primary|main/i;

export class TestDatabaseGuardError extends Error {
  override readonly name = "TestDatabaseGuardError";
}

export type TestDatabaseConfig = Readonly<{
  migrationUrl: string;
  runtimeUrl: string;
}>;

function checkUrl(value: string | undefined, key: string, expectedUser: string): string {
  if (value === undefined || value === "") {
    throw new TestDatabaseGuardError(`${key} is required for the database suite; it never skips silently.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TestDatabaseGuardError(`${key} is not a valid URL.`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new TestDatabaseGuardError(`${key} must use postgres:// or postgresql://.`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TestDatabaseGuardError(`${key} must point at a loopback host.`);
  }
  if (database !== APPROVED_TEST_DATABASE) {
    throw new TestDatabaseGuardError(`${key} must name the approved test database.`);
  }
  if (decodeURIComponent(url.username) !== expectedUser) {
    throw new TestDatabaseGuardError(`${key} must connect as the approved test role.`);
  }

  return value;
}

export function loadTestDatabaseConfig(environment: Readonly<Record<string, string | undefined>>): TestDatabaseConfig {
  if (environment[TEST_DATABASE_KEYS.allowMutation] !== "YES") {
    throw new TestDatabaseGuardError(`${TEST_DATABASE_KEYS.allowMutation}=YES is required before the test database is changed.`);
  }

  return Object.freeze({
    migrationUrl: checkUrl(environment[TEST_DATABASE_KEYS.migrationUrl], TEST_DATABASE_KEYS.migrationUrl, APPROVED_MIGRATION_ROLE),
    runtimeUrl: checkUrl(environment[TEST_DATABASE_KEYS.runtimeUrl], TEST_DATABASE_KEYS.runtimeUrl, APPROVED_RUNTIME_ROLE),
  });
}

export type ServerIdentity = Readonly<{
  database: string;
  user: string;
  serverVersionNum: number;
}>;

// Applied to what PostgreSQL reports over an established connection.
export function assertServerIdentity(identity: ServerIdentity, expectedUser: string): void {
  if (identity.database !== APPROVED_TEST_DATABASE || PRODUCTION_LIKE.test(identity.database)) {
    throw new TestDatabaseGuardError("Connected database is not the approved test database.");
  }
  if (identity.user !== expectedUser) {
    throw new TestDatabaseGuardError("Connected role is not the approved test role for this operation.");
  }
  if (identity.serverVersionNum < 160000 || identity.serverVersionNum >= 170000) {
    throw new TestDatabaseGuardError("Connected server is not PostgreSQL 16.");
  }
}
