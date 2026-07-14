/**
 * Sprite Storage — Dexie.js (IndexedDB) persistence for generated sprites.
 *
 * Stores individual frames and assembled sprite sheets with metadata.
 * Queryable by character, animation state, console, view, etc.
 */

import Dexie from "dexie";

const db = new Dexie("PixelGenDB");

db.version(1).stores({
    // Sprites: individual generated frames
    sprites:
        "++id, characterName, consoleId, animState, view, frame, [characterName+animState+view], createdAt",
    // Sheets: assembled sprite sheet exports
    sheets: "++id, characterName, consoleId, animState, createdAt",
});

db.version(2)
    .stores({
        // Added sourceBlob + extra metadata so every generation keeps its raw AI image.
        sprites:
            "++id, characterName, consoleId, animState, view, frame, [characterName+animState+view], createdAt, generationGroupId",
        sheets: "++id, characterName, consoleId, animState, createdAt",
    })
    .upgrade((tx) => {
        // Legacy rows didn't store source images; leave new fields undefined.
        return tx
            .table("sprites")
            .toCollection()
            .modify((row) => {
                row.sourceBlob = row.sourceBlob ?? undefined;
                row.generationGroupId = row.generationGroupId ?? undefined;
                row.size = row.size ?? undefined;
                row.pipeline = row.pipeline ?? undefined;
                row.dither = row.dither ?? undefined;
                row.seed = row.seed ?? undefined;
            });
    });

db.version(3).stores({
    sprites:
        "++id, characterName, consoleId, animState, view, frame, [characterName+animState+view], createdAt, generationGroupId",
    sheets: "++id, characterName, consoleId, animState, createdAt",
    // Tiles: individual generated tileset tiles. `projectId` is left as an
    // unused/optional field for now — Project entities are a later phase,
    // this just leaves room for the eventual foreign key.
    tiles: "++id, projectId, roleId, gridX, gridY, createdAt, generationGroupId",
});

db.version(4).stores({
    // Adds the Character entity and a characterId foreign key on sprites.
    // Legacy sprite rows keep working through the characterName string;
    // adoptSpritesByName() backfills characterId when a Character is created
    // for an existing name.
    sprites:
        "++id, characterName, characterId, consoleId, animState, view, frame, [characterName+animState+view], [characterId+animState+view], createdAt, generationGroupId",
    sheets: "++id, characterName, consoleId, animState, createdAt",
    tiles: "++id, projectId, roleId, gridX, gridY, createdAt, generationGroupId",
    // Characters: the persistent identity a set of animations belongs to.
    // Row fields: name, description (locked prompt subject), styleNotes,
    // consoleId, size, modelId, baseSeed, refImageBlob, refImageUrl,
    // createdAt, updatedAt.
    characters: "++id, name, createdAt, updatedAt",
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
            else reject(new Error("Failed to convert canvas to blob"));
        }, "image/png");
    });
}

/**
 * Convert a Blob back into a loaded HTMLCanvasElement.
 * @param {Blob} blob
 * @param {number} width
 * @param {number} height
 * @returns {Promise<HTMLCanvasElement>}
 */
export function blobToCanvas(blob, width, height) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(img.src);
            resolve(canvas);
        };
        img.onerror = () => reject(new Error("Failed to load sprite image"));
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
 * @param {Blob} [meta.sourceBlob] - Raw AI-generated source image
 * @param {string} [meta.size] - Sprite size key
 * @param {string} [meta.pipeline] - Pipeline mode
 * @param {string} [meta.dither] - Dither mode
 * @param {number|string} [meta.seed] - Seed used
 * @param {string} [meta.generationGroupId] - Shared group id for a single generation
 * @param {number} [meta.characterId] - Character entity foreign key
 * @returns {Promise<number>} - Inserted row ID
 */
