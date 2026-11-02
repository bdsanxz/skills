# Gemini models for Canvas apps

Model facts checked on 2026-11-02 against Google's models, deprecations, and rate-limits pages, and Canvas facts against the Gemini Apps Canvas help pages. Model facts change: a shutdown date is the earliest a model may retire, never a promise of availability until then.

Contents

- [Evidence levels](#evidence-levels)
- [Choosing a model](#choosing-a-model)
- [Dated, aliased and further models](#dated-aliased-and-further-models)
- [Models that answer under the host key](#models-that-answer-under-the-host-key)
- [How apps order their attempts](#how-apps-order-their-attempts)
- [API surfaces and request shapes](#api-surfaces-and-request-shapes)
- [Rate limits and quotas](#rate-limits-and-quotas)
- [Errors, retries and fallbacks](#errors-retries-and-fallbacks)
- [Availability, keys and the model test](#availability-keys-and-the-model-test)
- [Known behaviour seen by users](#known-behaviour-seen-by-users)
- [Sources](#sources)

## Evidence levels

Three kinds of evidence appear below. A lower kind never stands in for a higher one.

| Kind | What it says |
| --- | --- |
| **Official (Google)** | Canvas apps add "Gemini-powered features ... like text and image generation" through **Add Gemini features**. The viewer signs in and is 18 or over. Google publishes **no list of models a Canvas app may call**, and describes no API behind it. |
| **Community reports, Oct 2025 to May 2026** | The code carries `const apiKey = "";` and Canvas supplies the key. The key is reported as model-scoped: other models fail with 403 `PERMISSION_DENIED` ("Method doesn't allow unregistered callers") or 401. Image generation reportedly broke and recovered several times (Jan, Feb, May 2026). No Google staff confirmation, nothing newer than May 2026, and no report at all on speech or video. |
| **Working app (2026), reported by the project owner** | One app calls `generateContent` and `predict` with an empty key and walks the chains under "Models that answer under the host key". The owner reports that it works in Canvas. This is the strongest evidence here for what the host's key accepts. |

Access can differ by account, so each generated app confirms at runtime which models answer for its viewer, and shows what it found.

## Choosing a model

Choice follows the job. This table serves a viewer's own key, and for judging what a job needs. Under the host's key, the list under "Models that answer under the host key" comes first.

| Job | Model | Modalities, limits and status | Selection guidance |
| --- | --- | --- | --- |
| Everyday text, JSON plans, vision over frames or images | `gemini-3.8-flash` | Text, images, video and audio in; text out. Google's most capable Flash. Stable, no shutdown date. | The default for almost everything. Dated previews are avoided for new work. |
| Same, at lower cost | `gemini-3.6-flash` | Text, images, video and audio in; text out. Stable previous generation. No shutdown date. | Good balance across multimodal and everyday tasks. |
| Very frequent small calls: classify, tag, describe many items | `gemini-3.5-flash-lite` | Text and images in; text out. Stable, cheapest and fastest of the 3.5 line. No shutdown date. | Chosen for high-volume lightweight work. `gemini-3.1-flash-lite` is avoided for anything long-lived (shutdown 2027-05-07). |
| Hard reasoning: long planning, difficult code or analysis over a huge context | `gemini-4-argon` | 1M context window with long decodes. Reasoning effort `thinking_level` of low, medium or high. Documented on the Interactions API. Ignores `temperature`, `top_p` and `top_k`. Stable. | Chosen only when Flash demonstrably falls short. Slower and dearer; unsuited to latency-sensitive steps or small JSON, and temperature settings have no effect on it. |
| Hard reasoning, as an explicit choice | `gemini-3.1-pro-preview` | Text and images in; text out. Preview, no shutdown date. | Appears as an explicit choice in Settings. Automatic selection avoids it, because previews can retire. |
| Transcript with word timestamps and speakers | `gemini-3.5-transcribe` | Speech in; text out, with word timestamps, speaker diarization, utterance-based language detection and vocabulary biasing. Stable, no shutdown date. Its request format is unconfirmed in this reference. | Chosen where timing matters. A text-model transcript path stays as fallback, and Canvas acceptance is unconfirmed. |
| Image generation and editing, default | `gemini-nano-banana-2.1` | Text and images in; images out. Quality, typography and multi-turn consistency. Stable, no shutdown date. | Google's recommended image model. |
| Production-scale image generation | `gemini-3.1-flash-image` (Nano Banana 2) | Text and images in; images out. Speed for production-scale visual creation. Stable, no shutdown date. | Chosen for fast production output. Google recommends moving new work to `gemini-nano-banana-2.1`. |
| Many quick images, interactive use | `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) | Text and images in; images out. Lowest latency and cost. Stable, no shutdown date. | Chosen for bulk and interactive use. |
| Highest-quality images, contextual, text-heavy | `gemini-3-pro-image` (Nano Banana Pro) | Text and images in; images out. Studio-quality 4K visuals, complex layouts, precise text rendering. Stable, no shutdown date. | Chosen for hero assets, not bulk. |
| Fast creative image workflows, dated | `gemini-2.5-flash-image` (Nano Banana) | Text and images in; images out. Stable, shutdown 2027-03-15, replacement `gemini-3.1-flash-lite-image`. | Still served, with restricted access for new projects on the public API (not deprecated). New work prefers the 3.1 image line. |
| Image generation, dated | `imagen-4.0-generate-001`, `imagen-3.0-generate-002` | Text in; images out through the `predict` call. Both shut down on the public API (2026-08-17 and 2025-11-10); replacement `gemini-nano-banana-2.1`. | Retired on the public API. Host-key chains still list them (see below), where the host's allow-list governs instead. |
| Speech, narration, characters | `gemini-3.8-flash-tts` | Text in; audio out. Studio-grade voice fidelity, expressive delivery, voice design and replication, across 130 languages. Stable, no shutdown date. | The default voice model. |
| Speech at volume | `gemini-3.8-flash-lite-tts` | Text in; audio out. Fast and cheap across 101 languages, with voice replication. Stable, no shutdown date. | Chosen for high-volume production and real-time cascades. |
| Speech, dated previews | `gemini-2.5-flash-preview-tts`, `gemini-3.1-flash-tts-preview`, `gemini-2.5-pro-preview-tts` | Text in; audio out. All three carry shutdown 2026-11-17; replacements `gemini-3.8-flash-tts` or `gemini-3.8-flash-lite-tts`. | Retiring. New work uses the 3.8 TTS line. |
| Generated video clips | `gemini-omni-1.1-flash` (Gemini Omni Flash) | Text and images in; video with native audio out. Fast generation, editing, keyframe interpolation and extension. Stable, no shutdown date. | Chosen for generated clips. All Veo models are shut down. No Canvas evidence at all exists for it, and browser-rendered video, which needs no model and no quota, is preferred wherever it suffices. |
| Generated video, dated (Veo family) | `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview`, `veo-3.0-generate-001`, `veo-3.0-fast-generate-001`, `veo-2.0-generate-001` | Text and images in; video out. Shutdown 2026-10-22 for the 3.1 previews and 2026-06-30 for the 3.0 and 2.0 models; replacement `gemini-omni-1.1-flash`. | Retired. |
| Generated music | `lyria-3.5` | Text in; music out. Full-length songs with structural coherence. Stable, no shutdown date. | The default music model. No Canvas evidence exists for it. |
| Live voice conversation | `gemini-3.8-live`; `gemini-3.8-live-extended-thinking` when more reasoning justifies the delay | Audio and video in; audio out, with sub-second streaming. Stable, no shutdown dates. | Chosen for low-latency voice. A streaming connection is required. No Canvas evidence exists for either. |
| Live speech-to-speech translation | `gemini-3.5-live-translate-preview` | Speech in; speech out across 70+ languages. Preview, no shutdown date. | The newest live option. No Canvas evidence exists for it. |
| Live and speech, dated previews | `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-preview-12-2025` | Audio in; audio out. Both carry shutdown 2026-11-17; replacement `gemini-3.8-live`. | Legacy previews. |
| Search and similarity | `gemini-embedding-2` | Text, images, video, audio and PDFs in; vectors out. Stable and multimodal. No shutdown date. | The default embedding model. |

Some jobs need no model at all: the browser draws charts, renders video, mixes audio, and searches small lists on its own, with no quota and no model to refuse or fail.

## Dated, aliased and further models

Every model below also appears in `assets/gemini-models.json`. Models with a shutdown date in the past are retired on the public API; the host key has its own allow-list, so a retired model can still appear in the host-key chains in the next section.

| Model | Job | Status | Shutdown | Replacement | Note |
| --- | --- | --- | --- | --- | --- |
| `gemini-3.7-flash` | text | alias of `gemini-3.8-flash` | — | `gemini-3.8-flash` | Requests route to `gemini-3.8-flash` automatically. |
| `gemini-3.5-flash` | text | alias of `gemini-3.6-flash` | — | `gemini-3.6-flash` | Requests route to `gemini-3.6-flash` automatically. In the host-key text chain. |
| `gemini-3-pro-preview` | text-reasoning | preview, shut down | 2026-03-09 | `gemini-3.1-pro-preview` | Retired. |
| `gemini-3.1-flash-lite` | text-volume | stable | 2027-05-07 | `gemini-3.5-flash-lite` | Avoided for long-lived work. |
| `gemini-3.1-flash-lite-preview` | text-volume | preview, shut down | 2026-05-25 | `gemini-3.1-flash-lite` | Retired. |
| `gemini-2.5-pro` | text-reasoning | stable | — | — | Restricted to past users on the public API; not deprecated. |
| `gemini-2.5-flash` | text | stable | — | — | Restricted to past users on the public API; not deprecated. In the host-key text chain. |
| `gemini-2.5-flash-lite` | text-volume | stable | — | — | Restricted to past users on the public API; not deprecated. |
| `gemini-2.5-flash-preview-05-20` | text | preview, shut down | 2025-11-18 | `gemini-3.6-flash` | Retired. |
| `gemini-2.5-flash-preview-09-25` | text | preview, shut down | 2026-02-17 | `gemini-3.6-flash` | Google's spelling; Canvas apps use `-09-2025`, which carries the same date. |
| `gemini-2.5-flash-lite-preview-09-2025` | text-volume | preview, shut down | 2026-03-31 | `gemini-3.1-flash-lite` | Retired. |
| `gemini-2.0-flash` | text | stable, shut down | 2026-06-01 | `gemini-3.6-flash` | Retired. |
| `gemini-2.0-flash-lite` | text-volume | stable, shut down | 2026-06-01 | `gemini-3.1-flash-lite` | Retired. |
| `gemini-3.1-flash-image-preview` | image | preview, shut down | 2026-06-25 | `gemini-nano-banana-2.1` | Retired. |
| `gemini-3-pro-image-preview` | image-quality | preview, shut down | 2026-06-25 | `gemini-3-pro-image` | Retired. |
| `gemini-2.0-flash-preview-image-generation` | image | preview, shut down | 2025-11-14 | `gemini-nano-banana-2.1` | Retired. |
| `imagen-4.0-generate-001` | image | stable, shut down | 2026-08-17 | `gemini-nano-banana-2.1` | Retired on the public API. In the host-key image chain. |
| `imagen-3.0-generate-002` | image | stable, shut down | 2025-11-10 | `gemini-nano-banana-2.1` | Retired on the public API. In the host-key image chain. |
| `imagen-4.0-ultra-generate-001` | image-quality | stable, shut down | 2026-08-17 | `gemini-nano-banana-2.1` | Retired. |
| `imagen-4.0-fast-generate-001` | image-volume | stable, shut down | 2026-08-17 | `gemini-nano-banana-2.1` | Retired. |
| `gemini-3.5-transcribe-live` | transcription-live | stable | — | — | Live speech-to-text companion to `gemini-3.5-transcribe`. |
| `gemini-omni-flash-preview` | video | preview, shut down | 2026-10-22 | `gemini-omni-1.1-flash` | Retired. |
| `veo-3.1-generate-preview` | video | preview, shut down | 2026-10-22 | `gemini-omni-1.1-flash` | Retired. |
| `veo-3.1-fast-generate-preview` | video | preview, shut down | 2026-10-22 | `gemini-omni-1.1-flash` | Retired. |
| `veo-3.1-lite-generate-preview` | video | preview, shut down | 2026-10-22 | `gemini-omni-1.1-flash` | Retired. |
| `veo-3.0-generate-001` | video | stable, shut down | 2026-06-30 | `gemini-omni-1.1-flash` | Retired. |
| `veo-3.0-fast-generate-001` | video | stable, shut down | 2026-06-30 | `gemini-omni-1.1-flash` | Retired. |
| `veo-2.0-generate-001` | video | stable, shut down | 2026-06-30 | `gemini-omni-1.1-flash` | Retired. |
| `gemini-3.1-flash-live-preview` | live | preview | 2026-11-17 | `gemini-3.8-live` | Legacy preview. |
| `gemini-2.5-flash-native-audio-preview-12-2025` | live | preview | 2026-11-17 | `gemini-3.8-live` | Legacy preview. |
| `lyria-3-clip-preview` | music | preview | — | — | Short clips, loops and previews up to 30 seconds. |
| `lyria-3-pro-preview` | music | preview | — | `lyria-3.5` | Previous generation. |
| `lyria-realtime-exp` | music | preview | — | — | Real-time streaming generation with granular control. |
| `gemini-embedding-001` | embedding | stable | 2028-05-14 | `gemini-embedding-2` | Legacy embedding model. |

Google limits access to the 2.5 models to users who have actively used them in the past. The 2.5 text models are not deprecated and stay served until further notice; `gemini-2.5-flash-image` is not deprecated either but carries an earliest shutdown of 2027-03-15. New projects use 3.5 Flash-Lite or 3.8 Flash (Official, models page).

## Models that answer under the host key

The project owner reports that a reference app, which tries exactly these models, works in the Canvas environment. This list comes first under the host's key, in this order, even where Google's public pages call a model retired or do not list it: the host's key has its own allow-list, so public status does not decide what it accepts. A fallback chain shows the set that was tried, never which entry answered for a given account, so the model test still reports what happens for each viewer.

| Job | Order | Model | Call | Status on Google's public pages |
| --- | --- | --- | --- | --- |
| Text | 1 | `gemini-3-flash-preview` | `generateContent` | Preview, no shutdown date |
| Text | 2 | `gemini-3-flash` | `generateContent` | Not listed |
| Text | 3 | `gemini-2.5-flash-preview-09-2025` | `generateContent` | Retired 2026-02-17 |
| Text | 4 | `gemini-3.8-flash` | `generateContent` | Stable |
| Text | 5 | `gemini-3.6-flash` | `generateContent` | Stable |
| Text | 6 | `gemini-3.5-flash` | `generateContent` | Alias of `gemini-3.6-flash` |
| Text | 7 | `gemini-flash-latest` | `generateContent` | Not listed |
| Text | 8 | `gemini-2.5-flash` | `generateContent` | Stable |
| Text | 9 | `gemini-3.5-flash-lite` | `generateContent` | Stable |
| Text | 10 | `gemini-3-flash-lite` | `generateContent` | Not listed |
| Text | 11 | `gemini-flash-lite-latest` | `generateContent` | Not listed |
| Text, picked by hand only | - | `gemini-3.1-pro-preview` | `generateContent` | Preview, no shutdown date |
| Image | 1 | `imagen-4.0-generate-001` | `predict` | Retired 2026-08-17 |
| Image | 2 | `gemini-2.5-flash-image-preview` | `generateContent` | Retired 2026-01-15 |
| Image | 3 | `gemini-2.5-flash-image` | `generateContent` | Stable, earliest shutdown 2027-03-15 |
| Image | 4 | `imagen-3.0-generate-002` | `predict` | Retired 2025-11-10 |
| Speech | 1 | `gemini-2.5-flash-preview-tts` | `generateContent` | Earliest shutdown 2026-11-17 |
| Speech | 2 | `gemini-3.1-flash-tts-preview` | `generateContent` | Earliest shutdown 2026-11-17 |
| Speech | 3 | `gemini-3.8-flash-tts` | `generateContent` | Stable |
| Speech | 4 | `gemini-2.5-pro-preview-tts` | `generateContent` | Earliest shutdown 2026-11-17 |

The reference app's model picker describes its automatic mode as working for all accounts, and describes `gemini-3.8-flash` and `gemini-3.1-pro-preview` as needing an account plan that supports them. The automatic chain therefore stays the default, with the hand-picked models offered in Settings.

## How apps order their attempts

Every AI job has one ordered list. Apps that rely on AI commonly try models in this order: the model picked in Settings first, then the last model that answered in the session, then the job's chain, with duplicates removed. Every request carries a timeout, and waiting stays cancellable.

Under the host's empty key, the job's chain is the list above, unchanged and in order. A model the app's author chose that is missing from the list joins the end of the chain; for speech, `gemini-3.8-flash-lite-tts` may join the end as well. Jobs the app does not have leave their lists out.

With the viewer's own key, the "Choosing a model" table applies directly. Public status governs there, so retired and unlisted entries fall away.

## API surfaces and request shapes

The shapes below serve for answering model questions and for judging returned code.

| Surface | Shape | Evidence |
| --- | --- | --- |
| `POST /v1beta/models/{model}:generateContent` | `generationConfig` with `responseMimeType`, `responseSchema`, `responseModalities`, `speechConfig`, `thinkingConfig` | What the working Canvas app and the community reports use. Search results call it legacy but supported; Google's model pages do not say. |
| `POST /v1beta/models/{imagen model}:predict` | `{ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio } }` | What the working Canvas app uses for its two Imagen entries, and for nothing else. |
| `POST /v1beta/interactions` | `{ model, input, response_format, generation_config }` | What Google's docs now show for `gemini-4-argon`, image, speech, video, and structured output. **No evidence exists that the Canvas key accepts it.** |

Base URL: `https://generativelanguage.googleapis.com`.

Request shapes under the host's key, as the working app sends them:

- **Text:** `{ contents: [{ role: "user", parts }], systemInstruction: { parts: [{ text }] }, generationConfig }`. For JSON, `generationConfig` carries `responseMimeType: "application/json"` and `responseSchema`, whose types are uppercase, such as `"OBJECT"` and `"STRING"`. The reply text is the `text` of `candidates[0].content.parts`, joined, skipping parts marked `thought`.
- **Image, `generateContent`:** one text part that states the aspect ratio in words, with `generationConfig: { responseModalities: ["TEXT", "IMAGE"] }`. The picture is the part with `inlineData`: `data` is base64, and `mimeType` defaults to `image/png`.
- **Image, `predict`:** the shape in the table. The picture is `predictions[0].bytesBase64Encoded`, with `predictions[0].mimeType`, defaulting to `image/png`.
- **Speech:** one text part, with the delivery described in words, and `generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } }`. The audio is the part with `inlineData.data`. Where its `mimeType` names WAV, MP3, or OGG, it decodes as that file. Where it names L16 or PCM, it is raw 16-bit little-endian mono at the `rate=` in that `mimeType`, or 24000 Hz where none is given, and it needs an `AudioBuffer` or a WAV header before it plays.
- **Thinking, only on fast or latency-sensitive calls:** `gemini-3*` takes `thinkingConfig: { thinkingLevel }` with `"low"`, or `"minimal"` on non-Pro models for the quickest calls. Non-Pro `gemini-2.5*` takes `thinkingBudget`, 128 for the quickest calls and otherwise 512. Other models get no `thinkingConfig`.
- **Temperature:** on `gemini-3*`, any value of 0.5 or more is sent as 1.

Documented Interactions details, for answering questions and judging returned code:

- **Structured output:** `response_format: { type: "text", mime_type: "application/json", schema: {...} }`.
- **Image:** `{ model: "gemini-nano-banana-2.1", input: [{ type: "text", text }] }`; image input objects carry `data` (base64) and `mime_type`; `response_format` may set `type: "image"`, `aspect_ratio`, and `image_size`.
- **Speech:** `input: [{ type: "user_input", content: [{ type: "text", text }] }]`, `response_format: { type: "audio" }`, `generation_config: { speech_config: [{ voice: "Kore" }] }`. Multi-speaker takes `{ speakers: [{ speaker, voice }] }`. A normal reply is `audio/wav` at 24 kHz, mono, 16-bit; streaming gives headerless PCM. Audio arrives in `steps[].content[].data`.
- **Video:** `{ model: "gemini-omni-1.1-flash", input }`, `response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p" }`; the reply holds base64 MP4 in the `model_output` step.

Under the host's key a working app uses `generateContent`, or `predict` for Imagen. With a viewer's key it tries Interactions first. Request shapes beyond these come from each model's documentation page.

## Rate limits and quotas

Google measures limits across three dimensions: requests per minute, input tokens per minute, and requests per day. Traffic against any one of them returns an error once its limit is passed (Official, rate-limits page).

Limits apply per project, never per API key. Daily quotas reset at midnight Pacific time (Official).

Image-capable models additionally meter images per minute, and some models meter tokens per day. Grounding with Google Search on Gemini 3 and newer models defaults to 1,500 requests per day per project (Official).

Preview and experimental models carry tighter limits than stable ones (Official).

Spend-based limits run on a rolling 10-minute window per usage tier, rising as spend and usage history grow. Breaching them returns `429 RESOURCE_EXHAUSTED` (Official).

Active limits for a project appear in AI Studio. Stated limits are never guaranteed; actual capacity varies with tier and account standing (Official).

No published quota exists for the host key inside Canvas. Apps therefore surface refusals at runtime through the model test and the fallback behaviour below.

## Errors, retries and fallbacks

Observed behaviour of the reference app when models refuse, fail, or reply badly. Problem reports describe what the viewer saw; the mapping below is how those symptoms are judged.

- **Moving on:** a 403 under the host's key, a 404, and other refusals move to the next model at once. A 401 or a message about the API key, with a viewer's key, stops and asks the viewer to check that key. A 402 or a message about billing or credits stops, says the usage limit is reached, and offers continuing without AI.
- **Waiting:** a 429 or a 5xx retries after 1.5 seconds. Text retries once; image and speech retry up to twice with the wait doubling. Then the app moves on. A 504 on text moves on at once. A network failure retries after about 0.8 seconds, and on text it then stops and names the connection.
- **Adapting to a 400 on text:** where the message mentions thinking, the app steps down from `minimal` to `low`, then drops `thinkingConfig`. Where it mentions `maxOutputTokens`, it drops that. Where the schema uses `maxItems`, it retries once without it. Each change is remembered for that model during the session. A 400 about too many states, the schema, or a constraint stops and reports the request as too complex.
- **Bad replies:** an empty reply or broken JSON retries once. A reply cut off at `MAX_TOKENS` may lend its complete part, but only where the job accepts a partial result, and the app validates it first. The on-screen error stays one sentence, and the model test and the console show the `finishReason` or `blockReason`.
- **After a model already answered:** once a model has answered in this session, a timeout, busy signal, empty reply, or broken reply reports the error instead of walking the rest of the chain.
- **Nothing answering at all:** where the host's key is refused by every model and none has answered, the app says AI needs the app to be opened through its Canvas link, and offers continuing without AI.
- **Whole-chain failure:** where a whole chain fails, that feature names itself as unavailable with Retry, and everything else keeps working.

## Availability, keys and the model test

- **Availability:** in an iframe with no key, the app reports AI as host-provided. With a key, it is the viewer's. Outside a host and with no key, AI is unavailable, and the app says so.
- **Key handling:** with no key, the request URL ends in `?key=` and no key header is sent. With a key, the key travels in the `x-goog-api-key` header. A key is never written into the code, because a shared app exposes its code, and the single file yields it without effort. It stays in the viewer's own `localStorage`, or in memory for the session where storage is denied.
- **Model test:** a Settings control sends the smallest request to each chain entry and shows each model as working or with its exact status and message. Results are never guessed.

## Known behaviour seen by users

AI features in working apps show these behaviours:

- **AI availability is visible:** the app shows whether AI comes from Canvas or from the viewer's own key. Outside Canvas with no key, the app names AI as unavailable, and the rest of the app stays usable.
- **A personal key stays on the device:** the viewer may use their own key. It stays on their device for them alone, and is never written into the app, because a shared app exposes its code.
- **The AI is testable:** a Settings control shows which models answer for the viewer's account and what each one said where it did not, and the viewer may pick a preferred model.
- **A result arrives wherever any model can give it:** a model that is unavailable to the viewer never stops the rest of the chain.
- **A short outage sorts itself out:** retries bridge brief failures, and waiting stays cancellable.
- **Stops carry reasons the viewer can act on,** in plain words: the key is wrong, the allowance is used up, the connection is down, or the request is too complex. Work continues without AI wherever that makes sense.
- **A demo mode** gives believable sample results for every AI feature, including a forced failure, so the viewer can try everything with no allowance and no working model.
- **Where AI cannot help at all,** that feature names itself as unavailable, with Retry, and everything else keeps working.

## Sources

- [Gemini Canvas help](https://support.google.com/gemini/answer/16047321), re-verified 2026-11-02
- [Canvas app safety](https://support.google.com/gemini/answer/16419134)
- [Models](https://ai.google.dev/gemini-api/docs/models), re-verified 2026-11-02
- [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations), re-verified 2026-11-02 (last updated 2026-10-22)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), verified 2026-11-02
- [Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/latest-model)
- [Image generation](https://ai.google.dev/gemini-api/docs/image-generation),
  [Speech](https://ai.google.dev/gemini-api/docs/speech-generation),
  [Omni video](https://ai.google.dev/gemini-api/docs/omni),
  [Structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- Community: forum threads
  [116119](https://discuss.ai.google.dev/t/canvas-internal-api-key-returns-403-with-other-models-what-happens-after-gemini-2-5-flash-preview-09-25-shutdown/116119),
  [107443](https://discuss.ai.google.dev/t/why-do-gemini-canvas-api-calls-function-with-gemini-2-5-flash-preview-05-20-but-not-the-documented-09-2025-model/107443),
  [115999](https://discuss.ai.google.dev/t/app-made-inside-gemini-canvas-now-show-error-eg-image-generation-app/115999);
  [a third-party troubleshooting guide](https://github.com/pranrichh/gemini-canvas-proxy/blob/main/docs/troubleshooting.md).
  That project routes Canvas credentials outside Canvas, and its own guide warns this may breach
  Google's terms. It serves as evidence only.
