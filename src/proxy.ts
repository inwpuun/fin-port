import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session";

/**
 * Gates the whole app behind the unlock passphrase. Without this, a Vercel
 * deployment URL is world-readable and so is the portfolio behind it.
 *
 * Next.js 16 renamed the `middleware` convention to `proxy`; it runs on the
 * Node runtime. API routes are allowed through so the CLI importer can present
 * a bearer token instead of a cookie; each route re-checks with isAuthorized().
 */
export async function proxy(request: NextRequest) {
  const secret = process.env.ADMIN_TOKEN;

  // No token configured: fail closed rather than silently serving the data.
  if (!secret) {
    return new NextResponse(
      "ADMIN_TOKEN is not set. Add it in Vercel -> Settings -> Environment Variables.",
      { status: 503 }
    );
  }

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.next();

  if (await verifySessionCookie(request.cookies.get(SESSION_COOKIE)?.value, secret)) {
    return NextResponse.next();
  }

  const unlockUrl = new URL("/unlock", request.url);
  unlockUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  matcher: [
    /*
     * Everything except the unlock page itself, Next internals and static
     * assets -- otherwise the redirect target would redirect too.
     */
    "/((?!unlock|_next/static|_next/image|favicon.svg|favicon.ico).*)"
  ]
};
