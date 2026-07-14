#!/usr/bin/env node
/**
 * pixegen — generate retro pixel-art game assets from the command line.
 *
 * The scriptable counterpart of the browser UI (and the sibling of the MCP
 * server in bin/pixegen-mcp.js), built on the same portable core. Composable
 * in build scripts: writes PNG + JSON atlas files to --out, non-zero exit
 * codes on failure, progress on stderr only.
 *
 *   pixegen generate "a knight with a sword" --recipe nes-classic -o knight.png
 *   pixegen sheet "a knight" --anim walk --view side -o ./knight-walk/
 *   pixegen tileset "sunset desert ruins" --cols 4 --rows 4 -o ./desert/
 *   pixegen recipes | palettes | scales | models
 *
 * Set POLLINATIONS_API_KEY for paid models / higher rate limits (optional).
 */

import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { RECIPES, DEFAULT_RECIPE } from "../src/core/recipes.js";
import {
    PALETTE_PROFILES,
    SPRITE_SCALES,
} from "../src/core/palettes.js";
import { PROVIDERS } from "../src/core/models.js";
import { QUALITY_TIERS } from "../src/core/model-registry.js";
import { listProviderAdapters } from "../src/node/providers/index.js";
import {
    refreshLiveModels,
    getPollinationsCatalog,
    modelsCachePath,
} from "../src/node/live-models.js";
import { PREPROCESSING_PRESETS } from "../src/core/preprocess.js";
import {
    buildSheetModel,
    emitSheetMetadata,
    EXPORT_FORMATS,
} from "../src/core/exporters.js";
import {
    ANIMATION_STATES,
    VIEWS,
    buildPoseDescription,
} from "../src/animation-states.js";
import { TILE_ROLES, getRoleHint } from "../src/tile-roles.js";
import { randomPromptIdea } from "../src/core/prompt-ideas.js";
import { getPaletteProfile } from "../src/core/palettes.js";
import { upscaleRaster } from "../src/core/raster.js";
import {
    idealSettingsForTarget,
    addPendingTrial,
    recordVerdict,
    summarizeFindings,
    normalizeSettings,
} from "../src/core/eval-findings.js";
import {
    loadFindings,
    saveFindings,
    findingsPath,
} from "../src/node/eval-store.js";
import { encodePng, imageExtension } from "../src/node/png.js";
import { startRun, logFilePath } from "../src/node/run-log.js";
import {
    generateSprite,
    generateSheet,
    generateTileset,
    assembleGridRaster,
} from "../src/node/generate.js";

const log = (msg) => process.stderr.write(`[pixegen] ${msg}\n`);

