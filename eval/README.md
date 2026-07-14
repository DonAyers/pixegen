# Eval loop — finding the ideal settings per console target

This directory is PixelGen's persistent knowledge base for **which
generation/processing settings actually look best per console target**
(NES, SNES, Genesis, Game Boy, C64, Atari, none). `findings.json` holds
every judged trial and the current per-target **ideal settings**; it's
committed to the repo so results accumulate across sessions and agents.

The loop is champion/challenger:

1. **Champion** = the target's current ideal (or its recipe baseline if no
   trials exist yet). **Challenger** = champion with one deliberate change
   (dither on/off, outlines off, preprocessing none, a different scale...).
   Same prompt, same seed, same model — vary ONE axis per trial so the
   verdict is attributable.
2. **Judge** the two results by looking at them (readability at game scale,
   clean edges, palette feel — the §2 axes in docs/Next-Phase.md).
3. **Record** the winner. The winner's settings become the target's ideal;
   the next trial starts from there.

## Running the loop as an agent (CLI)

```bash
# 1. See where things stand — which targets have ideals, what's pending
node bin/pixegen.js eval status

# 2. Run a trial: champion (current ideal) vs challenger (one change).
#    Uses a random era-appropriate prompt unless --prompt is given.
node bin/pixegen.js eval run --target nes --challenger '{"dithering":"bayer"}'
#    → writes eval-out/<trialId>/a.png (champion) and b.png (challenger)
#      plus trial.json, and appends a pending trial to findings.json

# 3. LOOK at both PNGs (you have vision — use it), then record:
node bin/pixegen.js eval record <trialId> --winner b --notes "bayer reads better on gradients"

# 4. Repeat. Next `eval run` for that target starts from the new ideal.
```

Judgment axes (from docs/Next-Phase.md §2): **palette conformance** (looks
like it belongs on the target hardware), **edge cleanliness** (no muddy/AA
border pixels), **silhouette clarity** (readable at game scale — squint or
zoom out). Prefer the sprite you could actually ship in a game on that
console.

Guidelines:
- Vary **one axis per trial**; note *why* the winner won in `--notes` —
  notes are the lessons-learned trail future agents read.
- Use the same model per target unless the model itself is the axis under
  test. `flux` (free) is the default baseline model.
- A few good axes to explore per target: `dithering` (null vs "bayer"),
  `outlines` (true/false), `cleanup` (true/false), `preprocessing`
  ("none"/"standard"/"strong"), `spriteSize` steps, and eventually `model`.
- Ties are fine (`--winner tie`) — they record the comparison without
  moving the ideal.

## The human path (UI)

The **A/B Test tab** has "👑 A wins / 👑 B wins / Tie" buttons after a
comparison; they record trials into this same file through the dev server
(`npm run dev` must be running — the endpoint is dev-middleware only). The
**Generator tab**'s "✨ Ideal" button applies the recorded ideal for the
selected System.

## Relationship to recipes

`src/core/recipes.js` holds the *named, shipped* presets (still marked
`provisional`). This knowledge base is the evidence layer under them: when
a target's ideal stabilizes (say, 5+ decisive trials without movement),
promote it into the corresponding recipe and drop that recipe's
`provisional` flag — that's how the loop's findings reach the CLI/MCP
defaults.

## File format

`findings.json`: `{ version, ideal: { <target>: { settings, trials,
updatedAt, lastTrialId } }, trials: [ { id, date, target, prompt, seed,
model, a, b, winner, notes, source } ] }`. Settings shape:
`{ model, spriteSize, pipeline, dithering, outlines, cleanup,
preprocessing }`. Edit by hand only to fix mistakes; otherwise go through
`pixegen eval record` / the UI so the ideal-update rule stays consistent.
`PIXEGEN_FINDINGS_PATH` overrides the file location (used by tests).
