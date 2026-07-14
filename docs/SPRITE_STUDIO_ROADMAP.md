# PixelGen → Sprite Studio: Architecture Audit & Roadmap

This document audits the current codebase against the goal of becoming a
**robust pixel art sprite studio** that can:

1. Generate whole, cohesive **tilesets** (not just single character sprites)
   from natural-language theme/style/palette input.
2. Pull in assets from **external open-source sources** (palettes, reference
   art) rather than only generating from scratch.
3. Do so **cost/request-efficiently** — minimizing wasted AI generation calls.

It is organized as: current architecture → concrete flaws → target
architecture → phased roadmap. File paths refer to the current tree.

---

## 1. Current architecture (as-built)

- **UI**: `src/App.jsx` (~1920 lines, one component) holds nearly all state
  (form, animation, playback, save/load) across three tabs — Generator,
  Inspector, Explorer (`src/Explorer.jsx`).
- **Generation** (`image-service.js`): builds a single text prompt per call,
  hits Pollinations (`provider-service.js` — the only provider) via a GET URL
  through the Vite proxy. Two entry points:
  - `generateImage` — one frame, one AI call.
  - `generateSpriteSheet` — N animation frames as **one image**, a horizontal
    strip, sliced client-side. This is the one place the app already batches
    multiple outputs into a single AI request.
- **Processing** (`image-preprocessor.js` → `pixel-processor.js`): denoise/
  sharpen/contrast pass, then downscale + OKLAB or bit-reduce quantization to
  a console palette (`palettes.js`), optional outline/cleanup.
- **Domain model**: everything is shaped around a *character* —
  `characterName` × `animState` × `view` × `frame` (`animation-states.js`,
  `sprite-storage.js`). There is no unit of "tile," "tileset," or "theme."
- **Storage**: Dexie/IndexedDB, one `sprites` table + one `sheets` table,
  versioned migrations via `.upgrade()`.
