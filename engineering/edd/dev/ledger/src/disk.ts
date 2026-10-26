// The line that ends every command: what the current folder takes on disk, and what its disk has free.

import fs from "node:fs";
import path from "node:path";
import { PROG, general, note, oneDecimal, systemMessage } from "./core";

/** How long the count may take, in seconds. The tests lower it. A larger folder is given as "at least". */
export const disk = { seconds: 5 };

/**
 * The bytes the files under a folder take on disk, and whether the count finished in time.
 * Counts the blocks each file and folder takes, as `du` does, once per file however many links
 * it has, without following symbolic links. An entry with no blocks counts by its size.
 */
export function folderSize(folder: string, seconds: number): [number, boolean] {
  let total = 0;
  const seen = new Set<string>();
  const stack = [folder];
  const stop = performance.now() + seconds * 1000;
  while (stack.length) {
    if (performance.now() >= stop) return [total, false];
    const current = stack.pop()!;
    let names: string[];
    try {
      names = fs.readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const entry = path.join(current, name);
      let info: fs.BigIntStats;
      try {
        info = fs.lstatSync(entry, { bigint: true });
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        stack.push(entry);
      } else if (info.nlink > 1n) {
        const key = `${info.dev}:${info.ino}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      total += Number(info.blocks) * 512 || Number(info.size);
    }
  }
  return [total, true];
}

const UNITS = ["KB", "MB", "GB"];

/** A size in bytes, KB, MB or GB. */
export function amount(size: number) {
  if (size < 1024) return `${Math.trunc(size)} bytes`;
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${oneDecimal(value)} ${UNITS[unit]}`;
}

/** Prints the disk line on standard error. */
export function diskFooter() {
  let here: string;
  let size: number;
  let whole: boolean;
  let free: number;
  let total: number;
  try {
    here = process.cwd();
    [size, whole] = folderSize(here, disk.seconds);
    const stats = fs.statfsSync(here);
    const block = (stats as { frsize?: number }).frsize ?? stats.bsize;
    free = stats.bavail * block;
    total = stats.blocks * block;
  } catch (error) {
    note(`${PROG}: disk: could not be measured: ${systemMessage(error)}`);
    return;
  }
  const atLeast = whole ? "" : "at least ";
  const stopped = whole ? "" : ` (counting stopped after ${general(disk.seconds)} s)`;
  note(
    `${PROG}: disk: the current folder ${here} takes ${atLeast}${amount(size)}${stopped}; ` +
      `its disk has ${amount(free)} free of ${amount(total)}.`,
  );
}
