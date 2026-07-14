# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # Start Vite dev server at http://localhost:5173 (proxies /api/pollinations to gen.pollinations.ai)
npm run build        # Production build
npm run preview      # Preview production build
npm test             # Run all Playwright tests (auto-starts dev server per playwright.config.js)
npm run test:ui       # Playwright UI mode
npm run test:debug    # Playwright debug mode
npx playwright test tests/ui.spec.js                       # Run a single test file
npx playwright test tests/ui.spec.js -g "should generate and display"  # Run a single test by name

node bin/pixegen.js generate "a knight" --recipe nes-classic -o out.png  # Headless CLI generation
node bin/pixegen.js generate "a knight" --model openai:gpt-image-1 -o out.png  # BYOK via OPENAI_API_KEY
node bin/pixegen.js generate "a knight" --tier best -o out.png  # Auto model resolution (auto|auto:draft|auto:standard|auto:best)
node bin/pixegen.js recipes|palettes|scales|models          # List registries (no network)
node bin/pixegen.js models --live                           # Sync the model catalog from Pollinations (1h disk cache)
node bin/pixegen.js sheet "a knight" --anim walk -o ./out/  # Sprite sheet + Phaser atlas
node bin/pixegen.js sheet "a knight" --anim walk --format aseprite,godot,love2d,unity -o ./out/  # Other engine metadata formats
node bin/pixegen.js tileset "desert ruins" --cols 4 --rows 4 -o ./out/
node bin/pixegen.js eval status                             # Ideal-settings knowledge base state
node bin/pixegen.js eval run --target nes --challenger '{"dithering":"bayer"}'  # Champion-vs-challenger trial
node bin/pixegen.js eval record <trialId> --winner b --notes "why"  # Judge it (look at the PNGs first)
node bin/pixegen-mcp.js                                     # MCP server over stdio
```

There is no lint or typecheck script configured.

For headless smoke tests without hitting the real API, set `PIXEGEN_API_BASE` to a local mock HTTP server that returns a PNG for any GET (honoring the `width`/`height` query params). The **live** API serves JPEG for non-transparent models (the Node adapters decode both via `decodeImage` in `src/node/png.js`) and its latency varies wildly (1s to 9+ min for the same endpoint) — `PIXEGEN_TIMEOUT_MS` raises the 120s default. The CLI does not auto-load `.env`; `source .env` first for keyed live runs.

**Debugging failed generations**: every run (CLI, MCP, and dev-server-proxied browser requests) writes structured JSONL to `logs/pixegen-<date>.jsonl` via `src/node/run-log.js` — one line per event (`start`/`request`/`response`/`validation`/`error`/`end`), grouped by a `run` id; error responses include the upstream body. CLI/MCP error messages cite the file and run id. `PIXEGEN_LOG_DIR` moves it, `PIXEGEN_LOG=0` disables. Browser-side, the Inspector tab shows the last request's outcome (status, duration, structured error). The dev proxy answers proxy failures with a 502 JSON envelope — if the browser ever sees `ERR_EMPTY_RESPONSE` again, that's a regression.

## Architecture

### Portable core + three consumers (browser UI, CLI, MCP)

The pipeline math lives in **`src/core/`** — pure ES modules operating on plain `{ data: Uint8ClampedArray, width, height }` "rasters" (structurally compatible with browser `ImageData`), with **no DOM, canvas, or Node APIs**. Everything else is an adapter:

- **Browser**: `pixel-processor.js`, `image-service.js`, `image-preprocessor.js`, `provider-service.js` wrap the core with canvas decode/encode, the Vite proxy fetch path, and the DOM-coupled RgbQuant `classic` quantizer (browser-only; core supports `enhanced`/`bitreduce`/`none`).
- **Node** (`src/node/`): `png.js` (pngjs PNG↔raster), `providers/` (one adapter per provider behind a common contract — `pollinations.js` calls `gen.pollinations.ai/image` directly with `POLLINATIONS_API_KEY` from env, `openai.js` is BYOK via `OPENAI_API_KEY`; `PIXEGEN_API_BASE`/`OPENAI_BASE_URL` override base URLs for mock testing), `generate.js` (orchestration + validation gate + retry, with per-provider batch geometry via each adapter's `maxUnitsPerAxis`).
- **Entry points**: `bin/pixegen.js` (CLI, zero-dep `node:util` parseArgs) and `bin/pixegen-mcp.js` (MCP stdio server via `@modelcontextprotocol/sdk` + zod; **never write to stdout there — it's the protocol channel**, log to stderr).

Core module map: `raster.js` (crop/blit primitives + `autoCropSubject` — noise-robust crop-to-subject before downscale, the eval loop's biggest quality lever; single sprites only), `color.js` (OKLAB), `quantize.js` (downscale/quantize/dither/outline/cleanup), `preprocess.js` (denoise/sharpen/contrast presets), `palettes.js` (profiles + scales), `models.js` (static model fallback list + capability flags incl. `maxReferenceImages`), `model-registry.js` (live+curated catalog merge, `auto`/`auto:<tier>` resolution — Node fetch/cache side in `node/live-models.js`, synced by `pixegen models --live`), `prompts.js` (structured prompt spec — `buildPromptSpec`/`renderPromptSpec` compose ordered sections (format/style/subject/view/action/background) that the `buildPrompt`/`buildSheetPrompt`/`buildGridPrompt` wrappers render; also batch planning and the request-URL builder with capability gating incl. the `image=` reference param; a character's locked `styleNotes` feeds the style section), `pipeline.js` (`processSourceRaster` + sheet/grid slicing), `recipes.js` (named settings bundles — the primary CLI/MCP interface), `validate.js` (post-generation checks), `exporters.js` (shared sheet model — multi-animation multi-row packing with per-frame durations and pivots — plus pure emitters for Phaser/Aseprite JSON/Godot `.tres`/love2d `.lua`/Unity metadata behind the `EXPORT_FORMATS` registry; `atlas.js` is now a thin single-animation Phaser wrapper over it), `prompt-ideas.js` (random "inspired by <classic game of the selected system>" prompt generator behind the UI's 🎲 buttons and `pixegen idea`).

**Validation gate** (`core/validate.js`): deterministic post-generation checks (blank-frame, palette conformance incl. the 0.65× outline-darkened variants, transparency sanity, cross-frame drift). The Node path (`src/node/generate.js`) runs it after every generation and retries once with `seed + 1000`; the browser flow does not call it yet.

**Eval loop / ideal settings** (`eval/findings.json` + `core/eval-findings.js` + `src/node/eval-store.js`): the persistent knowledge base of judged champion-vs-challenger trials and per-target ideal settings — read `eval/README.md` before running or extending the loop. Entry points: `pixegen eval run|record|status` (agent path — `eval run` deliberately skips the validation-gate retry so both sides keep the same seed), the A/B tab's winner buttons (dev-server middleware in `vite.config.js` writes the file, since the browser can't), and the Generator's ✨ Ideal button. `PIXEGEN_FINDINGS_PATH` overrides the file location — always set it in tests so they never write the repo's real history. `eval run` writes `a_preview.png`/`b_preview.png` (upscaled) for judging by eye. The **`/eval-sweep` skill** (`.claude/skills/eval-sweep/`) runs the structured data-assembly sweep: one prompt+seed varied across config axes, each trial judged visually and recorded — use it when asked to gather ideal-settings evidence or validate recipes.

See `docs/Next-Phase.md` for the full rationale and the landscape survey of comparable pixel-art MCP tools. **Session docs convention**: `docs/last-sesh.md` is rewritten each working session (what just happened, forks taken, cans kicked — read it when picking up the project) and `docs/LESSONS.md` accumulates only the durable lessons (read it before repeating a mistake it already paid for).

### React app, with legacy vanilla-JS code left in place

The active app is a React 19 + Chakra UI SPA: `index.html` loads `src/main.jsx` → `src/App.jsx` (a single ~2000-line component holding nearly all UI state and orchestration logic). The other top-level components, each rendered as a tab inside `App.jsx`: `src/Explorer.jsx` (browse saved generations), `src/Characters.jsx` (the Characters tab — persistent character entities with locked description/seed/reference for consistent animation sets; see below), `src/TilesetStudio.jsx` (tile grids), and `src/CompareLab.jsx` (the "A/B Test" tab — one prompt + shared seed against two model/pipeline configs side by side; the instrument for Next-Phase Phase 1's "which combinations earn a recipe" evaluation). Tabs are `isLazy` with `lazyBehavior="keepMounted"` — panels mount on first visit (Explorer relies on this to load fresh data) and keep state afterward, so in-flight generations survive tab switches.

**Shared animation playback**: `src/AnimationPreview.jsx` is the one playback component (transport controls, FPS, optional ping-pong/onion-skin toggles, optional clickable frame strip) wrapping the `AnimationPlayer` class (`src/animation-player.js`, the rAF canvas engine — `seek(idx)` is the public frame-jump API). Generator, Explorer, and Characters all render it; feed it `[{ canvas, spriteW, spriteH }]` frames (the shape sprite-storage hydrates) and it handles the rest. Don't re-implement play/stop/FPS UI in a tab.

**Characters tab** (`src/Characters.jsx`): a Character row (Dexie `characters` table) locks `description` (the prompt subject), `styleNotes`, palette/scale/model prefs, a `baseSeed` reused across animations, and a canonical reference image (`refImageBlob` for display + `refImageUrl`, the upstream request URL). Generating an animation composes the locked subject + animation state into the structured prompt, reuses the base seed, and — when the chosen model has `maxReferenceImages > 0` — passes `refImageUrl` as `image=` conditioning (the browser counterpart of the Node cohesion chain; `img._upstreamUrl` on generated images carries the public URL the proxy path maps to). The first generation auto-anchors the reference; any saved animation can be promoted via "Use as reference". "Export Character" packs every animation into one PNG (one row each) + one metadata file in any `EXPORT_FORMATS` format.

An always-visible **left sidebar** (`src/RunSidebar.jsx`) tracks every generation request app-wide ("Runs" view: sequential ids, color-coded granular statuses initiated→generating→decoding→processing→saving→completed/error, click-to-expand summary with copyable prompt/URL/timeline/error) and hosts the prompt history ("Prompts" view) plus a "Settings" view (also opened by the header's gear icon; sidebar view state lives in App so the gear can drive it). Backing stores are module-level + `useSyncExternalStore` (no context/prop-drilling): `src/run-tracker.js` (runs, localStorage-persisted) and `src/settings.js` (global settings — currently the "Use free tier when available" toggle — adds `pixegen_free=1` to requests, which the dev proxy strips while skipping the Authorization header; 401/402/429 auto-falls back to the key). Generation flows report stages via the `onStage` callback on `generateImage`/`generateSpriteSheet`/`generateTileGrid`.

`src/main.js` and `src/style.css` are the **pre-React implementation** (vanilla JS + DOM ids like `#input-field`, `#generate-btn`, `#pixel-canvas`) and are no longer loaded by `index.html`. They're dead code kept around during the migration — don't extend them, and don't assume their DOM ids exist in the current app. `tests/integration.spec.js` still targets those old DOM ids and predates the React rewrite; treat it as stale/likely-broken rather than a source of truth for current UI structure. `tests/ui.spec.js` and `tests/preprocessing.spec.js` query by role/placeholder/text and reflect the real Chakra UI markup — follow their patterns for new tests.

