/**
 * Pixel Art Post-Processor (Enhanced Pipeline)
 *
 * Takes a generated image and converts it to retro-console pixel art:
 *
 * Classic pipeline:
 *   1. Average-based downscale → RgbQuant palette quantization → render
 *
 * Enhanced pipeline:
 *   1. Mode-based downscale (preserves hard edges)
 *   2. OKLAB perceptual color quantization
 *   3. Optional Bayer ordered dithering
 *   4. Optional automatic outline generation
 *   5. Optional orphan pixel cleanup
 *   6. Render with optional grid overlay
 *
 * Supports two quantization modes per console:
 *   - 'palette': Fixed palette matching (NES, Genesis, GB, C64, Atari)
 *   - 'bitreduce': Per-channel bit-depth reduction (SNES 15-bit)
 */

import RgbQuant from 'rgbquant';
import { CONSOLES, DEFAULT_CONSOLE, reduceImageTo15Bit } from './palettes.js';

// ─── OKLAB Color Space ───────────────────────────────────────────────────────
// OKLAB is perceptually uniform — Euclidean distance in OKLAB corresponds to
// perceived color difference, unlike sRGB where green/blue distances are skewed.

/**
 * Convert sRGB [0-255] to linear light [0-1].
 */
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Convert sRGB [0-255] to OKLAB [L, a, b].
 * @param {number} r - Red 0-255
 * @param {number} g - Green 0-255
 * @param {number} b - Blue 0-255
 * @returns {number[]} [L, a, b]
 */
function srgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

/**
 * Squared Euclidean distance in OKLAB space (faster than sqrt).
 */
function oklabDistSq(lab1, lab2) {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return dL * dL + da * da + db * db;
}

// ─── Palette Pre-computation ─────────────────────────────────────────────────
const _paletteOklabCache = new Map();

function getPaletteOklab(palette) {
  if (_paletteOklabCache.has(palette)) return _paletteOklabCache.get(palette);
  const oklabPalette = palette.map(([r, g, b]) => srgbToOklab(r, g, b));
  _paletteOklabCache.set(palette, oklabPalette);
  return oklabPalette;
}

// ─── Downscaling Algorithms ──────────────────────────────────────────────────

/**
 * Mode-based downscale: for each output pixel, find the most common color
 * in the corresponding source region. Preserves hard edges and outlines
 * instead of blurring them to mud like averaging does.
 */
function downscaleMode(sourceData, targetW, targetH) {
  const { width: srcW, height: srcH, data: src } = sourceData;
  const out = new ImageData(targetW, targetH);
  const dst = out.data;

  const cellW = srcW / targetW;
  const cellH = srcH / targetH;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx0 = Math.floor(x * cellW);
      const sy0 = Math.floor(y * cellH);
      const sx1 = Math.floor((x + 1) * cellW);
      const sy1 = Math.floor((y + 1) * cellH);

      // Count color occurrences, quantize to 5-bit for grouping
      const colorCounts = new Map();
      let bestKey = '';
      let bestCount = 0;
      let bestR = 0, bestG = 0, bestB = 0, bestA = 0;

      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const idx = (sy * srcW + sx) * 4;
          const r = src[idx], g = src[idx + 1], b = src[idx + 2], a = src[idx + 3];
          const key = `${(r >> 3)},${(g >> 3)},${(b >> 3)},${(a >> 3)}`;

          const count = (colorCounts.get(key) || 0) + 1;
          colorCounts.set(key, count);

          if (count > bestCount) {
            bestCount = count;
            bestKey = key;
            bestR = r; bestG = g; bestB = b; bestA = a;
          }
        }
      }

      const dIdx = (y * targetW + x) * 4;
      dst[dIdx]     = bestR;
      dst[dIdx + 1] = bestG;
      dst[dIdx + 2] = bestB;
      dst[dIdx + 3] = bestA;
    }
  }

  return out;
}

/**
 * Average-based downscale (legacy/classic mode).
 */