const HELP = `pixegen — AI retro pixel-art asset generator (Pollinations-backed)

Usage:
  pixegen generate <prompt> [options]   Generate a single sprite PNG
  pixegen sheet <prompt> [options]      Generate an animation sprite sheet + atlas
  pixegen tileset <prompt> [options]    Generate a tile grid
  pixegen idea [options]                Print a random prompt idea (no network)
                                        -p <palette> picks the inspiration era,
                                        --tileset for a tileset theme,
                                        --count <n> for several at once
  pixegen recipes                       List recipes
  pixegen palettes                      List palette profiles
  pixegen scales                        List sprite scale presets
  pixegen models [--live]               List AI models (--live syncs the
                                        catalog from Pollinations first)

Eval loop (persistent ideal-settings knowledge base — see eval/README.md):
  pixegen eval status [--target nes]    Show per-target ideals + pending trials
  pixegen eval run --target nes --challenger '{"dithering":"bayer"}'
                                        Generate champion (current ideal) vs
                                        challenger side by side; writes
                                        a.png/b.png + a pending trial
        [--champion <json>]             Override the champion side too
        [--prompt <text>]               Fixed prompt (default: random idea)
  pixegen eval record <trialId> --winner a|b|tie [--notes <why>]
                                        Judge a trial; winner becomes the
                                        target's ideal settings

Common options:
  -r, --recipe <name>      Recipe (default: ${DEFAULT_RECIPE}); see 'pixegen recipes'
  -m, --model <id>         Model override, "model" or "provider:model"
                           (e.g. flux, openai:gpt-image-1 — see 'pixegen models').
                           "auto" or "auto:<tier>" resolves by intent instead
  -t, --tier <tier>        ${Object.keys(QUALITY_TIERS).join(" | ")} — shorthand for --model auto:<tier>
  -p, --palette <id>       Palette profile override (see 'pixegen palettes')
  -s, --size <WxH>         Sprite scale override, preset or custom (e.g. 32x32)
      --dither <mode>      '' or 'bayer' (enhanced pipeline)
      --preprocess <name>  ${Object.keys(PREPROCESSING_PRESETS).join(" | ")}
      --quality <tier>     low | medium | high | auto (passed to the provider)
      --seed <n>           Reproducible-ish seed (best-effort; OpenAI ignores it)
      --negative <text>    Negative prompt override
      --ref <url,...>      Reference image URL(s) for visual-cohesion
                           conditioning (only models with reference support)
      --no-outlines        Skip auto-outline pass
      --no-cleanup         Skip orphan-pixel cleanup
      --auto-crop          Crop to the subject before downscaling (single
                           sprites only) — big win when the model leaves the
                           subject small in the frame
      --no-auto-crop       Disable a recipe's auto-crop
      --no-parallel        Sheets/tilesets: fire batch requests one at a
                           time instead of concurrently
      --no-transparent     Don't request a transparent background
      --no-validate        Skip the post-generation validation gate (and retry)
      --strict             Exit 3 if validation still fails after the retry
      --save-source        Also write the raw AI image next to the output
  -o, --out <path>         Output file (generate) or directory (sheet/tileset)

Sheet options:
      --anim <state>       ${Object.keys(ANIMATION_STATES).join(" | ")}
      --view <view>        ${Object.keys(VIEWS).join(" | ")}
      --frames <n>         Frame count (default: the animation's standard count)
      --fps <n>            Atlas playback FPS (default 8)
  -f, --format <ids>       Metadata format(s), comma-separated (default phaser):
                           ${Object.keys(EXPORT_FORMATS).join(" | ")}
      --name <name>        Character/asset name used in filenames (default: sprite)

Tileset options:
      --cols <n> --rows <n>  Grid dimensions (default 4x4)
      --roles <a,b,...>      Tile roles row-major (${Object.keys(TILE_ROLES).slice(0, 5).join(", ")}, ...); cycles if short

Environment:
  POLLINATIONS_API_KEY   Optional; required for Pollinations' paid models
  OPENAI_API_KEY         Required for openai:* models (BYOK, billed by OpenAI)
  PIXEGEN_API_BASE       Override Pollinations base (default https://gen.pollinations.ai/image)
  OPENAI_BASE_URL        Override OpenAI base (default https://api.openai.com/v1)
  PIXEGEN_TIMEOUT_MS     Per-request timeout (default 120000; big strips on a
                         busy day can need more)
  PIXEGEN_MODELS_CACHE_PATH  Override the live model catalog cache location
  PIXEGEN_LOG_DIR        Structured JSONL run logs directory (default ./logs;
                         one line per event, one file per day)
  PIXEGEN_LOG=0          Disable run-log files
`;

