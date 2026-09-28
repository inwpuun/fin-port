"use client";

/**
 * Sort control for the card lists that replace tables on phones, where there
 * are no column headers to tap. Mirrors the header buttons: picking a column
 * applies its default direction, and the arrow flips it.
 */
export function MobileSortBar<Key extends string>({
  columns,
  sort,
  onSort,
  onReset
}: {
  columns: Array<{ key: Key; label: string }>;
  sort: { key: Key; direction: "asc" | "desc" } | null;
  onSort: (key: Key) => void;
  /** Omit when the list always has a sort; the "Default order" choice is then hidden. */
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 md:hidden">
      <label className="field-shell flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Sort</span>
        <select
          className="min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none"
          value={sort?.key ?? ""}
          onChange={(event) => {
            const next = event.target.value as Key | "";
            if (!next) onReset?.();
            else if (next !== sort?.key) onSort(next);
          }}
        >
          {onReset && (
            <option className="bg-panel" value="">
              Default order
            </option>
          )}
          {columns.map((column) => (
            <option className="bg-panel" key={column.key} value={column.key}>
              {column.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!sort}
        onClick={() => sort && onSort(sort.key)}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 font-black text-cyan-signal disabled:text-slate-600"
        aria-label={sort ? `Sorted ${sort.direction === "asc" ? "ascending" : "descending"}, tap to flip` : "No sort applied"}
      >
        {sort ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
      </button>
    </div>
  );
}

/** One label/value pair inside a mobile card. */
export function CardStat({ label, value, tone = "text-white" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`block truncate text-sm font-black ${tone}`}>{value}</span>
    </div>
  );
}
