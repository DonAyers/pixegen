/**
 * Sprite Sheet Export
 *
 * Assembles generated animation frames into a horizontal sprite sheet PNG.
 * Also exports a JSON atlas for use in Phaser.js or other game frameworks.
 * The atlas format itself is built in src/core/atlas.js, shared with the
 * Node CLI/MCP export path.
 */

import { buildJsonAtlas } from "./core/atlas.js";
import {
    buildSheetModel,
    emitSheetMetadata,
    EXPORT_FORMATS,
} from "./core/exporters.js";

export { buildJsonAtlas, buildSheetModel, emitSheetMetadata, EXPORT_FORMATS };

/**
 * Build a horizontal sprite sheet from an array of frame canvases.
 *
 * @param {Array<{ canvas: HTMLCanvasElement, spriteW: number, spriteH: number }>} frames
 * @param {object} options
 * @param {number} options.padding - Pixels between frames (default: 0)
 * @returns {{ canvas: HTMLCanvasElement, width: number, height: number, frameWidth: number, frameHeight: number }}
 */
export function buildSpriteSheet(frames, options = {}) {
  const { padding = 0 } = options;

  if (!frames || frames.length === 0) {
    throw new Error('No frames to export');
  }

  // Use the raw sprite dimensions (not the scaled canvas dimensions)
  const frameW = frames[0].spriteW;
  const frameH = frames[0].spriteH;

  const totalW = frames.length * frameW + (frames.length - 1) * padding;
  const totalH = frameH;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  frames.forEach((frame, i) => {
    const x = i * (frameW + padding);
    // Draw from the source pixelData at 1:1 scale (no upscaling)
    if (frame.pixelData) {
      // Put pixel data directly for crisp 1:1 output
      ctx.putImageData(frame.pixelData, x, 0);
    } else {
      // Fallback: draw from canvas, scaling down to sprite dimensions
      ctx.drawImage(frame.canvas, x, 0, frameW, frameH);
    }
  });

  return { canvas, width: totalW, height: totalH, frameWidth: frameW, frameHeight: frameH };
}

/**
 * Build a packed multi-animation sprite sheet (one row per animation) from
 * hydrated frame canvases, using the shared sheet model for layout.
 *
 * @param {Array<{ name: string, fps?: number, loop?: boolean, frames: Array<{ canvas, pixelData?, spriteW, spriteH }> }>} animations
 * @param {object} options
 * @param {string} [options.imageName]
 * @param {number} [options.padding=0]
 * @returns {{ canvas: HTMLCanvasElement, model: object }}
 */
export function buildPackedSheet(animations, options = {}) {
  const model = buildSheetModel(
    animations.map((a) => ({
      name: a.name,
      fps: a.fps,
      loop: a.loop,
      frames: a.frames.map((f) => ({ width: f.spriteW, height: f.spriteH })),
    })),
    options,
  );

  const canvas = document.createElement('canvas');
  canvas.width = model.width;
  canvas.height = model.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (const placed of model.frames) {
    const anim = animations.find((a) => a.name === placed.animation);
    const frame = anim?.frames[placed.index];
    if (!frame) continue;
    if (frame.pixelData) {
      ctx.putImageData(frame.pixelData, placed.x, placed.y);
    } else {
      ctx.drawImage(frame.canvas, placed.x, placed.y, placed.w, placed.h);
    }
  }

  return { canvas, model };
}

/**
 * Trigger a browser download of a file.
 *
 * @param {Blob|string} data - Blob or data URL
 * @param {string} filename - Download filename
 */
export function downloadFile(data, filename) {
  const url = data instanceof Blob ? URL.createObjectURL(data) : data;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (data instanceof Blob) {
    URL.revokeObjectURL(url);
  }
}

/**
 * Export sprite sheet as PNG blob.
 *
 * @param {HTMLCanvasElement} sheetCanvas - The assembled sprite sheet canvas
 * @returns {Promise<Blob>}
 */
export function exportSheetAsPng(sheetCanvas) {
  return new Promise((resolve, reject) => {
    sheetCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to export canvas as PNG'));
    }, 'image/png');
  });
}

/**
 * Full export: build sheet + atlas, trigger downloads.
 *
 * @param {Array<{ canvas, pixelData, spriteW, spriteH }>} frames
 * @param {object} meta
 * @param {string} meta.characterName - Character/sprite name
 * @param {string} meta.animName - Animation state name
 * @param {string} meta.consoleName - Console name
 * @param {number} meta.fps - Playback FPS
 * @param {boolean} meta.loop - Whether animation loops
 */
export async function exportSpriteSheet(frames, meta = {}) {
  const {
    characterName = 'sprite',
    animName = 'idle',
    consoleName = 'nes',
    fps = 8,
    loop = true,
  } = meta;

  const baseName = `${characterName}_${animName}_${consoleName}`;
  const pngName = `${baseName}.png`;
  const jsonName = `${baseName}.json`;

  // Build sheet
  const sheetInfo = buildSpriteSheet(frames);

  // Build atlas
  const atlas = buildJsonAtlas(sheetInfo, {
    imageName: pngName,
    animName,
    frameCount: frames.length,
    fps,
    loop,
  });

  // Export PNG
  const pngBlob = await exportSheetAsPng(sheetInfo.canvas);
  downloadFile(pngBlob, pngName);

  // Export JSON atlas
  const jsonBlob = new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' });
  downloadFile(jsonBlob, jsonName);

  return { pngName, jsonName, sheetInfo, atlas };
}
