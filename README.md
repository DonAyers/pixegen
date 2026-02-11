# PixelGen

A tool to generate pixel art assets using AI image generation models.

## Features

- 🎨 Generate pixel art sprites from text descriptions
- 🤖 Support for multiple AI providers (Pollinations, Gemini, OpenAI)
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

PixelGen supports multiple AI image generation providers. Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Then edit `.env` and add your API keys:

- **Pollinations** (free tier available): Get from [pollinations.ai](https://pollinations.ai)
- **Google Gemini**: Get from [Google AI Studio](https://aistudio.google.com/app/apikey)
- **OpenAI**: Get from [OpenAI Platform](https://platform.openai.com/api-keys)

**Note:** At least one provider is always available (Pollinations runs even without an API key). If you provide multiple API keys, all providers will appear grouped in the AI Model dropdown.

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
