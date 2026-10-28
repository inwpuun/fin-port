"use client";

import { useEffect, type ReactNode } from "react";

/**
 * The dialog frame the transaction and cash forms share: dimmed backdrop,
 * Escape and backdrop-click to close (unless a save is in flight), and the
 * page scroll locked underneath.
 */
export function ModalShell({
  eyebrow,
  title,
  titleId,
  busy,
  onClose,
  children
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#03070c]/88 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div className="glass-panel max-h-full w-full max-w-lg overflow-auto rounded-3xl p-4 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">{eyebrow}</p>
            <h2 id={titleId} className="text-2xl font-black">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 text-xl text-slate-400 transition hover:text-white disabled:opacity-50"
          >
            {"×"}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Today as YYYY-MM-DD in the browser's timezone, for date inputs. */
export function localToday() {
  return new Date().toLocaleDateString("en-CA");
}
