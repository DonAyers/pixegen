import { generateImage, generateSpriteSheet, DEFAULT_NEGATIVE_PROMPT, lastRequest } from './image-service.js';
import { processImage, processSpriteSheet, renderPixelArt, PIPELINE_MODES, DITHER_OPTIONS } from './pixel-processor.js';
import { CONSOLES, DEFAULT_CONSOLE } from './palettes.js';
import { initModels, fetchImageModels, DEFAULT_MODELS, DEFAULT_MODEL_ID } from './model-service.js';
import {
  ANIMATION_STATES, VIEWS, DEFAULT_STATE, DEFAULT_VIEW,
  buildPoseDescription, getStatesByCategory,
} from './animation-states.js';
import { AnimationPlayer } from './animation-player.js';
import { exportSpriteSheet } from './sprite-sheet.js';
import { saveAllFrames, loadFrames, listCharacters, listAnimations } from './sprite-storage.js';

// ─── DOM elements ────────────────────────────────────────────────────────────
const inputField = document.getElementById('input-field');
const generateBtn = document.getElementById('generate-btn');
const consoleSelect = document.getElementById('console-select');
const spriteSizeSelect = document.getElementById('sprite-size');
const modelSelect = document.getElementById('model-select');
const ditherModeSelect = document.getElementById('dither-mode');
const pipelineModeSelect = document.getElementById('pipeline-mode');
const showGridCheckbox = document.getElementById('show-grid');
const transparentBgCheckbox = document.getElementById('transparent-bg');
const outlinesCheckbox = document.getElementById('outlines');
const cleanupCheckbox = document.getElementById('cleanup');
const negativePromptInput = document.getElementById('negative-prompt');
const seedInput = document.getElementById('seed-input');
const consoleInfoEl = document.getElementById('console-info');
const pixelLabel = document.getElementById('pixel-label');
const sourceImage = document.getElementById('source-image');
const sourcePlaceholder = document.getElementById('source-placeholder');
const pixelCanvas = document.getElementById('pixel-canvas');
const pixelPlaceholder = document.getElementById('pixel-placeholder');
const statusEl = document.getElementById('status');
const animStateSelect = document.getElementById('anim-state');
const viewSelect = document.getElementById('view-select');
const framePrevBtn = document.getElementById('frame-prev');
const frameNextBtn = document.getElementById('frame-next');
const frameIndicator = document.getElementById('frame-indicator');
const genAllFramesBtn = document.getElementById('gen-all-frames');
const genSheetBtn = document.getElementById('gen-sheet');
const frameStripEl = document.getElementById('frame-strip');
const previewCanvas = document.getElementById('preview-canvas');
const previewPlaceholder = document.getElementById('preview-placeholder');
const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const fpsInput = document.getElementById('fps-input');
const pingPongCheckbox = document.getElementById('ping-pong');
const onionSkinCheckbox = document.getElementById('onion-skin');
const charNameInput = document.getElementById('char-name');
const saveFramesBtn = document.getElementById('save-frames-btn');
const exportSheetBtn = document.getElementById('export-sheet-btn');
const loadBtn = document.getElementById('load-btn');
const debugPromptEl = document.getElementById('debug-prompt');
const debugNegativeEl = document.getElementById('debug-negative');
const debugUrlEl = document.getElementById('debug-url');

// ─── Navigation elements ─────────────────────────────────────────────────────
const navLinks = document.querySelectorAll('.nav-link');
const generatorView = document.getElementById('generator-view');
const inspectorView = document.getElementById('inspector-view');
const inspectorProvider = document.getElementById('inspector-provider');
const inspectorModel = document.getElementById('inspector-model');
const inspectorType = document.getElementById('inspector-type');
const inspectorDimensions = document.getElementById('inspector-dimensions');
const inspectorPrompt = document.getElementById('inspector-prompt');
const inspectorNegative = document.getElementById('inspector-negative');
const inspectorUrl = document.getElementById('inspector-url');
const inspectorConfig = document.getElementById('inspector-config');

// ─── Frame state ─────────────────────────────────────────────────────────────
// Stores generated pixel art canvases per (state+view) combo.
// Key: "stateId:viewId", Value: Array of { canvas, pixelData, spriteW, spriteH } | null per frame slot
const frameStore = {};
let currentFrame = 0;

function getFrameKey() {
  return `${animStateSelect.value}:${viewSelect.value}`;
}

