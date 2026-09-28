import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { DataFreshness } from "@/components/data-freshness";
import { LockButton } from "@/components/lock-button";
import { MobileNav, SiteNav } from "@/components/site-nav";
import { emptyFreshness, getDataFreshness } from "@/lib/data/freshness";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fin Port Market Watch",
  description: "Trading dashboard and portfolio tracker with price and drawdown alerts.",
  icons: {
    icon: "/favicon.svg"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the mobile tab bar sit under the home indicator and pad itself out.
  viewportFit: "cover",
  themeColor: "#06080c"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  /*
   * /unlock renders through this layout and is reachable without a session, so
   * gate the lookup on the cookie rather than letting an anonymous visitor
   * trigger four database queries.
   */
  const store = await cookies();
  const unlocked = await verifySessionCookie(
    store.get(SESSION_COOKIE)?.value,
    process.env.ADMIN_TOKEN ?? ""
  );
  const freshness = unlocked ? await getDataFreshness() : emptyFreshness;

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:54px_54px] [mask-image:linear-gradient(to_bottom,rgba(0,0,0,.95),transparent_78%)]"
        />
        <div
          aria-hidden="true"
          className="animate-radar pointer-events-none fixed -right-72 top-[10vh] aspect-square w-[46rem] rounded-full border border-cyan-signal/15 before:absolute before:inset-[17%] before:rounded-full before:border before:border-cyan-signal/15 before:content-[''] after:absolute after:inset-[34%] after:rounded-full after:border after:border-cyan-signal/15 after:content-['']"
        />
        {/*
          No z-index here: one would make <main> a stacking context and trap the
          modals' z-50 beneath the mobile tab bar. DOM order already paints it
          over the decorative layers above.
        */}
        <main className="relative mx-auto min-h-screen w-[min(1500px,calc(100%-24px))] pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:w-[min(1500px,calc(100%-32px))] md:py-7">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3 md:mb-6 xl:min-h-20">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/" className="inline-flex min-w-0 items-center gap-3 text-white no-underline">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-cyan-signal/55 bg-cyan-signal/10 font-serif text-base font-bold shadow-[0_0_34px_rgba(82,214,255,.18)] md:h-12 md:w-12 md:text-lg">
                  FP
                </span>
                <span className="min-w-0">
                  <strong className="block font-serif text-2xl leading-none md:text-5xl">Fin Port</strong>
                  <small className="block truncate text-xs text-slate-400 md:text-sm">market signal console</small>
                </span>
              </Link>
              <DataFreshness freshness={freshness} />
            </div>
            <div className="flex shrink-0 items-center gap-2 md:max-xl:basis-full md:max-xl:justify-between">
              <SiteNav />
              <LockButton />
            </div>
          </header>
          {children}
        </main>
        <MobileNav />
      </body>
    </html>
  );
}