const COMMON_OPTIONS = {
    recipe: { type: "string", short: "r" },
    model: { type: "string", short: "m" },
    tier: { type: "string", short: "t" },
    ref: { type: "string" },
    live: { type: "boolean" },
    palette: { type: "string", short: "p" },
    size: { type: "string", short: "s" },
    dither: { type: "string" },
    preprocess: { type: "string" },
    quality: { type: "string" },
    seed: { type: "string" },
    negative: { type: "string" },
    "no-outlines": { type: "boolean" },
    "no-cleanup": { type: "boolean" },
    "auto-crop": { type: "boolean" },
    "no-auto-crop": { type: "boolean" },
    "no-parallel": { type: "boolean" },
    "no-transparent": { type: "boolean" },
    "no-validate": { type: "boolean" },
    strict: { type: "boolean" },
    "save-source": { type: "boolean" },
    out: { type: "string", short: "o" },
    anim: { type: "string" },
    view: { type: "string" },
    frames: { type: "string" },
    fps: { type: "string" },
    format: { type: "string", short: "f" },
    name: { type: "string" },
    cols: { type: "string" },
    rows: { type: "string" },
    roles: { type: "string" },
    tileset: { type: "boolean" },
    count: { type: "string" },
    target: { type: "string" },
    challenger: { type: "string" },
    champion: { type: "string" },
    winner: { type: "string" },
    notes: { type: "string" },
    prompt: { type: "string" },
    help: { type: "boolean", short: "h" },
};

function parseCli(argv) {
    return parseArgs({
        args: argv,
        options: COMMON_OPTIONS,
        allowPositionals: true,
    });
}

function slugify(text) {
    return (
        text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || "sprite"
    );
}

function intOr(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? fallback : n;
}

/** Map CLI flags to generateSprite/Sheet/Tileset option overrides. */
function generationOptions(values, runLog) {
    if (values.tier && values.model) {
        throw new Error("--tier and --model are mutually exclusive — --tier means --model auto:<tier>.");
    }
    return {
        recipe: values.recipe || DEFAULT_RECIPE,
        model: values.tier ? `auto:${values.tier}` : values.model,
        consoleId: values.palette,
        spriteSize: values.size,
        dithering: values.dither,
        outlines: values["no-outlines"] ? false : undefined,
        cleanup: values["no-cleanup"] ? false : undefined,
        autoCrop: values["auto-crop"]
            ? true
            : values["no-auto-crop"]
              ? false
              : undefined,
        parallelBatches: values["no-parallel"] ? false : undefined,
        preprocessing: values.preprocess,
        quality: values.quality,
        seed: values.seed !== undefined ? intOr(values.seed, undefined) : undefined,
        transparent: !values["no-transparent"],
        negativePrompt: values.negative,
        referenceImages: values.ref
            ? values.ref.split(",").map((u) => u.trim()).filter(Boolean)
            : undefined,
        validate: !values["no-validate"],
        runLog,
        log,
    };
}

function reportValidation(result, strict) {
    if (result.issues.length > 0) {
        log(
            `WARNING: validation issues remain after ${result.attempts} attempt(s):`,
        );
        for (const issue of result.issues) log(`  - ${issue}`);
        if (strict) {
            log("failing due to --strict");
            process.exit(3);
        }
    }
}

function writeFile(path, data) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, data);
    log(`wrote ${path}`);
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdGenerate(prompt, values, runLog) {
    const outPath = values.out || `./${slugify(prompt)}.png`;
    const poseDesc =
        values.anim || values.view
            ? buildPoseDescription(
                  values.anim || "idle",
                  values.view || "side",
                  0,
              )
            : "";

    const result = await generateSprite(prompt, {
        ...generationOptions(values, runLog),
        poseDesc,
    });

    writeFile(outPath, encodePng(result.pixelData));
    if (values["save-source"]) {
        writeFile(
            `${outPath.replace(/\.png$/i, "")}.source.${imageExtension(result.sourceBuffer)}`,
            result.sourceBuffer,
        );
    }

    reportValidation(result, values.strict);
    console.log(
        `${outPath} (${result.spriteW}x${result.spriteH}, seed ${result.seedUsed})`,
    );
}

