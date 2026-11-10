import pg from "pg";

import { describeDatabaseFailure, loadMigrationDatabaseUrl, loadRuntimeDatabaseRole, type DatabaseEnvironment } from "./databaseConfig.js";
import { discoverMigrations, DEFAULT_MIGRATIONS_DIRECTORY } from "./migrationFiles.js";
import { runMigrations } from "./runMigrations.js";
import { applyRuntimeGrants } from "./runtimeGrants.js";

export type DatabaseCommand = "migrate" | "grant-runtime";

export type DatabaseCommandDependencies = Readonly<{
  environment: DatabaseEnvironment;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  setExitCode: (code: number) => void;
  migrationsDirectory?: string;
}>;

// Shared body of the explicit migration commands: validate configuration,
// read committed migrations, connect once as the migration owner, run, close.
// Never invoked by API startup.
export async function runDatabaseCommand(command: DatabaseCommand, dependencies: DatabaseCommandDependencies): Promise<void> {
  let connectionString: string | undefined;
  let pool: pg.Pool | undefined;

  try {
    connectionString = loadMigrationDatabaseUrl(dependencies.environment);
    const runtimeRole = command === "grant-runtime" ? loadRuntimeDatabaseRole(dependencies.environment) : undefined;
    const migrations = await discoverMigrations(dependencies.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY);

    pool = new pg.Pool({ connectionString, max: 1, application_name: `commercial-api-${command}` });
    const client = await pool.connect();

    try {
      if (runtimeRole === undefined) {
        const result = await runMigrations(client, migrations);
        for (const fileName of result.applied) {
          dependencies.writeStdout(`commercial-api migrate: applied ${fileName}\n`);
        }
        dependencies.writeStdout(`commercial-api migrate: schema at version ${result.latestVersion}\n`);
      } else {
        await applyRuntimeGrants(client, runtimeRole, migrations);
        dependencies.writeStdout(`commercial-api grant-runtime: privileges synchronised for ${runtimeRole}\n`);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    dependencies.writeStderr(`commercial-api ${command}: ${describeDatabaseFailure(error, connectionString)}\n`);
    dependencies.setExitCode(1);
  } finally {
    await pool?.end();
  }
}