function downscaleAverage(sourceData, targetW, targetH) {
  const { width: srcW, height: srcH, data: src } = sourceData;
  const out = new ImageData(targetW, targetH);
  const dst = out.data;

  const cellW = srcW / targetW;
  const cellH = srcH / targetH;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx0 = Math.floor(x * cellW);
      const sy0 = Math.floor(y * cellH);
      const sx1 = Math.floor((x + 1) * cellW);
      const sy1 = Math.floor((y + 1) * cellH);

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

// ─── Color Quantization ─────────────────────────────────────────────────────

/**
 * OKLAB nearest-color quantization.
 * Maps each pixel to the perceptually closest palette color.
 */
function quantizeOklab(imageData, palette) {
  const { width, height, data } = imageData;
  const oklabPalette = getPaletteOklab(palette);
  const result = new ImageData(width, height);
  const dst = result.data;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 10) {
      dst[i] = dst[i + 1] = dst[i + 2] = 0;
      dst[i + 3] = 0;
      continue;
    }

    const pixelOklab = srgbToOklab(data[i], data[i + 1], data[i + 2]);
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < oklabPalette.length; j++) {
      const d = oklabDistSq(pixelOklab, oklabPalette[j]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }

    dst[i]     = palette[bestIdx][0];
    dst[i + 1] = palette[bestIdx][1];
    dst[i + 2] = palette[bestIdx][2];
    dst[i + 3] = a;
  }

  return result;
}

/**
 * Bayer ordered dithering in OKLAB space.
 * Applies a 4x4 Bayer matrix threshold to produce the characteristic
 * pixel art cross-hatch dither pattern.
 */
function quantizeOklabBayer(imageData, palette, strength = 0.3) {
  const { width, height, data } = imageData;
  const oklabPalette = getPaletteOklab(palette);
  const result = new ImageData(width, height);
  const dst = result.data;

  const bayer4 = [
    [ 0/16 - 0.5,  8/16 - 0.5,  2/16 - 0.5, 10/16 - 0.5],
    [12/16 - 0.5,  4/16 - 0.5, 14/16 - 0.5,  6/16 - 0.5],
    [ 3/16 - 0.5, 11/16 - 0.5,  1/16 - 0.5,  9/16 - 0.5],
    [15/16 - 0.5,  7/16 - 0.5, 13/16 - 0.5,  5/16 - 0.5],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];

      if (a < 10) {
        dst[i] = dst[i + 1] = dst[i + 2] = 0;
        dst[i + 3] = 0;
        continue;
      }

      const pixelOklab = srgbToOklab(data[i], data[i + 1], data[i + 2]);
      const threshold = bayer4[y % 4][x % 4] * strength;
      const ditheredOklab = [pixelOklab[0] + threshold, pixelOklab[1], pixelOklab[2]];

      let bestIdx = 0;
      let bestDist = Infinity;
      for (let j = 0; j < oklabPalette.length; j++) {
        const d = oklabDistSq(ditheredOklab, oklabPalette[j]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }

      dst[i]     = palette[bestIdx][0];
      dst[i + 1] = palette[bestIdx][1];
      dst[i + 2] = palette[bestIdx][2];
      dst[i + 3] = a;
    }
  }

  return result;
}

/**
 * Classic RgbQuant-based palette quantization (legacy).
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

  const reduced = quant.reduce(imageData, 1);
  const result = new ImageData(imageData.width, imageData.height);
  result.data.set(reduced);
  return result;
}

/**
 * Quantize via bit-depth reduction (SNES 15-bit).
 */
function quantizeBitReduce(imageData) {
  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  reduceImageTo15Bit(result.data);
  return result;
}

// ─── Post-Processing ─────────────────────────────────────────────────────────

/**
 * Generate automatic 1px dark outlines around sprite edges.
 * Darkens non-transparent pixels that border transparent pixels or image edges.
 */
function generateOutlines(imageData, darkenFactor = 0.35) {
  const { width: w, height: h, data } = imageData;
  const result = new ImageData(new Uint8ClampedArray(data), w, h);
  const dst = result.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx + 3] < 10) continue;

      let isEdge = false;
      const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
          isEdge = true;
          break;
        }
        if (data[(ny * w + nx) * 4 + 3] < 10) {
          isEdge = true;
          break;
        }
      }

      if (isEdge) {
        dst[idx]     = Math.round(data[idx] * (1 - darkenFactor));
        dst[idx + 1] = Math.round(data[idx + 1] * (1 - darkenFactor));
        dst[idx + 2] = Math.round(data[idx + 2] * (1 - darkenFactor));
      }
    }
  }

  return result;
}

