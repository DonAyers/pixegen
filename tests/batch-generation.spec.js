import { test, expect } from "@playwright/test";

// Pre-generated 64x64 red PNG as base64 (large enough for pixel processor)
const TEST_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlElEQVR4nO3QMREAMBDDsPAn/YWhoR60+7zb7mfTAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA9DiOHSbdjxEgAAAABJRU5ErkJggg==";

function getTestPngBuffer() {
    return Buffer.from(TEST_PNG_BASE64, "base64");
}

// Track every request made to the mocked provider endpoint so tests can
// assert how many sequential batch calls a given generation triggered, and
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

test.describe("Batched generation resolution scaling", () => {
    test("per-frame width does not shrink as frame count grows", async ({
        page,
    }) => {
        const requests = await mockApiWithCapture(page);

        await page.goto("/");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a red knight");

        // Default animation state is idle (2 frames).
        await expect(page.getByText("1 / 2")).toBeVisible();
        await page
            .getByRole("button", { name: /generate all frames/i })
            .click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });

        expect(requests.length).toBeGreaterThan(0);
        const idleRequest = requests[requests.length - 1];
        expect(idleRequest.height).toBe(512);
        // 2 frames × 512px fixed per-frame budget = 1024, not squeezed down.
        expect(idleRequest.width).toBe(1024);
        const idlePerFrameWidth = idleRequest.width / 2;

        // Switch to walk (4 frames) and regenerate.
        const animSelect = page.locator("select").nth(6);
        await animSelect.selectOption("walk");
        await expect(page.getByText("1 / 4")).toBeVisible();

        await page
            .getByRole("button", { name: /generate all frames/i })
            .click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });

        const walkRequest = requests[requests.length - 1];
        expect(walkRequest.height).toBe(512);
        // 4 frames × 512px = 2048 — width grows with frame count instead of
        // being capped/shrunk (old formula produced Math.min(1920, ...)).
        expect(walkRequest.width).toBe(2048);
        const walkPerFrameWidth = walkRequest.width / 4;

        // The key regression check: per-frame resolution must not shrink
        // as the unit count increases.
        expect(walkPerFrameWidth).toBeGreaterThanOrEqual(idlePerFrameWidth);
        expect(walkPerFrameWidth).toBe(512);
    });

    test("single request covers the whole batch within the resolution budget", async ({
        page,
    }) => {
        const requests = await mockApiWithCapture(page);

        await page.goto("/");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a blue mage");

        const animSelect = page.locator("select").nth(6);
        await animSelect.selectOption("walk"); // 4 frames — fits in one 2048px-wide request
        await page
            .getByRole("button", { name: /generate all frames/i })
            .click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });

        // 4 frames × 512 = 2048, exactly the max batch dimension, so this
        // should be a single request rather than split into multiple calls.
        expect(requests.length).toBe(1);
    });
});
