/**
 * K-Centroid downscale — pure-core tests (no browser). Verifies the ported
 * Astropulse/pixeldetector algorithm actually beats plain averaging on the
 * case it exists for (docs/RETRO-DIFFUSION.md): a downsample tile that mixes
 * two genuinely different source colors (anti-aliased/AI-noisy edges), where
 * averaging blends them into a muddy color that matches neither, but
 * k-means clustering can reject the minority color and recover the
 * majority one cleanly.
 */

import { test, expect } from "@playwright/test";
import { downscaleKCentroid, downscaleAverage } from "../src/core/quantize.js";
import { createRaster, upscaleRaster } from "../src/core/raster.js";

/** Deterministic seeded PRNG (mulberry32) — no test depends on Math.random. */
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

const QUADRANT_COLORS = [
    [220, 40, 40],
    [40, 200, 60],
    [40, 80, 220],
    [230, 210, 30],
];

/** 8x8 ground-truth sprite: four solid-color quadrants. */
function buildGroundTruthSprite() {
    const raster = createRaster(8, 8);
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const ci = (y < 4 ? 0 : 2) + (x < 4 ? 0 : 1);
            raster.data.set([...QUADRANT_COLORS[ci], 255], (y * 8 + x) * 4);
        }
    }
    return raster;
}

/**
 * Build a noisy `8*scale` square source raster from the ground-truth
 * sprite: each output-aligned cell is mostly its true quadrant color (with
 * small per-channel jitter) but a minority of pixels within the same cell
 * bleed in a different quadrant's color — simulating anti-aliased edges or
 * AI generation noise, the two-cluster case K-Centroid targets.
 */
function buildNoisySource(scale, seed, { jitter = 2, bleedRate = 0.2 } = {}) {
    const rand = mulberry32(seed);
    const size = 8 * scale;
    const out = createRaster(size, size);
    for (let cy = 0; cy < 8; cy++) {
        for (let cx = 0; cx < 8; cx++) {
            const ci = (cy < 4 ? 0 : 2) + (cx < 4 ? 0 : 1);
            const bleedCi = (ci + 1 + Math.floor(rand() * 3)) % 4;
            for (let dy = 0; dy < scale; dy++) {
                for (let dx = 0; dx < scale; dx++) {
                    const base =
                        rand() < bleedRate
                            ? QUADRANT_COLORS[bleedCi]
                            : QUADRANT_COLORS[ci];
                    const idx =
                        ((cy * scale + dy) * size + (cx * scale + dx)) * 4;
                    for (let c = 0; c < 3; c++) {
                        const delta = Math.round((rand() * 2 - 1) * jitter);
                        out.data[idx + c] = Math.max(
                            0,
                            Math.min(255, base[c] + delta),
                        );
                    }
                    out.data[idx + 3] = 255;
                }
            }
        }
    }
    return out;
}

function countExactRgbMatches(actual, expected) {
    let matches = 0;
    const n = actual.width * actual.height;
    for (let i = 0; i < n; i++) {
        const a = i * 4;
        if (
            actual.data[a] === expected.data[a] &&
            actual.data[a + 1] === expected.data[a + 1] &&
            actual.data[a + 2] === expected.data[a + 2]
        ) {
            matches++;
        }
    }
    return matches;
}

test.describe("downscaleKCentroid", () => {
    test("recovers a noisy two-color-per-tile source better than averaging", () => {
        const truth = buildGroundTruthSprite();
        const noisy = buildNoisySource(8, 42);

        const kcentroid = downscaleKCentroid(noisy, 8, 8);
        const averaged = downscaleAverage(noisy, 8, 8);

        const kMatches = countExactRgbMatches(kcentroid, truth);
        const avgMatches = countExactRgbMatches(averaged, truth);

        expect(kMatches).toBeGreaterThanOrEqual(61); // >= 95% of 64 pixels
        expect(kMatches).toBeGreaterThan(avgMatches);
    });

    test("preserves alpha: majority-transparent tiles stay transparent, opaque tiles keep alpha", () => {
        const raster = createRaster(4, 4);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const idx = (y * 4 + x) * 4;
                if (x < 2) {
                    raster.data.set([200, 30, 30, 255], idx);
                } else {
                    raster.data.set([0, 0, 0, 0], idx);
                }
            }
        }
        const upscaled = upscaleRaster(raster, 4); // 16x16, cleanly aligned
        const result = downscaleKCentroid(upscaled, 4, 4);

        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const idx = (y * 4 + x) * 4;
                if (x < 2) {
                    expect(result.data[idx]).toBe(200);
                    expect(result.data[idx + 1]).toBe(30);
                    expect(result.data[idx + 2]).toBe(30);
                    expect(result.data[idx + 3]).toBeGreaterThan(200);
                } else {
                    expect(result.data[idx + 3]).toBe(0);
                }
            }
        }
    });

    test("handles a non-integer scale factor (65x63 source -> 8x8) without error", () => {
        const source = createRaster(65, 63);
        const rand = mulberry32(7);
        for (let i = 0; i < source.data.length; i += 4) {
            source.data[i] = Math.floor(rand() * 256);
            source.data[i + 1] = Math.floor(rand() * 256);
            source.data[i + 2] = Math.floor(rand() * 256);
            source.data[i + 3] = 255;
        }

        const result = downscaleKCentroid(source, 8, 8);

        expect(result.width).toBe(8);
        expect(result.height).toBe(8);
        expect(result.data.length).toBe(8 * 8 * 4);
        // Every pixel should be a real sampled/averaged color, not left blank.
        let nonBlack = 0;
        for (let i = 0; i < result.data.length; i += 4) {
            if (result.data[i + 3] === 255) nonBlack++;
        }
        expect(nonBlack).toBe(64);
    });

    test("a single dominant color with no competing cluster round-trips cleanly", () => {
        const solid = createRaster(4, 4);
        for (let i = 0; i < solid.data.length; i += 4) {
            solid.data.set([100, 150, 200, 255], i);
        }
        const upscaled = upscaleRaster(solid, 8); // 32x32
        const result = downscaleKCentroid(upscaled, 4, 4);
        for (let i = 0; i < result.data.length; i += 4) {
            expect(result.data[i]).toBe(100);
            expect(result.data[i + 1]).toBe(150);
            expect(result.data[i + 2]).toBe(200);
            expect(result.data[i + 3]).toBe(255);
        }
    });
});
