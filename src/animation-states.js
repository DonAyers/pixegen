/**
 * Animation state and view/pose definitions for 2D platformer sprite generation.
 *
 * Each animation state describes a standard game animation with:
 * - Prompt description for AI image generation
 * - Typical frame count for the animation cycle
 * - Whether the animation loops
 * - Per-frame prompt hints for multi-frame generation
 *
 * Each view describes a camera angle / character facing direction.
 */

// ─── Views / Poses ───────────────────────────────────────────────────────────

export const VIEWS = {
  'side': {
    id: 'side',
    name: 'Side',
    promptDesc: 'side view, profile view, facing right',
    shortDesc: 'profile',
  },
  'front': {
    id: 'front',
    name: 'Front',
    promptDesc: 'front view, facing the camera',
    shortDesc: 'front-facing',
  },
  'back': {
    id: 'back',
    name: 'Back',
    promptDesc: 'back view, facing away from camera',
    shortDesc: 'rear',
  },
  '3/4-front': {
    id: '3/4-front',
    name: '¾ Front',
    promptDesc: 'three-quarter view, angled slightly toward camera',
    shortDesc: '¾ front',
  },
  '3/4-back': {
    id: '3/4-back',
    name: '¾ Back',
    promptDesc: 'three-quarter rear view, angled slightly away from camera',
    shortDesc: '¾ rear',
  },
  'top-down': {
    id: 'top-down',
    name: 'Top-Down',
    promptDesc: 'top-down view, seen from above, bird-eye view',
    shortDesc: 'top-down',
  },
};

export const DEFAULT_VIEW = 'side';

// ─── Animation States ────────────────────────────────────────────────────────

export const ANIMATION_STATES = {
  'idle': {
    id: 'idle',
    name: 'Idle',
    category: 'basic',
    frameCount: 2,
    loop: true,
    promptDesc: 'standing idle pose, neutral stance, relaxed',
    frameHints: [
      'standing still, arms at sides',
      'standing still, slight breathing motion',
    ],
  },
  'walk': {
    id: 'walk',
    name: 'Walk',
    category: 'movement',
    frameCount: 4,
    loop: true,
    promptDesc: 'walking pose, mid-stride',
    frameHints: [
      'walking, right foot forward, left arm forward (contact pose)',
      'walking, right leg passing under body (passing pose)',
      'walking, left foot forward, right arm forward (contact pose)',
      'walking, left leg passing under body (passing pose)',
    ],
  },
  'run': {
    id: 'run',
    name: 'Run',
    category: 'movement',
    frameCount: 4,
    loop: true,
    promptDesc: 'running pose, dynamic stride',
    frameHints: [
      'running, right foot striking ground, body leaning forward',
      'running, right foot pushing off, both feet near ground',
      'running, left foot striking ground, body leaning forward',
      'running, left foot pushing off, both feet near ground',
    ],
  },
  'jump': {
    id: 'jump',
    name: 'Jump',
    category: 'movement',
    frameCount: 3,
    loop: false,
    promptDesc: 'jumping pose, airborne',
    frameHints: [
      'crouching down, preparing to jump, knees bent',
      'jumping upward, arms raised, legs tucked',
      'at peak of jump, arms up, body extended',
    ],
  },
  'fall': {
    id: 'fall',
    name: 'Fall',
    category: 'movement',
    frameCount: 2,
    loop: false,
    promptDesc: 'falling pose, descending through air',
    frameHints: [
      'falling, arms up, legs dangling',
      'falling, bracing for landing, arms out',
    ],
  },
  'attack': {
    id: 'attack',
    name: 'Attack',
    category: 'combat',
    frameCount: 3,
    loop: false,
    promptDesc: 'attack pose, striking motion',
    frameHints: [
      'winding up attack, weapon pulled back',
      'mid-swing, weapon extended, dynamic motion',
      'follow-through, weapon past target, recovery',
    ],
  },
  'hurt': {
    id: 'hurt',
    name: 'Hurt',
    category: 'combat',
    frameCount: 2,
    loop: false,
    promptDesc: 'hurt pose, hit reaction, flinching',
    frameHints: [
      'recoiling from hit, body leaning back, pained expression',
      'recovering from hit, slightly hunched',
    ],
  },
  'death': {
    id: 'death',
    name: 'Death',
    category: 'combat',
    frameCount: 3,
    loop: false,
    promptDesc: 'death animation, collapsing',
    frameHints: [
      'staggering, losing balance',
      'falling over, body going limp',
      'lying on ground, defeated, collapsed',
    ],
  },
  'crouch': {
    id: 'crouch',
    name: 'Crouch',
    category: 'movement',
    frameCount: 1,
    loop: false,
    promptDesc: 'crouching pose, ducking low, knees bent',
    frameHints: [
      'crouching low, knees bent, compact pose',
    ],
  },
  'climb': {
    id: 'climb',
    name: 'Climb',
    category: 'movement',
    frameCount: 2,
    loop: true,
    promptDesc: 'climbing pose, gripping ladder or wall',
    frameHints: [
      'climbing, right hand up, left knee raised',
      'climbing, left hand up, right knee raised',
    ],
  },
  'dash': {
    id: 'dash',
    name: 'Dash',
    category: 'movement',
    frameCount: 2,
    loop: false,
    promptDesc: 'dashing forward, burst of speed, leaning far forward',
    frameHints: [
      'dashing, body low and stretched forward, speed lines',
      'mid-dash, trailing leg extended back, arms streamlined',
    ],
  },
  'cast': {
    id: 'cast',
    name: 'Cast Spell',
    category: 'combat',
    frameCount: 3,
    loop: false,
    promptDesc: 'casting a spell, magical pose, hands glowing',
    frameHints: [
      'raising hands, gathering magical energy',
      'arms extended, casting spell, magic particles',
      'spell released, follow-through pose, magic fading',
    ],
  },
};

export const DEFAULT_STATE = 'idle';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the prompt description for a specific frame of an animation state.
 * @param {string} stateId - Animation state ID
 * @param {number} frameIndex - 0-based frame index
 * @returns {string} Frame-specific prompt hint
 */
export function getFrameHint(stateId, frameIndex) {
  const state = ANIMATION_STATES[stateId];
  if (!state) return '';
  const hints = state.frameHints;
  return hints[frameIndex % hints.length] || state.promptDesc;
}

/**
 * Build a combined pose description from animation state + view + frame.
 * This is fed into image-service's buildPrompt as poseDesc.
 * @param {string} stateId - Animation state ID
 * @param {string} viewId - View ID
 * @param {number} frameIndex - 0-based frame number
 * @returns {string} Combined prompt fragment
 */
export function buildPoseDescription(stateId, viewId, frameIndex = 0) {
  const state = ANIMATION_STATES[stateId];
  const view = VIEWS[viewId];
  if (!state || !view) return '';

  const frameHint = getFrameHint(stateId, frameIndex);
  return `${view.promptDesc}, ${frameHint}`;
}

/**
 * Get state categories for grouped display.
 * @returns {{ category: string, states: Array }[]}
 */
export function getStatesByCategory() {
  const categories = {};
  for (const state of Object.values(ANIMATION_STATES)) {
    if (!categories[state.category]) {
      categories[state.category] = [];
    }
    categories[state.category].push(state);
  }

  const order = ['basic', 'movement', 'combat'];
  return order
    .filter(cat => categories[cat])
    .map(cat => ({
      category: cat,
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
      states: categories[cat],
    }));
}
