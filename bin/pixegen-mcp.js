#!/usr/bin/env node
/**
 * pixegen MCP server — lets coding agents generate retro pixel-art game
 * assets as real files in a project directory, over stdio.
 *
 * Built on the same portable core + Node adapter as bin/pixegen.js. Tools
 * write PNG/JSON files to a caller-specified output directory and return
 * the paths (both as text and structuredContent), matching the convention
 * of other asset-generation MCP servers.
 *
 * Register with e.g.:
 *   claude mcp add pixegen -- node /path/to/pixegen/bin/pixegen-mcp.js
 *
 * Environment: POLLINATIONS_API_KEY (optional — required for paid models).
 *
 * NOTE: stdio transport — stdout is the protocol channel; all logging goes
 * to stderr.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { RECIPES, DEFAULT_RECIPE } from "../src/core/recipes.js";
import { PALETTE_PROFILES, SPRITE_SCALES } from "../src/core/palettes.js";
import { PROVIDERS } from "../src/core/models.js";
import { listProviderAdapters } from "../src/node/providers/index.js";
import { getPollinationsCatalog } from "../src/node/live-models.js";
import { startRun, logFilePath } from "../src/node/run-log.js";
import { buildJsonAtlas } from "../src/core/atlas.js";
import {
    ANIMATION_STATES,
    VIEWS,
    buildPoseDescription,
} from "../src/animation-states.js";
import { TILE_ROLES, getRoleHint } from "../src/tile-roles.js";
import { encodePng } from "../src/node/png.js";
import {
    generateSprite,
    generateSheet,
    generateTileset,
    assembleGridRaster,
} from "../src/node/generate.js";

const log = (msg) => process.stderr.write(`[pixegen-mcp] ${msg}\n`);

const server = new McpServer({
    name: "pixegen",
    version: "0.1.0",
});

// ─── Shared schema fragments ─────────────────────────────────────────────────

const recipeSchema = z
    .enum(Object.keys(RECIPES))
    .optional()
    .describe(
        `Named known-good settings bundle (default: ${DEFAULT_RECIPE}). Use list_recipes to see what each produces.`,
    );

const commonGenerationSchema = {
    prompt: z
        .string()
        .min(1)
        .describe(
            "Subject description, e.g. 'a knight with a sword'. Style tokens (pixel art, console era) are added automatically — describe only the subject.",
        ),
    recipe: recipeSchema,
    model: z
        .string()
        .optional()
        .describe(
            "Model override, 'model' or 'provider:model' (see list_models), or 'auto'/'auto:draft'/'auto:standard'/'auto:best' to resolve by quality tier instead of a model name. Free-tier via Pollinations: flux, zimage, gptimage, gptimage-large, gpt-image-2, klein, kontext, nova-canvas. BYOK direct: openai:gpt-image-1 (needs OPENAI_API_KEY).",
        ),
    quality: z
        .enum(["low", "medium", "high", "auto"])
        .optional()
        .describe(
            "Generation quality tier passed to the provider (cost/speed tradeoff).",
        ),
    palette: z
        .string()
        .optional()
        .describe(
            "Palette profile override: none, nes, snes, genesis, gameboy, c64, atari.",
        ),
    size: z
        .string()
        .optional()
        .describe(
            'Sprite footprint override, "WxH" (preset like 32x32 or custom like 24x21).',
        ),
    seed: z
        .number()
        .int()
        .optional()
        .describe("Seed for best-effort reproducibility."),
    transparent: z
        .boolean()
        .optional()
        .describe(
            "Request a transparent background (default true; only honored by GPT Image models — silently skipped elsewhere).",
        ),
    outDir: z
        .string()
        .describe(
            "Directory to write asset files into (created if missing). Use a path inside the game project so the engine can load the output directly.",
        ),
    baseName: z
        .string()
        .optional()
        .describe("Base filename without extension (default: derived from the prompt)."),
};

const generationResultSchema = {
    files: z.array(z.string()).describe("Paths of every file written"),
    width: z.number().describe("Pixel width of each sprite/frame/tile"),
    height: z.number().describe("Pixel height of each sprite/frame/tile"),
    seedUsed: z.number().describe("Seed of the accepted attempt"),
    attempts: z.number().describe("Generation attempts used (max 2)"),
    validationPassed: z.boolean(),
    issues: z
        .array(z.string())
        .describe("Validation issues remaining after the retry, if any"),
};

function slugify(text) {
    return (
        text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || "sprite"
    );
}

function writeFile(path, data) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, data);
    return path;
}

function toGenerationOptions(args, runLog) {
    return {
        recipe: args.recipe || DEFAULT_RECIPE,
        model: args.model,
        consoleId: args.palette,
        spriteSize: args.size,
        quality: args.quality,
        seed: args.seed,
        transparent: args.transparent !== false,
        runLog,
        log,
    };
}

/**
 * Run one tool call inside a structured run log (logs/*.jsonl). Failures
 * are logged with full detail and rethrown with a pointer to the log file,
 * so an agent-side error message is actionable.
 */
