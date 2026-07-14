/**
 * Headless generation orchestration — the Node counterpart of App.jsx's
 * generate flows, shared by the CLI (bin/pixegen.js) and the MCP server
 * (bin/pixegen-mcp.js).
 *
 * Each entry point: resolves a recipe (+ overrides), builds the prompt,
 * fetches from Pollinations, runs the portable pipeline, then runs the
 * deterministic validation gate — retrying once with a bumped seed on
 * failure before surfacing issues to the caller (docs/Next-Phase.md §4).
 */

import { resolveRecipe } from "../core/recipes.js";
import { getPaletteProfile } from "../core/palettes.js";
import { PREPROCESSING_PRESETS } from "../core/preprocess.js";
import { preprocessRaster } from "../core/preprocess.js";
import {
    buildPrompt,
    buildSheetPrompt,
    buildGridPrompt,
    DEFAULT_NEGATIVE_PROMPT,
    SHEET_NEGATIVE_PROMPT,
    GRID_NEGATIVE_PROMPT,
    UNIT_SIZE,
} from "../core/prompts.js";
import {
    processSourceRaster,
    sliceSheetRaster,
    sliceGridRaster,
    resolveProfileAndSize,
} from "../core/pipeline.js";
import { validateFrame, validateFrameSet } from "../core/validate.js";
import {
    modelSupportsTransparent,
    resolveModel,
    getModelInfo,
} from "../core/models.js";
import { parseAutoModel, resolveAutoModel } from "../core/model-registry.js";
import { createRaster, blitRaster } from "../core/raster.js";
import { getProviderAdapter } from "./providers/index.js";
import { getPollinationsCatalog } from "./live-models.js";
import { NULL_RUN_LOG, errorDetail } from "./run-log.js";

/** Seed bump between validation-retry attempts. */
const RETRY_SEED_OFFSET = 1000;

function resolveSettings(options) {
    const {
        recipe,
        model,
        consoleId,
        spriteSize,
        dithering,
        outlines,
        cleanup,
        autoCrop,
        preprocessing,
        quality,
    } = options;

    const settings = resolveRecipe(recipe, {
        model,
        consoleId,
        spriteSize,
        dithering,
        outlines,
        cleanup,
        autoCrop,
        preprocessing,
        quality,
    });

    // "auto"/"auto:draft|standard|best" resolves intent to a concrete model
    // via the merged live+curated catalog (Next-Phase §7). A tier also
    // implies a quality param when the caller didn't set one.
    const autoTier = parseAutoModel(settings.model);
    if (autoTier) {
        const { models } = getPollinationsCatalog();
        const resolved = resolveAutoModel(autoTier, models, {
            hasPaidKey: Boolean(process.env.POLLINATIONS_API_KEY),
        });
        settings.model = `pollinations:${resolved.modelId}`;
        if (!settings.quality || settings.quality === "auto") {
            settings.quality = resolved.quality;
        }
    }

    const { provider, modelId } = resolveModel(settings.model);
    const adapter = getProviderAdapter(provider);
    const profile = getPaletteProfile(settings.consoleId);
    const runLog = options.runLog || NULL_RUN_LOG;
    const preprocessingOptions =
        typeof settings.preprocessing === "string"
            ? PREPROCESSING_PRESETS[settings.preprocessing] ||
              PREPROCESSING_PRESETS.none
            : settings.preprocessing || PREPROCESSING_PRESETS.none;

    return { settings, modelId, adapter, profile, preprocessingOptions, runLog };
}

/**
 * Run one provider request with structured logging around it: parameters
 * on the way in, status/timing on the way out, error detail on failure
 * (then rethrows — logging never swallows).
 */
async function loggedGenerateImage(adapter, runLog, request, context) {
    const startedAt = Date.now();
    runLog.event("request", {
        ...context,
        provider: adapter.id,
        model: request.modelId,
        width: request.width,
        height: request.height,
        seed: request.seed,
        transparent: request.transparent,
        quality: request.quality,
        referenceImages: request.referenceImages?.length || 0,
    });
    try {
        const result = await adapter.generateImage(request);
        runLog.event("response", {
            ...context,
            durationMs: Date.now() - startedAt,
            bytes: result.buffer?.length,
            url: result.url,
        });
        return result;
    } catch (err) {
        runLog.event("error", {
            ...context,
            durationMs: Date.now() - startedAt,
            error: errorDetail(err),
        });
        throw err;
    }
}