### Generation pipeline

Three stages, each in its own module, called from `App.jsx`:

1. **`image-service.js`** — browser adapter: builds the prompt and request path via `core/prompts.js`, resolves `provider:model` → API base via `provider-service.js`, and fetches the raw AI image through the Vite dev proxy (`generateImage` for a single frame, `generateSpriteSheet`/`generateTileGrid` for batched strips/grids). Debug info for every call is written to the exported `lastRequest` object, which feeds the Inspector tab.
2. **Preprocessing** — optional denoise/sharpen/contrast/saturation pass before pixelation, applied inside the core pipeline (`core/preprocess.js`, presets in `PREPROCESSING_PRESETS`; see `docs/PREPROCESSING.md`). For sheets/grids it runs batch-wide before slicing so histogram passes normalize across frames.
3. **`pixel-processor.js`** — browser adapter over `core/pipeline.js`'s `processSourceRaster`: decodes the image via canvas, runs downscale → quantize → outline/cleanup in the core, and wraps results in real `ImageData`. Two pipelines: `enhanced` (mode-based downscale, OKLAB quantization, optional Bayer dither — portable) and `classic` (average downscale, RgbQuant sRGB quantization — browser-only, injected as `classicQuantize`). Which quantization strategy runs depends on the palette profile's `quantizeMode`: `'palette'` (fixed palette, e.g. NES), `'bitreduce'` (per-channel bit depth, e.g. SNES), or `'none'` (raw downscale).

