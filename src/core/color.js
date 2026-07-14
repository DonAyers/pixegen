/**
 * OKLAB color space math (portable, no DOM).
 *
 * OKLAB is perceptually uniform — Euclidean distance in OKLAB corresponds to
 * perceived color difference, unlike sRGB where green/blue distances are skewed.
 */

/**
 * Convert sRGB [0-255] to linear light [0-1].
 */
export function srgbToLinear(c) {
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
export function srgbToOklab(r, g, b) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);

    const l_ = Math.cbrt(
        0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
    );
    const m_ = Math.cbrt(
        0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
    );
    const s_ = Math.cbrt(
        0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
    );

    return [
        0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    ];
}

/**
 * Squared Euclidean distance in OKLAB space (faster than sqrt).
 */
export function oklabDistSq(lab1, lab2) {
    const dL = lab1[0] - lab2[0];
    const da = lab1[1] - lab2[1];
    const db = lab1[2] - lab2[2];
    return dL * dL + da * da + db * db;
}

// ─── Palette Pre-computation ─────────────────────────────────────────────────
const _paletteOklabCache = new Map();

/**
 * Get (and cache) the OKLAB representation of an [R,G,B][] palette.
 */
export function getPaletteOklab(palette) {
    if (_paletteOklabCache.has(palette)) return _paletteOklabCache.get(palette);
    const oklabPalette = palette.map(([r, g, b]) => srgbToOklab(r, g, b));
    _paletteOklabCache.set(palette, oklabPalette);
    return oklabPalette;
}
