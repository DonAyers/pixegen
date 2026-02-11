/**
 * Multi-Provider Service
 * 
 * Manages multiple image generation API providers (Pollinations, Gemini, etc.)
 * Discovers available providers based on environment variables and provides
 * a unified interface for model selection and image generation.
 */

/**
 * Provider configuration for supported API services.
 * Each provider defines its available models and how to route requests.
 */
const PROVIDER_CONFIGS = {
  pollinations: {
    name: 'Pollinations',
    envKey: 'POLLINATIONS_API_KEY',
    apiBase: '/api/pollinations',
    models: [
      { id: 'flux', name: 'Flux Schnell', description: 'Fast high-quality generation', cost: 'Free-tier' },
      { id: 'zimage', name: 'Z-Image Turbo', description: 'Fast Flux + 2x upscaling', cost: 'Free-tier' },
      { id: 'gptimage', name: 'GPT Image 1 Mini', description: 'OpenAI — excellent prompt following', cost: '~$0.008/img' },
      { id: 'nanobanana', name: 'Gemini Flash Image', description: 'Google Gemini 2.5 Flash', cost: '~$0.039/img' },
      { id: 'nanobanana-pro', name: 'Gemini 3 Pro Image', description: 'Highest quality, 4K support', cost: '~$0.134/img' },
      { id: 'seedream', name: 'Seedream 4.0', description: 'ByteDance — good quality', cost: '~$0.03/img' },
      { id: 'klein', name: 'FLUX.2 Klein 4B', description: 'Fast generation & editing', cost: '~$0.008/img' },
      { id: 'kontext', name: 'FLUX.1 Kontext', description: 'In-context image editing', cost: '~$0.04/img' },
    ],
  },
  gemini: {
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    apiBase: '/api/gemini',
    models: [
      { id: 'gemini-flash-image', name: 'Gemini 2.5 Flash', description: 'Fast image generation', cost: '~$0.039/img' },
      { id: 'gemini-pro-image', name: 'Gemini 3 Pro', description: 'High quality image generation', cost: '~$0.134/img' },
    ],
  },
  openai: {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    apiBase: '/api/openai',
    models: [
      { id: 'dall-e-3', name: 'DALL-E 3', description: 'High quality image generation', cost: '~$0.04/img' },
      { id: 'dall-e-2', name: 'DALL-E 2', description: 'Fast image generation', cost: '~$0.02/img' },
    ],
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
  availableProviders = providerList || ['pollinations'];
}

/**
 * Get list of all available providers.
 */
export function getAvailableProviders() {
  return availableProviders;
}

/**
 * Get all models from all available providers.
 * Returns a flat list with provider information embedded.
 * 
 * @returns {Array<{id: string, name: string, description: string, cost: string, provider: string, providerName: string}>}
 */
export function getAllModels() {
  const models = [];
  
  for (const providerId of availableProviders) {
    const config = PROVIDER_CONFIGS[providerId];
    if (!config) continue;
    
    for (const model of config.models) {
      models.push({
        ...model,
        provider: providerId,
        providerName: config.name,
        // Prefix model ID with provider for uniqueness
        fullId: `${providerId}:${model.id}`,
      });
    }
  }
  
  return models;
}

/**
 * Parse a full model ID into provider and model parts.
 * 
 * @param {string} fullId - Format: "provider:modelId"
 * @returns {{provider: string, modelId: string}}
 */
export function parseModelId(fullId) {
  const parts = fullId.split(':');
  if (parts.length === 2) {
    return { provider: parts[0], modelId: parts[1] };
  }
  // Fallback to pollinations for backward compatibility
  return { provider: 'pollinations', modelId: fullId };
}

/**
 * Get the API base URL for a given provider.
 * 
 * @param {string} providerId
 * @returns {string}
 */
export function getProviderApiBase(providerId) {
  const config = PROVIDER_CONFIGS[providerId];
  return config ? config.apiBase : '/api/pollinations';
}

/**
 * Get the default model ID (first available model).
 * 
 * @returns {string}
 */
export function getDefaultModelId() {
  const models = getAllModels();
  return models.length > 0 ? models[0].fullId : 'pollinations:flux';
}

/**
 * Fetch available providers from the server.
 * This endpoint is added by the Vite proxy to expose which providers are configured.
 * 
 * @returns {Promise<string[]>}
 */
export async function fetchAvailableProviders() {
  try {
    const response = await fetch('/api/providers');
    if (!response.ok) {
      console.warn('Failed to fetch providers, using default');
      return ['pollinations'];
    }
    const data = await response.json();
    return data.providers || ['pollinations'];
  } catch (err) {
    console.warn('Error fetching providers:', err);
    return ['pollinations'];
  }
}
