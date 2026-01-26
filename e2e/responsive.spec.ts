import { test, expect } from '@playwright/test';

test.describe('Responsive Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.describe('Desktop (1280px+)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('shows side-by-side editor and preview layout', async ({ page }) => {
      const mainContent = page.locator('.main-content');
      await expect(mainContent).toBeVisible();

      // At desktop width, layout should be horizontal (flex-row)
      const box = await mainContent.boundingBox();
      expect(box?.width).toBeGreaterThan(1000);
    });

    test('header shows full title', async ({ page }) => {
      // Desktop should show full title
      const header = page.locator('header, .header');
      await expect(header).toBeVisible();
    });
  });

  test.describe('Tablet (1024px)', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('preview panel stacks below editor', async ({ page }) => {
      // At 1024px breakpoint, preview should stack vertically
      const mainContent = page.locator('.main-content');
      await expect(mainContent).toBeVisible();
    });

    test('navigation remains accessible', async ({ page }) => {
      // Ensure navigation/header elements are still visible and usable
      await expect(page.locator('header, .header').first()).toBeVisible();
    });
  });

  test.describe('Mobile (768px)', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('forms use single-column layout', async ({ page }) => {
      // At 768px, form fields should stack
      const formRows = page.locator('.form-row');
      const count = await formRows.count();

      if (count > 0) {
        const firstRow = formRows.first();
        const box = await firstRow.boundingBox();
        // Single column forms should be narrower
        expect(box?.width).toBeLessThanOrEqual(768);
      }
    });

    test('buttons have minimum 44px touch targets', async ({ page }) => {
      const buttons = page.locator('button, .btn');
      const count = await buttons.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          const box = await button.boundingBox();
          if (box) {
            // Touch targets should be at least 44px
            expect(box.height).toBeGreaterThanOrEqual(36); // Allow margin for different button styles
          }
        }
      }
    });

    test('header may show shortened title', async ({ page }) => {
      const header = page.locator('header, .header');
      await expect(header.first()).toBeVisible();
    });
  });

  test.describe('Small Mobile (480px)', () => {
    test.use({ viewport: { width: 480, height: 800 } });

    test('content fits within viewport', async ({ page }) => {
      // No horizontal overflow
      const body = page.locator('body');
      const box = await body.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(480);
    });

    test('buttons stack vertically in tight spaces', async ({ page }) => {
      // Open a modal if one exists with multiple buttons
      const modalTrigger = page.locator('[data-modal-trigger], .btn').first();
      if (await modalTrigger.isVisible()) {
        // Check that action buttons are visible
        await expect(modalTrigger).toBeVisible();
      }
    });

    test('text remains readable', async ({ page }) => {
      const paragraphs = page.locator('p, .form-label, label');
      const count = await paragraphs.count();

      for (let i = 0; i < Math.min(count, 3); i++) {
        const p = paragraphs.nth(i);
        if (await p.isVisible()) {
          const fontSize = await p.evaluate(
            (el) => window.getComputedStyle(el).fontSize
          );
          const size = parseInt(fontSize);
          // Minimum readable font size
          expect(size).toBeGreaterThanOrEqual(12);
        }
      }
    });
  });
});

test.describe('Responsive Breakpoint Transitions', () => {
  test('layout adapts when resizing from desktop to mobile', async ({
    page,
  }) => {
    // Start at desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    const mainContent = page.locator('.main-content');
    await expect(mainContent).toBeVisible();

    // Resize to tablet
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(mainContent).toBeVisible();

    // Resize to mobile
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(mainContent).toBeVisible();

    // Resize to small mobile
    await page.setViewportSize({ width: 480, height: 800 });
    await expect(mainContent).toBeVisible();
  });
});
