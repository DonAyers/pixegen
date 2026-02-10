import { test, expect } from '@playwright/test';

// Pre-generated 4x4 red PNG as base64 (avoids needing zlib at runtime)
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==';

function getTestPngBuffer() {
  return Buffer.from(TEST_PNG_BASE64, 'base64');
}

test.describe('PixelGen UI', () => {
  test('should have all UI elements visible', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#input-field')).toBeVisible();
    await expect(page.locator('#generate-btn')).toBeVisible();
    await expect(page.locator('#sprite-size')).toBeVisible();
    await expect(page.locator('#dither-mode')).toBeVisible();
    await expect(page.locator('#show-grid')).toBeVisible();
    await expect(page.locator('#pixel-canvas')).toBeAttached();
    await expect(page.locator('#source-placeholder')).toBeVisible();
    await expect(page.locator('#pixel-placeholder')).toBeVisible();
  });

  test('should show error when generating with empty input', async ({ page }) => {
    await page.goto('/');
    await page.locator('#generate-btn').click();
    await expect(page.locator('#status')).toContainText('Please enter a description');
  });

  test('should disable button during generation', async ({ page }) => {
    await page.route('**/api/generate/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: getTestPngBuffer(),
      });
    });

    await page.goto('/');
    await page.locator('#input-field').fill('a test sprite');
    await page.locator('#generate-btn').click();

    // Button should be disabled while generating
    await expect(page.locator('#generate-btn')).toBeDisabled();

    // Wait for generation to complete
    await expect(page.locator('#generate-btn')).toBeEnabled({ timeout: 15000 });
  });

  test('should generate and display pixel art from mocked image', async ({ page }) => {
    await page.route('**/api/generate/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: getTestPngBuffer(),
      });
    });

    await page.goto('/');
    await page.locator('#input-field').fill('a red mushroom');
    await page.locator('#generate-btn').click();

    // Wait for completion
    await expect(page.locator('#status')).toContainText('Done!', { timeout: 15000 });

    // Source image should be visible
    await expect(page.locator('#source-image')).toBeVisible();

    // Pixel canvas should be visible
    await expect(page.locator('#pixel-canvas')).toBeVisible();

    // Placeholders should be hidden
    await expect(page.locator('#source-placeholder')).toBeHidden();
    await expect(page.locator('#pixel-placeholder')).toBeHidden();
  });

  test('should allow changing sprite size and dithering', async ({ page }) => {
    await page.goto('/');

    await page.locator('#sprite-size').selectOption('16x16');
    await expect(page.locator('#sprite-size')).toHaveValue('16x16');

    await page.locator('#dither-mode').selectOption('FloydSteinberg');
    await expect(page.locator('#dither-mode')).toHaveValue('FloydSteinberg');

    await page.locator('#show-grid').check();
    await expect(page.locator('#show-grid')).toBeChecked();
  });

  test('should handle Enter key to generate', async ({ page }) => {
    await page.route('**/api/generate/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: getTestPngBuffer(),
      });
    });

    await page.goto('/');
    await page.locator('#input-field').fill('a blue sword');
    await page.locator('#input-field').press('Enter');

    // Should start generating and finish
    await expect(page.locator('#status')).toContainText('Done!', { timeout: 15000 });
  });
});
