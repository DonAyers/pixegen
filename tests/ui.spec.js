import { test, expect } from "@playwright/test";

// Pre-generated 64x64 red PNG as base64 (large enough for pixel processor)
const TEST_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlElEQVR4nO3QMREAMBDDsPAn/YWhoR60+7zb7mfTAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA9DiOHSbdjxEgAAAABJRU5ErkJggg==";

function getTestPngBuffer() {
    return Buffer.from(TEST_PNG_BASE64, "base64");
}

// Helper: mock all Pollinations API calls
async function mockApi(page) {
    await page.route("**/api/pollinations/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: getTestPngBuffer(),
        });
    });
    // Also cover the legacy /api/generate path
    await page.route("**/api/generate/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: getTestPngBuffer(),
        });
    });
}

test.describe("PixelGen UI", () => {
    test("should have all UI elements visible", async ({ page }) => {
        await page.goto("/");

        await expect(
            page.getByPlaceholder("e.g. a knight with a sword"),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Generate", exact: true }),
        ).toBeVisible();
        await expect(page.locator("select").nth(0)).toBeVisible(); // console
        await expect(page.locator("select").nth(1)).toBeVisible(); // size
        await expect(page.locator("select").nth(2)).toBeVisible(); // model
        await expect(page.locator("select").nth(3)).toBeVisible(); // pipeline
        await expect(page.locator("select").nth(4)).toBeVisible(); // dither
        await expect(page.locator("select").nth(5)).toBeVisible(); // preprocessing
        await expect(page.locator("select").nth(6)).toBeVisible(); // animation
        await expect(page.locator("select").nth(7)).toBeVisible(); // view
        await expect(
            page.getByRole("tab", { name: /generator/i }),
        ).toBeVisible();
        await expect(
            page.getByRole("tab", { name: /inspector/i }),
        ).toBeVisible();
        await expect(
            page.getByRole("tab", { name: /explorer/i }),
        ).toBeVisible();
    });

    test("should show error when generating with empty input", async ({
        page,
    }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Generate", exact: true }).click();
        await expect(
            page.getByText("Please enter a description"),
        ).toBeVisible();
    });

    test("should disable button during generation", async ({ page }) => {
        await mockApi(page);

        await page.goto("/");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a test sprite");
        await page.getByRole("button", { name: "Generate", exact: true }).click();

        // Button text changes to "Generating..." while loading
        await expect(
            page.getByRole("button", { name: /generating/i }),
        ).toBeVisible();

        // Wait for generation to complete
        await expect(
            page.getByRole("button", { name: "Generate", exact: true }),
        ).toBeVisible({ timeout: 15000 });
    });

    test("surfaces the upstream error reason when generation fails", async ({
        page,
    }) => {
        // Mimic Pollinations' real 422 error envelope (e.g. an upstream
        // content-moderation block) — the UI must show the reason, not a
        // generic "Failed to fetch".
        await page.route("**/api/pollinations/**", async (route) => {
            await route.fulfill({
                status: 422,
                contentType: "application/json",
                body: JSON.stringify({
                    success: false,
                    error: {
                        message:
                            "Your request was rejected by content moderation.",
                        code: "content_policy_violation",
                    },
                }),
            });
        });

        await page.goto("/");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a test sprite");
        await page.getByRole("button", { name: "Generate", exact: true }).click();

        // The error toast must carry the status and the upstream reason.
        await expect(
            page.getByText("Generation failed", { exact: true }),
        ).toBeVisible({ timeout: 15000 });
        await expect(
            page.getByText(/HTTP 422.*content moderation/),
        ).toBeVisible();

        // The Inspector records the failure for post-mortem inspection.
        await page.getByRole("tab", { name: /inspector/i }).click();
        await expect(page.getByText("FAILED (HTTP 422)")).toBeVisible();
        await expect(page.getByText("Last Error")).toBeVisible();
    });

    test("should generate and display pixel art from mocked image", async ({
        page,
    }) => {
        await mockApi(page);

        await page.goto("/");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a red mushroom");
        await page.getByRole("button", { name: "Generate", exact: true }).click();

        // Wait for completion — the toast says "Done!"
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });

        // Source image should be visible
        await expect(page.getByAltText("Generated source")).toBeVisible();

        // Pixel canvas should be visible
        await expect(page.locator("canvas").first()).toBeVisible();
    });

    test("should allow changing controls", async ({ page }) => {
        await page.goto("/");

        // Console select defaults to NES and can be changed
        const consoleSelect = page.locator("select").nth(0);
        await expect(consoleSelect).toHaveValue("nes");
        await consoleSelect.selectOption("gameboy");
        await expect(consoleSelect).toHaveValue("gameboy");

        // Sprite-size should update to valid sizes for the selected console
        const sizeSelect = page.locator("select").nth(1);
        const sizeOptions = await sizeSelect
            .locator("option")
            .allTextContents();
        expect(sizeOptions.length).toBeGreaterThan(0);

        // Dithering — enhanced mode shows Bayer option
        const pipelineSelect = page.locator("select").nth(3);
        await expect(pipelineSelect).toHaveValue("enhanced");
        const ditherSelect = page.locator("select").nth(4);
        const ditherOpts = await ditherSelect
            .locator("option")
            .allTextContents();
        expect(ditherOpts).toContain("Bayer 4×4 (pixel art style)");

        // Switch to classic mode — dithering options should change
        await pipelineSelect.selectOption("classic");
        const classicDitherOpts = await ditherSelect
            .locator("option")
            .allTextContents();
        expect(classicDitherOpts).toContain("Floyd-Steinberg");

        // Switch back to enhanced
        await pipelineSelect.selectOption("enhanced");

        // Grid and transparent checkboxes — use force:true to bypass Chakra's
        // decorative <span> that intercepts pointer events.
        const gridCheckbox = page.getByRole("checkbox", { name: /grid/i });
        await gridCheckbox.check({ force: true });
        await expect(gridCheckbox).toBeChecked();

        // Transparent BG is gated on model capability — the default model
        // (flux) doesn't support it, so the checkbox starts disabled.
        const transparentCheckbox = page.getByRole("checkbox", {
            name: /transparent/i,
        });
        await expect(transparentCheckbox).toBeDisabled();

        // Switching to a GPT Image model (which supports transparency)
        // enables the toggle.
        const modelSelect = page.locator("select").nth(2);
        await modelSelect.selectOption("pollinations:gptimage");
        await expect(transparentCheckbox).toBeEnabled();
        await transparentCheckbox.check({ force: true });
        await expect(transparentCheckbox).toBeChecked();
        await modelSelect.selectOption("pollinations:flux");

        // Negative prompt (scoped to the Generator tab — Tileset Studio has
        // an identical-placeholder field of its own).
        const negInput = page
            .getByRole("tabpanel", { name: "Generator" })
            .getByPlaceholder("blurry, soft focus, photorealistic");
        await negInput.fill("blurry, realistic");
        await expect(negInput).toHaveValue("blurry, realistic");

        // Animation state selector defaults to idle
        const animSelect = page.locator("select").nth(6);
        await expect(animSelect).toHaveValue("idle");
        await animSelect.selectOption("walk");
        await expect(animSelect).toHaveValue("walk");

        // View selector defaults to side
        const viewSelect = page.locator("select").nth(7);
        await expect(viewSelect).toHaveValue("side");
        await viewSelect.selectOption("front");
        await expect(viewSelect).toHaveValue("front");
    });

    test("should update console info on console change", async ({ page }) => {
        await page.goto("/");

        // Default NES info
        await expect(
            page.getByText("Nintendo Entertainment System"),
        ).toBeVisible();

        // Switch to Game Boy
        const consoleSelect = page.locator("select").nth(0);
        await consoleSelect.selectOption("gameboy");
        await expect(page.getByText("Nintendo Game Boy")).toBeVisible();
    });

    test("should update frame indicator on animation state change", async ({
        page,
    }) => {
        await page.goto("/");

        // Default idle = 2 frames
        await expect(page.getByText("1 / 2")).toBeVisible();

        // Switch to walk = 4 frames
        const animSelect = page.locator("select").nth(6);
        await animSelect.selectOption("walk");
        await expect(page.getByText("1 / 4")).toBeVisible();

        // Switch to crouch = 1 frame
        await animSelect.selectOption("crouch");
        await expect(page.getByText("1 / 1")).toBeVisible();
    });

    test("should show preview placeholder when no frames generated", async ({
        page,
    }) => {
        await page.goto("/");

        // FPS can be changed
        const fpsInput = page.locator("input").filter({ hasText: /^$/ }).nth(0);
        await fpsInput.fill("12");
        await expect(fpsInput).toHaveValue("12");

        // Character name input works
        const charInput = page.getByPlaceholder("e.g. knight, dragon...");
        await charInput.fill("test-knight");
        await expect(charInput).toHaveValue("test-knight");
    });

    test("should handle Enter key to generate", async ({ page }) => {
        await mockApi(page);

        await page.goto("/");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a blue sword");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .press("Enter");

        // Should start generating and finish
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });
    });

    test("should generate sprite sheet and populate all frames", async ({
        page,
    }) => {
        await mockApi(page);

        await page.goto("/");

        // Default idle has 2 frames
        await expect(page.getByText("1 / 2")).toBeVisible();

        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a red knight");
        await page
            .getByRole("button", { name: /generate all frames/i })
            .click();

        // Should complete and show success
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });
        await expect(
            page.getByText("Done! 2-frame sprite sheet"),
        ).toBeVisible();

        // Pixel canvas should be visible
        await expect(page.locator("canvas").first()).toBeVisible();
    });

    test("should navigate to Inspector and Explorer tabs", async ({ page }) => {
        await page.goto("/");

        const inspectorTab = page.getByRole("tab", { name: /inspector/i });
        await inspectorTab.click();
        await expect(
            page.getByRole("heading", { name: /request inspector/i }),
        ).toBeVisible();

        const explorerTab = page.getByRole("tab", { name: /explorer/i });
        await explorerTab.click();
        await expect(
            page.getByRole("heading", { name: /explorer/i }),
        ).toBeVisible();
        await expect(page.getByText("No saved generations yet")).toBeVisible();

        const generatorTab = page.getByRole("tab", { name: /generator/i });
        await generatorTab.click();
        await expect(
            page.getByPlaceholder("e.g. a knight with a sword"),
        ).toBeVisible();
    });

    test("should persist generation and show it in Explorer", async ({
        page,
    }) => {
        await mockApi(page);

        await page.goto("/");
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a red knight");
        await page.getByRole("button", { name: "Generate", exact: true }).click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });

        // Open Explorer tab
        await page.getByRole("tab", { name: /explorer/i }).click();
        await expect(
            page.getByRole("heading", { name: /explorer/i }),
        ).toBeVisible();

        // Should list the auto-saved generation
        await expect(page.getByText("untitled")).toBeVisible();
        await expect(page.getByText(/idle\/side/)).toBeVisible();

        // Selecting it should show source + dithered
        await page.getByText("untitled").first().click();
        await expect(page.getByAltText("Source generation")).toBeVisible();
        await expect(page.getByAltText("Dithered frame")).toBeVisible();
    });

    test("should manage prompt history in the sidebar", async ({ page }) => {
        await page.goto("/");
        const sidebar = page.locator("aside");

        // 1. Sidebar is always visible; switch to the Prompts view
        await expect(sidebar).toBeVisible();
        await sidebar.getByRole("button", { name: "Prompts" }).click();
        await expect(sidebar.getByText("No prompts found")).toBeVisible();

        // 2. Generate a random prompt
        await page.getByRole("button", { name: "Random prompt idea" }).click();
        const randomPromptVal = await page.getByPlaceholder("e.g. a knight with a sword").inputValue();
        expect(randomPromptVal.length).toBeGreaterThan(0);

        // 3. Check that it was recorded in history
        await expect(sidebar.getByText(randomPromptVal)).toBeVisible();
        await expect(sidebar.getByText("random", { exact: true })).toBeVisible();

        // 4. Record a manual user prompt
        await page.getByPlaceholder("e.g. a knight with a sword").fill("custom user warrior");

        // Mock API so we can click Generate
        await mockApi(page);
        await page.getByRole("button", { name: "Generate", exact: true }).click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });

        // Verify custom user warrior is there
        await expect(sidebar.getByText("custom user warrior")).toBeVisible();
        await expect(sidebar.getByText("user", { exact: true })).toBeVisible();

        // 5. Test search filter
        await page.getByPlaceholder("Search history...").fill("custom");
        await expect(sidebar.getByText("custom user warrior")).toBeVisible();
        await expect(sidebar.getByText(randomPromptVal)).not.toBeVisible();

        // Clear search
        await page.getByPlaceholder("Search history...").fill("");

        // 6. Test type filters
        await sidebar.getByRole("button", { name: "User", exact: true }).click();
        await expect(sidebar.getByText("custom user warrior")).toBeVisible();
        await expect(sidebar.getByText(randomPromptVal)).not.toBeVisible();

        await sidebar.getByRole("button", { name: "Random", exact: true }).click();
        await expect(sidebar.getByText(randomPromptVal)).toBeVisible();
        await expect(sidebar.getByText("custom user warrior")).not.toBeVisible();

        await sidebar.getByRole("button", { name: "All", exact: true }).click();
        await expect(sidebar.getByText("custom user warrior")).toBeVisible();
        await expect(sidebar.getByText(randomPromptVal)).toBeVisible();

        // 7. Click a prompt item in the list to load it
        await page.getByPlaceholder("e.g. a knight with a sword").fill("");
        await sidebar.getByText("custom user warrior").click();
        await expect(page.getByPlaceholder("e.g. a knight with a sword")).toHaveValue("custom user warrior");

        // 8. Copy button is present on prompt cards
        const copyButton = sidebar.locator("button[aria-label='Copy prompt']").first();
        await expect(copyButton).toBeVisible();

        // 9. Clear history
        page.on("dialog", async (dialog) => {
            expect(dialog.message()).toContain("clear your prompt history");
            await dialog.accept();
        });
        await sidebar.getByRole("button", { name: "Clear History" }).click();
        await expect(sidebar.getByText("No prompts found")).toBeVisible();
    });

    test("gear icon opens the sidebar Settings view with the free-tier toggle", async ({
        page,
    }) => {
        await page.goto("/");
        const sidebar = page.locator("aside");

        // Settings is reachable from the sidebar toggle...
        await sidebar.getByRole("button", { name: "Settings" }).click();
        await expect(
            sidebar.getByText("Use free tier when available"),
        ).toBeVisible();

        // ...and from the header gear, from any other view
        await sidebar.getByRole("button", { name: "Runs" }).click();
        await expect(
            sidebar.getByText("Use free tier when available"),
        ).not.toBeVisible();
        await page
            .getByRole("button", { name: "Settings", exact: true })
            .last()
            .click();
        await expect(
            sidebar.getByText("Use free tier when available"),
        ).toBeVisible();

        // The toggle persists across reloads
        await sidebar.getByText("Use free tier when available").click();
        await page.reload();
        await page.locator("aside").getByRole("button", { name: "Settings" }).click();
        await expect(
            page.locator("aside").locator("input[type=checkbox]").first(),
        ).toBeChecked();
    });

    test("tracks generation runs in the sidebar with granular statuses", async ({
        page,
    }) => {
        await mockApi(page);
        await page.goto("/");
        const sidebar = page.locator("aside");

        // Runs view is the default and starts empty
        await expect(
            sidebar.getByText(/No generation runs yet/),
        ).toBeVisible();

        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a tracked knight");
        await page.getByRole("button", { name: "Generate", exact: true }).click();
        await expect(page.getByText(/Done!/)).toBeVisible({ timeout: 15000 });

        // The run appears with an id and reaches the completed state
        await expect(sidebar.getByText("Request 1")).toBeVisible();
        await expect(sidebar.getByText("complete", { exact: true })).toBeVisible();

        // Expanding shows the run summary: prompt, model, and the status
        // timeline with the granular stages
        await sidebar.getByText("Request 1").click();
        await expect(sidebar.getByText("Timeline")).toBeVisible();
        await expect(
            sidebar.getByText("generating", { exact: true }),
        ).toBeVisible();
        await expect(
            sidebar.getByText("processing", { exact: true }),
        ).toBeVisible();
        await expect(
            sidebar.locator("code").getByText("a tracked knight"),
        ).toBeVisible();

        // A failing generation is tracked as an error run
        await page.unrouteAll();
        await page.route("**/api/pollinations/**", async (route) => {
            await route.fulfill({
                status: 422,
                contentType: "application/json",
                body: JSON.stringify({
                    success: false,
                    error: { message: "moderation says no", code: "content_policy_violation" },
                }),
            });
        });
        await page
            .getByPlaceholder("e.g. a knight with a sword")
            .fill("a doomed knight");
        await page.getByRole("button", { name: "Generate", exact: true }).click();
        await expect(sidebar.getByText("Request 2")).toBeVisible({
            timeout: 15000,
        });
        await expect(sidebar.getByText("error", { exact: true })).toBeVisible();
    });
});
