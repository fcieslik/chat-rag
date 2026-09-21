import { describe, expect, it } from "vitest";
import { createDatabaseConnectionConfig } from "./databaseRuntime.js";

describe("database runtime configuration", () => {
  const databaseUrl = "postgresql://app:password@database.example:5432/chat_rag?sslmode=disable";

  it("uses the bounded application pool and explicitly disables TLS outside production", () => {
    expect(createDatabaseConnectionConfig(databaseUrl, { NODE_ENV: "test" })).toMatchObject({
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: false,
    });
  });

  it("requires verified TLS in production even when the URL requests an insecure mode", () => {
    const config = createDatabaseConnectionConfig(databaseUrl, { NODE_ENV: "production" });

    expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(config.connectionString).not.toContain("sslmode");
  });

  it("refuses an explicit production TLS downgrade", () => {
    expect(() =>
      createDatabaseConnectionConfig("postgresql://app:password@database.example:5432/chat_rag", {
        NODE_ENV: "production",
        DATABASE_SSL_MODE: "disable",
      }),
    ).toThrow("DATABASE_SSL_MODE=disable is not allowed in production");
  });

  it("refuses a missing production database URL before opening a listener", () => {
    expect(() => createDatabaseConnectionConfig(undefined, { NODE_ENV: "production" })).toThrow(
      "DATABASE_URL must be set",
    );
  });
});
