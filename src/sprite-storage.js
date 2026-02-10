/**
 * Sprite Storage — Dexie.js (IndexedDB) persistence for generated sprites.
 *
 * Stores individual frames and assembled sprite sheets with metadata.
 * Queryable by character, animation state, console, view, etc.
 */

import Dexie from 'dexie';

const db = new Dexie('PixelGenDB');

db.version(1).stores({
  // Sprites: individual generated frames
  sprites: '++id, characterName, consoleId, animState, view, frame, [characterName+animState+view], createdAt',
  // Sheets: assembled sprite sheet exports
  sheets: '++id, characterName, consoleId, animState, createdAt',
});

/**
 * Convert a canvas to a Blob for storage.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to convert canvas to blob'));
    }, 'image/png');
  });
}

/**
 * Convert a Blob back into a loaded HTMLCanvasElement.
 * @param {Blob} blob
 * @param {number} width
 * @param {number} height
 * @returns {Promise<HTMLCanvasElement>}
 */
function blobToCanvas(blob, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(img.src);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Failed to load sprite image'));
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Save a single sprite frame to the database.
 *
 * @param {object} frame - { canvas, pixelData, spriteW, spriteH }
 * @param {object} meta
 * @param {string} meta.characterName
 * @param {string} meta.consoleId
 * @param {string} meta.animState
 * @param {string} meta.view
 * @param {number} meta.frame - Frame index
 * @param {string} meta.prompt - Original prompt
 * @param {string} meta.model - AI model used
 * @returns {Promise<number>} - Inserted row ID
 */
export async function saveSprite(frame, meta = {}) {
  const blob = await canvasToBlob(frame.canvas);
  return db.sprites.add({
    characterName: meta.characterName || 'untitled',
    consoleId: meta.consoleId || 'nes',
    animState: meta.animState || 'idle',
    view: meta.view || 'side',
    frame: meta.frame ?? 0,
    prompt: meta.prompt || '',
    model: meta.model || '',
    spriteW: frame.spriteW,
    spriteH: frame.spriteH,
    imageBlob: blob,
    canvasWidth: frame.canvas.width,
    canvasHeight: frame.canvas.height,
    createdAt: new Date(),
  });
}

/**
 * Save all frames for a given animation combo.
 *
 * @param {Array<{ canvas, pixelData, spriteW, spriteH } | null>} frames
 * @param {object} meta - Same as saveSprite meta (minus frame index)
 * @returns {Promise<number[]>} - Array of inserted IDs
 */
export async function saveAllFrames(frames, meta = {}) {
  const ids = [];
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]) {
      const id = await saveSprite(frames[i], { ...meta, frame: i });
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Load frames for a character + animation state + view combo.
 *
 * @param {string} characterName
 * @param {string} animState
 * @param {string} view
 * @returns {Promise<Array<{ canvas, spriteW, spriteH, meta }>>}
 */
export async function loadFrames(characterName, animState, view) {
  const rows = await db.sprites
    .where({ characterName, animState, view })
    .sortBy('frame');

  const frames = [];
  for (const row of rows) {
    const canvas = await blobToCanvas(row.imageBlob, row.canvasWidth, row.canvasHeight);
    frames.push({
      canvas,
      spriteW: row.spriteW,
      spriteH: row.spriteH,
      meta: {
        id: row.id,
        consoleId: row.consoleId,
        prompt: row.prompt,
        model: row.model,
        frame: row.frame,
        createdAt: row.createdAt,
      },
    });
  }
  return frames;
}

/**
 * List all unique characters in the database.
 * @returns {Promise<string[]>}
 */
export async function listCharacters() {
  const all = await db.sprites.orderBy('characterName').uniqueKeys();
  return all;
}

/**
 * List all saved animation combos for a character.
 * @param {string} characterName
 * @returns {Promise<Array<{ animState: string, view: string, frameCount: number }>>}
 */
export async function listAnimations(characterName) {
  const rows = await db.sprites
    .where('characterName')
    .equals(characterName)
    .toArray();

  // Group by animState+view
  const combos = {};
  for (const row of rows) {
    const key = `${row.animState}:${row.view}`;
    if (!combos[key]) {
      combos[key] = { animState: row.animState, view: row.view, frameCount: 0 };
    }
    combos[key].frameCount++;
  }
  return Object.values(combos);
}

/**
 * Delete all frames for a specific animation combo.
 *
 * @param {string} characterName
 * @param {string} animState
 * @param {string} view
 * @returns {Promise<number>} Count of deleted rows
 */
export async function deleteFrames(characterName, animState, view) {
  const rows = await db.sprites
    .where({ characterName, animState, view })
    .toArray();
  const ids = rows.map(r => r.id);
  await db.sprites.bulkDelete(ids);
  return ids.length;
}

/**
 * Delete all data for a character.
 *
 * @param {string} characterName
 * @returns {Promise<number>} Count of deleted rows
 */
export async function deleteCharacter(characterName) {
  const rows = await db.sprites
    .where('characterName')
    .equals(characterName)
    .toArray();
  const ids = rows.map(r => r.id);
  await db.sprites.bulkDelete(ids);
  return ids.length;
}

/**
 * Clear entire database.
 */
export async function clearAll() {
  await db.sprites.clear();
  await db.sheets.clear();
}

/** Direct access to the db for advanced queries. */
export { db };