export async function saveSprite(frame, meta = {}) {
    const blob = await canvasToBlob(frame.canvas);
    return db.sprites.add({
        characterId: meta.characterId ?? undefined,
        characterName: meta.characterName || "untitled",
        consoleId: meta.consoleId || "nes",
        animState: meta.animState || "idle",
        view: meta.view || "side",
        frame: meta.frame ?? 0,
        prompt: meta.prompt || "",
        model: meta.model || "",
        spriteW: frame.spriteW,
        spriteH: frame.spriteH,
        imageBlob: blob,
        sourceBlob: meta.sourceBlob,
        sourceUrl: meta.sourceUrl || "",
        canvasWidth: frame.canvas.width,
        canvasHeight: frame.canvas.height,
        createdAt: new Date(),
        generationGroupId: meta.generationGroupId || null,
        size: meta.size || "",
        pipeline: meta.pipeline || "",
        dither: meta.dither || "",
        seed: meta.seed ?? undefined,
    });
}

/**
 * Save all frames for a given animation combo. The frame index defaults to
 * the array position; an explicit `meta.frame` wins (used by callers that
 * save one frame at a time while preserving its real index).
 *
 * @param {Array<{ canvas, pixelData, spriteW, spriteH } | null>} frames
 * @param {object} meta - Same as saveSprite meta
 * @returns {Promise<number[]>} - Array of inserted IDs
 */
export async function saveAllFrames(frames, meta = {}) {
    const ids = [];
    for (let i = 0; i < frames.length; i++) {
        if (frames[i]) {
            const id = await saveSprite(frames[i], { frame: i, ...meta });
            ids.push(id);
        }
    }
    return ids;
}

/**
 * List every saved sprite row, newest first.
 * Useful for the Explorer view.
 * @returns {Promise<Array<object>>}
 */
export async function listAllSaved() {
    return db.sprites.orderBy("createdAt").reverse().toArray();
}

/**
 * Get the raw source blob for a saved sprite by id.
 * @param {number} id
 * @returns {Promise<Blob|undefined>}
 */
export async function getSourceBlob(id) {
    const row = await db.sprites.get(id);
    return row?.sourceBlob;
}

/**
 * Delete a single saved sprite row by id.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteById(id) {
    await db.sprites.delete(id);
}

/**
 * Delete every saved sprite.
 * @returns {Promise<void>}
 */
