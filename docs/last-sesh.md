# Last session — K-Centroid downscale, pixel grid detection, and `pixegen fix`

*Session span: 2026-07-14/15 (following the Characters/exports session).
Companion docs: `RETRO-DIFFUSION.md` is the competitive research and
decision record this session executed against; `plan-prompt.md` was the
execution handoff prompt. `Next-Phase.md` holds only what's next,
`LESSONS.md` holds only what generalizes; this doc holds only what just
happened.*

## The brief

Port three post-processing capabilities from Retro Diffusion's
MIT-licensed `pixeldetector` into pixegen's portable core, phase by phase
with a commit + green test suite after each: K-Centroid downscale, pixel
grid detection, and an offline `pixegen fix` repair command, plus an
advisory validation signal and a live eval sweep judging the new downscale
strategy against the existing default. Hard constraint throughout: no
behavior change by default — new strategies are opt-in until eval evidence
promotes them.

## What shipped

1. **K-Centroid downscale** (`core/quantize.js`: `downscaleKCentroid`) —
   per-tile k-means (k=2 default) over opaque colors, emitting the most
   common resulting centroid. `pipeline.js` gained a `downscale` option
   (`'mode' | 'average' | 'k-centroid'`, defaulting to each pipeline's
   existing strategy) plumbed through recipes, the CLI's `--downscale`
   flag, the MCP tool schemas, a new Downscale select in the Generator and
   A/B Test Lab, and the eval-findings settings whitelist.
   `tests/kcentroid.spec.js` proves it recovers a two-color-per-tile noisy
   source exactly where plain averaging never can.
2. **Pixel grid detection** (new `core/gridsize.js`: `detectPixelGrid` +
   `findPeaks`) — per-axis edge-energy profiles, hand-rolled peak-finding
   (prominence + minimum distance), median peak-gap as spacing. Recovers
   native resolution from an upscaled or JPEG-softened image; confidence
   scores peak-gap regularity so callers can ignore low-confidence hits
   (photos, flat images). `tests/gridsize.spec.js`: 3x/5x/7x upscales,
   a box-blurred (JPEG-softness) upscale, random noise, and a
   native-resolution sprite that must not false-positive a larger grid.
3. **`pixegen fix`** (CLI + `fix_pixel_art` MCP tool) — offline repair, no
   network: decode → `detectPixelGrid` → `downscaleKCentroid` to the
   detected (or `--scale`-overridden) native size → optional
   `--palette <profile>` or `--colors N|auto`. `--colors auto` uses a new
   elbow-method `estimateColorCount` (k-means at increasing k, log-space
   second-difference peak — see LESSONS.md for why raw distortion doesn't
   work) and a new `quantizeKMeans` (whole-image k-means color reduction).
   Getting the elbow method reliable required fixing `kMeansRGB`'s
   centroid seeding (fixed-stride → deterministic farthest-point/
   greedy-k-center), which also improved K-Centroid downscale's cluster
   quality as a side effect. `tests/fix.spec.js`: CLI-subprocess spec plus
   an `estimateColorCount` unit test against a known 6-color image.
4. **Advisory grid-size validation signal** (`src/node/generate.js`) —
   every `generateSprite` attempt runs `detectPixelGrid` on the raw source
   (before downscale) and logs a `grid-size-mismatch` warning when a
   high-confidence detection disagrees with the requested sprite size by
   >25%. Deliberately never fails validation or triggers the retry — we're
   gathering signal, not gating on it yet. Verified against a mock
   provider serving a genuinely-coarse 8x8-native image at a 32x32
   request: correctly logged without touching the pass/fail outcome.
5. **Live eval sweep, downscale axis** — 3 trials (funded key, `source
   .env`) at nes and gameboy's current ideal settings, judged by eye:
   nes tied (marginal edge-softness difference, not decisive — recipe left
   alone); gameboy won twice decisively (mode downscale was losing
   subject detail at the aggressive 16x16 factor, in one trial almost
   entirely). Promoted `gameboy-tiny`'s recipe to `downscale: "k-centroid"`
   with citation in its description, following the existing style.

Verification state at session end: **all Playwright tests passing**
(`integration.spec.js` excluded as the documented stale pre-React suite —
unaffected by this session), CLI `fix` verified end-to-end against a real
upscaled-sprite fixture, mock-server smoke test confirmed
`--downscale k-centroid` byte-differs from the untouched default while the
default itself stays byte-identical across runs, MCP `fix_pixel_art` tool
verified via a live stdio round-trip (tool list + call).

