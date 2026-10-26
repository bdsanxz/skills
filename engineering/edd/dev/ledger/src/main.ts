#!/usr/bin/env bun
// The entry point of scripts/ledger.js.

import { main } from "./commands";

process.exitCode = main(process.argv.slice(2));
