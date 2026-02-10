/**
 * Model Discovery Service
 *
 * Fetches available image generation models from Pollinations.ai
 * and provides a curated default list as fallback.
 *
 * API: GET https://gen.pollinations.ai/image/models
 */

/**
 * Curated default models — used as fallback when API is unreachable,
 * and as the initial set before dynamic fetch completes.
 */
export const DEFAULT_MODELS = [
  { id: 'flux',            name: 'Flux Schnell',         description: 'Fast high-quality generation', cost: 'Free-tier' },
  { id: 'zimage',          name: 'Z-Image Turbo',        description: 'Fast Flux + 2x upscaling', cost: 'Free-tier' },
  { id: 'gptimage',        name: 'GPT Image 1 Mini',     description: 'OpenAI — excellent prompt following', cost: '~$0.008/img' },
  { id: 'nanobanana',      name: 'Gemini Flash Image',   description: 'Google Gemini 2.5 Flash', cost: '~$0.039/img' },
  { id: 'nanobanana-pro',  name: 'Gemini 3 Pro Image',   description: 'Highest quality, 4K support', cost: '~$0.134/img' },
  { id: 'seedream',        name: 'Seedream 4.0',         description: 'ByteDance — good quality', cost: '~$0.03/img' },
  { id: 'klein',           name: 'FLUX.2 Klein 4B',      description: 'Fast generation & editing', cost: '~$0.008/img' },
  { id: 'kontext',         name: 'FLUX.1 Kontext',       description: 'In-context image editing', cost: '~$0.04/img' },
];

export const DEFAULT_MODEL_ID = 'flux';

const MODELS_ENDPOINT = 'https://gen.pollinations.ai/image/models';

let cachedModels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch available image models from the Pollinations API.
 * Results are cached for 5 minutes. Falls back to DEFAULT_MODELS on error.
 *
 * @returns {Promise<Array<{id: string, name: string, description: string, cost: string}>>}
 */
export async function fetchImageModels() {
  const now = Date.now();
  if (cachedModels && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedModels;
  }

  try {
    const response = await fetch(MODELS_ENDPOINT);
    if (!response.ok) throw new Error(`${response.status}`);

    const data = await response.json();

    // Filter to image-output models only, map to our simplified shape
    const models = data
      .filter(m =>
        m.output_modalities?.includes('image') &&
        !m.output_modalities?.includes('video')
      )
      .map(m => ({
        id: m.name || m.id,
        name: m.description?.split(' - ')[0] || m.name,
        description: m.description || '',
        cost: formatCost(m),
      }));

    if (models.length > 0) {
      cachedModels = models;
      lastFetchTime = now;
      return models;
    }
  } catch (err) {
    console.warn('Failed to fetch models from API, using defaults:', err.message);
  }

  return DEFAULT_MODELS;
}

function formatCost(model) {
  if (model.pricing?.per_image) {
    return `$${model.pricing.per_image}/img`;
  }
  if (model.pricing?.completion) {
    return `~$${(model.pricing.completion * 1000).toFixed(3)}/1k tokens`;
  }
  return 'Free-tier';
}
