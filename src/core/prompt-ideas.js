/**
 * Random prompt idea generator (portable, no DOM, no network).
 *
 * Composes "something cool and random" prompts from curated pools:
 * subject/gear/setting templates crossed with an era-appropriate
 * "inspired by <classic game>" tag chosen from the selected palette
 * profile's system. NES picks from NES classics (Mega Man, Zelda,
 * Metroid...), Genesis from Genesis classics (Sonic, Streets of Rage...),
 * and so on; the 'none' profile draws from modern indie pixel-art games.
 *
 * Used by the 🎲 buttons next to every prompt input in the UI and by the
 * `pixegen idea` CLI command. Pure and rng-injectable, so it's trivially
 * testable and could later be swapped/augmented with an LLM-backed
 * expander without touching callers.
 */

// ─── Per-system inspiration pools ────────────────────────────────────────────
// Keyed by PALETTE_PROFILES id. "inspired by X" style references only.

export const GAME_POOLS = {
    nes: [
        "Mega Man 2",
        "The Legend of Zelda",
        "Metroid",
        "Castlevania",
        "Super Mario Bros. 3",
        "Contra",
        "Kirby's Adventure",
        "Ninja Gaiden",
        "Kid Icarus",
        "Blaster Master",
        "Bionic Commando",
        "DuckTales",
    ],
    snes: [
        "Chrono Trigger",
        "Super Metroid",
        "The Legend of Zelda: A Link to the Past",
        "Mega Man X",
        "Secret of Mana",
        "Final Fantasy VI",
        "Super Castlevania IV",
        "EarthBound",
        "Donkey Kong Country",
        "Super Mario World",
        "Star Fox",
        "Terranigma",
    ],
    genesis: [
        "Sonic the Hedgehog 2",
        "Streets of Rage 2",
        "Golden Axe",
        "Shinobi III",
        "Gunstar Heroes",
        "Phantasy Star IV",
        "Vectorman",
        "Ecco the Dolphin",
        "Comix Zone",
        "Ristar",
        "ToeJam & Earl",
        "Rocket Knight Adventures",
    ],
    gameboy: [
        "Pokémon Red",
        "The Legend of Zelda: Link's Awakening",
        "Kirby's Dream Land",
        "Wario Land",
        "Metroid II",
        "Donkey Kong '94",
        "Mole Mania",
        "Gargoyle's Quest",
        "Final Fantasy Adventure",
        "Kid Dracula",
    ],
    c64: [
        "The Last Ninja",
        "Turrican",
        "Impossible Mission",
        "Boulder Dash",
        "Wizball",
        "Bruce Lee",
        "Maniac Mansion",
        "Bubble Bobble",
        "Creatures",
        "Mayhem in Monsterland",
    ],
    atari: [
        "Pitfall!",
        "Adventure",
        "Berzerk",
        "Yars' Revenge",
        "H.E.R.O.",
        "River Raid",
        "Joust",
        "Ms. Pac-Man",
        "Space Invaders",
        "Frostbite",
    ],
    // The raw/no-palette profile leans modern indie pixel art.
    none: [
        "Celeste",
        "Shovel Knight",
        "Hyper Light Drifter",
        "Dead Cells",
        "Stardew Valley",
        "Undertale",
        "Hollow Knight",
        "Owlboy",
        "Blasphemous",
        "Sea of Stars",
        "CrossCode",
        "Eastward",
    ],
};

// ─── Building blocks ─────────────────────────────────────────────────────────

const ADJECTIVES = [
    "heroic",
    "tiny",
    "armored",
    "spectral",
    "grumpy",
    "cybernetic",
    "masked",
    "ancient",
    "mutant",
    "gallant",
    "sneaky",
    "clockwork",
    "feral",
    "cursed",
    "gilded",
    "radioactive",
];

const ARCHETYPES = [
    "knight",
    "robot boy",
    "space bounty hunter",
    "ninja",
    "wizard apprentice",
    "skeleton pirate",
    "slime monster",
    "forest fairy",
    "mech pilot",
    "treasure hunter",
    "vampire hunter",
    "frog warrior",
    "star pilot",
    "alchemist",
    "yeti monk",
    "desert nomad",
];

const GEAR = [
    "an arm cannon",
    "a glowing sword",
    "a jetpack",
    "a boomerang",
    "a chain whip",
    "a magic staff",
    "dual daggers",
    "a rocket hammer",
    "a plasma pistol",
    "an enchanted shield",
    "a grappling hook",
    "a spell book",
];

const ENEMIES = [
    "patrolling robot sentry",
    "winged imp",
    "giant beetle",
    "haunted suit of armor",
    "cactus critter",
    "laser turret crab",
    "goo dragon",
    "mushroom brawler",
    "ice golem",
    "sand serpent",
];

const BOSS_TRAITS = [
    "covered in spikes",
    "with a single giant eye",
    "wreathed in flames",
    "made of living crystal",
    "with detachable fists",
    "half machine, half beast",
];

const SETTINGS = [
    "sunny grassland village",
    "ancient desert ruins",
    "haunted swamp",
    "volcanic fortress",
    "crystal ice cavern",
    "underwater temple",
    "sky-island meadow",
    "overgrown laboratory",
    "neon rooftop cityscape",
    "mushroom forest",
    "clockwork factory interior",
    "sunken pirate cove",
    "autumn mountain trail",
    "royal castle courtyard",
    "toxic sewer tunnels",
];

const SETTING_VIBES = [
    "lush and colorful",
    "gloomy and atmospheric",
    "sun-baked and dusty",
    "frozen and glittering",
    "neon-lit at night",
    "overgrown with vines",
    "storm-battered",
    "peaceful and idyllic",
];

// ─── Generator ───────────────────────────────────────────────────────────────

function pick(arr, rng) {
    return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate one random prompt idea for the given system and asset kind.
 *
 * @param {string} profileId - PALETTE_PROFILES key ('nes', 'genesis', ...);
 *   unknown ids draw from every pool combined
 * @param {'sprite'|'tileset'} kind - Subject prompt vs tileset-theme prompt
 * @param {() => number} rng - Random source in [0,1); injectable for tests
 * @returns {string}
 */
export function randomPromptIdea(profileId = "nes", kind = "sprite", rng = Math.random) {
    const pool = GAME_POOLS[profileId] || Object.values(GAME_POOLS).flat();
    const game = pick(pool, rng);

    if (kind === "tileset") {
        return `${pick(SETTINGS, rng)}, ${pick(SETTING_VIBES, rng)}, inspired by ${game}`;
    }

    const roll = rng();
    if (roll < 0.5) {
        // Hero with gear — the classic protagonist shape.
        return `a ${pick(ADJECTIVES, rng)} ${pick(ARCHETYPES, rng)} with ${pick(GEAR, rng)}, inspired by ${game}`;
    }
    if (roll < 0.8) {
        // Enemy/critter.
        return `a ${pick(ADJECTIVES, rng)} ${pick(ENEMIES, rng)}, inspired by ${game}`;
    }
    // Boss monster.
    return `a boss monster ${pick(BOSS_TRAITS, rng)}, inspired by ${game}`;
}
