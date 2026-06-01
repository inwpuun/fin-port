import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fin Port Market Watch",
  description: "Trading dashboard and portfolio tracker with price and drawdown alerts.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
        <main className="relative z-10 mx-auto min-h-screen w-[min(1500px,calc(100%-32px))] py-5 md:py-7">
          <header className="mb-6 grid min-h-20 gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
            <Link href="/" className="inline-flex items-center gap-3 text-white no-underline">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-cyan-signal/55 bg-cyan-signal/10 font-serif text-lg font-bold shadow-[0_0_34px_rgba(82,214,255,.18)]">
                FP
              </span>
              <span>
                <strong className="block font-serif text-3xl leading-none md:text-5xl">Fin Port</strong>
                <small className="block text-sm text-slate-400">market signal console</small>
              </span>
            </Link>
            <nav className="glass-panel justify-self-stretch rounded-3xl p-2 lg:justify-self-end">
              <div className="grid gap-2 sm:flex sm:items-center sm:justify-end">
                <Link className="rounded-2xl px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/8 hover:text-white" href="/">
                  Market Watch
                </Link>
                <Link
                  className="rounded-2xl px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/8 hover:text-white"
                  href="/portfolio"
                >
                  My Portfolio
                </Link>
                <Link
                  className="rounded-2xl px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/8 hover:text-white"
                  href="/watchlist"
                >
                  My Watchlist
                </Link>
                <Link
                  className="rounded-2xl px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/8 hover:text-white"
                  href="/allocation"
                >
                  Allocation
                </Link>
              </div>
            </nav>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
