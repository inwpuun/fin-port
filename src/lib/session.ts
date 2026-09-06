/**
 * Signed session cookie for the single-user gate.
 *
 * Uses Web Crypto only -- no `node:crypto` -- so the same code runs in
 * `proxy.ts`, in Server Actions and in route handlers. The cookie carries no
 * secret: it is an expiry plus an HMAC over that expiry, so a stolen cookie
 * cannot be turned back into the passphrase and expires on its own.
 */

export const SESSION_COOKIE = "fp_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Minimum ADMIN_TOKEN length. `openssl rand -hex 32` gives 64 chars / 256
 * bits, which is not brute-forceable. The floor exists because nothing else
 * in this design stops a short, guessable passphrase.
 */
export const MIN_TOKEN_LENGTH = 24;

/**
 * Domain separation label. The passphrase is never used directly as the
 * signing key -- one secret doing two jobs (typed password and MAC key) is
 * worth avoiding even when no concrete attack follows from it.
 */
const SESSION_KEY_LABEL = "fin-port/session/v1";

const encoder = new TextEncoder();

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKeyFrom(raw: ArrayBuffer | Uint8Array) {
  return crypto.subtle.importKey(
    "raw",
    raw as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/** HMAC(secret, label) -- a signing key distinct from the passphrase itself. */
async function sessionSigningKey(secret: string) {
  const root = await hmacKeyFrom(encoder.encode(secret));
  const derived = await crypto.subtle.sign("HMAC", root, encoder.encode(SESSION_KEY_LABEL));
  return hmacKeyFrom(derived);
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await sessionSigningKey(secret);
  return base64UrlEncode(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** Constant-time compare over equal-length byte arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Compares two strings through their SHA-256 digests.
 *
 * Digests are always 32 bytes, so unlike a direct compare this leaks nothing
 * about the length of either input -- including the length of the passphrase.
 */
async function digestEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b))
  ]);
  return bytesEqual(new Uint8Array(da), new Uint8Array(db));
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

  return digestEqual(signature, await sign(payload, secret));
}

/** Compares a submitted passphrase against the configured token. */
export async function tokenMatches(presented: string, secret: string): Promise<boolean> {
  if (!presented) return false;
  return digestEqual(presented, secret);
}

/**
 * Sanitizes a post-unlock redirect target.
 *
 * `?next=` is attacker-controlled, and a naive "starts with / but not //"
 * check is not enough: URL parsers fold a backslash into a slash and strip
 * tabs and newlines, so `/\evil.com`, `/\/evil.com` and `/<tab>/evil.com` all
 * resolve to an external origin. Parsing against a throwaway base and
 * comparing origins rejects every one of those, and the extra `//` guard
 * covers `/..//evil.com`, which normalizes to a protocol-relative path.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";

  const base = "http://fin-port.invalid";

  try {
    const url = new URL(raw, base);
    if (url.origin !== base) return "/";
    if (url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return "/";
  }
}