- **Providers**: Pollinations only, deliberately (see `docs/PROVIDERS.md`).
  No local/offline provider, no image-to-image/reference-conditioned
  provider path wired up even though the provider list already includes an
  editing-capable model (`kontext` — FLUX.1 Kontext, "in-context image
  editing").
- **External assets**: none. There is no import path for palettes, reference
  images, or third-party sprite/tile packs anywhere in the code.

---

## 2. Flaws and pitfalls

### A. No tileset concept exists at all
The entire data model (`animation-states.js`, `sprite-storage.js`,
`sprite-sheet.js`) is single-character-and-its-animation-frames shaped. A
tileset — a grid of terrain/prop tiles with autotile edge relationships
(grass↔dirt, water corners, etc.) — has no representation: no tile role, no
grid coordinate, no adjacency metadata. Bolting tilesets onto the current
schema by reusing `animState`/`view` fields would be a hack, not a fit.

### B. "Cohesive look and feel" is prompt-text-only, and fragile
`buildPrompt`/`buildSheetPrompt` (`image-service.js:47-139`) achieve
consistency purely by repeating the same style tokens in every request
string. There is no image-conditioned consistency mechanism, even though:
- `nanobanana`/`nanobanana-pro`/`kontext` are all vendor models capable of
  image-to-image/edit-style conditioning, per their own descriptions in
  `provider-service.js:28-35`.
- Nothing in `image-service.js` ever sends a reference image — every call is
  a fresh text-to-image request with no seed image, only a numeric `seed`
  parameter (which affects RNG, not composition/style).

For a single sprite this is tolerable. For a *tileset*, where dozens of tiles
must share one palette, one light direction, and one line weight, text-only
consistency will visibly drift tile-to-tile — this is the single biggest
functional gap versus the stated goal.

### C. The one existing "batch" pattern doesn't scale, and the other one is wasteful
- `generateSpriteSheet` (`image-service.js:258-274`) hard-codes
  `width = Math.min(1920, frameCount * 512)`. Above ~4 frames, per-frame
  width shrinks instead of the canvas growing — a tileset of 16–64 tiles
  built this way would compress each tile into a sliver, producing garbage.
  There's also no vertical axis: it's a 1×N strip generator, not an M×N grid.
- Meanwhile `handleGenerateAllFrames` (`App.jsx:469-506`) generates each
  frame with its **own separate AI call** in a sequential loop, and the
  "Generate Sheet" button doing the batched 1-call version exists
  side-by-side as a *different* user action. A user generating a 4-frame
  walk cycle via "Generate All Frames" pays for 4 AI requests when the app
  already has code (`generateSpriteSheet`) that does the equivalent in 1.
  Nothing in the UI steers users toward the cheaper path, and for a tileset
  workflow (potentially dozens of units) this gap in default behavior is the
  main token/cost risk.

### D. Provider layer is Pollinations-URL-shaped, not adapter-shaped
`generateImage`/`generateSpriteSheet` build a Pollinations-specific query
string directly (`?model=&width=&height=&nologo=true...`) rather than
calling through a `provider.generate(prompt, opts)` interface. `docs/PROVIDERS.md`
itself documents this bit them once already — dead OpenAI/Gemini code paths
were removed because they silently produced failing requests since the
GET-URL shape doesn't match those vendors' real (POST+JSON) contracts. The
same trap is waiting for any future local/offline provider (e.g. a
self-hosted ComfyUI + pixel-art-xl backend, which `docs/PROVIDERS.md §3`
already flags as the natural next step) or for treating "import from an
external asset source" as a pseudo-provider — neither can be added cleanly
without an adapter boundary.

### E. No external asset ingestion of any kind
There is no code path to pull in a palette, reference sprite, or tile pack
from outside the app. This affects the "pull in assets from external
sources" goal directly. Two concrete, verified options exist and were not
previously evaluated in this codebase:
- **Lospec Palette List API** (`https://lospec.com/palettes/api`) — real,
  documented, returns `{name, author, colors[]}` (hex) for a palette by
  slug. No search endpoint, but ideal for "specify a palette by name" since
  it's already the de facto retro-palette registry pixel artists use, and it
  returns exactly the `[R,G,B]` triplet shape `palettes.js`'s `CONSOLES`
  registry expects (after hex→RGB conversion).
- **OpenGameArt.org** — repeatedly requested by its own community, but **has
  no official public API** (confirmed via current forum threads); only
  unofficial scraping tools exist. Do not build a load-bearing integration
  against it without accepting that risk explicitly.

### F. Storage schema has no home for "project" or "theme"
`sprite-storage.js`'s `sprites`/`sheets` tables key on
`characterName+animState+view+frame`. A themed multi-asset project (one
palette + one style description + N sprites + M tiles, all meant to look
like one game) has nowhere to live. Every generation is an island; there's
no way today to say "regenerate this tile using the same theme as that
sprite."

### G. Redundant recomputation on every settings tweak
`App.jsx:451-466` re-runs the *entire* pixelation pipeline
(`handleReprocess`) on every dependency change (console, dither, pipeline,
outlines, cleanup, preprocessing mode) via a `useEffect`. This is local CPU,
not AI spend, so it's not a cost problem, but for a tileset view rendering
dozens of tiles at once this same pattern (if copied naively per-tile) would
multiply badly — worth designing the tileset preview to batch/memoize
per-tile reprocessing rather than replicate this per-tile from day one.

### H. Test coverage doesn't reach the batch/sheet paths
`tests/ui.spec.js` mocks single-image generation only (per `CLAUDE.md`).
`tests/integration.spec.js` is already known-stale. There is currently no
test exercising `generateSpriteSheet`/`processSpriteSheet`, so the exact
scaling bug in §C(1) has no regression net — worth fixing before building a
tileset feature on top of the same code path.

---

## 3. Target architecture

### 3.1 New domain concept: **Project** (the "theme" container)
A Project is the unit of cohesion: `{ name, themeDescription, styleTokens,
consoleId, paletteRef, referenceImageBlob, createdAt }`. Every sprite *and*
every tile generated "in" a project inherits its style tokens, palette, and
(where the model supports it) reference image, instead of re-deriving style
purely from re-typed prompt text each time.

- `paletteRef` can point at a built-in `CONSOLES` entry (today) **or** an
  imported Lospec palette (§3.3), unified behind the same
  `{ palette: [[r,g,b],...] }` shape `pixel-processor.js` already consumes —
  no processor changes needed, only a palette *source*.
- `referenceImageBlob` is the first accepted generation in the project;
  subsequent generations that use an image-capable model (`kontext`,
  `nanobanana*`) pass it as conditioning input, giving actual visual
  cohesion instead of prompt-text repetition alone.

### 3.2 New domain concept: **Tile** and **Tileset**
Parallel to `ANIMATION_STATES`/`VIEWS`, add a `TILE_ROLES` registry
(`tile-roles.js`) describing autotile-relevant roles (e.g. `grass`,
`grass-dirt-edge-n`, `water-corner-ne`, `path`, `prop-tree`) the same way
`ANIMATION_STATES` describes frame hints — each role carries a
`promptHint` used the same way `frameHints` are used today.

Generation reuses the *already-proven* batching pattern from
`generateSpriteSheet`, generalized to a grid:
- `generateTileGrid(prompt, { cols, rows, tileRoles, ... })` — **one AI
  call** producing a `cols × rows` grid, analogous to today's 1×N strip.
- Fix the scaling bug from §C(1): compute canvas size as
  `tileSize * cols` × `tileSize * rows` up to the model's real max
  resolution, and when a tileset is too large for one call, split into
  multiple grid-batches (still far fewer calls than one-per-tile) rather
  than silently shrinking every tile.
- Slicing/quantization reuses `pixel-processor.js`'s existing
  `processSpriteSheet` slice-and-quantize logic (already frame-count aware;
  generalize `frameCount` → `{cols, rows}`).

### 3.3 External asset import (`asset-import-service.js`, new)
Modeled after `provider-service.js`'s `PROVIDER_CONFIGS` pattern — pluggable
source adapters, not one hardcoded integration:
- **Lospec adapter (Phase 2, do first)**: fetch-by-slug against the
  documented `lospec.com/palettes/api`, convert hex → `[r,g,b]`, store as a
  user palette alongside `CONSOLES`. Directly satisfies "specify a palette"
  from natural language (map a theme like "sunset desert" to a matching
  Lospec palette search the user does manually today, or a curated
  shortlist you ship).
- **Local pack import (Phase 2/3)**: let a user drop in a CC0/CC-BY asset
  pack (e.g. a Kenney pack, downloaded manually — Kenney has no API either)
  and run each image through the *existing* `pixel-processor.js` pipeline
  to normalize it to the project's console/palette, so imported and
  AI-generated assets end up visually consistent.
- **OpenGameArt adapter**: explicitly deferred — no official API exists
  (verified). Only revisit if an unofficial scraper's maintenance burden is
  acceptable, and treat it as best-effort/optional, never a hard dependency.

### 3.4 Provider adapter boundary (hardening, not a rewrite)
Introduce a small interface each provider config implements:
```
{ generate(prompt, opts) -> Promise<Blob>, capabilities: { imageConditioning: bool } }
```
`image-service.js` calls this interface instead of building Pollinations
URLs inline. Pollinations' current GET-URL builder becomes the *first*
implementation, not the only shape the codebase understands. This is what
makes 3.1's reference-image conditioning and any future local provider
(`docs/PROVIDERS.md §3`'s ComfyUI suggestion) addable without another
silent-failure incident like the one `docs/PROVIDERS.md` already recorded.

### 3.5 Storage additions
Dexie `version(3)` (append, don't rewrite — follow the existing
`version(2).upgrade()` pattern in `sprite-storage.js:20-40`):
```
projects: '++id, name, consoleId, createdAt'
tiles:    '++id, projectId, roleId, gridX, gridY, createdAt'
```
`sprites`/`sheets` gain an optional `projectId` foreign key so existing
character-sprite workflows can optionally join a project too — no breaking
change to rows that predate projects.

---

## 4. Token/cost efficiency plan

Concrete, in priority order:

1. **Default batch generation over per-unit generation.** Make the
   sheet/grid path (1 AI call for N units) the default for both animation
   frames and tiles; keep the one-call-per-unit path only as an explicit
   "regenerate just this one" action. Today `handleGenerateAllFrames`
   (N calls) and `handleGenerateSheet` (1 call) are two co-equal buttons
   doing overlapping jobs at very different cost — collapse that choice
   instead of leaving it to chance.
2. **Show cost before firing a big batch.** `PROVIDER_CONFIGS` already
   carries a `cost` string per model (`provider-service.js:28-35`) that
   today is never surfaced. Multiply it by planned request count (e.g. "3
   grid batches × gptimage ≈ $0.024") in the UI before the user commits to
   a large tileset.
3. **Never regenerate what settings-only changes don't require.** The
   existing reprocess-on-settings-change flow (`App.jsx:450-466`) already
   does this correctly for local pixelation — extend the same rule to
   projects: changing dithering/outline settings must never trigger a new
   AI call, only a re-run of `processImage`/`processTileGrid` on the cached
   source blob(s).
4. **Cap and communicate grid size vs. model resolution limits** so a
   tileset request is sized correctly the first time (see §3.2) rather than
   silently degrading and forcing a wasted re-generation to fix it.

---

## 5. Phased roadmap

**Phase 0 — fix what's already broken (small, no new features)**
- Fix `generateSpriteSheet`'s width formula so frame count doesn't shrink
  per-frame resolution (§C(1)); add a test for it (§H).
- Collapse `handleGenerateAllFrames` vs `handleGenerateSheet` into one
  default batched path in the UI.
- Surface per-model `cost` in the model picker.

**Phase 1 — Tileset MVP**
- `tile-roles.js` (parallel to `animation-states.js`).
- `generateTileGrid` + `processTileGrid` (generalize the sheet code path
  from 1×N to M×N).
- New "Tileset" tab in `App.jsx` (or, given `App.jsx`'s size, a new
  `TilesetStudio.jsx` component following the `Explorer.jsx` precedent of
  living alongside `App.jsx` rather than inside it).
- Dexie `tiles` table (§3.5).

**Phase 2 — Cohesion via Project + external palettes**
- `projects` table + minimal Project UI (create/select project, set theme
  description + palette + console).
- Lospec palette import adapter.
- Wire project palette/style tokens into `buildPrompt`/`buildTilePrompt` as
  the source of truth instead of ad hoc per-generation fields.

**Phase 3 — Real visual consistency**
- Provider adapter boundary (§3.4).
- Reference-image conditioning for `kontext`/`nanobanana*` when generating
  additional units within an existing project.

**Phase 4 — External asset packs + App.jsx decomposition**
- Local asset-pack import + normalization through `pixel-processor.js`.
- Split `App.jsx`'s ~1920 lines into a state layer (context/hook,
  `useSpriteGenerator`) + view components, the same way `Explorer.jsx` was
  already pulled out — needed before the Tileset/Project UI adds a third
  and fourth screen's worth of state to the same file.

---

## 6. Open decisions / risks

- **OpenGameArt/itch.io have no stable official API.** Don't commit to them
  as a hard dependency; Lospec is the only externally-verified, documented,
  stable API surface identified so far for this use case.
- **Image-conditioned generation costs more** (per `provider-service.js`'s
  own cost table, `kontext`/`nanobanana-pro` are 4–17x `flux`'s free tier).
  Cohesion-via-reference-image should be opt-in per project, not forced on
  every generation, or it undercuts the token-efficiency goal.
- **`App.jsx` decomposition (Phase 4) is the highest regression-risk item**
  here — it touches every existing feature. Sequence it last, once
  Tileset/Project functionality has proven out the new state shape, so the
  refactor has a real target to design around instead of guessing.
