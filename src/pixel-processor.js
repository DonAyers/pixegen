/**
 * Pixel Art Post-Processor
 *
 * Takes a generated image and converts it to retro-console pixel art:
 * 1. Downscale to target sprite size using average-based sampling
 * 2. Quantize colors to the selected console's palette
 * 3. Optionally apply dithering
 * 4. Render to canvas with pixel grid overlay
 *
 * Supports two quantization modes:
 *   - 'palette': Fixed palette quantization via RgbQuant (NES, Genesis, GB, C64, Atari)
 *   - 'bitreduce': Per-channel bit-depth reduction (SNES 15-bit)
 */

import RgbQuant from 'rgbquant';
import { CONSOLES, DEFAULT_CONSOLE, reduceImageTo15Bit } from './palettes.js';

/**
 * Downscale an image to the target pixel art size.
 * Uses a mode-based approach: for each output pixel, find the most
 * common color in the corresponding source region.
 *
 * @param {ImageData} sourceData - Source image data
 * @param {number} targetW - Target width in pixels
 * @param {number} targetH - Target height in pixels
 * @returns {ImageData} - Downscaled image data
 */
function downscale(sourceData, targetW, targetH) {
  const { width: srcW, height: srcH, data: src } = sourceData;
  const out = new ImageData(targetW, targetH);
  const dst = out.data;

  const cellW = srcW / targetW;
  const cellH = srcH / targetH;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      // Source region for this output pixel
      const sx0 = Math.floor(x * cellW);
      const sy0 = Math.floor(y * cellH);
      const sx1 = Math.floor((x + 1) * cellW);
      const sy1 = Math.floor((y + 1) * cellH);

      // Accumulate average color in this cell
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0;

      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const idx = (sy * srcW + sx) * 4;
          rSum += src[idx];
          gSum += src[idx + 1];
          bSum += src[idx + 2];
          aSum += src[idx + 3];
          count++;
        }
      }

      const dIdx = (y * targetW + x) * 4;
      dst[dIdx]     = Math.round(rSum / count);
      dst[dIdx + 1] = Math.round(gSum / count);
      dst[dIdx + 2] = Math.round(bSum / count);
      dst[dIdx + 3] = Math.round(aSum / count);
    }
  }

  return out;
}

/**
 * Quantize an ImageData to a console's palette using RgbQuant.
 *
 * @param {ImageData} imageData - Input image data (already downscaled)
 * @param {object} options
 * @param {string} options.dithering - Dithering kernel name or null
 * @param {number[][]} options.palette - Array of [R,G,B] colors
 * @returns {ImageData} - Quantized image data
 */
function quantizePalette(imageData, options = {}) {
  const { dithering = null, palette } = options;

  const quant = new RgbQuant({
    colors: palette.length,
    palette: palette,
    dithKern: dithering,
    dithSerp: true,
    reIndex: false,
  });

  // Reduce to palette (returns Uint8Array of RGBA)
  const reduced = quant.reduce(imageData, 1);

  const result = new ImageData(imageData.width, imageData.height);
  result.data.set(reduced);
  return result;
}

/**
 * Quantize via bit-depth reduction (e.g. SNES 15-bit).
 *
 * @param {ImageData} imageData - Input image data
 * @param {object} options
 * @param {string} options.dithering - Dithering kernel (used for pre-dither, then reduce)
 * @returns {ImageData} - Quantized image data
 */
function quantizeBitReduce(imageData, options = {}) {
  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  reduceImageTo15Bit(result.data);
  return result;
}

/**
 * Full pipeline: take an HTMLImageElement and produce retro pixel art.
 *
 * @param {HTMLImageElement} img - Source image
 * @param {object} options
 * @param {string} options.consoleId - Console key from CONSOLES (default: DEFAULT_CONSOLE)
 * @param {string} options.spriteSize - Sprite size key (default: console's default)
 * @param {string|null} options.dithering - Dithering kernel or null
 * @returns {{ pixelData: ImageData, spriteW: number, spriteH: number }}
 */
export function processImage(img, options = {}) {
  const {
    consoleId = DEFAULT_CONSOLE,
    spriteSize,
    dithering = null,
  } = options;

  const consoleConfig = CONSOLES[consoleId];
  if (!consoleConfig) throw new Error(`Unknown console: ${consoleId}`);

  const effectiveSize = spriteSize || consoleConfig.defaultSize;
  const size = consoleConfig.spriteSizes[effectiveSize];
  if (!size) throw new Error(`Unknown sprite size "${effectiveSize}" for ${consoleConfig.name}`);

  const { w: spriteW, h: spriteH } = size;

  // Use naturalWidth/Height with fallback to width/height
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  if (!imgW || !imgH) {
    throw new Error(`Image has no dimensions (${imgW}x${imgH}). It may not be fully loaded.`);
  }

  // Draw image to an offscreen canvas to get pixel data
  const tmpCanvas = new OffscreenCanvas(imgW, imgH);
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(img, 0, 0);
  const sourceData = tmpCtx.getImageData(0, 0, imgW, imgH);

  // Step 1: Downscale
  const downscaled = downscale(sourceData, spriteW, spriteH);

  // Step 2: Quantize to console palette
  let pixelData;
  if (consoleConfig.quantizeMode === 'bitreduce') {
    pixelData = quantizeBitReduce(downscaled, { dithering });
  } else {
    pixelData = quantizePalette(downscaled, {
      dithering,
      palette: consoleConfig.palette,
    });
  }

  return { pixelData, spriteW, spriteH };
}

/**
 * Render pixel art to a visible canvas with optional grid overlay.
 *
 * @param {HTMLCanvasElement} canvas - Target canvas element
 * @param {ImageData} pixelData - The pixel art image data
 * @param {number} spriteW - Sprite width in pixels
 * @param {number} spriteH - Sprite height in pixels
 * @param {object} options
 * @param {number} options.scale - Upscale factor (default: auto-fit)
 * @param {boolean} options.showGrid - Show pixel grid lines
 */
export function renderPixelArt(canvas, pixelData, spriteW, spriteH, options = {}) {
  const {
    scale = Math.floor(Math.min(256 / spriteW, 256 / spriteH)),
    showGrid = false,
  } = options;

  const displayW = spriteW * scale;
  const displayH = spriteH * scale;

  canvas.width = displayW;
  canvas.height = displayH;

  const ctx = canvas.getContext('2d');

  // Draw each pixel as a scaled rectangle (nearest-neighbor upscale)
  const src = pixelData.data;
  for (let y = 0; y < spriteH; y++) {
    for (let x = 0; x < spriteW; x++) {
      const idx = (y * spriteW + x) * 4;
      const r = src[idx];
      const g = src[idx + 1];
      const b = src[idx + 2];
      const a = src[idx + 3];

      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  // Optional grid overlay
  if (showGrid && scale >= 4) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= spriteW; x++) {
      ctx.beginPath();
      ctx.moveTo(x * scale + 0.5, 0);
      ctx.lineTo(x * scale + 0.5, displayH);
      ctx.stroke();
    }

    for (let y = 0; y <= spriteH; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * scale + 0.5);
      ctx.lineTo(displayW, y * scale + 0.5);
      ctx.stroke();
    }
  }
}

/**
 * Available dithering options
 */
export const DITHER_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'FloydSteinberg', label: 'Floyd-Steinberg' },
  { value: 'Atkinson', label: 'Atkinson' },
  { value: 'Stucki', label: 'Stucki' },
  { value: 'Sierra', label: 'Sierra' },
  { value: 'SierraLite', label: 'Sierra Lite' },
];
