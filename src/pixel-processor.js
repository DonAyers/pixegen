/**
 * Pixel Art Post-Processor
 *
 * Takes a generated image and converts it to NES-compliant pixel art:
 * 1. Downscale to target sprite size using histogram-based sampling
 * 2. Quantize colors to the NES palette
 * 3. Optionally apply dithering
 * 4. Render to canvas with pixel grid overlay
 */

import RgbQuant from 'rgbquant';
import { NES_PALETTE, SPRITE_SIZES, DEFAULT_SPRITE_SIZE } from './nes-palette.js';

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
 * Quantize an ImageData to the NES palette using RgbQuant.
 *
 * @param {ImageData} imageData - Input image data (already downscaled)
 * @param {object} options
 * @param {string} options.dithering - Dithering kernel name or null
 * @returns {ImageData} - Quantized image data
 */
function quantize(imageData, options = {}) {
  const { dithering = null } = options;

  const quant = new RgbQuant({
    colors: NES_PALETTE.length,
    palette: NES_PALETTE,
    dithKern: dithering,
    dithSerp: true,
    reIndex: false,
  });

  // Reduce to NES palette (returns Uint8Array of RGBA)
  const reduced = quant.reduce(imageData, 1);

  const result = new ImageData(imageData.width, imageData.height);
  result.data.set(reduced);
  return result;
}

/**
 * Full pipeline: take an HTMLImageElement and produce NES pixel art.
 *
 * @param {HTMLImageElement} img - Source image
 * @param {object} options
 * @param {string} options.spriteSize - Key from SPRITE_SIZES (default '32x32')
 * @param {string|null} options.dithering - Dithering kernel or null
 * @returns {{ pixelData: ImageData, spriteW: number, spriteH: number }}
 */
export function processImage(img, options = {}) {
  const {
    spriteSize = DEFAULT_SPRITE_SIZE,
    dithering = null,
  } = options;

  const size = SPRITE_SIZES[spriteSize];
  if (!size) throw new Error(`Unknown sprite size: ${spriteSize}`);

  const { width: spriteW, height: spriteH } = size;

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

  // Step 2: Quantize to NES palette
  const pixelData = quantize(downscaled, { dithering });

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
