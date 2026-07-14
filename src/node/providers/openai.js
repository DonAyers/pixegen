/**
 * OpenAI provider adapter (Node) — bring-your-own-key direct access to the
 * Images API (POST /v1/images/generations, base64 response). Added when the
 * "Pollinations only" decision was revised (docs/PROVIDERS.md §2): agentic
 * CLI/MCP callers need a backend that isn't gated on one reseller's per-IP
 * rate limits, and they typically already hold an OPENAI_API_KEY.
 *
 * Differences from Pollinations the orchestration layer must absorb:
 *   - Fixed canvas sizes only (1024×1024, 1536×1024, 1024×1536) — requested
 *     dimensions are mapped to the nearest supported size; downstream
 *     slicing/downscaling adapts to whatever comes back.
 *   - maxUnitsPerAxis = 1: no wide-strip batching geometry, so sheets and
 *     tilesets generate one frame/tile per request.
 *   - No seed parameter (validation retries simply resample).
 *   - No negative_prompt parameter — folded into the prompt text.
 */

import { decodeImage } from "../png.js";

export const id = "openai";
export const name = "OpenAI";
export const keyEnv = "OPENAI_API_KEY";

/** Fixed square-ish canvases only — batch one unit per request. */
export const maxUnitsPerAxis = 1;

// Matches the official SDK's base-URL override convention.
export const DEFAULT_API_BASE = "https://api.openai.com/v1";

export function isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Map a requested canvas to the nearest size the Images API supports.
 */
function resolveSize(width, height) {
    if (width > height) return "1536x1024";
    if (height > width) return "1024x1536";
    return "1024x1024";
}

/**
 * Fetch one generated image. Same contract as providers/pollinations.js.
 *
 * @param {object} request - { prompt, modelId, width, height, seed,
 *   transparent, negativePrompt, quality, timeoutMs }
 * @returns {Promise<{ raster: { data, width, height }, buffer: Buffer, url: string }>}
 */
export async function generateImage(request) {
    const {
        prompt,
        modelId,
        width,
        height,
        transparent = false,
        negativePrompt = "",
        quality,
        timeoutMs = Number(process.env.PIXEGEN_TIMEOUT_MS) || 120000,
    } = request;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error(
            `OpenAI provider selected but OPENAI_API_KEY is not set. Export your key, or pick a Pollinations model (see 'pixegen models').`,
        );
    }

    const apiBase = process.env.OPENAI_BASE_URL || DEFAULT_API_BASE;
    const url = `${apiBase.replace(/\/$/, "")}/images/generations`;

    const fullPrompt = negativePrompt
        ? `${prompt}. Do not include: ${negativePrompt}.`
        : prompt;

    const body = {
        model: modelId,
        prompt: fullPrompt,
        n: 1,
        size: resolveSize(width, height),
        output_format: "png",
    };
    if (transparent) {
        body.background = "transparent";
    }
    if (quality && quality !== "auto") {
        body.quality = quality === "hd" ? "high" : quality;
    }

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new Error(
            `OpenAI image generation failed: ${response.status} ${response.statusText}${errBody ? ` — ${errBody.slice(0, 300)}` : ""}`,
        );
    }

    const payload = await response.json();
    const b64 = payload?.data?.[0]?.b64_json;
    if (!b64) {
        throw new Error(
            "OpenAI response contained no image data (expected data[0].b64_json)",
        );
    }

    const buffer = Buffer.from(b64, "base64");
    let raster;
    try {
        raster = decodeImage(buffer);
    } catch (err) {
        throw new Error(
            `OpenAI returned an image that isn't decodable PNG: ${err.message}`,
        );
    }

    return { raster, buffer, url };
}
