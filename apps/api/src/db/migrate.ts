import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { fileURLToPath } from "node:url";

export const migrationAdvisoryLockKey = 8_271_203_451n;
const defaultMigrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

export async function runMigrations(
  databaseUrl: string,
  migrationsFolder = process.env.MIGRATIONS_FOLDER ?? defaultMigrationsFolder,
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("select pg_advisory_lock($1)", [migrationAdvisoryLockKey]);
    const testHoldLockMs = Number(process.env.MIGRATION_TEST_HOLD_LOCK_MS ?? "0");
    if (testHoldLockMs > 0) {
      await client.query("select pg_sleep($1)", [testHoldLockMs / 1_000]);
    }
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL must be set for migrations");
    process.exitCode = 1;
  } else {
    runMigrations(databaseUrl).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
