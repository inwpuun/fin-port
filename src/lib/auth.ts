import "server-only";
import { cookies } from "next/headers";
import { adminToken } from "@/lib/env";
import { SESSION_COOKIE, tokenMatches, verifySessionCookie } from "@/lib/session";

/**
 * Two ways in, both proving knowledge of ADMIN_TOKEN:
 *  - `Authorization: Bearer <token>` for the import CLI and curl;
 *  - the signed session cookie set by /unlock, for forms in the browser.
 *
 * The browser never receives the token itself, only the derived cookie.
 */
export async function isAuthorized(request: Request): Promise<boolean> {
  const secret = adminToken();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ") && tokenMatches(header.slice(7).trim(), secret)) {
    return true;
  }

  const store = await cookies();
  return verifySessionCookie(store.get(SESSION_COOKIE)?.value, secret);
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
