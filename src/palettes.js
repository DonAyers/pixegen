/**
 * Browser compatibility layer over the portable palette core.
 *
 * All palette data and math now live in src/core/palettes.js (usable from
 * Node for the CLI/MCP surfaces). This module re-exports them plus the
 * legacy names (`CONSOLES`, `DEFAULT_CONSOLE`, `getPaletteForConsole`) that
 * pre-split code and persisted Dexie rows still reference.
 *
 * New code should import PALETTE_PROFILES + SPRITE_SCALES — the palette
 * (hardware constraint) and the sprite footprint (design choice) are
 * independent axes; see docs/Next-Phase.md §1.
 */

export {
    NES_PALETTE,
    NES_PALETTE_FLAT,
    NES_PALETTE_FULL,
    PALETTE_PROFILES,
    SPRITE_SCALES,
    DEFAULT_PROFILE,
    parseSpriteSize,
    getPaletteProfile,
    reduceTo15Bit,
    reduceImageTo15Bit,
} from "./core/palettes.js";

import {
    PALETTE_PROFILES,
    DEFAULT_PROFILE,
    getPaletteProfile,
} from "./core/palettes.js";

/** @deprecated Alias for PALETTE_PROFILES — sprite sizes are no longer per-console. */
export const CONSOLES = PALETTE_PROFILES;

/** @deprecated Alias for DEFAULT_PROFILE. */
export const DEFAULT_CONSOLE = DEFAULT_PROFILE;

/**
 * @deprecated Use getPaletteProfile — kept for pre-split callers.
 */
export function getPaletteForConsole(consoleId) {
    const entry = getPaletteProfile(consoleId);
    return {
        palette: entry.palette,
        paletteFlat: entry.paletteFlat,
        quantizeMode: entry.quantizeMode,
        bitDepthReduce: entry.bitDepthReduce || null,
    };
}
