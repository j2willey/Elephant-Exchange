/*
 * ELEPHANT EXCHANGE - AUTO DEMO
 * Usage: node scripts/demo.js
 */

const { chromium } = require('playwright');

(async () => {
    console.log("🐘 Starting Demo Mode...");

    // 1. LAUNCH BROWSER (Visible & Slowed Down)
    const browser = await chromium.launch({
        headless: false,       // WE WANT TO SEE IT
        slowMo: 1200,          // 1.2 seconds between every action (Human speed)
        args: ['--start-maximized'] // Full screen
    });

    const context = await browser.newContext({
        viewport: { width: 1600, height: 900 }
    });

    // --- SETUP TABS ---
    const adminPage = await context.newPage();
    const tvPage = await context.newPage();

    const GAME_ID = 'demo-' + Math.floor(Math.random() * 1000);
    const PLAYERS = ["Alice", "Bob", "Charlie", "Dave", "Eve"];

    try {
        // --- STEP 1: TV SETUP ---
        console.log(`📺 Opening TV View for ${GAME_ID}`);
        await tvPage.goto(`http://localhost:3000/scoreboard.html?game=${GAME_ID}`);

        // --- STEP 2: ADMIN SETUP ---
        console.log(`🛠️ Creating Game: ${GAME_ID}`);
        await adminPage.goto('http://localhost:3000/gameadmin.html');
        await adminPage.bringToFront();

        // Login
        await adminPage.fill('#hostNameInput', GAME_ID);
        await adminPage.fill('#createPasswordInput', 'pizza'); // Secure it!
        await adminPage.click('text=Create & Host');

        // Settings Modal (Using Roster Mode!)
        console.log("⚙️ Configuring Settings...");
        const saveBtn = adminPage.locator('#btnSaveSettings');
        await saveBtn.waitFor();

        // SELECT FIXED MODE (Radio Button)
        await adminPage.check('input[value="fixed"]');

        await adminPage.fill('#settingRosterNames', PLAYERS.join('\n'));

        // Save
        await adminPage.click('#btnSaveSettings');

        console.log("✅ Roster Imported. Starting Gameplay loop...");

        // --- STEP 3: GAMEPLAY LOOP ---

        // Action 1: Player 1 (Alice) Opens a Gift
        console.log("🎁 Alice opens a gift...");
        // Click the first "Open" button found (Alice is #1)
        await adminPage.click('button[title="Open Gift"]');

        await adminPage.fill('#giftNameInput', 'Espresso Machine');
        await adminPage.fill('#giftDescInput', 'Stainless steel, professional grade');
        await adminPage.click('text=Save 💾');

        // Action 2: Player 2 (Bob) Steals!
        console.log("😈 Bob decides to steal...");
        // Bob is now active. Click his "Steal" button.
        // We find the button by looking for the row that has the "Steal" button available
        await adminPage.click('button[title="Steal Gift"]');

        // Bob selects the Espresso Machine
        await adminPage.click('text=Select Gift');

        // Confirm the Steal
        // Handle the "Are you sure?" dialog
        adminPage.once('dialog', dialog => dialog.accept());
        // (The click above triggers the dialog instantly in standard JS,
        // but Playwright handles the listener nicely)

        // Action 3: Alice (Victim) needs a new gift
        console.log("😢 Alice (Victim) opens a consolation prize...");
        // Wait for animation/state update
        await adminPage.waitForTimeout(1000);
        await adminPage.click('button[title="Open Gift"]'); // Alice is active again

        await adminPage.fill('#giftNameInput', 'Ugly Sweater');
        await adminPage.fill('#giftDescInput', 'It lights up...');
        await adminPage.click('text=Save 💾');

        // Action 4: Player 3 (Charlie) Opens
        console.log("🎁 Charlie plays it safe...");
        await adminPage.waitForTimeout(1000);
        await adminPage.click('button[title="Open Gift"]');

        await adminPage.fill('#giftNameInput', 'Laser Ray Gun');
        await adminPage.fill('#giftDescInput', 'Pew pew!');
        await adminPage.click('text=Save 💾');

        console.log("✨ Demo Complete! Browser staying open for you.");

    } catch (e) {
        console.error("❌ Demo interrupted:", e);
    }

    // DO NOT CLOSE BROWSER
    // We leave it open so you can take over manually
})();
