import { generateImage } from './image-service.js';
import { processImage, renderPixelArt } from './pixel-processor.js';

// DOM elements
const inputField = document.getElementById('input-field');
const generateBtn = document.getElementById('generate-btn');
const spriteSizeSelect = document.getElementById('sprite-size');
const ditherModeSelect = document.getElementById('dither-mode');
const showGridCheckbox = document.getElementById('show-grid');
const sourceImage = document.getElementById('source-image');
const sourcePlaceholder = document.getElementById('source-placeholder');
const pixelCanvas = document.getElementById('pixel-canvas');
const pixelPlaceholder = document.getElementById('pixel-placeholder');
const statusEl = document.getElementById('status');

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function setGenerating(isGenerating) {
  generateBtn.disabled = isGenerating;
  generateBtn.textContent = isGenerating ? 'Generating...' : 'Generate';
}

async function handleGenerate() {
  const prompt = inputField.value.trim();
  if (!prompt) {
    setStatus('Please enter a description for your sprite.', 'error');
    return;
  }

  const spriteSize = spriteSizeSelect.value;
  const dithering = ditherModeSelect.value || null;
  const showGrid = showGridCheckbox.checked;

  try {
    setGenerating(true);

    // Step 1: Generate source image
    setStatus('Generating image from prompt... (this may take 10-30s)', 'working');
    const img = await generateImage(prompt);

    // Show source image — wait for it to fully load in the DOM element
    await new Promise((resolve, reject) => {
      sourceImage.onload = resolve;
      sourceImage.onerror = reject;
      sourceImage.src = img.src;
    });
    sourceImage.style.display = 'block';
    sourcePlaceholder.style.display = 'none';

    // Step 2: Post-process to NES pixel art
    setStatus('Processing to NES pixel art...', 'working');

    // Small delay to let the UI update
    await new Promise(r => setTimeout(r, 50));

    const { pixelData, spriteW, spriteH } = processImage(img, {
      spriteSize,
      dithering,
    });

    // Step 3: Render to canvas
    renderPixelArt(pixelCanvas, pixelData, spriteW, spriteH, {
      showGrid,
    });

    pixelCanvas.style.display = 'block';
    pixelPlaceholder.style.display = 'none';

    setStatus(`Done! ${spriteW}×${spriteH} sprite generated with ${dithering || 'no'} dithering.`, 'success');

  } catch (err) {
    console.error('Generation failed:', err);
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    setGenerating(false);
  }
}

// Re-process when controls change (if we already have an image)
function handleReprocess() {
  if (sourceImage.style.display === 'none') return;

  const spriteSize = spriteSizeSelect.value;
  const dithering = ditherModeSelect.value || null;
  const showGrid = showGridCheckbox.checked;

  try {
    const { pixelData, spriteW, spriteH } = processImage(sourceImage, {
      spriteSize,
      dithering,
    });

    renderPixelArt(pixelCanvas, pixelData, spriteW, spriteH, {
      showGrid,
    });

    setStatus(`Reprocessed: ${spriteW}×${spriteH} sprite with ${dithering || 'no'} dithering.`, 'success');
  } catch (err) {
    console.error('Reprocessing failed:', err);
    setStatus(`Error: ${err.message}`, 'error');
  }
}

// Event listeners
generateBtn.addEventListener('click', handleGenerate);

inputField.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleGenerate();
});

// Re-process on control changes
spriteSizeSelect.addEventListener('change', handleReprocess);
ditherModeSelect.addEventListener('change', handleReprocess);
showGridCheckbox.addEventListener('change', handleReprocess);
