---
name: eval-sweep
description: Sweep generation/processing config combinations for one prompt against a palette target, judge each trial by looking at the images, and record verdicts into eval/findings.json — the data-assembly loop behind per-target "ideal" settings and recipe promotion. Use when asked to run an eval sweep, test config combinations, gather ideal-settings evidence, or validate/promote recipes.
---

# Eval sweep — assemble evidence for a target's ideal settings

You are the judge in PixelGen's champion-vs-challenger eval loop
(`eval/README.md`). This skill runs a structured sweep: one prompt + one
seed, varied across config axes, each variation judged by **looking at the
output images** and recorded into `eval/findings.json`. The winner of each
trial becomes the target's new ideal, so the sweep is a greedy hill-climb
across the config space — the pairwise-verdict format the knowledge base
is built on.

## Arguments (all optional)

- `target` — palette profile (`nes`, `snes`, `genesis`, `gameboy`, `c64`,
  `atari`, `none`). Default `nes`, or sweep several if asked.
- `prompt` — the "idea" under test. Default: generate one with
  `node bin/pixegen.js idea -p <target>` and reuse it for EVERY trial.
- `seed` — pick one random integer up front and reuse it for EVERY trial.
- `full` — only if the user explicitly asks for the full cross-product;
  see "Full matrix mode" below. Never default to it.

## Setup (once per sweep)

```bash
source .env    # POLLINATIONS_API_KEY — the CLI does not auto-load it
node bin/pixegen.js eval status   # current ideals; champion starts here
```

- Every generation goes through `PIXEGEN_TIMEOUT_MS=560000 node bin/pixegen.js eval run ...`.
  Live latency varies from 30s to 8+ min; run trials in the background
  (one at a time — trials write findings.json and champion state chains)
  and do other work between checks if the queue is slow.
- **Probe for upstream-blocked models first**: a fast (~1-2s) 422 means the
  model's upstream deployment is blocked for everyone (see
  docs/last-sesh.md) — skip that model and note it in the final summary:

```bash
curl -s --max-time 20 -o /dev/null -w "%{http_code} %{time_total}s\n" \
  "https://gen.pollinations.ai/image/probe?model=<model>&width=256&height=256&seed=1&nologo=true" \
  -H "Authorization: Bearer $POLLINATIONS_API_KEY"
```

## The axes (sweep in this order — biggest effect first)

For each axis, run one trial per alternative value the current ideal does
NOT already use. The champion is always the target's current ideal —
`eval run` picks it up automatically, so record each verdict before
starting the next trial.

1. **model** — free-tier models worth testing: `flux`, `zimage`,
   `gptimage`, `gpt-image-2`, `klein`, `nova-canvas` (skip any that probe
   as blocked; `kontext` is edit-focused, include only in `full` mode).
2. **autoCrop** — `true`/`false`. Historically the biggest single lever;
   at ≤16px it decides whether the sprite is readable at all.
3. **preprocessing** — `"none"` / `"standard"` / `"strong"`. Clean modern
   sources tend to prefer `none` (over-processing amplifies noise).
4. **dithering** — `null` / `"bayer"`. Bayer tends to lose on flat
   backgrounds but may win on gradient-heavy subjects.
5. **outlines** — `true`/`false`. Often a no-op when the source draws its
   own outlines.
6. **cleanup** — `true`/`false`.
7. **spriteSize** — the target's default scale ±1 step (e.g. nes 32x32 →
   try 24x24 and 48x48) — only if the user wants the size axis explored.

Trial command shape:

```bash
PIXEGEN_TIMEOUT_MS=560000 node bin/pixegen.js eval run \
  --target <target> --prompt "<the one prompt>" --seed <the one seed> \
  --challenger '{"<axis>": <value>}' --out ./eval-out/<target>-<axis>-<value>
```

## Judging (the part that must not be automated away)

`eval run` writes `a_preview.png` / `b_preview.png` (upscaled) next to
`a.png` / `b.png`. **Read both preview images and look at them.** Judge on
the three axes from docs/Next-Phase.md §2, in priority order:

1. **Silhouette clarity** — readable at game scale? Squint test. A sprite
   you can't identify loses regardless of anything else.
2. **Edge cleanliness** — no muddy/AA'd border pixels, no background
   speckle noise.
3. **Palette conformance** — looks like it belongs on the target hardware.

Tie-break toward the sprite you would actually ship in a game on that
console. Ties are fine (`--winner tie`) — they record the comparison
without moving the ideal. Then:

```bash
node bin/pixegen.js eval record <trialId> --winner a|b|tie --notes "<why — one concrete observation>"
```

Notes are the lessons-learned trail future agents read: name WHAT differed
visually and WHY it decided the verdict ("bayer dithered the flat
background into checkerboard noise"), never just "B looks better".

## Wrap-up (always do all of these)

1. `node bin/pixegen.js eval status` — show the resulting ideals.
2. Summarize as a table: axis → winner → one-line reason, plus skipped
   models and why.
3. **Promotion check**: if a target's ideal has ≥5 decisive trials without
   movement, update the matching recipe in `src/core/recipes.js` to those
   settings and drop its `provisional: true` flag (see eval/README.md
   "Relationship to recipes"). If it moved during this sweep, say how many
   more stable trials are needed.
4. If the sweep's evidence contradicts a recipe default that was already
   promoted, flag it to the user rather than silently re-editing.

## Full matrix mode (`full` — explicit opt-in only)

The cross-product of all axes is hundreds of generations (each trial = 2
images, 0.5–8 min per image live). If the user explicitly asks for it:
estimate the count first (`models × 2 × 3 × 2 × 2 × 2 × sizes`), tell them
the estimate, and get confirmation on scope before starting. Prefer
trimming to: all models × {autoCrop on/off} × {preprocessing none/standard}
with everything else held at the current ideal, judged the same way. Use
one `--out` directory per combination, named for its config.

## Cost/safety notes

- One prompt + one seed per sweep — cross-trial comparability is the whole
  point. Pollinations caches by URL, so the champion side of later trials
  is usually a cache hit (fast and free).
- Do not run trials for two targets interleaved (findings.json is
  read-modify-write; sequential per process is safe).
- `eval run` deliberately skips validation-gate retries — both sides must
  keep the same seed. Don't "fix" that.
