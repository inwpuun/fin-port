"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Freshness } from "@/lib/data/freshness";

/**
 * "Updated ..." label beside the logo, showing when the current page's data
 * last changed.
 *
 * Each route reads different tables, so the label follows the route rather
 * than reporting one global timestamp. Pages that value holdings against a
 * category take the later of the two, since either one changes what is shown.
 */
function pickTimestamp(pathname: string, freshness: Freshness): string | null {
  const latestOf = (...values: Array<string | null>) => {
    const present = values.filter((value): value is string => Boolean(value));
    if (!present.length) return null;
    return present.reduce((newest, value) => (value > newest ? value : newest));
  };

  if (pathname.startsWith("/portfolio")) return latestOf(freshness.holdings, freshness.allocations);
  if (pathname.startsWith("/allocation")) return latestOf(freshness.allocations, freshness.holdings);
  if (pathname.startsWith("/cash-book")) return freshness.cashBook;
  if (pathname.startsWith("/watchlist")) return freshness.watchlist;
  if (pathname === "/") return freshness.watchlist;
  return null;
}

/** Absolute time, in Bangkok, so it matches the ledger's own timezone. */
function absolute(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function relative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  // floor, not round: Math.round(30s) is 1 and would skip "just now".
  const minutes = Math.floor(diffMs / 60_000);

  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo ago`;

  const years = Math.round(months / 12);
  return `${years} yr${years === 1 ? "" : "s"} ago`;
}

export function DataFreshness({ freshness }: { freshness: Freshness }) {
  const pathname = usePathname();
  const iso = pickTimestamp(pathname ?? "/", freshness);

  /*
   * The absolute string is rendered first because it is identical on the
   * server and the client -- a relative one would depend on Date.now() and
   * mismatch during hydration. The relative form replaces it after mount.
   */
  const [ago, setAgo] = useState("");

  useEffect(() => {
    if (!iso) return;

    setAgo(relative(iso));
    const timer = setInterval(() => setAgo(relative(iso)), 60_000);
    return () => clearInterval(timer);
  }, [iso]);

  if (!iso) return null;

  const exact = absolute(iso);

  return (
    <span
      className="hidden shrink-0 border-l border-white/10 pl-3 text-left leading-tight sm:block"
      title={`Data last written ${exact} (Asia/Bangkok)`}
    >
      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">
        Updated
      </span>
      <span className="block text-sm font-bold text-slate-300">{ago || exact}</span>
    </span>
  );
}
