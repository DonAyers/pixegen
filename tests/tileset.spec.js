import { test, expect } from "@playwright/test";

// Pre-generated 64x64 red PNG as base64 (large enough for pixel processor)
const TEST_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlElEQVR4nO3QMREAMBDDsPAn/YWhoR60+7zb7mfTAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA9DiOHSbdjxEgAAAABJRU5ErkJggg==";

function getTestPngBuffer() {
    return Buffer.from(TEST_PNG_BASE64, "base64");
}

// Track every request made to the mocked provider endpoint so tests can
// assert how many sequential batch calls a grid generation triggered, and
// what width/height each one requested.
async function mockApiWithCapture(page) {
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
            body: getTestPngBuffer(),
        });
    });
    return requests;
}

function numberInputByLabel(page, label) {
    return page
        .locator(`label:text("${label}")`)
        .locator("xpath=..")
        .locator("input");
}

async function openTilesetTab(page) {
    await page.goto("/");
    await page.getByRole("tab", { name: /tileset/i }).click();
    await expect(
        page.getByRole("heading", { name: /tileset studio/i }),
    ).toBeVisible();
}

async function setGridSize(page, cols, rows) {
    const colsInput = numberInputByLabel(page, "Columns:");
    await colsInput.fill(String(cols));
    await colsInput.blur();

    const rowsInput = numberInputByLabel(page, "Rows:");
    await rowsInput.fill(String(rows));
    await rowsInput.blur();

    await expect(
        page.getByText(`Tile roles (${cols}×${rows} grid):`),
    ).toBeVisible();
}

test.describe("Tileset Studio grid generation", () => {
    test("small grid fits in a single batch request", async ({ page }) => {
        const requests = await mockApiWithCapture(page);

        await openTilesetTab(page);
        await page
            .getByPlaceholder(/sunny grassland village/i)
            .fill("a cozy forest clearing");

        await setGridSize(page, 2, 2);

        await page
            .getByRole("button", { name: /generate tileset/i })
            .click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });

        // 2×2 = 4 tiles fits within one 2048px-max request — a single call.
        expect(requests.length).toBe(1);
        expect(requests[0].width).toBe(2 * 512);
        expect(requests[0].height).toBe(2 * 512);

        // All 4 tiles should have rendered into the preview grid.
        const previewCanvases = page.locator("canvas:visible");
        await expect(previewCanvases).toHaveCount(4);
    });

    test("large grid splits into multiple sequential batches without shrinking per-tile resolution", async ({
        page,
    }) => {
        const requests = await mockApiWithCapture(page);

        await openTilesetTab(page);
        await page
            .getByPlaceholder(/sunny grassland village/i)
            .fill("a sprawling desert town");

        // 8×4 = 32 tiles — well beyond a single request's budget.
        await setGridSize(page, 8, 4);

        await page
            .getByRole("button", { name: /generate tileset/i })
            .click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 20000 });

        // Each batch covers at most 4 columns × 1 row (4×512=2048 max width),
        // so 8 cols × 4 rows requires 2 column-blocks × 4 row-blocks = 8 calls.
        expect(requests.length).toBe(8);

        for (const req of requests) {
            // Per-tile width must stay at the fixed 512px unit budget —
            // never shrunk to squeeze more tiles into one canvas.
            expect(req.width / 4).toBe(512);
            expect(req.height).toBe(512);
        }

        const previewCanvases = page.locator("canvas:visible");
        await expect(previewCanvases).toHaveCount(32);
    });
});
