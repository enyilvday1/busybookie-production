import { MigrationError } from "./migrationError.js";

// Configuration for the explicit migration and runtime-grant commands. These
// run as the migration owner, never as the runtime API role, so they use their
// own keys rather than the future runtime COMMERCIAL_API_DATABASE_URL.
export const DATABASE_CONFIG_KEYS = {
  migrationUrl: "COMMERCIAL_API_MIGRATION_DATABASE_URL",
  runtimeRole: "COMMERCIAL_API_RUNTIME_DATABASE_ROLE",
} as const;

export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

// Validates without ever echoing the value: a connection string may hold a password.
export function parseDatabaseUrl(value: string | undefined, key: string): string {
  if (value === undefined || value === "") {
    throw new MigrationError("DATABASE_CONFIG_INVALID", `${key} is required.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MigrationError("DATABASE_CONFIG_INVALID", `${key} must be a postgres:// or postgresql:// URL.`);
  }

  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || url.hostname === "" || url.pathname.length < 2) {
    throw new MigrationError(
      "DATABASE_CONFIG_INVALID",
      `${key} must be a postgres:// or postgresql:// URL with a host and database name.`,
    );
  }

  return value;
}

export function loadMigrationDatabaseUrl(environment: DatabaseEnvironment): string {
  return parseDatabaseUrl(environment[DATABASE_CONFIG_KEYS.migrationUrl], DATABASE_CONFIG_KEYS.migrationUrl);
}

export function loadRuntimeDatabaseRole(environment: DatabaseEnvironment): string {
  const value = environment[DATABASE_CONFIG_KEYS.runtimeRole];
  if (value === undefined || value === "") {
    throw new MigrationError("DATABASE_CONFIG_INVALID", `${DATABASE_CONFIG_KEYS.runtimeRole} is required.`);
  }
  return value;
}

// Removes the connection string and its password from text bound for logs.
export function redactConnectionSecrets(text: string, connectionString: string | undefined): string {
  if (connectionString === undefined || connectionString === "") {
    return text;
  }

  const secrets = [connectionString];
  try {
    const password = decodeURIComponent(new URL(connectionString).password);
    if (password !== "") {
      secrets.push(password, new URL(connectionString).password);
    }
  } catch {
    // An unparsable connection string is redacted as a whole only.
  }

  return secrets.reduce((redacted, secret) => redacted.split(secret).join("[redacted]"), text);
}

// One line for stderr: expected MigrationErrors and PostgreSQL errors keep
// their code and message; anything else is reported generically.
export function describeDatabaseFailure(error: unknown, connectionString: string | undefined): string {
  let description: string;

  if (error instanceof MigrationError) {
    description = `${error.code}: ${error.message}`;
  } else if (error instanceof Error && "code" in error && typeof error.code === "string") {
    description = `database error ${error.code}: ${error.message}`;
  } else {
    description = "unexpected failure";
  }

  return redactConnectionSecrets(description, connectionString);
}
