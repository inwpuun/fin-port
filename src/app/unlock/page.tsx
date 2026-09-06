import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminToken } from "@/lib/env";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionCookie,
  tokenMatches
} from "@/lib/session";

export const dynamic = "force-dynamic";

async function unlock(formData: FormData) {
  "use server";

  const secret = adminToken();
  const presented = String(formData.get("passphrase") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!tokenMatches(presented, secret)) {
    redirect(`/unlock?error=1&next=${encodeURIComponent(next)}`);
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionCookie(secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });

  // Only allow same-origin paths, so ?next= can't become an open redirect.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export default async function UnlockPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="grid min-h-[70vh] place-items-center">
      <section className="glass-panel w-full max-w-md rounded-3xl p-8">
        <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">
          Fin Port
        </p>
        <h1 className="mb-2 font-serif text-4xl leading-none">Locked.</h1>
        <p className="mb-6 text-sm text-slate-400">
          This dashboard holds live position and cash-ledger data. Enter the access
          passphrase to continue.
        </p>

        <form action={unlock} className="grid gap-3">
          <input type="hidden" name="next" value={params.next ?? "/"} />
          <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Passphrase
            </span>
            <input
              id="passphrase"
              name="passphrase"
              type="password"
              autoComplete="current-password"
              autoFocus
              className="bg-transparent text-lg outline-none"
            />
          </label>

          {params.error ? (
            <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-signal">
              Incorrect passphrase.
            </p>
          ) : null}

          <button className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e]">
            Unlock
          </button>
        </form>
      </section>
    </div>
  );
}
