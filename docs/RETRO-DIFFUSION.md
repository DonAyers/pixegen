# Retro Diffusion: competitive research, decision, and direction

*Researched 2026-07-14. Companion doc: [`plan-prompt.md`](./plan-prompt.md) is the
execution handoff prompt derived from this analysis.*

## Why we looked

[retrodiffusion.ai](https://retrodiffusion.ai/) — specifically its free
[Pixel Art Fixer](https://www.retrodiffusion.ai/tools/pixel-art-fixer/) tool —
is the closest commercial product to what pixegen does: AI generation of
game-ready pixel art with hard palette/grid guarantees, plus repair of
AI-generated or corrupted pixel art. This doc records what they built, how,
what's open source, and what we decided to take from it.

## Who they are

Retro Diffusion is a solo-founder product by **Astropulse (Cody Claus)**. It
began as a paid [Aseprite extension](https://astropulse.itch.io/retrodiffusion)
shipping custom-trained Stable Diffusion pixel-art models, and grew into a web
app + paid developer API. Models are trained on licensed pixel art with artist
consent (also their ethics/marketing positioning). Inference is hosted on
[Runware](https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale),
whose case study on them is the best single "lessons learned" source.

## Their stack, as best we can tell

- **Generation**: custom fine-tunes. Current flagship `RD_FLUX` is a fine-tune
  of the FLUX architecture; they explicitly moved off the earlier
  many-specialized-LoRAs approach to one model whose ~28 styles are selected by
  prompting alone. Older SD-era models still back some cheaper tiers
  (RD Fast/Plus/Pro families, $0.03–$0.18 per image).
- **Post-processing**: proprietary pipeline built around their **K-Centroid**
  downscaling algorithm plus color quantization. The founder's core thesis,
  from the Runware case study:

  > "Getting AI models to generate pixel art is mostly about dataset, data
  > preparation, and post processing."

  Even their meticulously trained models **cannot hold strict color limits** —
  palette conformance is enforced in post, not in the model.
- **Pixel Art Fixer**: the productized version of their open-source
  `pixeldetector` — a `standard` variant (Rust port of the Python original) and
  a `neural` variant (model-based reconstruction). Free, rate-limited API
  endpoint (`/v1/pixel-fixer/*`).

## The algorithms (from MIT-licensed source)

Read from [`Astropulse/pixeldetector`](https://github.com/Astropulse/pixeldetector)
(**MIT**, Python, ~1 file):

1. **Pixel grid detection** — compute per-pixel RGB difference between
   horizontally and vertically adjacent pixels; sum the differences along each
   axis to get a 1-D "edge energy" profile per axis; run peak-finding
   (scipy `find_peaks`) on each profile; the **median spacing between
   consecutive peaks** is the true pixel size on that axis. Dividing image
   dimensions by the spacing recovers the native resolution of an upscaled or
   JPEG-mangled pixel-art image.
2. **K-Centroid downscale** — for each output pixel, take the corresponding
   source tile and run k-means on its colors (k≈2), then emit the **most
   common centroid**. Noise-robust where naive nearest/average downscales blur
   and mode-based downscales speckle on noisy AI output. Also published
   standalone as [`K-Centroid-Aseprite`](https://github.com/Astropulse/K-Centroid-Aseprite) (MIT).
3. **Palette-size prediction** — elbow method: quantize at increasing k,
   measure total squared distortion, pick the k where the improvement rate
   peaks (diminishing returns). Used to auto-choose a color count with no
   user input.

Related but **unlicensed** (read for ideas, do not copy code):
[`sd-palettize`](https://github.com/Astropulse/sd-palettize) (A1111 palettize
extension), [`Retro-Diffusion/api-examples`](https://github.com/Retro-Diffusion/api-examples)
(API docs/examples).

## Their API surface (design ideas worth stealing)

From the api-examples repo — `POST /v1/inferences` with:

- `prompt_style` — a named style registry (their equivalent of our recipes;
  validates that interface as the primary API surface).
- `check_cost: true` — free dry-run returning exact price, generating nothing.
- `input_palette` (base64 palette image) + `return_pre_palette` — constrain
  output colors and get both the quantized and raw versions back.
- `reference_images` (up to 9, RD Pro) — pass prior outputs to keep a
  character consistent across new generations. Same concept as our Characters
  tab's `image=` conditioning chain.
- Animation from a **start frame**: `rd_advanced_animation__*` takes any
  pixel-art `input_image` + an action (`walking`, `idle`, `attack`, …) and
  returns frames — a stronger consistency strategy than batching all frames in
  one strip prompt.
- Wang-tile tilesets from one prompt (`rd_tile__tileset`).
- Free/cheap post-processing "edit tools" as API endpoints: `color_reducer`,
  `palette_converter`, `k_centroid_downscale`, `pixel_correction`,
  `background_remover`.
- `async: true` + task polling for long jobs.

Pricing for market context: $0.03–0.18/image, $0.07–0.25/animation,
$0.10/tileset.

## What this means for pixegen

**Their success validates our architecture.** We cannot train models (we
resell Pollinations/OpenAI), but the founder's own account says model choice is
the *smaller* half — dataset aside, quality comes from post-processing, which
is exactly the half we control (`src/core/`) and the half our eval loop
optimizes. Our lever and their lever are the same lever.

### Decisions

1. **Port K-Centroid into `src/core/quantize.js`** as a third downscale
   strategy (MIT — port with attribution). Evaluate it against the current
   `downscaleMode` via the eval sweep before changing any recipe defaults.
2. **Implement pixel-grid detection in core** and use it two ways:
   - a new offline `pixegen fix` command (Pixel Art Fixer parity: detect grid →
     K-Centroid downscale to native res → optional palette reduction), also
     exposed as an MCP tool;
   - an advisory validation signal (detected source grid vs. requested sprite
     scale disagreement = the model didn't draw on the grid we asked for).
3. **Elbow-method auto color count** for free-palette output (`--colors auto`).
4. **Backlog, not now** (recorded so we don't lose them):
   - start-frame-conditioned animation (generate frame 1, then condition each
     subsequent frame on it) — likely the biggest consistency win for sheets;
   - `check_cost`-style dry-run and a styles/recipes listing endpoint if we
     ever ship a hosted API;
   - `return_pre_palette` equivalent in CLI/MCP output (we already store both
     in Dexie);
   - neural repair variant — requires a trained model; out of reach and out of
     scope.
5. **Do not copy** from `sd-palettize` or `api-examples` (no license); the
   MIT repos (`pixeldetector`, `K-Centroid-Aseprite`) are fair game.

The detailed execution plan lives in [`plan-prompt.md`](./plan-prompt.md).

## Sources

- https://www.retrodiffusion.ai/tools/pixel-art-fixer/
- https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale
- https://github.com/Astropulse/pixeldetector (MIT, 354★)
- https://github.com/Astropulse/K-Centroid-Aseprite (MIT)
- https://github.com/Astropulse/sd-palettize (no license)
- https://github.com/Retro-Diffusion/api-examples (no license)
- https://astropulse.gitbook.io/retro-diffusion (docs; `llms.txt` index, every
  page fetchable as `.md`)
- https://astropulse.itch.io/retrodiffusion (devlogs)
- https://replicate.com/retro-diffusion/rd-plus
- https://github.com/oliexe/Retro-Diffusion-Unity (community Unity integration)
