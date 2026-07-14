/**
 * Provider + model registry (portable).
 *
 * Two providers today:
 *   - pollinations — the zero-config default (free tier, optional key);
 *     re-sells several vendors' image models through one GET API.
 *   - openai — bring-your-own-key direct vendor access (OPENAI_API_KEY),
 *     added 2026-07-12 when the original "Pollinations only" decision was
 *     revised (docs/PROVIDERS.md §2) — the agentic CLI/MCP surface needs a
 *     fallback that isn't gated on one reseller's rate limits.
 *
 * Capability flags drive behavior elsewhere:
 *   - paidOnly: needs a funded key; fails on the free/anonymous tier.
 *   - supportsTransparent: the transparent-background request parameter is
 *     honored (silently dropped for other models).
 *   - supportsSeed: seed is passed to the API (OpenAI's Images API has no
 *     seed parameter — retries just resample).
 *
 * This module stays env-free so the browser can import it; "is this
 * provider's key configured" checks live in the Node adapters
 * (src/node/providers/).
 */

/**
 * Pollinations image models offered by the app — the *static fallback*
 * layer of the catalog. The live GET /image/models endpoint is the source
 * of truth (fetched + cached by src/node/live-models.js, merged by
 * core/model-registry.js); this list keeps everything working offline.
 * Last verified against the live endpoint on 2026-07-13 — gpt-image-2 and
 * nova-canvas went free since the 07-12 pass. `maxReferenceImages` is the
 * live `max_reference_images` (0 = the `image` reference param is ignored).
 */
export const POLLINATIONS_MODELS = [
    {
        id: "flux",
        name: "Flux Schnell",
        description: "Fast high-quality generation",
        cost: "Free-tier",
        paidOnly: false,
        supportsTransparent: false,
        supportsSeed: true,
        maxReferenceImages: 0,
    },
    {
        id: "zimage",
        name: "Z-Image Turbo",
        description: "Fast Flux + 2x upscaling",
        cost: "Free-tier",
        paidOnly: false,
        supportsTransparent: false,
        supportsSeed: true,
        maxReferenceImages: 0,
    },
    {
        id: "gptimage",
        name: "GPT Image 1 Mini",
        description: "OpenAI — excellent prompt following",
        cost: "Free-tier",
        paidOnly: false,
        supportsTransparent: true,
        supportsSeed: true,
        maxReferenceImages: 16,
    },
    {
        id: "gptimage-large",
        name: "GPT Image 1.5",
        description: "OpenAI — larger sibling of GPT Image 1 Mini",
        cost: "Free-tier",
        paidOnly: false,
        supportsTransparent: true,
        supportsSeed: true,
        maxReferenceImages: 16,
    },
    {
        id: "gpt-image-2",
        name: "GPT Image 2",
        description: "OpenAI — newest GPT Image tier",
        cost: "Free-tier",
        paidOnly: false,
        supportsTransparent: true,
        supportsSeed: true,
        maxReferenceImages: 16,
    },
    {
        id: "klein",
        name: "FLUX.2 Klein 4B",
        description: "Fast generation & editing",
        cost: "Free-tier",
        paidOnly: false,
        supportsTransparent: false,
        supportsSeed: true,
        maxReferenceImages: 10,
    },
    {
        id: "kontext",
        name: "FLUX.1 Kontext",
        description: "In-context image editing",
        cost: "Free-tier",
        paidOnly: false,
        supportsTransparent: false,
        supportsSeed: true,
        maxReferenceImages: 1,
    },
    {
        id: "nova-canvas",
        name: "Amazon Nova Canvas",
        description: "Amazon — general-purpose image generation",
        cost: "Free-tier",
        paidOnly: false,
        supportsTransparent: false,
        supportsSeed: true,
        maxReferenceImages: 1,
    },
    {
        id: "nanobanana",
        name: "Gemini Flash Image",
        description: "Google Gemini 2.5 Flash",
        cost: "Paid",
        paidOnly: true,
        supportsTransparent: false,
        supportsSeed: true,
        maxReferenceImages: 3,
    },
    {
        id: "nanobanana-pro",
        name: "Gemini 3 Pro Image",
        description: "Highest quality, 4K support",
        cost: "Paid",
        paidOnly: true,
        supportsTransparent: false,
        supportsSeed: true,
        maxReferenceImages: 14,
    },
    {
        id: "seedream",
        name: "Seedream 4.0",
        description: "ByteDance — good quality",
        cost: "Paid",
        paidOnly: true,
        supportsTransparent: false,
        supportsSeed: true,
        maxReferenceImages: 10,
    },
];

