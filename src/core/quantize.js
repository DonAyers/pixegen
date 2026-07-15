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

/**
 * K-means cluster a flat [r,g,b,r,g,b,...] array into up to `k` clusters
 * with a few iterations of Lloyd's algorithm. Centroids are seeded
 * deterministically (min/max luma pixels, then evenly-spaced samples for
 * k > 2) so output is reproducible without an RNG.
 * Ported from Astropulse/pixeldetector (MIT).
 *
 * @returns {{ centroids: number[][], counts: number[] }} - counts[i] is how
 *   many points ended up assigned to centroids[i]
 */
function kMeansRGB(rgb, k, iterations = 5) {
    const n = rgb.length / 3;
    if (n === 0) return { centroids: [[0, 0, 0]], counts: [0] };
    if (n === 1) return { centroids: [[rgb[0], rgb[1], rgb[2]]], counts: [1] };

    let minLuma = Infinity;
    let maxLuma = -Infinity;
    let minIdx = 0;
    let maxIdx = 0;
    for (let i = 0; i < n; i++) {
        const luma =
            0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
        if (luma < minLuma) {
            minLuma = luma;
            minIdx = i;
        }
        if (luma > maxLuma) {
            maxLuma = luma;
            maxIdx = i;
        }
    }

    const kEff = Math.max(1, Math.min(k, n));
    const seedAt = (i) => [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    const centroids = [seedAt(minIdx)];
    if (kEff > 1) centroids.push(seedAt(maxIdx));
    for (let c = 2; c < kEff; c++) {
        centroids.push(seedAt(Math.floor((c / kEff) * n)));
    }

    const assignment = new Int32Array(n);
    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < n; i++) {
            const r = rgb[i * 3];
            const g = rgb[i * 3 + 1];
            const b = rgb[i * 3 + 2];
            let best = 0;
            let bestDist = Infinity;
            for (let c = 0; c < centroids.length; c++) {
                const [cr, cg, cb] = centroids[c];
                const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
                if (d < bestDist) {
                    bestDist = d;
                    best = c;
                }
            }
            assignment[i] = best;
        }

        const sums = centroids.map(() => [0, 0, 0, 0]);
        for (let i = 0; i < n; i++) {
            const c = assignment[i];
            sums[c][0] += rgb[i * 3];
            sums[c][1] += rgb[i * 3 + 1];
            sums[c][2] += rgb[i * 3 + 2];
            sums[c][3]++;
        }
        for (let c = 0; c < centroids.length; c++) {
            if (sums[c][3] > 0) {
                centroids[c] = [
                    sums[c][0] / sums[c][3],
                    sums[c][1] / sums[c][3],
                    sums[c][2] / sums[c][3],
                ];
            }
        }
    }

    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < n; i++) counts[assignment[i]]++;
    return { centroids, counts };
}

/**
 * K-Centroid downscale: for each output pixel, k-means the corresponding
 * source tile's opaque colors and emit the most common resulting centroid
 * — noise-robust where averaging blurs and mode-based downscaling
 * speckles on noisy AI output.
 * Ported from Astropulse/pixeldetector (MIT).
 *
 * Alpha matches downscaleMode's spirit: a tile that's mostly transparent
 * (by pixel count) stays transparent in the output; otherwise alpha is the
 * average of the tile's opaque pixels.
 *
 * @param {{ data, width, height }} sourceData
 * @param {number} targetW
 * @param {number} targetH
 * @param {object} [options]
 * @param {number} [options.centroids=2] - k for the per-tile k-means
 */
export function downscaleKCentroid(sourceData, targetW, targetH, { centroids = 2 } = {}) {
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

            let transparentCount = 0;
            let opaqueCount = 0;
            let alphaSum = 0;
            const opaqueRgb = [];

            for (let sy = sy0; sy < sy1; sy++) {
                for (let sx = sx0; sx < sx1; sx++) {
                    const idx = (sy * srcW + sx) * 4;
                    const a = src[idx + 3];
                    if (a < 10) {
                        transparentCount++;
                        continue;
                    }
                    opaqueCount++;
                    alphaSum += a;
                    opaqueRgb.push(src[idx], src[idx + 1], src[idx + 2]);
                }
            }

            const dIdx = (y * targetW + x) * 4;
            if (opaqueCount === 0 || transparentCount > opaqueCount) {
                dst[dIdx] = dst[dIdx + 1] = dst[dIdx + 2] = 0;
                dst[dIdx + 3] = 0;
                continue;
            }

            const { centroids: clusters, counts } = kMeansRGB(opaqueRgb, centroids);
            let bestC = 0;
            let bestCount = -1;
            for (let c = 0; c < clusters.length; c++) {
                if (counts[c] > bestCount) {
                    bestCount = counts[c];
                    bestC = c;
                }
            }

            dst[dIdx] = Math.round(clusters[bestC][0]);
            dst[dIdx + 1] = Math.round(clusters[bestC][1]);
            dst[dIdx + 2] = Math.round(clusters[bestC][2]);
            dst[dIdx + 3] = Math.round(alphaSum / opaqueCount);
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
