import { UsageError } from "./args.ts";
import { dispatch, HELP } from "./commands.ts";
import { goalDispatch } from "./goal-commands.ts";

const CRON = ["create", "list", "show", "pause", "resume", "run-now", "delete"];

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  console.log(HELP[""]);
  process.exit(cmd ? 0 : 2);
}
let label = cmd;
try {
  if (cmd === "goal") {
    label = `goal ${rest[0] ?? ""}`.trim();
    process.exitCode = await goalDispatch(rest[0], rest.slice(1));
  } else if (cmd === "cron") {
    const sub = rest[0];
    if (!sub || sub === "--help") {
      console.log(HELP["cron"]);
      process.exit(sub ? 0 : 2);
    }
    if (!CRON.includes(sub)) throw new UsageError(`unknown cron command "${sub}"`);
    label = `cron ${sub}`;
    process.exitCode = await dispatch(sub, rest.slice(1));
  } else {
    process.exitCode = await dispatch(cmd, rest);
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof UsageError) {
    console.error(`agent-job ${label}: ${msg}\nRun \`agent-job ${label} --help\` for usage.`);
    process.exitCode = 2;
  } else {
    console.error(`agent-job ${label}: ${msg}`);
    process.exitCode = 1;
  }
}
