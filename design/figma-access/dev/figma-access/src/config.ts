import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const VERSION = "1.0.0";

// The plugin scans exactly 9223-9232. The overrides exist only so tests can run beside a real plugin.
export const PORT_START = Number(process.env.FIGMA_ACCESS_PORT_START) || 9223;
export const PORT_END = Number(process.env.FIGMA_ACCESS_PORT_END) || 9232;

export const HOME = process.env.FIGMA_ACCESS_HOME || join(homedir(), ".figma-access");
export const STATE_FILE = join(HOME, "daemon.json");
export const LOG_FILE = join(HOME, "daemon.log");
export const PLUGIN_DIR = join(HOME, "plugin");

// The built file runs as <skill>/scripts/figma-access.js, so the skill is one level up.
export const ENTRY = Bun.main;
export const SKILL_DIR = resolve(dirname(ENTRY), "..");
export const BUNDLED_PLUGIN_DIR = join(SKILL_DIR, "assets", "figma-desktop-bridge");
export const PLUGIN_FILES = ["manifest.json", "code.js", "ui.html", "icon.png"];

export const LOG_BUFFER = 2000;
export const CHANGE_BUFFER = 500;

export const EXIT_OK = 0;
export const EXIT_FAILED = 1; // command ran, Figma reported a failure
export const EXIT_USAGE = 2; // bad arguments
export const EXIT_UNAVAILABLE = 3; // daemon or plugin not reachable