async function withRunLog(tool, args, fn) {
    const runLog = startRun("mcp", {
        tool,
        prompt: args.prompt,
        recipe: args.recipe,
        model: args.model,
        outDir: args.outDir,
    });
    try {
        const out = await fn(runLog);
        runLog.end({ ok: true });
        return out;
    } catch (err) {
        runLog.error(err, { tool });
        runLog.end({ ok: false });
        throw new Error(`${err.message} (debug log: ${logFilePath()}, run ${runLog.id})`);
    }
}

function resultPayload(files, extra) {
    const structured = {
        files,
        validationPassed: extra.issues.length === 0,
        ...extra,
    };
    const lines = [
        `Wrote ${files.length} file(s):`,
        ...files.map((f) => `  ${f}`),
        `Size: ${extra.width}x${extra.height}, seed ${extra.seedUsed}, ${extra.attempts} attempt(s).`,
    ];
    if (extra.issues.length > 0) {
        lines.push(
            "WARNING — validation issues remain (files were still written):",
            ...extra.issues.map((i) => `  - ${i}`),
        );
    }
    return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: structured,
    };
}

// ─── Generation tools ────────────────────────────────────────────────────────

server.registerTool(
    "generate_sprite",
    {
        title: "Generate a pixel-art sprite",
        description:
            "Generate one retro pixel-art sprite PNG from a text description, quantized to a console palette profile, and write it into the project. Deterministic validation runs after generation with one automatic retry.",
        inputSchema: {
            ...commonGenerationSchema,
            pose: z
                .string()
                .optional()
                .describe(
                    "Optional pose/view hint, e.g. 'side view, mid-stride'.",
                ),
            autoCrop: z
                .boolean()
                .optional()
                .describe(
                    "Crop to the subject's bounding box before downscaling, so a small-in-frame subject uses the full pixel budget. Recommended when results look tiny/washed out.",
                ),
        },
        outputSchema: generationResultSchema,
    },
    async (args) =>
        withRunLog("generate_sprite", args, async (runLog) => {
            const base = args.baseName || slugify(args.prompt);
            const result = await generateSprite(args.prompt, {
                ...toGenerationOptions(args, runLog),
                poseDesc: args.pose || "",
                autoCrop: args.autoCrop,
            });

            const files = [
                writeFile(
                    join(args.outDir, `${base}.png`),
                    encodePng(result.pixelData),
                ),
            ];

            return resultPayload(files, {
                width: result.spriteW,
                height: result.spriteH,
                seedUsed: result.seedUsed,
                attempts: result.attempts,
                issues: result.issues,
            });
        }),
);

