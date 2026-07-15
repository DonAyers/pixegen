/**
 * Eval findings — the persistent knowledge base behind "ideal settings per
 * console target" (portable logic; file IO lives in src/node/eval-store.js).
 *
 * The loop (see eval/README.md):
 *   1. A trial pits the current **champion** (the target's recorded ideal
 *      settings, or its recipe-derived baseline) against a **challenger**
 *      (one deliberate settings change), same prompt + seed + model.
 *   2. A judge — human in the A/B Test tab, or an agent looking at the two
 *      PNGs from `pixegen eval run` — records the winner.
 *   3. The winner's settings become the target's ideal; every decisive
 *      trial bumps its confidence count. Next run starts from there.
 *
 * This is the evidence layer under `core/recipes.js`: recipes are the named,
 * shipped presets; ideals are the living per-target state the loop refines.
 * When an ideal stabilizes, promote it into a recipe (and drop the recipe's
 * `provisional` flag).
 */

import { RECIPES } from "./recipes.js";
import { getPaletteProfile } from "./palettes.js";

/** The settings axes a trial can vary — the canonical settings shape. */
export const SETTING_KEYS = [
    "model",
    "spriteSize",
    "pipeline",
    "downscale",
    "dithering",
    "outlines",
    "cleanup",
    "autoCrop",
    "preprocessing",
];

/** Empty knowledge base shape (version-tagged for future migrations). */
export function emptyFindings() {
    return { version: 1, ideal: {}, trials: [] };
}

/** Keep only known setting keys, in canonical order. */
export function normalizeSettings(settings = {}) {
    const out = {};
    for (const key of SETTING_KEYS) {
        if (settings[key] !== undefined) out[key] = settings[key];
    }
    return out;
}

/**
 * Baseline settings for a target before any trials exist: the first recipe
 * targeting that palette profile, else sensible enhanced-pipeline defaults.
 * `flux` is the default model — the cheapest option, and per-model ideals
 * can diverge later by running trials with a different model.
 */
export function baseSettingsForTarget(target) {
    const recipe = Object.values(RECIPES).find((r) => r.consoleId === target);
    if (recipe) {
        return normalizeSettings({
            model: recipe.model,
            spriteSize: recipe.spriteSize,
            pipeline: recipe.pipeline,
            downscale: recipe.downscale,
            dithering: recipe.dithering,
            outlines: recipe.outlines,
            cleanup: recipe.cleanup,
            autoCrop: recipe.autoCrop,
            preprocessing:
                typeof recipe.preprocessing === "string"
                    ? recipe.preprocessing
                    : "standard",
        });
    }
    const profile = getPaletteProfile(target);
    return {
        model: "flux",
        spriteSize: profile.defaultScale,
        pipeline: "enhanced",
        dithering: null,
        outlines: true,
        cleanup: true,
        preprocessing: "standard",
    };
}

/**
 * The current best-known settings for a target: recorded ideal if any,
 * else the baseline. Returns `{ settings, trials, source }` where source is
 * 'ideal' or 'baseline'.
 */
export function idealSettingsForTarget(findings, target) {
    const recorded = findings?.ideal?.[target];
    if (recorded?.settings) {
        return {
            settings: { ...baseSettingsForTarget(target), ...recorded.settings },
            trials: recorded.trials || 0,
            source: "ideal",
        };
    }
    return {
        settings: baseSettingsForTarget(target),
        trials: 0,
        source: "baseline",
    };
}

/** Generate a short unique trial id. */
export function newTrialId(now = Date.now()) {
    return `t${now.toString(36)}${Math.floor(Math.random() * 1296)
        .toString(36)
        .padStart(2, "0")}`;
}

/**
 * Append a pending (unjudged) trial. Returns the trial object.
 *
 * @param {object} findings - Mutated in place
 * @param {object} spec - { target, prompt, seed, model, a, b, source }
 */
