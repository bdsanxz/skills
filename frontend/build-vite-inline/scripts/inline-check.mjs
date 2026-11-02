#!/usr/bin/env node
// inline-check: check that a final file went through an inline encode plugin, and decode it back.
//
// A linter that scans source text would see only the loader in an encoded file and
// pass falsely. Check the built file with this instead, and lint the decoded file.
//
//   node inline-check.mjs <file.html> --check
//   node inline-check.mjs <file.html> --decode <out.html>
//
// Handles all four plugins: vite-plugin-inline-hex-base64.mjs (the default, two layers:
// base64 of hex), vite-plugin-inline-hex.mjs (one layer: hex),
// vite-plugin-inline-base64.mjs (one layer: base64), and vite-plugin-inline-xor.mjs
// (one layer: base64 of XORed bytes). --check exits 0 and prints the layers and sizes
// when the file is exactly one loader with a valid payload. Otherwise it exits 1:
// the file did not go through a plugin, and says how to rebuild. --decode writes the
// readable HTML. Usage errors exit 2 with what to do. Zero dependencies.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const USAGE = 'Usage: node inline-check.mjs <file.html> --check | --decode <out.html>';
const usage = (message) => { console.error(`${message} ${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--check') {
    if (opts.mode) usage('Only one of --check and --decode at a time.');
    opts.mode = 'check';
  } else if (arg === '--decode') {
    if (opts.mode) usage('Only one of --check and --decode at a time.');
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) usage('--decode needs an output file.');
    opts.mode = 'decode';
    opts.out = argv[++i];
  } else if (arg.startsWith('--')) usage(`Unknown argument "${arg}".`);
  else if (opts.file) usage(`Only one input file is checked at a time. Got "${opts.file}" and "${arg}".`);
  else opts.file = arg;
}
if (!opts.file) usage('The HTML file is required.');
if (!existsSync(opts.file)) usage(`No such file: ${opts.file}.`);
if (!opts.mode) usage('One of --check and --decode is required.');

// The exact loaders the two plugins write, with the payload captured.
// The short comment after <script> is part of each.
const HEX_LOADER = /^<!doctype html><meta charset="utf-8"><script>(?:\/\*[\s\S]*?\*\/)?\(function\(\)\{var h="([0-9a-fA-F]+)",b=new Uint8Array\(h\.length\/2\),i=0,s=document\.currentScript,m=s\.previousElementSibling;for\(;i<b\.length;i\+\+\)b\[i\]=parseInt\(h\.substr\(2\*i,2\),16\);m\.remove\(\);s\.remove\(\);document\.write\(new TextDecoder\(\)\.decode\(b\)\)\}\)\(\)<\/script>\n?$/;
const HEX_OF_BASE64_LOADER = /^<!doctype html><meta charset="utf-8"><script>(?:\/\*[\s\S]*?\*\/)?\(function\(\)\{var x="([A-Za-z0-9+/=]+)",h=atob\(x\),b=new Uint8Array\(h\.length\/2\),i=0,s=document\.currentScript,m=s\.previousElementSibling;for\(;i<b\.length;i\+\+\)b\[i\]=parseInt\(h\.substr\(2\*i,2\),16\);m\.remove\(\);s\.remove\(\);document\.write\(new TextDecoder\(\)\.decode\(b\)\)\}\)\(\)<\/script>\n?$/;
const BASE64_LOADER = /^<!doctype html><meta charset="utf-8"><script>(?:\/\*[\s\S]*?\*\/)?\(function\(\)\{var x="([A-Za-z0-9+/=]+)",h=atob\(x\),b=new Uint8Array\(h\.length\),i=0,s=document\.currentScript,m=s\.previousElementSibling;for\(;i<b\.length;i\+\+\)b\[i\]=h\.charCodeAt\(i\);m\.remove\(\);s\.remove\(\);document\.write\(new TextDecoder\(\)\.decode\(b\)\)\}\)\(\)<\/script>\n?$/;
const XOR_LOADER = /^<!doctype html><meta charset="utf-8"><script>(?:\/\*[\s\S]*?\*\/)?\(function\(\)\{var s="([0-9a-f]{8})",x="([A-Za-z0-9+/=]+)",h=atob\(x\),b=new Uint8Array\(h\.length\),i=0,n=0,q=0,k=0;for\(;i<h\.length;i\+\+\)b\[i\]=h\.charCodeAt\(i\);function H\(t\)\{var e=0x811c9dc5;for\(var o=0;o<t\.length;o\+\+\)\{e\^=t\.charCodeAt\(o\);e=Math\.imul\(e,0x01000193\)>>>0\}return e>>>0\}for\(i=0;i<b\.length;n\+\+\)\{k=H\(s\+":"\+n\);for\(q=0;q<4&&i<b\.length;q\+\+,i\+\+\)b\[i\]\^=\(k>>>\(8\*q\)\)&255\}var c=document\.currentScript,m=c\.previousElementSibling;m\.remove\(\);c\.remove\(\);document\.write\(new TextDecoder\(\)\.decode\(b\)\)\}\)\(\)<\/script>\n?$/;
// FNV-1a, the same function the xor plugin and its loader use.
const fnv1a = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
};
const fail = (file) => {
  console.error(`NOT HEX: ${file} did not go through an inline plugin (it is not one loader with a valid payload). Rebuild it: keep inlineHexBase64() (default), inlineHex(), inlineBase64(), or inlineXor() last in the Vite config's plugins, run \`vite build\`, and check dist/index.html again.`);
  process.exit(1);
};

// The obfuscated loader inline-obfuscate writes carries no readable marker. Its
// only anchor is one opaque code-id string at the head of the script: a fixed
// token plus one digit for the layer. The payload (and, for xor, the seed) are
// kept as ordinary string literals; the payload is the one long literal, and the
// seed is the 8-hex literal. Keep CODE_ID and CODE_LAYER in step with the plugin.
const CODE_ID = 'q7fa2k9';
const CODE_LAYER = { '2': 'hex', '7': 'hexb64', '4': 'base64', '9': 'xor' };
const OBF_HEAD = new RegExp(`^<!doctype html><meta charset="utf-8"><script>"${CODE_ID}([2479])";`);
const xorDecode = (seedHex, b64) => {
  const bytes = Buffer.from(b64, 'base64');
  for (let i = 0; i < bytes.length; i += 4) {
    const k = fnv1a(`${seedHex}:${i / 4}`);
    for (let j = 0; j < 4 && i + j < bytes.length; j++) bytes[i + j] ^= (k >>> (8 * j)) & 255;
  }
  return bytes.toString('utf8');
};
const decodeObfuscated = (text) => {
  const head = text.match(OBF_HEAD);
  if (!head || !/<\/script>\n?$/.test(text)) return null;
  const layer = CODE_LAYER[head[1]];
  // The payload is the longest string literal in the file; the token and the seed
  // are far shorter.
  const literals = [...text.matchAll(/"([A-Za-z0-9+/=]+)"/g)].map((m) => m[1]);
  const payload = literals.reduce((a, b) => (b.length > a.length ? b : a), '');
  if (!payload) return null;
  if (layer === 'hex') return { layers: '1 layer (hex, not the default 2), loader obfuscated', raw: Buffer.from(payload, 'hex').toString('utf8') };
  if (layer === 'base64') return { layers: '1 layer (base64, not the default 2), loader obfuscated', raw: Buffer.from(payload, 'base64').toString('utf8') };
  if (layer === 'hexb64') {
    const hex = Buffer.from(payload, 'base64').toString('utf8');
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
    return { layers: 'the default 2 layers (base64 of hex), loader obfuscated', raw: Buffer.from(hex, 'hex').toString('utf8') };
  }
  // xor: the seed is the 8-hex literal whose keystream decodes to a doctype.
  for (const seed of literals.filter((s) => /^[0-9a-f]{8}$/.test(s) && s !== payload)) {
    const out = xorDecode(seed, payload);
    if (/^\s*<!doctype html/i.test(out)) return { layers: '1 layer (xor, not the default 2), loader obfuscated', raw: out };
  }
  return null;
};

const source = readFileSync(opts.file, 'utf8');
let layers = '';
let raw = '';
const obf = decodeObfuscated(source);
if (obf) { layers = obf.layers; raw = obf.raw; }
const hexMatch = layers ? null : source.match(HEX_LOADER);
const hexOfBase64Match = hexMatch ? null : source.match(HEX_OF_BASE64_LOADER);
const xorMatch = hexMatch || hexOfBase64Match ? null : source.match(XOR_LOADER);
const base64Match = hexMatch || hexOfBase64Match || xorMatch ? null : source.match(BASE64_LOADER);
if (hexMatch && hexMatch[1].length % 2 === 0) {
  layers = '1 layer (hex, not the default 2)';
  raw = Buffer.from(hexMatch[1], 'hex').toString('utf8');
} else if (hexOfBase64Match) {
  const hex = Buffer.from(hexOfBase64Match[1], 'base64').toString('utf8');
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    layers = 'the default 2 layers (base64 of hex)';
    raw = Buffer.from(hex, 'hex').toString('utf8');
  }
} else if (xorMatch) {
  layers = '1 layer (xor, not the default 2)';
  const seedHex = xorMatch[1];
  const bytes = Buffer.from(xorMatch[2], 'base64');
  for (let i = 0; i < bytes.length; i += 4) {
    const k = fnv1a(`${seedHex}:${i / 4}`);
    for (let j = 0; j < 4 && i + j < bytes.length; j++) bytes[i + j] ^= (k >>> (8 * j)) & 255;
  }
  raw = bytes.toString('utf8');
} else if (base64Match) {
  layers = '1 layer (base64, not the default 2)';
  raw = Buffer.from(base64Match[1], 'base64').toString('utf8');
}
if (!layers || !/^\s*<!doctype html/i.test(raw)) fail(opts.file);

if (opts.mode === 'check') {
  console.log(`HEX OK: ${opts.file} is one loader with ${layers}: ${Buffer.byteLength(raw)} bytes of HTML in ${Buffer.byteLength(source)} bytes of file.`);
} else {
  writeFileSync(opts.out, raw);
  console.log(`Wrote ${opts.out}: ${Buffer.byteLength(raw)} bytes of readable HTML from ${Buffer.byteLength(source)} bytes of file with ${layers}.`);
}