server.registerTool(
    "generate_sprite_sheet",
    {
        title: "Generate an animation sprite sheet",
        description:
            "Generate every frame of a standard game animation (walk, run, attack…) for one character, write the assembled horizontal sheet PNG, a Phaser-compatible JSON atlas, and the individual frame PNGs.",
        inputSchema: {
            ...commonGenerationSchema,
            animation: z
                .enum(Object.keys(ANIMATION_STATES))
                .describe("Animation state to generate."),
            view: z
                .enum(Object.keys(VIEWS))
                .optional()
                .describe("Camera/facing direction (default: side)."),
            frames: z
                .number()
                .int()
                .min(1)
                .max(16)
                .optional()
                .describe(
                    "Frame count override (default: the animation's standard count).",
                ),
            fps: z
                .number()
                .int()
                .optional()
                .describe("Playback FPS recorded in the atlas (default 8)."),
        },
        outputSchema: generationResultSchema,
    },
    async (args) =>
        withRunLog("generate_sprite_sheet", args, async (runLog) => {
        const anim = ANIMATION_STATES[args.animation];
        const view = VIEWS[args.view || "side"];
        const frameCount = args.frames || anim.frameCount;
        const base = args.baseName || slugify(args.prompt);
        const baseName = `${base}_${args.animation}`;

        const result = await generateSheet(args.prompt, {
            ...toGenerationOptions(args, runLog),
            frameCount,
            viewDesc: view.promptDesc,
            animDesc: anim.promptDesc,
            frameHints: anim.frameHints,
        });

        const sheetRaster = assembleGridRaster(result.frames, frameCount);
        const { spriteW, spriteH } = result.frames[0];
        const pngName = `${baseName}.png`;

        const files = [
            writeFile(join(args.outDir, pngName), encodePng(sheetRaster)),
            writeFile(
                join(args.outDir, `${baseName}.json`),
                JSON.stringify(
                    buildJsonAtlas(
                        {
                            frameWidth: spriteW,
                            frameHeight: spriteH,
                            width: sheetRaster.width,
                            height: sheetRaster.height,
                        },
                        {
                            imageName: pngName,
                            animName: args.animation,
                            frameCount,
                            fps: args.fps || 8,
                            loop: anim.loop,
                        },
                    ),
                    null,
                    2,
                ),
            ),
            ...result.frames.map((frame, i) =>
                writeFile(
                    join(
                        args.outDir,
                        "frames",
                        `${baseName}_${String(i).padStart(3, "0")}.png`,
                    ),
                    encodePng(frame.pixelData),
                ),
            ),
        ];

        return resultPayload(files, {
            width: spriteW,
            height: spriteH,
            seedUsed: result.seedUsed,
            attempts: result.attempts,
            issues: result.issues,
        });
        }),
);

server.registerTool(
    "generate_tileset",
    {
        title: "Generate a terrain/prop tileset",
        description:
            "Generate a cols × rows grid of themed map tiles (terrain, props, transitions) with a shared palette and style. Writes the assembled tileset PNG, individual tile PNGs, and a JSON manifest mapping grid positions to tile roles.",
        inputSchema: {
            ...commonGenerationSchema,
            cols: z.number().int().min(1).max(8).optional().describe("Grid columns (default 4)."),
            rows: z.number().int().min(1).max(8).optional().describe("Grid rows (default 4)."),
            roles: z
                .array(z.enum(Object.keys(TILE_ROLES)))
                .optional()
                .describe(
                    "Tile roles row-major; cycles to fill the grid. Default cycles all roles.",
                ),
        },
        outputSchema: generationResultSchema,
    },
    async (args) =>
        withRunLog("generate_tileset", args, async (runLog) => {
        const cols = args.cols || 4;
        const rows = args.rows || 4;
        const roleIds = args.roles?.length ? args.roles : Object.keys(TILE_ROLES);
        const roleGrid = [];
        for (let i = 0; i < cols * rows; i++) {
            roleGrid.push(roleIds[i % roleIds.length]);
        }

        const result = await generateTileset(args.prompt, {
            ...toGenerationOptions(args, runLog),
            cols,
            rows,
            tileHints: roleGrid.map((roleId) => getRoleHint(roleId)),
            transparent: args.transparent === true, // tiles default opaque
        });

        const tilesetRaster = assembleGridRaster(result.tiles, cols);
        const { spriteW, spriteH } = result.tiles[0];

        const files = [
            writeFile(join(args.outDir, "tileset.png"), encodePng(tilesetRaster)),
            ...result.tiles.map((tile) =>
                writeFile(
                    join(args.outDir, "tiles", `tile_${tile.gridX}_${tile.gridY}.png`),
                    encodePng(tile.pixelData),
                ),
            ),
            writeFile(
                join(args.outDir, "tileset.json"),
                JSON.stringify(
                    {
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
                    },
                    null,
                    2,
                ),
            ),
        ];

        return resultPayload(files, {
            width: spriteW,
            height: spriteH,
            seedUsed: result.seedUsed,
            attempts: result.attempts,
            issues: result.issues,
        });
        }),
);

// ─── Listing tools ───────────────────────────────────────────────────────────

server.registerTool(
    "list_recipes",
    {
        title: "List recipes",
        description:
            "List the named generation recipes (palette + scale + pipeline bundles) accepted by the generate tools.",
        inputSchema: {},
        outputSchema: {
            recipes: z.array(
                z.object({
                    id: z.string(),
                    label: z.string(),
                    description: z.string(),
                    provisional: z.boolean(),
                    palette: z.string(),
                    size: z.string(),
                    defaultModel: z.string(),
                }),
            ),
        },
    },
    async () => {
        const recipes = Object.entries(RECIPES).map(([id, r]) => ({
            id,
            label: r.label,
            description: r.description,
            provisional: Boolean(r.provisional),
            palette: r.consoleId,
            size: r.spriteSize,
            defaultModel: r.model,
        }));
        return {
            content: [
                {
                    type: "text",
                    text: recipes
                        .map((r) => `${r.id}: ${r.description}`)
                        .join("\n"),
                },
            ],
            structuredContent: { recipes },
        };
    },
);