export async function deleteAllSprites() {
    await db.sprites.clear();
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
        .sortBy("frame");

    const frames = [];
    for (const row of rows) {
        const canvas = await blobToCanvas(
            row.imageBlob,
            row.canvasWidth,
            row.canvasHeight,
        );
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
    const all = await db.sprites.orderBy("characterName").uniqueKeys();
    return all;
}

/**
 * List all saved animation combos for a character.
 * @param {string} characterName
 * @returns {Promise<Array<{ animState: string, view: string, frameCount: number }>>}
 */
export async function listAnimations(characterName) {
    const rows = await db.sprites
        .where("characterName")
        .equals(characterName)
        .toArray();

    // Group by animState+view
    const combos = {};
    for (const row of rows) {
        const key = `${row.animState}:${row.view}`;
        if (!combos[key]) {
            combos[key] = {
                animState: row.animState,
                view: row.view,
                frameCount: 0,
            };
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
    const ids = rows.map((r) => r.id);
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
        .where("characterName")
        .equals(characterName)
        .toArray();
    const ids = rows.map((r) => r.id);
    await db.sprites.bulkDelete(ids);
    return ids.length;
}

/**
 * Clear entire database.
 */
export async function clearAll() {
    await db.sprites.clear();
    await db.sheets.clear();
    await db.tiles.clear();
    await db.characters.clear();
}

// ─── Character entities ─────────────────────────────────────────────────────
//
// A Character is the persistent identity that animations belong to: a locked
// prompt subject (description + style notes), preferred pipeline settings
// (palette, scale, model, base seed), and an optional canonical reference
// image used for visual-cohesion conditioning on models that accept the
// `image=` param. Sprite rows link to it via `characterId`; rows saved
// before v4 (or from the Generator tab without a Character) still group by
// the `characterName` string, and adoptSpritesByName() migrates them.

/**
 * Create a Character entity.
 *
 * @param {object} props
 * @param {string} props.name - Display name (unique-ish, not enforced)
 * @param {string} props.description - Locked prompt subject text
 * @param {string} [props.styleNotes] - Extra locked style fragments
 * @param {string} [props.consoleId] - Preferred palette profile
 * @param {string} [props.size] - Preferred sprite scale key
 * @param {string} [props.modelId] - Preferred "provider:model" id
 * @param {number} [props.baseSeed] - Base seed reused across animations
 * @param {Blob} [props.refImageBlob] - Canonical reference image (display)
 * @param {string} [props.refImageUrl] - Upstream URL of the reference
 *   generation, passed as `image=` conditioning when the model supports it
 * @returns {Promise<number>} New character id
 */
export async function createCharacter(props) {
    const now = new Date();
    return db.characters.add({
        name: (props.name || "untitled").trim(),
        description: props.description || "",
        styleNotes: props.styleNotes || "",
        consoleId: props.consoleId || "nes",
        size: props.size || "",
        modelId: props.modelId || "",
        baseSeed: props.baseSeed ?? Math.floor(Math.random() * 1_000_000),
        refImageBlob: props.refImageBlob ?? undefined,
        refImageUrl: props.refImageUrl || "",
        createdAt: now,
        updatedAt: now,
    });
}

/**
 * Update fields on a Character (sets updatedAt).
 * @param {number} id
 * @param {object} patch
 */
export async function updateCharacter(id, patch) {
    await db.characters.update(id, { ...patch, updatedAt: new Date() });
}

/**
 * Get one Character row.
 * @param {number} id
 */
export async function getCharacter(id) {
    return db.characters.get(id);
}

/**
 * List all Character entities, most recently updated first.
 */
export async function listCharacterEntities() {
    return db.characters.orderBy("updatedAt").reverse().toArray();
}

/**
 * Delete a Character entity, optionally with all its sprite rows.
 * @param {number} id
 * @param {object} [options]
 * @param {boolean} [options.deleteSprites] - Also delete linked sprites
 * @returns {Promise<number>} Count of deleted sprite rows
 */
export async function deleteCharacterEntity(id, options = {}) {
    let deleted = 0;
    if (options.deleteSprites) {
        const rows = await db.sprites
            .where("characterId")
            .equals(id)
            .toArray();
        await db.sprites.bulkDelete(rows.map((r) => r.id));
        deleted = rows.length;
    }
    await db.characters.delete(id);
    return deleted;
}

/**
 * Link legacy sprite rows (saved before the Character existed) to a
 * Character by name: every sprite row with this characterName and no
 * characterId gets the foreign key.
 *
 * @param {number} characterId
 * @param {string} characterName
 * @returns {Promise<number>} Count of adopted rows
 */
export async function adoptSpritesByName(characterId, characterName) {
    const rows = await db.sprites
        .where("characterName")
        .equals(characterName)
        .toArray();
    const orphans = rows.filter((r) => r.characterId == null);
    for (const row of orphans) {
        await db.sprites.update(row.id, { characterId });
    }
    return orphans.length;
}

/**
 * List saved animation combos for a Character (by foreign key).
 * @param {number} characterId
 * @returns {Promise<Array<{ animState, view, frameCount, generationGroupId }>>}
 */
export async function listCharacterAnimations(characterId) {
    const rows = await db.sprites
        .where("characterId")
        .equals(characterId)
        .toArray();

    const combos = {};
    for (const row of rows) {
        const key = `${row.animState}:${row.view}`;
        if (!combos[key]) {
            combos[key] = {
                animState: row.animState,
                view: row.view,
                frameCount: 0,
                latestAt: row.createdAt,
            };
        }
        combos[key].frameCount++;
        if (row.createdAt > combos[key].latestAt) {
            combos[key].latestAt = row.createdAt;
        }
    }
    return Object.values(combos);
}

/**
 * Load hydrated frames for one Character animation combo. When the combo
 * was generated more than once, only the most recent generation group is
 * returned (one row per frame index).
 *
 * @param {number} characterId
 * @param {string} animState
 * @param {string} view
 * @returns {Promise<Array<{ canvas, spriteW, spriteH, meta }>>}
 */
export async function loadCharacterFrames(characterId, animState, view) {
    const rows = await db.sprites
        .where("[characterId+animState+view]")
        .equals([characterId, animState, view])
        .sortBy("frame");

    // Keep only the newest row per frame index.
    const byFrame = new Map();
    for (const row of rows) {
        const existing = byFrame.get(row.frame);
        if (!existing || row.createdAt > existing.createdAt) {
            byFrame.set(row.frame, row);
        }
    }

    const frames = [];
    for (const row of [...byFrame.values()].sort(
        (a, b) => a.frame - b.frame,
    )) {
        const canvas = await blobToCanvas(
            row.imageBlob,
            row.canvasWidth,
            row.canvasHeight,
        );
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
                sourceBlob: row.sourceBlob,
            },
        });
    }
    return frames;
}

