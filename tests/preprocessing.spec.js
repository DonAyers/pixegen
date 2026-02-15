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
    const generateButton = page.locator('button').filter({ hasText: 'Generate' });
    await generateButton.click();

    // Wait for generation to complete by checking for disabled state to clear
    await generateButton.waitFor({ state: 'attached' });
    await page.waitForTimeout(500); // Small delay for processing
    
    // Check that canvas has been rendered
    const hasContent = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Check for non-transparent pixels
      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0) return true;
      }
      return false;
    });
    
    expect(hasContent).toBeTruthy();
  });
});
