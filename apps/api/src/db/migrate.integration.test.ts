import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

const databaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL;
const applicationDatabaseUrl = process.env.POSTGRES_INTEGRATION_APPLICATION_DATABASE_URL;
const describePostgres = databaseUrl && applicationDatabaseUrl ? describe : describe.skip;

async function runMigration(environment: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; elapsedMs: number }> {
  const startedAt = Date.now();
  const child = spawn("pnpm", ["exec", "tsx", "src/db/migrate.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, ...environment },
    stdio: "ignore",
  });
  const [code] = (await once(child, "exit")) as [number | null];
  return { code, elapsedMs: Date.now() - startedAt };
}

describePostgres("database migration command", () => {
  let client: Client;

  beforeEach(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      "drop schema if exists drizzle cascade; drop schema public cascade; create schema public authorization chat_rag_migrate",
    );
  });

  afterEach(async () => {
    await client.end();
  });

  it("migrates an empty database and then runs as a no-op", async () => {
    expect((await runMigration()).code).toBe(0);
    await expect(client.query("select to_regclass('public.messages') as table_name")).resolves.toMatchObject({
      rows: [{ table_name: "messages" }],
    });
    expect((await runMigration()).code).toBe(0);
  });

  it("serializes concurrent runners with the advisory lock", async () => {
    const first = runMigration({ MIGRATION_TEST_HOLD_LOCK_MS: "750" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = runMigration();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.code).toBe(0);
    expect(secondResult.code).toBe(0);
    expect(secondResult.elapsedMs).toBeGreaterThanOrEqual(650);
  });

  it("permits application DML and identity sequences but denies DDL", async () => {
    expect((await runMigration()).code).toBe(0);
    const app = new Client({ connectionString: applicationDatabaseUrl });
    await app.connect();
    try {
      const user = await app.query("insert into users (cognito_subject) values ('integration-subject') returning id");
      const conversation = await app.query("insert into conversations (user_id) values ($1) returning id", [user.rows[0]!.id]);
      await expect(
        app.query(
          "insert into messages (conversation_id, role, status, client_message_id) values ($1, 'user', 'complete', 'f8a41f9b-3bb4-467a-8c6b-6deedcf3575a')",
          [conversation.rows[0]!.id],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(app.query("select * from users")).resolves.toMatchObject({ rowCount: 1 });
      await expect(app.query("update conversations set title = 'updated' where id = $1", [conversation.rows[0]!.id])).resolves.toMatchObject({ rowCount: 1 });
      await expect(app.query("delete from messages where conversation_id = $1", [conversation.rows[0]!.id])).resolves.toMatchObject({ rowCount: 1 });
      await expect(app.query("create table application_must_not_ddl (id integer)")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
    }
  });

  it("exits non-zero for a failed migration", async () => {
    const migrationsFolder = await mkdtemp(join(tmpdir(), "chat-rag-broken-migration-"));
    await mkdir(join(migrationsFolder, "meta"));
    await writeFile(
      join(migrationsFolder, "meta", "_journal.json"),
      JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "1", when: 1, tag: "broken", breakpoints: true }] }),
    );
    await writeFile(join(migrationsFolder, "broken.sql"), "this is deliberately invalid sql;");
    try {
      expect((await runMigration({ MIGRATIONS_FOLDER: migrationsFolder })).code).not.toBe(0);
    } finally {
      await rm(migrationsFolder, { recursive: true, force: true });
    }
  });
});
