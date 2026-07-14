/**
 * Pollinations provider adapter (Node) — the zero-config default backend.
 * The headless counterpart of the browser's Vite-proxy path: a Node process
 * *is* the trusted server side, so it reads POLLINATIONS_API_KEY from the
 * environment and calls https://gen.pollinations.ai/image directly.
 *
 * Adapter contract (shared with providers/openai.js):
 *   id, name, keyEnv, maxUnitsPerAxis, isConfigured(), generateImage(request)
 */

import { buildRequestPath, MAX_UNITS_PER_AXIS } from "../../core/prompts.js";
import { decodeImage } from "../png.js";

export const id = "pollinations";
export const name = "Pollinations";
export const keyEnv = "POLLINATIONS_API_KEY";

/** Free-form width/height up to 2048px — full batching geometry available. */
export const maxUnitsPerAxis = MAX_UNITS_PER_AXIS;

export const DEFAULT_API_BASE = "https://gen.pollinations.ai/image";

/** Works keyless on the free tier (per-IP rate limits apply). */
export function isConfigured() {
    return true;
}

/**
 * Fetch one generated image.
 *
 * @param {object} request
 * @param {string} request.prompt - Fully built (enhanced) prompt text
 * @param {string} request.modelId - Bare model id (e.g. 'flux')
 * @param {number} request.width
 * @param {number} request.height
 * @param {number} [request.seed]
 * @param {boolean} [request.transparent] - Capability-gated in core
 * @param {string} [request.negativePrompt]
 * @param {string[]} [request.referenceImages] - Reference image URLs
 *   (capability-gated in core; ignored by models with maxReferenceImages 0)
 * @param {string} [request.quality] - low|medium|high|hd (Pollinations param)
 * @param {number} [request.timeoutMs]
 * @returns {Promise<{ raster: { data, width, height }, buffer: Buffer, url: string }>}
 */
export async function generateImage(request) {
    const {
        prompt,
        modelId,
        width,
        height,
        seed,
        transparent = false,
        negativePrompt = "",
        referenceImages = [],
        quality,
        timeoutMs = Number(process.env.PIXEGEN_TIMEOUT_MS) || 120000,
    } = request;

    const apiBase = process.env.PIXEGEN_API_BASE || DEFAULT_API_BASE;
    const apiKey = process.env.POLLINATIONS_API_KEY || "";

    let path = buildRequestPath(prompt, {
        modelId,
        width,
        height,
        seed,
        transparent,
        negativePrompt,
        referenceImages,
    });
    if (quality && quality !== "auto") {
        path += `&quality=${encodeURIComponent(quality)}`;
    }

    const url = `${apiBase}/${path}`;
    const headers = {};
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const keyHint =
            response.status === 401 && !apiKey
                ? " (no POLLINATIONS_API_KEY set — Pollinations' anonymous tier is rate-limited per IP; set a key, or use a BYOK provider like openai:gpt-image-1)"
                : "";
        throw new Error(
            `Image generation failed: ${response.status} ${response.statusText}${keyHint}${body ? ` — ${body.slice(0, 300)}` : ""}`,
        );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    let raster;
    try {
        raster = decodeImage(buffer);
    } catch (err) {
        throw new Error(
            `Provider response was not a decodable image (content-type: ${response.headers.get("content-type")}): ${err.message}`,
        );
    }

    return { raster, buffer, url };
}