function getCurrentFrames() {
  const key = getFrameKey();
  if (!frameStore[key]) {
    const count = ANIMATION_STATES[animStateSelect.value].frameCount;
    frameStore[key] = new Array(count).fill(null);
  }
  return frameStore[key];
}

function getFrameCount() {
  return ANIMATION_STATES[animStateSelect.value].frameCount;
}

// ─── Animation Player instance ───────────────────────────────────────────────
const player = new AnimationPlayer(previewCanvas, {
  fps: 8,
  loop: true,
});

player.onFrameChange = (idx) => {
  // Highlight the active thumbnail in the frame strip during playback
  const thumbs = frameStripEl.querySelectorAll('.frame-thumb');
  // Map player frame index back to the slot index in getCurrentFrames
  const frames = getCurrentFrames();
  const filledIndices = frames.map((f, i) => f ? i : -1).filter(i => i >= 0);
  const slotIdx = filledIndices[idx];
  thumbs.forEach((t, i) => t.classList.toggle('active', i === slotIdx));
};

function syncPlayerFrames() {
  const frames = getCurrentFrames();
  const filled = frames.filter(f => f !== null);
  player.setFrames(filled);

  if (filled.length > 0) {
    previewCanvas.style.display = 'block';
    previewPlaceholder.style.display = 'none';
  } else {
    previewCanvas.style.display = 'none';
    previewPlaceholder.style.display = '';
  }
}

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

// ─── Populate dither options based on pipeline mode ──────────────────────────
function populateDitherOptions() {
  const mode = pipelineModeSelect.value;
  const options = DITHER_OPTIONS[mode] || DITHER_OPTIONS.enhanced;
  const currentValue = ditherModeSelect.value;
  ditherModeSelect.innerHTML = '';
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    ditherModeSelect.appendChild(el);
  }
  // Try to preserve current selection
  const exists = options.some(o => o.value === currentValue);
  ditherModeSelect.value = exists ? currentValue : '';
}

// ─── Populate AI model selector ──────────────────────────────────────────────
function populateModelSelect(models) {
  modelSelect.innerHTML = '';
  
  // Group models by provider
  const modelsByProvider = {};
  for (const m of models) {
    const provider = m.providerName || 'Pollinations';
    if (!modelsByProvider[provider]) {
      modelsByProvider[provider] = [];
    }
    modelsByProvider[provider].push(m);
  }
  
  // Create optgroups for each provider
  for (const [providerName, providerModels] of Object.entries(modelsByProvider)) {
    const optGroup = document.createElement('optgroup');
    optGroup.label = providerName;
    
    for (const m of providerModels) {
      const opt = document.createElement('option');
      opt.value = m.fullId;
      opt.textContent = m.name;
      opt.title = `${m.description} (${m.cost})`;
      if (m.fullId === DEFAULT_MODEL_ID) opt.selected = true;
      optGroup.appendChild(opt);
    }
    
    modelSelect.appendChild(optGroup);
  }
}

// ─── Populate animation state selector (with optgroups) ──────────────────────
function populateAnimStateSelect() {
  animStateSelect.innerHTML = '';
  for (const group of getStatesByCategory()) {
    const optGroup = document.createElement('optgroup');
    optGroup.label = group.label;
    for (const state of group.states) {
      const opt = document.createElement('option');
      opt.value = state.id;
      opt.textContent = `${state.name} (${state.frameCount}f)`;
      if (state.id === DEFAULT_STATE) opt.selected = true;
      optGroup.appendChild(opt);
    }
    animStateSelect.appendChild(optGroup);
  }
}

// ─── Populate view selector ──────────────────────────────────────────────────
function populateViewSelect() {
  viewSelect.innerHTML = '';
  for (const [id, view] of Object.entries(VIEWS)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = view.name;
    if (id === DEFAULT_VIEW) opt.selected = true;
    viewSelect.appendChild(opt);
  }
}

// ─── Frame navigation ────────────────────────────────────────────────────────
function updateFrameUI() {
  const total = getFrameCount();
  currentFrame = Math.max(0, Math.min(currentFrame, total - 1));
  frameIndicator.textContent = `${currentFrame + 1} / ${total}`;
  framePrevBtn.disabled = currentFrame <= 0;
  frameNextBtn.disabled = currentFrame >= total - 1;
  updateFrameStrip();
}