async function cmdSheet(prompt, values, runLog) {
    const animId = values.anim || "walk";
    const anim = ANIMATION_STATES[animId];
    if (!anim) {
        throw new Error(
            `Unknown animation "${animId}". Options: ${Object.keys(ANIMATION_STATES).join(", ")}`,
        );
    }
    const viewId = values.view || "side";
    const view = VIEWS[viewId];
    if (!view) {
        throw new Error(
            `Unknown view "${viewId}". Options: ${Object.keys(VIEWS).join(", ")}`,
        );
    }

    const frameCount = intOr(values.frames, anim.frameCount);
    const fps = intOr(values.fps, 8);
    const name = values.name || "sprite";
    const outDir = values.out || `./${slugify(prompt)}-${animId}`;

    const result = await generateSheet(prompt, {
        ...generationOptions(values, runLog),
        frameCount,
        viewDesc: view.promptDesc,
        animDesc: anim.promptDesc,
        frameHints: anim.frameHints,
    });

    const baseName = `${name}_${animId}`;
    const sheetRaster = assembleGridRaster(result.frames, frameCount);
    const pngName = `${baseName}.png`;

    writeFile(join(outDir, pngName), encodePng(sheetRaster));

    const { spriteW, spriteH } = result.frames[0];
    // Metadata in one or more engine formats (comma-separated --format).
    const formatIds = (values.format || "phaser")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
    const model = buildSheetModel(
        [
            {
                name: animId,
                fps,
                loop: anim.loop,
                frames: result.frames.map(() => ({
                    width: spriteW,
                    height: spriteH,
                })),
            },
        ],
        { imageName: pngName },
    );
    for (const formatId of formatIds) {
        const { content, ext } = emitSheetMetadata(formatId, model);
        writeFile(join(outDir, `${baseName}${ext}`), content);
    }

    result.frames.forEach((frame, i) => {
        writeFile(
            join(outDir, "frames", `${baseName}_${String(i).padStart(3, "0")}.png`),
            encodePng(frame.pixelData),
        );
    });

    if (values["save-source"]) {
        result.sourceBuffers.forEach((buf, i) => {
            writeFile(join(outDir, `source_${i}.${imageExtension(buf)}`), buf);
        });
    }

    reportValidation(result, values.strict);
    console.log(
        `${outDir} (${frameCount} frames, ${spriteW}x${spriteH}, seed ${result.seedUsed})`,
    );
}

async function cmdTileset(prompt, values, runLog) {
    const cols = intOr(values.cols, 4);
    const rows = intOr(values.rows, 4);
    const outDir = values.out || `./${slugify(prompt)}-tiles`;

    const roleIds = values.roles
        ? values.roles.split(",").map((r) => r.trim())
        : Object.keys(TILE_ROLES);
    const roleGrid = [];
    for (let i = 0; i < cols * rows; i++) {
        roleGrid.push(roleIds[i % roleIds.length]);
    }
    const tileHints = roleGrid.map((roleId) => getRoleHint(roleId));

    const result = await generateTileset(prompt, {
        ...generationOptions(values, runLog),
        cols,
        rows,
        tileHints,
    });

    const tilesetRaster = assembleGridRaster(result.tiles, cols);
    writeFile(join(outDir, "tileset.png"), encodePng(tilesetRaster));

    result.tiles.forEach((tile) => {
        writeFile(
            join(outDir, "tiles", `tile_${tile.gridX}_${tile.gridY}.png`),
            encodePng(tile.pixelData),
        );
    });

    const { spriteW, spriteH } = result.tiles[0];
    const manifest = {
        app: "PixelGen",
        image: "tileset.png",
        tileWidth: spriteW,
        tileHeight: spriteH,
        cols,
        rows,
        tiles: result.tiles.map((tile, i) => ({
            x: tile.gridX,
            y: tile.gridY,
            role: roleGrid[i],
            file: `tiles/tile_${tile.gridX}_${tile.gridY}.png`,
        })),
    };
    writeFile(join(outDir, "tileset.json"), JSON.stringify(manifest, null, 2));

    if (values["save-source"]) {
        result.sourceBuffers.forEach((buf, i) => {
            writeFile(join(outDir, `source_${i}.${imageExtension(buf)}`), buf);
        });
    }

    reportValidation(result, values.strict);
    console.log(
        `${outDir} (${cols}x${rows} tiles, ${spriteW}x${spriteH}, seed ${result.seedUsed})`,
    );
}

