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
 * Last request debug info — updated on every generate call.
 * Consumers can read this to display prompt/URL details.
 */
export const lastRequest = {
  prompt: '',
  negativePrompt: '',
  url: '',
  width: 0,
  height: 0,
  model: '',
  type: '',  // 'single' or 'sheet'
};

/**
 * Smart default negative prompt — avoids common AI generation artifacts
 * that make pixel art conversion harder.
 */
export const DEFAULT_NEGATIVE_PROMPT =
  'blurry, soft focus, photorealistic, 3d render, gradient shading, anti-aliasing, ' +
  'smooth edges, detailed background, text, watermark, signature, frame, border';

/**
 * Enhance a user prompt with pixel-art-specific instructions.
 * Style tokens go FIRST for best model adherence, then subject, then context.
 *
 * @param {string} userPrompt - User's text description
 * @param {object} options
 * @param {string} options.consoleName - Display name of target console
 * @param {string} options.poseDesc - Optional pose/view description
 */
function buildPrompt(userPrompt, options = {}) {
  const { consoleName = '', poseDesc = '', animState = '', frameHint = '' } = options;
  const parts = [];

  // Style tokens FIRST — models give most weight to early tokens
  parts.push('pixel art sprite');
  parts.push('game asset');
  if (consoleName) {
    parts.push(`${consoleName} era aesthetic`);
  } else {
    parts.push('retro game sprite');
  }
  parts.push('flat colors');
  parts.push('clean sharp edges');
  parts.push('iconic design');

  // Subject
  parts.push(userPrompt);

  // Pose / view context
  if (poseDesc) {
    parts.push(poseDesc);
  } else {
    if (animState) parts.push(animState);
    if (frameHint) parts.push(frameHint);
  }

  parts.push('single character centered on solid background');

  return parts.join(', ');
}

/**
 * Build a prompt for generating an entire sprite sheet in one image.
 * The AI generates N frames arranged in a horizontal strip.
 *
 * @param {string} userPrompt - User's character description
 * @param {object} options
 * @param {string} options.consoleName - Target console name
 * @param {string} options.viewDesc - View/facing prompt fragment
 * @param {string} options.animDesc - Animation description
 * @param {string[]} options.frameHints - Per-frame pose descriptions
 * @param {number} options.frameCount - Number of frames to generate
 * @returns {string} Complete prompt for sprite sheet generation
 */
function buildSheetPrompt(userPrompt, options = {}) {
  const {
    consoleName = '',
    viewDesc = '',
    animDesc = '',
    frameHints = [],
    frameCount = 4,
  } = options;

  const parts = [];

  // Style context first
  parts.push('pixel art sprite sheet');
  parts.push('game asset');
  parts.push(`${frameCount} frames in a horizontal row`);
  parts.push('evenly spaced');
  parts.push('same character in each frame');
  if (consoleName) {
    parts.push(`${consoleName} era aesthetic`);
  }
  parts.push('flat colors');
  parts.push('clean sharp edges');
  parts.push('consistent style across all frames');

  // Character description
  parts.push(userPrompt);

  // View
  if (viewDesc) parts.push(viewDesc);

  // Animation context
  if (animDesc) parts.push(`${animDesc} animation sequence`);

  // Frame descriptions
  if (frameHints.length > 0) {
    parts.push(`sequence: ${frameHints.join(', then ')}`);
  }

  parts.push('solid single-color background');
  parts.push('white or light gray background');

  return parts.join(', ');
}

/**
 * Generate an image from a text prompt via Pollinations.ai
 *
 * @param {string} prompt - User's text description
 * @param {object} options
 * @param {string}  options.model - AI model to use (default: 'flux')
 * @param {number}  options.width - Image width to request (default 512)
 * @param {number}  options.height - Image height to request (default 512)
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
    width = 512,
    height = 512,
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

  // Store debug info
  lastRequest.prompt = enhancedPrompt;
  lastRequest.negativePrompt = negativePrompt;
  lastRequest.url = url;
  lastRequest.width = width;
  lastRequest.height = height;
  lastRequest.model = model;
  lastRequest.type = 'single';
  console.log('[PixelGen] Prompt:', enhancedPrompt);
  console.log('[PixelGen] URL:', url);

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

/**
 * Default negative prompt for sprite sheet generation.
 * Extra terms to avoid grid lines, labels, and uneven spacing.
 */
export const SHEET_NEGATIVE_PROMPT =
  DEFAULT_NEGATIVE_PROMPT +
  ', grid lines, labels, numbers, uneven spacing, overlapping characters, ' +
  'different characters, varying sizes, cropped, cut off';

/**
 * Generate a complete sprite sheet image (all animation frames in one image).
 * Uses a wider aspect ratio to accommodate multiple frames in a horizontal strip.
 *
 * @param {string} prompt - Character description
 * @param {object} options
 * @param {string}  options.model - AI model
 * @param {number}  options.frameCount - Number of frames (default 4)
 * @param {number}  options.seed - Optional seed
 * @param {boolean} options.transparent - Transparent background
 * @param {string}  options.negativePrompt - Override negative prompt
 * @param {string}  options.consoleName - Console name for style
 * @param {string}  options.viewDesc - View/facing description
 * @param {string}  options.animDesc - Animation name/description
 * @param {string[]} options.frameHints - Per-frame pose descriptions
 * @returns {Promise<HTMLImageElement>} - The loaded sprite sheet image
 */
export async function generateSpriteSheet(prompt, options = {}) {
  const {
    model = 'flux',
    frameCount = 4,
    seed,
    transparent = false,
    negativePrompt = '',
    consoleName = '',
    viewDesc = '',
    animDesc = '',
    frameHints = [],
  } = options;

  // Use wider aspect ratio for horizontal strip
  // Height stays at 512, width scales with frame count
  const height = 512;
  const width = Math.min(1920, frameCount * 512);

  const enhancedPrompt = buildSheetPrompt(prompt, {
    consoleName,
    viewDesc,
    animDesc,
    frameHints,
    frameCount,
  });

  const encodedPrompt = encodeURIComponent(enhancedPrompt);
  const effectiveNegative = negativePrompt || SHEET_NEGATIVE_PROMPT;

  let url = `${POLLINATIONS_BASE}/${encodedPrompt}?model=${encodeURIComponent(model)}&width=${width}&height=${height}&nologo=true&nofeed=true`;
  if (seed !== undefined) {
    url += `&seed=${seed}`;
  }
  if (transparent) {
    url += '&transparent=true';
  }
  url += `&negative_prompt=${encodeURIComponent(effectiveNegative)}`;

  // Store debug info
  lastRequest.prompt = enhancedPrompt;
  lastRequest.negativePrompt = effectiveNegative;
  lastRequest.url = url;
  lastRequest.width = width;
  lastRequest.height = height;
  lastRequest.model = model;
  lastRequest.type = 'sheet';
  console.log('[PixelGen] Sheet Prompt:', enhancedPrompt);
  console.log('[PixelGen] Sheet URL:', url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sprite sheet generation failed: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      img._blobUrl = objectUrl;
      img._frameCount = frameCount;
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load sprite sheet image'));
    };
    img.crossOrigin = 'anonymous';
    img.src = objectUrl;
  });
}
