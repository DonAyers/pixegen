/**
 * NES PPU Color Palette
 *
 * Based on the FirebrandX Smooth palette — a widely-used accurate
 * approximation of the NES PPU's analog color output.
 *
 * The NES PPU has 64 color entries ($00–$3F), but many are duplicates
 * or dangerous blacks. This provides the ~54 usable, unique colors.
 *
 * Each entry is [R, G, B].
 */

// Full 64-entry NES palette (FirebrandX Smooth FBX)
// Indices correspond to NES PPU color addresses $00–$3F
export const NES_PALETTE_FULL = [
  // Row 0 ($00–$0F)
  [101, 101, 101], // $00 — dark gray
  [  0,  45, 105], // $01 — dark blue
  [  7,  12, 135], // $02 — dark indigo
  [ 65,   0, 121], // $03 — dark violet
  [100,   3,  79], // $04 — dark magenta
  [110,   0,  13], // $05 — dark red
  [ 95,  11,   0], // $06 — dark orange-red
  [ 61,  31,   0], // $07 — dark brown
  [ 18,  51,   0], // $08 — dark olive
  [  0,  63,   0], // $09 — dark green
  [  0,  63,   0], // $0A — dark green (dupe)
  [  0,  56,  16], // $0B — dark teal
  [  0,  42,  82], // $0C — dark cyan
  [  0,   0,   0], // $0D — black
  [  0,   0,   0], // $0E — black (mirror)
  [  0,   0,   0], // $0F — black (mirror)

  // Row 1 ($10–$1F)
  [174, 174, 174], // $10 — light gray
  [ 15, 100, 188], // $11 — blue
  [ 38,  64, 229], // $12 — medium blue
  [100,  40, 210], // $13 — violet
  [150,  35, 163], // $14 — magenta
  [168,  32,  78], // $15 — red-magenta
  [162,  49,   7], // $16 — red-orange
  [120,  72,   0], // $17 — orange-brown
  [ 64,  98,   0], // $18 — olive-green
  [ 12, 114,   0], // $19 — green
  [  0, 117,  20], // $1A — green
  [  0, 111,  78], // $1B — teal
  [  0,  93, 153], // $1C — cyan-blue
  [  0,   0,   0], // $1D — black (mirror)
  [  0,   0,   0], // $1E — black (mirror)
  [  0,   0,   0], // $1F — black (mirror)

  // Row 2 ($20–$2F)
  [254, 254, 255], // $20 — white
  [ 93, 179, 255], // $21 — light blue
  [114, 143, 255], // $22 — periwinkle
  [172, 121, 255], // $23 — light violet
  [222, 115, 244], // $24 — light magenta
  [243, 114, 170], // $25 — pink
  [238, 130, 100], // $26 — salmon
  [200, 155,  59], // $27 — light orange
  [145, 180,  32], // $28 — yellow-green
  [ 94, 196,  34], // $29 — light green
  [ 66, 199,  82], // $2A — mint green
  [ 61, 193, 147], // $2B — aqua
  [ 69, 175, 222], // $2C — light cyan
  [ 78,  78,  78], // $2D — medium gray
  [  0,   0,   0], // $2E — black (mirror)
  [  0,   0,   0], // $2F — black (mirror)

  // Row 3 ($30–$3F)
  [254, 254, 255], // $30 — white (dupe)
  [188, 223, 255], // $31 — pale blue
  [198, 210, 255], // $32 — pale periwinkle
  [221, 201, 255], // $33 — pale violet
  [240, 198, 252], // $34 — pale magenta
  [248, 197, 222], // $35 — pale pink
  [246, 204, 191], // $36 — pale salmon
  [233, 216, 170], // $37 — pale orange
  [211, 227, 158], // $38 — pale yellow-green
  [191, 234, 159], // $39 — pale green
  [179, 235, 180], // $3A — pale mint
  [176, 232, 210], // $3B — pale aqua
  [180, 224, 238], // $3C — pale cyan
  [184, 184, 184], // $3D — light gray
  [  0,   0,   0], // $3E — black (mirror)
  [  0,   0,   0], // $3F — black (mirror)
];

// Deduplicated palette — only unique, usable colors (no mirror blacks or dupes)
// This is what we use for quantization
export const NES_PALETTE = (() => {
  const seen = new Set();
  const unique = [];
  for (const [r, g, b] of NES_PALETTE_FULL) {
    const key = `${r},${g},${b}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push([r, g, b]);
    }
  }
  return unique;
})();

/**
 * Flat array of NES palette for RgbQuant: [R,G,B, R,G,B, ...]
 */
export const NES_PALETTE_FLAT = NES_PALETTE.flatMap(([r, g, b]) => [r, g, b]);

/**
 * NES sprite size options
 */
export const SPRITE_SIZES = {
  '8x8': { width: 8, height: 8, label: '8×8 (tile)' },
  '16x16': { width: 16, height: 16, label: '16×16 (2 tiles)' },
  '32x32': { width: 32, height: 32, label: '32×32 (4 tiles)' },
  '64x64': { width: 64, height: 64, label: '64×64 (for detail)' },
};

export const DEFAULT_SPRITE_SIZE = '32x32';
