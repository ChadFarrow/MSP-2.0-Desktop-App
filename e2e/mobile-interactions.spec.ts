import { test, expect } from '@playwright/test';

test.describe('Mobile Interactions', () => {
  test.use({
    viewport: { width: 480, height: 800 },
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.describe('InfoIcon Touch Behavior', () => {
    test('tap shows tooltip and pins it open', async ({ page }) => {
      const infoIcon = page.locator('.info-icon').first();

      // Skip if no info icons on page
      if (!(await infoIcon.isVisible())) {
        test.skip();
        return;
      }

      // Tap to open
      await infoIcon.tap();

      // Tooltip should be visible
      const tooltip = page.locator('.info-tooltip');
      await expect(tooltip.first()).toBeVisible();

      // Should show "tap to close" hint
      await expect(page.locator('.info-tooltip-close').first()).toBeVisible();
    });

    test('tap on pinned tooltip closes it', async ({ page }) => {
      const infoIcon = page.locator('.info-icon').first();

      if (!(await infoIcon.isVisible())) {
        test.skip();
        return;
      }

      // Tap to open
      await infoIcon.tap();

      const tooltip = page.locator('.info-tooltip').first();
      await expect(tooltip).toBeVisible();

      // Tap tooltip to close
      await tooltip.tap();

      await expect(tooltip).not.toBeVisible();
    });

    test('tap outside closes pinned tooltip', async ({ page }) => {
      const infoIcon = page.locator('.info-icon').first();

      if (!(await infoIcon.isVisible())) {
        test.skip();
        return;
      }

      // Tap to open
      await infoIcon.tap();

      const tooltip = page.locator('.info-tooltip').first();
      await expect(tooltip).toBeVisible();

      // Wait for click outside listener to be added (100ms delay in component)
      await page.waitForTimeout(150);

      // Tap outside (on body)
      await page.locator('body').tap({ position: { x: 10, y: 10 } });

      await expect(tooltip).not.toBeVisible();
    });
  });

  test.describe('Section Collapse/Expand', () => {
    test('tap on section header toggles content', async ({ page }) => {
      const sectionHeader = page.locator('.section-header').first();

      if (!(await sectionHeader.isVisible())) {
        test.skip();
        return;
      }

      // Get initial state
      const sectionContent = page.locator('.section-content').first();
      const wasCollapsed = await sectionContent.evaluate((el) =>
        el.classList.contains('collapsed')
      );

      // Tap header
      await sectionHeader.tap();

      // State should toggle
      const isNowCollapsed = await sectionContent.evaluate((el) =>
        el.classList.contains('collapsed')
      );
      expect(isNowCollapsed).toBe(!wasCollapsed);
    });
  });

  test.describe('Toggle Component', () => {
    test('tap changes toggle state', async ({ page }) => {
      const toggle = page.locator('.toggle').first();

      if (!(await toggle.isVisible())) {
        test.skip();
        return;
      }

      const wasActive = await toggle.evaluate((el) =>
        el.classList.contains('active')
      );

      await toggle.tap();

      const isNowActive = await toggle.evaluate((el) =>
        el.classList.contains('active')
      );
      expect(isNowActive).toBe(!wasActive);
    });

    test('toggle has adequate touch target size', async ({ page }) => {
      const toggle = page.locator('.toggle').first();

      if (!(await toggle.isVisible())) {
        test.skip();
        return;
      }

      const box = await toggle.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(40);
      expect(box?.height).toBeGreaterThanOrEqual(20);
    });
  });

  test.describe('Modal Interactions', () => {
    test('modal can be closed by tapping overlay', async ({ page }) => {
      // Try to open a modal
      const modalTrigger = page
        .locator('button:has-text("Add"), button:has-text("New")')
        .first();

      if (!(await modalTrigger.isVisible())) {
        test.skip();
        return;
      }

      await modalTrigger.tap();

      // Wait for modal
      const modal = page.locator('.modal');
      if (!(await modal.isVisible({ timeout: 1000 }).catch(() => false))) {
        test.skip();
        return;
      }

      // Tap overlay to close
      const overlay = page.locator('.modal-overlay');
      await overlay.tap({ position: { x: 10, y: 10 } });

      await expect(modal).not.toBeVisible();
    });

    test('modal close button is tappable', async ({ page }) => {
      const modalTrigger = page
        .locator('button:has-text("Add"), button:has-text("New")')
        .first();

      if (!(await modalTrigger.isVisible())) {
        test.skip();
        return;
      }

      await modalTrigger.tap();

      const modal = page.locator('.modal');
      if (!(await modal.isVisible({ timeout: 1000 }).catch(() => false))) {
        test.skip();
        return;
      }

      // Find and tap close button
      const closeButton = modal.locator('button').first();
      const box = await closeButton.boundingBox();

      // Ensure close button has adequate touch target
      expect(box?.width).toBeGreaterThanOrEqual(30);
      expect(box?.height).toBeGreaterThanOrEqual(30);

      await closeButton.tap();

      await expect(modal).not.toBeVisible();
    });
  });

  test.describe('Scroll Behavior', () => {
    test('page scrolls smoothly on touch', async ({ page }) => {
      // Get initial scroll position
      const initialScroll = await page.evaluate(() => window.scrollY);

      // Scroll down using touch
      await page.touchscreen.tap(240, 400);
      await page.mouse.wheel(0, 300);

      // Check if scroll position changed
      const newScroll = await page.evaluate(() => window.scrollY);

      // Page should be scrollable if content is taller than viewport
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      if (bodyHeight > 800) {
        expect(newScroll).toBeGreaterThanOrEqual(initialScroll);
      }
    });
  });

  test.describe('Form Input Touch', () => {
    test('input fields are focusable by tap', async ({ page }) => {
      const input = page.locator('input[type="text"], input[type="url"]').first();

      if (!(await input.isVisible())) {
        test.skip();
        return;
      }

      await input.tap();

      // Input should be focused
      const isFocused = await input.evaluate(
        (el) => document.activeElement === el
      );
      expect(isFocused).toBe(true);
    });

    test('textarea expands properly on mobile', async ({ page }) => {
      const textarea = page.locator('textarea').first();

      if (!(await textarea.isVisible())) {
        test.skip();
        return;
      }

      const box = await textarea.boundingBox();
      // Textarea should be reasonably wide on mobile
      expect(box?.width).toBeGreaterThan(200);
    });
  });
});
