// Copy the extension's source into the peers CLI, which embeds it and prints it with
// `peers pi-extension`. The CLI is its own repository, by default a sibling of the skills
// repository (../peers from its root); PEERS_REPO names another checkout. With --check, only
// report whether the two copies differ (exit 1).
// Run: bun run sync (in dev/peers-pi), then rebuild peers.

import fs from "node:fs";
import path from "node:path";

const src = path.join(import.meta.dir, "src", "index.ts");
const repo = process.env.PEERS_REPO || path.resolve(import.meta.dir, "..", "..", "..", "..", "..", "peers");
const dst = path.join(repo, "src", "pi_extension.ts");
if (!fs.existsSync(path.dirname(dst))) {
  console.error(`sync: no peers source at ${path.dirname(dst)}; set PEERS_REPO to the peers repository`);
  process.exit(2);
}
const same = fs.existsSync(dst) && fs.readFileSync(dst, "utf8") === fs.readFileSync(src, "utf8");
if (process.argv.includes("--check")) {
  console.log(same ? `in sync: ${dst}` : `out of sync: ${dst} differs from ${src}; run bun run sync`);
  process.exit(same ? 0 : 1);
}
fs.copyFileSync(src, dst);
console.log(`copied ${src} -> ${dst}; rebuild peers (cargo build --release in ${path.dirname(path.dirname(dst))})`);
