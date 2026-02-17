import { test, expect } from '@playwright/test';

test.describe('EvenHub Simulator', () => {
    test.beforeEach(async ({ page }) => {
        // Listen for console logs
        page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));

        await page.goto('/');

        // Check status
        await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });

        // Wait for app grid - target list items specifically
        await expect(page.locator('.glasses-list li', { hasText: 'Chess' })).toBeVisible();
    });

    test('Chess App: Start New Game', async ({ page }) => {
        // Wait for bridge init
        await page.waitForTimeout(1000);

        // DEBUG: Check window properties to find event handler
        await page.evaluate(() => {
            console.log('[DEBUG] Window Keys:', Object.keys(window).filter(k => k.toLowerCase().includes('even')));
            console.log('[DEBUG] Window Props:', Object.getOwnPropertyNames(window).filter(k => k.toLowerCase().includes('even')));
            console.log('[DEBUG] onEvenHubEvent type:', typeof (window as any).onEvenHubEvent);
        });

        // Verify Menu - Should be in the menu initially
        // "Connected" is the status when glasses are connected.
        await expect(page.locator('#status')).toContainText('Connected');

        // Open Chess
        await page.click('.glasses-list li:has-text("Chess")');

        // Check for Menu or Board
        const menuTitle = page.locator('.glasses-container--text span', { hasText: 'Game in Progress' });

        // Allow either immediate board or menu
        const isMenu = await menuTitle.isVisible().catch(() => false);

        if (isMenu) {
            console.log('Menu visible, clicking New Game');
            await page.click('.glasses-list li:has-text("New Game")');
        }

        // Verify Board - Chess title might be "Chess" or status text "White - Move 1"
        // The mock renders "White - Move 1" at start.
        await expect(page.locator('.glasses-container--text span')).toContainText(/Chess|White - Move 1/);
        // Ensure we are NOT in the main menu
        await expect(page.locator('.glasses-list li', { hasText: 'Reddit' })).not.toBeVisible();
    });

    test('Timer App: Select and Start', async ({ page }) => {
        await page.click('.glasses-list li:has-text("Timer")');

        // Verify app entry via Simulator Event Log
        await expect(page.locator('#event-log')).toContainText('ENTERING Timer');

        // Debug: Wait a moment for render
        await page.waitForTimeout(500);

        // Should see "Select Duration" - target specific text
        await expect(page.locator('.glasses-container--text span', { hasText: 'Select Duration' })).toBeVisible();

        // Check list items
        await expect(page.locator('.glasses-list li').first()).toBeVisible();

        // Click "5 min"
        await page.click('.glasses-list li:has-text("5 min")');

        // Should verify timer starts (05:00)
        // There might be multiple text containers (Title "Timer", Content "05:00")
        // Use hasText locator or stricter selector
        await expect(page.locator('.glasses-container--text span', { hasText: '05:00' })).toBeVisible();
    });
});
