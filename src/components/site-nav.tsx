"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Market Watch" },
  { href: "/portfolio", label: "My Portfolio" },
  { href: "/watchlist", label: "My Watchlist" },
  { href: "/allocation", label: "Allocation" },
  { href: "/cash-book", label: "Cash Book" }
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="glass-panel justify-self-stretch rounded-3xl p-2 lg:justify-self-end" aria-label="Primary">
      <div className="grid gap-2 sm:flex sm:items-center sm:justify-end">
        {navItems.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              className={
                active
                  ? "rounded-2xl border border-cyan-signal/40 bg-cyan-signal/15 px-4 py-3 text-sm font-black text-cyan-signal shadow-[0_0_24px_rgba(82,214,255,.12)]"
                  : "rounded-2xl px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/8 hover:text-white"
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
