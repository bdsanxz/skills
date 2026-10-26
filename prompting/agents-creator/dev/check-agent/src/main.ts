#!/usr/bin/env bun
// The entry point of scripts/check_agent.js.

import { main } from "./cli";

process.exitCode = main(process.argv.slice(2));
