/**
 * Image generation service using Pollinations.ai
 *
 * Pollinations.ai provides free, no-auth image generation.
 * We craft a prompt optimized for pixel art / sprite output,
 * then post-process the result through our NES pipeline.
 */

// Proxy through Vite dev server to avoid browser-specific blocks/CORS.
// Vite rewrites /api/generate/* → https://image.pollinations.ai/prompt/*
const POLLINATIONS_BASE = '/api/generate';

/**
 * Enhance a user prompt with pixel-art-specific instructions
 * to nudge the model toward better base images for post-processing.
 */
function buildPrompt(userPrompt) {
  return [
    userPrompt,
    'pixel art style',
    '8-bit retro game sprite',
    'NES era aesthetic',
    'simple flat colors',
    'no background',
    'centered on transparent or solid color background',
    'clean sharp edges',
    'low detail iconic design',
  ].join(', ');
}

/**
 * Generate an image from a text prompt via Pollinations.ai
 *
 * @param {string} prompt - User's text description
 * @param {object} options
 * @param {number} options.width - Image width to request (default 256)
 * @param {number} options.height - Image height to request (default 256)
 * @param {number} options.seed - Optional seed for reproducibility
 * @returns {Promise<HTMLImageElement>} - The loaded image element
 */
export async function generateImage(prompt, options = {}) {
  const {
    width = 256,
    height = 256,
    seed,
  } = options;

  const enhancedPrompt = buildPrompt(prompt);
  const encodedPrompt = encodeURIComponent(enhancedPrompt);

  let url = `${POLLINATIONS_BASE}/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;
  if (seed !== undefined) {
    url += `&seed=${seed}`;
  }

  // Fetch the image as a blob so we can handle errors properly
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image generation failed: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Don't revoke yet — the URL is needed for display and processing.
      // Store it so callers can revoke later if needed.
      img._blobUrl = objectUrl;
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load generated image'));
    };
    img.crossOrigin = 'anonymous';
    img.src = objectUrl;
  });
}
