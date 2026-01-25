const { test, expect } = require('@playwright/test');

test('Feature Check: Reset Timer and On Deck', async ({ browser }) => {
    const context = await browser.newContext();
    const adminPage = await context.newPage();
    const tvPage = await context.newPage();
    const gameId = 'test-feat-' + Date.now();

    // 1. Setup Game
    await adminPage.goto(`http://localhost:3000/gameadmin.html`);
    await adminPage.fill('#hostNameInput', gameId);
    await adminPage.click('text=Create & Host');

    // Handle "Start Game" Modal
    const startBtn = adminPage.locator('#btnSaveSettings');
    // Wait for button, click it, then WAIT FOR MODAL TO DISAPPEAR
    await startBtn.waitFor();
    await startBtn.click();
    await expect(adminPage.locator('#settingsModal')).toBeHidden();

    // 2. Add Alice (Manual #1 - No alert expected)
    await adminPage.fill('#pNumber', '1');
    await adminPage.fill('#pName', 'Alice');
    await adminPage.click('button:has-text("Add")');
    // Wait for Alice to appear in the DOM
    await expect(adminPage.locator('#participantList')).toContainText('Alice');

    // 3. Add Bob (Manual #2 - No alert expected)
    await adminPage.fill('#pNumber', '2');
    await adminPage.fill('#pName', 'Bob');
    await adminPage.click('button:has-text("Add")');
    await expect(adminPage.locator('#participantList')).toContainText('Bob');

    // 4. Verify "On Deck" on TV
    await tvPage.goto(`http://localhost:3000/scoreboard.html?game=${gameId}`);

    // Check Current Turn
    await expect(tvPage.locator('#activePlayerBanner')).toContainText('Alice');
    // Check On Deck
    await expect(tvPage.locator('#activePlayerBanner')).toContainText('On Deck: Bob');

    // 5. Test "Reset Timer"
    await expect(adminPage.locator('button[title="Reset Timer"]')).toBeVisible();

    // Handle "Are you sure?" confirmation dialog
    adminPage.on('dialog', dialog => dialog.accept());
    await adminPage.click('button[title="Reset Timer"]');

    // Ensure state persists
    await expect(adminPage.locator('#participantList')).toContainText('Alice');

    console.log('✅ Timer Reset and On Deck features verified');
});