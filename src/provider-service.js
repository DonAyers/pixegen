/**
 * Multi-Provider Service — browser adapter.
 *
 * Pollinations is the zero-config default backend (GET API through the
 * Vite proxy, key injected server-side). The OpenAI BYOK lane (added
 * 2026-07-14, consistent with docs/PROVIDERS.md §2's revision) goes
 * through a dev-server POST endpoint (/api/openai/generate) that calls
 * the OpenAI Images API with the server-side OPENAI_API_KEY — the
 * original guardrail holds: no provider appears selectable without a
 * key-safe server-side route, and unavailable providers' models render
 * disabled (with the reason) rather than silently failing.
 *
 * The model lists (with paidOnly / supportsTransparent / supportsSeed
 * capability flags) live in src/core/models.js, shared with CLI/MCP.
 */

import {
    POLLINATIONS_MODELS,
    OPENAI_MODELS,
    parseModelId,
    modelSupportsTransparent,
    modelIsPaidOnly,
} from "./core/models.js";

export { parseModelId, modelSupportsTransparent, modelIsPaidOnly };

/**
 * Provider configuration for supported API services.
 */
const PROVIDER_CONFIGS = {
    pollinations: {
        name: "Pollinations",
        envKey: "POLLINATIONS_API_KEY",
        apiBase: "/api/pollinations",
        models: POLLINATIONS_MODELS,
    },
    openai: {
        name: "OpenAI (BYOK)",
        envKey: "OPENAI_API_KEY",
        apiBase: "/api/openai",
        models: OPENAI_MODELS,
    },
};

/**
 * Check which providers are available based on environment variables.
 * This will be populated by the server-side Vite config.
 */
let availableProviders = [];

/**
 * Initialize providers based on what's configured server-side.
 * The Vite config injects this data during build.
 */
export function initializeProviders(providerList) {
    availableProviders = providerList || ["pollinations"];
}

/**
 * Get list of all available providers.
 */
export function getAvailableProviders() {
    return availableProviders;
}

/**
 * Get all models from all known providers, flagged with availability.
 * Unavailable providers' models are included so pickers can render them
 * disabled with the reason (discoverability beats hiding), but they are
 * never selectable.
 *
 * @returns {Array<{id: string, name: string, description: string, cost: string, paidOnly: boolean, supportsTransparent: boolean, supportsSeed: boolean, provider: string, providerName: string, fullId: string, available: boolean}>}
 */
export function getAllModels() {
    const models = [];

    for (const [providerId, config] of Object.entries(PROVIDER_CONFIGS)) {
        const available = availableProviders.includes(providerId);
        for (const model of config.models) {
            models.push({
                ...model,
                provider: providerId,
                providerName: config.name,
                // Prefix model ID with provider for uniqueness
                fullId: `${providerId}:${model.id}`,
                available,
            });
        }
    }

    return models;
}

/**
 * Get the API base URL for a given provider.
 *
 * @param {string} providerId
 * @returns {string}
 */
export function getProviderApiBase(providerId) {
    const config = PROVIDER_CONFIGS[providerId];
    return config ? config.apiBase : "/api/pollinations";
}

/**
 * Get the default model ID (first available model).
 *
 * @returns {string}
 */
export function getDefaultModelId() {
    const available = getAllModels().filter((m) => m.available);
    return available.length > 0 ? available[0].fullId : "pollinations:flux";
}