/**
 * OpenAI Images API models (bring your own OPENAI_API_KEY).
 * Node-only today: the browser has no proxy route for POST-based providers,
 * so these never appear in the web UI's picker (see provider-service.js).
 */
export const OPENAI_MODELS = [
    {
        id: "gpt-image-1",
        name: "GPT Image 1",
        description:
            "OpenAI direct — best prompt following, native transparent backgrounds",
        cost: "BYOK (OpenAI billing)",
        paidOnly: true,
        supportsTransparent: true,
        supportsSeed: false,
    },
    {
        id: "gpt-image-1-mini",
        name: "GPT Image 1 Mini",
        description: "OpenAI direct — cheaper/faster GPT Image tier",
        cost: "BYOK (OpenAI billing)",
        paidOnly: true,
        supportsTransparent: true,
        supportsSeed: false,
    },
];

/**
 * Provider registry. `keyEnv` names the environment variable the Node
 * adapters read; `keyOptional` means the provider works without it.
 */
export const PROVIDERS = {
    pollinations: {
        name: "Pollinations",
        keyEnv: "POLLINATIONS_API_KEY",
        keyOptional: true,
        models: POLLINATIONS_MODELS,
    },
    openai: {
        name: "OpenAI",
        keyEnv: "OPENAI_API_KEY",
        keyOptional: false,
        models: OPENAI_MODELS,
    },
};

/** Default bare model id (on the default provider). */
export const DEFAULT_BARE_MODEL_ID = "flux";

/**
 * Parse a full model ID into provider and model parts.
 * @param {string} fullId - Format: "provider:modelId" (bare ids fall back
 *   to the pollinations provider for backward compatibility)
 * @returns {{provider: string, modelId: string}}
 */
export function parseModelId(fullId) {
    const parts = String(fullId).split(":");
    if (parts.length === 2 && PROVIDERS[parts[0]]) {
        return { provider: parts[0], modelId: parts[1] };
    }
    return { provider: "pollinations", modelId: fullId };
}

/**
 * Resolve a bare or "provider:model" id to its provider + model entry.
 * Bare ids check pollinations first (backward compat), then fall back to a
 * unique match across all providers (so `--model gpt-image-1` works).
 *
 * @returns {{ provider: string, modelId: string, info: object|null }}
 */
export function resolveModel(id) {
    const { provider, modelId } = parseModelId(id);

    const direct = PROVIDERS[provider]?.models.find((m) => m.id === modelId);
    if (direct) return { provider, modelId, info: direct };

    // Bare id not on the default provider — accept a unique cross-provider match.
    const matches = [];
    for (const [pid, cfg] of Object.entries(PROVIDERS)) {
        const m = cfg.models.find((entry) => entry.id === modelId);
        if (m) matches.push({ provider: pid, modelId, info: m });
    }
    if (matches.length === 1) return matches[0];

    return { provider, modelId, info: null };
}

/**
 * Look up a model entry by bare or "provider:model" id.
 */
export function getModelInfo(id) {
    return resolveModel(id).info;
}

/**
 * Whether the given model honors the transparent-background parameter.
 * Unknown models default to false so we never send a silent no-op.
 */
export function modelSupportsTransparent(id) {
    const info = getModelInfo(id);
    return Boolean(info && info.supportsTransparent);
}

/**
 * Whether the given model requires a funded API key.
 * Unknown models default to false (assume free until proven otherwise).
 */
export function modelIsPaidOnly(id) {
    const info = getModelInfo(id);
    return Boolean(info && info.paidOnly);
}
