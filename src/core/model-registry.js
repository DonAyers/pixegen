/**
 * Live + curated model catalog (portable) — docs/Next-Phase.md §7.
 *
 * Two layers merged at read time:
 *   1. Live layer — Pollinations' GET /image/models is the source of truth
 *      for what exists, what's paid-only, and reference-image capacity.
 *      Fetch + caching live in src/node/live-models.js (this module stays
 *      env/network-free so the browser can import it).
 *   2. Curated overlay — judgment-call metadata the API can't provide:
 *      speed tier, pixel-art suitability (fed by the eval loop as Phase 1
 *      verdicts land), and which models honor `transparent=true` (documented
 *      by Pollinations but absent from the models endpoint).
 *
 * A model missing from the overlay still works — it just carries no
 * suitability signal and defaults to conservative capability flags.
 */

import { POLLINATIONS_MODELS } from "./models.js";

/**
 * Models documented by Pollinations as honoring `transparent=true`.
 * The live endpoint doesn't expose this, so it's curated knowledge.
 */
export const POLLINATIONS_TRANSPARENT_MODELS = new Set([
    "gptimage",
    "gptimage-large",
    "gpt-image-2",
]);

/**
 * Curated overlay, keyed by live model `name`. `pixelArtSuitability` is
 * 1–5 or null (= not yet evaluated); it should track eval/findings.json
 * verdicts, not vibes. `speedTier`: fast | standard | slow.
 */
export const CURATED_OVERLAY = {
    flux: { speedTier: "fast", pixelArtSuitability: null },
    zimage: { speedTier: "fast", pixelArtSuitability: null },
    klein: { speedTier: "fast", pixelArtSuitability: null },
    kontext: { speedTier: "standard", pixelArtSuitability: null },
    gptimage: { speedTier: "standard", pixelArtSuitability: null },
    "gptimage-large": { speedTier: "slow", pixelArtSuitability: null },
    "gpt-image-2": { speedTier: "slow", pixelArtSuitability: null },
    "nova-canvas": { speedTier: "standard", pixelArtSuitability: null },
    nanobanana: { speedTier: "standard", pixelArtSuitability: null },
    "nanobanana-pro": { speedTier: "slow", pixelArtSuitability: null },
    seedream: { speedTier: "standard", pixelArtSuitability: null },
};

/**
 * Normalize one live /image/models entry into the app's model shape.
 * Returns null for entries that aren't plain image generators (the live
 * catalog now includes video models).
 */
export function normalizeLiveModel(entry) {
    if (!entry || entry.category !== "image") return null;
    const out = entry.output_modalities || [];
    if (out.length > 0 && !out.includes("image")) return null;

    const overlay = CURATED_OVERLAY[entry.name] || {};
    return {
        id: entry.name,
        name: entry.title || entry.name,
        description: entry.description || "",
        cost: entry.paid_only ? "Paid" : "Free-tier",
        paidOnly: Boolean(entry.paid_only),
        supportsTransparent: POLLINATIONS_TRANSPARENT_MODELS.has(entry.name),
        supportsSeed: true,
        maxReferenceImages: entry.max_reference_images ?? 0,
        aliases: entry.aliases || [],
        brand: entry.brand || "",
        speedTier: overlay.speedTier || "standard",
        pixelArtSuitability: overlay.pixelArtSuitability ?? null,
        live: true,
    };
}

/**
 * Merge a live /image/models response into the app's Pollinations catalog.
 * Falls back to the static POLLINATIONS_MODELS list when the live data is
 * missing or unusable, so callers always get a catalog.
 *
 * @param {Array|null} liveEntries - Parsed live endpoint response
 * @returns {{ models: Array, source: "live"|"static" }}
 */
export function mergeModelCatalog(liveEntries) {
    if (Array.isArray(liveEntries) && liveEntries.length > 0) {
        const models = liveEntries
            .map(normalizeLiveModel)
            .filter(Boolean);
        if (models.length > 0) return { models, source: "live" };
    }
    const models = POLLINATIONS_MODELS.map((m) => ({
        ...m,
        speedTier: CURATED_OVERLAY[m.id]?.speedTier || "standard",
        pixelArtSuitability: CURATED_OVERLAY[m.id]?.pixelArtSuitability ?? null,
        live: false,
    }));
    return { models, source: "static" };
}

