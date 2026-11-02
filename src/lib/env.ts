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

/**
 * LINE Messaging API channel. The ID and secret are enough on their own: every
 * send issues a stateless 15-minute channel access token from them, so there
 * is no long-lived token to rotate. LINE_TO is a user or group ID to push to;
 * without it the message is broadcast to everyone who added the bot.
 */
export type LineConfig = { channelId: string; channelSecret: string; to: string | null };

export function lineConfig(): LineConfig | null {
  const channelId = process.env.LINE_CHANNEL_ID?.trim();
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!channelId || !channelSecret) return null;
  return { channelId, channelSecret, to: process.env.LINE_TO?.trim() || null };
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
