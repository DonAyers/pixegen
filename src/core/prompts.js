/**
 * Prompt building and request planning (portable).
 *
 * Pure string/number functions shared by the browser image-service, the
 * Node CLI, and the MCP server: prompt enhancement, negative prompts, batch
 * size planning, and Pollinations request query construction.
 */

import { modelSupportsTransparent, getModelInfo } from "./models.js";

/**
 * Smart default negative prompt — avoids common AI generation artifacts
 * that make pixel art conversion harder.
 */
export const DEFAULT_NEGATIVE_PROMPT =
    "blurry, soft focus, photorealistic, 3d render, gradient shading, anti-aliasing, " +
    "smooth edges, detailed background, text, watermark, signature, frame, border";

/**
 * Default negative prompt for sprite sheet generation.
 * Extra terms to avoid grid lines, labels, and uneven spacing.
 */
export const SHEET_NEGATIVE_PROMPT =
    DEFAULT_NEGATIVE_PROMPT +
    ", grid lines, labels, numbers, uneven spacing, overlapping characters, " +
    "different characters, varying sizes, cropped, cut off";

/**
 * Default negative prompt for tile grid generation.
 */
export const GRID_NEGATIVE_PROMPT =
    DEFAULT_NEGATIVE_PROMPT +
    ", grid lines, labels, numbers, uneven spacing, overlapping tiles, " +
    "varying sizes, cropped, cut off, perspective, depth, shadows between tiles";

/**
 * Fixed pixel budget per unit (animation frame or tile) in a batched
 * multi-unit request. Canvas size grows with unit count instead of being
 * squeezed into a fixed-size canvas.
 */
export const UNIT_SIZE = 512;

/**
 * Real max single-request resolution most Pollinations-backed models
 * support reliably. When a batch of units would exceed this on either
 * axis, the request is split into multiple sequential grid-batch calls
 * instead of degrading per-unit resolution.
 */
export const MAX_BATCH_DIMENSION = 2048;

/** Max units (frames or tile columns) that fit in one request row/axis. */
export const MAX_UNITS_PER_AXIS = Math.floor(MAX_BATCH_DIMENSION / UNIT_SIZE);

/**
 * How many sequential batch requests a given unit count will require.
 * @param {number} unitCount - Total frames or tiles requested
 * @param {number} unitsPerBatch - Max units a single request can hold
 * @returns {number}
 */
export function estimateBatchCount(unitCount, unitsPerBatch = MAX_UNITS_PER_AXIS) {
    return Math.max(1, Math.ceil(unitCount / Math.max(1, unitsPerBatch)));
}

// ─── Structured prompt spec ─────────────────────────────────────────────────
//
// Prompts are built as an ordered set of named sections instead of one flat
// comma-joined list. Each section holds short fragments; rendering joins the
// fragments of a section with ", " and the sections with ". " so the model
// sees clear segment boundaries: what to draw and how to lay it out (format),
// the rendering constraints (style), WHO to draw (subject), the camera
// (view), what the character is doing (action), and the background contract.
//
// The Characters tab feeds a locked character description (+ optional style
// notes) into the subject/style sections so every animation of one character
// starts from an identical prompt scaffold.

const SECTION_ORDER = ["format", "style", "subject", "view", "action", "background"];

/**
 * Build the section spec for a generation prompt.
 *
 * @param {object} options
 * @param {"single"|"sheet"|"grid"} [options.kind]
 * @param {string} options.subject - The character/theme description
 * @param {string} [options.consoleName] - Palette profile display name
 * @param {string} [options.styleNotes] - Extra locked style text (e.g. a
 *   character's canonical color/proportion notes)
 * @param {string} [options.poseDesc] - Combined view+pose text (single)
 * @param {string} [options.animState] - Fallback pose text (single)
 * @param {string} [options.frameHint] - Fallback frame hint (single)
 * @param {string} [options.viewDesc] - Camera/facing text (sheet)
 * @param {string} [options.animDesc] - Animation description (sheet)
 * @param {string[]} [options.frameHints] - Per-frame pose hints (sheet)
 * @param {number} [options.frameCount] - Frames in the strip (sheet)
 * @param {number} [options.cols] - Grid columns (grid)
 * @param {number} [options.rows] - Grid rows (grid)
 * @param {string[]} [options.tileHints] - Per-tile role hints (grid)
 * @returns {Record<string, string[]>} Ordered prompt sections
 */
