#!/usr/bin/env bun
// The entry point of scripts/taskgraph.js.

import { main } from "./commands";

process.exitCode = main(process.argv.slice(2));
