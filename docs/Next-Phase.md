# Next Phase: Sizing, Pipeline Re-evaluation, and Agentic Access

This document is a holistic re-read of PixelGen's core premise, prompted by
three observations from the current session:

1. The console "System" picker (`palettes.js` → `CONSOLES`) bakes in a
   sprite pixel size per console (NES → 32×32, Game Boy → 16×16, C64 →
   24×21...) that turns out to be arbitrary — real games on the same
   hardware used wildly different on-screen character scales depending on
   camera zoom and genre. This was never actually a console-dictated
   constraint; it was a default that got treated as one.
2. The pipeline was built when AI image generation was noticeably worse at
   following pixel-art instructions than it is now. The heavy
   downscale→quantize→dither→outline→cleanup stack may be doing more
   distortion than correction for today's models — which is exactly why a
   raw-passthrough `none` console option was just added, as a diagnostic.
3. Everything the app can do is locked behind a React SPA. There is no way
   to fire generation from a script, a build pipeline, or a coding agent —
   which is a hard blocker if the goal is "streamline sprite generation for
   pixel-art games" rather than "a manual tool a human clicks through."

This document is **complementary to `docs/SPRITE_STUDIO_ROADMAP.md`**, not a
replacement. That doc is about *what kinds of assets* the app can produce
(tilesets, projects, external palette import, provider adapters). This one
is about *whether the current per-asset pipeline produces the right thing*
and *how the app is invoked*. They should eventually merge into one roadmap,
but are kept separate for now since they were written from different
prompts and shouldn't be force-reconciled without a decision pass.

---

## 1. Sprite size is falsely coupled to console/palette choice

### What's actually true about hardware sprite sizing
Real 8/16-bit consoles constrain sprites at the **tile primitive** level, not
at the "whole character" level:
- NES OAM sprites are 8×8 or 8×16 hardware primitives, composited into a
  metasprite from multiple entries (up to 64 on-screen, 8 per scanline,
  each limited to 3 colors + transparent). A Mega Man-sized character is
  built from a dozen-plus 8×8/8×16 tiles — there is no single "NES sprite
  size."
- SNES/Genesis are similar in kind (larger OAM primitives, more
  simultaneous colors) but the same principle: hardware caps *primitives
  and per-primitive color count*, not final character footprint.
- Final on-screen character size was a **game design decision** (camera
  zoom, genre) layered on top of those hardware caps — Zelda's top-down
  Link, Metroid's Samus, and Kirby are all NES/SNES-era and are three very
  different sizes.

### What the code currently does
`palettes.js`'s `CONSOLES` registry conflates two independent axes into one
picklist entry:
- **Color profile** (the real hardware constraint): `palette`/`paletteFlat`/
  `bitDepthReduce`/`quantizeMode`/`colorsPerSprite`.
- **Pixel footprint** (a game-design choice, not a hardware one):
  `spriteSizes`/`defaultSize`.

Picking "NES" locks you into a color palette *and* silently opinionates a
32×32 canvas, with no way to say "NES colors, but I want a 64×64 hero
sprite" or "SNES colors at Game Boy's tiny 16×16 scale" without editing
`palettes.js` — even though every real game mixed and matched these two
axes freely.

### Proposed fix
Split `CONSOLES` into two independent registries:
- `PALETTE_PROFILES` (today's `palette`/`paletteFlat`/`bitDepthReduce`/
  `quantizeMode`/`colorsPerSprite`/`colorDepth` — the "None" option added
  this session becomes just another profile: `quantizeMode: 'none'`).
- `SPRITE_SCALES` — a small set of footprint presets keyed by *intent*, not
  console: e.g. `tiny (16×16)`, `classic (32×32)`, `detailed (48×48)`,
  `hd (64×64)`, `custom (w×h)`. These are genre/zoom presets, not hardware
  facts, and should say so in their labels/descriptions.

`processImage`/`processSpriteSheet`/`processTileGrid` already take
`consoleId` + `spriteSize` as separate parameters internally — this is
mostly a data-modeling change (`palettes.js` + the two `Select`s in
`App.jsx`/`TilesetStudio.jsx`), not a pipeline rewrite. The optional
hardware-strict layer (real OAM tile/scanline/per-sprite-color limits) can
be reintroduced later as its own opt-in validation pass for people who
actually want cycle-accurate constraints, rather than forced on everyone by
default.

---

## 2. The pipeline assumes generation quality that may no longer be true

### The current assumption
`pixel-processor.js`'s "enhanced" pipeline exists to fight bad AI output:
mode-based downscale to preserve edges the model blurred, OKLAB nearest-color
quantization to force a hardware palette, optional Bayer dithering, then
*auto-outline* and *orphan cleanup* passes specifically to patch up
anti-aliasing artifacts and stray pixels the model introduced. `docs/
PREPROCESSING.md`'s own preset names (`denoise`, `sharpen`, `stabilize`)
describe correcting model output, not stylizing good output.

