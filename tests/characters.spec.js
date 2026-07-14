/**
 * Characters tab — character entity CRUD, consistent animation generation,
 * and stored-animation playback through the shared AnimationPreview.
 */

import { test, expect } from "@playwright/test";

// Pre-generated 64x64 red PNG as base64 (large enough for pixel processor)
const TEST_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlElEQVR4nO3QMREAMBDDsPAn/YWhoR60+7zb7mfTAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA9DiOHSbdjxEgAAAABJRU5ErkJggg==";

async function mockApi(page, captured = []) {
    await page.route("**/api/pollinations/**", async (route) => {
        captured.push(route.request().url());
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(TEST_PNG_BASE64, "base64"),
        });
    });
}

async function openCharactersTab(page) {
    await page.goto("/");
    await page.getByRole("tab", { name: /characters/i }).click();
    await expect(
        page.getByRole("heading", { name: /^characters$/i }),
    ).toBeVisible();
}

async function createCharacter(page, name, description) {
    await page.getByPlaceholder("e.g. Sir Bramble").fill(name);
    await page
        .getByPlaceholder("e.g. a knight in mossy green armor with a thorned sword")
        .fill(description);
    await page.getByRole("button", { name: /create character/i }).click();
    await expect(page.getByText(`Character "${name}" created`)).toBeVisible({
        timeout: 10000,
    });
}

test.describe("Characters tab", () => {
    test("creates a character and shows its locked properties", async ({
        page,
    }) => {
        await openCharactersTab(page);
        await createCharacter(page, "Test Hero", "a brave test hero");

        // Detail panel opens with the draft fields populated
        await expect(
            page.getByRole("heading", { name: "Test Hero" }),
        ).toBeVisible();
        await expect(
            page.getByText(/base seed \(reused for all animations\)/i),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: /generate$/i }),
        ).toBeVisible();
        await expect(
            page.getByText(/nothing generated for this character yet/i),
        ).toBeVisible();
    });

    test("generates an animation with the character's locked seed and plays it", async ({
        page,
    }) => {
        const captured = [];
        await mockApi(page, captured);
        await openCharactersTab(page);
        await createCharacter(page, "Anim Hero", "a running test hero");

        await page.getByRole("button", { name: /generate$/i }).click();
        await expect(page.getByText(/Done! Walk for "Anim Hero"/)).toBeVisible({
            timeout: 20000,
        });

        // The request carried the character's base seed
        expect(captured.length).toBeGreaterThan(0);
        expect(captured[0]).toMatch(/seed=\d+/);

        // Animation chip appears and the shared player renders with controls
        await expect(page.getByText(/walk\/side/i)).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Play" }),
        ).toBeVisible();
        await expect(page.getByText("1 / 4")).toBeVisible();

        // First generation anchored the reference image automatically
        await expect(page.getByAltText("Character reference")).toBeVisible();
    });

    test("exports a packed character sheet with engine metadata", async ({
        page,
    }) => {
        await mockApi(page);
        await openCharactersTab(page);
        await createCharacter(page, "Export Hero", "an exportable test hero");

        await page.getByRole("button", { name: /generate$/i }).click();
        await expect(
            page.getByText(/Done! Walk for "Export Hero"/),
        ).toBeVisible({ timeout: 20000 });

        // Godot format → expect the PNG and the .tres downloads
        await page
            .getByRole("combobox", { name: /export format/i })
            .selectOption("godot");
        const downloads = [];
        page.on("download", (d) => downloads.push(d.suggestedFilename()));
        await page.getByRole("button", { name: /export character/i }).click();
        await expect(page.getByText(/Exported!/)).toBeVisible({
            timeout: 10000,
        });
        await expect
            .poll(() => downloads.sort())
            .toEqual(["export-hero.png", "export-hero.tres"]);
    });

    test("adopts previously saved Generator frames by character name", async ({
        page,
    }) => {
        await mockApi(page);
        await page.goto("/");

        // Save a generation under a character name from the Generator tab
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a legacy sprite");
        await page
            .getByPlaceholder("e.g. knight, dragon...")
            .fill("Legacy Hero");
        await page
            .getByRole("button", { name: /generate all frames/i })
            .click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 20000 });

        // Create a character with the same name — frames get linked
        await page.getByRole("tab", { name: /characters/i }).click();
        await createCharacter(page, "Legacy Hero", "a legacy sprite");
        await expect(
            page.getByText(/previously saved frame\(s\) linked to it/i),
        ).toBeVisible();

        // The adopted animation is browsable and playable
        await expect(page.getByText(/idle\/side/i)).toBeVisible();
        await page.getByText(/idle\/side/i).click();
        await expect(
            page.getByRole("button", { name: "Play" }),
        ).toBeVisible();
    });
});
