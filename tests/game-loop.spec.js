const { test, expect } = require('@playwright/test');

// Standardize the Game ID for testing
const GAME_ID = 'test-automation-party';

test.describe('Elephant Exchange E2E', () => {

    test('Full Game Flow: Admin, TV, and Mobile Sync', async ({ browser }) => {
        // --- SETUP CONTEXTS ---
        // 1. Admin (Desktop)
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();

        // 2. TV (Big Screen)
        const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const tvPage = await tvContext.newPage();

        // 3. Mobile (Pixel 5 emulation)
        const mobileContext = await browser.newContext({ 
            viewport: { width: 393, height: 851 },
            userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36'
        });
        const mobilePage = await mobileContext.newPage();


        // --- STEP 1: ADMIN LOGIN & RESET ---
        console.log('Step 1: Admin Login');
        await adminPage.goto('/'); // Uses baseURL
        await adminPage.goto('/gameadmin.html');
        
        await adminPage.fill('#gameIdInput', GAME_ID);
        await adminPage.click('text=Start Managing');
        
        // Verify Dashboard Loaded
        await expect(adminPage.locator('#dashboard-section')).toBeVisible();

        // Reset DB (Handle the "Are you sure?" alert)
        adminPage.on('dialog', dialog => dialog.accept());
        await adminPage.click('button[title="Reset Game"]');
        
        // Wait for reload and re-login logic (since reset reloads page)
        await adminPage.waitForLoadState('networkidle');
        // Ensure we are back on dashboard
        await expect(adminPage.locator('#displayGameId')).toContainText(GAME_ID);


        // --- STEP 2: CONNECT TV & MOBILE ---
        console.log('Step 2: Connect Clients');
        
        // TV Join
        await tvPage.goto(`/scoreboard.html?game=${GAME_ID}`);
        await expect(tvPage.locator('#activePlayerBanner')).toBeVisible();

        // Mobile Join (Check for Sticky Header)
        await mobilePage.goto(`/scoreboard.html?game=${GAME_ID}&mode=mobile`);
        await expect(mobilePage.locator('.mobile-table-header')).toBeVisible();

        // Debugging: Let's ask the page what class is on the body
        const bodyClass = await mobilePage.getAttribute('body', 'class');
        console.log(`Mobile Page Body Class: ${bodyClass}`); // Should contain 'mobile-view'

        // Wait explicitly for the header to appear (sometimes rendering takes a few ms)
        await expect(mobilePage.locator('.mobile-table-header')).toBeVisible({ timeout: 10000 });

        // --- STEP 3: ADD PLAYER ---
        console.log('Step 3: Add Participant');
        
        await adminPage.fill('#pNumber', '1');
        await adminPage.fill('#pName', 'Automated Alice');
        await adminPage.click('text=Add');

        // Verify on Admin
        await expect(adminPage.locator('#participantList')).toContainText('Automated Alice');

        // Verify on TV (Real-time Sync)
        // It might take a few ms for socket to sync
        await expect(tvPage.locator('#activePlayerBanner')).toContainText('Automated Alice');


        // --- STEP 4: ADD GIFT ---
        console.log('Step 4: Open Gift');
        
        // In the Admin UI, Alice should be active. We need to handle the Prompt.
        // Mock the prompt response for "Open Gift"
        await adminPage.evaluate(() => {
            window.prompt = () => "Mysterious Blue Box"; // Override browser prompt
        });

        // Click "Open" (assuming button is visible for active player)
        // We look for the button inside the list item that contains Alice
        const aliceRow = adminPage.locator('#participantList li', { hasText: 'Alice' });
        await aliceRow.locator('button.btn-green', { hasText: 'Open' }).click();

        // Verify Gift on Mobile List
        await expect(mobilePage.locator('.col-gift')).toContainText('Mysterious Blue Box');
        
        // Verify Star Interaction (Mobile)
        await mobilePage.locator('.star-icon').first().click();
        await expect(mobilePage.locator('.star-icon').first()).toContainText('⭐');


        console.log('✅ TEST PASSED: Full loop complete.');
    });
});