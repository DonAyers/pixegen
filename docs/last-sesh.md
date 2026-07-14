# Last session — Characters, the shared animation player, structured prompts, and engine exports

*Session span: 2026-07-14 (following the eval/model-registry session).
Companion docs: `Next-Phase.md` holds only what's next,
`LESSONS.md` (new this session) holds only what generalizes; this doc holds
only what just happened. Rinse, repeat — each session rewrites this one.*

## The brief

Make the animation player solid (pull up and play any previously generated
animation), add a **Characters** tab — a persistent identity layer above
individual generations for repeatable, consistent animation sets — fix the
visibly unstructured prompts, and make sprite-sheet output consumable by
real engines (love2d, Godot, Unity, Phaser). User-approved scope decisions:
full pass, all four engine formats (Aseprite JSON as the interchange core),
and "both, model-dependent" consistency (locked description + seed always;
reference image when the model supports it).

## What shipped

1. **Shared `AnimationPreview` component** (`src/AnimationPreview.jsx`) —
   one playback UI (transport, FPS, ping-pong/onion-skin, clickable frame
   strip) over the `AnimationPlayer` class; adopted by Generator, Explorer,
   and Characters. `AnimationPlayer.seek(idx)` is now public API (Explorer
   had been poking `_drawFrame`). Fixed en route: the Generator never
   resynced player frames on animation-state change, and manual "Save
   Frames" dropped `generationGroupId`/settings so re-saves fragmented in
   the Explorer.
2. **The frame-index bug** — `saveAllFrames` clobbered the caller's frame
   index (`{ ...meta, frame: i }`, spread-order bug), so **every batch-saved
   sheet frame persisted as `frame: 0`**. The Explorer masked it by
   overwriting rows in its group-by; the Characters tab's dedup-by-frame
   reader exposed it in one test run. Fixed (`{ frame: i, ...meta }`), plus
   the Generator single-frame path now saves its real `currentFrame`. Rows
   saved before 2026-07-14 may still carry `frame: 0`.
