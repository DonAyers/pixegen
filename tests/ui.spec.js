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
    await expect(page.locator('#pipeline-mode')).toBeVisible();
    await expect(page.locator('#outlines')).toBeVisible();
    await expect(page.locator('#cleanup')).toBeVisible();
    await expect(page.locator('#frame-prev')).toBeVisible();
    await expect(page.locator('#frame-next')).toBeVisible();
    await expect(page.locator('#frame-indicator')).toBeVisible();
    await expect(page.locator('#gen-all-frames')).toBeVisible();
    await expect(page.locator('#gen-sheet')).toBeVisible();
    await expect(page.locator('#prompt-debug')).toBeAttached();
    await expect(page.locator('#frame-strip')).toBeAttached();
    await expect(page.locator('#preview-canvas')).toBeAttached();
    await expect(page.locator('#play-btn')).toBeVisible();
    await expect(page.locator('#stop-btn')).toBeVisible();
    await expect(page.locator('#fps-input')).toBeVisible();
    await expect(page.locator('#char-name')).toBeVisible();
    await expect(page.locator('#save-frames-btn')).toBeVisible();
    await expect(page.locator('#export-sheet-btn')).toBeVisible();
    await expect(page.locator('#load-btn')).toBeVisible();
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

    // Dithering — enhanced mode shows Bayer option
    await expect(page.locator('#pipeline-mode')).toHaveValue('enhanced');
    const ditherOpts = await page.locator('#dither-mode option').allTextContents();
    expect(ditherOpts).toContain('Bayer 4×4 (pixel art style)');

    // Switch to classic mode — dithering options should change
    await page.locator('#pipeline-mode').selectOption('classic');
    const classicDitherOpts = await page.locator('#dither-mode option').allTextContents();
    expect(classicDitherOpts).toContain('Floyd-Steinberg');

    // Switch back to enhanced
    await page.locator('#pipeline-mode').selectOption('enhanced');

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

  test('should show preview placeholder when no frames generated', async ({ page }) => {
    await page.goto('/');

    // Preview placeholder should be visible, canvas hidden
    await expect(page.locator('#preview-placeholder')).toBeVisible();

    // FPS can be changed
    await page.locator('#fps-input').fill('12');
    await expect(page.locator('#fps-input')).toHaveValue('12');

    // Character name input works
    await page.locator('#char-name').fill('test-knight');
    await expect(page.locator('#char-name')).toHaveValue('test-knight');
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

  test('should generate sprite sheet and populate all frames', async ({ page }) => {
    // Create a wider test PNG (8x4) to simulate a 2-frame sprite sheet
    await page.route('**/api/generate/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: getTestPngBuffer(),
      });
    });

    await page.goto('/');

    // Default idle has 2 frames
    await expect(page.locator('#frame-indicator')).toContainText('1 / 2');

    await page.locator('#input-field').fill('a red knight');
    await page.locator('#gen-sheet').click();

    // Should complete and show success
    await expect(page.locator('#status')).toContainText('Done!', { timeout: 15000 });
    await expect(page.locator('#status')).toContainText('sprite sheet');

    // Both frame thumbnails should be filled (not empty)
    const filledThumbs = page.locator('.frame-thumb:not(.empty)');
    await expect(filledThumbs).toHaveCount(2);

    // Pixel canvas should be visible
    await expect(page.locator('#pixel-canvas')).toBeVisible();
  });

  test('should navigate to Inspector view and display request details', async ({ page }) => {
    // Mock image generation
    await page.route('**/api/generate/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: getTestPngBuffer(),
      });
    });

    await page.goto('/');

    // Initially on generator view
    await expect(page.locator('#generator-view')).toHaveClass(/active/);
    await expect(page.locator('#inspector-view')).not.toHaveClass(/active/);

    // Generate an image to populate lastRequest
    await page.locator('#input-field').fill('a red knight');
    await page.locator('#generate-btn').click();
    await expect(page.locator('#status')).toContainText('Done!', { timeout: 15000 });

    // Click Inspector nav button
    const inspectorBtn = page.locator('.nav-link[data-view="inspector"]');
    await expect(inspectorBtn).toBeVisible();
    await inspectorBtn.click();

    // Inspector view should be active, generator hidden
    await expect(page.locator('#inspector-view')).toHaveClass(/active/);
    await expect(page.locator('#generator-view')).not.toHaveClass(/active/);

    // Verify inspector fields are populated from lastRequest
    await expect(page.locator('#inspector-provider')).not.toContainText('—');
    await expect(page.locator('#inspector-model')).not.toContainText('—');
    await expect(page.locator('#inspector-type')).toContainText('Single');
    await expect(page.locator('#inspector-dimensions')).toContainText('512');
    await expect(page.locator('#inspector-prompt')).not.toContainText('—');
    await expect(page.locator('#inspector-url')).toContainText('/api/');

    // Click back to Generator
    const generatorBtn = page.locator('.nav-link[data-view="generator"]');
    await generatorBtn.click();
    await expect(page.locator('#generator-view')).toHaveClass(/active/);
    await expect(page.locator('#inspector-view')).not.toHaveClass(/active/);
  });
});