function cmdRecipes() {
    for (const [id, recipe] of Object.entries(RECIPES)) {
        console.log(
            `${id.padEnd(16)} ${recipe.label}${recipe.provisional ? " (provisional)" : ""}\n${" ".repeat(17)}${recipe.description}`,
        );
    }
}

function cmdPalettes() {
    for (const [id, p] of Object.entries(PALETTE_PROFILES)) {
        console.log(
            `${id.padEnd(10)} ${p.fullName} — ${p.colorDepth}, ${p.colorsPerSprite} per sprite (suggested scale: ${p.defaultScale})`,
        );
    }
}

function cmdScales() {
    for (const [id, s] of Object.entries(SPRITE_SCALES)) {
        console.log(`${id.padEnd(10)} ${s.label}`);
    }
    console.log('(any custom "WxH" up to 1024 is also accepted)');
}

// ─── Eval loop (champion vs challenger — see eval/README.md) ────────────────

function parseSettingsJson(label, text) {
    if (!text) return {};
    try {
        return normalizeSettings(JSON.parse(text));
    } catch (err) {
        throw new Error(`--${label} is not valid JSON: ${err.message}`);
    }
}

/**
 * Map a canonical settings object onto generateSprite options. Dithering
 * null becomes "" so it can *override* a recipe default through the
 * merge (which skips null/undefined); the pipeline treats "" as no dither.
 */
function settingsToGenerationOptions(settings, target) {
    return {
        model: settings.model,
        consoleId: target,
        spriteSize: settings.spriteSize,
        dithering: settings.dithering === null ? "" : settings.dithering,
        outlines: settings.outlines,
        cleanup: settings.cleanup,
        autoCrop: settings.autoCrop,
        preprocessing: settings.preprocessing,
    };
}

