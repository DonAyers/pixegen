/**
 * Tests for image preprocessing functionality
 */
import { test, expect } from '@playwright/test';

test.describe('Image Preprocessing', () => {
  test('preprocessing controls should be visible', async ({ page }) => {
    await page.goto('/');
    
    // Check preprocessing dropdown exists
    const preprocessingSelect = page.locator('select').filter({ hasText: /Preprocessing/ }).first();
    await expect(preprocessingSelect.or(page.locator('text=Preprocessing').locator('..'))).toBeAttached();
  });

  test('should have preprocessing preset options', async ({ page }) => {
    await page.goto('/');
    
    // The preprocessing dropdown should have the preset options
    // Since we're using Chakra UI, we need to find the actual select element
    const page_content = await page.content();
    
    // Check that preprocessing options exist in the page
    expect(page_content).toContain('None');
    expect(page_content).toContain('Standard');
    expect(page_content).toContain('Strong');
    expect(page_content).toContain('Animation');
  });

  test('preprocessing should work with image generation', async ({ page }) => {
    // Pre-generated 4x4 red PNG as base64
    const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==';
    
    function getTestPngBuffer() {
      return Buffer.from(TEST_PNG_BASE64, 'base64');
    }

    // Mock the API
    await page.route('**/api/generate/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: getTestPngBuffer(),
      });
    });

    await page.goto('/');
    
    // Fill in prompt and generate
    await page.locator('input[placeholder*="mushroom"]').or(page.locator('#prompt')).or(page.locator('input[type="text"]').first()).fill('a red mushroom');
    
    // Click generate button
    await page.locator('button').filter({ hasText: 'Generate' }).click();

    // Wait for completion
    await page.waitForTimeout(5000);
    
    // Source and pixel canvas should be visible
    const hasContent = await page.evaluate(() => {
      const sourceImg = document.querySelector('img[alt*="source"]') || document.querySelector('img[src*="blob"]');
      const canvas = document.querySelector('canvas');
      return !!(sourceImg && canvas);
    });
    
    expect(hasContent).toBeTruthy();
  });
});
