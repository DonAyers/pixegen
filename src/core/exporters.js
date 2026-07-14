/**
 * Engine export (portable) — a shared internal "sheet model" plus pure
 * emitters for the engine formats PixelGen targets:
 *
 *   - Phaser 3 JSON atlas (the original format, see atlas.js)
 *   - Aseprite JSON (hash) — the de-facto interchange format; importable by
 *     Godot/Unity/love2d tooling and by Aseprite itself
 *   - Godot 4 SpriteFrames (.tres)
 *   - LÖVE / love2d (data-only .lua module, anim8-friendly)
 *   - Unity sprite metadata (JSON for editor import scripts;
 *     bottom-left-origin rects and normalized pivots per Unity convention)
 *
 * The sheet model is the single source of truth: frames carry positions,
 * per-frame durations, and pivots; animations group frames with fps/loop.
 * Multiple animations pack into one sheet (one row per animation), so a
 * whole character exports as one PNG + one metadata file.
 *
 * Everything here is pure data-in/data-out — no DOM, canvas, or Node APIs —
 * so the browser export flow, the CLI, and MCP all share it. Callers
 * composite the actual PNG from the model's frame positions.
 */

/** Default sprite anchor: bottom-center (feet on the ground). */
export const DEFAULT_PIVOT = { x: 0.5, y: 1 };

/**
 * Build the internal sheet model from one or more animations.
 *
 * @param {Array<object>} animations - Each:
 *   {string} name - Animation key (e.g. "walk_side")
 *   {Array<{width:number,height:number}>} frames - Frame dimensions, in order
 *   {number} [fps=8] - Playback rate
 *   {boolean} [loop=true]
 * @param {object} [options]
 * @param {string} [options.imageName="spritesheet.png"]
 * @param {number} [options.padding=0] - Pixels between frames and rows
 * @param {{x:number,y:number}} [options.pivot] - Normalized anchor for all
 *   frames (0,0 = top-left; 1,1 = bottom-right). Default bottom-center.
 * @returns {object} model - {
 *   image, width, height, padding,
 *   frames: [{ name, animation, index, x, y, w, h, durationMs, pivot }],
 *   animations: [{ name, fps, loop, from, to, frameNames }],
 *   meta: { app, version }
 * }
 */
export function buildSheetModel(animations, options = {}) {
    const {
        imageName = "spritesheet.png",
        padding = 0,
        pivot = DEFAULT_PIVOT,
    } = options;

    if (!animations || animations.length === 0) {
        throw new Error("No animations to export");
    }

    const frames = [];
    const animEntries = [];
    let sheetWidth = 0;
    let y = 0;

    for (const anim of animations) {
        const { name, frames: dims, fps = 8, loop = true } = anim;
        if (!dims || dims.length === 0) continue;

        const durationMs = Math.round(1000 / (fps || 8));
        const rowHeight = Math.max(...dims.map((d) => d.height));
        const from = frames.length;
        let x = 0;
        const frameNames = [];

        dims.forEach((d, i) => {
            const frameName = `${name}_${String(i).padStart(3, "0")}`;
            frames.push({
                name: frameName,
                animation: name,
                index: i,
                x,
                y,
                w: d.width,
                h: d.height,
                durationMs,
                pivot: { ...pivot },
            });
            frameNames.push(frameName);
            x += d.width + padding;
        });

        sheetWidth = Math.max(sheetWidth, x - padding);
        animEntries.push({
            name,
            fps: fps || 8,
            loop,
            from,
            to: frames.length - 1,
            frameNames,
        });
        y += rowHeight + padding;
    }

    if (frames.length === 0) {
        throw new Error("No frames to export");
    }

    return {
        image: imageName,
        width: sheetWidth,
        height: y - padding,
        padding,
        frames,
        animations: animEntries,
        meta: { app: "PixelGen", version: "1.0" },
    };
}

// ─── Phaser 3 ────────────────────────────────────────────────────────────────

/**
 * Phaser 3 JSON atlas (array format) with an `animations` block.
 * Single-animation output is byte-compatible with the original
 * atlas.js/buildJsonAtlas shape.
 */
