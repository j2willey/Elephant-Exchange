const { test, expect } = require('@playwright/test');

const GAME_ID = 'test-flow-' + Date.now();

test.describe('Elephant Exchange Full Loop', () => {

    test('Host can start game, add players, and open gifts', async ({ browser }) => {
        const adminContext = await browser.newContext();
        const tvContext = await browser.newContext();
        const adminPage = await adminContext.newPage();
        const tvPage = await tvContext.newPage();

        // --- STEP 1: ADMIN JOINS ---
        await adminPage.goto('http://localhost:3000/gameadmin.html');
        await adminPage.fill('#hostNameInput', GAME_ID);
        await adminPage.click('text=Create & Host');

        // Handle Start Modal
        const startBtn = adminPage.locator('#btnSaveSettings');
        await startBtn.waitFor();
        await startBtn.click();
        await expect(adminPage.locator('#settingsModal')).toBeHidden();

        // --- STEP 2: TV SYNC ---
        await tvPage.goto(`http://localhost:3000/scoreboard.html?game=${GAME_ID}`);
        await expect(tvPage.locator('#activePlayerBanner')).toBeVisible();

        // --- STEP 3: ADD PLAYERS ---
        // Alice
        await adminPage.fill('#pNumber', '1');
        await adminPage.fill('#pName', 'Alice');
        await adminPage.click('button:has-text("Add")');
        await expect(adminPage.locator('#participantList')).toContainText('Alice');

        // Bob
        await adminPage.fill('#pNumber', '2');
        await adminPage.fill('#pName', 'Bob');
        await adminPage.click('button:has-text("Add")');
        await expect(adminPage.locator('#participantList')).toContainText('Bob');

        // --- STEP 4: OPEN GIFT ---
        // Click "Open" on Alice (active player)
        await adminPage.click('button[title="Open Gift"]');

        // Fill Modal
        const modal = adminPage.locator('#openGiftModal');
        await expect(modal).toBeVisible();
        await adminPage.fill('#giftNameInput', 'Espresso Machine');
        await adminPage.fill('#giftDescInput', 'Fancy coffee maker');
        await adminPage.click('button:has-text("Save 💾")');
        await expect(modal).toBeHidden();

        // Check Admin List
        await expect(adminPage.locator('#giftList')).toContainText('Espresso Machine');

        // Check TV Sync
        await expect(tvPage.locator('#giftList')).toContainText('Espresso Machine');

        console.log("✅ Full Game Loop Passed");
    });
});