import { test, expect } from "@playwright/test";

// Pre-generated 64x64 red PNG as base64 (large enough for pixel processor)
const TEST_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlElEQVR4nO3QMREAMBDDsPAn/YWhoR60+7zb7mfTAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA9DiOHSbdjxEgAAAABJRU5ErkJggg==";

function pngBuffer() {
    return Buffer.from(TEST_PNG_BASE64, "base64");
}

test.describe("Latency levers", () => {
    test("parallel batches: tile grid requests overlap in flight", async ({
        page,
    }) => {
        let inFlight = 0;
        let maxInFlight = 0;
        await page.route("**/api/pollinations/**", async (route) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 400));
            inFlight--;
            await route.fulfill({
                status: 200,
                contentType: "image/png",
                body: pngBuffer(),
            });
        });

        await page.goto("/");
        await page.getByRole("tab", { name: /tileset/i }).click();
        await page
            .getByPlaceholder(/sunny grassland village/i)
            .fill("test terrain");
        await page
            .getByRole("button", { name: /generate tileset/i })
            .click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 20000 });

        // Default 4×4 grid = multiple batch requests; with the parallel
        // setting on (default) they must overlap rather than serialize.
        expect(maxInFlight).toBeGreaterThanOrEqual(2);
    });

    test("failover: slow model is abandoned for the next in the chain", async ({
        page,
    }) => {
        // Enable failover with a 1s threshold before the app boots.
        await page.addInitScript(() => {
            localStorage.setItem(
                "pixegen_settings_v1",
                JSON.stringify({ failoverEnabled: true, failoverSeconds: 1 }),
            );
        });

        const modelsRequested = [];
        await page.route("**/api/pollinations/**", async (route) => {
            const model = new URL(route.request().url()).searchParams.get(
                "model",
            );
            modelsRequested.push(model);
            if (model === "flux") {
                // Slower than the 1s threshold — the client should abort.
                await new Promise((r) => setTimeout(r, 4000));
            }
            await route.fulfill({
                status: 200,
                contentType: "image/png",
                body: pngBuffer(),
            });
        });

        await page.goto("/");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a failover knight");
        await page.getByRole("button", { name: "Generate", exact: true }).click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 20000 });

        // flux was tried first, then abandoned for klein.
        expect(modelsRequested[0]).toBe("flux");
        expect(modelsRequested).toContain("klein");

        // The run tracker records the substitution in the timeline.
        const sidebar = page.locator("aside");
        await sidebar.getByText("Request 1").click();
        await expect(sidebar.getByText(/failover to klein/)).toBeVisible();
    });
});
