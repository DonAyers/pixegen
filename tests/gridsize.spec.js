/**
 * Pixel grid detection — pure-core tests (no browser). Verifies the ported
 * Astropulse/pixeldetector grid-recovery algorithm (docs/RETRO-DIFFUSION.md)
 * on synthetic upscaled sprites, a blurred (JPEG-softness) upscale, plain
 * noise, and a native-resolution sprite that must not false-positive a
 * larger grid.
 */

import { test, expect } from "@playwright/test";
import { detectPixelGrid, findPeaks } from "../src/core/gridsize.js";
import { createRaster, upscaleRaster } from "../src/core/raster.js";

function mulberry32(seed) {
    let s = seed;
    return function rand() {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A sprite with a distinct pseudo-random color per pixel — real sprite
 * detail, so every source-pixel boundary produces edge energy once
 * upscaled (a flat/solid sprite would have no internal edges to detect). */
function buildDetailedSprite(w, h, seed) {
    const rand = mulberry32(seed);
    const raster = createRaster(w, h);
    for (let i = 0; i < raster.data.length; i += 4) {
        raster.data[i] = Math.floor(rand() * 256);
        raster.data[i + 1] = Math.floor(rand() * 256);
        raster.data[i + 2] = Math.floor(rand() * 256);
        raster.data[i + 3] = 255;
    }
    return raster;
}

function addJitter(raster, seed, amp = 6) {
    const rand = mulberry32(seed);
    const out = {
        data: new Uint8ClampedArray(raster.data),
        width: raster.width,
        height: raster.height,
    };
    for (let i = 0; i < out.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            const delta = Math.round((rand() * 2 - 1) * amp);
            out.data[i + c] = Math.max(0, Math.min(255, out.data[i + c] + delta));
        }
    }
    return out;
}

/** Simulate JPEG/upscale softness with a simple box blur. */
function boxBlur(raster, radius = 1) {
    const { width, height, data } = raster;
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const sx = x + dx;
                    const sy = y + dy;
                    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
                    const i = (sy * width + sx) * 4;
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    a += data[i + 3];
                    n++;
                }
            }
            const i = (y * width + x) * 4;
            out[i] = r / n;
            out[i + 1] = g / n;
            out[i + 2] = b / n;
            out[i + 3] = a / n;
        }
    }
    return { data: out, width, height };
}

test.describe("findPeaks", () => {
    test("finds local maxima above a prominence threshold", () => {
        const values = [0, 1, 5, 1, 0, 0, 1, 8, 1, 0];
        const peaks = findPeaks(values, { minProminence: 2, minDistance: 1 });
        expect(peaks).toEqual([2, 7]);
    });

    test("suppresses peaks closer than minDistance, keeping the taller one", () => {
        const values = [0, 5, 0, 6, 0, 5, 0];
        const peaks = findPeaks(values, { minProminence: 1, minDistance: 3 });
        expect(peaks).toEqual([3]);
    });

    test("ignores low-prominence bumps on a noisy plateau", () => {
        const values = [10, 10.5, 10, 10.4, 10, 20, 10];
        const peaks = findPeaks(values, { minProminence: 5, minDistance: 1 });
        expect(peaks).toEqual([5]);
    });
});

test.describe("detectPixelGrid", () => {
    for (const scale of [3, 5, 7]) {
        test(`recovers native size for a ${scale}x upscaled noisy sprite`, () => {
            const base = buildDetailedSprite(10, 8, 100 + scale);
            const upscaled = upscaleRaster(base, scale);
            const noisy = addJitter(upscaled, 200 + scale, 6);

            const result = detectPixelGrid(noisy);

            expect(result.spacingX).toBe(scale);
            expect(result.spacingY).toBe(scale);
            expect(result.nativeW).toBe(10);
            expect(result.nativeH).toBe(8);
            expect(result.confidence).toBeGreaterThan(0.8);
        });
    }

    test("still detects the grid on a blurred (JPEG-soft) upscale", () => {
        const scale = 6;
        const base = buildDetailedSprite(9, 9, 55);
        const upscaled = upscaleRaster(base, scale);
        const blurred = boxBlur(upscaled, 1);

        const result = detectPixelGrid(blurred);

        expect(result.spacingX).toBe(scale);
        expect(result.spacingY).toBe(scale);
        expect(result.nativeW).toBe(9);
        expect(result.nativeH).toBe(9);
        expect(result.confidence).toBeGreaterThan(0.5);
    });

    test("reports low confidence on random noise (no periodic grid)", () => {
        const rand = mulberry32(999);
        const raster = createRaster(64, 64);
        for (let i = 0; i < raster.data.length; i += 4) {
            raster.data[i] = Math.floor(rand() * 256);
            raster.data[i + 1] = Math.floor(rand() * 256);
            raster.data[i + 2] = Math.floor(rand() * 256);
            raster.data[i + 3] = 255;
        }

        const result = detectPixelGrid(raster);

        expect(result.confidence).toBeLessThan(0.3);
    });

    test("returns confidence 0 / spacing 1 for a flat image (no usable peaks)", () => {
        const raster = createRaster(32, 32);
        for (let i = 0; i < raster.data.length; i += 4) {
            raster.data.set([120, 80, 200, 255], i);
        }

        const result = detectPixelGrid(raster);

        expect(result.spacingX).toBe(1);
        expect(result.spacingY).toBe(1);
        expect(result.confidence).toBe(0);
    });

    test("does not false-positive a larger grid on an already-native-res sprite", () => {
        const base = buildDetailedSprite(16, 16, 77);

        const result = detectPixelGrid(base);

        expect(result.nativeW).toBe(16);
        expect(result.nativeH).toBe(16);
    });
});
