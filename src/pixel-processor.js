/**
 * Pixel Art Post-Processor — browser adapter.
 *
 * The downscale/quantize/dither/outline/cleanup math lives in src/core/
 * (pipeline.js, quantize.js, preprocess.js) and operates on plain
 * `{ data, width, height }` rasters so the Node CLI/MCP can share it. This
 * module owns only the browser-specific plumbing: decoding HTMLImageElement
 * sources via canvas, injecting the DOM-coupled RgbQuant 'classic'
 * quantizer, and wrapping results in real ImageData for canvas consumers.
 *
 * Pipelines:
 *   - enhanced: mode-based downscale, OKLAB quantization, optional Bayer
 *     dithering, auto-outline, orphan cleanup (portable)
 *   - classic: average downscale + RgbQuant sRGB quantization (browser-only)
 *
 * Quantization strategy per palette profile: 'palette' (fixed palette),
 * 'bitreduce' (per-channel bit depth, e.g. SNES), 'none' (raw downscale).
 */

import RgbQuant from "rgbquant";
import {
    processSourceRaster,
    sliceSheetRaster,
    sliceGridRaster,
    PIPELINE_MODES,
    DITHER_OPTIONS,
} from "./core/pipeline.js";
import {
    PREPROCESSING_PRESETS,
    preprocessRaster,
} from "./core/preprocess.js";
import { DEFAULT_PROFILE } from "./core/palettes.js";

export { PIPELINE_MODES, DITHER_OPTIONS, PREPROCESSING_PRESETS };

// ─── Browser plumbing ────────────────────────────────────────────────────────

/**
 * Decode an HTMLImageElement (or canvas-drawable source) into ImageData.
 */
function imageToRaster(img) {
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    if (!imgW || !imgH) {
        throw new Error(
            `Image has no dimensions (${imgW}x${imgH}). It may not be fully loaded.`,
        );
    }

    const tmpCanvas =
        typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(imgW, imgH)
            : (() => {
                  const c = document.createElement("canvas");
                  c.width = imgW;
                  c.height = imgH;
                  return c;
              })();
    const tmpCtx = tmpCanvas.getContext("2d");
    tmpCtx.drawImage(img, 0, 0);
    return tmpCtx.getImageData(0, 0, imgW, imgH);
}

/**
 * Wrap a core raster in a real ImageData (no pixel copy) so downstream
 * canvas APIs (putImageData, Dexie persistence of ImageData) keep working.
 */
function toImageData(raster) {
    if (typeof ImageData !== "undefined" && raster instanceof ImageData) {
        return raster;
    }
    return new ImageData(raster.data, raster.width, raster.height);
}

/**
 * Classic RgbQuant-based palette quantization — browser-only (RgbQuant
 * duck-types on ImageData/canvas classes), injected into the core pipeline.
 */