/**
 * Remove orphan pixels (anti-aliasing artifacts).
 * Replaces isolated single pixels with their most common neighbor color.
 */
function cleanupOrphans(imageData, threshold = 3) {
  const { width: w, height: h, data } = imageData;
  const result = new ImageData(new Uint8ClampedArray(data), w, h);
  const dst = result.data;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx + 3] < 10) continue;

      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      let sameCount = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nIdx = ((y + dy) * w + (x + dx)) * 4;
          if (Math.abs(data[nIdx] - r) + Math.abs(data[nIdx+1] - g) + Math.abs(data[nIdx+2] - b) < threshold * 3) {
            sameCount++;
          }
        }
      }

      if (sameCount === 0) {
        const neighborColors = new Map();
        let maxC = 0, bestColor = [r, g, b];

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nIdx = ((y + dy) * w + (x + dx)) * 4;
            if (data[nIdx + 3] < 10) continue;
            const key = `${data[nIdx]},${data[nIdx+1]},${data[nIdx+2]}`;
            const c = (neighborColors.get(key) || 0) + 1;
            neighborColors.set(key, c);
            if (c > maxC) {
              maxC = c;
              bestColor = [data[nIdx], data[nIdx+1], data[nIdx+2]];
            }
          }
        }

        dst[idx]     = bestColor[0];
        dst[idx + 1] = bestColor[1];
        dst[idx + 2] = bestColor[2];
      }
    }
  }

  return result;
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Processing pipeline modes.
 */
export const PIPELINE_MODES = [
  { value: 'enhanced', label: 'Enhanced (OKLAB + edge-preserving)' },
  { value: 'classic', label: 'Classic (RgbQuant sRGB)' },
];

/**
 * Available dithering options per pipeline mode.
 */
export const DITHER_OPTIONS = {
  enhanced: [
    { value: '', label: 'None' },
    { value: 'bayer', label: 'Bayer 4×4 (pixel art style)' },
  ],
  classic: [
    { value: '', label: 'None' },
    { value: 'FloydSteinberg', label: 'Floyd-Steinberg' },
    { value: 'Atkinson', label: 'Atkinson' },
    { value: 'Stucki', label: 'Stucki' },
    { value: 'Sierra', label: 'Sierra' },
    { value: 'SierraLite', label: 'Sierra Lite' },
  ],
};

/**
 * Full pipeline: take an HTMLImageElement and produce retro pixel art.
 *
 * @param {HTMLImageElement} img - Source image
 * @param {object} options
 * @param {string} options.consoleId - Console key from CONSOLES
 * @param {string} options.spriteSize - Sprite size key
 * @param {string|null} options.dithering - Dithering mode or null
 * @param {string} options.pipeline - 'enhanced' or 'classic'
 * @param {boolean} options.outlines - Generate auto-outlines
 * @param {boolean} options.cleanup - Clean orphan pixels
 * @returns {{ pixelData: ImageData, spriteW: number, spriteH: number }}
 */
export function processImage(img, options = {}) {
  const {
    consoleId = DEFAULT_CONSOLE,
    spriteSize,
    dithering = null,
    pipeline = 'enhanced',
    outlines = true,
    cleanup = true,
  } = options;

  const consoleConfig = CONSOLES[consoleId];
  if (!consoleConfig) throw new Error(`Unknown console: ${consoleId}`);

  const effectiveSize = spriteSize || consoleConfig.defaultSize;
  const size = consoleConfig.spriteSizes[effectiveSize];
  if (!size) throw new Error(`Unknown sprite size "${effectiveSize}" for ${consoleConfig.name}`);

  const { w: spriteW, h: spriteH } = size;
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  if (!imgW || !imgH) {
    throw new Error(`Image has no dimensions (${imgW}x${imgH}). It may not be fully loaded.`);
  }

  const tmpCanvas = new OffscreenCanvas(imgW, imgH);
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(img, 0, 0);
  const sourceData = tmpCtx.getImageData(0, 0, imgW, imgH);

  // Step 1: Downscale
  const downscaled = pipeline === 'enhanced'
    ? downscaleMode(sourceData, spriteW, spriteH)
    : downscaleAverage(sourceData, spriteW, spriteH);

  // Step 2: Quantize to console palette
  let pixelData;
  if (consoleConfig.quantizeMode === 'bitreduce') {
    pixelData = quantizeBitReduce(downscaled);
  } else if (pipeline === 'enhanced') {
    if (dithering === 'bayer') {
      pixelData = quantizeOklabBayer(downscaled, consoleConfig.palette);
    } else {
      pixelData = quantizeOklab(downscaled, consoleConfig.palette);
    }
  } else {
    pixelData = quantizePalette(downscaled, {
      dithering,
      palette: consoleConfig.palette,
    });
  }

  // Step 3: Post-processing (enhanced pipeline only)
  if (pipeline === 'enhanced') {
    if (cleanup) {
      pixelData = cleanupOrphans(pixelData);
    }
    if (outlines) {
      pixelData = generateOutlines(pixelData);
    }
  }

  return { pixelData, spriteW, spriteH };
}

