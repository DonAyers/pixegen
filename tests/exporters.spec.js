/**
 * Sheet model + engine exporters — pure-core tests (no browser). Verifies
 * multi-animation packing geometry and each emitter's format contract.
 */

import { test, expect } from "@playwright/test";
import {
    buildSheetModel,
    toPhaserAtlas,
    toAsepriteJson,
    toGodotSpriteFrames,
    toLove2dLua,
    toUnityMeta,
    emitSheetMetadata,
    EXPORT_FORMATS,
} from "../src/core/exporters.js";
import { buildJsonAtlas } from "../src/core/atlas.js";

const dims = (n, w = 32, h = 32) =>
    Array.from({ length: n }, () => ({ width: w, height: h }));

function twoAnimModel(padding = 0) {
    return buildSheetModel(
        [
            { name: "walk_side", fps: 8, loop: true, frames: dims(4) },
            { name: "attack_side", fps: 12, loop: false, frames: dims(3, 32, 48) },
        ],
        { imageName: "hero.png", padding },
    );
}

test.describe("buildSheetModel", () => {
    test("packs one row per animation with correct geometry", () => {
        const model = twoAnimModel();

        expect(model.width).toBe(4 * 32); // widest row
        expect(model.height).toBe(32 + 48); // row heights stacked
        expect(model.frames).toHaveLength(7);

        // Second animation starts on the second row
        const attack0 = model.frames.find((f) => f.name === "attack_side_000");
        expect(attack0).toMatchObject({ x: 0, y: 32, w: 32, h: 48 });

        // Animation ranges are contiguous global indices
        expect(model.animations[0]).toMatchObject({ from: 0, to: 3 });
        expect(model.animations[1]).toMatchObject({ from: 4, to: 6 });

        // Per-frame duration derives from fps
        expect(model.frames[0].durationMs).toBe(125); // 8 fps
        expect(attack0.durationMs).toBe(83); // 12 fps

        // Default pivot is bottom-center
        expect(model.frames[0].pivot).toEqual({ x: 0.5, y: 1 });
    });

    test("applies padding between frames and rows", () => {
        const model = twoAnimModel(2);
        expect(model.width).toBe(4 * 32 + 3 * 2);
        expect(model.height).toBe(32 + 48 + 2);
        const walk1 = model.frames.find((f) => f.name === "walk_side_001");
        expect(walk1.x).toBe(34);
        const attack0 = model.frames.find((f) => f.name === "attack_side_000");
        expect(attack0.y).toBe(34);
    });

    test("throws on empty input", () => {
        expect(() => buildSheetModel([])).toThrow(/No animations/);
        expect(() =>
            buildSheetModel([{ name: "x", frames: [] }]),
        ).toThrow(/No frames/);
    });
});

test.describe("Phaser atlas", () => {
    test("multi-animation atlas has frames and animation keys", () => {
        const atlas = toPhaserAtlas(twoAnimModel());
        expect(atlas.frames).toHaveLength(7);
        expect(atlas.meta.image).toBe("hero.png");
        expect(atlas.animations).toHaveLength(2);
        expect(atlas.animations[0]).toMatchObject({
            key: "walk_side",
            frameRate: 8,
            repeat: -1,
        });
        expect(atlas.animations[1].repeat).toBe(0); // non-looping
    });

    test("buildJsonAtlas wrapper keeps its original single-animation shape", () => {
        const atlas = buildJsonAtlas(
            { frameWidth: 32, frameHeight: 32, width: 128, height: 32 },
            { imageName: "s.png", animName: "walk", frameCount: 4, fps: 8, loop: true },
        );
        expect(atlas.frames).toHaveLength(4);
        expect(atlas.frames[0].filename).toBe("walk_000");
        expect(atlas.frames[3].frame).toMatchObject({ x: 96, y: 0, w: 32, h: 32 });
        expect(atlas.meta.size).toEqual({ w: 128, h: 32 });
        expect(atlas.animations[0].frames).toEqual([
            "walk_000",
            "walk_001",
            "walk_002",
            "walk_003",
        ]);
    });
});

test.describe("Aseprite JSON", () => {
    test("hash frames carry durations; frameTags map animations", () => {
        const ase = toAsepriteJson(twoAnimModel());
        expect(ase.frames["walk_side_000"].duration).toBe(125);
        expect(ase.frames["attack_side_002"].duration).toBe(83);
        expect(ase.meta.frameTags).toEqual([
            { name: "walk_side", from: 0, to: 3, direction: "forward" },
            {
                name: "attack_side",
                from: 4,
                to: 6,
                direction: "forward",
                repeat: "1",
            },
        ]);
        expect(ase.meta.size).toEqual({ w: 128, h: 80 });
    });
});

test.describe("Godot SpriteFrames", () => {
    test("emits a .tres with one AtlasTexture per frame and animation blocks", () => {
        const tres = toGodotSpriteFrames(twoAnimModel());
        expect(tres).toContain('[gd_resource type="SpriteFrames" load_steps=9 format=3]');
        expect(tres).toContain('path="res://hero.png"');
        expect((tres.match(/\[sub_resource type="AtlasTexture"/g) || [])).toHaveLength(7);
        expect(tres).toContain("region = Rect2(0, 32, 32, 48)");
        expect(tres).toContain('"name": &"walk_side"');
        expect(tres).toContain('"loop": true');
        expect(tres).toContain('"loop": false');
        expect(tres).toContain('"speed": 12.0');
    });
});

test.describe("love2d Lua", () => {
    test("emits a data-only lua module with quads and animations", () => {
        const lua = toLove2dLua(twoAnimModel());
        expect(lua).toContain('image = "hero.png"');
        expect(lua).toContain(
            '["walk_side_001"] = { x = 32, y = 0, w = 32, h = 32, duration = 0.1250, ox = 16.0, oy = 32.0 }',
        );
        expect(lua).toContain(
            '["attack_side"] = { fps = 12, loop = false, frames = { "attack_side_000", "attack_side_001", "attack_side_002" } }',
        );
        expect(lua.trim().startsWith("--")).toBe(true);
        expect(lua).toContain("return {");
    });
});

test.describe("Unity metadata", () => {
    test("rects are bottom-left origin and pivots are Unity-normalized", () => {
        const unity = toUnityMeta(twoAnimModel());
        const attack0 = unity.sprites.find((s) => s.name === "attack_side_000");
        // Sheet is 80 tall; attack row starts at y=32 (top), height 48 →
        // bottom-left origin y = 80 - 32 - 48 = 0.
        expect(attack0.rect).toEqual({ x: 0, y: 0, width: 32, height: 48 });
        const walk0 = unity.sprites.find((s) => s.name === "walk_side_000");
        expect(walk0.rect.y).toBe(48);
        // Bottom-center pivot: Unity y=0 at the bottom.
        expect(walk0.pivot).toEqual({ x: 0.5, y: 0 });
        expect(unity.animations[0].sprites).toHaveLength(4);
    });
});

test.describe("format registry", () => {
    test("every format emits non-empty content with its extension", () => {
        const model = twoAnimModel();
        for (const id of Object.keys(EXPORT_FORMATS)) {
            const { content, ext } = emitSheetMetadata(id, model);
            expect(content.length, `${id} content`).toBeGreaterThan(50);
            expect(ext, `${id} ext`).toMatch(/^\./);
        }
    });

    test("unknown format throws with the available options", () => {
        expect(() => emitSheetMetadata("rpgmaker", twoAnimModel())).toThrow(
            /Unknown export format/,
        );
    });
});