/**
 * Delete all sprite rows for one Character animation combo.
 * @param {number} characterId
 * @param {string} animState
 * @param {string} view
 * @returns {Promise<number>} Count of deleted rows
 */
export async function deleteCharacterFrames(characterId, animState, view) {
    const rows = await db.sprites
        .where("[characterId+animState+view]")
        .equals([characterId, animState, view])
        .toArray();
    await db.sprites.bulkDelete(rows.map((r) => r.id));
    return rows.length;
}

/**
 * Save a single generated tile to the database.
 *
 * @param {object} tile - { canvas, pixelData, spriteW, spriteH, gridX, gridY }
 * @param {object} meta
 * @param {string} meta.roleId - Tile role from tile-roles.js
 * @param {string} meta.consoleId
 * @param {string} meta.prompt - Original theme prompt
 * @param {string} meta.model - AI model used
 * @param {Blob} [meta.sourceBlob] - Raw AI-generated source image (batch region)
 * @param {string} [meta.size] - Sprite size key
 * @param {string} [meta.pipeline] - Pipeline mode
 * @param {string} [meta.dither] - Dither mode
 * @param {string} [meta.generationGroupId] - Shared group id for a single generation
 * @param {number} [meta.projectId] - Optional project foreign key (unused for now)
 * @returns {Promise<number>} - Inserted row ID
 */
export async function saveTile(tile, meta = {}) {
    const blob = await canvasToBlob(tile.canvas);
    return db.tiles.add({
        projectId: meta.projectId ?? undefined,
        tilesetName: meta.tilesetName || "untitled",
        roleId: meta.roleId || "grass",
        consoleId: meta.consoleId || "nes",
        gridX: tile.gridX ?? 0,
        gridY: tile.gridY ?? 0,
        prompt: meta.prompt || "",
        model: meta.model || "",
        spriteW: tile.spriteW,
        spriteH: tile.spriteH,
        imageBlob: blob,
        sourceBlob: meta.sourceBlob,
        canvasWidth: tile.canvas.width,
        canvasHeight: tile.canvas.height,
        createdAt: new Date(),
        generationGroupId: meta.generationGroupId || null,
        size: meta.size || "",
        pipeline: meta.pipeline || "",
        dither: meta.dither || "",
    });
}

/**
 * Save every tile of a generated tileset.
 *
 * @param {Array<{ canvas, pixelData, spriteW, spriteH, gridX, gridY, roleId } | null>} tiles
 * @param {object} meta - Same as saveTile meta (minus per-tile fields)
 * @returns {Promise<number[]>} - Array of inserted IDs
 */
export async function saveAllTiles(tiles, meta = {}) {
    const ids = [];
    for (const tile of tiles) {
        if (tile) {
            const id = await saveTile(tile, {
                ...meta,
                roleId: tile.roleId || meta.roleId,
            });
            ids.push(id);
        }
    }
    return ids;
}

/**
 * List every saved tile row, newest first.
 * @returns {Promise<Array<object>>}
 */
export async function listAllTiles() {
    return db.tiles.orderBy("createdAt").reverse().toArray();
}

/**
 * Delete a single saved tile row by id.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteTileById(id) {
    await db.tiles.delete(id);
}

/**
 * Delete every saved tile.
 * @returns {Promise<void>}
 */
export async function deleteAllTiles() {
    await db.tiles.clear();
}

/** Direct access to the db for advanced queries. */
export { db };
