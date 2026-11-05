# Third-party notices

## Figma Desktop Bridge plugin

- Files: `assets/figma-desktop-bridge/manifest.json`, `code.js`, `ui.html`, `icon.png` (copied unchanged).
- Origin: Figma Console MCP, `figma-desktop-bridge/` directory (https://github.com/southleft/figma-console-mcp), plugin version 1.41.5.
- License: MIT, Copyright (c) 2025 Figma Console MCP Contributors. The full license text is in `assets/figma-desktop-bridge/LICENSE`.

The `figma-access` CLI is written for this skill. It speaks the same WebSocket protocol as the Figma Console MCP server, so the unmodified plugin connects to it; no code from that server is bundled.

## @bgotink/kdl

- Files: bundled into `scripts/figma-access.js` (the KDL parser and JSON-in-KDL decoder the CLI uses to read its `.kdl` files).
- Origin: https://github.com/bgotink/kdl, npm package `@bgotink/kdl` 0.4.1, with no dependencies of its own.
- License: MIT, Copyright (c) 2022- Bram Gotink.