export function toPhaserAtlas(model) {
    return {
        frames: model.frames.map((f) => ({
            filename: f.name,
            frame: { x: f.x, y: f.y, w: f.w, h: f.h },
            rotated: false,
            trimmed: false,
            spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
            sourceSize: { w: f.w, h: f.h },
            pivot: f.pivot,
        })),
        meta: {
            app: model.meta.app,
            version: model.meta.version,
            image: model.image,
            format: "RGBA8888",
            size: { w: model.width, h: model.height },
            scale: 1,
        },
        animations: model.animations.map((a) => ({
            key: a.name,
            frameRate: a.fps,
            repeat: a.loop ? -1 : 0,
            frames: a.frameNames,
        })),
    };
}

// ─── Aseprite JSON (hash) ───────────────────────────────────────────────────

/**
 * Aseprite-style JSON (hash format): per-frame durations in ms, one
 * frameTag per animation. Non-looping animations get `"repeat": "1"`
 * (Aseprite 1.3+ tag repeat).
 */
export function toAsepriteJson(model) {
    const framesObj = {};
    for (const f of model.frames) {
        framesObj[f.name] = {
            frame: { x: f.x, y: f.y, w: f.w, h: f.h },
            rotated: false,
            trimmed: false,
            spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
            sourceSize: { w: f.w, h: f.h },
            duration: f.durationMs,
        };
    }
    return {
        frames: framesObj,
        meta: {
            app: model.meta.app,
            version: model.meta.version,
            image: model.image,
            format: "RGBA8888",
            size: { w: model.width, h: model.height },
            scale: "1",
            frameTags: model.animations.map((a) => ({
                name: a.name,
                from: a.from,
                to: a.to,
                direction: "forward",
                ...(a.loop ? {} : { repeat: "1" }),
            })),
            layers: [],
            slices: [],
        },
    };
}

// ─── Godot 4 SpriteFrames ───────────────────────────────────────────────────

/**
 * Godot 4 SpriteFrames resource (.tres text). Each frame becomes an
 * AtlasTexture sub-resource; the texture path assumes the PNG sits next to
 * the .tres inside the Godot project (res://<image>).
 */
export function toGodotSpriteFrames(model) {
    const lines = [];
    const subIds = model.frames.map((_, i) => `AtlasTexture_${i + 1}`);
    const loadSteps = model.frames.length + 2; // ext texture + subs + resource

    lines.push(
        `[gd_resource type="SpriteFrames" load_steps=${loadSteps} format=3]`,
        "",
        `[ext_resource type="Texture2D" path="res://${model.image}" id="1"]`,
        "",
    );

    model.frames.forEach((f, i) => {
        lines.push(
            `[sub_resource type="AtlasTexture" id="${subIds[i]}"]`,
            `atlas = ExtResource("1")`,
            `region = Rect2(${f.x}, ${f.y}, ${f.w}, ${f.h})`,
            "",
        );
    });

    const animBlocks = model.animations.map((a) => {
        const frameRefs = model.frames
            .map((f, i) => ({ f, i }))
            .filter(({ f }) => f.animation === a.name)
            .map(
                ({ i }) =>
                    `{\n"duration": 1.0,\n"texture": SubResource("${subIds[i]}")\n}`,
            )
            .join(", ");
        return `{\n"frames": [${frameRefs}],\n"loop": ${a.loop},\n"name": &"${a.name}",\n"speed": ${a.fps}.0\n}`;
    });

    lines.push("[resource]", `animations = [${animBlocks.join(", ")}]`, "");
    return lines.join("\n");
}

// ─── love2d / LÖVE ──────────────────────────────────────────────────────────

