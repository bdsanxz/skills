#!/usr/bin/env bun
// The entry point of scripts/roster.js.

import { main } from "./commands";

process.exitCode = await main(process.argv.slice(2));
