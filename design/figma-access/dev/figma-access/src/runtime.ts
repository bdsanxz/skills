// Imported first by main.ts: the CLI uses Bun's APIs (Bun.serve, Bun.sleep, Bun.main), so under
// Node it would crash with "Bun is not defined". Stop with an actionable message instead.
// Written without other imports so it runs before any module that touches Bun.

if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
  const script = process.argv[1] ?? "figma-access.js";
  process.stdout.write(
    `ok #false\nerror "figma-access runs on Bun, not Node. Run it as: bun ${script.replace(/["\\]/g, "\\$&")} <command>. Install Bun from https://bun.sh when it is missing."\n`,
  );
  process.exit(2);
}

export {};
