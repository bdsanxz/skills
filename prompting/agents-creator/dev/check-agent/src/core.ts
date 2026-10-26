// Errors, output and decoding that every part uses.

/** The script was used wrongly, or the file to check cannot be read: exit 2. */
export class UsageError extends Error {}

/** A file that is not UTF-8 text. */
export class NotUtf8 extends Error {}

/** Where the output goes. The tests replace both. */
export const io = {
  out: (text: string) => void process.stdout.write(text + "\n"),
  err: (text: string) => void process.stderr.write(text + "\n"),
};

const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The text of UTF-8 bytes, keeping a byte order mark as Python's "utf-8" codec does. */
export function decodeUtf8(bytes: Uint8Array) {
  try {
    return DECODER.decode(bytes);
  } catch {
    throw new NotUtf8("the file is not UTF-8 text; save it as UTF-8 and check it again");
  }
}