That posture made sense when this was built. `gptimage`/`nanobanana-pro`/
`seedream` (all now in `provider-service.js`'s model list) follow "pixel
art, flat colors, sharp edges" instructions materially better than the
models available when the pipeline was designed. It's an open question —
not yet answered — whether the current 5-stage correction stack is still
net-positive per model, or whether it's now **over-processing** already-good
output into something worse (which matches your read that results look
"way too far" / bad).

### How to actually answer this (don't guess — measure)
The `none` console option added this session is the tool for this, but a
one-off visual check isn't enough to make a pipeline decision. Proposed
evaluation pass:
1. For each active model (`flux`, `gptimage`, `nanobanana`, `nanobanana-pro`,
   `seedream`, `zimage`), generate the same fixed prompt set (~10 varied
   subjects) at a few sizes.
2. Render each through: raw (`none`), quantize-only (no dither/outline/
   cleanup), full enhanced pipeline, full classic pipeline.
3. Score or eyeball each combination against three axes that actually matter
   for game-asset usability: palette conformance (does it look like it
   belongs on the target hardware), edge cleanliness (no muddy/AA'd border
   pixels), and silhouette clarity (readable at game scale, not just at
   preview zoom).
4. The output isn't "pick one pipeline" — it's a **per-model default
   recipe** (see below), since a fast/cheap model like `flux` may still need
   the full correction stack while a `gptimage`/`nanobanana-pro` generation
   may only need light cleanup.

### Recipes instead of raw knobs
Today the UI exposes 7+ independent controls (console, size, pipeline,
dithering, outlines, cleanup, preprocessing preset) that a user — or an
agent — has to get right together to produce a good result; there's no
"known-good combination" concept. Once step 2.4 above produces validated
combinations, encode them as named **recipes** — e.g. `nes-strict`,
`clean-flat-hd`, `raw-concept` — each bundling a palette profile + sprite
scale + pipeline + dither + outline/cleanup + preprocessing preset that's
been verified to look right. Recipes become the primary interface (CLI/API/
MCP call one recipe name); the individual knobs remain available for manual
tuning in the UI but stop being the thing an automated caller has to guess
at.

---

## 3. Nothing in the pipeline is usable outside the browser

This is the blocker for "used agentically" and needs to be fixed before a
CLI/API/MCP surface can exist at all — it's not just "add a wrapper," the
core modules are DOM-coupled today:

| Module | Browser-only API used | Why it matters |
|---|---|---|
| `image-service.js` | `Image()`, `URL.createObjectURL` | Decodes the fetched PNG into something `pixel-processor.js` can draw — `fetch` itself is fine in Node 18+. |
| `pixel-processor.js` | `OffscreenCanvas` / `document.createElement('canvas')`, `ImageData` constructor | Every quantize/downscale function reads/writes `ImageData`-shaped typed arrays — the *math* is already pure and portable, only the canvas plumbing around it isn't. |
| `image-preprocessor.js` | Same canvas/`ImageData` dependency | Same story — filters operate on typed arrays already. |
| `sprite-storage.js` | Dexie → IndexedDB | Browser-only persistence; not meaningful for a CLI anyway (see below). |
| `sprite-sheet.js` | `document.createElement('canvas')` | Sheet/atlas assembly for export. |
| `vite.config.js` proxy | Injects `POLLINATIONS_API_KEY` server-side so the browser never sees it | Irrelevant for a Node process — a CLI/API/MCP server *is* the trusted server side, so it can read `POLLINATIONS_API_KEY` from env and call `https://gen.pollinations.ai` directly, no proxy needed. This actually simplifies headless usage versus the browser path. |

### Proposed shape: split into a portable core + environment adapters
Not a rewrite — the quantization/downscale/dither math in `pixel-processor.js`
already operates on plain typed arrays (`Uint8ClampedArray` + width/height),
it just gets its input/output via browser `ImageData`. The fix is a ports-
and-adapters seam:

- **Core** (new home, e.g. `src/core/`, isomorphic, no DOM): prompt building
  (`buildPrompt`/`buildSheetPrompt`/`buildGridPrompt`, already pure string
  functions), all quantize/downscale/dither/outline/cleanup math (already
  pure typed-array functions — just stop constructing `new ImageData(...)`
  internally and accept/return a plain `{ data, width, height }` shape),
  palette/sprite-scale registries, recipe definitions.
- **Browser adapter**: canvas decode/encode, IndexedDB storage (existing
  `sprite-storage.js`, unchanged), the React UI.
- **Node adapter**: **`pngjs`** (decided 2026-07-12, superseding the earlier
  `@napi-rs/canvas` suggestion — see §8). The pipeline's only canvas needs
  are "decode PNG → typed array" and "typed array → PNG"; slicing sheet
  batches into frames and assembling exports are plain raster copies once
  the math operates on `{ data, width, height }`. `pngjs` is pure JS (no
  native build, works identically in WSL/CI), tiny, and sufficient. Output
  goes to the **filesystem** (PNG + the JSON atlas `sprite-sheet.js`
  already generates) — this is a better fit for CLI/agentic use than
  IndexedDB anyway, since game engines consume files, not a browser
  database. Node 18+ has `fetch` built in and Node's `util.parseArgs`
  covers CLI parsing, so the CLI itself needs zero framework dependencies.

### CLI
```
pixegen generate "a knight with a sword" --recipe nes-strict --out ./out/knight.png
pixegen sheet "a knight" --anim walk --view side --recipe clean-flat-hd --out ./out/knight-walk/
pixegen tileset "sunset desert ruins" --cols 6 --rows 4 --recipe nes-strict --out ./out/tileset/
pixegen recipes            # list available recipes
pixegen palettes           # list palette profiles + sprite scales
```
Exit codes and `--out` (file or directory) make it composable in a build
script or a Makefile-style asset pipeline.

### API
A thin HTTP layer over the same Node core (e.g. `POST /generate`,
`POST /sheet`, `POST /tileset`, `GET /recipes`) — mainly useful if
generation needs to run on a server a game's build process calls out to,
rather than shelling out to the CLI. Low priority versus CLI/MCP unless a
concrete consumer needs it.

### MCP
The highest-leverage piece for "used agentically" specifically — an MCP
server wrapping the Node core as tools (`generate_sprite`,
`generate_sprite_sheet`, `generate_tileset`, `list_recipes`,
`list_palette_profiles`, `estimate_cost`) lets a coding agent (Claude Code
itself, mid game-dev session) generate and drop real asset files into a
project directory without a human round-tripping through the browser UI.
This is the concrete answer to "make sure this can be used agentically" —
CLI is the manual/scriptable path, MCP is the agent-native path, and both
sit on the same Node core so there's one implementation to keep correct.

Implementation notes from the 2026-07-12 landscape check (§9):
`@modelcontextprotocol/sdk` 1.29.x is the current stable SDK. Follow its
current conventions: `McpServer` + `registerTool` with zod input schemas
(`.describe()` on every field so agents fill parameters correctly), return
both human-readable `content` and machine-readable `structuredContent`,
stdio transport, and **never write to stdout** (protocol channel) — log to
stderr only. Tools should write asset files to a caller-specified output
directory and return the paths, matching how the existing pixel-art MCP
servers in the wild behave (see §9).

---

## 4. Determinism lives in post-processing, not generation — and that gap needs a gate

The quantize/dither/outline/cleanup math is already fully deterministic
(pure functions, same input → same output every time). The part that isn't,
and can't be made to be, is the AI generation call itself — `seed` is
passed through to Pollinations but is **best-effort per underlying model**,
not a guarantee, and nothing in the codebase verifies a generation actually
came out usable before it's accepted.

For unattended/agentic use specifically (no human eyeballing a preview
before accepting it), this is the actual risk to "consistent set of usable
results" — not the deterministic math, which is already fine. Proposed
fix: a **post-generation validation gate** that runs after every generation,
before it's accepted, using deterministic checks against the *processed*
output:
- Background/transparency sanity — did `transparent=true` actually produce
  a clean alpha edge, or did the model ignore it (common failure mode)?
- Palette conformance — after quantization, does the frame actually use
  ≤ `colorsPerSprite` colors, or did the quantizer get overwhelmed by an
  unusually busy source image?
- Cross-frame consistency (sheets/tilesets specifically) — bounding-box/
  centroid drift between frames beyond a threshold flags a likely
  "different pose entirely" or "character drifted off-canvas" generation
  failure, which is a known diffusion-model failure mode `docs/
  SPRITE_STUDIO_ROADMAP.md §B` already identifies from the prompt side.

A failed check triggers one automatic retry (same recipe, new seed) before
surfacing to the caller/user, rather than silently accepting a bad frame —
this is what turns "stochastic generation + deterministic processing" into
"a pipeline an agent can call unattended and trust the output of."

---

## 5. Phased plan — revised 2026-07-12 into a single "Agentic Access" phase

The 2026-07-12 review consolidated the original Phase 0/3/4/5 into one
implementation pass, since they share a dependency chain (registry split →
portable core → CLI → validation → MCP) and the user's stated goal is the
agentic surface. **This phase was implemented in the same session as this
revision** — status marked per item below. Phases 1 and 2 (empirical
pipeline evaluation, live model registry + Auto tier) remain future work
because they require live paid-model generation and human judgment of
output quality.

**Agentic Access phase (implemented)**
- ✅ Split `CONSOLES` into `PALETTE_PROFILES` + `SPRITE_SCALES` per §1.
  Scale keys stay `"WxH"` strings (labels carry the intent names) so rows
  already persisted in Dexie keep parsing; arbitrary `"WxH"` sizes are
  accepted anywhere a scale key is.
- ✅ Mark `paid_only` models in the picker (§6/§8) via a `paidOnly` flag on
  the hardcoded list; add the free `gptimage-large` model.
- ✅ Gate `transparent` on model capability (§6): the parameter is only
  sent for models that support it (`gptimage`, `gptimage-large`), and the
  UI toggle is disabled with an explanatory hint for the others.
- ✅ Extract `src/core/` — prompt builders, downscale/quantize/dither/
  outline/cleanup/preprocess math on plain `{ data, width, height }`
  rasters, palette/scale/recipe registries, request-URL builder, batch
  planner, validation checks. Browser modules became thin adapters that
  wrap core output in real `ImageData`. The **classic RgbQuant pipeline
  stays browser-only** (RgbQuant duck-types on DOM classes); the core
  supports `enhanced`, `bitreduce`, and `none`, which is what recipes use.
- ✅ Node adapter (`src/node/`) using `pngjs`; calls
  `https://gen.pollinations.ai/image` directly with
  `POLLINATIONS_API_KEY` from env (no proxy needed server-side).
- ✅ CLI: `pixegen generate|sheet|tileset|recipes|palettes|scales|models`
  (bin/pixegen.js, zero-dep arg parsing via `node:util` `parseArgs`),
  writing PNG + Phaser JSON atlas to `--out`, non-zero exit codes on
  failure.
- ✅ Validation gate (§4) in core (`core/validate.js`): transparency
  sanity, palette conformance, blank/washed-frame detection, cross-frame
  bounding-box drift; the Node generation path retries once with a bumped
  seed on failure. (Browser wiring of the same gate is a follow-up — the
  checks are in core, the React flow just doesn't call them yet.)
- ✅ MCP server: `bin/pixegen-mcp.js` on `@modelcontextprotocol/sdk`
  (stdio), tools `generate_sprite`, `generate_sprite_sheet`,
  `generate_tileset`, `list_recipes`, `list_palette_profiles`,
  `list_models`.
- ✅ **Provider seam + OpenAI BYOK adapter** (added later the same day,
  revising the "Pollinations only" decision — see §10 and
  `docs/PROVIDERS.md` §2). Node-side provider adapter interface
  (`src/node/providers/`), multi-provider model registry in
  `core/models.js`, `openai:gpt-image-1[-mini]` via `OPENAI_API_KEY`
  (verified against the live API), `--quality` tier passthrough for both
  providers. The browser UI remains Pollinations-only until it grows a
  proxy route per provider.
- ✅ **Prompt History Popout Sidepanel** (added 2026-07-13): Added a sliding drawer containing all executed and randomly generated prompts across tabs, featuring instant copy-to-clipboard, text-based search, All/Random/User filters, and click-to-load capabilities. Fully integration-tested via Playwright.

**Phase 1 — empirical pipeline evaluation (§2) — first real matrix pass done 2026-07-13**
- ✅ **A/B Test tab** (`src/CompareLab.jsx`, added 2026-07-13): one prompt +
  shared seed against two full configs (model, palette, scale, pipeline,
  dither, preprocessing, outlines/cleanup — recipe presets as starting
  points), source + processed results side by side with timings, plus an
  animation mode that generates and autoplays full frame sets per side.
- ✅ **Eval loop + ideal-settings knowledge base** (added 2026-07-13):
  `eval/findings.json` persists judged champion-vs-challenger trials and a
  per-target **ideal settings** record; `src/core/eval-findings.js` holds
  the rules (decisive winner's settings become the target's ideal; ties
  record without moving it). Three ways in: `pixegen eval run|record|status`
  (the agentic loop — generate pair, look at the PNGs, record verdict; see
  `eval/README.md`), the A/B tab's **👑 A/B wins / Tie** buttons (via a
  dev-server endpoint that writes the same file), and the Generator's
  **✨ Ideal** button that auto-configures the recorded ideal for the
  selected target. Ideals are the evidence layer under recipes: once a
  target stabilizes, promote its ideal into the recipe and drop the
  `provisional` flag.
- ✅ **First live matrix pass** (2026-07-13, with a funded key): 7 trials
  recorded in `eval/findings.json` across nes (4 decisive + 2 ties) and
  gameboy (1 decisive). Headline findings, each persisted with notes:
  - **Subject auto-crop before downscale is the biggest quality lever
    found** — models often leave the subject at 40% of the frame, and the
    downscale starves it. Implemented as `autoCropSubject` (percentile-mass
    bbox, noise-robust) in `core/raster.js`, exposed as `autoCrop` through
    the pipeline/recipes/CLI (`--auto-crop`)/MCP/eval axes. At 16×16 it's
    the difference between "readable robot" and "two smudges".
  - **`standard` preprocessing hurts clean modern sources** — it amplifies
    fine noise into background speckles that survive quantization; §2's
    over-processing hypothesis confirmed for zimage. Raw source quantizes
    cleaner.
  - **zimage beats flux for NES sprites** (fills the frame, better
    silhouette); bayer dithering loses to no dither on flat-background
    sprites; the outline pass is a no-op on sources that draw their own
    outlines (kept as harmless default).
- ✅ **Recipes adjusted from the evidence**: `nes-classic` now encodes the
  recorded ideal (zimage, preprocessing none, autoCrop); sprite recipes gain
  `autoCrop: true` (`raw-concept` deliberately stays raw). Recipes stay
  `provisional` until their targets hit the 5-stable-trials promotion bar
  (nes is at 4).
- ✅ **`negative_prompt` resolved (2026-07-13): it is silently ignored** —
  same seed, flux, a wizard prompt with `negative_prompt=beard, hat`
  produced a bearded, hatted wizard identical-in-kind to baseline and to a
  dummy-param control. The passthrough stays (other models may honor it),
  but nothing should claim it improves output; it's also absent from the
  documented parameter table.
- Matrix expansion still open: more targets (snes/genesis/c64/atari/none),
  more prompts per verdict, and per-model ideals beyond flux/zimage
  (gptimage was temporarily blocked by upstream moderation during this
  pass — retry the model axis when it clears).

**Phase 2 — capability-tagged model registry + Auto (§7) — done for the
agentic surfaces 2026-07-13; browser picker still static**
- ✅ **Live + curated model catalog**: `core/model-registry.js` (pure merge:
  live `GET /image/models` entries normalized + `CURATED_OVERLAY` with
  speedTier / pixelArtSuitability / transparent-capability knowledge) over
  `node/live-models.js` (fetch + 1-hour disk cache under
  `~/.cache/pixegen/`, `PIXEGEN_MODELS_CACHE_PATH` override). Sync path is
  explicit — `pixegen models --live` — and the read path is synchronous and
  network-free (cached live data when present, refreshed static fallback
  otherwise), so generation never blocks on a catalog fetch. MCP
  `list_models` serves the same merged catalog.
- ✅ **`Draft`/`Standard`/`Best` tiers + Auto resolution**: model `auto` /
  `auto:<tier>` (CLI sugar `--tier`) resolves intent → concrete model via
  the catalog, honoring free-tier/paid-key and capability constraints; a
  tier also implies a `quality=` value when none is set. Preference
  orderings are explicit in `TIER_PREFERENCES` and are overridden by
  recorded `pixelArtSuitability` as Phase 1 verdicts accumulate.
- ✅ **`image=` reference param wired** (§6): `buildRequestPath` emits it
  capability-gated per model (`maxReferenceImages` now in the registry),
  CLI `--ref`, and sheets/tilesets automatically feed the first batch's
  request URL to later batches for cross-batch visual cohesion (no-op for
  models without reference support, e.g. flux).
- Still open: the **browser picker** stays on the static list until the dev
  server grows a `/api/models` route + UI wiring; folding `Auto` into the
  browser UI is the same follow-up. The static fallback list was refreshed
  2026-07-13 (gpt-image-2 and nova-canvas are now free; live catalog is 26
  image models).

**Phase 6 (optional) — HTTP API**
- Only if a concrete non-CLI, non-MCP consumer shows up; otherwise CLI+MCP
  cover the stated agentic-access goal without the extra surface.

---

## 6. Pollinations API verification pass (live-checked 2026-07-12)

`docs/PROVIDERS.md` and `provider-service.js` were last verified against
Pollinations some time ago. This session re-checked both the docs
(`gen.pollinations.ai/docs`, the GitHub `APIDOCS.md`) and the **live**
`GET https://gen.pollinations.ai/image/models` endpoint directly. Findings:

### The endpoint path is fine — checked, not assumed
Pollinations' documented image path is `gen.pollinations.ai/image/{prompt}`,
not `gen.pollinations.ai/{prompt}`. A live curl against the bare path
returned `404 NOT_FOUND`. This looked like a real bug in `image-service.js`
at first (it builds `${apiBase}/${encodedPrompt}` with
`apiBase = '/api/pollinations'`) — but `vite.config.js:23` already rewrites
`/api/pollinations` → `/image` before proxying
(`rewrite: (path) => path.replace(/^\/api\/pollinations/, "/image")`), so
the actual outgoing request is correctly `/image/{prompt}`. **No bug** —
noting this so the same false lead doesn't get re-investigated later.

### Real finding: the model list is badly stale, and 3 of 8 current models are paid-only
`GET /image/models` returns a live, authoritative catalog. Querying it
directly today: **26 image models** exist (`provider-service.js` lists 8),
each tagged with a `paid_only` boolean the app currently has no concept of:

| Free (`paid_only: false`) | Paid-only (`paid_only: true`) |
|---|---|
| `flux` (Flux Schnell), `zimage` (Z-Image Turbo), `gptimage` (GPT Image 1 Mini), `gptimage-large` (GPT Image 1.5), `kontext` (FLUX.1 Kontext), `klein` (FLUX.2 Klein 4B), `nova-canvas` (Amazon Nova Canvas) | `nanobanana`, `nanobanana-2`, `nanobanana-2-lite`, `nanobanana-pro`, `seedream`, `seedream-pro`, `seedream5`, `seedream5-pro`, `gpt-image-2`, `ideogram-v4-*` (×3), `wan-image`, `wan-image-pro`, `qwen-image`, `grok-imagine`, `grok-imagine-pro`, `p-image`, `p-image-edit` |

**Of the 8 models `provider-service.js` currently offers, 3 —
`nanobanana`, `nanobanana-pro`, and `seedream` — are `paid_only`.** Per
`docs/PROVIDERS.md`, "the key is optional — Pollinations has a usable free
tier, so the app works with no configuration at all." That's true for 5 of
the 8 listed models but **not** for those 3: picking them without a funded
`POLLINATIONS_API_KEY` will fail outright, with the UI giving no indication
beforehand that this specific model needs a paid key while the others
don't. This is a real, user-facing gap worth closing independent of
anything else in this doc — either mark paid-only models in the picker, or
filter them out when `__AVAILABLE_PROVIDERS__`/env indicates no key is
configured.

Two free models the app doesn't offer at all today: `nova-canvas` (Amazon)
and `gpt-image-2`'s free sibling tier doesn't exist, but `gptimage-large`
(GPT Image 1.5, free) isn't offered either — only the older `gptimage`
(1 Mini) is.

### `transparent` is model-gated, and the app sends it unconditionally
Per Pollinations' docs, the `transparent` query parameter is **"Only
supported by gptimage, gptimage-large, and gpt-image-2."**
`image-service.js`'s `generateImage`/`generateSpriteSheet`/
`generateTileGrid` all append `&transparent=true` whenever the UI's
"transparent background" toggle is on, **regardless of which model is
selected**. For any of the other 5+ free/paid models, this parameter is
presumably ignored — so a user generating with `flux` (the default model)
and transparency on gets a silent no-op, then wonders why the background
isn't transparent. Worth gating the toggle itself on model capability
(disable/warn when the selected model doesn't support it) rather than
sending a parameter that quietly does nothing.

### Pricing model changed from $/image to per-token "pollen" credits
`docs/PROVIDERS.md`'s cost table (`gptimage ~$0.008/img`,
`nanobanana ~$0.039/img`, `nanobanana-pro ~$0.134/img`) was a flat
per-image USD estimate. The live model list now prices in **"pollen"**
credits, split by token type (`promptTextTokens`, `promptImageTokens`,
`completionImageTokens`) rather than a flat per-image number — e.g.
`gptimage`'s `completionImageTokens` is `0.000006` pollen. Converting that
back to a comparable $/image figure requires the pollen→USD exchange rate
and Pollinations' image-tokens-per-generation formula, neither of which
this endpoint exposes. **`docs/PROVIDERS.md`'s cost table should be treated
as stale** until re-verified against Pollinations' actual current pricing
page — don't keep citing the old $/img numbers as current.

### Two capabilities the app doesn't use yet, both directly relevant to open goals
- **`quality` parameter** (`low`/`medium`/`high`/`hd`) — not sent anywhere
  today. Worth wiring into the recipe concept from §2: a fast/cheap "draft"
  recipe uses `quality=low`, a "final asset" recipe uses `quality=hd`.
- **`image` parameter** (reference image URL, up to `max_reference_images`
  per model — e.g. `gptimage` supports 16, `nanobanana-pro` 14, `kontext` 1)
  — this is the actual mechanism `docs/SPRITE_STUDIO_ROADMAP.md §B/§3.1`
  already identified as missing for cross-frame/cross-tile visual
  cohesion. Now confirmed as a real, documented, live parameter rather than
  a guess — implementing reference-image conditioning is "pass the first
  accepted frame's URL as `&image=`," not a research problem.

### Caveat on this pass
`negative_prompt` and `nofeed` don't appear in the official parameter table
fetched from GitHub's `APIDOCS.md`, which only lists `model`, `width`,
`height`, `seed`, `nologo`, `enhance`, `private`, `safe`, `referrer`,
`quality`, `image`, `transparent`. They may be older/undocumented-but-live
parameters (Pollinations' docs are visibly incomplete — the rendered
`/docs` page is a client-rendered SPA that didn't yield content to a
non-JS fetch) or they may be silently ignored. Live testing to confirm
either way got confounded mid-session by this environment's shared egress
IP tripping Pollinations' anonymous-tier auth requirement after only two
requests — so this specific question is **not yet resolved** and needs
either a real API key or a less rate-limited vantage point to test
cleanly. Don't treat `negative_prompt` as confirmed-working; it's the app's
entire negative-prompt feature riding on an unverified parameter.

## 7. Provider/model selection: from raw model IDs to an "Auto" option

The immediate prompt for this section: picking a model today means picking
from a raw `provider-service.js` list — `flux` labeled "Flux Schnell, Fast
high-quality generation" tells a user nothing about what Flux is, why
"Schnell" (German for "fast" — it's Black Forest Labs' distilled low-step
FLUX.1 variant, optimized for speed over the full FLUX.1 [dev] model), or
how it compares to `gptimage`/`nanobanana-pro` for *this specific use case*
(pixel-art game sprites, not general image generation). Nobody should have
to know vendor model-naming trivia to generate a sprite.

### Root cause: the model list is a name-and-description picklist, not a capability registry
`PROVIDER_CONFIGS.pollinations.models` (`provider-service.js:22-37`) is
`{ id, name, description, cost }` — flavor text, not machine-usable
capability data. There's no field for: paid-only (§6), transparent-bg
support, max reference images, relative speed, or a "how good is this for
flat-color pixel-art-style output specifically" signal — which is the one
axis that actually matters for this app and the one axis Pollinations'
own metadata can't tell you (that's a judgment call from §2's evaluation
pass, not something the API reports).

