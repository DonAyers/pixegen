# Provider & API Key Evaluation

This document records the review of PixelGen's image-generation backend,
performed to confirm Pollinations is still the right choice and to check
whether a direct OpenAI (or Gemini) key would be more suitable or
cost-effective, plus a scan of open-source alternatives for sprite
generation.

> **⚠️ Decision revised 2026-07-12.** §2's "do not add a direct
> OpenAI/Gemini integration" was **superseded** — a provider adapter seam
> and a direct OpenAI BYOK adapter now exist (Node CLI/MCP only; the
> browser remains Pollinations-only). The original text below is kept for
> history; see the "2026-07-12 revision" subsection at the end of §2 for
> what changed and why. Pollinations remains the zero-config default.

## 1. Current Pollinations setup (reviewed)

- `POLLINATIONS_API_KEY` is read server-side in `vite.config.js` and injected
  as a `Bearer` header on the `/api/pollinations` and `/api/generate` proxy
  routes. It is **never** sent to the browser.
- The key is optional — Pollinations has a usable free tier, so the app works
  with no configuration at all.
- `src/provider-service.js` lists the models Pollinations exposes, including
  vendor models it re-sells: `gptimage` (OpenAI GPT Image 1 Mini) and
  `nanobanana` / `nanobanana-pro` (Google Gemini 2.5 Flash / Gemini 3 Pro).

No changes were needed to the Pollinations key handling itself — it was
already correct and secure (server-side only, optional).

## 2. Is a direct OpenAI (or Gemini) key more cost-effective?

**No** (as evaluated originally — but see the staleness note). Comparing
Pollinations' re-sold price to the vendor's direct price for equivalent
quality, at the time of the original review:

| Model | Via Pollinations | Direct from vendor |
|---|---|---|
| OpenAI GPT Image | `gptimage` — ~$0.008/img | DALL-E 3 direct — ~$0.04/img (5x more) |
| Gemini 2.5 Flash Image | `nanobanana` — ~$0.039/img | Direct Gemini API — ~$0.039/img (same, no savings) |
| Gemini 3 Pro Image | `nanobanana-pro` — ~$0.134/img | Direct Gemini API — ~$0.134/img (same, no savings) |

> **⚠️ Stale (confirmed 2026-07-13):** Pollinations now prices in per-token
> "pollen" credits (`promptTextTokens` / `promptImageTokens` /
> `completionImageTokens` on the live `GET /image/models` entries), not
> $/image. The table above is kept for the historical rationale only — do
> not cite these numbers as current. A fresh comparison needs the
> pollen→USD rate and per-generation token counts, neither of which the
> models endpoint exposes.

Direct OpenAI access would have cost **4-5x more per image** for comparable
output, and direct Gemini access offered no savings at all, while requiring
users to manage and pay for a second API key/account. There is no quality
advantage either — Pollinations proxies the same underlying models.

**Decision: do not add a direct OpenAI/Gemini integration.** Users who want
GPT Image or Gemini quality can already select the `gptimage` / `nanobanana`
/ `nanobanana-pro` models from the existing Pollinations-backed model list.

### Bug found and fixed during this review

The codebase previously contained **dead/broken code** for direct OpenAI and
Gemini providers:

- `vite.config.js` created `/api/openai` and `/api/gemini` proxy routes
  whenever `OPENAI_API_KEY` / `GEMINI_API_KEY` were set.
- `provider-service.js` listed `dall-e-3`, `dall-e-2`, `gemini-flash-image`,
  and `gemini-pro-image` as selectable models.
- However, `image-service.js` only ever built **Pollinations-style GET
  requests** (`/api/<provider>/<prompt>?model=...&width=...`). OpenAI's
  Images API and Gemini's `generateContent` API both require **POST with a
  JSON body** and return base64/JSON payloads, not raw image bytes from a
  GET URL. Selecting these models would have produced failed requests
  (wasted API calls/tokens) for any user who configured those keys.
- Separately, `generateImage()` (single-frame generation) ignored the
  parsed `provider` entirely and always hit the Pollinations API base — so
  even fixing the request format would not have routed correctly for a
  single-image generation call.

Since direct OpenAI/Gemini access isn't cost-effective anyway (see table
above), these broken paths were **removed** rather than fixed, to eliminate
a source of silent failures and wasted requests:

