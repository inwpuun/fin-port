"use client";

import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import FullCalendar from "@fullcalendar/react";
import type { CalendarRef, DatesSetInfo, DayCellInfo, EventClickInfo, EventDisplayInfo, EventInput } from "@fullcalendar/react";
import classicTheme from "@fullcalendar/react/themes/classic";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import type { DateClickInfo } from "@fullcalendar/react";
import { currencyFormat } from "@/lib/format";
import type { CashBookFlowType, CashBookTransaction } from "@/types/cash-book";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";

type DayEventProps = {
  type: CashBookFlowType;
  total: number;
  count: number;
};

// A vertical drag changes month once it passes this distance, or on a quick flick.
const swipeDistance = 40;
const flickVelocity = 0.35; // px per ms
const flickMinDistance = 12;
const wheelThreshold = 80;

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// v7 reads only `color` (background + border) and `contrastColor` (text) from an event.
const flowStyles: Record<CashBookFlowType, { order: number; prefix: string; color: string; text: string }> = {
  income: { order: 0, prefix: "+", color: "rgba(20, 206, 153, 0.2)", text: "#14ce99" },
  expense: { order: 1, prefix: "-", color: "rgba(255, 82, 120, 0.2)", text: "#ff5278" }
};

export function CashBookCalendar({
  transactions,
  year,
  onOpen
}: {
  transactions: CashBookTransaction[];
  year: number | "all";
  onOpen: (eyebrow: string, title: string, rows: CashBookTransaction[]) => void;
}) {
  const calendarRef = useRef<CalendarRef>(null);
  const swipeRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; time: number; offset: number; vertical: boolean | null } | null>(null);
  const suppressClick = useRef(false);
  const stepRef = useRef<(direction: 1 | -1) => void>(() => {});
  const [viewTitle, setViewTitle] = useState("");
  const [viewMonthKey, setViewMonthKey] = useState("");

  const transactionsByDate = useMemo(() => groupByDate(transactions), [transactions]);
  const events = useMemo(() => buildDayEvents(transactionsByDate), [transactionsByDate]);
  const initialDate = useMemo(() => latestMonthStart(transactions, year), [transactions, year]);
  const monthTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.monthKey === viewMonthKey),
    [transactions, viewMonthKey]
  );
  const monthTotals = useMemo(() => summarize(monthTransactions), [monthTransactions]);
  const activeDays = useMemo(() => new Set(monthTransactions.map((transaction) => transaction.date)).size, [monthTransactions]);
  const bounds = useMemo(() => monthBounds(transactions, year), [transactions, year]);
  const canGoPrev = Boolean(viewMonthKey && bounds.min && viewMonthKey > bounds.min);
  const canGoNext = Boolean(viewMonthKey && bounds.max && viewMonthKey < bounds.max);

  useEffect(() => {
    stepRef.current = step;
  });

  // Attached once, so the per-gesture lock survives the re-render a month change causes;
  // otherwise trackpad momentum would unlock it and skip a second month.
  useEffect(() => {
    const element = swipeRef.current;
    if (!element) return;

    let travel = 0;
    let locked = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    // Trackpad two-finger swipes arrive as a burst of horizontal wheel events. Take one
    // month per gesture, and keep the browser from reading it as back/forward navigation.
    function handleWheel(event: WheelEvent) {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();

      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        travel = 0;
        locked = false;
      }, 200);

      if (locked) return;
      travel += event.deltaX;
      if (Math.abs(travel) < wheelThreshold) return;

      locked = true;
      stepRef.current(travel > 0 ? 1 : -1);
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      clearTimeout(idleTimer);
      element.removeEventListener("wheel", handleWheel);
    };
  }, []);

  function canStep(direction: 1 | -1) {
    return direction === 1 ? canGoNext : canGoPrev;
  }

  function move(direction: 1 | -1) {
    const api = calendarRef.current?.getApi();
    if (direction === 1) api?.next();
    else api?.prev();
  }

  // Buttons and the trackpad: switch now, then slide the new month in from the side.
  function step(direction: 1 | -1) {
    if (!canStep(direction)) return;
    move(direction);

    if (prefersReducedMotion()) return;
    swipeRef.current?.animate(
      [
        { transform: `translateX(${direction * 32}px)`, opacity: 0.35 },
        { transform: "translateX(0)", opacity: 1 }
      ],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  }

  function handleTouchStart(event: TouchEvent) {
    suppressClick.current = false;
    if (event.touches.length !== 1) {
      drag.current = null;
      return;
    }

    const element = swipeRef.current;
    element?.getAnimations().forEach((animation) => animation.cancel());
    const touch = event.touches[0];
    drag.current = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, offset: 0, vertical: null };
  }

  // The grid follows the finger. Past the first or last month it only gives a little,
  // so it is clear there is nothing further.
  function handleTouchMove(event: TouchEvent) {
    const state = drag.current;
    const element = swipeRef.current;
    if (!state || !element) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - state.x;
    const deltaY = touch.clientY - state.y;
    if (state.vertical === null && Math.hypot(deltaX, deltaY) > 6) state.vertical = Math.abs(deltaY) >= Math.abs(deltaX);
    if (!state.vertical) return;

    suppressClick.current = true;
    const direction = deltaY < 0 ? 1 : -1;
    state.offset = canStep(direction) ? deltaY : deltaY * 0.25;
    element.style.transform = `translateY(${state.offset}px)`;
    element.style.opacity = String(1 - Math.min(Math.abs(state.offset) / 320, 0.45));
  }

  function handleTouchEnd(event: TouchEvent) {
    const state = drag.current;
    const element = swipeRef.current;
    drag.current = null;
    if (!state?.vertical || !element) return;

    const deltaY = event.changedTouches[0].clientY - state.y;
    const velocity = Math.abs(deltaY) / Math.max(event.timeStamp - state.time, 1);
    // Finger moving up pulls the next month in from below.
    const direction = deltaY < 0 ? 1 : -1;
    const passed = Math.abs(deltaY) >= swipeDistance || (velocity >= flickVelocity && Math.abs(deltaY) >= flickMinDistance);
    const from = { transform: element.style.transform, opacity: element.style.opacity || "1" };
    element.style.transform = "";
    element.style.opacity = "";

    if (!passed || !canStep(direction)) {
      element.animate([from, { transform: "translateY(0)", opacity: 1 }], { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      return;
    }

    if (prefersReducedMotion()) {
      move(direction);
      return;
    }

    const out = element.animate([from, { transform: `translateY(${direction * -72}px)`, opacity: 0 }], {
      duration: 130,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards"
    });
    out.onfinish = () => {
      move(direction);
      out.cancel();
      element.animate(
        [
          { transform: `translateY(${direction * 72}px)`, opacity: 0 },
          { transform: "translateY(0)", opacity: 1 }
        ],
        { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    };
  }

  function handleTouchCancel() {
    const element = swipeRef.current;
    drag.current = null;
    if (!element?.style.transform) return;

    const from = { transform: element.style.transform, opacity: element.style.opacity || "1" };
    element.style.transform = "";
    element.style.opacity = "";
    element.animate([from, { transform: "translateY(0)", opacity: 1 }], { duration: 200, easing: "ease-out" });
  }

  function handleDatesSet(info: DatesSetInfo) {
    const start = info.view.currentStart;
    setViewTitle(info.view.title);
    setViewMonthKey(`${start.getFullYear()}-${pad(start.getMonth() + 1)}`);
  }

  function openDay(date: string, type?: CashBookFlowType) {
    const rows = (transactionsByDate.get(date) || []).filter((transaction) => !type || transaction.type === type);
    if (!rows.length) return;
    onOpen(`${dayLabel(date)} / ${type || "All"}`, type ? `Daily ${type}` : "Daily transactions", rows);
  }

  function handleEventClick(info: EventClickInfo) {
    const props = info.event.extendedProps as DayEventProps;
    openDay(info.event.startStr.slice(0, 10), props.type);
  }

  function dayCellClass(info: DayCellInfo) {
    return transactionsByDate.has(dateKey(info.date)) ? "cash-day-active" : "";
  }

  function handleDateClick(info: DateClickInfo) {
    // FullCalendar reports this on pointerup, ahead of the click the capture guard catches.
    if (suppressClick.current) return;
    openDay(info.dateStr.slice(0, 10));
  }

  return (
    <section className="glass-panel overflow-hidden rounded-3xl">
      <div className="flex flex-col gap-4 border-b border-white/10 p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">{year === "all" ? "All years" : year} Daily Calendar</p>
          <h2 className="text-2xl font-black">{viewTitle || "Income and expense by day"}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => step(-1)} disabled={!canGoPrev} className={navChipClass} aria-label="Previous month">
            ← Prev
          </button>
          <button type="button" onClick={() => calendarRef.current?.getApi().gotoDate(initialDate)} className={navChipClass}>
            Latest
          </button>
          <button type="button" onClick={() => step(1)} disabled={!canGoNext} className={navChipClass} aria-label="Next month">
            Next →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-white/10 p-6 lg:grid-cols-4">
        <Metric title="Month Income" value={money(monthTotals.income)} tone="text-mint-signal" />
        <Metric title="Month Expense" value={money(monthTotals.expense)} tone="text-rose-signal" />
        <Metric title="Month Net" value={money(monthTotals.net)} tone={monthTotals.net >= 0 ? "text-cyan-signal" : "text-amber-signal"} />
        <Metric title="Active Days" value={String(activeDays)} />
      </div>

      <div className="cash-calendar overflow-hidden p-3 sm:p-6">
        <div
          ref={swipeRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          onClickCapture={(event) => {
            // A drag that ends over a pill or day should not also open it.
            if (!suppressClick.current) return;
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
          // Vertical drags belong to the month swipe here, so the page does not scroll under them.
          className="touch-pinch-zoom overscroll-x-contain"
        >
          <FullCalendar
            // Remount on year change so the view jumps to that year's latest month.
            key={String(year)}
            ref={calendarRef}
            plugins={[classicTheme, dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            initialDate={initialDate}
            validRange={year === "all" ? undefined : { start: `${year}-01-01`, end: `${year + 1}-01-01` }}
            headerToolbar={false}
            height="auto"
            fixedWeekCount={false}
            showNonCurrentDates={false}
            dayMaxEvents={false}
            eventOrder="order"
            events={events}
            eventContent={renderDayEvent}
            eventClass={dayEventClass}
            dayCellClass={dayCellClass}
            eventClick={handleEventClick}
            dateClick={handleDateClick}
            datesSet={handleDatesSet}
          />
        </div>
      </div>
    </section>
  );
}

function dayEventClass(info: EventDisplayInfo) {
  const props = info.event.extendedProps as DayEventProps;
  const ring = props.type === "income" ? "hover:ring-mint-signal/60" : "hover:ring-rose-signal/60";
  return `cursor-pointer transition duration-150 hover:-translate-y-px hover:brightness-150 hover:ring-1 ${ring}`;
}

function renderDayEvent(info: EventDisplayInfo) {
  const props = info.event.extendedProps as DayEventProps;
  const style = flowStyles[props.type];

  return (
    <span
      className={`flex w-full items-center justify-between gap-2 py-0.5 font-black ${info.isNarrow ? "px-1 text-[10px]" : "px-1.5 text-xs"}`}
      title={`${props.count} ${props.type} tx: ${money(props.total)}`}
    >
      <span className="truncate">
        {style.prefix}
        {compactMoney(props.total, info.isNarrow)}
      </span>
      {!info.isNarrow && <span className="shrink-0 text-[10px] font-bold opacity-70">{props.count}</span>}
    </span>
  );
}

function Metric({ title, value, tone = "text-white" }: { title: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</span>
      <strong className={`mt-2 block break-words text-lg font-black leading-tight sm:text-xl ${tone}`}>{value}</strong>
    </div>
  );
}

function groupByDate(transactions: CashBookTransaction[]) {
  const rows = new Map<string, CashBookTransaction[]>();

  transactions.forEach((transaction) => {
    const current = rows.get(transaction.date) || [];
    current.push(transaction);
    rows.set(transaction.date, current);
  });

  return rows;
}

function buildDayEvents(transactionsByDate: Map<string, CashBookTransaction[]>) {
  const events: EventInput[] = [];

  transactionsByDate.forEach((rows, date) => {
    (["income", "expense"] as const).forEach((type) => {
      const typed = rows.filter((transaction) => transaction.type === type);
      if (!typed.length) return;

      const style = flowStyles[type];
      events.push({
        id: `${date}-${type}`,
        start: date,
        allDay: true,
        color: style.color,
        contrastColor: style.text,
        order: style.order,
        extendedProps: {
          type,
          total: typed.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0),
          count: typed.length
        } satisfies DayEventProps
      });
    });
  });

  return events;
}

function monthBounds(transactions: CashBookTransaction[], year: number | "all") {
  if (year !== "all") return { min: `${year}-01`, max: `${year}-12` };

  const keys = transactions.map((transaction) => transaction.monthKey).sort();
  return { min: keys[0] || "", max: keys[keys.length - 1] || "" };
}

function latestMonthStart(transactions: CashBookTransaction[], year: number | "all") {
  const latest = transactions.reduce((max, transaction) => (transaction.date > max ? transaction.date : max), "");
  if (latest) return `${latest.slice(0, 7)}-01`;
  return year === "all" ? new Date().toISOString().slice(0, 10) : `${year}-01-01`;
}

function summarize(transactions: CashBookTransaction[]) {
  return transactions.reduce(
    (summary, transaction) => {
      if (transaction.amount >= 0) summary.income += transaction.amount;
      if (transaction.amount < 0) summary.expense += Math.abs(transaction.amount);
      summary.net += transaction.amount;
      return summary;
    },
    { income: 0, expense: 0, net: 0 }
  );
}

function dayLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${monthLabels[month - 1]} ${year}`;
}

// Day cell dates are FullCalendar markers: midnight UTC, so read the UTC fields.
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function dateKey(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function money(value: number) {
  return currencyFormat(value, "THB");
}

function compactMoney(value: number, narrow = false) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 || narrow ? 0 : 2,
    notation: value >= (narrow ? 1000 : 100000) ? "compact" : "standard"
  }).format(value);
}

const navChipClass =
  "min-h-10 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300 transition enabled:hover:border-cyan-signal/30 enabled:hover:text-white disabled:cursor-default disabled:opacity-40";