### Proposed: a capability-tagged model registry, synced from the live endpoint
Two-layer design:
1. **Live layer** — fetch `GET /image/models` (server-side, cacheable for
   e.g. an hour) instead of hand-maintaining `PROVIDER_CONFIGS.models`.
   This alone fixes §6's staleness problem permanently: new models
   (there were 3 added in the week before this session, per their
   `added_date` timestamps) show up without a code change, and
   `paid_only`/`max_reference_images`/`input_modalities` come from the
   source of truth instead of being guessed at and going stale.
2. **Curated overlay** — a small local table keyed by model `name` that
   adds the judgment-call metadata the API doesn't and can't provide:
   `pixelArtSuitability` (from §2's per-model evaluation pass),
   `speedTier` (`fast`/`standard`/`slow`), and `recipeDefaults` (which
   recipe this model pairs with by default). Merge live + curated at
   request time; a brand-new model the curated table doesn't know about
   yet still works (falls back to a "not yet evaluated" default) instead
   of being invisible until someone edits a file.

### "Auto" resolves *intent*, not a model name
Replace "pick a model" with two questions a non-expert can actually answer:
- **Quality tier**: `Draft` (fast/cheap, for iterating on a concept) →
  `Standard` (default) → `Best` (final asset, willing to pay/wait more).
- *(implicit)* **Does this generation need reference-image conditioning?**
  (multi-frame sheet/tile-grid batches after the first frame, per §6's
  `image` parameter finding) — if so, auto-selection also filters to
  models with `max_reference_images > 0`.

`Auto` then resolves to a concrete model via the merged registry:
lowest-cost model at or above the chosen quality tier that (a) is
`paid_only: false` unless a key is confirmed configured, and (b) meets the
reference-image requirement if applicable. The explicit per-model dropdown
stays available for power users who *do* know what `nanobanana-pro` is and
want to force it — `Auto` becomes the default, not the only option.

This folds naturally into the §2 recipe concept: a recipe names a quality
tier and pipeline settings; `Auto` picks the model; the user (or an
agentic caller via the future CLI/MCP surface from §3) never has to know
model IDs exist unless they choose to look.

## 8. Open decisions

- **Recipe curation is a judgment call, not a mechanical one.** §2's
  evaluation pass produces raw comparison data; deciding which combinations
  count as "good enough to name and ship as a recipe" needs a human look at
  actual output, not just an automated score. Budget real time for this,
  don't try to fully automate it.
- ~~**`@napi-rs/canvas` vs. a narrower decode/encode-only dependency.**~~
  **Resolved 2026-07-12: `pngjs`.** The pipeline needs exactly PNG↔typed
  array; slicing and sheet assembly are raster copies once the math is
  DOM-free. Pure JS, no native build, works in WSL/CI unchanged. Revisit
  only if a future feature needs real compositing or non-PNG formats.
- **How this doc's Phase 0-1 sequencing interacts with
  `SPRITE_STUDIO_ROADMAP.md`'s Phase 0-1 (sheet-width bug fix, tileset
  MVP).** Both docs propose "Phase 0/1" independently since they were
  written separately — before starting implementation, merge these into one
  ordered backlog rather than running two parallel "Phase 1"s.
