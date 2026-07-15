# Lessons learned

Durable engineering lessons from building PixelGen — the things that cost a
debugging loop (or a whole session) to learn, kept so they only have to be
learned once. Dated by when the lesson landed. `docs/last-sesh.md` holds the
narrative of the most recent session; this file holds only what generalizes.

## Algorithms

**K-means centroid seeding determines whether "more clusters" is even
monotonically better** (2026-07-15). `estimateColorCount`'s elbow method
needs distortion(k) to (roughly) decrease as k grows — that's the entire
premise of "find where it flattens." Fixed-stride/index-based seeding
(pick every Nth sample as an initial centroid) produced a *non-monotonic*
curve once k passed ~6: some larger k landed in a worse local optimum than
a smaller k, because arbitrary index-based seeds can double up inside one
true cluster and leave another cluster unseeded. Deterministic
farthest-point sampling (start at the min-luma point, repeatedly add
whichever remaining point is farthest from every centroid chosen so far —
greedy k-center) fixed it completely and is still RNG-free/reproducible.
If a k-means-derived signal ever misbehaves as k grows, check the seeding
before the math.

**Elbow detection must run in log-distortion space, not raw distortion.**
A k-means distortion curve decays roughly geometrically with k, so the
raw discrete second difference is dominated by the huge absolute drops at
small k — on a real curve this picked k=2 for a known-6-color test image
every time, regardless of where the curve actually flattened. Taking the
second difference of `log(distortion + 1)` instead (log-drop ≈ percentage
improvement, which is what "improvement rate" should mean) fixed it to
6/6 across 8 seeds. Any curve that decays multiplicatively needs its
"rate of change" measured on a log or relative scale, not an absolute one
— true for elbow methods generally, not just this one.

## Testing & verification

**Mock-only verification can hide a total-failure bug indefinitely**
(2026-07-13). Live Pollinations serves JPEG for non-transparent models; the
Node path hard-decoded PNG, so every live CLI/MCP generation failed while
every mock-based smoke test passed — for a full session. When a credential
or environment finally makes the real path possible, run one true
end-to-end generation *first*, before building anything on top of it.

