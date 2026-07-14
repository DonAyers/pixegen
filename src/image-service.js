/**
 * Image generation service — browser adapter. Routes all requests through
 * Pollinations via the Vite dev-server proxy (which injects the API key
 * server-side so it's never exposed in the browser).
 *
 * Prompt building, batch planning, and request-query construction live in
 * src/core/prompts.js, shared with the Node CLI/MCP surfaces (which call
 * https://gen.pollinations.ai/image directly instead of the proxy). This
 * module owns the browser-only parts: fetching through the proxy and
 * decoding responses into HTMLImageElements.
 *
 * The `transparent` parameter is capability-gated in the core: it's only
 * sent for models that honor it (see core/models.js).
 */

import { parseModelId, getProviderApiBase } from "./provider-service.js";
import { getSettings } from "./settings.js";
import {
    buildPrompt,
    buildSheetPrompt,
    buildGridPrompt,
    buildRequestPath,
    DEFAULT_NEGATIVE_PROMPT,
    SHEET_NEGATIVE_PROMPT,
    GRID_NEGATIVE_PROMPT,
    UNIT_SIZE,
    MAX_BATCH_DIMENSION,
    MAX_UNITS_PER_AXIS,
    estimateBatchCount,
} from "./core/prompts.js";

export {
    DEFAULT_NEGATIVE_PROMPT,
    SHEET_NEGATIVE_PROMPT,
    GRID_NEGATIVE_PROMPT,
    UNIT_SIZE,
    MAX_BATCH_DIMENSION,
    MAX_UNITS_PER_AXIS,
    estimateBatchCount,
};

/**
 * Last request debug info — updated on every generate call, including the
 * outcome (status, timing, and structured error detail on failure). The
 * Inspector tab reads this; it's the browser-side counterpart of the Node
 * surfaces' JSONL run logs (src/node/run-log.js — the dev server writes
 * its half of every proxied request to logs/pixegen-<date>.jsonl).
 */
export const lastRequest = {
    prompt: "",
    negativePrompt: "",
    url: "",
    width: 0,
    height: 0,
    model: "",
    provider: "",
    type: "", // 'single', 'sheet', or 'grid'
    startedAt: "",
    // Outcome fields, filled in when the fetch settles:
    status: 0,
    contentType: "",
    durationMs: 0,
    error: null, // { message, code, upstreamBody } on failure
};

function recordRequest(fields) {
    Object.assign(lastRequest, fields, {
        startedAt: new Date().toISOString(),
        status: 0,
        contentType: "",
        durationMs: 0,
        error: null,
    });
    console.log("[PixelGen] Provider:", fields.provider);
    console.log("[PixelGen] Model:", fields.model);
    console.log("[PixelGen] Prompt:", fields.prompt);
    console.log("[PixelGen] URL:", fields.url);
}

/**
 * Marker query param telling the dev proxy to NOT attach the server-side
 * API key (ride the anonymous free tier). The proxy strips it before
 * forwarding — Pollinations never sees it.
 */
export const FREE_TIER_PARAM = "pixegen_free=1";

/**
 * The upstream base the dev proxy forwards `/api/pollinations` to. Used to
 * reconstruct the public URL of a generation so it can be stored as a
 * reference image (`image=` conditioning) for later character-consistent
 * generations — the same mechanism as the Node path's cohesion chain.
 */
export const UPSTREAM_IMAGE_BASE = "https://gen.pollinations.ai/image";

function applyTier(url) {
    return getSettings().freeTier ? `${url}&${FREE_TIER_PARAM}` : url;
}

/**
 * Pull a human-readable message out of an error response body. Handles the
 * Pollinations error shape ({ success: false, error: { message, code } })
 * and the dev proxy's 502 shape (same envelope, code "proxy_error");
 * falls back to the raw text.
 */
function parseErrorBody(text) {
    try {
        const parsed = JSON.parse(text);
        const err = parsed.error || parsed;
        return {
            message: err.message || text.slice(0, 300),
            code: err.code || "",
            debugLog: err.debugLog || "",
        };
    } catch {
        return { message: text.slice(0, 300), code: "", debugLog: "" };
    }
}

