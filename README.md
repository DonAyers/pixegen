# PixelGen

A tool to generate pixel art assets using AI image generation models — in the
browser, from the CLI, or from a coding agent over MCP.

## Features

- 🎨 Generate pixel art sprites from text descriptions with structured,
  section-based prompts (format → style → subject → view → action → background)
- 🤖 Multiple AI models through the Pollinations API — including OpenAI GPT
  Image and Google Gemini image models re-sold at a fraction of their direct
  cost — plus an optional direct OpenAI BYOK lane (see [docs/PROVIDERS.md](docs/PROVIDERS.md))
- 🎮 Retro console palette profiles (NES, SNES, Genesis, Game Boy, C64, Atari)
  as one axis, sprite scale (8×8 → 512×512) as an independent second axis
- 🧍 **Characters tab** — a persistent character locks its description, style
  notes, base seed, and a canonical reference image, so every animation you
  generate for it stays consistent; reference-image conditioning is attached
  automatically on models that support it
- 🎞️ Animation generation (idle/walk/run/attack/… × facing views) with a
  shared playback component (transport, FPS, ping-pong, onion-skin, frame
  strip) used across tabs
- 🗂️ **Explorer view** to browse every generation saved locally — original AI
  source image alongside the processed pixel art — and replay any saved
  animation
- 🧱 **Tileset Studio** for role-based tile grids
- ⚖️ **A/B Test Lab** — one prompt + shared seed against two model/pipeline
  configs, feeding a persistent eval knowledge base (`eval/findings.json`)
  that powers per-target "ideal settings"
- 📤 **Engine export** — packed sprite sheets (multi-animation, per-frame
  durations, pivots) with metadata for **Phaser 3, Aseprite JSON, Godot 4
  (SpriteFrames .tres), love2d (.lua), and Unity**
- 📟 Always-visible run sidebar tracking every request (granular statuses,
  timings, copyable prompts/URLs/errors) plus prompt history and settings
- 🔍 Inspector view to debug model inputs and outputs
- 🎯 Advanced color processing with OKLAB color space, optional dithering,
  outlines, cleanup, subject auto-crop, and image preprocessing

## Setup

Install dependencies:
```bash
npm install
```

### API Keys (Optional)

```bash
cp .env.example .env
```

- **Pollinations** (default backend, free tier available):
  `POLLINATIONS_API_KEY` — get one from [pollinations.ai](https://pollinations.ai).
  The app works without it (rate-limited anonymous tier; a few models are
  paid-key-only and marked in the pickers).
- **OpenAI** (optional BYOK lane): `OPENAI_API_KEY` enables
  `openai:gpt-image-1` / `openai:gpt-image-1-mini` — native transparent
  backgrounds, billed to your OpenAI account. Available in CLI/MCP and in the
  browser for single sprites (the dev server keeps the key server-side).

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for the provider evaluation and
the guardrails for adding new ones.

## Development

Start the Vite dev server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## CLI (headless generation)

Everything the browser UI does can be scripted — no browser required. The CLI
writes PNG + engine metadata files, so it drops straight into a game's asset
pipeline:

```bash
node bin/pixegen.js generate "a knight with a sword" --recipe nes-classic -o ./assets/knight.png
node bin/pixegen.js sheet "a knight" --anim walk --view side -o ./assets/knight-walk/
node bin/pixegen.js sheet "a knight" --anim walk --format aseprite,godot,love2d,unity -o ./assets/knight-walk/
node bin/pixegen.js tileset "sunset desert ruins" --cols 4 --rows 4 -o ./assets/desert/
node bin/pixegen.js fix ./upscaled-sprite.png -o ./fixed.png --colors auto
                                 # offline: detect the native pixel grid of an
                                 # upscaled/JPEG-softened image, downscale back
                                 # to it, optionally fix colors — no network
node bin/pixegen.js recipes     # list named palette+scale+pipeline bundles
node bin/pixegen.js models      # list models (free vs. paid-key-required)
node bin/pixegen.js eval status # ideal-settings knowledge base state
```

The CLI and MCP server support **two providers**: Pollinations (default,
free tier, `POLLINATIONS_API_KEY` optional) and direct **OpenAI** with your
own key. Pick with `--model` (or `--tier` for auto resolution);
`pixegen models` shows what's available and whether each provider's key is
configured. Every generation runs a deterministic validation gate
(blank-frame detection, palette conformance, transparency sanity,
cross-frame drift) with one automatic retry; `--strict` turns remaining
issues into a non-zero exit code.

## MCP server (agentic generation)

`bin/pixegen-mcp.js` exposes the same pipeline to coding agents over MCP
(stdio): `generate_sprite`, `generate_sprite_sheet`, `generate_tileset`,
`fix_pixel_art` (offline repair — no network), `list_recipes`,
`list_palette_profiles`, `list_models`. Tools write asset files into a
caller-specified directory and return the paths, so an agent can generate
art mid game-dev session without a human round-tripping through the browser.

```bash
claude mcp add pixegen -- node /path/to/pixegen/bin/pixegen-mcp.js
```

## Testing

Run tests with Playwright:
```bash
npm test
```

Run tests in UI mode:
```bash
npm run test:ui
```

Debug a test:
```bash
npm run test:debug
```

## Build

Build for production:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

## Project Structure

- `index.html` - Main HTML file (loads the React app via `src/main.jsx`)
- `src/core/` - **Portable pipeline core** (no DOM/Node APIs): structured
  prompt spec, downscale/quantize/dither/outline math, palette profiles +
  sprite scales, recipes, validation gate, model registry, sheet model +
  engine exporters (`exporters.js`), eval findings
- `src/node/` - Node adapters: PNG/JPEG IO, provider clients
  (Pollinations, OpenAI), generation orchestration, run logging
- `bin/pixegen.js` / `bin/pixegen-mcp.js` - CLI and MCP entry points
- `src/App.jsx` - React UI shell (Generator + Inspector tabs, tab host)
- `src/Characters.jsx`, `src/Explorer.jsx`, `src/TilesetStudio.jsx`,
  `src/CompareLab.jsx` - The other tabs
- `src/AnimationPreview.jsx` - Shared animation playback component
- `src/sprite-storage.js` - Dexie/IndexedDB persistence (sprites, characters, tiles)
- `eval/` - Champion-vs-challenger trial history + per-target ideal settings
- `tests/` - Playwright test files (UI + pure-core specs)

## Documentation

- [Provider & API Evaluation](docs/PROVIDERS.md) - Backend strategy, OpenAI
  cost comparison, and guardrails for adding providers
- [Image Preprocessing Guide](docs/PREPROCESSING.md) - Preprocessing options
  and best practices
- [Lessons Learned](docs/LESSONS.md) - Durable engineering lessons, kept so
  they only have to be learned once
- [Next Phase](docs/Next-Phase.md) - Architecture review, eval-loop design,
  and open decisions
- [Sprite Studio Roadmap](docs/SPRITE_STUDIO_ROADMAP.md) - Longer-horizon
  product direction
- `docs/last-sesh.md` - Rolling handoff notes from the most recent working
  session