function pipelineOptions(settings, preprocessingOptions) {
    return {
        consoleId: settings.consoleId,
        spriteSize: settings.spriteSize,
        dithering: settings.dithering,
        pipeline: settings.pipeline || "enhanced",
        outlines: settings.outlines,
        cleanup: settings.cleanup,
        autoCrop: settings.autoCrop,
        preprocessing: preprocessingOptions,
    };
}

/**
 * Generate a single sprite.
 *
 * @param {string} prompt - Subject description
 * @param {object} options
 * @param {string} [options.recipe] - Recipe name (default DEFAULT_RECIPE)
 * @param {string} [options.model] - Model override (bare or provider:model)
 * @param {string} [options.consoleId] - Palette profile override
 * @param {string} [options.spriteSize] - Scale key / "WxH" override
 * @param {string|null} [options.dithering]
 * @param {boolean} [options.outlines]
 * @param {boolean} [options.cleanup]
 * @param {string|object} [options.preprocessing] - Preset name or options
 * @param {number} [options.seed]
 * @param {boolean} [options.transparent=true] - Request transparent bg
 *   (only sent when the model supports it)
 * @param {string} [options.negativePrompt]
 * @param {string[]} [options.referenceImages] - Reference image URLs for
 *   visual-cohesion conditioning (capability-gated per model)
 * @param {string} [options.poseDesc] - Pose/view prompt fragment
 * @param {boolean} [options.validate=true] - Run the validation gate
 * @param {function} [options.log] - stderr-style progress logger
 * @returns {Promise<{ pixelData, spriteW, spriteH, sourceRaster, sourceBuffer, url, seedUsed, attempts, issues: string[] }>}
 */
export async function generateSprite(prompt, options = {}) {
    const {
        seed,
        transparent = true,
        negativePrompt = DEFAULT_NEGATIVE_PROMPT,
        referenceImages = [],
        poseDesc = "",
        validate = true,
        log = () => {},
    } = options;

    const { settings, modelId, adapter, profile, preprocessingOptions, runLog } =
        resolveSettings(options);

    const enhancedPrompt = buildPrompt(prompt, {
        consoleName: profile.quantizeMode === "none" ? "" : profile.name,
        poseDesc,
    });

    const transparentRequested =
        transparent && modelSupportsTransparent(`${adapter.id}:${modelId}`);
    const baseSeed = seed !== undefined ? seed : Math.floor(Math.random() * 1e6);
    const maxAttempts = validate ? 2 : 1;

    let last = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const seedUsed = baseSeed + attempt * RETRY_SEED_OFFSET;

        log(
            `generating sprite (model=${adapter.id}:${modelId}, seed=${seedUsed}, attempt ${attempt + 1}/${maxAttempts})`,
        );
        const { raster, buffer, url } = await loggedGenerateImage(
            adapter,
            runLog,
            {
                prompt: enhancedPrompt,
                modelId,
                width: UNIT_SIZE,
                height: UNIT_SIZE,
                seed: seedUsed,
                transparent,
                negativePrompt,
                referenceImages,
                quality: settings.quality,
            },
            { kind: "sprite", attempt: attempt + 1 },
        );

        const { pixelData, spriteW, spriteH } = processSourceRaster(
            raster,
            pipelineOptions(settings, preprocessingOptions),
        );

        const { ok, issues } = validate
            ? validateFrame(pixelData, { profile, transparentRequested })
            : { ok: true, issues: [] };

        last = {
            pixelData,
            spriteW,
            spriteH,
            sourceRaster: raster,
            sourceBuffer: buffer,
            url,
            seedUsed,
            attempts: attempt + 1,
            issues,
        };
        if (ok) return last;
        log(`validation failed: ${issues.join("; ")}`);
        runLog.event("validation", { kind: "sprite", attempt: attempt + 1, issues });
    }

    return last;
}

