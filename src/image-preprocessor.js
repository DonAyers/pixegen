/**
 * Image Preprocessing Module
 * 
 * Applies preprocessing to AI-generated images before pixelation to improve
 * sprite quality. Addresses common issues like:
 * - Noise and artifacts from AI generation
 * - Soft/blurry edges that pixelate poorly
 * - Low contrast that makes sprites look blob-like
 * - Background color inconsistencies causing flickering in animations
 * 
 * Pure JavaScript/Canvas implementation for browser compatibility.
 */

/**
 * Preprocessing options for different use cases
 */
export const PREPROCESSING_PRESETS = {
  none: {
    label: 'None',
    enabled: false,
  },
  standard: {
    label: 'Standard (balanced)',
    enabled: true,
    denoise: 1,
    sharpen: 1.2,
    contrast: 1.05,
    saturation: 1.1,
  },
  strong: {
    label: 'Strong (crisp edges)',
    enabled: true,
    denoise: 2,
    sharpen: 2.0,
    contrast: 1.15,
    saturation: 1.2,
  },
  animation: {
    label: 'Animation (consistent)',
    enabled: true,
    denoise: 1.5,
    sharpen: 1.5,
    contrast: 1.1,
    saturation: 1.15,
    stabilize: true,
  },
};

/**
 * Apply median filter for edge-preserving noise reduction (simple box approximation).
 * @param {ImageData} imageData - Input image data
 * @param {number} radius - Filter radius (1-3)
 * @returns {ImageData} Filtered image data
 */
function applyMedianFilter(imageData, radius = 1) {
  const { width, height, data } = imageData;
  const result = new ImageData(width, height);
  const dst = result.data;
  
  const windowSize = radius * 2 + 1;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rValues = [];
      const gValues = [];
      const bValues = [];
      
      // Collect neighborhood values
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          const ny = Math.max(0, Math.min(height - 1, y + dy));
          const idx = (ny * width + nx) * 4;
          
          rValues.push(data[idx]);
          gValues.push(data[idx + 1]);
          bValues.push(data[idx + 2]);
        }
      }
      
      // Sort and take median
      rValues.sort((a, b) => a - b);
      gValues.sort((a, b) => a - b);
      bValues.sort((a, b) => a - b);
      
      const mid = Math.floor(rValues.length / 2);
      const idx = (y * width + x) * 4;
      
      dst[idx] = rValues[mid];
      dst[idx + 1] = gValues[mid];
      dst[idx + 2] = bValues[mid];
      dst[idx + 3] = data[idx + 3]; // Keep alpha
    }
  }
  
  return result;
}

/**
 * Apply unsharp mask to enhance edges and details.
 * @param {ImageData} imageData - Input image data
 * @param {number} strength - Sharpening strength (1.0-3.0)
 * @returns {ImageData} Sharpened image data
 */
function applyUnsharpMask(imageData, strength = 1.2) {
  if (strength <= 1.0) return imageData;
  
  const { width, height, data } = imageData;
  const result = new ImageData(width, height);
  const dst = result.data;
  
  // Simple 3x3 Gaussian blur for mask
  const blur = new ImageData(width, height);
  const blurData = blur.data;
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          count++;
        }
      }
      
      const idx = (y * width + x) * 4;
      blurData[idx] = r / count;
      blurData[idx + 1] = g / count;
      blurData[idx + 2] = b / count;
      blurData[idx + 3] = data[idx + 3];
    }
  }
  
  // Unsharp mask: original + (original - blurred) * amount
  const amount = (strength - 1.0) * 2.0;
  
  for (let i = 0; i < data.length; i += 4) {
    dst[i] = Math.max(0, Math.min(255, data[i] + (data[i] - blurData[i]) * amount));
    dst[i + 1] = Math.max(0, Math.min(255, data[i + 1] + (data[i + 1] - blurData[i + 1]) * amount));
    dst[i + 2] = Math.max(0, Math.min(255, data[i + 2] + (data[i + 2] - blurData[i + 2]) * amount));
    dst[i + 3] = data[i + 3];
  }
  
  return result;
}

/**
 * Adjust contrast to make sprites more defined.
 * @param {ImageData} imageData - Input image data
 * @param {number} factor - Contrast multiplier (1.0 = no change, >1.0 = more contrast)
 * @returns {ImageData} Adjusted image data
 */
function adjustContrast(imageData, factor = 1.05) {
  if (factor === 1.0) return imageData;
  
  const { width, height, data } = imageData;
  const result = new ImageData(width, height);
  const dst = result.data;
  
  const adjust = factor;
  const offset = (1.0 - adjust) * 128;
  
  for (let i = 0; i < data.length; i += 4) {
    dst[i] = Math.max(0, Math.min(255, data[i] * adjust + offset));
    dst[i + 1] = Math.max(0, Math.min(255, data[i + 1] * adjust + offset));
    dst[i + 2] = Math.max(0, Math.min(255, data[i + 2] * adjust + offset));
    dst[i + 3] = data[i + 3];
  }
  
  return result;
}

