/**
 * The pixel-art processing pipeline (portable).
 *
 * processSourceRaster runs preprocess → downscale → quantize → post-process
 * on a plain raster and is the single implementation behind the browser's
 * pixel-processor.js and the Node CLI/MCP path.
 *
 * The 'classic' pipeline's RgbQuant quantizer duck-types on DOM classes, so
 * it can't live here — browser callers inject it via
 * `options.classicQuantize`; headless callers get 'enhanced', 'bitreduce',
 * and 'none', which is what recipes use.
 */

import {
    getPaletteProfile,
    parseSpriteSize,
    DEFAULT_PROFILE,
} from "./palettes.js";
import {
    downscaleMode,
    downscaleAverage,
    downscaleKCentroid,
    quantizeOklab,
    quantizeOklabBayer,
    quantizeBitReduce,
    generateOutlines,
    cleanupOrphans,
} from "./quantize.js";
import { preprocessRaster } from "./preprocess.js";
import { cropRaster, autoCropSubject } from "./raster.js";

/**
 * Processing pipeline modes.
 */
export const PIPELINE_MODES = [
    { value: "enhanced", label: "Enhanced (OKLAB + edge-preserving)" },
    { value: "classic", label: "Classic (RgbQuant sRGB)" },
];

/**
 * Downscale strategy options — independent of pipeline mode. 'mode' and
 * 'average' are each pipeline's traditional default; 'k-centroid' is the
 * opt-in noise-robust strategy (docs/RETRO-DIFFUSION.md).
 */
export const DOWNSCALE_OPTIONS = [
    { value: "mode", label: "Mode (edge-preserving)" },
    { value: "average", label: "Average (smooth)" },
    { value: "k-centroid", label: "K-Centroid (noise-robust)" },
];

/**
 * Available dithering options per pipeline mode.
 */
export const DITHER_OPTIONS = {
    enhanced: [
        { value: "", label: "None" },
        { value: "bayer", label: "Bayer 4×4 (pixel art style)" },
    ],
    classic: [
        { value: "", label: "None" },
        { value: "FloydSteinberg", label: "Floyd-Steinberg" },
        { value: "Atkinson", label: "Atkinson" },
        { value: "Stucki", label: "Stucki" },
        { value: "Sierra", label: "Sierra" },
        { value: "SierraLite", label: "Sierra Lite" },
    ],
};

/**
 * Resolve the palette profile + sprite dimensions for a processing call.
 * Accepts any SPRITE_SCALES key or custom "WxH" string; falls back to the
 * profile's suggested defaultScale.
 *
 * @param {string} profileId - PALETTE_PROFILES key (legacy name: consoleId)
 * @param {string} [spriteSize] - Scale key / "WxH"
 */
export function resolveProfileAndSize(profileId, spriteSize) {
    const profile = getPaletteProfile(profileId || DEFAULT_PROFILE);
    const { w, h } = parseSpriteSize(spriteSize || profile.defaultScale);
    return { profile, spriteW: w, spriteH: h };
}

/**
 * Downscale + quantize + post-process one source raster into one pixel-art
 * unit (a standalone sprite, a sheet frame, or a tile).
 *
 * @param {{ data, width, height }} sourceRaster - Full-resolution source
 *   (ImageData works too)
 * @param {object} options
 * @param {string} options.consoleId - Palette profile id
 * @param {string} [options.spriteSize] - Scale key or "WxH"
 * @param {string|null} [options.dithering]
 * @param {string} [options.pipeline] - 'enhanced' | 'classic'
 * @param {string} [options.downscale] - 'mode' | 'average' | 'k-centroid';
 *   defaults to the pipeline's traditional strategy ('mode' for enhanced,
 *   'average' for classic) when unset — set explicitly to override
 * @param {boolean} [options.outlines]
 * @param {boolean} [options.cleanup]
 * @param {boolean} [options.autoCrop] - Crop to the subject's bounding box
 *   before downscaling, so a small-in-frame subject uses the full pixel
 *   budget. Single sprites only — per-frame cropping would misalign sheets.
 * @param {object|null} [options.preprocessing] - PREPROCESSING_PRESETS entry
 * @param {function} [options.classicQuantize] - Browser-injected RgbQuant
 *   quantizer `(raster, { dithering, palette }) => raster`; required for
 *   pipeline 'classic' on palette profiles
 * @returns {{ pixelData: { data, width, height }, spriteW: number, spriteH: number }}
 */
