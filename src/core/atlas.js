/**
 * JSON atlas generation (portable) — Phaser-compatible sprite sheet
 * metadata, shared by the browser export flow and the Node CLI/MCP.
 *
 * Since the multi-engine export work, this is a thin single-animation
 * wrapper over the shared sheet model in exporters.js — use buildSheetModel
 * + toPhaserAtlas (or EXPORT_FORMATS) directly for multi-animation packing
 * or other engine formats.
 */

import { buildSheetModel, toPhaserAtlas } from "./exporters.js";

/**
 * Generate a Phaser.js-compatible JSON Atlas for a horizontal sprite sheet.
 *
 * @param {object} sheetInfo
 * @param {number} sheetInfo.frameWidth
 * @param {number} sheetInfo.frameHeight
 * @param {number} sheetInfo.width - Total sheet width
 * @param {number} sheetInfo.height - Total sheet height
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
        imageName = "spritesheet.png",
        animName = "animation",
        frameCount = 1,
        fps = 8,
        loop = true,
        padding = 0,
    } = meta;

    const { frameWidth, frameHeight, width, height } = sheetInfo;

    const model = buildSheetModel(
        [
            {
                name: animName,
                fps,
                loop,
                frames: Array.from({ length: frameCount }, () => ({
                    width: frameWidth,
                    height: frameHeight,
                })),
            },
        ],
        { imageName, padding },
    );
    // Preserve the caller-supplied sheet dimensions exactly.
    model.width = width;
    model.height = height;

    return toPhaserAtlas(model);
}
