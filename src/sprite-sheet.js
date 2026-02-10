/**
 * Sprite Sheet Export
 *
 * Assembles generated animation frames into a horizontal sprite sheet PNG.
 * Also exports a JSON atlas for use in Phaser.js or other game frameworks.
 */

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
 * Generate a Phaser.js-compatible JSON Atlas for the sprite sheet.
 *
 * @param {object} sheetInfo - From buildSpriteSheet
 * @param {object} meta
 * @param {string} meta.imageName - Filename for the sprite sheet image
 * @param {string} meta.animName - Animation key name
 * @param {number} meta.frameCount - Number of frames
 * @param {number} meta.fps - Playback FPS
 * @param {boolean} meta.loop - Whether animation loops
 * @param {number} meta.padding - Padding between frames
 * @returns {object} JSON Atlas object
 */
export function buildJsonAtlas(sheetInfo, meta = {}) {
  const {
    imageName = 'spritesheet.png',
    animName = 'animation',
    frameCount = 1,
    fps = 8,
    loop = true,
    padding = 0,
  } = meta;

  const { frameWidth, frameHeight, width, height } = sheetInfo;

  // Phaser JSON Array format
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push({
      filename: `${animName}_${String(i).padStart(3, '0')}`,
      frame: {
        x: i * (frameWidth + padding),
        y: 0,
        w: frameWidth,
        h: frameHeight,
      },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
      sourceSize: { w: frameWidth, h: frameHeight },
    });
  }

  return {
    frames,
    meta: {
      app: 'PixelGen',
      version: '1.0',
      image: imageName,
      format: 'RGBA8888',
      size: { w: width, h: height },
      scale: 1,
    },
    animations: [
      {
        key: animName,
        frameRate: fps,
        repeat: loop ? -1 : 0,
        frames: frames.map(f => f.filename),
      },
    ],
  };
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
