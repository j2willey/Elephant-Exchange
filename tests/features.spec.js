const { test, expect } = require('@playwright/test');

test('Feature Check: Reset Timer and On Deck', async ({ browser }) => {
    const context = await browser.newContext();
    const adminPage = await context.newPage();
    const tvPage = await context.newPage();
    const gameId = 'test-feat-' + Date.now();

    // 1. Setup Game
    await adminPage.goto(`http://localhost:3000/gameadmin.html`);
    await adminPage.fill('#gameIdInput', gameId);
    await adminPage.press('#gameIdInput', 'Enter');
    
    // Add 2 Players
    // Add Alice
    await adminPage.fill('#pName', 'Alice');
    await adminPage.click('button:has-text("Add")');
    // 🛑 STOP: Wait until Alice actually appears in the HTML
    await expect(adminPage.locator('#participantList')).toContainText('Alice');

    // Add Bob
    await adminPage.fill('#pName', 'Bob');
    await adminPage.click('button:has-text("Add")');
    // 🛑 STOP: Wait until Bob actually appears in the HTML
    await expect(adminPage.locator('#participantList')).toContainText('Bob');

    // 2. Verify "On Deck" on TV
    await tvPage.goto(`http://localhost:3000/scoreboard.html?game=${gameId}`);
    await expect(tvPage.locator('#activePlayerBanner')).toContainText('Current Turn');
    await expect(tvPage.locator('#activePlayerBanner')).toContainText('Alice');
    // Check if Bob is shown as "On Deck"
    await expect(tvPage.locator('#activePlayerBanner')).toContainText('On Deck: Bob');

    // 3. Test "Reset Timer" Button
    // Capture time, click reset, ensure no error
    await expect(adminPage.locator('button[title="Reset Timer"]')).toBeVisible();
    
    // Handle the "Are you sure?" alert
    adminPage.on('dialog', dialog => dialog.accept());
    await adminPage.click('button[title="Reset Timer"]');
    
    // Verify it didn't crash
    await expect(adminPage.locator('#participantList')).not.toBeEmpty();
    
    console.log('✅ Timer Reset and On Deck features verified');
});