const { test, expect } = require('@playwright/test');

const GAME_ID = 'test-secure-' + Date.now();
const PASSWORD = 'pizza';

test.describe('Security & Auth Layer', () => {

    test('Protected Game: Requires Password on New Device', async ({ browser }) => {
        // --- CONTEXT 1: THE HOST (Creates the game) ---
        const hostContext = await browser.newContext();
        const hostPage = await hostContext.newPage();

        console.log(`[Host] Creating protected game: ${GAME_ID}`);
        await hostPage.goto('http://localhost:3000/gameadmin.html');
        await hostPage.fill('#hostNameInput', GAME_ID);

        // 1. Set the Password
        await hostPage.fill('#createPasswordInput', PASSWORD);
        await hostPage.click('text=Create & Host');

        // Handle Start Modal
        const startBtn = hostPage.locator('#btnSaveSettings');
        await startBtn.waitFor();
        await startBtn.click();
        await expect(hostPage.locator('#settingsModal')).toBeHidden();

        // Add a Player so we have buttons to click
        // Use manual number to avoid "Late Arrival" popup on host side
        await hostPage.fill('#pNumber', '1');
        await hostPage.fill('#pName', 'Victim');
        await hostPage.click('text=Add');
        await expect(hostPage.locator('#participantList')).toContainText('Victim');

        console.log('[Host] Game created and authenticated automatically.');


        // --- CONTEXT 2: THE "PARTY CRASHER" (New Session) ---
        const crasherContext = await browser.newContext();
        const crasherPage = await crasherContext.newPage();

        console.log('[Crasher] Joining existing game...');
        await crasherPage.goto('http://localhost:3000/gameadmin.html');

        // Use "Reconnect" Search
        await crasherPage.fill('#joinNameInput', GAME_ID);
        await crasherPage.click('text=Search');
        await crasherPage.click(`text=${GAME_ID}`);

        // Crasher should see the dashboard
        await expect(crasherPage.locator('#dashboard-section')).toBeVisible();

        // 2. TRIGGER THE BOUNCER
        console.log('[Crasher] Attempting protected action...');
        await crasherPage.click('button[title="Reset Timer"]');

        // 3. VERIFY LOCK SCREEN
        const authModal = crasherPage.locator('#authModal');
        await expect(authModal).toBeVisible();
        console.log('✅ Bouncer worked! Auth Modal is visible.');

        // 4. UNLOCK
        await crasherPage.fill('#authPasswordInput', PASSWORD);
        await crasherPage.click('text=Unlock');

        // Wait for auth modal to hide
        await expect(authModal).toBeHidden();

        // --- THE FIX: Dismiss the "Password Saved" Alert ---
        // This is what was blocking the click!
        const successAlert = crasherPage.locator('#sysDialogModal');
        await expect(successAlert).toBeVisible();
        await expect(crasherPage.locator('#sysDialogMessage')).toContainText('Password Saved');
        await crasherPage.click('#btnSysOk'); // Click OK
        await expect(successAlert).toBeHidden();

        // 5. VERIFY ACCESS RESTORED
        // Now nothing is blocking the button
        await crasherPage.click('button[title="Reset Timer"]');

        // Handle the "Are you sure" dialog (reset timer confirmation)
        crasherPage.on('dialog', dialog => dialog.accept());

        console.log('✅ Access restored with password.');
    });
});