/**
 * Fetch a generated image and resolve it as a loaded HTMLImageElement,
 * carrying the raw blob for storage/inspection. Failures throw an Error
 * whose message includes the HTTP status and the upstream/provider reason
 * (not just "Failed to fetch"), and the full detail lands in `lastRequest`
 * for the Inspector.
 * When the free-tier setting is on, the request is sent keyless first and
 * retried once with the key on 401/402/429 ("free when available").
 *
 * @param {string} url - Fully built provider request URL
 * @param {string} errorLabel - Used in the thrown error message on failure
 * @param {function} [onStage] - Stage callback: ("generating"|"decoding", detail?)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - Abort after this long; the thrown
 *   error carries `isTimeout: true` (used by the failover chain)
 * @param {object} [opts.init] - fetch() init (POST paths, e.g. OpenAI)
 * @param {boolean} [opts.tierParam=true] - Apply the free-tier marker
 *   (Pollinations GET requests only)
 */
async function fetchGeneratedImage(url, errorLabel = "Image generation", onStage, opts = {}) {
    const { timeoutMs = 0, init, tierParam = true } = opts;
    const startedAt = Date.now();
    let effectiveUrl = tierParam ? applyTier(url) : url;
    lastRequest.url = effectiveUrl;
    onStage?.("generating");
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    let response;
    try {
        response = await fetch(effectiveUrl, { ...init, signal });
        if (
            [401, 402, 429].includes(response.status) &&
            effectiveUrl.includes(FREE_TIER_PARAM)
        ) {
            console.warn(
                `[PixelGen] Free tier unavailable (HTTP ${response.status}) — retrying with the API key`,
            );
            onStage?.("generating", "free tier unavailable — retrying with key");
            effectiveUrl = url;
            lastRequest.url = effectiveUrl;
            response = await fetch(effectiveUrl, { ...init, signal });
        }
    } catch (networkErr) {
        if (networkErr.name === "TimeoutError" || networkErr.name === "AbortError") {
            const timeoutErr = new Error(
                `${errorLabel} exceeded ${Math.round(timeoutMs / 1000)}s`,
            );
            timeoutErr.isTimeout = true;
            lastRequest.durationMs = Date.now() - startedAt;
            throw timeoutErr;
        }
        const detail = {
            message:
                "No response from the dev-server proxy (connection dropped). " +
                "Check the dev server's terminal and logs/pixegen-<date>.jsonl for the upstream failure.",
            code: "network_error",
            cause: networkErr.message,
        };
        lastRequest.durationMs = Date.now() - startedAt;
        lastRequest.error = detail;
        console.error(`[PixelGen] ${errorLabel} failed:`, detail);
        throw new Error(`${errorLabel} failed: ${detail.message}`);
    }

    lastRequest.status = response.status;
    lastRequest.contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const detail = parseErrorBody(bodyText);
        lastRequest.durationMs = Date.now() - startedAt;
        lastRequest.error = { ...detail, upstreamBody: bodyText.slice(0, 2048) };
        console.error(`[PixelGen] ${errorLabel} failed:`, {
            status: response.status,
            ...lastRequest.error,
            url: effectiveUrl,
        });
        throw new Error(
            `${errorLabel} failed: HTTP ${response.status}${detail.code ? ` (${detail.code})` : ""} — ${detail.message}`,
        );
    }

    onStage?.("decoding");
    const blob = await response.blob();
    lastRequest.durationMs = Date.now() - startedAt;
    const objectUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            img._blobUrl = objectUrl;
            img._sourceBlob = blob;
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            lastRequest.error = {
                message: `Response was not a decodable image (content-type: ${lastRequest.contentType})`,
                code: "decode_error",
            };
            reject(new Error(`Failed to load generated image (${errorLabel})`));
        };
        img.crossOrigin = "anonymous";
        img.src = objectUrl;
    });
}

/**
 * Fast free Pollinations models, in failover order. When the failover
 * setting is on and a request exceeds the threshold, it's aborted and
 * retried on the next model in this chain (latency beats model choice
 * when the provider queue is jammed). The last candidate runs without a
 * timeout so a fully-congested day still eventually completes.
 */
export const FAILOVER_CHAIN = ["flux", "klein", "zimage"];

