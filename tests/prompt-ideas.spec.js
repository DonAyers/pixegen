import { test, expect } from "@playwright/test";

test.describe("Random prompt idea buttons", () => {
    test("Generator dice fills the prompt with a system-inspired idea", async ({
        page,
    }) => {
        await page.goto("/");

        const promptInput = page.getByPlaceholder(
            "e.g. a knight with a sword",
        );
        await expect(promptInput).toHaveValue("");

        await page
            .getByRole("button", { name: "Random prompt idea" })
            .click();

        const value = await promptInput.inputValue();
        expect(value.length).toBeGreaterThan(10);
        expect(value).toContain("inspired by");

        // Rolling again produces a (very likely) different idea; at minimum
        // the input stays a valid non-empty idea.
        await page
            .getByRole("button", { name: "Random prompt idea" })
            .click();
        expect(await promptInput.inputValue()).toContain("inspired by");
    });

    test("Tileset dice fills the theme prompt", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("tab", { name: /tileset/i }).click();

        const themeInput = page.getByPlaceholder(/sunny grassland village/i);
        await page
            .getByRole("button", { name: "Random tileset idea" })
            .click();

        const value = await themeInput.inputValue();
        expect(value).toContain("inspired by");
    });

    test("A/B Test dice fills the comparison prompt", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("tab", { name: /a\/b test/i }).click();

        const promptInput = page.getByPlaceholder(
            "e.g. a red dragon breathing fire",
        );
        await page
            .getByRole("button", { name: "Random prompt idea" })
            .click();

        const value = await promptInput.inputValue();
        expect(value).toContain("inspired by");
    });
});