/**
 * Process a sprite sheet image: slice into N frames, process each through
 * the pixel art pipeline, sharing palette across frames for consistency.
 *
 * @param {HTMLImageElement} img - Source sprite sheet image (horizontal strip)
 * @param {number} frameCount - Number of frames to slice
 * @param {object} options - Same options as processImage
 * @returns {{ frames: Array<{ pixelData: ImageData, spriteW: number, spriteH: number }> }}
 */
export function processSpriteSheet(img, frameCount, options = {}) {
  const {
    consoleId = DEFAULT_CONSOLE,
    spriteSize,
    dithering = null,
    pipeline = 'enhanced',
    outlines = true,
    cleanup = true,
  } = options;

  const consoleConfig = CONSOLES[consoleId];
  if (!consoleConfig) throw new Error(`Unknown console: ${consoleId}`);

  const effectiveSize = spriteSize || consoleConfig.defaultSize;
  const size = consoleConfig.spriteSizes[effectiveSize];
  if (!size) throw new Error(`Unknown sprite size "${effectiveSize}" for ${consoleConfig.name}`);

  const { w: spriteW, h: spriteH } = size;
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  if (!imgW || !imgH) {
    throw new Error(`Image has no dimensions. It may not be fully loaded.`);
  }

  // Slice the sheet: divide width into frameCount equal columns
  const frameW = Math.floor(imgW / frameCount);
  const tmpCanvas = new OffscreenCanvas(imgW, imgH);
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(img, 0, 0);

  // Extract palette from first frame for shared palette mode
  let sharedPaletteOklab = null;

  const frames = [];

  for (let i = 0; i < frameCount; i++) {
    // Extract this frame's region
    const frameCanvas = new OffscreenCanvas(frameW, imgH);
    const frameCtx = frameCanvas.getContext('2d');
    frameCtx.drawImage(tmpCanvas, i * frameW, 0, frameW, imgH, 0, 0, frameW, imgH);
    const sourceData = frameCtx.getImageData(0, 0, frameW, imgH);

    // Step 1: Downscale
    const downscaled = pipeline === 'enhanced'
      ? downscaleMode(sourceData, spriteW, spriteH)
      : downscaleAverage(sourceData, spriteW, spriteH);

    // Step 2: Quantize
    let pixelData;
    if (consoleConfig.quantizeMode === 'bitreduce') {
      pixelData = quantizeBitReduce(downscaled);
    } else if (pipeline === 'enhanced') {
      // Use shared palette: extract from first frame, reuse for all
      if (i === 0 && !sharedPaletteOklab) {
        sharedPaletteOklab = getPaletteOklab(consoleConfig.palette);
      }
      if (dithering === 'bayer') {
        pixelData = quantizeOklabBayer(downscaled, consoleConfig.palette);
      } else {
        pixelData = quantizeOklab(downscaled, consoleConfig.palette);
      }
    } else {
      pixelData = quantizePalette(downscaled, {
        dithering,
        palette: consoleConfig.palette,
      });
    }

    // Step 3: Post-processing
    if (pipeline === 'enhanced') {
      if (cleanup) {
        pixelData = cleanupOrphans(pixelData);
      }
      if (outlines) {
        pixelData = generateOutlines(pixelData);
      }
    }

    frames.push({ pixelData, spriteW, spriteH });
  }

  return { frames };
}

/**
 * Render pixel art to a visible canvas with optional grid overlay.
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
