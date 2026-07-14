/**
 * Downscale, quantization, and pixel-art post-processing math (portable).
 *
 * Every function takes and returns plain rasters ({ data, width, height } —
 * see raster.js); browser ImageData is accepted as input since it's
 * structurally identical. No canvas, no ImageData construction.
 */

import { createRaster, cloneRaster } from "./raster.js";
import { srgbToOklab, oklabDistSq, getPaletteOklab } from "./color.js";
import { reduceImageTo15Bit } from "./palettes.js";

// ─── Downscaling Algorithms ──────────────────────────────────────────────────

/**
 * Mode-based downscale: for each output pixel, find the most common color
 * in the corresponding source region. Preserves hard edges and outlines
 * instead of blurring them to mud like averaging does.
 */
export function downscaleMode(sourceData, targetW, targetH) {
    const { width: srcW, data: src } = sourceData;
    const srcH = sourceData.height;
    const out = createRaster(targetW, targetH);
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
            let bestCount = 0;
            let bestR = 0,
                bestG = 0,
                bestB = 0,
                bestA = 0;

            for (let sy = sy0; sy < sy1; sy++) {
                for (let sx = sx0; sx < sx1; sx++) {
                    const idx = (sy * srcW + sx) * 4;
                    const r = src[idx],
                        g = src[idx + 1],
                        b = src[idx + 2],
                        a = src[idx + 3];
                    const key = `${r >> 3},${g >> 3},${b >> 3},${a >> 3}`;

                    const count = (colorCounts.get(key) || 0) + 1;
                    colorCounts.set(key, count);

                    if (count > bestCount) {
                        bestCount = count;
                        bestR = r;
                        bestG = g;
                        bestB = b;
                        bestA = a;
                    }
                }
            }

            const dIdx = (y * targetW + x) * 4;
            dst[dIdx] = bestR;
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
export function downscaleAverage(sourceData, targetW, targetH) {
    const { width: srcW, data: src } = sourceData;
    const srcH = sourceData.height;
    const out = createRaster(targetW, targetH);
    const dst = out.data;

    const cellW = srcW / targetW;
    const cellH = srcH / targetH;

    for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
            const sx0 = Math.floor(x * cellW);
            const sy0 = Math.floor(y * cellH);
            const sx1 = Math.floor((x + 1) * cellW);
            const sy1 = Math.floor((y + 1) * cellH);

            let rSum = 0,
                gSum = 0,
                bSum = 0,
                aSum = 0,
                count = 0;

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
            dst[dIdx] = Math.round(rSum / count);
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
export function quantizeOklab(imageData, palette) {
    const { width, height, data } = imageData;
    const oklabPalette = getPaletteOklab(palette);
    const result = createRaster(width, height);
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

        dst[i] = palette[bestIdx][0];
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
export function quantizeOklabBayer(imageData, palette, strength = 0.3) {
    const { width, height, data } = imageData;
    const oklabPalette = getPaletteOklab(palette);
    const result = createRaster(width, height);
    const dst = result.data;

    const bayer4 = [
        [0 / 16 - 0.5, 8 / 16 - 0.5, 2 / 16 - 0.5, 10 / 16 - 0.5],
        [12 / 16 - 0.5, 4 / 16 - 0.5, 14 / 16 - 0.5, 6 / 16 - 0.5],
        [3 / 16 - 0.5, 11 / 16 - 0.5, 1 / 16 - 0.5, 9 / 16 - 0.5],
        [15 / 16 - 0.5, 7 / 16 - 0.5, 13 / 16 - 0.5, 5 / 16 - 0.5],
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
            const ditheredOklab = [
                pixelOklab[0] + threshold,
                pixelOklab[1],
                pixelOklab[2],
            ];

            let bestIdx = 0;
            let bestDist = Infinity;
            for (let j = 0; j < oklabPalette.length; j++) {
                const d = oklabDistSq(ditheredOklab, oklabPalette[j]);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = j;
                }
            }

            dst[i] = palette[bestIdx][0];
            dst[i + 1] = palette[bestIdx][1];
            dst[i + 2] = palette[bestIdx][2];
            dst[i + 3] = a;
        }
    }

    return result;
}

/**
 * Quantize via bit-depth reduction (SNES 15-bit).
 */
export function quantizeBitReduce(imageData) {
    const result = cloneRaster(imageData);
    reduceImageTo15Bit(result.data);
    return result;
}

// ─── Post-Processing ─────────────────────────────────────────────────────────

/**
 * Generate automatic 1px dark outlines around sprite edges.
 * Darkens non-transparent pixels that border transparent pixels or image edges.
 */
export function generateOutlines(imageData, darkenFactor = 0.35) {
    const { width: w, height: h, data } = imageData;
    const result = cloneRaster(imageData);
    const dst = result.data;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            if (data[idx + 3] < 10) continue;

            let isEdge = false;
            const neighbors = [
                [x - 1, y],
                [x + 1, y],
                [x, y - 1],
                [x, y + 1],
            ];

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
                dst[idx] = Math.round(data[idx] * (1 - darkenFactor));
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
export function cleanupOrphans(imageData, threshold = 3) {
    const { width: w, height: h, data } = imageData;
    const result = cloneRaster(imageData);
    const dst = result.data;

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;
            if (data[idx + 3] < 10) continue;

            const r = data[idx],
                g = data[idx + 1],
                b = data[idx + 2];
            let sameCount = 0;

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nIdx = ((y + dy) * w + (x + dx)) * 4;
                    if (
                        Math.abs(data[nIdx] - r) +
                            Math.abs(data[nIdx + 1] - g) +
                            Math.abs(data[nIdx + 2] - b) <
                        threshold * 3
                    ) {
                        sameCount++;
                    }
                }
            }

            if (sameCount === 0) {
                const neighborColors = new Map();
                let maxC = 0,
                    bestColor = [r, g, b];

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nIdx = ((y + dy) * w + (x + dx)) * 4;
                        if (data[nIdx + 3] < 10) continue;
                        const key = `${data[nIdx]},${data[nIdx + 1]},${data[nIdx + 2]}`;
                        const c = (neighborColors.get(key) || 0) + 1;
                        neighborColors.set(key, c);
                        if (c > maxC) {
                            maxC = c;
                            bestColor = [
                                data[nIdx],
                                data[nIdx + 1],
                                data[nIdx + 2],
                            ];
                        }
                    }
                }

                dst[idx] = bestColor[0];
                dst[idx + 1] = bestColor[1];
                dst[idx + 2] = bestColor[2];
            }
        }
    }

    return result;
}