### Providers

Two providers, registered in `src/core/models.js` (`PROVIDERS`) with Node adapters in `src/node/providers/`:

- **Pollinations** (default, zero-config) — free tier, re-sells OpenAI GPT Image and Google Gemini image models through one GET API. Browser requests go through the Vite dev proxy, which injects `POLLINATIONS_API_KEY` server-side (`vite.config.js`) so the key never reaches the client. Browser latency levers (all in the sidebar Settings view): free-tier toggle, parallel batch requests, and slow-request failover (aborts a request past the threshold and retries down the `FAILOVER_CHAIN` in `image-service.js` — flux → klein → zimage).
- **OpenAI** (BYOK) — direct `POST /v1/images/generations` with `OPENAI_API_KEY` from env; native transparent backgrounds, fixed canvas sizes (so one frame/tile per request — the adapter's `maxUnitsPerAxis` is 1), no seed parameter. Available in CLI/MCP, and **in the browser for single sprites** via the dev-server `POST /api/openai/generate` middleware (`vite.config.js`, key stays server-side); sheets/tilesets stay CLI-only in this lane (no strip batching on fixed canvases) and the UI greys those paths out. `vite.config.js` injects the active browser provider list as the `__AVAILABLE_PROVIDERS__` build-time global (openai included only when the key is configured); unavailable providers' models render disabled in pickers rather than hidden.

The original "Pollinations only" decision and its 2026-07-12 revision (why direct OpenAI came back, and the guardrails against selectable-but-broken providers) are recorded in `docs/PROVIDERS.md` — read it before adding a provider. **Adding a provider = one adapter file in `src/node/providers/` + a model list in `core/models.js`; never add models without a working adapter**, and never surface a provider in the browser picker without a proxy route that keeps its key server-side.

Model IDs are `"provider:modelId"` strings (e.g. `"pollinations:flux"`, `"openai:gpt-image-1"`); bare ids resolve pollinations-first, then by unique cross-provider match (`resolveModel` in `core/models.js`).

### Palette profiles and sprite scales (two independent axes)

`src/core/palettes.js` defines **`PALETTE_PROFILES`** (NES, SNES, Genesis, Game Boy, C64, Atari, plus `none` for raw output — the real hardware constraint: palette or bit-depth config + `quantizeMode`) and **`SPRITE_SCALES`** (footprint presets keyed by `"WxH"` with intent labels like Tiny/Classic/HD — a game-design choice, deliberately *not* tied to a console; any custom `"WxH"` string is accepted via `parseSpriteSize`). `nes-palette.js` holds the raw NES color data. Adding a console means adding a profile entry plus any palette data file. `src/palettes.js` re-exports everything plus deprecated `CONSOLES`/`DEFAULT_CONSOLE`/`getPaletteForConsole` aliases for pre-split callers and persisted Dexie rows.

Model capability flags live in `src/core/models.js`: `paidOnly` (3 of 9 models fail without a funded `POLLINATIONS_API_KEY` — marked in the pickers) and `supportsTransparent` (the `transparent=true` param is only honored by GPT Image models; `buildRequestPath` drops it for others and the UI disables the toggle).

### Animation

`animation-states.js` defines `ANIMATION_STATES` (idle, walk, attack, etc.) and `VIEWS` (facing directions), and builds pose-description text fed into prompts. Playback is the shared `AnimationPreview` component (see above) over the `AnimationPlayer` class. `sprite-sheet.js` assembles individual frames into an exportable sheet image + metadata (single-animation strip via `buildSpriteSheet`/`exportSpriteSheet`, multi-animation packed sheet via `buildPackedSheet`; engine metadata via the core `EXPORT_FORMATS` emitters).

### Persistence

`sprite-storage.js` wraps Dexie (IndexedDB) as `PixelGenDB` (schema v4): `sprites` (individual frames, keyed by character/console/animState/view/frame — plus a `characterId` FK and `[characterId+animState+view]` index — storing the raw AI source blob, its upstream `sourceUrl`, and the processed pixel data), `characters` (the Character entity — see the Characters tab section), `tiles`, and the declared-but-unwritten `sheets`. Schema changes go through Dexie's versioned `.stores()`/`.upgrade()` chain — see the `db.version(2).upgrade(...)` migration for the pattern when adding fields to existing rows. Legacy rows without `characterId` still group by the `characterName` string; `adoptSpritesByName()` backfills the FK when a Character is created for an existing name. Note `saveAllFrames` honors an explicit `meta.frame` over the array index (per-frame save loops rely on this; rows saved before 2026-07-14 may all carry `frame: 0` from the old override bug). The Explorer tab (`Explorer.jsx`) reads this store to let users browse/replay/delete past generations, including the original source image alongside the pixel-art output.

## Testing notes

- Playwright tests assume the dev server is already reachable at `localhost:5173` (or auto-start it, per `playwright.config.js`'s `webServer` config) and mock generation calls by intercepting `**/api/pollinations/**` (and `**/api/generate/**` for the OpenAI lane) with a canned PNG — see `tests/ui.spec.js` for the pattern (`TEST_PNG_BASE64` + `page.route`).
- Playwright specs run in Node, so **pure `src/core/` modules can be unit-tested directly in a spec with no browser** — `tests/exporters.spec.js` is the pattern (plain `test()` blocks, direct ESM imports, no `page` fixture).
- `tests/integration.spec.js` hits the real Pollinations API (no mocking) and is slow/network-dependent; it's also written against the old vanilla-JS DOM ids (see above), so it likely needs updating before it will pass against the current React UI.