function luaString(s) {
    return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Data-only Lua module for LÖVE: quad rects, per-frame durations (seconds),
 * pivots in pixels, and animation tables ready for anim8-style players:
 *
 *   local sheet = require("hero")
 *   local img = love.graphics.newImage(sheet.image)
 *   local q = sheet.frames[sheet.animations.walk_side.frames[1]]
 *   love.graphics.newQuad(q.x, q.y, q.w, q.h, img)
 */
export function toLove2dLua(model) {
    const lines = [];
    lines.push(
        "-- Generated by PixelGen — sprite sheet quad + animation data",
        "return {",
        `  image = ${luaString(model.image)},`,
        `  width = ${model.width},`,
        `  height = ${model.height},`,
        "  frames = {",
    );
    for (const f of model.frames) {
        lines.push(
            `    [${luaString(f.name)}] = { x = ${f.x}, y = ${f.y}, w = ${f.w}, h = ${f.h}, ` +
                `duration = ${(f.durationMs / 1000).toFixed(4)}, ` +
                `ox = ${(f.pivot.x * f.w).toFixed(1)}, oy = ${(f.pivot.y * f.h).toFixed(1)} },`,
        );
    }
    lines.push("  },", "  animations = {");
    for (const a of model.animations) {
        const names = a.frameNames.map(luaString).join(", ");
        lines.push(
            `    [${luaString(a.name)}] = { fps = ${a.fps}, loop = ${a.loop}, frames = { ${names} } },`,
        );
    }
    lines.push("  },", "}", "");
    return lines.join("\n");
}

// ─── Unity ──────────────────────────────────────────────────────────────────

/**
 * Unity-oriented sprite metadata: rects converted to Unity's bottom-left
 * origin, normalized pivots, and animation clips (fps + loop). Meant to be
 * consumed by an editor import script (Unity has no runtime JSON atlas
 * loader); the conventions match TextureImporter sprite sheets.
 */
export function toUnityMeta(model) {
    return {
        texture: model.image,
        textureSize: { width: model.width, height: model.height },
        sprites: model.frames.map((f) => ({
            name: f.name,
            rect: {
                x: f.x,
                // Unity rects are measured from the bottom-left corner.
                y: model.height - f.y - f.h,
                width: f.w,
                height: f.h,
            },
            // Unity pivot y is 0 at the bottom.
            pivot: { x: f.pivot.x, y: 1 - f.pivot.y },
        })),
        animations: model.animations.map((a) => ({
            name: a.name,
            fps: a.fps,
            loop: a.loop,
            sprites: a.frameNames,
        })),
    };
}

// ─── Format registry ────────────────────────────────────────────────────────

/**
 * All supported export formats. `emit` returns the serialized file content
 * (string) for a sheet model; `ext` is the metadata file extension.
 */
export const EXPORT_FORMATS = {
    phaser: {
        id: "phaser",
        label: "Phaser 3 (JSON atlas)",
        ext: ".json",
        emit: (model) => JSON.stringify(toPhaserAtlas(model), null, 2),
    },
    aseprite: {
        id: "aseprite",
        label: "Aseprite JSON",
        ext: ".aseprite.json",
        emit: (model) => JSON.stringify(toAsepriteJson(model), null, 2),
    },
    godot: {
        id: "godot",
        label: "Godot 4 (SpriteFrames .tres)",
        ext: ".tres",
        emit: toGodotSpriteFrames,
    },
    love2d: {
        id: "love2d",
        label: "LÖVE / love2d (.lua)",
        ext: ".lua",
        emit: toLove2dLua,
    },
    unity: {
        id: "unity",
        label: "Unity (sprite metadata JSON)",
        ext: ".unity.json",
        emit: (model) => JSON.stringify(toUnityMeta(model), null, 2),
    },
};

/**
 * Serialize a sheet model in the given format.
 * @param {string} formatId - Key of EXPORT_FORMATS
 * @param {object} model - From buildSheetModel
 * @returns {{ content: string, ext: string }}
 */
export function emitSheetMetadata(formatId, model) {
    const format = EXPORT_FORMATS[formatId];
    if (!format) {
        throw new Error(
            `Unknown export format "${formatId}". Options: ${Object.keys(EXPORT_FORMATS).join(", ")}`,
        );
    }
    return { content: format.emit(model), ext: format.ext };
}
