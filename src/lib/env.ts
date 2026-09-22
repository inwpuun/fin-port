import "server-only";
import { MIN_TOKEN_LENGTH } from "@/lib/session";

/**
 * Every credential is read through here, and this module is `server-only`:
 * importing it from a Client Component is a build error.
 *
 * Nothing is named NEXT_PUBLIC_* on purpose. Next.js inlines NEXT_PUBLIC_
 * variables into the browser bundle, so a variable with that prefix is
 * published to every visitor of the deployment. Ours stay on the server --
 * and DATABASE_URL contains a password, so that matters more than ever.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local for local dev; under Docker Compose it is set for you from POSTGRES_*.`
    );
  }
  return value;
}

/**
 * Connection string for the Postgres that ships in docker-compose.yml.
 *
 * Under Compose the host is the `db` service; running `npm run dev` on the
 * host it is 127.0.0.1 against the published port. Same database either way.
 */
export function databaseUrl(): string {
  const url = required("DATABASE_URL").trim();

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `DATABASE_URL must be a postgres:// connection string, e.g. postgres://finport:<password>@localhost:5432/finport`
    );
  }

  return url;
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function adminToken(): string {
  const token = required("ADMIN_TOKEN");

  // Nothing else in this design stops a short, guessable passphrase: the gate
  // has no CAPTCHA and the rate limiter is per-instance only.
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `ADMIN_TOKEN is ${token.length} characters; at least ${MIN_TOKEN_LENGTH} are required. Generate one with: openssl rand -hex 32`
    );
  }

  return token;
}
