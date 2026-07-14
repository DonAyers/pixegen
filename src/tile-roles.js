/**
 * Tile role definitions for tileset generation.
 *
 * Parallel to animation-states.js: each tile role describes a standard
 * autotile-relevant terrain/prop role with a prompt hint fed into
 * image-service's tile grid prompt builder, the same way frameHints are
 * used for animation frames.
 */

// ─── Tile Roles ──────────────────────────────────────────────────────────────

export const TILE_ROLES = {
  'grass': {
    id: 'grass',
    name: 'Grass',
    category: 'terrain',
    promptHint: 'flat grass terrain tile, seamless tileable texture, viewed from directly above',
  },
  'dirt': {
    id: 'dirt',
    name: 'Dirt',
    category: 'terrain',
    promptHint: 'flat dirt/soil terrain tile, seamless tileable texture, viewed from directly above',
  },
  'sand': {
    id: 'sand',
    name: 'Sand',
    category: 'terrain',
    promptHint: 'flat sand terrain tile, seamless tileable texture, viewed from directly above',
  },
  'water': {
    id: 'water',
    name: 'Water',
    category: 'terrain',
    promptHint: 'flat water terrain tile, seamless tileable texture, viewed from directly above',
  },
  'stone': {
    id: 'stone',
    name: 'Stone',
    category: 'terrain',
    promptHint: 'flat stone/rock floor terrain tile, seamless tileable texture, viewed from directly above',
  },
  'path': {
    id: 'path',
    name: 'Path',
    category: 'terrain',
    promptHint: 'flat stone path/walkway tile, seamless tileable texture, viewed from directly above',
  },
  'grass-dirt-edge-n': {
    id: 'grass-dirt-edge-n',
    name: 'Grass→Dirt Edge (N)',
    category: 'edge',
    promptHint: 'autotile edge tile, grass on the south half transitioning to dirt on the north half',
  },
  'grass-dirt-edge-s': {
    id: 'grass-dirt-edge-s',
    name: 'Grass→Dirt Edge (S)',
    category: 'edge',
    promptHint: 'autotile edge tile, grass on the north half transitioning to dirt on the south half',
  },
  'grass-dirt-edge-e': {
    id: 'grass-dirt-edge-e',
    name: 'Grass→Dirt Edge (E)',
    category: 'edge',
    promptHint: 'autotile edge tile, grass on the west half transitioning to dirt on the east half',
  },
  'grass-dirt-edge-w': {
    id: 'grass-dirt-edge-w',
    name: 'Grass→Dirt Edge (W)',
    category: 'edge',
    promptHint: 'autotile edge tile, grass on the east half transitioning to dirt on the west half',
  },
  'water-corner-ne': {
    id: 'water-corner-ne',
    name: 'Water Corner (NE)',
    category: 'corner',
    promptHint: 'autotile corner tile, water meeting land at the northeast corner, land fills the rest',
  },
  'water-corner-nw': {
    id: 'water-corner-nw',
    name: 'Water Corner (NW)',
    category: 'corner',
    promptHint: 'autotile corner tile, water meeting land at the northwest corner, land fills the rest',
  },
  'water-corner-se': {
    id: 'water-corner-se',
    name: 'Water Corner (SE)',
    category: 'corner',
    promptHint: 'autotile corner tile, water meeting land at the southeast corner, land fills the rest',
  },
  'water-corner-sw': {
    id: 'water-corner-sw',
    name: 'Water Corner (SW)',
    category: 'corner',
    promptHint: 'autotile corner tile, water meeting land at the southwest corner, land fills the rest',
  },
  'prop-tree': {
    id: 'prop-tree',
    name: 'Tree',
    category: 'prop',
    promptHint: 'single tree prop sprite, centered in tile, top-down game asset',
  },
  'prop-rock': {
    id: 'prop-rock',
    name: 'Rock',
    category: 'prop',
    promptHint: 'single rock/boulder prop sprite, centered in tile, top-down game asset',
  },
  'prop-bush': {
    id: 'prop-bush',
    name: 'Bush',
    category: 'prop',
    promptHint: 'single bush/shrub prop sprite, centered in tile, top-down game asset',
  },
};

export const DEFAULT_ROLE = 'grass';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the prompt hint for a specific tile role.
 * @param {string} roleId - Tile role ID
 * @returns {string} Prompt hint, or empty string if the role is unknown
 */
export function getRoleHint(roleId) {
  const role = TILE_ROLES[roleId];
  return role ? role.promptHint : '';
}

/**
 * Get tile role categories for grouped display.
 * @returns {{ category: string, label: string, roles: Array }[]}
 */
export function getRolesByCategory() {
  const categories = {};
  for (const role of Object.values(TILE_ROLES)) {
    if (!categories[role.category]) {
      categories[role.category] = [];
    }
    categories[role.category].push(role);
  }

  const order = ['terrain', 'edge', 'corner', 'prop'];
  return order
    .filter(cat => categories[cat])
    .map(cat => ({
      category: cat,
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
      roles: categories[cat],
    }));
}