## Forks in the road, and which way we went

- **Elbow-method formula: literal raw second-difference vs. normalized** →
  normalized (log-space). The plan's literal wording ("peak of the
  improvement-rate second difference") picked k=2 on every test seed
  against a real distortion curve; empirically verifying against a
  known-color-count synthetic image (rather than trusting the formula on
  paper) caught this before it shipped. See LESSONS.md.
- **K-Centroid downscale test design: literal per-pixel jitter vs.
  two-cluster-per-tile noise** → two-cluster (bleed) noise. Pure symmetric
  per-pixel jitter with no genuine second cluster in a tile actually favors
  plain averaging (it uses all N tile samples; K-Centroid's cluster split
  uses fewer) — verified empirically before locking in test expectations,
  not assumed from the algorithm's stated purpose.
- **Phase 4's scope: all three generation flows vs. sprite-only** → sprite
  only. The plan's wording was singular ("the source"); sheets/tilesets
  batch multiple frames per request, so "requested sprite size" doesn't
  map 1:1 to one source raster the same way. Left as a clean, scoped
  extension rather than forcing an ambiguous generalization.
- **Downscale UI default: hardcode "mode"/"average" in the select vs. an
  explicit "Auto" option** → explicit "Auto (pipeline default)" as the
  select's default value (empty string), so switching pipelines can't
  silently strand the downscale choice at a stale explicit value — matches
  the "no behavior change unless the caller opts in" constraint exactly.
- **gameboy-tiny promotion threshold** → 2 decisive (non-tie) trials on a
  second prompt/seed, not just the first win. The first trial's difference
  was dramatic enough to look conclusive on its own, but recipes ship to
  everyone — one more trial with an explicit champion reset (see the
  eval-champion-inheritance gotcha in LESSONS.md) confirmed it wasn't a
  one-off before editing `recipes.js`.

## Cans kicked down the road (deliberately)

- **nes's downscale axis** — tied once, not decisive either way.
  `nes-classic`'s recipe is untouched; more trials (different sources,
  maybe a noisier model) could tip it either direction.
- **`--colors`/`--palette` on sheets/tilesets** — `pixegen fix` operates on
  a single already-flattened image; sheet-aware repair (fix each frame of
  an existing strip consistently) isn't built.
- **Grid-detection advisory signal has no consumer yet** — it's logged to
  JSONL and nothing reads it back out. A `pixegen eval status`-style
  aggregate ("N% of generations show grid mismatch, by model") would turn
  the gathered signal into an actual decision input.
- **`estimateColorCount` at `maxColors: 128` is ~4s on a 64x64 image** —
  fine for `pixegen fix` (runs on the small post-downscale native image,
  not the large source), but worth remembering if it's ever called on a
  bigger raster.
- **Full downscale-axis sweep beyond nes/gameboy** — snes/genesis/c64/atari
  untested; the plan scoped this session to "at least nes and gameboy."

## What worked well

- **Empirically verifying algorithm behavior before writing test
  expectations, every phase.** Both the elbow method and the K-Centroid
  test design would have shipped with silently-wrong or misleadingly-easy
  tests if the expected numbers had been guessed from the algorithm
  description instead of measured with a scratch script first.
- **Phase-by-phase commits with a full green suite between each** caught
  the kMeansRGB seeding regression risk immediately — Phase 3's seeding
  fix touched code Phase 1 had already shipped and tested, and rerunning
  `tests/kcentroid.spec.js` before moving on confirmed no silent
  regression instead of finding out at the end.
- **Live eval trials over trusting the algorithm's stated purpose.** The
  RETRO-DIFFUSION.md research said K-Centroid is noise-robust; the actual
  live trials showed *where* — clearly on gameboy's aggressive 16x16
  downscale, genuinely tied on nes's gentler 32x32 — evidence a synthetic
  benchmark alone wouldn't have produced.

## What didn't work as well

- **First live eval trial silently 401'd inside `run_in_background`**
  despite `source .env` succeeding in every foreground check — cost one
  wasted trial (real API attempt, immediate failure) before isolating it
  to background-execution env propagation. `set -a; source .env; set +a`
  fixed it; see LESSONS.md's environment-quirks section.
- **First champion-reset attempt for the second gameboy trial also
  silently no-oped** (`--champion` without the `downscale` key let the
  already-won value ride through) — caught by `eval run`'s own "identical
  to champion" guard rather than a wasted generation, but worth the
  explicit lesson entry since it'll recur on any axis re-test.
