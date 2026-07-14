/**
 * Provider adapter registry (Node).
 *
 * Every adapter implements the same contract:
 *   id, name, keyEnv          — identity + which env var holds its key
 *   maxUnitsPerAxis           — batching geometry (units per request axis)
 *   isConfigured()            — whether the adapter can be called right now
 *   generateImage(request)    — { prompt, modelId, width, height, seed,
 *                                 transparent, negativePrompt, quality }
 *                               → { raster, buffer, url }
 *
 * Adding a provider = one adapter file here + a model list entry in
 * src/core/models.js. Keep the two in sync: a provider with models but no
 * adapter (or vice versa) recreates the "selectable but silently broken"
 * bug documented in docs/PROVIDERS.md.
 */

import * as pollinations from "./pollinations.js";
import * as openai from "./openai.js";

const ADAPTERS = {
    pollinations,
    openai,
};

/**
 * Get the adapter for a provider id.
 * @throws {Error} If no adapter exists for the provider
 */
export function getProviderAdapter(providerId) {
    const adapter = ADAPTERS[providerId];
    if (!adapter) {
        throw new Error(
            `No provider adapter for "${providerId}". Available: ${Object.keys(ADAPTERS).join(", ")}`,
        );
    }
    return adapter;
}

/**
 * All adapters, for listing surfaces (CLI `models`, MCP `list_models`).
 */
export function listProviderAdapters() {
    return Object.values(ADAPTERS);
}
