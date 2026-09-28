"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Market Watch", short: "Market", icon: "M3 17l5-5 4 4 8-8M14 8h6v6" },
  { href: "/portfolio", label: "My Portfolio", short: "Portfolio", icon: "M4 7h16v12H4zM9 7V5h6v2M4 12h16" },
  { href: "/watchlist", label: "My Watchlist", short: "Watchlist", icon: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z" },
  { href: "/allocation", label: "Allocation", short: "Allocation", icon: "M12 3v9h9M12 3a9 9 0 109 9" },
  { href: "/cash-book", label: "Cash Book", short: "Cash", icon: "M4 5h16v14H4zM4 10h16M9 15h2" }
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Top navigation, from the md breakpoint up. Phones get MobileNav instead. */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="glass-panel hidden rounded-3xl p-2 md:block" aria-label="Primary">
      <div className="flex items-center gap-1 lg:gap-2">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              className={
                active
                  ? "whitespace-nowrap rounded-2xl border border-cyan-signal/40 bg-cyan-signal/15 px-3 py-3 text-sm font-black text-cyan-signal shadow-[0_0_24px_rgba(82,214,255,.12)] lg:px-4"
                  : "whitespace-nowrap rounded-2xl px-3 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/8 hover:text-white lg:px-4"
              }
              href={item.href}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Bottom tab bar for phones, where five stacked links would push the page below the fold. */
export function MobileNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/unlock")) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#070b11]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`grid min-h-16 place-items-center content-center gap-1 px-1 text-[11px] font-bold transition ${
                active ? "text-cyan-signal" : "text-slate-400 active:text-white"
              }`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className={`h-5 w-5 ${active ? "drop-shadow-[0_0_8px_rgba(82,214,255,.6)]" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={item.icon} />
              </svg>
              <span className="truncate">{item.short}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
