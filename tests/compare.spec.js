import { test, expect } from "@playwright/test";

// Pre-generated 64x64 red PNG as base64 (large enough for pixel processor)
const TEST_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlElEQVR4nO3QMREAMBDDsPAn/YWhoR60+7zb7mfTAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA9DiOHSbdjxEgAAAABJRU5ErkJggg==";

// Capture every mocked generation request so tests can assert both sides
// fired with the expected model/seed params.
async function mockApiWithCapture(page) {
    const requests = [];
    await page.route("**/api/pollinations/**", async (route) => {
        const url = new URL(route.request().url());
        requests.push({
            model: url.searchParams.get("model"),
            seed: url.searchParams.get("seed"),
        });
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(TEST_PNG_BASE64, "base64"),
        });
    });
    return requests;
}

async function openCompareTab(page) {
    await page.goto("/");
    await page.getByRole("tab", { name: /a\/b test/i }).click();
    await expect(
        page.getByRole("heading", { name: /a\/b test lab/i }),
    ).toBeVisible();
}

test.describe("A/B Test Lab", () => {
    test("runs both configs with a shared seed and shows results", async ({
        page,
    }) => {
        const requests = await mockApiWithCapture(page);

        await openCompareTab(page);

        await page
            .getByPlaceholder("e.g. a red dragon breathing fire")
            .fill("a red mushroom");

        await page
            .getByRole("button", { name: /run comparison/i })
            .click();

        await expect(page.getByText(/Comparison complete/)).toBeVisible({
            timeout: 15000,
        });

        // Both sides rendered: source images + processed canvases
        await expect(page.getByAltText("Source A")).toBeVisible();
        await expect(page.getByAltText("Source B")).toBeVisible();
        await expect(page.getByText("Result A")).toBeVisible();
        await expect(page.getByText("Result B")).toBeVisible();

        // Two generation calls, different models (defaults: flux vs gptimage),
        // identical seed.
        expect(requests.length).toBe(2);
        const models = requests.map((r) => r.model).sort();
        expect(models).toEqual(["flux", "gptimage"]);
        expect(requests[0].seed).toBe(requests[1].seed);
        expect(requests[0].seed).not.toBeNull();
    });

    test("recipe preset fills a side's config", async ({ page }) => {
        await openCompareTab(page);

        // Panel select order: 0 = shared Animation select, then side A's
        // preset, model, palette, size...
        const panel = page.getByRole("tabpanel", { name: "A/B Test" });
        const presetA = panel.locator("select").nth(1);
        await presetA.selectOption("gameboy-tiny");

        const paletteA = panel.locator("select").nth(3);
        await expect(paletteA).toHaveValue("gameboy");
        const sizeA = panel.locator("select").nth(4);
        await expect(sizeA).toHaveValue("16x16");
    });

    test("animation mode generates and plays frame sets on both sides", async ({
        page,
    }) => {
        const requests = [];
        await page.route("**/api/pollinations/**", async (route) => {
            const url = new URL(route.request().url());
            requests.push({
                width: Number(url.searchParams.get("width")),
                height: Number(url.searchParams.get("height")),
            });
            await route.fulfill({
                status: 200,
                contentType: "image/png",
                body: Buffer.from(TEST_PNG_BASE64, "base64"),
            });
        });

        await openCompareTab(page);
        await page
            .getByPlaceholder("e.g. a red dragon breathing fire")
            .fill("a running knight");

        // Shared Animation select is the first select in the panel.
        const panel = page.getByRole("tabpanel", { name: "A/B Test" });
        await panel.locator("select").nth(0).selectOption("walk");

        await page.getByRole("button", { name: /run comparison/i }).click();
        await expect(page.getByText(/Comparison complete/)).toBeVisible({
            timeout: 15000,
        });

        // Both sides report a 4-frame walk cycle, autoplaying (pause visible)
        await expect(page.getByText(/Result A · 4 frames/)).toBeVisible();
        await expect(page.getByText(/Result B · 4 frames/)).toBeVisible();
        await expect(page.getByRole("button", { name: "⏸" })).toHaveCount(2);

        // One strip request per side: 4 frames × 512px wide, 512 tall.
        expect(requests.length).toBe(2);
        for (const req of requests) {
            expect(req.width).toBe(4 * 512);
            expect(req.height).toBe(512);
        }
    });

    test("shows a per-side error without killing the other side", async ({
        page,
    }) => {
        // Side A (flux) succeeds, side B (gptimage) fails.
        await page.route("**/api/pollinations/**", async (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.get("model") === "gptimage") {
                await route.fulfill({ status: 500, body: "boom" });
            } else {
                await route.fulfill({
                    status: 200,
                    contentType: "image/png",
                    body: Buffer.from(TEST_PNG_BASE64, "base64"),
                });
            }
        });

        await openCompareTab(page);
        await page
            .getByPlaceholder("e.g. a red dragon breathing fire")
            .fill("a red mushroom");
        await page.getByRole("button", { name: /run comparison/i }).click();

        await expect(page.getByText(/Comparison complete/)).toBeVisible({
            timeout: 15000,
        });
        await expect(page.getByAltText("Source A")).toBeVisible();
        await expect(page.getByText(/B: Image generation failed/)).toBeVisible();
    });
});