- **The `paid_only` model gap (§6) is arguably a bug fix, not a roadmap
  item.** Three of the app's eight current model choices silently fail for
  any user without a funded API key, today, with no warning in the UI.
  Worth doing now rather than waiting for the broader registry rework in
  §7 — a small, independent patch (mark or filter paid-only models using
  the existing hardcoded list) versus folding it into the bigger "sync
  from live endpoint" effort. Flagging as a decision since it wasn't fixed
  in this pass, only diagnosed.
- ~~**`negative_prompt`'s actual support status is unresolved**~~
  **Resolved 2026-07-13: silently ignored** (tested with a real key against
  flux — same-seed baseline vs `negative_prompt=beard, hat` vs dummy-param
  control all produced the same bearded/hatted wizard). Kept as a
  passthrough, treated as a no-op; don't build features on it.

---

## 9. Landscape check (2026-07-12): what comparable open-source tools do

A survey of the current agentic pixel-art tooling niche, done before
implementing the Agentic Access phase:

- **[pixelforge-mcp](https://github.com/freema/pixelforge-mcp)** — MCP
  server generating sprites/animations/backgrounds via Google Gemini, with
  post-processing (background removal, auto-crop, pixelation downscale,
  sprite-sheet splitting). Closest in shape to PixelGen's pipeline, but no
  hardware palette accuracy and it's locked to one paid vendor.
- **[willibrandon/pixel-mcp](https://github.com/willibrandon/pixel-mcp)**
  — drives **Aseprite** programmatically (no AI generation): layers,
  drawing primitives, 16 dither patterns, median-cut/k-means/octree
  quantization, retro palettes, spritesheet export. Deterministic
  drawing-as-tools rather than generation.
- **[aseprite-mcp](https://github.com/diivi/aseprite-mcp)** and variants
  (one exposes 104 tools incl. a raw Lua escape hatch) — same category.
- **Commercial**: PixelLab and Sprite-AI ship MCP servers over their paid
  generation APIs.

Takeaways for PixelGen:
1. **The niche is real and active** — "agent generates game assets into
   the project directory via MCP" is an established pattern, validating §3's
   direction. Nobody combines *generation + hardware-accurate console
   quantization + deterministic validation*, which is exactly PixelGen's
   pipeline — that combination is the differentiator worth shipping.
2. **File-writing tools are the convention**: MCP tools take an output
   directory, write PNGs/atlases, and return paths (not base64 blobs) —
   matches §3's filesystem-first design.
3. **MCP SDK practice** (current `@modelcontextprotocol/sdk` 1.29.x):
   `registerTool` + zod schemas with per-field `.describe()`,
   `structuredContent` alongside text `content`, stderr-only logging on
   stdio transport.
4. **Node image IO**: for a pure quantization pipeline, the ecosystem
   default of `sharp`/`@napi-rs/*` is overkill; `pngjs` covers the narrow
   PNG↔buffer contract with zero native dependencies (see §8 resolution).

---

## 10. Provider seam (2026-07-12): revising the single-provider decision

`docs/PROVIDERS.md` originally rejected direct vendor integration. Three
things changed the calculus, so the decision was revised the same day the
agentic surface shipped:

1. **The cost rationale went stale** — the "4-5x cheaper via Pollinations"
   table predates Pollinations' pollen-credit pricing (§6) and can't be
   cited as current.
2. **The agentic surface changed who the user is** — CLI/MCP callers run
   unattended, usually already hold vendor keys, and value availability
   over per-image cost. The live 401 from Pollinations' anonymous tier
   (this environment's shared egress IP) made single-reseller dependency
   the pipeline's biggest availability risk.
3. **The refactor collapsed the cost of doing it right** — provider-specific
   surface shrank to one adapter file per provider.

### Design (implemented)

- **`src/core/models.js`** — `PROVIDERS` registry (models + capability
  flags: `paidOnly`, `supportsTransparent`, `supportsSeed`); env-free so
  the browser can import it. `resolveModel()` accepts bare ids
  (pollinations-first, then unique cross-provider match) or
  `"provider:model"`.
- **`src/node/providers/`** — one adapter per provider implementing
  `{ id, name, keyEnv, maxUnitsPerAxis, isConfigured(), generateImage(request) }`.
  `maxUnitsPerAxis` is the key geometry difference: Pollinations takes
  arbitrary-size strips (4 units/axis at 512px); OpenAI's fixed canvases
  (1024²/1536×1024/1024×1536) mean one frame/tile per request — the
  orchestrator adapts batch size per provider, and single-unit batches get
  single-sprite/single-tile prompts instead of strip/grid prompts.
- **OpenAI specifics**: POST `/v1/images/generations`, base64 response,
  `background: "transparent"` (native support — verified live, 87%
  alpha-0 pixels on a test sprite), no seed parameter (retries resample),
  no negative prompt (folded into the prompt text), `OPENAI_BASE_URL`
  override for mock testing.
- **Guard against the old failure mode**: a provider with models but no
  adapter (or keys missing) must fail loudly, not silently — missing
  `OPENAI_API_KEY` throws a self-explanatory error, and the browser picker
  never lists providers it can't call (still Pollinations-only until a
  per-provider proxy route exists).

### Deliberately not done yet

- **Gemini direct adapter** — same pattern when wanted; one file.
- **OpenAI-compatible base-URL adapter** (covers local runtimes and many
  hosted services with one adapter) — natural third provider.
- **Browser BYOK** — requires a Vite proxy route per provider so keys stay
  server-side; do when a browser user actually needs it.
- Folding provider choice into `Auto`/quality tiers — that's Phase 2.
