/**
 * Image Preprocessing — browser adapter.
 *
 * The filter math (median denoise, unsharp mask, contrast, saturation,
 * histogram stabilization) lives in src/core/preprocess.js and operates on
 * plain rasters so the Node CLI/MCP can share it. This module keeps the
 * legacy browser API (HTMLImageElement in → HTMLImageElement out) for any
 * caller that still wants it; the main pipeline now applies
 * `preprocessRaster` directly on decoded pixel data instead.
 */

import { PREPROCESSING_PRESETS, preprocessRaster } from "./core/preprocess.js";

export { PREPROCESSING_PRESETS, preprocessRaster };

/**
 * Apply preprocessing to an HTMLImageElement and get a new one back.
 *
 * @deprecated Prefer preprocessRaster on decoded pixel data — this wrapper
 * round-trips through a PNG blob just to return an HTMLImageElement.
 * @param {HTMLImageElement} img - Source image
 * @param {object} options - A PREPROCESSING_PRESETS entry or custom values
 * @returns {Promise<HTMLImageElement>}
 */
export async function preprocessImage(img, options = {}) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);

    const processed = preprocessRaster(imageData, options);
    if (processed === imageData) {
        return img; // No-op (disabled or nothing requested)
    }

    ctx.putImageData(
        new ImageData(processed.data, processed.width, processed.height),
        0,
        0,
    );
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
        const result = new Image();
        result.onload = () => {
            URL.revokeObjectURL(url);
            resolve(result);
        };
        result.onerror = reject;
        result.src = url;
    });
}
