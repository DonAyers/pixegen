/**
 * Model Discovery Service
 *
 * Discovers available image generation models from multiple providers
 * (Pollinations, Gemini, OpenAI, etc.) based on configured API keys.
 */

import { initializeProviders, getAllModels, getDefaultModelId } from './provider-service.js';

/**
 * Default model ID — first available model from provider service
 */
export let DEFAULT_MODEL_ID = 'pollinations:flux';

/**
 * Curated default models — used as fallback when API is unreachable.
 * Now managed by provider-service.js
 */
export let DEFAULT_MODELS = [];

/**
 * Initialize the model service with available providers.
 * Should be called at app startup.
 */
export function initModels() {
  // Get providers from Vite build-time injection
  const providers = typeof __AVAILABLE_PROVIDERS__ !== 'undefined' 
    ? __AVAILABLE_PROVIDERS__ 
    : ['pollinations'];
  
  initializeProviders(providers);
  DEFAULT_MODELS = getAllModels();
  DEFAULT_MODEL_ID = getDefaultModelId();
}

/**
 * Fetch available image models from all configured providers.
 * 
 * @returns {Promise<Array<{id: string, name: string, description: string, cost: string, provider: string, providerName: string}>>}
 */
export async function fetchImageModels() {
  // For now, return the statically configured models
  // In the future, this could dynamically fetch from provider APIs
  return DEFAULT_MODELS;
}
