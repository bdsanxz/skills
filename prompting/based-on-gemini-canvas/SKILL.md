---
name: based-on-gemini-canvas
description: Deep-dive knowledge about Google Gemini Canvas for AI agents — the sandboxed single-file environment and its limits, browser features, storage, sharing, output files, and every Gemini model usable inside it with its identifier, abilities, limits, status, rate limits, errors and fallbacks. Use when an agent needs to understand Gemini Canvas or its models in depth.
---

# Based on Gemini Canvas

This skill is for an AI agent that needs to know Gemini Canvas in depth: the environment an app runs in and the
Gemini models it can call.

The facts are dated where they can change. Model facts were checked on the date at the top of
`references/gemini-models.md`; Canvas facts on the date at the top of `references/canvas-environment.md`.

## Where each topic lives

### Gemini Canvas

`references/canvas-environment.md` covers what Canvas is and what an app in it can and cannot do: the sandboxed
iframe with no backend, single-file HTML, how libraries reach the app (bundled into the file, never loaded from a
CDN, with web fonts as the one external link), browser features that may be denied, storage and the optional
saving to the user's account, sharing and privacy, output files that open elsewhere, and limits on pictures and
size.

### Gemini models

`references/gemini-models.md` covers every Gemini model usable inside Canvas: identifiers, strengths, input and
output abilities, limits, status and shutdown dates, selection-only models, the API surfaces and request shapes,
rate limits, errors, fallback between models, and the failure modes users meet. `assets/gemini-models.json` holds
the same model facts in machine-readable form.
