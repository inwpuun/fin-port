import "server-only";
import { cookies } from "next/headers";
import { adminToken } from "@/lib/env";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE, tokenMatches, verifySessionCookie } from "@/lib/session";

/**
 * Two ways in, both proving knowledge of ADMIN_TOKEN:
 *  - `Authorization: Bearer <token>` for the import CLI and curl;
 *  - the signed session cookie set by /unlock, for the browser.
 *
 * The browser never receives the token itself, only the derived cookie.
 */

const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

export async function isAuthorized(request: Request): Promise<boolean> {
  const secret = adminToken();

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  // A valid cookie is the common case, so check it before spending a hash on
  // the header, and before touching the rate limiter at all.
  const store = await cookies();
  if (await verifySessionCookie(store.get(SESSION_COOKIE)?.value, secret)) return true;

  if (!bearer) return false;

  // Only failed bearer attempts are metered, so ordinary browsing can never
  // throttle itself. See rate-limit.ts for what this does and does not do.
  const key = await clientKey("api");
  if (!rateLimit(key, FAIL_LIMIT, FAIL_WINDOW_MS).ok) return false;

  return tokenMatches(bearer, secret);
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