- `vite.config.js`: removed the `/api/openai` and `/api/gemini` proxy blocks
  and the key-based provider detection; Pollinations is now the only
  provider.
- `provider-service.js`: removed the `openai` and `gemini` entries from
  `PROVIDER_CONFIGS`.
- `image-service.js`: fixed `generateImage()` to resolve its API base via
  `getProviderApiBase(provider)` (matching `generateSpriteSheet()`) instead
  of a hardcoded constant, for consistency.
- `.env.example` / `README.md`: updated to explain why only
  `POLLINATIONS_API_KEY` is used.

### 2026-07-12 revision: direct OpenAI access added (properly this time)

The rejection above rested on three premises; two stopped holding:

1. **Cost table stale** — Pollinations moved to per-token "pollen" pricing
   (see `docs/Next-Phase.md` §6), so the 4-5x figure can no longer be
   cited as current.
2. **New user class** — the CLI/MCP agentic surface (Next-Phase §5) serves
   unattended pipelines whose operators typically already hold an
   `OPENAI_API_KEY` and care about availability more than per-image cost.
   Pollinations' anonymous tier returning 401 on a shared egress IP made
   the single-reseller availability risk concrete.
3. **Integration cost collapsed** — after the portable-core refactor, a
   provider is one adapter file (`src/node/providers/openai.js`)
   implementing a common contract, not logic smeared through the request
   path. The bug class documented above (selectable models that silently
   fail) is guarded against: providers without an adapter or key fail
   loudly, and the browser picker only lists providers it can actually
   call (still Pollinations-only — browser BYOK would need a per-provider
   proxy route to keep keys server-side).

What stands from the original decision: **Pollinations stays the
zero-config default**, and the broken half-integrations were still right
to delete. What's new: `openai:gpt-image-1` / `openai:gpt-image-1-mini`
via `OPENAI_API_KEY` for the CLI/MCP surfaces (verified against the live
API, including native transparent backgrounds). A Gemini adapter and an
OpenAI-compatible-base-URL adapter (local runtimes) are the natural next
candidates — see Next-Phase §10.

## 3. Other open-source AI sprite-generation projects surveyed

For teams that want a fully local/offline pipeline instead of a hosted API,
these were evaluated (existence verified, not integrated into this repo):

- **[nerijs/pixel-art-xl](https://huggingface.co/nerijs/pixel-art-xl)** — a
  popular open-source SDXL LoRA that biases Stable Diffusion output toward
  clean pixel-art style. Runs fully locally.
- **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)** /
  **[AUTOMATIC1111 stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui)**
  — open-source node-based / web UIs for running Stable Diffusion + LoRA +
  ControlNet locally; commonly used as the runtime for pixel-art-xl style
  pipelines and pose-consistent sprite sheets.
- **[Orama-Interactive/Pixelorama](https://github.com/Orama-Interactive/Pixelorama)**
  — a fully open-source (MIT), Godot-based pixel art editor with animation
  and sprite-sheet tooling; useful as a post-processing/editing companion
  rather than a generator.
- **Retro Diffusion** — a diffusion model fine-tuned specifically for
  pixel-art/sprite output; closed-source hosted product, mentioned here only
  as a point of comparison, not adopted.

**Decision: not integrated now.** These require a local GPU/runtime
(ComfyUI/A1111 + LoRA weights) that is out of scope for this
browser + Vite-proxy architecture, which targets zero local setup. They are
documented here as the natural next step if the project ever needs an
offline/self-hosted generation mode — e.g. adding a `local-comfyui` provider
that proxies to a self-hosted ComfyUI HTTP API using the same
`provider-service.js` pattern used for Pollinations today.

## 4. Efficient token/cost usage

No prompt-engineering or image-size changes were made beyond the bug fixes
above — the existing prompt builders (`buildPrompt`, `buildSheetPrompt` in
`src/image-service.js`) already front-load style tokens and keep prompts
compact, and default generation sizes (512×512 single frame, capped at
1920×512 for sheets) were left unchanged since they are the minimum useful
resolution before local pixelation/downscaling in `pixel-processor.js`.
The main efficiency win from this review is **removing the dead
openai/gemini code paths**, which previously risked wasted, failing API
calls if a user ever set those env vars.
