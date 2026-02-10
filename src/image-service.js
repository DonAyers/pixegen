/**
 * Image generation service using Pollinations.ai
 *
 * Uses gen.pollinations.ai (the current API) via a Vite dev-server proxy.
 * The proxy injects the API key server-side so it's never exposed in the browser.
 * Supports multiple AI models, transparent backgrounds, and negative prompts.
 */

// Proxy through Vite dev server which rewrites & adds auth:
// /api/generate/* → https://gen.pollinations.ai/image/*
const POLLINATIONS_BASE = '/api/generate';

/**
 * Enhance a user prompt with pixel-art-specific instructions
 * to nudge the model toward better base images for post-processing.
 *
 * @param {string} userPrompt - User's text description
 * @param {object} options
 * @param {string} options.consoleName - Display name of target console (e.g. 'NES', 'SNES')
 * @param {string} options.poseDesc - Optional pose/view description
 */
function buildPrompt(userPrompt, options = {}) {
  const { consoleName = '', poseDesc = '', animState = '', frameHint = '' } = options;
  const parts = [userPrompt];

  // Pose / view / animation context comes first for best adherence
  if (poseDesc) {
    parts.push(poseDesc);
  } else {
    if (animState) parts.push(animState);
    if (frameHint) parts.push(frameHint);
  }

  parts.push('pixel art style');
  parts.push('single character sprite');
  if (consoleName) {
    parts.push(`${consoleName} era aesthetic`);
  } else {
    parts.push('retro game sprite');
  }
  parts.push('simple flat colors');
  parts.push('clean sharp edges');
  parts.push('low detail iconic design');

  return parts.join(', ');
}

/**
 * Generate an image from a text prompt via Pollinations.ai
 *
 * @param {string} prompt - User's text description
 * @param {object} options
 * @param {string}  options.model - AI model to use (default: 'flux')
 * @param {number}  options.width - Image width to request (default 256)
 * @param {number}  options.height - Image height to request (default 256)
 * @param {number}  options.seed - Optional seed for reproducibility
 * @param {boolean} options.transparent - Request transparent background
 * @param {string}  options.negativePrompt - Things to avoid in generation
 * @param {string}  options.consoleName - Console name for prompt enhancement
 * @param {string}  options.poseDesc - Pose/view for prompt enhancement
 * @returns {Promise<HTMLImageElement>} - The loaded image element
 */
export async function generateImage(prompt, options = {}) {
  const {
    model = 'flux',
    width = 256,
    height = 256,
    seed,
    transparent = false,
    negativePrompt = '',
    consoleName = '',
    poseDesc = '',
  } = options;

  const enhancedPrompt = buildPrompt(prompt, { consoleName, poseDesc });
  const encodedPrompt = encodeURIComponent(enhancedPrompt);

  let url = `${POLLINATIONS_BASE}/${encodedPrompt}?model=${encodeURIComponent(model)}&width=${width}&height=${height}&nologo=true&nofeed=true`;
  if (seed !== undefined) {
    url += `&seed=${seed}`;
  }
  if (transparent) {
    url += '&transparent=true';
  }
  if (negativePrompt) {
    url += `&negative_prompt=${encodeURIComponent(negativePrompt)}`;
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
