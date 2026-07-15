/**
 * Recipes — named, known-good bundles of palette profile + sprite scale +
 * pipeline settings + preprocessing + model default.
 *
 * Recipes are the primary interface for the CLI/MCP surfaces: an automated
 * caller names one recipe instead of getting 7+ independent knobs right
 * together (docs/Next-Phase.md §2). The individual knobs remain available
 * as overrides.
 *
 * `provisional: true` marks recipes whose settings encode sensible defaults
 * rather than judged eval-loop evidence (eval/findings.json). The 2026-07-13
 * eval pass updated nes-classic and gameboy-tiny from recorded verdicts and
 * enabled autoCrop (crop-to-subject before downscale) on sprite recipes —
 * the strongest single lever that pass found. Recipes still marked
 * provisional keep that flag until their target accumulates stable trials.
 */

export const RECIPES = {
    "nes-classic": {
        label: "NES classic",
        description:
            "NES palette, 32×32, enhanced pipeline with outlines, cleanup, and subject auto-crop — the traditional 8-bit hero sprite look. Settings follow the eval-loop ideal (4 decisive trials, 2026-07-13).",
        provisional: true,
        consoleId: "nes",
        spriteSize: "32x32",
        pipeline: "enhanced",
        dithering: null,
        outlines: true,
        cleanup: true,
        autoCrop: true,
        preprocessing: "none",
        model: "zimage",
    },
    "nes-dithered": {
        label: "NES dithered",
        description:
            "NES palette, 32×32, Bayer 4×4 ordered dithering for shading gradients within the fixed palette.",
        provisional: true,
        consoleId: "nes",
        spriteSize: "32x32",
        pipeline: "enhanced",
        dithering: "bayer",
        outlines: true,
        cleanup: true,
        autoCrop: true,
        preprocessing: "none",
        model: "zimage",
    },
    "gameboy-tiny": {
        label: "Game Boy tiny",
        description:
            "4-shade Game Boy green, 16×16 with subject auto-crop and K-Centroid downscale — minimal, instantly readable handheld sprites. At this scale the crop is what makes the sprite readable at all (eval verdict, 2026-07-13). K-Centroid downscale won 2 decisive trials over the default mode downscale (2026-07-15): mode collapses too many tiles to background at this aggressive a downscale factor, losing subject detail or (in one trial) nearly the whole silhouette; K-Centroid's per-tile clustering keeps minority-but-substantial subject-color clusters and uses more of the 4-shade palette instead.",
        provisional: true,
        consoleId: "gameboy",
        spriteSize: "16x16",
        pipeline: "enhanced",
        downscale: "k-centroid",
        dithering: null,
        outlines: true,
        cleanup: true,
        autoCrop: true,
        preprocessing: "standard",
        model: "flux",
    },
    "snes-detailed": {
        label: "SNES detailed",
        description:
            "SNES 15-bit color, 48×48 — 16-bit-era detail with per-channel bit reduction instead of a fixed palette.",
        provisional: true,
        consoleId: "snes",
        spriteSize: "48x48",
        pipeline: "enhanced",
        dithering: null,
        outlines: true,
        cleanup: true,
        autoCrop: true,
        preprocessing: "standard",
        model: "flux",
    },
    "genesis-classic": {
        label: "Genesis classic",
        description:
            "Sega Genesis 9-bit palette, 32×32 — vivid 16-bit console sprites.",
        provisional: true,
        consoleId: "genesis",
        spriteSize: "32x32",
        pipeline: "enhanced",
        dithering: null,
        outlines: true,
        cleanup: true,
        autoCrop: true,
        preprocessing: "standard",
        model: "flux",
    },
    "clean-flat-hd": {
        label: "Clean flat HD",
        description:
            "No palette constraint, 64×64, edge-preserving downscale only — modern 'HD pixel art' with the model's own colors.",
        provisional: true,
        consoleId: "none",
        spriteSize: "64x64",
        pipeline: "enhanced",
        dithering: null,
        outlines: false,
        cleanup: false,
        autoCrop: true,
        preprocessing: "none",
        model: "gptimage",
    },
    "raw-concept": {
        label: "Raw concept",
        description:
            "Raw model output at 512×512, no quantization or correction — for judging what the model itself produced (diagnostic).",
        provisional: true,
        consoleId: "none",
        spriteSize: "512x512",
        pipeline: "enhanced",
        dithering: null,
        outlines: false,
        cleanup: false,
        preprocessing: "none",
        model: "gptimage",
    },
};

/** Default recipe for CLI/MCP calls that don't name one. */
export const DEFAULT_RECIPE = "nes-classic";

/**
 * Get a recipe by name.
 * @throws {Error} If the recipe doesn't exist
 */
export function getRecipe(name) {
    const recipe = RECIPES[name];
    if (!recipe) {
        throw new Error(
            `Unknown recipe "${name}". Available: ${Object.keys(RECIPES).join(", ")}`,
        );
    }
    return recipe;
}

/**
 * Merge a recipe with per-call overrides (overrides win when defined).
 * Returns a flat settings object consumable by processSourceRaster plus
 * the model default.
 */
export function resolveRecipe(name = DEFAULT_RECIPE, overrides = {}) {
    const recipe = getRecipe(name);
    const merged = { ...recipe };
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined && value !== null) merged[key] = value;
    }
    return merged;
}
