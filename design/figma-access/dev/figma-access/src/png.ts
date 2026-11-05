// Minimal PNG reader and writer for the images this CLI compares: Figma renders and browser
// screenshots, which are 8-bit, non-interlaced PNGs. Pixels are returned as RGBA bytes.

import { deflateSync, inflateSync } from "node:zlib";

export interface Image {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, row by row
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(buf: Buffer): Image {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG file");
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  let palette: Buffer | undefined, alpha: Buffer | undefined;
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      color = body[9]!;
      interlace = body[12]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") alpha = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = CHANNELS[color];
  if (depth !== 8 || ch === undefined || interlace !== 0) {
    throw new Error(`unsupported PNG (bit depth ${depth}, color type ${color}, interlace ${interlace}); only 8-bit non-interlaced PNGs are read`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch]! : 0;
      const b = y > 0 ? px[row - stride + x]! : 0;
      const c = x >= ch && y > 0 ? px[row - stride + x - ch]! : 0;
      let v = raw[src + x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[row + x] = v & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    const s = i * ch;
    if (color === 3) {
      const k = px[s]!;
      data[j] = palette![k * 3]!;
      data[j + 1] = palette![k * 3 + 1]!;
      data[j + 2] = palette![k * 3 + 2]!;
      data[j + 3] = alpha && k < alpha.length ? alpha[k]! : 255;
    } else if (ch <= 2) {
      data[j] = data[j + 1] = data[j + 2] = px[s]!;
      data[j + 3] = ch === 2 ? px[s + 1]! : 255;
    } else {
      data[j] = px[s]!;
      data[j + 1] = px[s + 1]!;
      data[j + 2] = px[s + 2]!;
      data[j + 3] = ch === 4 ? px[s + 3]! : 255;
    }
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** Encodes RGBA pixels as an 8-bit RGBA PNG. */
export function encodePng(img: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
