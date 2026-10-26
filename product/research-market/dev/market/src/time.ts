// Moments in UTC, as whole microseconds since 1970, read and written as the Python script did.

import { UsageError, strip } from "./core";
import { pyRepr } from "./pyjson";

export type Moment = number; // microseconds since 1970-01-01T00:00:00Z

const SECOND = 1_000_000;
export const DAY = 86_400 * SECOND;
// The first moment of year 1 and the first moment after year 9999. Both are exact as floats, while
// moments near them are not (microseconds after the year 2255 pass 2 ** 53), so the bounds are
// checked against these two rather than against the last microsecond of 9999.
const MIN = utc(1, 1, 1, 0, 0, 0, 0);
const END = utc(10000, 1, 1, 0, 0, 0, 0);

function utc(year: number, month: number, day: number, hour: number, minute: number, second: number, micro: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime() * 1000 + micro;
}

/** A moment moved by whole days; outside the years 1 to 9999 it fails, as Python's datetime does. */
export function addDays(moment: Moment, days: number): Moment {
  const moved = moment + days * DAY;
  if (moved < MIN || moved >= END) throw new Error("date value out of range (dates must fall in the years 1 to 9999)");
  return moved;
}

/** Python's datetime.fromtimestamp(seconds, tz=timezone.utc). */
export function fromTimestamp(seconds: number): Moment {
  const whole = Math.trunc(seconds);
  const fraction = seconds - whole;
  let micro = roundHalfEven(fraction * 1e6);
  let base = whole;
  if (micro >= 1_000_000) {
    base += 1;
    micro -= 1_000_000;
  }
  const moment = base * SECOND + micro;
  if (moment < MIN || moment >= END) {
    throw new Error(`year ${new Date(Math.floor(moment / 1000)).getUTCFullYear()} is out of range`);
  }
  return moment;
}

function roundHalfEven(value: number) {
  const rounded = Math.round(value);
  return Math.abs(value % 1) === 0.5 ? 2 * Math.round(value / 2) : rounded;
}

function parts(moment: Moment) {
  const date = new Date(Math.floor(moment / 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return {
    day: `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
  };
}

/** YYYY-MM-DDTHH:MM:SSZ */
export function iso(moment: Moment) {
  const { day, time } = parts(moment);
  return `${day}T${time}Z`;
}

/** YYYY-MM-DD */
export function isoDay(moment: Moment) {
  return parts(moment).day;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validDate(year: number, month: number, day: number) {
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const last = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1]!;
  return day >= 1 && day <= last;
}

/** `count` ASCII digits at `at`, or null. */
function digits(text: string, at: number, count: number) {
  const found = text.slice(at, at + count);
  return found.length === count && /^[0-9]+$/.test(found) ? Number(found) : null;
}

type Clock = { hour: number; minute: number; second: number; micro: number };

/**
 * Python 3.9's parse of [HH[:MM[:SS[.fff[fff]]]]] between `start` and `end`:
 * 0 when it ends there, 1 when something follows, null when it is malformed.
 */
function clock(text: string, start: number, end: number, into: Clock): 0 | 1 | null {
  let at = start;
  const fields = ["hour", "minute", "second"] as const;
  for (const field of fields) {
    const value = digits(text, at, 2);
    if (value === null) return null;
    into[field] = value;
    at += 2;
    const char = text[at];
    at++;
    if (at >= end) return char !== undefined ? 1 : 0;
    if (char === ":") continue;
    if (char === ".") break;
    return null;
  }
  const remains = end - at;
  if (remains !== 6 && remains !== 3) return null;
  const micro = digits(text, at, remains);
  if (micro === null) return null;
  into.micro = remains === 3 ? micro * 1000 : micro;
  return at + remains < text.length ? 1 : 0;
}

/** Python 3.9's datetime.fromisoformat, as UTC: a moment, or null when the text is not accepted. */
function fromIsoFormat(text: string): Moment | null {
  const year = digits(text, 0, 4);
  const month = digits(text, 5, 2);
  const day = digits(text, 8, 2);
  if (year === null || month === null || day === null || text[4] !== "-" || text[7] !== "-") return null;
  const time: Clock = { hour: 0, minute: 0, second: 0, micro: 0 };
  let offset = 0;
  if (text.length > 10) {
    const separator = String.fromCodePoint(text.codePointAt(10)!);
    const rest = text.slice(10 + separator.length);
    let zone = 0;
    while (zone < rest.length && rest[zone] !== "+" && rest[zone] !== "-") zone++;
    if (!rest.length) return null;
    const result = clock(rest, 0, zone, time);
    if (result === null) return null;
    if (zone === rest.length) {
      if (result === 1) return null;
    } else {
      const size = rest.length - zone;
      if (size !== 6 && size !== 9 && size !== 16) return null;
      const shift: Clock = { hour: 0, minute: 0, second: 0, micro: 0 };
      if (clock(rest, zone + 1, rest.length, shift) !== 0) return null;
      const sign = rest[zone] === "-" ? -1 : 1;
      offset = sign * ((shift.hour * 3600 + shift.minute * 60 + shift.second) * SECOND + shift.micro);
      if (Math.abs(offset) >= DAY) return null;
    }
  }
  if (!validDate(year, month, day)) return null;
  if (time.hour > 23 || time.minute > 59 || time.second > 59) return null;
  const moment = utc(year, month, day, time.hour, time.minute, time.second, time.micro) - offset;
  if (moment < MIN || moment >= END) throw new Error("date value out of range (dates must fall in the years 1 to 9999)");
  return moment;
}

/**
 * YYYY-MM-DD or an ISO 8601 date-time as a UTC moment. A plain date means the start of
 * that day, or the start of the next day when `endOfDay` is set, so that
 * `--until 2026-10-07` includes the whole of 7 October.
 */
export function parseTime(text: string, endOfDay = false): Moment {
  const value = strip(text);
  const invalid = () =>
    new UsageError(
      `time ${pyRepr(text)}: use YYYY-MM-DD or an ISO 8601 date-time such as 2026-10-07T12:00:00Z.`,
    );
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    if (!validDate(year, month, day)) throw invalid();
    const start = utc(year, month, day, 0, 0, 0, 0);
    return endOfDay ? addDays(start, 1) : start;
  }
  const moment = fromIsoFormat(value.replace(/Z/g, "+00:00"));
  if (moment === null) throw invalid();
  return moment;
}