3. **Structured prompt spec** (`core/prompts.js`) — prompts are an ordered
   section object (format → style → subject → view → action → background)
   rendered with sentence boundaries and numbered frame sequences, replacing
   the flat comma pile; synonym stacks deduped in `VIEWS` ("side view,
   profile view, facing right" → "side view, facing right"). Builder
   signatures unchanged — CLI/MCP/eval callers untouched. New `styleNotes`
   slot feeds a character's locked style text into every prompt.
4. **Character entity + Characters tab** — Dexie v4: `characters` table
   (locked `description`, `styleNotes`, palette/scale/model prefs,
   `baseSeed`, reference image blob + upstream URL), `characterId` FK on
   sprites with `[characterId+animState+view]` index, `adoptSpritesByName()`
   linking legacy Generator saves. `src/Characters.jsx`: create/edit, per-
   character animation grid with the shared player, generate-animation flow
   (locked subject + base seed + `image=` reference when the model's
   `maxReferenceImages > 0` — browser counterpart of the Node cohesion
   chain; `img._upstreamUrl` reconstructs the public URL from the proxy
   path), auto-anchoring first generation as reference, "Use as reference"
   promotion (sprite rows now persist `sourceUrl` for this), and per-model
   capability messaging.
5. **Sheet model + multi-engine export** (`core/exporters.js`) — one
   internal model (multi-animation multi-row packing, per-frame durations,
   bottom-center pivots, padding) with five pure emitters behind
   `EXPORT_FORMATS`: Phaser (existing `atlas.js` became a thin compatible
   wrapper), **Aseprite JSON** (frameTags + ms durations), **Godot 4
   `.tres` SpriteFrames**, **love2d data-only `.lua`**, **Unity metadata**
   (bottom-left-origin rects, inverted pivot y). CLI:
   `pixegen sheet --format phaser,aseprite,godot,love2d,unity`. Browser:
   `buildPackedSheet` in `sprite-sheet.js` + an "Export Character" button
   (one PNG, one row per animation, one metadata file; format picker).
6. **Tests + docs** — `tests/characters.spec.js` (4 browser tests: CRUD,
   locked-seed generation + playback, packed export downloads, legacy
   adoption) and `tests/exporters.spec.js` (11 pure-core tests: packing
   geometry, padding, every emitter's format contract, Phaser wrapper
   compatibility). CLAUDE.md updated throughout; `docs/LESSONS.md` created.

Verification state at session end: **50/50 Playwright tests passing**
(`integration.spec.js` excluded as the documented stale pre-React suite),
prod build clean, CLI sheet export verified end-to-end against a mock
server in all five formats.

## Forks in the road, and which way we went

- **Consistency mechanism: prompt+seed vs reference-image vs both** → both,
  model-dependent (user's call). Locked description + seed always; the
  reference URL rides along only when the model accepts it, and the UI says
  which is happening.
- **Character storage: new entity table vs keep grouping by name string** →
  entity table with additive migration. Legacy rows keep working by name;
  adoption is lazy and non-destructive.
- **Reference URL source** → the generation request URL itself (matches the
  Node cohesion chain's semantics — deterministic re-generation), stored at
  save time on both the character and sprite rows.
- **Export architecture: per-format builders vs one model + emitters** →
  one model, thin emitters. Geometry is tested once; formats are ~40 lines
  each.
- **Prompt rewrite depth: new text vs structure-with-conservative-wording**
  → conservative. Proven tokens kept; structure, dedup, and numbering are
  the change. Wording experiments belong to the eval loop, not a refactor.
- **Characters tab prompt fields: reuse Generator's full knob set vs locked
  minimal set** → minimal (palette/scale/model/seed + description/style
  notes); pipeline knobs stay at sane defaults. The tab's job is
  repeatability, not exploration — that's what Generator and A/B are for.

## Cans kicked down the road (deliberately)

- **Eval-validate the new prompt wording** — structure changed, wording
  changed slightly; nobody has A/B'd old-vs-new prompt text through
  `eval run` yet. Do this before trusting recipe ideals recorded against
  the old prompts.
- **Reference-cohesion quality is still unjudged** — the browser lane now
  *uses* `image=` refs for ref-capable models, but whether it measurably
  improves cross-animation identity hasn't been eyeballed via the eval loop.
- **MCP export formats** — `bin/pixegen-mcp.js` still emits Phaser only; a
  `format` tool param is a small follow-up.
- **CompareLab still hand-wires `AnimationPlayer`** — third candidate for
  `AnimationPreview` adoption.
- **Legacy `frame: 0` rows** — pre-2026-07-14 batch saves can't be reliably
  re-indexed; they play as single frames. Regenerate if it matters.
- **Per-frame durations in the UI** — the sheet model supports them; the
  player and export UI only expose uniform fps.
- **App.jsx decomposition, browser validation gate,
  `tests/integration.spec.js`, `exportGif`** — all unchanged, all still on
  the list.

## What worked well

- **Exploration-first paid off**: three parallel read-only surveys
  (player/storage, prompts/export, tab wiring) up front meant every later
  edit hit a known seam — the CompareLab template made the Characters tab
  mostly assembly.
- **The new reader caught an old bug immediately** — writing
  `loadCharacterFrames` strictly (dedupe by frame index) surfaced the
  frame-index bug that the tolerant Explorer had masked. See LESSONS.md.
- **Pure-core exporters were testable in minutes** because Playwright specs
  run in Node — 11 geometry/format tests with zero browser overhead.

## What didn't work as well

- **Chakra `Button` accessible-name confusion** — an `aria-label` on a text
  Button ("▶") does win as the accessible name, but the first test run
  failed for a different reason (the frame bug) and the label red herring
  cost one investigation loop. Snapshot-first debugging (`error-context.md`)
  found the truth faster than re-reading component code.
- **The mock PNG is a checkerboard-free flat color** — slicing/processing
  tests pass but can't catch content-dependent regressions (auto-crop,
  palette conformance). Fine for machinery, but it's worth remembering what
  the mocks *can't* see.
