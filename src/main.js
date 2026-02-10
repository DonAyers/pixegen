import { generateImage } from './image-service.js';
import { processImage, renderPixelArt } from './pixel-processor.js';
import { CONSOLES, DEFAULT_CONSOLE } from './palettes.js';
import { fetchImageModels, DEFAULT_MODELS, DEFAULT_MODEL_ID } from './model-service.js';

// ─── DOM elements ────────────────────────────────────────────────────────────
const inputField = document.getElementById('input-field');
const generateBtn = document.getElementById('generate-btn');
const consoleSelect = document.getElementById('console-select');
const spriteSizeSelect = document.getElementById('sprite-size');
const modelSelect = document.getElementById('model-select');
const ditherModeSelect = document.getElementById('dither-mode');
const showGridCheckbox = document.getElementById('show-grid');
const transparentBgCheckbox = document.getElementById('transparent-bg');
const negativePromptInput = document.getElementById('negative-prompt');
const seedInput = document.getElementById('seed-input');
const consoleInfoEl = document.getElementById('console-info');
const pixelLabel = document.getElementById('pixel-label');
const sourceImage = document.getElementById('source-image');
const sourcePlaceholder = document.getElementById('source-placeholder');
const pixelCanvas = document.getElementById('pixel-canvas');
const pixelPlaceholder = document.getElementById('pixel-placeholder');
const statusEl = document.getElementById('status');

// ─── Populate console selector ───────────────────────────────────────────────
function populateConsoleSelect() {
  consoleSelect.innerHTML = '';
  for (const [id, cfg] of Object.entries(CONSOLES)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = cfg.name;
    if (id === DEFAULT_CONSOLE) opt.selected = true;
    consoleSelect.appendChild(opt);
  }
}

// ─── Populate sprite sizes for selected console ──────────────────────────────
function populateSpriteSizes() {
  const consoleId = consoleSelect.value;
  const cfg = CONSOLES[consoleId];
  const currentValue = spriteSizeSelect.value;
  spriteSizeSelect.innerHTML = '';

  for (const [key, { w, h }] of Object.entries(cfg.spriteSizes)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${w}×${h}`;
    spriteSizeSelect.appendChild(opt);
  }

  // Preserve selection if available in new console, else use default
  if (cfg.spriteSizes[currentValue]) {
    spriteSizeSelect.value = currentValue;
  } else {
    spriteSizeSelect.value = cfg.defaultSize;
  }
}

// ─── Update console info banner ──────────────────────────────────────────────
function updateConsoleInfo() {
  const cfg = CONSOLES[consoleSelect.value];
  consoleInfoEl.textContent =
    `${cfg.fullName} (${cfg.year}) · ${cfg.colorDepth} · ${cfg.colorsPerSprite} per sprite`;
  pixelLabel.textContent = `${cfg.name} Pixel Art:`;
}

// ─── Populate AI model selector ──────────────────────────────────────────────
function populateModelSelect(models) {
  modelSelect.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    opt.title = `${m.description} (${m.cost})`;
    if (m.id === DEFAULT_MODEL_ID) opt.selected = true;
    modelSelect.appendChild(opt);
  }
}

// ─── Status helpers ──────────────────────────────────────────────────────────
function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function setGenerating(isGenerating) {
  generateBtn.disabled = isGenerating;
  generateBtn.textContent = isGenerating ? 'Generating...' : 'Generate';
}

// ─── Generate handler ────────────────────────────────────────────────────────
async function handleGenerate() {
  const prompt = inputField.value.trim();
  if (!prompt) {
    setStatus('Please enter a description for your sprite.', 'error');
    return;
  }

  const consoleId = consoleSelect.value;
  const consoleCfg = CONSOLES[consoleId];
  const spriteSize = spriteSizeSelect.value;
  const dithering = ditherModeSelect.value || null;
  const showGrid = showGridCheckbox.checked;
  const model = modelSelect.value;
  const transparent = transparentBgCheckbox.checked;
  const negativePrompt = negativePromptInput.value.trim();
  const seedRaw = seedInput.value.trim();
  const seed = seedRaw ? parseInt(seedRaw, 10) : undefined;

  try {
    setGenerating(true);

    // Step 1: Generate source image
    setStatus(`Generating with ${modelSelect.selectedOptions[0]?.textContent || model}... (10-30s)`, 'working');
    const img = await generateImage(prompt, {
      model,
      transparent,
      negativePrompt,
      seed,
      consoleName: consoleCfg.name,
    });

    // Show source image — wait for it to fully load in the DOM element
    await new Promise((resolve, reject) => {
      sourceImage.onload = resolve;
      sourceImage.onerror = reject;
      sourceImage.src = img.src;
    });
    sourceImage.style.display = 'block';
    sourcePlaceholder.style.display = 'none';

    // Step 2: Post-process to retro pixel art
    setStatus(`Processing to ${consoleCfg.name} pixel art...`, 'working');

    // Small delay to let the UI update
    await new Promise(r => setTimeout(r, 50));

    const { pixelData, spriteW, spriteH } = processImage(img, {
      consoleId,
      spriteSize,
      dithering,
    });

    // Step 3: Render to canvas
    renderPixelArt(pixelCanvas, pixelData, spriteW, spriteH, {
      showGrid,
    });

    pixelCanvas.style.display = 'block';
    pixelPlaceholder.style.display = 'none';

    setStatus(`Done! ${spriteW}×${spriteH} ${consoleCfg.name} sprite generated.`, 'success');

  } catch (err) {
    console.error('Generation failed:', err);
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    setGenerating(false);
  }
}

// ─── Re-process when controls change ─────────────────────────────────────────
function handleReprocess() {
  if (sourceImage.style.display === 'none') return;

  const consoleId = consoleSelect.value;
  const consoleCfg = CONSOLES[consoleId];
  const spriteSize = spriteSizeSelect.value;
  const dithering = ditherModeSelect.value || null;
  const showGrid = showGridCheckbox.checked;

  try {
    const { pixelData, spriteW, spriteH } = processImage(sourceImage, {
      consoleId,
      spriteSize,
      dithering,
    });

    renderPixelArt(pixelCanvas, pixelData, spriteW, spriteH, {
      showGrid,
    });

    setStatus(`Reprocessed: ${spriteW}×${spriteH} ${consoleCfg.name} sprite.`, 'success');
  } catch (err) {
    console.error('Reprocessing failed:', err);
    setStatus(`Error: ${err.message}`, 'error');
  }
}

// ─── Console change: update sizes, info, and reprocess ───────────────────────
function handleConsoleChange() {
  populateSpriteSizes();
  updateConsoleInfo();
  handleReprocess();
}

// ─── Event listeners ─────────────────────────────────────────────────────────
generateBtn.addEventListener('click', handleGenerate);

inputField.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleGenerate();
});

consoleSelect.addEventListener('change', handleConsoleChange);

// Re-process on control changes (no new API call)
spriteSizeSelect.addEventListener('change', handleReprocess);
ditherModeSelect.addEventListener('change', handleReprocess);
showGridCheckbox.addEventListener('change', handleReprocess);

// ─── Initialize ──────────────────────────────────────────────────────────────
populateConsoleSelect();
populateSpriteSizes();
updateConsoleInfo();
populateModelSelect(DEFAULT_MODELS);

// Async: fetch live model list and update dropdown
fetchImageModels().then((models) => {
  const currentModel = modelSelect.value;
  populateModelSelect(models);
  // Preserve user selection if still available
  const match = models.find(m => m.id === currentModel);
  if (match) modelSelect.value = currentModel;
});