**A tolerant reader hides a broken writer** (2026-07-14). `saveAllFrames`
stored every batch frame with `frame: 0` (a `{ ...meta, frame: i }` spread
where the loop's `i` was always 0 for single-element calls). The Explorer
never noticed because its group-by assigns `frames[row.frame] = row` — rows
silently overwrote each other and the UI showed "a" frame. The bug only
surfaced when a new reader (`loadCharacterFrames`) deduplicated by frame
index and returned one frame instead of four. When a read path collapses
duplicate keys, prefer code that *would* fail loudly on impossible data —
the Characters tab found in one test run what the Explorer masked for weeks.

**Helpers must not overwrite caller-supplied fields.** The root cause above
was spread order: `{ ...meta, frame: i }` clobbers an explicit `meta.frame`.
`{ frame: i, ...meta }` gives the caller the last word and keeps the default.
Any "fill in defaults" helper should put the defaults *before* the spread.

**Playwright doubles as the unit-test runner for the portable core.** Spec
files execute in Node, so pure `src/core/` modules can be imported and
tested directly (`tests/exporters.spec.js`) with no browser, no fixture, and
sub-second runtime. No second test framework needed.

**Judge images by eye at 8–12× nearest-neighbor upscale** (2026-07-13). Raw
32×32 output is too small to evaluate in any terminal/image view; every eval
verdict became reliable once previews were upscaled first (`eval run` writes
`a_preview.png`/`b_preview.png` for exactly this reason).

## UI architecture

**The second copy of a UI wiring is the moment to extract it** (2026-07-14).
The animation player had three near-identical integrations (Generator,
Explorer, and a third coming for Characters), and each had drifted: the
Generator never resynced frames when the animation state changed, and the
Explorer reached into the player's private `_drawFrame`. One shared
`AnimationPreview` component removed ~200 lines, fixed both drifts, and made
the third consumer a one-liner. Duplicated wiring doesn't just cost lines —
it forks bug-fix history.

**Module-level stores + `useSyncExternalStore` scale better than lifting
state into App.jsx.** `run-tracker.js` and `settings.js` let any tab read or
write cross-cutting state without prop-drilling through a 2000-line
component. New cross-tab concerns should follow that pattern, not add props.

## Prompting image models

**Build prompts as structured data, render them late** (2026-07-14). The
original builders concatenated one flat comma list; fragments were
duplicated ("side view, profile view, facing right"), unordered, and
untestable. Prompts are now an ordered section spec (format → style →
subject → view → action → background) rendered with sentence boundaries
between sections and numbered frame lists — inspectable, testable, and
composable (a Character's locked subject/style notes drop into named slots).
Any prompt wording change should still be validated through the eval loop:
structure is refactoring, wording is a behavioral change.

**A wired feature isn't a shipped feature if the defaults can't use it**
(2026-07-13/14). Reference-image cohesion (`image=`) was fully plumbed in
the Node path but a silent no-op because the default models (flux, zimage)
have `maxReferenceImages: 0`. Capability-gate at the model registry, and
*surface the gate in the UI* (the Characters tab says whether the selected
model will actually use the reference) — otherwise users assume the feature
works everywhere.

**`negative_prompt` is best-effort at most** (2026-07-13). A same-seed
baseline/negative/dummy-param triptych on flux produced identical images.
Passthrough kept; no feature claims made on it.

## Providers & network

**The proxied URL is not the public URL.** Anything that hands a URL to a
third party — e.g. reference-image conditioning, where Pollinations must
fetch the reference itself — must reconstruct the upstream equivalent
(`https://gen.pollinations.ai/image/<path>`), not the browser's
`/api/pollinations/<path>` proxy path. Strip client-only markers
(`pixegen_free=1`) too.

**`eval run`'s auto-picked champion silently inherits whatever already won**
(2026-07-15). Champion resolution is `{...baseline, ...idealSettingsForTarget(...)}`
merged with any `--champion` override — but the override only *overwrites
keys it names*. Once a trial records axis X as a winner, that value lives in
`eval/findings.json`'s ideal and becomes part of every later "current
ideal" champion, including one meant to re-test axis X against its old
default: `--champion '{"otherKey": ...}'` (no mention of X) silently
carries the winning X-value through, so the "champion vs challenger" trial
ends up comparing X against itself (`eval run` correctly refuses this with
"Challenger settings are identical to the champion", which is the tell).
To re-test an axis that has already won once, explicitly reset it in
`--champion` (e.g. `"downscale": null`), don't rely on the auto-picked
baseline.

**Live-API latency variance dominates wall-clock planning** (2026-07-13).
The same flux call ranged 1.8 s off-peak to 9+ min under queue congestion —
it's queuing, not inference. Design responses: parallel batches, slow-request
failover chains, background everything long-running, and never let a catalog
fetch block generation (stale cache beats network-at-generation-time).

**Upstream moderation can block a whole model out from under you**
(2026-07-13) — gptimage 422'd on a benign prompt because the *reseller's*
shared upstream was flagged. A BYOK lane is the escape hatch; model-axis
eval coverage must tolerate models being temporarily unavailable.

## Persistence

**Additive Dexie migrations + read-path fallback beat destructive
backfills.** v4 added the `characters` table and a `characterId` FK on
sprites; legacy rows keep working through the `characterName` string, and
`adoptSpritesByName()` links them lazily when a Character is created for an
existing name. No migration ever rewrote sprite rows, so a failed upgrade
can't corrupt saved art.

**Store the recovery handle at write time.** Sprite rows now save the
upstream `sourceUrl` alongside the source blob because "promote this old
generation to the character's reference image" needs a URL that no longer
exists anywhere else once the generation completes. If a later feature might
need it and it's one string, save it now.

## Export formats

**One internal model, many thin emitters.** Engine exports (Phaser,
Aseprite, Godot, love2d, Unity) share a single sheet model that owns packing
geometry, per-frame durations, and pivots; each format is a pure ~40-line
serializer over it. Adding a format never touches layout math, and geometry
tests run once against the model instead of five times against strings.
Watch the coordinate conventions: Unity rects are bottom-left-origin and its
pivot y is inverted relative to ours.

## Environment quirks

- The CLI does **not** auto-load `.env` — `source .env` before keyed live
  runs (2026-07-13).
- Network calls from outside the project directory can fail (curl 000)
  under the sandbox; run from the repo with absolute output paths
  (2026-07-13).
- Anonymous-tier Pollinations 401s from this environment; the funded key in
  `.env` works.
- `source .env` in a foreground shell call exports for that call's child
  processes fine, but a script run via the harness's background-execution
  path needs `set -a; source .env; set +a` (force-export) or the sourced
  vars don't reach the spawned `node` process and generation 401s with "no
  POLLINATIONS_API_KEY set" even though the key is right there (2026-07-15).