server.registerTool(
    "list_palette_profiles",
    {
        title: "List palette profiles and sprite scales",
        description:
            "List the console palette profiles (color constraints) and sprite scale presets (pixel footprints) — two independent axes any generate call can mix freely.",
        inputSchema: {},
        outputSchema: {
            profiles: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    colorDepth: z.string(),
                    colorsPerSprite: z.string(),
                    suggestedScale: z.string(),
                }),
            ),
            scales: z.array(
                z.object({ id: z.string(), label: z.string() }),
            ),
        },
    },
    async () => {
        const profiles = Object.entries(PALETTE_PROFILES).map(([id, p]) => ({
            id,
            name: p.fullName,
            colorDepth: p.colorDepth,
            colorsPerSprite: String(p.colorsPerSprite),
            suggestedScale: p.defaultScale,
        }));
        const scales = Object.entries(SPRITE_SCALES).map(([id, s]) => ({
            id,
            label: s.label,
        }));
        return {
            content: [
                {
                    type: "text",
                    text:
                        profiles
                            .map(
                                (p) =>
                                    `${p.id}: ${p.name} (${p.colorDepth})`,
                            )
                            .join("\n") +
                        `\nScales: ${scales.map((s) => `${s.id} (${s.label})`).join(", ")} — custom "WxH" also accepted.`,
                },
            ],
            structuredContent: { profiles, scales },
        };
    },
);

server.registerTool(
    "list_models",
    {
        title: "List AI models",
        description:
            "List the available image generation models per provider, with free/paid status, whether each provider's API key is configured in this environment, and capability flags (transparent background, seed support, reference-image capacity). Pollinations models come from the live catalog when it has been synced (CLI: pixegen models --live), the static fallback otherwise. Pass model 'auto'/'auto:<tier>' to generate tools to pick by quality tier instead.",
        inputSchema: {},
        outputSchema: {
            providers: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    keyEnv: z.string(),
                    keyOptional: z.boolean(),
                    configured: z
                        .boolean()
                        .describe("Whether this provider is usable right now"),
                    models: z.array(
                        z.object({
                            id: z
                                .string()
                                .describe("Pass as 'provider:id' to generate tools"),
                            name: z.string(),
                            description: z.string(),
                            paidOnly: z.boolean(),
                            supportsTransparent: z.boolean(),
                            supportsSeed: z.boolean(),
                            maxReferenceImages: z
                                .number()
                                .describe(
                                    "How many reference image URLs the model accepts (0 = none)",
                                ),
                        }),
                    ),
                }),
            ),
        },
    },
    async () => {
        const adapters = new Map(
            listProviderAdapters().map((a) => [a.id, a]),
        );
        const providers = Object.entries(PROVIDERS).map(([pid, p]) => ({
            id: pid,
            name: p.name,
            keyEnv: p.keyEnv,
            keyOptional: p.keyOptional,
            configured: adapters.get(pid)?.isConfigured() ?? false,
            models: (pid === "pollinations"
                ? getPollinationsCatalog().models
                : p.models
            ).map((m) => ({
                id: m.id,
                name: m.name,
                description: m.description,
                paidOnly: m.paidOnly,
                supportsTransparent: m.supportsTransparent,
                supportsSeed: m.supportsSeed !== false,
                maxReferenceImages: m.maxReferenceImages ?? 0,
            })),
        }));
        const text = providers
            .map(
                (p) =>
                    `${p.name} (${p.keyEnv}${p.keyOptional ? " optional" : p.configured ? " configured" : " NOT set"}):\n` +
                    p.models
                        .map(
                            (m) =>
                                `  ${p.id}:${m.id} — ${m.name}${m.paidOnly ? " [paid key]" : " [free]"}${m.supportsTransparent ? " [transparent bg]" : ""}`,
                        )
                        .join("\n"),
            )
            .join("\n");
        return {
            content: [{ type: "text", text }],
            structuredContent: { providers },
        };
    },
);

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
log("pixegen MCP server ready (stdio)");