async function cmdEvalRun(values) {
    const target = values.target || "nes";
    getPaletteProfile(target); // throws with the valid list on a bad target

    if (!values.challenger) {
        throw new Error(
            `eval run needs a --challenger with the settings change to test, e.g. --challenger '{"dithering":"bayer"}'. Axes: model, spriteSize, pipeline, dithering, outlines, cleanup, preprocessing.`,
        );
    }

    const findings = loadFindings();
    const { settings: base, source } = idealSettingsForTarget(findings, target);
    const champion = {
        ...base,
        ...parseSettingsJson("champion", values.champion),
    };
    const challenger = {
        ...champion,
        ...parseSettingsJson("challenger", values.challenger),
    };

    if (JSON.stringify(champion) === JSON.stringify(challenger)) {
        throw new Error(
            "Challenger settings are identical to the champion — nothing to compare.",
        );
    }

    const prompt = values.prompt || randomPromptIdea(target, "sprite");
    const seed = values.seed !== undefined ? intOr(values.seed, 0) : Math.floor(Math.random() * 1e6);

    const trial = addPendingTrial(findings, {
        target,
        prompt,
        seed,
        model: challenger.model || champion.model,
        a: champion,
        b: challenger,
        source: "cli",
    });
    const outDir = values.out || `./eval-out/${trial.id}`;

    log(`trial ${trial.id}: target=${target} (champion from ${source})`);
    log(`prompt: ${prompt}`);

    // Validation retries would resample one side with a different seed and
    // make the comparison unfair — the judge sees exactly what came out.
    const runLog = startRun("eval", {
        trial: trial.id,
        target,
        prompt,
        seed,
        a: champion,
        b: challenger,
    });
    const sideResults = {};
    try {
        for (const [side, settings] of [
            ["a", champion],
            ["b", challenger],
        ]) {
            sideResults[side] = await generateSprite(prompt, {
                ...settingsToGenerationOptions(settings, target),
                seed,
                transparent: !values["no-transparent"],
                validate: false,
                runLog,
                log,
            });
        }
        runLog.end({ ok: true });
    } catch (err) {
        runLog.error(err, { trial: trial.id });
        runLog.end({ ok: false });
        err.runLogPath = logFilePath();
        throw err;
    }

    const files = [];
    for (const side of ["a", "b"]) {
        const result = sideResults[side];
        const pngPath = join(outDir, `${side}.png`);
        writeFile(pngPath, encodePng(result.pixelData));
        // Judging preview: nearest-neighbor upscale to ~256-512px so the
        // verdict can be made by looking at the file directly.
        const factor = Math.max(
            1,
            Math.round(256 / Math.max(result.pixelData.width, 1)),
        );
        writeFile(
            join(outDir, `${side}_preview.png`),
            encodePng(upscaleRaster(result.pixelData, factor)),
        );
        writeFile(
            join(outDir, `${side}.source.${imageExtension(result.sourceBuffer)}`),
            result.sourceBuffer,
        );
        files.push(pngPath);
    }
    writeFile(
        join(outDir, "trial.json"),
        JSON.stringify(
            { ...trial, files: { a: "a.png", b: "b.png" } },
            null,
            2,
        ),
    );

    saveFindings(findings);

    console.log(`Trial ${trial.id} generated:`);
    console.log(`  A (champion):   ${files[0]}  ${JSON.stringify(champion)}`);
    console.log(`  B (challenger): ${files[1]}  ${JSON.stringify(challenger)}`);
    console.log(
        `Look at ${join(outDir, "a_preview.png")} and ${join(outDir, "b_preview.png")} (upscaled for judging), then record:\n  pixegen eval record ${trial.id} --winner a|b|tie --notes "<why>"`,
    );
}

function cmdEvalRecord(trialId, values) {
    if (!trialId) {
        throw new Error("eval record needs a trial id (see 'pixegen eval status').");
    }
    if (!values.winner) {
        throw new Error("eval record needs --winner a|b|tie.");
    }
    const findings = loadFindings();
    const { trial, ideal } = recordVerdict(
        findings,
        trialId,
        values.winner,
        values.notes || "",
    );
    saveFindings(findings);

    console.log(
        `Recorded: trial ${trial.id} (${trial.target}) winner=${trial.winner}`,
    );
    if (ideal) {
        console.log(
            `Ideal for ${trial.target} is now (${ideal.trials} decisive trial${ideal.trials === 1 ? "" : "s"}):`,
        );
        console.log(`  ${JSON.stringify(ideal.settings)}`);
    } else {
        console.log(`Tie — ideal for ${trial.target} unchanged.`);
    }
    console.log(`Saved to ${findingsPath()}`);
}

function cmdEvalStatus(values) {
    const findings = loadFindings();
    console.log(summarizeFindings(findings, values.target));
    console.log(`\nKnowledge base: ${findingsPath()}`);
}

function cmdIdea(values) {
    const kind = values.tileset ? "tileset" : "sprite";
    const count = Math.max(1, Math.min(20, intOr(values.count, 1)));
    for (let i = 0; i < count; i++) {
        console.log(randomPromptIdea(values.palette || "nes", kind));
    }
}

