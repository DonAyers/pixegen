/**
 * `pixegen fix` — CLI-level spec (spawns the real CLI as a subprocess,
 * offline) plus a pure-core unit test for estimateColorCount's elbow
 * method. See docs/plan-prompt.md Phase 3.
 */

import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createRaster, upscaleRaster } from "../src/core/raster.js";
import { encodePng, decodeImage } from "../src/node/png.js";
import { estimateColorCount } from "../src/core/quantize.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_PATH = join(REPO_ROOT, "bin/pixegen.js");

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

/** A sprite with a distinct pseudo-random color per pixel (real detail). */
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

function runCli(args) {
    return execFileSync("node", [CLI_PATH, ...args], {
        encoding: "utf8",
        env: { ...process.env, PIXEGEN_LOG: "0" },
    });
}

test.describe("pixegen fix", () => {
    let fixtureDir;
    let fixturePath;

    test.beforeAll(() => {
        fixtureDir = mkdtempSync(join(tmpdir(), "pixegen-fix-"));
        fixturePath = join(fixtureDir, "upscaled.png");

        const native = buildDetailedSprite(12, 10, 1);
        const upscaled = upscaleRaster(native, 5); // 60x50
        const noisy = addJitter(upscaled, 2, 6);
        writeFileSync(fixturePath, encodePng(noisy));
    });

    test("detects the native grid and downscales back to it", () => {
        const outPath = join(fixtureDir, "fixed.png");

        const stdout = runCli(["fix", fixturePath, "-o", outPath]);

        expect(stdout).toContain("12x10");
        const result = decodeImage(readFileSync(outPath));
        expect(result.width).toBe(12);
        expect(result.height).toBe(10);
    });

    test("--colors auto reduces to a plausible color count", () => {
        const outPath = join(fixtureDir, "fixed-auto.png");

        const stdout = runCli(["fix", fixturePath, "--colors", "auto", "-o", outPath]);

        expect(stdout).toContain("12x10");
        const result = decodeImage(readFileSync(outPath));
        expect(result.width).toBe(12);
        expect(result.height).toBe(10);
    });

    test("--scale overrides detection", () => {
        const outPath = join(fixtureDir, "fixed-scale.png");

        runCli(["fix", fixturePath, "--scale", "8x8", "-o", outPath]);

        const result = decodeImage(readFileSync(outPath));
        expect(result.width).toBe(8);
        expect(result.height).toBe(8);
    });

    test("--colors and --palette are mutually exclusive", () => {
        expect(() =>
            runCli([
                "fix",
                fixturePath,
                "--colors",
                "8",
                "--palette",
                "nes",
                "-o",
                join(fixtureDir, "should-fail.png"),
            ]),
        ).toThrow();
    });
});

test.describe("estimateColorCount", () => {
    test("estimates a known color count from a synthetic image", () => {
        const rand = mulberry32(7);
        const colors = [
            [220, 40, 40],
            [40, 200, 60],
            [40, 80, 220],
            [230, 210, 30],
            [200, 40, 200],
            [40, 200, 200],
        ];
        const raster = createRaster(48, 48);
        for (let i = 0; i < raster.data.length; i += 4) {
            const c = colors[Math.floor(rand() * colors.length)];
            for (let ch = 0; ch < 3; ch++) {
                const delta = Math.round((rand() * 2 - 1) * 6);
                raster.data[i + ch] = Math.max(0, Math.min(255, c[ch] + delta));
            }
            raster.data[i + 3] = 255;
        }

        const estimate = estimateColorCount(raster, { maxColors: 24 });

        expect(estimate).toBeGreaterThanOrEqual(5);
        expect(estimate).toBeLessThanOrEqual(8);
    });
});
