const { test, expect } = require('@playwright/test');

const GAME_ID = 'test-automation-' + Date.now();

test.describe('Elephant Exchange Full Loop', () => {

    test('Host can start game, add players, and open gifts', async ({ browser }) => {
        // 1. Create Contexts (Admin and TV)
        const adminContext = await browser.newContext();
        const tvContext = await browser.newContext();

        const adminPage = await adminContext.newPage();
        const tvPage = await tvContext.newPage();

        // --- STEP 1: ADMIN JOINS ---
        console.log(`Starting Game: ${GAME_ID}`);
        await adminPage.goto('http://localhost:3000/');
        await adminPage.fill('#landingHostInput', GAME_ID);
        await adminPage.click('button:has-text("Create Party")');

        // The modal appears because it's a new game. We click "Start Game 🚀"
        await expect(adminPage.locator('#settingsModal')).toBeVisible();
        await adminPage.click('#btnSaveSettings');
        await expect(adminPage.locator('#settingsModal')).toBeHidden();


        // Verify Dashboard Loaded
        await expect(adminPage.locator('#dashboard-section')).toBeVisible();
        await expect(adminPage.locator('#displayGameId')).toContainText(GAME_ID);

        // --- STEP 2: TV SYNC ---
        await tvPage.goto(`http://localhost:3000/scoreboard.html?game=${GAME_ID}`);
        await expect(tvPage.locator('#activePlayerBanner')).toBeVisible();

        // --- STEP 3: ADD PLAYERS ---
        await adminPage.fill('#pName', 'Alice');
        await adminPage.click('button:has-text("Add")');
        await expect(adminPage.locator('#participantList')).toContainText('Alice');

        await adminPage.fill('#pName', 'Bob');
        await adminPage.click('button:has-text("Add")');
        await adminPage.click('text=Add to End');

        // --- STEP 4: OPEN GIFT (Alice) ---
        // Click "Open" on the active player row
        await adminPage.click('button.btn-green');

        // Handle Prompt (Playwright intercepts prompts automatically if configured, or we mock it)
        // Since we use window.prompt, we need to handle the dialog:
        adminPage.on('dialog', dialog => dialog.accept('Espresso Machine'));

        // Check Admin List
        await expect(adminPage.locator('#giftList')).toContainText('Espresso Machine');

        // Check TV Sync
        await expect(tvPage.locator('#giftList')).toContainText('Espresso Machine');

        console.log("✅ Full Game Loop Passed");
    });
});
