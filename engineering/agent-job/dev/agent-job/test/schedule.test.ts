import { describe, expect, test } from "bun:test";
import { firstRun, nextCron, parseAt, parseCron, parseDuration, runAfter } from "../src/schedule.ts";

const at = (s: string) => new Date(s).getTime();

describe("cron", () => {
  test("every five minutes", () => {
    expect(nextCron("*/5 * * * *", at("2026-10-27T10:02:30"))).toBe(at("2026-10-27T10:05:00"));
    expect(nextCron("*/5 * * * *", at("2026-10-27T10:05:00"))).toBe(at("2026-10-27T10:10:00"));
  });
  test("weekdays at nine", () => {
    // 2026-10-30 is a Friday; the next weekday run is Monday 2026-11-02.
    expect(nextCron("0 9 * * 1-5", at("2026-10-30T09:00:00"))).toBe(at("2026-11-02T09:00:00"));
  });
  test("lists, ranges and sunday as 7", () => {
    expect([...parseCron("0,30 8-10 * * 7").sets[0]!]).toEqual([0, 30]);
    expect(parseCron("0 0 * * 7").sets[4]!.has(0)).toBe(true);
  });
  test("day of month and day of week are ORed when both are set", () => {
    const n = nextCron("0 0 13 * 5", at("2026-10-27T00:00:00"))!;
    expect([13, 5, 6].includes(new Date(n).getDate()) || new Date(n).getDay() === 5).toBe(true);
    expect(new Date(n).getTime()).toBe(at("2026-10-30T00:00:00"));
  });
  test("a date that never exists returns null", () => {
    expect(nextCron("0 0 31 2 *", at("2026-01-01T00:00:00"))).toBeNull();
  });
  test("rejects bad input", () => {
    expect(() => parseCron("* * * *")).toThrow("5 fields");
    expect(() => parseCron("61 * * * *")).toThrow("minute");
    expect(() => parseCron("*/0 * * * *")).toThrow("step 0");
    expect(() => parseCron("a * * * *")).toThrow("bad minute");
  });
});

describe("times", () => {
  test("durations", () => {
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(() => parseDuration("soon")).toThrow("bad duration");
  });
  test("at", () => {
    const now = at("2026-10-27T10:00:00");
    expect(parseAt("+10m", now)).toBe(now + 600_000);
    expect(parseAt("in 2h", now)).toBe(now + 7_200_000);
    expect(parseAt("09:00", now)).toBe(at("2026-10-28T09:00:00"));
    expect(parseAt("11:00", now)).toBe(at("2026-10-27T11:00:00"));
    expect(parseAt("2026-12-01T08:00", now)).toBe(at("2026-12-01T08:00:00"));
    expect(() => parseAt("tomorrow-ish", now)).toThrow("cannot read the time");
  });
});

describe("runs", () => {
  test("every skips missed intervals", () => {
    const s = { kind: "every" as const, expr: "60000" };
    expect(firstRun(s, 1000)).toBe(61_000);
    expect(runAfter(s, 61_000, 61_500)).toBe(121_000);
    expect(runAfter(s, 61_000, 400_000)).toBe(421_000);
  });
  test("a one-shot has no next run", () => {
    expect(runAfter({ kind: "at", expr: "5" }, 5, 6)).toBeNull();
  });
  test("cron resumes after the present, not after a long-missed run", () => {
    const now = at("2026-10-27T10:07:20");
    expect(runAfter({ kind: "cron", expr: "*/5 * * * *" }, at("2026-10-27T09:00:00"), now)).toBe(at("2026-10-27T10:10:00"));
  });
});