async function cmdModels(values = {}) {
    if (values.live) {
        log("syncing model catalog from Pollinations...");
        await refreshLiveModels();
        log(`cached at ${modelsCachePath()}`);
    }

    const adapters = new Map(
        listProviderAdapters().map((a) => [a.id, a]),
    );
    for (const [providerId, provider] of Object.entries(PROVIDERS)) {
        const adapter = adapters.get(providerId);
        const configured = adapter ? adapter.isConfigured() : false;
        const keyNote = provider.keyOptional
            ? `${provider.keyEnv} optional`
            : `${provider.keyEnv} required${configured ? ", configured" : ", NOT set"}`;

        // Pollinations models come from the merged live+curated catalog
        // (cached live data when present, static fallback otherwise).
        let models = provider.models;
        let sourceNote = "";
        if (providerId === "pollinations") {
            const catalog = getPollinationsCatalog();
            models = catalog.models;
            sourceNote =
                catalog.source === "live"
                    ? `, catalog synced ${new Date(catalog.fetchedAt).toISOString()}`
                    : ", static catalog — run 'pixegen models --live' to sync";
        }

        console.log(`${provider.name} (${keyNote}${sourceNote})`);
        for (const m of models) {
            const refNote =
                (m.maxReferenceImages ?? 0) > 0
                    ? ` [refs:${m.maxReferenceImages}]`
                    : "";
            console.log(
                `  ${`${providerId}:${m.id}`.padEnd(28)} ${m.name} — ${m.description}${m.paidOnly ? " [paid key]" : " [free tier]"}${m.supportsTransparent ? " [transparent bg]" : ""}${m.supportsSeed === false ? " [no seed]" : ""}${refNote}`,
            );
        }
    }
    console.log(
        `\n"auto" picks a model by tier: ${Object.entries(QUALITY_TIERS)
            .map(([id, t]) => `auto:${id} (${t.description.toLowerCase()})`)
            .join(", ")}.`,
    );
}

// ─── Entry ───────────────────────────────────────────────────────────────────

async function main() {
    const [command, ...rest] = process.argv.slice(2);
    const listCommands = {
        recipes: cmdRecipes,
        palettes: cmdPalettes,
        scales: cmdScales,
    };

    if (!command || command === "help" || command === "--help" || command === "-h") {
        console.log(HELP);
        return;
    }

    if (listCommands[command]) {
        listCommands[command]();
        return;
    }

    if (command === "models") {
        const { values } = parseCli(rest);
        await cmdModels(values);
        return;
    }

    if (command === "idea") {
        const { values } = parseCli(rest);
        cmdIdea(values);
        return;
    }

    if (command === "eval") {
        const [sub, ...evalRest] = rest;
        const { values, positionals } = parseCli(evalRest);
        if (sub === "run") {
            await cmdEvalRun(values);
        } else if (sub === "record") {
            cmdEvalRecord(positionals[0], values);
        } else if (sub === "status") {
            cmdEvalStatus(values);
        } else {
            console.error(
                `Unknown eval subcommand "${sub || ""}" — use run, record, or status.\n`,
            );
            process.exit(2);
        }
        return;
    }

    const genCommands = {
        generate: cmdGenerate,
        sheet: cmdSheet,
        tileset: cmdTileset,
    };
    const handler = genCommands[command];
    if (!handler) {
        console.error(`Unknown command "${command}".\n`);
        console.log(HELP);
        process.exit(2);
    }

    const { values, positionals } = parseCli(rest);
    if (values.help) {
        console.log(HELP);
        return;
    }

    const prompt = positionals.join(" ").trim();
    if (!prompt) {
        console.error(`The ${command} command needs a <prompt>.\n`);
        process.exit(2);
    }

    const runLog = startRun("cli", { command, prompt, args: rest.slice(1) });
    try {
        await handler(prompt, values, runLog);
        runLog.end({ ok: true });
    } catch (err) {
        runLog.error(err, { command });
        runLog.end({ ok: false });
        err.runLogPath = logFilePath();
        throw err;
    }
}

main().catch((err) => {
    console.error(`[pixegen] error: ${err.message}`);
    if (err.runLogPath) {
        console.error(
            `[pixegen] debug log: ${err.runLogPath} (JSONL — grep the last "run" id for full request detail)`,
        );
    }
    process.exit(1);
});
