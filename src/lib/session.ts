/**
 * Signed session cookie for the single-user gate.
 *
 * Uses Web Crypto only -- no `node:crypto` -- because this module also runs in
 * middleware on the Edge runtime. The cookie carries no secret: it is an
 * expiry plus an HMAC of that expiry keyed by ADMIN_TOKEN, so a stolen cookie
 * cannot be turned back into the token and expires on its own.
 */

export const SESSION_COOKIE = "fp_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64UrlEncode(signature);
}

/** Constant-time string compare that works on both runtimes. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(secret: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = String(expiresAt);
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionCookie(
  value: string | undefined,
  secret: string
): Promise<boolean> {
  if (!value) return false;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  return safeEqual(signature, await sign(payload, secret));
}

/** Compares a submitted passphrase against the configured token. */
export function tokenMatches(presented: string, secret: string): boolean {
  return Boolean(presented) && safeEqual(presented, secret);
}