function classicQuantize(raster, { dithering = null, palette }) {
    const quant = new RgbQuant({
        colors: palette.length,
        palette: palette,
        dithKern: dithering,
        dithSerp: true,
        reIndex: false,
    });

    const imageData = toImageData(raster);
    const reduced = quant.reduce(imageData, 1);
    const result = new ImageData(imageData.width, imageData.height);
    result.data.set(reduced);
    return result;
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Full pipeline: take an HTMLImageElement and produce retro pixel art.
 *
 * @param {HTMLImageElement} img - Source image
 * @param {object} options
 * @param {string} options.consoleId - Palette profile key
 * @param {string} options.spriteSize - Sprite scale key or "WxH"
 * @param {string|null} options.dithering - Dithering mode or null
 * @param {string} options.pipeline - 'enhanced' or 'classic'
 * @param {boolean} options.outlines - Generate auto-outlines
 * @param {boolean} options.cleanup - Clean orphan pixels
 * @param {object|null} options.preprocessing - Preprocessing options (from PREPROCESSING_PRESETS)
 * @returns {Promise<{ pixelData: ImageData, spriteW: number, spriteH: number }>}
 */
export async function processImage(img, options = {}) {
    const sourceData = imageToRaster(img);

    const { pixelData, spriteW, spriteH } = processSourceRaster(sourceData, {
        ...options,
        classicQuantize,
    });

    return { pixelData: toImageData(pixelData), spriteW, spriteH };
}

/**
 * Process a batched sprite sheet result (from `generateSpriteSheet`): slice
 * each batch image into its frames and process each through the pixel art
 * pipeline. Preprocessing runs once on the whole batch image (before
 * slicing) so histogram-based passes like 'stabilize' normalize across all
 * frames consistently.
 *
 * @param {{ batches: Array<{ img: HTMLImageElement, frameCount: number, frameOffset: number }>, frameCount: number }} sheetResult
 * @param {object} options - Same options as processImage
 * @returns {Promise<{ frames: Array<{ pixelData: ImageData, spriteW: number, spriteH: number }> }>}
 */
export async function processSpriteSheet(sheetResult, options = {}) {
    const { batches, frameCount } = sheetResult;
    const {
        consoleId = DEFAULT_PROFILE,
        spriteSize,
        dithering = null,
        pipeline = "enhanced",
        outlines = true,
        cleanup = true,
        preprocessing = null,
    } = options;

    const frames = new Array(frameCount).fill(null);

    for (const batch of batches) {
        let batchRaster = imageToRaster(batch.img);
        if (preprocessing && preprocessing.enabled !== false) {
            batchRaster = preprocessRaster(batchRaster, preprocessing);
        }

        const frameRasters = sliceSheetRaster(batchRaster, batch.frameCount);

        frameRasters.forEach((frameRaster, i) => {
            const { pixelData, spriteW, spriteH } = processSourceRaster(
                frameRaster,
                {
                    consoleId,
                    spriteSize,
                    dithering,
                    pipeline,
                    outlines,
                    cleanup,
                    preprocessing: null, // already applied batch-wide above
                    classicQuantize,
                },
            );

            frames[batch.frameOffset + i] = {
                pixelData: toImageData(pixelData),
                spriteW,
                spriteH,
            };
        });
    }

    return { frames };
}

/**
 * Process a batched tile grid result (from `generateTileGrid`): slice each
 * batch image into its tiles and process each through the pixel art
 * pipeline. Generalizes `processSpriteSheet`'s 1×N slicing to M×N.
 *
 * @param {{ batches: Array<{ img: HTMLImageElement, cols: number, rows: number, startCol: number, startRow: number }>, cols: number, rows: number }} gridResult
 * @param {object} options - Same options as processImage
 * @returns {Promise<{ tiles: Array<{ pixelData: ImageData, spriteW: number, spriteH: number, gridX: number, gridY: number }>, cols: number, rows: number }>}
 */
export async function processTileGrid(gridResult, options = {}) {
    const { batches, cols, rows } = gridResult;
    const {
        consoleId = DEFAULT_PROFILE,
        spriteSize,
        dithering = null,
        pipeline = "enhanced",
        outlines = true,
        cleanup = true,
        preprocessing = null,
    } = options;

    const tiles = new Array(cols * rows).fill(null);

    for (const batch of batches) {
        let batchRaster = imageToRaster(batch.img);
        if (preprocessing && preprocessing.enabled !== false) {
            batchRaster = preprocessRaster(batchRaster, preprocessing);
        }

        const tileRasters = sliceGridRaster(batchRaster, batch.cols, batch.rows);

        tileRasters.forEach((tileRaster, idx) => {
            const r = Math.floor(idx / batch.cols);
            const c = idx % batch.cols;

            const { pixelData, spriteW, spriteH } = processSourceRaster(
                tileRaster,
                {
                    consoleId,
                    spriteSize,
                    dithering,
                    pipeline,
                    outlines,
                    cleanup,
                    preprocessing: null, // already applied batch-wide above
                    classicQuantize,
                },
            );

            const gridX = batch.startCol + c;
            const gridY = batch.startRow + r;
            tiles[gridY * cols + gridX] = {
                pixelData: toImageData(pixelData),
                spriteW,
                spriteH,
                gridX,
                gridY,
            };
        });
    }

    return { tiles, cols, rows };
}

/**
 * Render pixel art to a visible canvas with optional grid overlay.
 */
export function renderPixelArt(
    canvas,
    pixelData,
    spriteW,
    spriteH,
    options = {},
) {
    const {
        scale = Math.floor(Math.min(256 / spriteW, 256 / spriteH)),
        showGrid = false,
    } = options;

    const displayW = spriteW * scale;
    const displayH = spriteH * scale;

    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext("2d");

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
        ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
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
