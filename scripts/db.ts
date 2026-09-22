/**
 * Connection helper shared by the CLI scripts.
 *
 * The scripts run under tsx, outside Next.js, so they cannot import
 * src/lib/db/client.ts -- that module is `server-only`, which throws on
 * import anywhere but a React Server Component. They open their own one-shot
 * client instead and close it when they are done.
 */
import path from "node:path";
import { Client } from "pg";

export const projectRoot = path.resolve(import.meta.dirname, "..");

/** Loads .env.local then .env, without overwriting anything already in the shell. */
export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(projectRoot, file));
    } catch {
      // Missing file is fine; the variable may come from the shell or CI.
    }
  }
}

export async function connect(): Promise<Client> {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, " +
        "or run: DATABASE_URL=postgres://finport:<password>@localhost:5432/finport npm run db:migrate"
    );
  }

  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });

  try {
    await client.connect();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not connect to Postgres: ${detail}\n` +
        "Is the database up? Start it with: docker compose up -d db"
    );
  }

  return client;
}
