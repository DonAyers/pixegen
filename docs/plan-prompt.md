# Plan prompt: K-Centroid downscale, grid detection, and `pixegen fix`

*Hand this file to the implementing agent as its task prompt. Background and
rationale: [`RETRO-DIFFUSION.md`](./RETRO-DIFFUSION.md). Written 2026-07-14.*

---

You are implementing three post-processing capabilities in the pixegen repo,
ported/adapted from Retro Diffusion's MIT-licensed `pixeldetector`
(https://github.com/Astropulse/pixeldetector — read the source first; it is
one short Python file). Read `CLAUDE.md` and `docs/RETRO-DIFFUSION.md` before
writing code. Work phase by phase, in order; each phase compiles, passes
`npm test`, and gets its own commit before the next begins.

## Hard constraints

- **Core purity**: everything in `src/core/` operates on plain
  `{ data: Uint8ClampedArray, width, height }` rasters with **no DOM, canvas,
  or Node APIs**. Implement k-means and peak-finding by hand — **no new npm
  dependencies** (no scipy equivalents; the needed subset is ~40 lines).
- **No behavior change by default**: existing recipes and the default pipeline
  must produce byte-identical output after your changes. New strategies are
  opt-in; recipe defaults only change later, on eval-sweep evidence.
- **Tests**: Playwright specs. Pure-core tests run in Node with direct ESM
  imports and no `page` fixture — copy the pattern in `tests/exporters.spec.js`.
  Any test touching eval findings must set `PIXEGEN_FINDINGS_PATH` to a temp
  path. Never hit the live API in tests; mock with `PIXEGEN_API_BASE` if a
  test needs the network path at all.
- **MCP**: `bin/pixegen-mcp.js` must never write to stdout (protocol channel);
  log to stderr.
- Attribute ported algorithms: one comment line, e.g.
  `// Ported from Astropulse/pixeldetector (MIT).`

## Phase 1 — K-Centroid downscale in core

**`src/core/quantize.js`**: add
`downscaleKCentroid(sourceData, targetW, targetH, { centroids = 2 } = {})`
with the same contract as the existing `downscaleMode` / `downscaleAverage`
(raster in, raster out). Algorithm: for each output pixel, take its source
tile, k-means the tile's opaque RGB colors to `centroids` clusters (a few
iterations of Lloyd's is enough; seed centroids deterministically, e.g.
min/max-luma colors, so output is reproducible), emit the most common
centroid. Preserve the alpha handling the existing downscalers use (look at
how `downscaleMode` treats transparent source pixels and match it).

**`src/core/pipeline.js`**: add a `downscale` option to `processSourceRaster`
(`'mode' | 'average' | 'k-centroid'`). Default stays exactly today's behavior:
`enhanced` pipeline → `'mode'`, `classic` → `'average'`; an explicit
`options.downscale` overrides. Export a `DOWNSCALE_OPTIONS` list next to
`PIPELINE_MODES` for UI pickers.

**Plumbing** (opt-in surfaces only):
- `src/core/recipes.js`: recipes may carry a `downscale` key; do **not** set it
  on existing recipes yet.
- `bin/pixegen.js`: `--downscale <mode>` flag on `generate`/`sheet`/`tileset`,
  passed through like `--dithering` is (note how the CLI distinguishes
  "unset" from "override recipe default").
- `bin/pixegen-mcp.js`: add the enum to the generation tool schemas.
- Browser: add a Downscale select where the Pipeline/Dithering selects live in
  `src/App.jsx`, driven by `DOWNSCALE_OPTIONS`; wire it into `CompareLab.jsx`
  config axes so A/B can test it.
- The eval loop: make sure `pixegen eval run --challenger '{"downscale":"k-centroid"}'`
  works (check how `src/node/eval-store.js` / the eval runner map challenger
  keys to `processSourceRaster` options — if it forwards settings generically,
  this is free).

**Tests** (`tests/kcentroid.spec.js`): build a synthetic ground-truth sprite
(e.g. 8×8 with 4 distinct colors), upscale it ×8 (use `upscaleRaster` from
`src/core/raster.js`), add deterministic per-pixel noise (±12 per channel,
seeded PRNG), then assert `downscaleKCentroid` recovers ≥95% of pixels exactly
while `downscaleAverage` on the same input recovers fewer (guards that the new
code actually beats the baseline on the case it exists for). Also test alpha
preservation and a non-integer scale factor (65×63 source → 8×8).

## Phase 2 — Pixel grid detection in core

New module **`src/core/gridsize.js`**:

- `detectPixelGrid(raster)` →
  `{ spacingX, spacingY, nativeW, nativeH, confidence }`.
- Algorithm (from pixeldetector): per axis, sum the RGB distance between each
  pixel and its neighbor into a 1-D edge-energy profile; find peaks (local
  maxima above a prominence threshold with a minimum distance — implement a
  small `findPeaks(values, { minProminence, minDistance })` helper, exported
  for testing); spacing = median gap between consecutive peaks; `nativeW =
  round(width / spacingX)`. `confidence` should reflect peak-gap regularity
  (e.g. fraction of gaps within ±1 of the median) so callers can ignore
  low-confidence detections; return `confidence: 0` with spacing 1 when no
  usable peaks exist (photos, flat images).

