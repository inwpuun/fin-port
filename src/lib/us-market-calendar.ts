/**
 * NYSE trading days, from the exchange's published holiday rules, so the
 * weekly and monthly reports know which day closes the week.
 *
 * Dates are YYYY-MM-DD strings, treated as calendar days (no time zone).
 * Early closes (the day after Thanksgiving, Christmas Eve) are ordinary
 * trading days here: they still close the day.
 */

const DAY_MS = 86_400_000;

export function addDays(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function iso(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** The nth `dow` of a month; n = -1 for the last. */
function nthWeekday(year: number, month: number, dow: number, n: number) {
  if (n > 0) {
    const first = weekday(iso(year, month, 1));
    return iso(year, month, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
  }
  const last = iso(year, month + 1, 0);
  return addDays(last, -((weekday(last) - dow + 7) % 7));
}

/** Saturday holidays move to Friday, Sunday ones to Monday. */
function observed(date: string) {
  const dow = weekday(date);
  return dow === 6 ? addDays(date, -1) : dow === 0 ? addDays(date, 1) : date;
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

const cache = new Map<number, Set<string>>();

export function nyseHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;

  const days = [
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    addDays(easter(year), -2), // Good Friday
    nthWeekday(year, 5, 1, -1), // Memorial Day
    observed(iso(year, 7, 4)), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(iso(year, 12, 25)) // Christmas
  ];
  // New Year's Day: a Saturday New Year is not observed on the Friday before,
  // because that Friday is the last trading day of the previous year.
  const newYear = iso(year, 1, 1);
  if (weekday(newYear) !== 6) days.push(observed(newYear));
  if (year >= 2022) days.push(observed(iso(year, 6, 19))); // Juneteenth

  const set = new Set(days);
  cache.set(year, set);
  return set;
}

export function isTradingDay(isoDate: string) {
  const dow = weekday(isoDate);
  return dow !== 0 && dow !== 6 && !nyseHolidays(Number(isoDate.slice(0, 4))).has(isoDate);
}

/** Monday of the week holding `isoDate`. */
export function weekStart(isoDate: string) {
  return addDays(isoDate, -((weekday(isoDate) + 6) % 7));
}

/** The last trading day of the week holding `isoDate`: Friday, or Thursday on Good Friday. */
export function weekCloseDay(isoDate: string): string | null {
  const monday = weekStart(isoDate);
  for (let offset = 4; offset >= 0; offset -= 1) {
    const day = addDays(monday, offset);
    if (isTradingDay(day)) return day;
  }
  return null;
}

/**
 * The day the month's report goes out: the close of the week that holds the
 * month's last Friday. Days after it belong to the next month's report.
 */
export function monthCloseDay(year: number, month: number): string {
  const lastFriday = nthWeekday(year, month, 5, -1);
  return weekCloseDay(lastFriday) ?? lastFriday;
}

/** The previous month's report day: where this month's report is measured from. */
export function previousMonthCloseDay(isoDate: string) {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month === 1 ? monthCloseDay(year - 1, 12) : monthCloseDay(year, month - 1);
}