export function addPendingTrial(findings, spec) {
    const trial = {
        id: newTrialId(),
        date: new Date().toISOString(),
        target: spec.target,
        prompt: spec.prompt,
        seed: spec.seed,
        model: spec.model,
        a: normalizeSettings(spec.a),
        b: normalizeSettings(spec.b),
        winner: null,
        notes: spec.notes || "",
        source: spec.source || "cli",
    };
    findings.trials.push(trial);
    return trial;
}

/**
 * Record a verdict for a trial and update the target's ideal.
 *
 * Rule: a decisive winner's settings become the target's ideal (in the
 * champion/challenger loop side A *is* the current ideal, so "A wins" keeps
 * it and bumps confidence; "B wins" crowns the challenger). Ties record the
 * trial without changing the ideal.
 *
 * @param {object} findings - Mutated in place
 * @param {string} trialId
 * @param {'a'|'b'|'tie'} winner
 * @param {string} [notes]
 * @returns {{ trial: object, ideal: object|null }}
 * @throws {Error} On unknown trial id or invalid winner
 */
export function recordVerdict(findings, trialId, winner, notes = "") {
    if (!["a", "b", "tie"].includes(winner)) {
        throw new Error(`Invalid winner "${winner}" — use a, b, or tie.`);
    }
    const trial = findings.trials.find((t) => t.id === trialId);
    if (!trial) {
        throw new Error(
            `Unknown trial "${trialId}". Pending trials: ${
                findings.trials
                    .filter((t) => !t.winner)
                    .map((t) => t.id)
                    .join(", ") || "(none)"
            }`,
        );
    }

    trial.winner = winner;
    if (notes) trial.notes = trial.notes ? `${trial.notes}\n${notes}` : notes;
    trial.judgedAt = new Date().toISOString();

    if (winner === "tie") {
        return { trial, ideal: findings.ideal[trial.target] || null };
    }

    const prev = findings.ideal[trial.target];
    findings.ideal[trial.target] = {
        settings: normalizeSettings(trial[winner]),
        trials: (prev?.trials || 0) + 1,
        updatedAt: trial.judgedAt,
        lastTrialId: trial.id,
    };
    return { trial, ideal: findings.ideal[trial.target] };
}

/**
 * Record a complete, already-judged trial in one step (the UI path — the
 * human clicked a winner button with both configs in hand).
 */
export function recordJudgedTrial(findings, spec, winner, notes = "") {
    const trial = addPendingTrial(findings, spec);
    return recordVerdict(findings, trial.id, winner, notes);
}

/**
 * Human/agent-readable summary of the knowledge base.
 * @param {object} findings
 * @param {string} [target] - Limit to one target
 */
export function summarizeFindings(findings, target) {
    const lines = [];
    const targets = target ? [target] : Object.keys(findings.ideal);

    if (targets.length === 0) {
        lines.push("No ideals recorded yet — every target is at its baseline.");
    }
    for (const t of targets) {
        const { settings, trials, source } = idealSettingsForTarget(findings, t);
        lines.push(
            `${t}: ${source === "ideal" ? `ideal (${trials} decisive trial${trials === 1 ? "" : "s"})` : "baseline (no trials yet)"}`,
        );
        lines.push(`  ${JSON.stringify(settings)}`);
    }

    const pending = findings.trials.filter((t) => !t.winner);
    if (pending.length > 0) {
        lines.push(`Pending trials awaiting judgment:`);
        for (const t of pending) {
            lines.push(`  ${t.id} (${t.target}) — "${t.prompt}"`);
        }
    }

    const judged = findings.trials.filter(
        (t) => t.winner && (!target || t.target === target),
    );
    if (judged.length > 0) {
        lines.push(`Recent verdicts:`);
        for (const t of judged.slice(-8)) {
            lines.push(
                `  ${t.id} (${t.target}) winner=${t.winner}${t.notes ? ` — ${t.notes.split("\n")[0]}` : ""}`,
            );
        }
    }
    return lines.join("\n");
}
