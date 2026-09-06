import "server-only";
import { MIN_TOKEN_LENGTH } from "@/lib/session";

/**
 * Every Supabase credential is read through here, and this module is
 * `server-only`: importing it from a Client Component is a build error.
 *
 * Nothing is named NEXT_PUBLIC_* on purpose. Next.js inlines NEXT_PUBLIC_
 * variables into the browser bundle, so a key with that prefix is published
 * to every visitor of the deployment. Ours stay on the server.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local for local dev, or add it in Vercel -> Settings -> Environment Variables.`
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("SUPABASE_URL").replace(/\/+$/, "");
}

export function supabasePublishableKey(): string {
  return required("SUPABASE_PUBLISHABLE_KEY");
}

/** Bypasses RLS. Only ever used inside server code paths that write. */
export function supabaseSecretKey(): string {
  const key = required("SUPABASE_SECRET_KEY");
  if (key.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SECRET_KEY holds a publishable key. Generate a secret key in Supabase -> Project Settings -> API Keys -> Secret keys."
    );
  }
  return key;
}

export function hasSecretKey(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
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
