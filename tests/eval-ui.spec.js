import { test, expect } from "@playwright/test";

// Pre-generated 64x64 red PNG as base64 (large enough for pixel processor)
const TEST_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlElEQVR4nO3QMREAMBDDsPAn/YWhoR60+7zb7mfTAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA9DiOHSbdjxEgAAAABJRU5ErkJggg==";

test.describe("Eval loop UI", () => {
    test("A/B winner button records a trial through the eval endpoint", async ({
        page,
    }) => {
        await page.route("**/api/pollinations/**", (route) =>
            route.fulfill({
                status: 200,
                contentType: "image/png",
                body: Buffer.from(TEST_PNG_BASE64, "base64"),
            }),
        );

        // Intercept the record endpoint so tests never write the repo's
        // real findings.json; capture the payload for assertions.
        const recorded = [];
        await page.route("**/api/eval/record", async (route) => {
            recorded.push(JSON.parse(route.request().postData()));
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    ok: true,
                    trial: { id: "t-test" },
                    ideal: { trials: 1 },
                }),
            });
        });

        await page.goto("/");
        await page.getByRole("tab", { name: /a\/b test/i }).click();
        await page
            .getByPlaceholder("e.g. a red dragon breathing fire")
            .fill("a red mushroom");
        await page.getByRole("button", { name: /run comparison/i }).click();
        await expect(page.getByText(/Comparison complete/)).toBeVisible({
            timeout: 15000,
        });

        await page.getByRole("button", { name: /b wins/i }).click();
        await expect(page.getByText(/Recorded: B wins/)).toBeVisible();
        await expect(page.getByText("Verdict recorded ✓")).toBeVisible();

        expect(recorded.length).toBe(1);
        expect(recorded[0].winner).toBe("b");
        expect(recorded[0].target).toBe("nes");
        expect(recorded[0].a.model).toBe("flux");
        expect(recorded[0].b.model).toBe("gptimage");
        expect(recorded[0].prompt).toBe("a red mushroom");

        // Buttons disable after a verdict so one comparison = one trial.
        await expect(
            page.getByRole("button", { name: /a wins/i }),
        ).toBeDisabled();
    });

    test("Generator's Ideal button applies recorded settings for the target", async ({
        page,
    }) => {
        await page.route("**/api/eval/findings", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    version: 1,
                    ideal: {
                        nes: {
                            settings: {
                                model: "flux",
                                spriteSize: "48x48",
                                pipeline: "enhanced",
                                dithering: "bayer",
                                outlines: false,
                                cleanup: true,
                                preprocessing: "none",
                            },
                            trials: 3,
                            updatedAt: "2026-07-13T00:00:00Z",
                        },
                    },
                    trials: [],
                }),
            }),
        );

        await page.goto("/");
        await page
            .getByRole("button", { name: "Apply ideal settings" })
            .click();

        await expect(
            page.getByText(/Applied ideal settings for NES/),
        ).toBeVisible();

        // Selects reflect the recorded ideal: size, dither, preprocessing
        await expect(page.locator("select").nth(1)).toHaveValue("48x48");
        await expect(page.locator("select").nth(4)).toHaveValue("bayer");
        await expect(page.locator("select").nth(6)).toHaveValue("none");
        // Outlines checkbox turned off by the ideal
        await expect(
            page.getByRole("checkbox", { name: /outlines/i }),
        ).not.toBeChecked();
    });

    test("Ideal button falls back to baseline when no trials exist", async ({
        page,
    }) => {
        await page.route("**/api/eval/findings", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ version: 1, ideal: {}, trials: [] }),
            }),
        );

        await page.goto("/");
        await page
            .getByRole("button", { name: "Apply ideal settings" })
            .click();

        await expect(
            page.getByText(/No trials recorded for NES yet/),
        ).toBeVisible();
    });
});
