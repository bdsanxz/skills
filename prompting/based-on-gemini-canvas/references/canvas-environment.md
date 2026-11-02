# The Canvas environment

Facts about Google Gemini Canvas that generated apps rely on: the sandbox, the single file, libraries, browser features, storage, sharing, output files, pictures, and the limits of current knowledge.

Contents

- [What Canvas is](#what-canvas-is)
- [The sandbox and the iframe](#the-sandbox-and-the-iframe)
- [The single HTML file](#the-single-html-file)
- [Libraries and external loading](#libraries-and-external-loading)
- [Browser feature support](#browser-feature-support)
- [Storage on the device](#storage-on-the-device)
- [Optional saving to the user's account](#optional-saving-to-the-users-account)
- [Sharing and privacy](#sharing-and-privacy)
- [Trustworthy output files](#trustworthy-output-files)
- [Pictures and assets](#pictures-and-assets)
- [Known constraints and unknowns](#known-constraints-and-unknowns)

Facts checked on 2026-11-02 against Google's Gemini Apps Canvas help pages. "Official" means Google's help pages. "Tested" means proved on a real export or a real request. All other statements are untested in Canvas itself.

## What Canvas is

A Canvas app is a browser page that runs in a sandboxed iframe. It has no backend under the author's control, and no build step runs inside the page: any bundling happens before the code reaches Canvas.

Canvas describes no access to an author's local files or repository (Official: the help pages list no such access).

The viewer signs in to Gemini Apps to create or edit. Gemini-powered features — text and image generation added through Add Gemini features — require the viewer to be 18 or over (Official).

Changes are auto-saved (Official). The Canvas panel shows the code behind the preview, console errors and logs from the preview, and recent changes to the code (Official).

## The sandbox and the iframe

The sandbox withholds some browser capabilities, and the exact set varies by viewer and session. Each capability an app depends on gets a live check in the target setting.

Canvas credentials stay inside Canvas. A third-party troubleshooting guide that routes those credentials through an outside proxy warns in its own text that doing so may breach Google's terms; that project serves as evidence only.

Secrets stay out of the file, and scrambling the code gives no protection: a shared app exposes its code, and the single file yields it without effort.

## The single HTML file

A Canvas app is one HTML file. No published size limit exists for it: a file of about 800 KB is known in the wild, and the true ceiling is unknown (absent from the help pages).

How the page's content security policy treats any given load is untested.

## Libraries and external loading

Every library an app uses is installed from npm and bundled into the one file. Nothing loads from a CDN at runtime.

A file that points at a script or stylesheet on the web is not self-contained. Apart from the web-font link below, an app never depends on a runtime load from the web.

The one allowed external link is a web-font stylesheet from `fonts.googleapis.com` or `api.fontshare.com`, together with the font files that stylesheet references (Google Fonts serves them from `fonts.gstatic.com`).

## Browser feature support

`localStorage`, IndexedDB, clipboard access, popups, downloads, and wake lock are each subject to denial in the sandbox. Denial of storage was reproduced in a sandboxed iframe, so each of these gets a live check before an app depends on it.

Camera and microphone requests call for caution (Official).

Where downloads are blocked, generated files still reach the viewer through a visible link and an in-page player.

## Storage on the device

Apps keep data on the viewer's device with web storage where the sandbox allows it, or with a project file the viewer saves and later reopens.

## Optional saving to the user's account

An app whose data needs to survive across sessions or devices can use a Firestore database. The database is optional, and the author's own storage is equally accepted (Official).

The host provides three runtime values — `__firebase_config`, `__initial_auth_token`, and `__app_id` — and records live under `artifacts/{appId}/users/{uid}/{collection}`. The database client is a bundled library like any other; only the three values arrive from the host.

Each viewer's data stays under their own `uid`. Data shared between viewers is public to anyone with the link.

Products that offer this saving work fully without an account. Where the saving is missing or broken, saving on the device continues, and the app shows that account saving is unavailable.

## Sharing and privacy

A shared link opens only at gemini.google.com, never in the Gemini mobile app (Official). Share links carry the `g.co/gemini/share` address.

Anyone with the link can view and edit the data the app shares between viewers, and can copy the app and keep editing the copy (Official).

Data shared between viewers is public. Data kept to one viewer stays private to that viewer (Official).

Sharing an app shows review information: that viewers share data with each other, that the app uses Gemini-powered features, and that it saves data across sessions and devices (Official).

Sensitive or private information stays out of an app (Official).

## Trustworthy output files

The principle behind every kind below: a file is complete only after the app re-reads it and proves it works, and its name and type tell the truth about its contents.

### Video

A trustworthy video file is an MP4 container with H.264 video (8-bit 4:2:0, even width and height, constant frame rate) and AAC-LC audio at 48 kHz, with timestamps starting at 0 and metadata placed before the media data. Opus audio never sits in MP4, and a WebM file never takes the `.mp4` name.

A Chrome export to this specification showed H.264 High profile, `yuv420p`, AAC-LC, zero start times, top-level boxes `ftyp`, `moov`, `mdat`, and a clean `ffmpeg` decode (Tested). Playback in QuickTime, Windows Media Player, VLC, and phone galleries is untested, as is generation in Canvas itself.

Short exports cut off in a background tab, odd dimensions, and timestamps away from zero are the defects this specification guards against.

A common check for these facts:

```bash
ffprobe -v error -show_entries format=format_name,duration,start_time:stream=codec_name,profile,pix_fmt,width,height,avg_frame_rate,sample_rate,channels,start_time,duration -of compact "FILE.mp4"
```

Where the browser cannot produce such a file, the app says so before a long render, and names what it can produce with the limits of that fallback.

### Audio

Saved audio opens in common players under a truthful name and type. A file is finished only after the app plays it back and confirms its length, and generated speech is checked for real sound before it is offered.

### Images

A saved picture opens anywhere as a normal image. An app that cannot produce the file says so, and never hands over a blank one. A file is finished only after the app reopens it and confirms its size.

### Documents and data

A spreadsheet file opens with every character intact and a single header row. Any other saved document reopens correctly, or the app reports that it could not verify it. A project file reopens in the app, and a wrong or newer one is refused with a reason.

## Pictures and assets

Real pictures reach an app by one of three routes: a CORS-enabled URL, generation with an image model held as a Blob, or art rendered in code.

Large inline-encoded pictures stay out of the code: the single file already carries the whole app, so embedded picture data inflates it disproportionately.

A host that blocks hotlinking leaves the picture blank in the app, so the next route in the list takes its place. An app with no AI features has only the URL and in-code routes.

## Known constraints and unknowns

| Constraint | Evidence |
| --- | --- |
| No published ceiling on file size; about 800 KB observed | Absent from the help pages; observed in the wild |
| Content security policy behaviour for any given load | Untested |
| Availability of storage, clipboard, popups, downloads, and wake lock | Varies by setting; storage denial reproduced in a sandbox |
| Video playback outside Chrome, and generation in Canvas | Untested |
| Credentials used outside Canvas | Third-party guide warns of a terms breach |
| Which models a host key accepts | Community and working-app reports; see [gemini-models.md](gemini-models.md) |
