# PixelGen

A tool to generate pixel art assets using AI image generation models.

## Features

- 🎨 Generate pixel art sprites from text descriptions
- 🤖 Multiple AI model options through Pollinations API
- 🔧 Provider-based model organization (UI grouping for future multi-provider support)
- 🎮 Multiple retro console palettes (NES, SNES, Genesis, Game Boy, etc.)
- 🎞️ Animation frame generation and preview
- 🔍 Inspector view to debug model inputs and outputs
- 💾 Save and load sprite sheets
- 🎯 Advanced color processing with OKLAB color space

## Setup

Install dependencies:
```bash
npm install
```

### API Keys (Optional)

PixelGen uses the Pollinations API for image generation. You can optionally provide an API key:

```bash
cp .env.example .env
```

Then edit `.env` and add your Pollinations API key:

- **Pollinations** (free tier available): Get from [pollinations.ai](https://pollinations.ai)

**Note:** The application works without an API key. The UI includes provider-based model grouping (Gemini, OpenAI) as a display feature for future multi-provider support, but currently all models are served through the Pollinations backend.

## Development

Start the Vite dev server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

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

- `index.html` - Main HTML file
- `src/main.js` - Application logic
- `src/style.css` - Styling
- `tests/` - Playwright test files
- `vite.config.js` - Vite configuration
- `playwright.config.js` - Playwright configuration