function updateFrameStrip() {
  const frames = getCurrentFrames();
  frameStripEl.innerHTML = '';

  frames.forEach((frame, i) => {
    const thumb = document.createElement('canvas');
    thumb.className = `frame-thumb${i === currentFrame ? ' active' : ''}${!frame ? ' empty' : ''}`;
    thumb.width = 48;
    thumb.height = 48;
    thumb.title = `Frame ${i + 1}`;

    if (frame) {
      // Draw the pixel art into the thumbnail
      const ctx = thumb.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frame.canvas, 0, 0, 48, 48);
    }

    thumb.addEventListener('click', () => {
      currentFrame = i;
      updateFrameUI();
      showFrameOnCanvas(i);
    });

    frameStripEl.appendChild(thumb);
  });
}

function showFrameOnCanvas(frameIndex) {
  const frames = getCurrentFrames();
  const frame = frames[frameIndex];
  if (!frame) return;

  // Copy the stored frame canvas to the main display canvas
  const ctx = pixelCanvas.getContext('2d');
  pixelCanvas.width = frame.canvas.width;
  pixelCanvas.height = frame.canvas.height;
  ctx.drawImage(frame.canvas, 0, 0);
  pixelCanvas.style.display = 'block';
  pixelPlaceholder.style.display = 'none';
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

function updatePromptDebug() {
  debugPromptEl.textContent = lastRequest.prompt || '—';
  debugNegativeEl.textContent = lastRequest.negativePrompt || '(none)';
  const providerInfo = lastRequest.provider ? `${lastRequest.provider} | ` : '';
  debugUrlEl.textContent = `${lastRequest.type === 'sheet' ? 'Sheet' : 'Single'} | ${providerInfo}${lastRequest.model} | ${lastRequest.width}×${lastRequest.height}\n${lastRequest.url}`;
  
  // Also update inspector view
  updateInspector();
}

// ─── Inspector View Management ───────────────────────────────────────────────
function updateInspector() {
  if (!lastRequest.url) {
    inspectorProvider.textContent = '—';
    inspectorModel.textContent = '—';
    inspectorType.textContent = '—';
    inspectorDimensions.textContent = '—';
    inspectorPrompt.textContent = '—';
    inspectorNegative.textContent = '—';
    inspectorUrl.textContent = '—';
    inspectorConfig.textContent = '—';
    return;
  }
  
  inspectorProvider.textContent = lastRequest.provider || 'Unknown';
  inspectorModel.textContent = lastRequest.model || 'Unknown';
  inspectorType.textContent = lastRequest.type === 'sheet' ? 'Sprite Sheet' : 'Single Frame';
  inspectorDimensions.textContent = `${lastRequest.width} × ${lastRequest.height} px`;
  inspectorPrompt.textContent = lastRequest.prompt || '(none)';
  inspectorNegative.textContent = lastRequest.negativePrompt || '(none)';
  inspectorUrl.textContent = lastRequest.url;
  
  // Build configuration object
  const config = {
    console: consoleSelect.value,
    spriteSize: spriteSizeSelect.value,
    pipelineMode: pipelineModeSelect.value,
    dithering: ditherModeSelect.value || 'none',
    outlines: outlinesCheckbox.checked,
    cleanup: cleanupCheckbox.checked,
    transparent: transparentBgCheckbox.checked,
    seed: seedInput.value || 'random',
  };
  inspectorConfig.textContent = JSON.stringify(config, null, 2);
}

// ─── Navigation handlers ─────────────────────────────────────────────────────
function switchView(viewName) {
  // Update navigation
  navLinks.forEach(link => {
    if (link.dataset.view === viewName) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
  
  // Update views
  if (viewName === 'generator') {
    generatorView.classList.add('active');
    inspectorView.classList.remove('active');
  } else if (viewName === 'inspector') {
    generatorView.classList.remove('active');
    inspectorView.classList.add('active');
    updateInspector(); // Refresh inspector data
  }
}

navLinks.forEach(link => {
  link.addEventListener('click', () => {
    switchView(link.dataset.view);
  });
});

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
  const pipelineMode = pipelineModeSelect.value;
  const outlinesOn = outlinesCheckbox.checked;
  const cleanupOn = cleanupCheckbox.checked;
  const negativePrompt = negativePromptInput.value.trim() || DEFAULT_NEGATIVE_PROMPT;
  const seedRaw = seedInput.value.trim();
  const seed = seedRaw ? parseInt(seedRaw, 10) : undefined;

  try {
    setGenerating(true);

    const poseDesc = buildPoseDescription(
      animStateSelect.value, viewSelect.value, currentFrame
    );

    // Step 1: Generate source image
    setStatus(`Generating frame ${currentFrame + 1}/${getFrameCount()} with ${modelSelect.selectedOptions[0]?.textContent || model}...`, 'working');
    const img = await generateImage(prompt, {
      model,
      transparent,
      negativePrompt,
      seed: seed !== undefined ? seed + currentFrame : undefined,
      consoleName: consoleCfg.name,
      poseDesc,
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
      pipeline: pipelineMode,
      outlines: outlinesOn,
      cleanup: cleanupOn,
    });

    // Step 3: Render to canvas
    renderPixelArt(pixelCanvas, pixelData, spriteW, spriteH, {
      showGrid,
    });

    pixelCanvas.style.display = 'block';
    pixelPlaceholder.style.display = 'none';

    // Step 4: Store frame in frame buffer
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = pixelCanvas.width;
    frameCanvas.height = pixelCanvas.height;
    frameCanvas.getContext('2d').drawImage(pixelCanvas, 0, 0);

    const frames = getCurrentFrames();
    frames[currentFrame] = { canvas: frameCanvas, pixelData, spriteW, spriteH };
    updateFrameStrip();
    syncPlayerFrames();

    setStatus(`Done! Frame ${currentFrame + 1}/${getFrameCount()} · ${spriteW}×${spriteH} ${consoleCfg.name} sprite.`, 'success');
    updatePromptDebug();

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
  const pipelineMode = pipelineModeSelect.value;
  const outlinesOn = outlinesCheckbox.checked;
  const cleanupOn = cleanupCheckbox.checked;

  try {
    const { pixelData, spriteW, spriteH } = processImage(sourceImage, {
      consoleId,
      spriteSize,
      dithering,
      pipeline: pipelineMode,
      outlines: outlinesOn,
      cleanup: cleanupOn,
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

// ─── Generate all frames for current animation state ─────────────────────────
async function handleGenerateAllFrames() {
  const prompt = inputField.value.trim();
  if (!prompt) {
    setStatus('Please enter a description for your sprite.', 'error');
    return;
  }

  const total = getFrameCount();
  const savedFrame = currentFrame;

  try {
    setGenerating(true);
    genAllFramesBtn.disabled = true;

    for (let i = 0; i < total; i++) {
      currentFrame = i;
      updateFrameUI();
      setStatus(`Generating frame ${i + 1} of ${total}...`, 'working');
      await handleGenerate();
    }

    currentFrame = 0;
    updateFrameUI();
    showFrameOnCanvas(0);
    syncPlayerFrames();
    setStatus(`All ${total} frames generated!`, 'success');
  } catch (err) {
    console.error('Batch generation failed:', err);
    setStatus(`Error on frame ${currentFrame + 1}: ${err.message}`, 'error');
  } finally {
    genAllFramesBtn.disabled = false;
  }
}

// ─── Generate entire sprite sheet in one image ───────────────────────────────
async function handleGenerateSheet() {
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
  const pipelineMode = pipelineModeSelect.value;
  const outlinesOn = outlinesCheckbox.checked;
  const cleanupOn = cleanupCheckbox.checked;
  const negativePrompt = negativePromptInput.value.trim();
  const seedRaw = seedInput.value.trim();
  const seed = seedRaw ? parseInt(seedRaw, 10) : undefined;

  const total = getFrameCount();
  const stateId = animStateSelect.value;
  const viewId = viewSelect.value;
  const animState = ANIMATION_STATES[stateId];
  const view = VIEWS[viewId];

  try {
    setGenerating(true);
    genSheetBtn.disabled = true;
    genAllFramesBtn.disabled = true;

    // Step 1: Generate sprite sheet image (one API call for all frames)
    setStatus(`Generating ${total}-frame sprite sheet with ${modelSelect.selectedOptions[0]?.textContent || model}...`, 'working');
    const sheetImg = await generateSpriteSheet(prompt, {
      model,
      frameCount: total,
      seed,
      transparent,
      negativePrompt,
      consoleName: consoleCfg.name,
      viewDesc: view.promptDesc,
      animDesc: animState.promptDesc,
      frameHints: animState.frameHints,
    });

    // Show the full sheet as the source image
    await new Promise((resolve, reject) => {
      sourceImage.onload = resolve;
      sourceImage.onerror = reject;
      sourceImage.src = sheetImg.src;
    });
    sourceImage.style.display = 'block';
    sourcePlaceholder.style.display = 'none';

    // Step 2: Slice and process all frames
    setStatus(`Slicing ${total} frames and processing to ${consoleCfg.name} pixel art...`, 'working');
    await new Promise(r => setTimeout(r, 50));

    const { frames: processedFrames } = processSpriteSheet(sheetImg, total, {
      consoleId,
      spriteSize,
      dithering,
      pipeline: pipelineMode,
      outlines: outlinesOn,
      cleanup: cleanupOn,
    });

    // Step 3: Store each frame
    const storedFrames = getCurrentFrames();
    for (let i = 0; i < processedFrames.length && i < storedFrames.length; i++) {
      const { pixelData, spriteW, spriteH } = processedFrames[i];

      // Render to a display canvas
      const frameCanvas = document.createElement('canvas');
      renderPixelArt(frameCanvas, pixelData, spriteW, spriteH, { showGrid });

      storedFrames[i] = { canvas: frameCanvas, pixelData, spriteW, spriteH };
    }

    // Show the first frame on the main canvas
    currentFrame = 0;
    if (storedFrames[0]) {
      const ctx = pixelCanvas.getContext('2d');
      pixelCanvas.width = storedFrames[0].canvas.width;
      pixelCanvas.height = storedFrames[0].canvas.height;
      ctx.drawImage(storedFrames[0].canvas, 0, 0);
      pixelCanvas.style.display = 'block';
      pixelPlaceholder.style.display = 'none';
    }

    updateFrameUI();
    syncPlayerFrames();
    setStatus(`Done! ${total}-frame sprite sheet → ${processedFrames[0]?.spriteW}×${processedFrames[0]?.spriteH} ${consoleCfg.name} sprites.`, 'success');
    updatePromptDebug();

  } catch (err) {
    console.error('Sheet generation failed:', err);
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    setGenerating(false);
    genSheetBtn.disabled = false;
    genAllFramesBtn.disabled = false;
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

// Animation / view / frame controls
animStateSelect.addEventListener('change', () => {
  currentFrame = 0;
  updateFrameUI();
  // Show stored frame if available
  showFrameOnCanvas(0);
});

viewSelect.addEventListener('change', () => {
  currentFrame = 0;
  updateFrameUI();
  showFrameOnCanvas(0);
});

framePrevBtn.addEventListener('click', () => {
  if (currentFrame > 0) {
    currentFrame--;
    updateFrameUI();
    showFrameOnCanvas(currentFrame);
  }
});

frameNextBtn.addEventListener('click', () => {
  if (currentFrame < getFrameCount() - 1) {
    currentFrame++;
    updateFrameUI();
    showFrameOnCanvas(currentFrame);
  }
});

genAllFramesBtn.addEventListener('click', handleGenerateAllFrames);
genSheetBtn.addEventListener('click', handleGenerateSheet);

// Playback controls
playBtn.addEventListener('click', () => {
  const playing = player.toggle();
  playBtn.textContent = playing ? '⏸' : '▶';
});

stopBtn.addEventListener('click', () => {
  player.stop();
  playBtn.textContent = '▶';
});

fpsInput.addEventListener('change', () => {
  player.fps = Math.max(1, Math.min(30, parseInt(fpsInput.value, 10) || 8));
  fpsInput.value = player.fps;
});

pingPongCheckbox.addEventListener('change', () => {
  player.pingPong = pingPongCheckbox.checked;
});

onionSkinCheckbox.addEventListener('change', () => {
  player.onionSkinOpacity = onionSkinCheckbox.checked ? 0.25 : 0;
});

// Save / Load / Export
saveFramesBtn.addEventListener('click', async () => {
  const frames = getCurrentFrames().filter(f => f !== null);
  if (frames.length === 0) {
    setStatus('No frames to save. Generate some first.', 'error');
    return;
  }
  const charName = charNameInput.value.trim() || 'untitled';
  try {
    setStatus('Saving frames...', 'working');
    await saveAllFrames(getCurrentFrames(), {
      characterName: charName,
      consoleId: consoleSelect.value,
      animState: animStateSelect.value,
      view: viewSelect.value,
      prompt: inputField.value.trim(),
      model: modelSelect.value,
    });
    setStatus(`Saved ${frames.length} frames for "${charName}" (${animStateSelect.value}/${viewSelect.value}).`, 'success');
  } catch (err) {
    console.error('Save failed:', err);
    setStatus(`Save error: ${err.message}`, 'error');
  }
});

exportSheetBtn.addEventListener('click', async () => {
  const frames = getCurrentFrames().filter(f => f !== null);
  if (frames.length === 0) {
    setStatus('No frames to export. Generate some first.', 'error');
    return;
  }
  try {
    const charName = charNameInput.value.trim() || 'sprite';
    const consoleCfg = CONSOLES[consoleSelect.value];
    const animState = ANIMATION_STATES[animStateSelect.value];
    setStatus('Exporting sprite sheet...', 'working');
    const result = await exportSpriteSheet(frames, {
      characterName: charName,
      animName: animStateSelect.value,
      consoleName: consoleSelect.value,
      fps: player.fps,
      loop: animState.loop,
    });
    setStatus(`Exported ${result.pngName} + ${result.jsonName} (${frames.length} frames).`, 'success');
  } catch (err) {
    console.error('Export failed:', err);
    setStatus(`Export error: ${err.message}`, 'error');
  }
});

loadBtn.addEventListener('click', async () => {
  const charName = charNameInput.value.trim();
  if (!charName) {
    // Show available characters
    try {
      const chars = await listCharacters();
      if (chars.length === 0) {
        setStatus('No saved characters found.', 'error');
      } else {
        setStatus(`Saved characters: ${chars.join(', ')}. Enter a name and click Load.`, 'success');
      }
    } catch (err) {
      setStatus(`Load error: ${err.message}`, 'error');
    }
    return;
  }

  try {
    setStatus(`Loading "${charName}"...`, 'working');
    const animState = animStateSelect.value;
    const view = viewSelect.value;
    const loaded = await loadFrames(charName, animState, view);

    if (loaded.length === 0) {
      // Try listing what's available
      const anims = await listAnimations(charName);
      if (anims.length === 0) {
        setStatus(`No saved data for "${charName}".`, 'error');
      } else {
        const avail = anims.map(a => `${a.animState}/${a.view} (${a.frameCount}f)`).join(', ');
        setStatus(`No ${animState}/${view} for "${charName}". Available: ${avail}`, 'error');
      }
      return;
    }

    // Load into frame store
    const frames = getCurrentFrames();
    for (const f of loaded) {
      const idx = f.meta.frame;
      if (idx < frames.length) {
        frames[idx] = { canvas: f.canvas, spriteW: f.spriteW, spriteH: f.spriteH };
      }
    }

    currentFrame = 0;
    updateFrameUI();
    showFrameOnCanvas(0);
    syncPlayerFrames();
    setStatus(`Loaded ${loaded.length} frames for "${charName}" (${animState}/${view}).`, 'success');
  } catch (err) {
    console.error('Load failed:', err);
    setStatus(`Load error: ${err.message}`, 'error');
  }
});

// Re-process on control changes (no new API call)
spriteSizeSelect.addEventListener('change', handleReprocess);
ditherModeSelect.addEventListener('change', handleReprocess);
showGridCheckbox.addEventListener('change', handleReprocess);
pipelineModeSelect.addEventListener('change', () => {
  populateDitherOptions();
  handleReprocess();
});
outlinesCheckbox.addEventListener('change', handleReprocess);
cleanupCheckbox.addEventListener('change', handleReprocess);

// ─── Initialize ──────────────────────────────────────────────────────────────
initModels(); // Initialize model service with available providers
populateConsoleSelect();
populateSpriteSizes();
updateConsoleInfo();
populateModelSelect(DEFAULT_MODELS);
populateAnimStateSelect();
populateViewSelect();
populateDitherOptions();
updateFrameUI();
syncPlayerFrames();

// Set smart default negative prompt as placeholder
negativePromptInput.placeholder = DEFAULT_NEGATIVE_PROMPT;

// Async: fetch live model list and update dropdown
fetchImageModels().then((models) => {
  const currentModel = modelSelect.value;
  populateModelSelect(models);
  // Preserve user selection if still available
  const match = models.find(m => m.fullId === currentModel);
  if (match) modelSelect.value = currentModel;
});
