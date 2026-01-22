const { test, expect } = require('@playwright/test');

const GAME_ID = 'test-e2e-' + Date.now();

test.describe('Elephant Exchange E2E', () => {

    test('Full Game Flow: Admin, TV, and Mobile Sync', async ({ browser }) => {
        // --- SETUP CONTEXTS ---
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();

        const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const tvPage = await tvContext.newPage();

        const mobileContext = await browser.newContext({
            viewport: { width: 393, height: 851 },
            userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36'
        });
        const mobilePage = await mobileContext.newPage();


        // --- STEP 1: ADMIN LOGIN ---
        console.log('Step 1: Admin Login');
        await adminPage.goto('http://localhost:3000/gameadmin.html');

        await adminPage.fill('#hostNameInput', gameId);
        await adminPage.click('text=Create & Host');

        // FIX: Dismiss the "Game Defaults" Modal
        // Since we manually typed the ID, the app treats this as a new setup
        const startBtn = adminPage.locator('#btnSaveSettings');
        if (await startBtn.isVisible()) {
            await startBtn.click();
            await expect(adminPage.locator('#settingsModal')).toBeHidden();
        }

        // Verify Dashboard Loaded
        await expect(adminPage.locator('#dashboard-section')).toBeVisible();

        // --- RESET GAME ---
        // Reset DB (Handle the "Are you sure?" alert)
        adminPage.on('dialog', dialog => dialog.accept());

        // The reset button might be hidden in the footer or settings, ensure it's visible
        // Actually, "Reset Game" is inside the "Phase Controls" which only appears in results phase.
        // BUT "End Game" is in the footer.
        // Let's use the Footer "End Game" -> "Reset" flow or just force it via API if needed.
        // Actually, looking at your error log, it was failing on 'button[title="Reset Game"]'.
        // That button ONLY appears in the "Results" phase banner.
        // Let's Skip the Reset for this test run OR ensure we are in the right phase.
        // BETTER STRATEGY: Just use a unique GAME_ID (which we did above) so we don't need to reset!

        // --- STEP 2: CONNECT TV & MOBILE ---
        console.log('Step 2: Connect Clients');

        await tvPage.goto(`http://localhost:3000/scoreboard.html?game=${GAME_ID}`);
        await expect(tvPage.locator('#activePlayerBanner')).toBeVisible();

        await mobilePage.goto(`http://localhost:3000/scoreboard.html?game=${GAME_ID}&mode=mobile`);
        await expect(mobilePage.locator('.mobile-table-header')).toBeVisible({ timeout: 10000 });

        // --- STEP 3: ADD PLAYER ---
        console.log('Step 3: Add Participant');

        // Note: Reset Timer check in feature spec covers the UI reset.
        // Here we just proceed with the clean game.

        await adminPage.fill('#pNumber', '1');
        await adminPage.fill('#pName', 'Automated Alice');
        await adminPage.click('text=Add');

        // Verify on Admin
        await expect(adminPage.locator('#participantList')).toContainText('Automated Alice');

        // Verify on TV (Real-time Sync)
        await expect(tvPage.locator('#activePlayerBanner')).toContainText('Automated Alice');


        // --- STEP 4: ADD GIFT ---
        console.log('Step 4: Open Gift');

        // Mock the prompt response for "Open Gift"
        await adminPage.evaluate(() => {
            window.prompt = () => "Mysterious Blue Box";
        });

        // Click "Open"
        const aliceRow = adminPage.locator('#participantList li', { hasText: 'Alice' });
        await aliceRow.locator('button[title="Open Gift"]').click();

        // Verify Gift on Mobile List
        await expect(mobilePage.locator('.col-gift')).toContainText('Mysterious Blue Box');

        console.log('✅ TEST PASSED: Full loop complete.');
    });
});