/**
 * Fetch a Pollinations generation with optional slow-request failover.
 *
 * @param {object} params
 * @param {string} params.apiBase - Provider proxy base
 * @param {string} params.modelId - The user's chosen bare model id
 * @param {function} params.buildPath - (modelId) => request path; rebuilt
 *   per candidate so capability gating (transparent etc.) stays correct
 * @param {string} params.errorLabel
 * @param {function} [params.onStage]
 * @returns {Promise<HTMLImageElement>} with `_modelUsed` set to the model
 *   that actually produced the image
 */
async function fetchWithFailover({ apiBase, modelId, buildPath, errorLabel, onStage }) {
    const { failoverEnabled, failoverSeconds } = getSettings();
    const chain = failoverEnabled
        ? [modelId, ...FAILOVER_CHAIN.filter((m) => m !== modelId)]
        : [modelId];

    for (let i = 0; i < chain.length; i++) {
        const candidate = chain[i];
        const isLast = i === chain.length - 1;
        lastRequest.model = `pollinations:${candidate}`;
        try {
            const img = await fetchGeneratedImage(
                `${apiBase}/${buildPath(candidate)}`,
                errorLabel,
                onStage,
                { timeoutMs: isLast ? 0 : failoverSeconds * 1000 },
            );
            img._modelUsed = `pollinations:${candidate}`;
            // Public equivalent of the proxied request — usable as an
            // `image=` reference for future generations.
            img._upstreamUrl = `${UPSTREAM_IMAGE_BASE}/${buildPath(candidate)}`;
            return img;
        } catch (err) {
            if (err.isTimeout && !isLast) {
                console.warn(
                    `[PixelGen] ${candidate} exceeded ${failoverSeconds}s — failing over to ${chain[i + 1]}`,
                );
                onStage?.(
                    "generating",
                    `${candidate} too slow (>${failoverSeconds}s) — failover to ${chain[i + 1]}`,
                );
                continue;
            }
            throw err;
        }
    }
}

/**
 * Generate an image from a text prompt via Pollinations.ai
 *
 * @param {string} prompt - User's text description
 * @param {object} options
 * @param {string}  options.model - AI model to use (default: 'pollinations:flux')
 * @param {number}  options.width - Image width to request (default 512)
 * @param {number}  options.height - Image height to request (default 512)
 * @param {number}  options.seed - Optional seed for reproducibility
 * @param {boolean} options.transparent - Request transparent background
 *   (only sent when the selected model supports it)
 * @param {string}  options.negativePrompt - Things to avoid in generation
 * @param {string}  options.consoleName - Profile name for prompt enhancement
 * @param {string}  options.poseDesc - Pose/view for prompt enhancement
 * @param {function} [options.onStage] - Run-tracker stage callback
 * @returns {Promise<HTMLImageElement>} - The loaded image element
 */
export async function generateImage(prompt, options = {}) {
    const {
        model = "pollinations:flux",
        width = 512,
        height = 512,
        seed,
        transparent = false,
        negativePrompt = "",
        consoleName = "",
        poseDesc = "",
        styleNotes = "",
        referenceImages = [],
        onStage,
    } = options;

    const enhancedPrompt = buildPrompt(prompt, {
        consoleName,
        poseDesc,
        styleNotes,
    });

    const { provider, modelId } = parseModelId(model);
    const apiBase = getProviderApiBase(provider);

    // OpenAI BYOK lane: POST JSON to the dev-server endpoint, which calls
    // the OpenAI Images API server-side with OPENAI_API_KEY. No seed
    // support, no free-tier marker, no failover (predictable latency is
    // the point of this lane).
    if (provider === "openai") {
        const url = `${apiBase}/generate`;
        recordRequest({
            prompt: enhancedPrompt,
            negativePrompt,
            url,
            width,
            height,
            model,
            provider,
            type: "single",
        });
        return fetchGeneratedImage(url, "Image generation", onStage, {
            tierParam: false,
            init: {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    prompt: enhancedPrompt,
                    model: modelId,
                    width,
                    height,
                    transparent,
                    negativePrompt,
                }),
            },
        });
    }

    const buildPath = (mid) =>
        buildRequestPath(enhancedPrompt, {
            modelId: mid,
            width,
            height,
            seed,
            transparent,
            negativePrompt,
            referenceImages,
        });

    recordRequest({
        prompt: enhancedPrompt,
        negativePrompt,
        url: `${apiBase}/${buildPath(modelId)}`,
        width,
        height,
        model,
        provider,
        type: "single",
    });

    return fetchWithFailover({
        apiBase,
        modelId,
        buildPath,
        errorLabel: "Image generation",
        onStage,
    });
}

