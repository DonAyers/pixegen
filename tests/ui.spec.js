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
    await expect(page.locator('#console-select')).toBeVisible();
    await expect(page.locator('#sprite-size')).toBeVisible();
    await expect(page.locator('#model-select')).toBeVisible();
    await expect(page.locator('#dither-mode')).toBeVisible();
    await expect(page.locator('#show-grid')).toBeVisible();
    await expect(page.locator('#transparent-bg')).toBeVisible();
    await expect(page.locator('#negative-prompt')).toBeVisible();
    await expect(page.locator('#seed-input')).toBeVisible();
    await expect(page.locator('#anim-state')).toBeVisible();
    await expect(page.locator('#view-select')).toBeVisible();
    await expect(page.locator('#frame-prev')).toBeVisible();
    await expect(page.locator('#frame-next')).toBeVisible();
    await expect(page.locator('#frame-indicator')).toBeVisible();
    await expect(page.locator('#gen-all-frames')).toBeVisible();
    await expect(page.locator('#frame-strip')).toBeAttached();
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

  test('should allow changing controls', async ({ page }) => {
    await page.goto('/');

    // Console select defaults to NES and can be changed
    await expect(page.locator('#console-select')).toHaveValue('nes');
    await page.locator('#console-select').selectOption('gameboy');
    await expect(page.locator('#console-select')).toHaveValue('gameboy');

    // Sprite-size should update to valid sizes for the selected console
    const sizeOptions = await page.locator('#sprite-size option').allTextContents();
    expect(sizeOptions.length).toBeGreaterThan(0);

    // Dithering
    await page.locator('#dither-mode').selectOption('FloydSteinberg');
    await expect(page.locator('#dither-mode')).toHaveValue('FloydSteinberg');

    // Grid and transparent checkboxes
    await page.locator('#show-grid').check();
    await expect(page.locator('#show-grid')).toBeChecked();
    await page.locator('#transparent-bg').check();
    await expect(page.locator('#transparent-bg')).toBeChecked();

    // Negative prompt
    await page.locator('#negative-prompt').fill('blurry, realistic');
    await expect(page.locator('#negative-prompt')).toHaveValue('blurry, realistic');

    // Animation state selector defaults to idle
    await expect(page.locator('#anim-state')).toHaveValue('idle');
    await page.locator('#anim-state').selectOption('walk');
    await expect(page.locator('#anim-state')).toHaveValue('walk');

    // View selector defaults to side
    await expect(page.locator('#view-select')).toHaveValue('side');
    await page.locator('#view-select').selectOption('front');
    await expect(page.locator('#view-select')).toHaveValue('front');
  });

  test('should update console info on console change', async ({ page }) => {
    await page.goto('/');

    // Default NES info
    await expect(page.locator('#console-info')).toContainText('Nintendo Entertainment System');
    await expect(page.locator('#pixel-label')).toContainText('NES');

    // Switch to Game Boy
    await page.locator('#console-select').selectOption('gameboy');
    await expect(page.locator('#console-info')).toContainText('Nintendo Game Boy');
    await expect(page.locator('#pixel-label')).toContainText('Game Boy');
  });

  test('should update frame indicator on animation state change', async ({ page }) => {
    await page.goto('/');

    // Default idle = 2 frames
    await expect(page.locator('#frame-indicator')).toContainText('1 / 2');

    // Switch to walk = 4 frames
    await page.locator('#anim-state').selectOption('walk');
    await expect(page.locator('#frame-indicator')).toContainText('1 / 4');

    // Switch to crouch = 1 frame
    await page.locator('#anim-state').selectOption('crouch');
    await expect(page.locator('#frame-indicator')).toContainText('1 / 1');
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