/**
 * Adjust color saturation.
 * @param {ImageData} imageData - Input image data
 * @param {number} factor - Saturation multiplier (1.0 = no change, >1.0 = more saturated)
 * @returns {ImageData} Adjusted image data
 */
function adjustSaturation(imageData, factor = 1.1) {
  if (factor === 1.0) return imageData;
  
  const { width, height, data } = imageData;
  const result = new ImageData(width, height);
  const dst = result.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Convert to grayscale (luminance)
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // Interpolate between gray and original color
    dst[i] = Math.max(0, Math.min(255, gray + (r - gray) * factor));
    dst[i + 1] = Math.max(0, Math.min(255, gray + (g - gray) * factor));
    dst[i + 2] = Math.max(0, Math.min(255, gray + (b - gray) * factor));
    dst[i + 3] = data[i + 3];
  }
  
  return result;
}

/**
 * Normalize image colors for consistent tones (histogram equalization approximation).
 * @param {ImageData} imageData - Input image data
 * @returns {ImageData} Normalized image data
 */
function stabilizeColors(imageData) {
  const { width, height, data } = imageData;
  const result = new ImageData(width, height);
  const dst = result.data;
  
  // Build histogram
  const histR = new Array(256).fill(0);
  const histG = new Array(256).fill(0);
  const histB = new Array(256).fill(0);
  
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 10) { // Skip transparent pixels
      histR[data[i]]++;
      histG[data[i + 1]]++;
      histB[data[i + 2]]++;
    }
  }
  
  // Build cumulative distribution
  const cdfR = new Array(256);
  const cdfG = new Array(256);
  const cdfB = new Array(256);
  
  cdfR[0] = histR[0];
  cdfG[0] = histG[0];
  cdfB[0] = histB[0];
  
  for (let i = 1; i < 256; i++) {
    cdfR[i] = cdfR[i - 1] + histR[i];
    cdfG[i] = cdfG[i - 1] + histG[i];
    cdfB[i] = cdfB[i - 1] + histB[i];
  }
  
  const totalPixels = width * height;
  
  // Normalize CDF to 0-255 range
  const minR = cdfR.find(v => v > 0) || 0;
  const minG = cdfG.find(v => v > 0) || 0;
  const minB = cdfB.find(v => v > 0) || 0;
  
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 10) {
      dst[i] = Math.round((cdfR[data[i]] - minR) * 255 / (totalPixels - minR));
      dst[i + 1] = Math.round((cdfG[data[i + 1]] - minG) * 255 / (totalPixels - minG));
      dst[i + 2] = Math.round((cdfB[data[i + 2]] - minB) * 255 / (totalPixels - minB));
    } else {
      dst[i] = data[i];
      dst[i + 1] = data[i + 1];
      dst[i + 2] = data[i + 2];
    }
    dst[i + 3] = data[i + 3];
  }
  
  return result;
}

/**
 * Main preprocessing pipeline: applies a series of enhancements to prepare
 * AI-generated images for optimal pixelation.
 * 
 * @param {HTMLImageElement} img - Source image
 * @param {object} options - Preprocessing options
 * @param {boolean} options.enabled - Whether preprocessing is enabled
 * @param {number} options.denoise - Denoising strength (0-3)
 * @param {number} options.sharpen - Sharpening strength (1.0-3.0)
 * @param {number} options.contrast - Contrast adjustment (1.0-1.3)
 * @param {number} options.saturation - Saturation adjustment (1.0-1.5)
 * @param {boolean} options.stabilize - Apply color stabilization
 * @returns {Promise<HTMLImageElement>} Processed image ready for pixelation
 */
export async function preprocessImage(img, options = {}) {
  const {
    enabled = true,
    denoise = 0,
    sharpen = 1.0,
    contrast = 1.0,
    saturation = 1.0,
    stabilize = false,
  } = options;
  
  // Skip if preprocessing disabled or no operations requested
  if (!enabled || (denoise === 0 && sharpen === 1.0 && contrast === 1.0 && saturation === 1.0 && !stabilize)) {
    return img;
  }
  
  // Convert to ImageData
  const canvas = new OffscreenCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // Apply preprocessing steps in optimal order:
  // 1. Denoise (remove artifacts while preserving edges)
  if (denoise > 0) {
    const radius = Math.min(Math.ceil(denoise), 3);
    imageData = applyMedianFilter(imageData, radius);
  }
  
  // 2. Enhance contrast (make features more distinct)
  if (contrast !== 1.0) {
    imageData = adjustContrast(imageData, contrast);
  }
  
  // 3. Boost saturation (more vibrant colors)
  if (saturation !== 1.0) {
    imageData = adjustSaturation(imageData, saturation);
  }
  
  // 4. Sharpen (crisp up edges for better pixelation)
  if (sharpen > 1.0) {
    imageData = applyUnsharpMask(imageData, sharpen);
  }
  
  // 5. Stabilize colors (for animation consistency)
  if (stabilize) {
    imageData = stabilizeColors(imageData);
  }
  
  // Convert back to HTMLImageElement
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const url = URL.createObjectURL(blob);
  
  return new Promise((resolve, reject) => {
    const result = new Image();
    result.onload = () => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    result.onerror = reject;
    result.src = url;
  });
}