**Tests** (`tests/gridsize.spec.js`): known sprites upscaled ×3, ×5, ×7 with
noise → assert detected spacing; a blurred upscale (simulate JPEG softness by
box-blurring the upscaled image) → still detects; a random-noise image →
low confidence; a native-res sprite (spacing 1) → doesn't false-positive a
larger grid.

## Phase 3 — `pixegen fix` command + MCP tool

**CLI** (`bin/pixegen.js`):

```
pixegen fix <input> -o <out.png> [--colors auto|N] [--palette <profile>] [--scale <WxH>]
```

Offline, no network. Flow: decode input via `decodeImage` in `src/node/png.js`
(handles PNG and JPEG) → `detectPixelGrid` → `downscaleKCentroid` to the
detected native size (`--scale` overrides detection; warn on stderr when
confidence is low) → optional color step:
- `--palette <profile>`: quantize with `quantizeOklab` against that
  `PALETTE_PROFILES` entry;
- `--colors N`: k-means the image to N colors;
- `--colors auto`: elbow method (Phase 3a below);
- neither: keep detected colors as-is.

Print the detection result (spacing, native size, confidence) and write the
PNG via the existing encode path. Log the run through `src/node/run-log.js`
like other commands.

**Phase 3a — elbow method** in `src/core/quantize.js`:
`estimateColorCount(raster, { maxColors = 128 } = {})` — k-means at increasing
k, total squared distortion, return the k at the elbow (peak of the
improvement-rate second difference). Sample pixels (e.g. cap at ~10k, strided)
to keep it fast on large images.

**MCP** (`bin/pixegen-mcp.js`): tool `fix_pixel_art` taking a file path (match
how existing tools accept inputs/outputs) with the same options; returns the
detection metadata and output path.

**Tests**: CLI-level spec that runs `node bin/pixegen.js fix` on a fixture
built in the test (write a temp PNG of an upscaled noisy sprite using the
node png helpers), asserts output dimensions equal the native size and the
process exits 0. Unit test for `estimateColorCount` on a synthetic image with
a known color count (e.g. exactly 6 colors + noise → estimate in [5, 8]).

## Phase 4 — Advisory validation signal

In `src/node/generate.js`'s validation gate: after decoding the source (before
downscale), run `detectPixelGrid` on the source raster and compare implied
native size to the requested sprite size. On high-confidence disagreement
(detected native res differs from requested by >25% on either axis), record a
**warning** in the run log (`src/node/run-log.js`, a `validation` event) — do
**not** fail or trigger the retry on it; we gather signal first. Keep this out
of `core/validate.js`'s pass/fail checks for now (grid analysis applies to the
pre-downscale source, which those checks never see); a comment in
`validate.js` pointing at the new signal is enough.

## Phase 5 — Eval sweep (needs live API; skip gracefully if unavailable)

`source .env` first (funded `POLLINATIONS_API_KEY`; anonymous tier 401s).
Invoke the **`/eval-sweep` skill** with the `downscale` axis: champion =
current ideal settings per target, challenger = same + `downscale:
"k-centroid"`, on at least the `nes` and `gameboy` targets. Judge by looking
at the PNGs, record verdicts with `pixegen eval record`. Only if results are
decisive, set `downscale: "k-centroid"` on the winning recipes and cite the
trials in the recipe description (follow the existing citation style in
`recipes.js`). If the API is unreachable, note it and leave recipes untouched.

## Phase 6 — Docs

- `CLAUDE.md`: add `fix` to the command list; extend the core module map
  (gridsize.js, new quantize exports, `downscale` option).
- `README.md`: add `pixegen fix` if the README lists CLI commands.
- `docs/last-sesh.md`: rewrite per the session-doc convention.
- `docs/LESSONS.md`: only if a durable lesson emerged (e.g. k-centroid vs mode
  eval outcome).

## Out of scope (do not build; already in the backlog in RETRO-DIFFUSION.md)

Start-frame-conditioned animation, hosted-API features (`check_cost`, styles
endpoint), neural repair, any change to providers or generation requests.

## Verification before finishing

1. `npm test` — full suite green.
2. `node bin/pixegen.js fix <fixture>` on a real upscaled sprite → correct
   native size, clean output (eyeball the PNG).
3. `PIXEGEN_API_BASE=<mock> node bin/pixegen.js generate "a knight" --downscale k-centroid -o /tmp/k.png`
   → succeeds; same command without the flag → byte-identical to pre-change
   output for a fixed mock image.
4. Browser: dev server up, Downscale select visible, A/B tab can pit mode vs
   k-centroid.

Commit per phase, push the branch, and open a draft PR describing what changed
and linking `docs/RETRO-DIFFUSION.md`.