/**
 * Generate all frames of an animation as batched horizontal-strip requests
 * (same batching as the browser's Generate All Frames).
 *
 * @param {string} prompt - Character description
 * @param {object} options - generateSprite options plus:
 * @param {number} [options.frameCount=4]
 * @param {string} [options.viewDesc] - Facing/camera prompt fragment
 * @param {string} [options.animDesc] - Animation description
 * @param {string[]} [options.frameHints] - Per-frame pose hints
 * @returns {Promise<{ frames: Array<{ pixelData, spriteW, spriteH }>, sourceBuffers: Buffer[], seedUsed, attempts, issues: string[] }>}
 */
export async function generateSheet(prompt, options = {}) {
    const {
        frameCount = 4,
        viewDesc = "",
        animDesc = "",
        frameHints = [],
        seed,
        transparent = true,
        negativePrompt = SHEET_NEGATIVE_PROMPT,
        referenceImages = [],
        validate = true,
        log = () => {},
    } = options;

    const { settings, modelId, adapter, profile, preprocessingOptions, runLog } =
        resolveSettings(options);

    const transparentRequested =
        transparent && modelSupportsTransparent(`${adapter.id}:${modelId}`);
    const baseSeed = seed !== undefined ? seed : Math.floor(Math.random() * 1e6);
    const maxAttempts = validate ? 2 : 1;
    // Batch geometry is a provider property: Pollinations takes wide strips,
    // fixed-canvas providers (OpenAI) generate one frame per request.
    const batchFrameCount = Math.max(
        1,
        Math.min(frameCount, adapter.maxUnitsPerAxis),
    );

    // Batches can run concurrently when the cross-batch cohesion chain
    // isn't in play (model accepts no reference images) — each request
    // queues independently at the provider. `parallelBatches: false`
    // (CLI --no-parallel) forces the old sequential behavior.
    const canParallel =
        options.parallelBatches !== false &&
        (getModelInfo(`${adapter.id}:${modelId}`)?.maxReferenceImages ?? 0) === 0;

    let last = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const attemptSeed = baseSeed + attempt * RETRY_SEED_OFFSET;
        const frames = new Array(frameCount).fill(null);
        const sourceBuffers = [];
        // Cross-batch cohesion (Next-Phase §6): the first batch's request
        // URL doubles as an image URL, fed to later batches as a reference
        // so multi-request sheets keep one character design. No-op for
        // models with maxReferenceImages 0 (gated in buildRequestPath).
        let cohesionRef = null;

        const batchDefs = [];
        for (
            let startFrame = 0;
            startFrame < frameCount;
            startFrame += batchFrameCount
        ) {
            batchDefs.push({
                startFrame,
                thisFrameCount: Math.min(
                    batchFrameCount,
                    frameCount - startFrame,
                ),
            });
        }

        const runBatch = async ({ startFrame, thisFrameCount }) => {
            const consoleName =
                profile.quantizeMode === "none" ? "" : profile.name;
            // Single-frame batches get a single-sprite prompt — "1 frames in
            // a horizontal row" confuses models and wastes tokens.
            const enhancedPrompt =
                thisFrameCount === 1
                    ? buildPrompt(prompt, {
                          consoleName,
                          poseDesc: [viewDesc, frameHints[startFrame] || animDesc]
                              .filter(Boolean)
                              .join(", "),
                      })
                    : buildSheetPrompt(prompt, {
                          consoleName,
                          viewDesc,
                          animDesc,
                          frameHints: frameHints.slice(
                              startFrame,
                              startFrame + thisFrameCount,
                          ),
                          frameCount: thisFrameCount,
                      });

            log(
                `generating frames ${startFrame + 1}-${startFrame + thisFrameCount}/${frameCount} (model=${adapter.id}:${modelId}, attempt ${attempt + 1}/${maxAttempts})`,
            );
            const { raster, buffer, url } = await loggedGenerateImage(
                adapter,
                runLog,
                {
                    prompt: enhancedPrompt,
                    modelId,
                    width: thisFrameCount * UNIT_SIZE,
                    height: UNIT_SIZE,
                    seed: attemptSeed + startFrame,
                    transparent,
                    negativePrompt,
                    referenceImages: cohesionRef
                        ? [...referenceImages, cohesionRef]
                        : referenceImages,
                    quality: settings.quality,
                },
                { kind: "sheet", attempt: attempt + 1, startFrame },
            );
            sourceBuffers.push(buffer);
            if (!cohesionRef && url) cohesionRef = url;

            // Preprocess batch-wide so histogram passes normalize across frames
            let batchRaster = raster;
            if (preprocessingOptions && preprocessingOptions.enabled !== false) {
                batchRaster = preprocessRaster(batchRaster, preprocessingOptions);
            }

            const frameRasters = sliceSheetRaster(batchRaster, thisFrameCount);
            frameRasters.forEach((frameRaster, i) => {
                frames[startFrame + i] = processSourceRaster(frameRaster, {
                    ...pipelineOptions(settings, preprocessingOptions),
                    preprocessing: null, // applied batch-wide above
                    autoCrop: false, // per-frame crops would misalign the set
                });
            });
        };

        if (canParallel && batchDefs.length > 1) {
            await Promise.all(batchDefs.map(runBatch));
        } else {
            for (const def of batchDefs) {
                await runBatch(def);
            }
        }

        const { ok, issues } = validate
            ? validateFrameSet(
                  frames.map((f) => f.pixelData),
                  { profile, transparentRequested },
              )
            : { ok: true, issues: [] };

        last = {
            frames,
            sourceBuffers,
            seedUsed: attemptSeed,
            attempts: attempt + 1,
            issues,
        };
        if (ok) return last;
        log(`validation failed: ${issues.join("; ")}`);
        runLog.event("validation", { kind: "sheet", attempt: attempt + 1, issues });
    }

    return last;
}