/**
 * Generate a complete sprite sheet (all animation frames) as one or more AI
 * requests, arranged as a horizontal strip. Each frame gets a fixed
 * `UNIT_SIZE` pixel budget regardless of frameCount — the canvas grows with
 * frame count (up to `MAX_BATCH_DIMENSION`) instead of squeezing existing
 * frames into a shrinking fixed-size canvas. Counts that don't fit in one
 * request are split into multiple sequential batch calls.
 *
 * @param {string} prompt - Character description
 * @param {object} options
 * @param {string}  options.model - AI model
 * @param {number}  options.frameCount - Number of frames (default 4)
 * @param {number}  options.seed - Optional seed
 * @param {boolean} options.transparent - Transparent background
 * @param {string}  options.negativePrompt - Override negative prompt
 * @param {string}  options.consoleName - Profile name for style
 * @param {string}  options.viewDesc - View/facing description
 * @param {string}  options.animDesc - Animation name/description
 * @param {string[]} options.frameHints - Per-frame pose descriptions
 * @returns {Promise<{ batches: Array<{ img: HTMLImageElement, frameCount: number, frameOffset: number }>, frameCount: number, frameSize: number }>}
 */
export async function generateSpriteSheet(prompt, options = {}) {
    const {
        model = "pollinations:flux",
        frameCount = 4,
        seed,
        transparent = false,
        negativePrompt = "",
        consoleName = "",
        viewDesc = "",
        animDesc = "",
        frameHints = [],
        styleNotes = "",
        referenceImages = [],
        onStage,
    } = options;

    const { provider, modelId } = parseModelId(model);
    if (provider === "openai") {
        throw new Error(
            "OpenAI models support single sprites in the browser (fixed canvas sizes — no strip batching). Use a Pollinations model here, or the CLI (pixegen sheet --model openai:...) which batches per frame.",
        );
    }
    const apiBase = getProviderApiBase(provider);
    const effectiveNegative = negativePrompt || SHEET_NEGATIVE_PROMPT;

    const batchFrameCount = Math.max(
        1,
        Math.min(frameCount, MAX_UNITS_PER_AXIS),
    );
    const height = UNIT_SIZE;

    const batchDefs = [];
    for (
        let startFrame = 0;
        startFrame < frameCount;
        startFrame += batchFrameCount
    ) {
        batchDefs.push({
            startFrame,
            thisFrameCount: Math.min(batchFrameCount, frameCount - startFrame),
        });
    }

    const runBatch = async ({ startFrame, thisFrameCount }) => {
        const width = thisFrameCount * UNIT_SIZE;
        const enhancedPrompt = buildSheetPrompt(prompt, {
            consoleName,
            viewDesc,
            animDesc,
            frameHints: frameHints.slice(
                startFrame,
                startFrame + thisFrameCount,
            ),
            frameCount: thisFrameCount,
            styleNotes,
        });

        const batchSeed = seed !== undefined ? seed + startFrame : undefined;
        const buildPath = (mid) =>
            buildRequestPath(enhancedPrompt, {
                modelId: mid,
                width,
                height,
                seed: batchSeed,
                transparent,
                negativePrompt: effectiveNegative,
                referenceImages,
            });

        // Debug info reflects the most recent batch request
        recordRequest({
            prompt: enhancedPrompt,
            negativePrompt: effectiveNegative,
            url: `${apiBase}/${buildPath(modelId)}`,
            width,
            height,
            model,
            provider,
            type: "sheet",
        });

        const batchLabel = `frames ${startFrame + 1}-${startFrame + thisFrameCount}/${frameCount}`;
        const img = await fetchWithFailover({
            apiBase,
            modelId,
            buildPath,
            errorLabel: "Sprite sheet generation",
            onStage: (stage, detail) => onStage?.(stage, detail || batchLabel),
        });
        img._frameCount = thisFrameCount;
        return { img, frameCount: thisFrameCount, frameOffset: startFrame };
    };

    // Parallel when the setting allows: batches have no data dependency in
    // the browser path, and concurrent requests queue independently at the
    // provider (big wall-clock win under congestion).
    let batches;
    if (getSettings().parallelBatches && batchDefs.length > 1) {
        batches = await Promise.all(batchDefs.map(runBatch));
    } else {
        batches = [];
        for (const def of batchDefs) {
            batches.push(await runBatch(def));
        }
    }

    return { batches, frameCount, frameSize: UNIT_SIZE };
}

