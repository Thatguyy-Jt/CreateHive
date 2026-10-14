// Timezone-aware calendar dates without a date library.
//
// A "date key" is a local calendar date, `YYYY-MM-DD`; a "time key" is a local
// wall-clock time, `HH:MM` (24-hour). Instants are ISO UTC strings. Conversions
// between them go through `Intl.DateTimeFormat` for a named IANA zone, so DST
// is handled by the runtime's time zone data. Pure, no I/O. Invalid input
// returns `null` or `false`; nothing here throws.

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

let zones: ReadonlySet<string> | null = null;
function supportedZones(): ReadonlySet<string> {
  zones ??= new Set(Intl.supportedValuesOf("timeZone"));
  return zones;
}

/** IANA names the runtime supports, sorted, for timezone pickers. */
export function timezoneOptions(): string[] {
  return [...new Set([...supportedZones(), "UTC"])].sort();
}

/**
 * A member of `Intl.supportedValuesOf("timeZone")`, or `UTC`. An alias the
 * runtime resolves to a listed zone (for example `Europe/Kiev`) is accepted;
 * offsets such as `+01:00` are not.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  if (tz === "UTC" || supportedZones().has(tz)) return true;
  try {
    return supportedZones().has(new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/** Strict `YYYY-MM-DD` that names a real calendar date. */
export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && parseDateKey(value) !== null;
}

/** Strict 24-hour `HH:MM`. */
export function isTimeKey(value: unknown): value is string {
  return typeof value === "string" && TIME_KEY.test(value);
}

/** UTC midnight of a date key, as ms, or null. Years 2000–2100 only. */
function parseDateKey(key: string): number | null {
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) return null;
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ms;
}

function toDateKey(utcMidnightMs: number): string {
  return new Date(utcMidnightMs).toISOString().slice(0, 10);
}

/** `key` plus `days` (may be negative), or null for an invalid key. */
export function addDays(key: string, days: number): string | null {
  const ms = parseDateKey(key);
  return ms === null || !Number.isInteger(days) ? null : toDateKey(ms + days * DAY_MS);
}

/** The Monday of the week containing `key`. */
export function weekStart(key: string): string | null {
  const ms = parseDateKey(key);
  if (ms === null) return null;
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return toDateKey(ms - sinceMonday * DAY_MS);
}

/** The seven date keys, Monday to Sunday, of the week starting at `startKey`. */
export function weekDays(startKey: string): string[] | null {
  const ms = parseDateKey(startKey);
  if (ms === null) return null;
  return Array.from({ length: 7 }, (_, index) => toDateKey(ms + index * DAY_MS));
}

/** The week `n` weeks before (negative) or after `startKey`. */
export function shiftWeek(startKey: string, n: number): string | null {
  return addDays(startKey, 7 * n);
}

/** Whole days from `fromKey` to `toKey` (negative when `toKey` is earlier). */
export function daysBetween(fromKey: string, toKey: string): number | null {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  return from === null || to === null ? null : Math.round((to - from) / DAY_MS);
}

// ---------------------------------------------------------------------------
// Instants ↔ local wall-clock time in a zone
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

/** The wall-clock time in `tz` at `instantMs`, expressed as if it were UTC ms. */
function wallClockMs(instantMs: number, tz: string): number {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
}

/** The zone's UTC offset at `instantMs`, in ms (east of UTC is positive). */
function offsetMs(instantMs: number, tz: string): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  return wallClockMs(whole, tz) - whole;
}

function toInstant(value: string | number | Date): number | null {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** The local date in `tz` at an instant, as `YYYY-MM-DD`. */
export function localDateKey(instant: string | number | Date, tz: string): string | null {
  const ms = toInstant(instant);
  if (ms === null || !isValidTimezone(tz)) return null;
  return toDateKey(Math.floor(wallClockMs(ms, tz) / DAY_MS) * DAY_MS);
}

/** Today's date in `tz`. */
export function todayIn(tz: string, now: number = Date.now()): string | null {
  return localDateKey(now, tz);
}

/** The local time in `tz` at an instant, as `HH:MM`. */
export function localTimeKey(instant: string | number | Date, tz: string): string | null {
  const ms = toInstant(instant);
  if (ms === null || !isValidTimezone(tz)) return null;
  return new Date(wallClockMs(ms, tz)).toISOString().slice(11, 16);
}

/**
 * The UTC instant of a local date and time in `tz`, as an ISO string.
 * - Ambiguous times (clocks going back) resolve to the earlier instant.
 * - Skipped times (clocks going forward) move forward by the gap, so
 *   02:30 on a spring-forward night in New York becomes 03:30.
 */
export function localToInstant(dateKey: string, timeKey: string, tz: string): string | null {
  const day = parseDateKey(dateKey);
  const time = TIME_KEY.exec(timeKey);
  if (day === null || !time || !isValidTimezone(tz)) return null;
  const target = day + (Number(time[1]) * 60 + Number(time[2])) * 60 * 1000;

  // Offsets a day either side cover any single transition near the target.
  const candidates = [...new Set([offsetMs(target - DAY_MS, tz), offsetMs(target + DAY_MS, tz), offsetMs(target, tz)])].map(
    (offset) => target - offset,
  );
  const exact = candidates.filter((instant) => wallClockMs(instant, tz) === target);
  const chosen = exact.length ? Math.min(...exact) : Math.max(...candidates);
  return new Date(chosen).toISOString();
}

/** The UTC range `[from, to)` covering the week that starts at `startKey` in `tz`. */
export function weekRange(startKey: string, tz: string): { from: string; to: string } | null {
  const next = shiftWeek(startKey, 1);
  if (!next) return null;
  const from = localToInstant(startKey, "00:00", tz);
  const to = localToInstant(next, "00:00", tz);
  return from && to ? { from, to } : null;
}

// ---------------------------------------------------------------------------
// Display (en-US, matching the rest of the app)
// ---------------------------------------------------------------------------

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });
const monthDayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** "Wed, Oct 14". */
export function formatDay(key: string): string | null {
  const ms = parseDateKey(key);
  return ms === null ? null : dayFormat.format(ms);
}

/** "Wednesday". */
export function formatWeekday(key: string): string | null {
  const ms = parseDateKey(key);
  return ms === null ? null : weekdayFormat.format(ms);
}

/** "Wednesday, Oct 14". */
export function formatLongDay(key: string): string | null {
  const ms = parseDateKey(key);
  return ms === null ? null : `${weekdayFormat.format(ms)}, ${monthDayFormat.format(ms)}`;
}

/** "Oct 12 to 18", or "Sep 28 to Oct 4" across months. */
export function formatWeekRange(startKey: string): string | null {
  const start = parseDateKey(startKey);
  const endKey = addDays(startKey, 6);
  if (start === null || endKey === null) return null;
  const end = parseDateKey(endKey)!;
  const sameMonth = new Date(start).getUTCMonth() === new Date(end).getUTCMonth();
  const endLabel = sameMonth ? String(new Date(end).getUTCDate()) : monthDayFormat.format(end);
  return `${monthDayFormat.format(start)} to ${endLabel}`;
}

/** "9:00 AM" for "09:00". */
export function formatTime(timeKey: string): string | null {
  const match = TIME_KEY.exec(timeKey);
  if (!match) return null;
  const hour = Number(match[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}