export function processSourceRaster(sourceRaster, options = {}) {
    const {
        consoleId = DEFAULT_PROFILE,
        spriteSize,
        dithering = null,
        pipeline = "enhanced",
        downscale,
        outlines = true,
        cleanup = true,
        autoCrop = false,
        preprocessing = null,
        classicQuantize = null,
    } = options;

    const { profile, spriteW, spriteH } = resolveProfileAndSize(
        consoleId,
        spriteSize,
    );

    let source = sourceRaster;
    if (preprocessing && preprocessing.enabled !== false) {
        source = preprocessRaster(source, preprocessing);
    }
    if (autoCrop) {
        source = autoCropSubject(source, { targetAspect: spriteW / spriteH });
    }

    // Step 1: Downscale. An explicit `downscale` overrides the pipeline's
    // traditional default, so existing recipes/callers that never set it
    // produce byte-identical output.
    const downscaleStrategy = downscale || (pipeline === "enhanced" ? "mode" : "average");
    const downscaled =
        downscaleStrategy === "k-centroid"
            ? downscaleKCentroid(source, spriteW, spriteH)
            : downscaleStrategy === "average"
              ? downscaleAverage(source, spriteW, spriteH)
              : downscaleMode(source, spriteW, spriteH);

    // Step 2: Quantize to the palette profile
    let pixelData;
    if (profile.quantizeMode === "none") {
        pixelData = downscaled;
    } else if (profile.quantizeMode === "bitreduce") {
        pixelData = quantizeBitReduce(downscaled);
    } else if (pipeline === "enhanced") {
        pixelData =
            dithering === "bayer"
                ? quantizeOklabBayer(downscaled, profile.palette)
                : quantizeOklab(downscaled, profile.palette);
    } else if (classicQuantize) {
        pixelData = classicQuantize(downscaled, {
            dithering,
            palette: profile.palette,
        });
    } else {
        throw new Error(
            "The 'classic' pipeline requires a browser (RgbQuant); use 'enhanced' for headless processing.",
        );
    }

    // Step 3: Post-processing (enhanced pipeline only; skipped for raw output)
    if (pipeline === "enhanced" && profile.quantizeMode !== "none") {
        if (cleanup) pixelData = cleanupOrphans(pixelData);
        if (outlines) pixelData = generateOutlines(pixelData);
    }

    return { pixelData, spriteW, spriteH };
}

/**
 * Slice a batched sheet raster (N frames in a horizontal strip) into
 * per-frame source rasters.
 *
 * @param {{ data, width, height }} batchRaster
 * @param {number} frameCount - Frames in this batch image
 * @returns {Array<{ data, width, height }>}
 */
export function sliceSheetRaster(batchRaster, frameCount) {
    const frameW = Math.floor(batchRaster.width / frameCount);
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
        frames.push(cropRaster(batchRaster, i * frameW, 0, frameW, batchRaster.height));
    }
    return frames;
}

/**
 * Slice a batched grid raster (cols × rows tiles) into per-tile source
 * rasters, row-major.
 *
 * @param {{ data, width, height }} batchRaster
 * @param {number} cols
 * @param {number} rows
 * @returns {Array<{ data, width, height }>}
 */
export function sliceGridRaster(batchRaster, cols, rows) {
    const tileW = Math.floor(batchRaster.width / cols);
    const tileH = Math.floor(batchRaster.height / rows);
    const tiles = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            tiles.push(cropRaster(batchRaster, c * tileW, r * tileH, tileW, tileH));
        }
    }
    return tiles;
}