/**
 * Generate a cols × rows tile grid as batched requests.
 *
 * @param {string} prompt - Tileset theme description
 * @param {object} options - generateSprite options plus:
 * @param {number} [options.cols=4]
 * @param {number} [options.rows=4]
 * @param {string[]} [options.tileHints] - Per-tile role hints, row-major
 * @returns {Promise<{ tiles: Array<{ pixelData, spriteW, spriteH, gridX, gridY }>, cols, rows, sourceBuffers: Buffer[], seedUsed, attempts, issues: string[] }>}
 */
export async function generateTileset(prompt, options = {}) {
    const {
        cols = 4,
        rows = 4,
        tileHints = [],
        seed,
        transparent = false,
        negativePrompt = GRID_NEGATIVE_PROMPT,
        referenceImages = [],
        validate = true,
        log = () => {},
    } = options;

    const { settings, modelId, adapter, profile, preprocessingOptions, runLog } =
        resolveSettings(options);

    const transparentRequested =
        transparent && modelSupportsTransparent(`${adapter.id}:${modelId}`);
    const baseSeed = seed !== undefined ? seed : Math.floor(Math.random() * 1e6);
    const maxAttempts = validate ? 2 : 1;

    const batchCols = Math.max(1, Math.min(cols, adapter.maxUnitsPerAxis));
    const batchRows = Math.max(
        1,
        Math.min(rows, Math.floor(adapter.maxUnitsPerAxis / batchCols)),
    );

    // See generateSheet — parallel only when cohesion refs don't apply.
    const canParallel =
        options.parallelBatches !== false &&
        (getModelInfo(`${adapter.id}:${modelId}`)?.maxReferenceImages ?? 0) === 0;

    let last = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const attemptSeed = baseSeed + attempt * RETRY_SEED_OFFSET;
        const tiles = new Array(cols * rows).fill(null);
        const sourceBuffers = [];
        // Cross-batch cohesion — see generateSheet.
        let cohesionRef = null;

        const batchDefs = [];
        for (let startRow = 0; startRow < rows; startRow += batchRows) {
            const thisRows = Math.min(batchRows, rows - startRow);
            for (let startCol = 0; startCol < cols; startCol += batchCols) {
                const thisCols = Math.min(batchCols, cols - startCol);
                batchDefs.push({ startRow, startCol, thisRows, thisCols });
            }
        }

        const runBatch = async ({ startRow, startCol, thisRows, thisCols }) => {
            const hintsForBatch = [];
            for (let r = 0; r < thisRows; r++) {
                for (let c = 0; c < thisCols; c++) {
                    const idx = (startRow + r) * cols + (startCol + c);
                    if (tileHints[idx]) hintsForBatch.push(tileHints[idx]);
                }
            }

            const enhancedPrompt = buildGridPrompt(prompt, {
                consoleName:
                    profile.quantizeMode === "none" ? "" : profile.name,
                cols: thisCols,
                rows: thisRows,
                tileHints: hintsForBatch,
            });

            log(
                `generating tile block ${startCol},${startRow} (${thisCols}×${thisRows}, model=${adapter.id}:${modelId}, attempt ${attempt + 1}/${maxAttempts})`,
            );
            const { raster, buffer, url } = await loggedGenerateImage(
                adapter,
                runLog,
                {
                    prompt: enhancedPrompt,
                    modelId,
                    width: thisCols * UNIT_SIZE,
                    height: thisRows * UNIT_SIZE,
                    seed: attemptSeed + startRow * cols + startCol,
                    transparent,
                    negativePrompt,
                    referenceImages: cohesionRef
                        ? [...referenceImages, cohesionRef]
                        : referenceImages,
                    quality: settings.quality,
                },
                {
                    kind: "tileset",
                    attempt: attempt + 1,
                    block: `${startCol},${startRow}`,
                },
            );
            sourceBuffers.push(buffer);
            if (!cohesionRef && url) cohesionRef = url;

            let batchRaster = raster;
            if (
                preprocessingOptions &&
                preprocessingOptions.enabled !== false
            ) {
                batchRaster = preprocessRaster(
                    batchRaster,
                    preprocessingOptions,
                );
            }

            const tileRasters = sliceGridRaster(
                batchRaster,
                thisCols,
                thisRows,
            );
            tileRasters.forEach((tileRaster, idx) => {
                const r = Math.floor(idx / thisCols);
                const c = idx % thisCols;
                const gridX = startCol + c;
                const gridY = startRow + r;
                const processed = processSourceRaster(tileRaster, {
                    ...pipelineOptions(settings, preprocessingOptions),
                    preprocessing: null, // applied batch-wide above
                    autoCrop: false, // tiles must keep their full extent
                });
                tiles[gridY * cols + gridX] = { ...processed, gridX, gridY };
            });
        };

        if (canParallel && batchDefs.length > 1) {
            await Promise.all(batchDefs.map(runBatch));
        } else {
            for (const def of batchDefs) {
                await runBatch(def);
            }
        }

        const { ok, issues } = validate
            ? validateFrameSet(
                  tiles.map((t) => t.pixelData),
                  // Tiles are different subjects by design — skip the
                  // cross-frame consistency check by not passing
                  // transparentRequested to the set-level checks.
                  { profile, transparentRequested: false },
              )
            : { ok: true, issues: [] };

        last = {
            tiles,
            cols,
            rows,
            sourceBuffers,
            seedUsed: attemptSeed,
            attempts: attempt + 1,
            issues,
        };
        if (ok) return last;
        log(`validation failed: ${issues.join("; ")}`);
        runLog.event("validation", {
            kind: "tileset",
            attempt: attempt + 1,
            issues,
        });
    }

    return last;
}

/**
 * Assemble processed frames/tiles into one raster: frames side by side
 * (sheets) or a cols × rows grid (tilesets).
 *
 * @param {Array<{ pixelData, spriteW, spriteH }>} units
 * @param {number} cols - Units per row
 * @returns {{ data, width, height }}
 */
export function assembleGridRaster(units, cols) {
    const rows = Math.ceil(units.length / cols);
    const { spriteW, spriteH } = units[0];
    const sheet = createRaster(cols * spriteW, rows * spriteH);
    units.forEach((unit, i) => {
        blitRaster(
            sheet,
            unit.pixelData,
            (i % cols) * spriteW,
            Math.floor(i / cols) * spriteH,
        );
    });
    return sheet;
}

export { resolveProfileAndSize };