/**
 * Generate a complete tile grid (cols × rows tiles) as one or more AI
 * requests. Generalizes `generateSpriteSheet`'s 1×N batching to a full
 * M×N grid: each tile gets a fixed `UNIT_SIZE` pixel budget, and the grid
 * is split into row/column blocks whenever it would exceed
 * `MAX_BATCH_DIMENSION` on either axis, rather than shrinking tiles.
 *
 * @param {string} prompt - Tileset theme/style description
 * @param {object} options
 * @param {string}  options.model - AI model
 * @param {number}  options.cols - Grid columns (default 4)
 * @param {number}  options.rows - Grid rows (default 4)
 * @param {string[]} options.tileHints - Per-tile prompt hints, row-major (length cols*rows)
 * @param {number}  options.seed - Optional seed
 * @param {boolean} options.transparent - Transparent background
 * @param {string}  options.negativePrompt - Override negative prompt
 * @param {string}  options.consoleName - Profile name for style
 * @returns {Promise<{ batches: Array<{ img: HTMLImageElement, cols: number, rows: number, startCol: number, startRow: number }>, cols: number, rows: number, tileSize: number }>}
 */
export async function generateTileGrid(prompt, options = {}) {
    const {
        model = "pollinations:flux",
        cols = 4,
        rows = 4,
        tileHints = [],
        seed,
        transparent = false,
        negativePrompt = "",
        consoleName = "",
        onStage,
    } = options;

    const { provider, modelId } = parseModelId(model);
    if (provider === "openai") {
        throw new Error(
            "OpenAI models support single sprites in the browser (fixed canvas sizes — no grid batching). Use a Pollinations model here, or the CLI (pixegen tileset --model openai:...) which batches per tile.",
        );
    }
    const apiBase = getProviderApiBase(provider);
    const effectiveNegative = negativePrompt || GRID_NEGATIVE_PROMPT;

    // Block size: as many columns as fit per row, then as many rows as fit
    // alongside that many columns, so each batch request stays within
    // MAX_BATCH_DIMENSION on both axes.
    const batchCols = Math.max(1, Math.min(cols, MAX_UNITS_PER_AXIS));
    const batchRows = Math.max(
        1,
        Math.min(rows, Math.floor(MAX_UNITS_PER_AXIS / batchCols)),
    );

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

        const width = thisCols * UNIT_SIZE;
        const height = thisRows * UNIT_SIZE;

        const enhancedPrompt = buildGridPrompt(prompt, {
            consoleName,
            cols: thisCols,
            rows: thisRows,
            tileHints: hintsForBatch,
        });

        const batchSeed =
            seed !== undefined ? seed + startRow * cols + startCol : undefined;
        const buildPath = (mid) =>
            buildRequestPath(enhancedPrompt, {
                modelId: mid,
                width,
                height,
                seed: batchSeed,
                transparent,
                negativePrompt: effectiveNegative,
            });

        recordRequest({
            prompt: enhancedPrompt,
            negativePrompt: effectiveNegative,
            url: `${apiBase}/${buildPath(modelId)}`,
            width,
            height,
            model,
            provider,
            type: "grid",
        });

        const blockLabel = `tile block ${startCol},${startRow} (${thisCols}×${thisRows})`;
        const img = await fetchWithFailover({
            apiBase,
            modelId,
            buildPath,
            errorLabel: "Tile grid generation",
            onStage: (stage, detail) => onStage?.(stage, detail || blockLabel),
        });
        return { img, cols: thisCols, rows: thisRows, startCol, startRow };
    };

    // Parallel when the setting allows — see generateSpriteSheet.
    let batches;
    if (getSettings().parallelBatches && batchDefs.length > 1) {
        batches = await Promise.all(batchDefs.map(runBatch));
    } else {
        batches = [];
        for (const def of batchDefs) {
            batches.push(await runBatch(def));
        }
    }

    return { batches, cols, rows, tileSize: UNIT_SIZE };
}
