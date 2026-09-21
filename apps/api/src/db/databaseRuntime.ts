import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool, type ClientConfig, type PoolConfig } from "pg";

const rdsCaBundlePath = fileURLToPath(
  new URL("../certs/rds-ca-eu-central-1.pem", import.meta.url),
);

type DatabaseEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "DATABASE_SSL_MODE" | "NODE_ENV">
>;

function normalizeConnectionString(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgresql protocol");
  }

  for (const option of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    url.searchParams.delete(option);
  }
  return url.toString();
}

export function createDatabaseConnectionConfig(
  databaseUrl = process.env.DATABASE_URL,
  environment: DatabaseEnvironment = process.env,
): PoolConfig {
  const isProduction = environment.NODE_ENV === "production";
  if (!databaseUrl) {
    if (isProduction) throw new Error("DATABASE_URL must be set");
    return {
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: false,
    };
  }

  if (isProduction && environment.DATABASE_SSL_MODE === "disable") {
    throw new Error("DATABASE_SSL_MODE=disable is not allowed in production");
  }

  const poolLimits = {
    connectionString: normalizeConnectionString(databaseUrl),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
  if (!isProduction) return { ...poolLimits, ssl: false };

  return {
    ...poolLimits,
    ssl: { ca: readFileSync(rdsCaBundlePath, "utf8"), rejectUnauthorized: true },
  };
}

export function createDatabasePool(databaseUrl = process.env.DATABASE_URL): Pool {
  return new Pool(createDatabaseConnectionConfig(databaseUrl));
}

export function createMigrationClient(databaseUrl = process.env.DATABASE_URL): Client {
  return new Client(createDatabaseConnectionConfig(databaseUrl) as ClientConfig);
}