export function buildPromptSpec(options = {}) {
    const {
        kind = "single",
        subject = "",
        consoleName = "",
        styleNotes = "",
        poseDesc = "",
        animState = "",
        frameHint = "",
        viewDesc = "",
        animDesc = "",
        frameHints = [],
        frameCount = 4,
        cols = 4,
        rows = 4,
        tileHints = [],
    } = options;

    const era = consoleName ? `${consoleName} era aesthetic` : "";
    const spec = {
        format: [],
        style: [],
        subject: [subject],
        view: [],
        action: [],
        background: [],
    };

    if (kind === "sheet") {
        spec.format = [
            "pixel art sprite sheet",
            "game asset",
            `${frameCount} frames in a single horizontal row`,
            "evenly spaced",
            "the exact same character repeated in every frame",
        ];
        spec.style = [
            era || "retro game style",
            "flat colors",
            "clean sharp edges",
            "identical palette and style in all frames",
            styleNotes,
        ];
        spec.view = [viewDesc];
        if (animDesc) spec.action.push(`${animDesc} animation sequence`);
        if (frameHints.length > 0) {
            spec.action.push(
                `frames in order: ${frameHints
                    .map((hint, i) => `(${i + 1}) ${hint}`)
                    .join(" ")}`,
            );
        }
        spec.background = [
            "plain solid single-color background, white or light gray",
            "no scenery",
        ];
    } else if (kind === "grid") {
        // Single-tile batches (fixed-canvas providers) get a single-tile
        // prompt — "1×1 grid of tiles, evenly spaced" confuses models.
        const singleTile = cols === 1 && rows === 1;
        spec.format = singleTile
            ? [
                  "pixel art game tile",
                  "game asset",
                  "one single tile filling the canvas, seamless tileable",
              ]
            : [
                  "pixel art tileset",
                  "game asset",
                  `${cols}×${rows} grid of tiles, evenly spaced`,
              ];
        spec.style = [
            "same top-down flat lighting on every tile",
            era,
            "flat colors",
            "clean sharp edges",
            "consistent palette and style across all tiles",
            styleNotes,
        ];
        if (tileHints.length > 0) {
            spec.action.push(
                `tiles, left-to-right top-to-bottom: ${tileHints.join(", ")}`,
            );
        }
        spec.background = [
            "plain solid single-color background, white or light gray",
        ];
    } else {
        spec.format = ["pixel art sprite", "game asset"];
        spec.style = [
            era || "retro game sprite",
            "flat colors",
            "clean sharp edges",
            "iconic design",
            styleNotes,
        ];
        if (poseDesc) {
            spec.action = [poseDesc];
        } else {
            spec.action = [animState, frameHint];
        }
        spec.background = [
            "single character centered on a plain solid background",
        ];
    }

    return spec;
}

/**
 * Render a prompt spec to the final prompt string.
 * Sections are joined with ". ", fragments within a section with ", ".
 * Empty fragments/sections are dropped.
 *
 * @param {Record<string, string[]>} spec
 * @returns {string}
 */
export function renderPromptSpec(spec) {
    return SECTION_ORDER.map((key) =>
        (spec[key] || [])
            .map((f) => (f || "").trim())
            .filter(Boolean)
            .join(", "),
    )
        .filter(Boolean)
        .join(". ");
}

/**
 * Enhance a user prompt with pixel-art-specific instructions.
 * Style tokens go FIRST for best model adherence, then subject, then context.
 *
 * @param {string} userPrompt - User's text description
 * @param {object} options - See buildPromptSpec (kind is forced to "single")
 */
export function buildPrompt(userPrompt, options = {}) {
    return renderPromptSpec(
        buildPromptSpec({ ...options, kind: "single", subject: userPrompt }),
    );
}

/**
 * Build a prompt for generating an entire sprite sheet in one image.
 * The AI generates N frames arranged in a horizontal strip.
 *
 * @param {string} userPrompt - Character description
 * @param {object} options - See buildPromptSpec (kind is forced to "sheet")
 */
export function buildSheetPrompt(userPrompt, options = {}) {
    return renderPromptSpec(
        buildPromptSpec({ ...options, kind: "sheet", subject: userPrompt }),
    );
}

/**
 * Build a prompt for generating a grid of tileset tiles in one image.
 *
 * @param {string} userPrompt - Theme description
 * @param {object} options - See buildPromptSpec (kind is forced to "grid")
 */
export function buildGridPrompt(userPrompt, options = {}) {
    return renderPromptSpec(
        buildPromptSpec({ ...options, kind: "grid", subject: userPrompt }),
    );
}

/**
 * Build the path + query suffix for a Pollinations image request:
 * `{encodedPrompt}?model=...&width=...`. The caller prefixes its API base
 * (browser: the Vite proxy path; Node: https://gen.pollinations.ai/image).
 *
 * `transparent` is capability-gated here: it's only emitted for models
 * that actually honor it, so callers can pass the user's toggle through
 * unconditionally.
 *
 * @param {string} enhancedPrompt - Fully built prompt text (not yet encoded)
 * @param {object} params
 * @param {string} params.modelId - Bare model id (e.g. 'flux')
 * @param {number} params.width
 * @param {number} params.height
 * @param {number} [params.seed]
 * @param {boolean} [params.transparent]
 * @param {string} [params.negativePrompt]
 * @param {string[]} [params.referenceImages] - Reference image URLs for the
 *   `image` param (visual-cohesion conditioning, Next-Phase §6). Gated on
 *   the model's maxReferenceImages and truncated to that count.
 * @returns {string}
 */
export function buildRequestPath(enhancedPrompt, params) {
    const {
        modelId,
        width,
        height,
        seed,
        transparent = false,
        negativePrompt = "",
        referenceImages = [],
    } = params;

    let path = `${encodeURIComponent(enhancedPrompt)}?model=${encodeURIComponent(modelId)}&width=${width}&height=${height}&nologo=true&nofeed=true`;
    if (seed !== undefined) {
        path += `&seed=${seed}`;
    }
    if (transparent && modelSupportsTransparent(modelId)) {
        path += "&transparent=true";
    }
    if (negativePrompt) {
        path += `&negative_prompt=${encodeURIComponent(negativePrompt)}`;
    }
    const maxRefs = getModelInfo(modelId)?.maxReferenceImages ?? 0;
    const refs = referenceImages.filter(Boolean).slice(0, maxRefs);
    if (refs.length > 0) {
        path += `&image=${encodeURIComponent(refs.join(","))}`;
    }
    return path;
}
