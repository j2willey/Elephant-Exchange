const { test, expect } = require('@playwright/test');

const GAME_ID = 'test-e2e-' + Date.now();

test.describe('Elephant Exchange E2E', () => {

    test('Full Game Flow: Admin, TV, and Mobile Sync', async ({ browser }) => {
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
        await adminPage.goto('http://localhost:3000/gameadmin.html');
        // FIX: Use the constant GAME_ID
        await adminPage.fill('#hostNameInput', GAME_ID);
        await adminPage.click('text=Create & Host');

        // FIX: Remove "if visible" check. Force it to wait.
        // This ensures the modal is handled before we try to click anything else.
        const startBtn = adminPage.locator('#btnSaveSettings');
        await startBtn.waitFor();
        await startBtn.click();
        await expect(adminPage.locator('#settingsModal')).toBeHidden();

        // --- STEP 2: CONNECT CLIENTS ---
        await tvPage.goto(`http://localhost:3000/scoreboard.html?game=${GAME_ID}`);
        await expect(tvPage.locator('#activePlayerBanner')).toBeVisible();

        await mobilePage.goto(`http://localhost:3000/scoreboard.html?game=${GAME_ID}&mode=mobile`);
        // Relaxed Mobile Check
        await expect(mobilePage.locator('#giftList')).toBeVisible({ timeout: 15000 });

        // --- STEP 3: ADD PLAYER ---
        await adminPage.fill('#pNumber', '1');
        await adminPage.fill('#pName', 'Automated Alice');

        // This click will now work because the modal is guaranteed to be gone
        await adminPage.click('text=Add');

        await expect(adminPage.locator('#participantList')).toContainText('Automated Alice');

        // --- STEP 4: OPEN GIFT ---
        await adminPage.click('button[title="Open Gift"]');

        await adminPage.fill('#giftNameInput', 'Mysterious Blue Box');
        await adminPage.fill('#giftDescInput', 'From Tiffany');
        await adminPage.click('button:has-text("Save 💾")');

        // Verify Gift on Mobile List
        await expect(mobilePage.locator('.col-gift')).toContainText('Mysterious Blue Box');

        console.log('✅ TEST PASSED: Full loop complete.');
    });
});