/**
 * Quality tiers — the "Auto" interface (§7): a caller states intent, the
 * registry picks the model. `quality` is the Pollinations quality param a
 * tier implies when the caller didn't set one explicitly.
 */
export const QUALITY_TIERS = {
    draft: {
        label: "Draft",
        description: "Fastest acceptable output for iterating on a concept",
        quality: "low",
    },
    standard: {
        label: "Standard",
        description: "Balanced default",
        quality: "medium",
    },
    best: {
        label: "Best",
        description: "Final asset — willing to pay/wait more",
        quality: "hd",
    },
};

/**
 * Per-tier model preference order. Deterministic and auditable on purpose;
 * these orderings are provisional until Phase 1 eval verdicts replace them
 * (a model with a recorded pixelArtSuitability outranks the static order).
 */
const TIER_PREFERENCES = {
    draft: ["flux", "zimage", "klein", "gptimage"],
    standard: ["gptimage", "zimage", "flux", "gptimage-large"],
    best: ["nanobanana-pro", "gptimage-large", "gpt-image-2", "seedream", "gptimage"],
};

/**
 * Parse an `auto` model id: "auto" → standard tier, "auto:best" → best.
 * @returns {string|null} tier name, or null if not an auto id
 */
export function parseAutoModel(id) {
    const match = /^auto(?::(\w+))?$/.exec(String(id || "").trim());
    if (!match) return null;
    const tier = match[1] || "standard";
    if (!QUALITY_TIERS[tier]) {
        throw new Error(
            `Unknown quality tier "${tier}" — use ${Object.keys(QUALITY_TIERS).join(", ")}.`,
        );
    }
    return tier;
}

/**
 * Resolve a quality tier to a concrete Pollinations model (§7's "Auto"):
 * filter to what this caller can actually use, then pick by evaluated
 * suitability first, tier preference order second.
 *
 * @param {string} tier - draft | standard | best
 * @param {Array} models - Catalog from mergeModelCatalog().models
 * @param {object} [constraints]
 * @param {boolean} [constraints.hasPaidKey=false] - Funded key configured
 * @param {boolean} [constraints.needsTransparent=false]
 * @param {boolean} [constraints.needsReferenceImages=false]
 * @returns {{ modelId: string, quality: string, model: object }}
 */
export function resolveAutoModel(tier, models, constraints = {}) {
    const {
        hasPaidKey = false,
        needsTransparent = false,
        needsReferenceImages = false,
    } = constraints;
    const tierInfo = QUALITY_TIERS[tier];
    if (!tierInfo) {
        throw new Error(
            `Unknown quality tier "${tier}" — use ${Object.keys(QUALITY_TIERS).join(", ")}.`,
        );
    }

    const candidates = models.filter(
        (m) =>
            (hasPaidKey || !m.paidOnly) &&
            (!needsTransparent || m.supportsTransparent) &&
            (!needsReferenceImages || (m.maxReferenceImages ?? 0) > 0),
    );
    if (candidates.length === 0) {
        throw new Error(
            `No model satisfies tier=${tier}${needsTransparent ? " + transparent" : ""}${needsReferenceImages ? " + reference images" : ""}${hasPaidKey ? "" : " on the free tier"}.`,
        );
    }

    // Evaluated suitability beats the static preference order (but draft
    // never picks a slow model, whatever its rating).
    const evaluated = candidates
        .filter((m) => m.pixelArtSuitability !== null)
        .filter((m) => tier !== "draft" || m.speedTier !== "slow")
        .sort((x, y) => y.pixelArtSuitability - x.pixelArtSuitability);
    if (evaluated.length > 0 && evaluated[0].pixelArtSuitability >= 3) {
        return {
            modelId: evaluated[0].id,
            quality: tierInfo.quality,
            model: evaluated[0],
        };
    }

    const byId = new Map(candidates.map((m) => [m.id, m]));
    for (const id of TIER_PREFERENCES[tier]) {
        if (byId.has(id)) {
            return { modelId: id, quality: tierInfo.quality, model: byId.get(id) };
        }
    }
    return {
        modelId: candidates[0].id,
        quality: tierInfo.quality,
        model: candidates[0],
    };
}
