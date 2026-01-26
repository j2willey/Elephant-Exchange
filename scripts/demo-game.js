/*
 * ELEPHANT EXCHANGE - "BOB'S GAME" DEMO
 * Usage: node scripts/demo-bob.js
 */

const { chromium } = require('playwright');

(async () => {
    console.log("🐘 Starting Bob's Demo...");

    // 1. SETUP BROWSER
    const browser = await chromium.launch({
        headless: false,
        slowMo: 2000, // 1 second per action (Readable speed)
        args: ['--start-maximized']
    });

    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await context.newPage();

    // 2. GAME CONFIGURATION
    const GAME_ID = 'bob-party';
    const PLAYERS = [
        "Andy", "Bob", "Cheryl", "David", "Emily",
        "Fred", "Greg", "Henry", "Ingrid", "Jim",
        "Kim", "Larry", "Minnie"
    ];
    const ACTIVE_PLAYERS = "3"; // Simultaneous turns

    try {
        // --- LOGIN & CREATE ---
        console.log(`🌍 navigating to http://localhost:3000/gameadmin.html...`);
        await page.goto('http://localhost:3000/gameadmin.html');

        await page.fill('#hostNameInput', GAME_ID);
        await page.fill('#createPasswordInput', 'demo');
        await page.click('text=Create & Host');

        // --- SETTINGS (The Complex Part) ---
        console.log("⚙️ Configuring Settings...");
        const saveBtn = page.locator('#btnSaveSettings');
        await saveBtn.waitFor();

        // 1. Set Active Players to 3
        await page.fill('#settingActiveCount', ACTIVE_PLAYERS);

        // 2. Select "Fixed Order / Demo" Mode (Radio Button)
        await page.check('input[value="fixed"]');

        // 3. Paste Roster
        await page.fill('#settingRosterNames', PLAYERS.join('\n'));

        // 4. Save
        await page.click('#btnSaveSettings');
        await page.waitForTimeout(1000); // Let server process
        console.log("✅ Game Created & Roster Imported!");

        // --- HELPER FUNCTIONS ---
        async function openGift(playerName, giftName) {
            console.log(`🎁 ${playerName} opens: ${giftName}`);
            // Find row containing player name
            const row = page.locator(`li:has-text("${playerName}")`);
            // Click "Open Gift" (Gift Icon) inside that row
            const btn = row.locator('button[title="Open Gift"]');

            // Wait for it to be actionable (in case of animation)
            await btn.waitFor();
            await btn.click();

            await page.fill('#giftNameInput', giftName);
            await page.click('text=Save 💾');
        }

        async function stealGift(thiefName, giftName) {
            console.log(`😈 ${thiefName} steals: ${giftName}`);
            const row = page.locator(`li:has-text("${thiefName}")`);
            const btn = row.locator('button[title="Steal Gift"]');
            await btn.waitFor();
            await btn.click();

            // Select the gift from the list
            // We look for the row in the Gift List that has the gift name, then click "Select Gift"
            const giftRow = page.locator(`#giftList li:has-text("${giftName}")`);
            await giftRow.locator('text=Select Gift').click();

            // Handle Confirm Dialog
            // Note: Playwright auto-dismisses dialogs, but our customConfirm uses the DOM modal
            const confirmBtn = page.locator('#btnSysOk');
            await confirmBtn.waitFor();
            await confirmBtn.click();
        }

        // --- THE SCRIPT (From 'bob' file) ---

        // 1. Andy opens Coffee mug
        await openGift('Andy', 'Coffee mug');

        // 2. Bob opens Notebook
        await openGift('Bob', 'Notebook');

        // 3. Cheryl opens pocketknife
        await openGift('Cheryl', 'pocketknife');

        // 4. David steals Coffee mug (from Andy)
        await stealGift('David', 'Coffee mug');

        // 5. Andy (Victim) opens sleeping bag
        await openGift('Andy', 'sleeping bag');

        // 6. Emily opens lego set
        await openGift('Emily', 'lego set');

        // 7. Fred steals Notebook (from Bob)
        await stealGift('Fred', 'Notebook');

        // NOTE: Re-ordered to satisfy logical causality:
        // Bob must resolve victimhood, Greg must steal knife for Cheryl to act.

        // 8. Bob (Victim) opens water bottle
        await openGift('Bob', 'water bottle');

        // 9. Greg steals pocketknife (from Cheryl)
        await stealGift('Greg', 'pocketknife');

        // 10. Cheryl (Victim) opens headphones
        await openGift('Cheryl', 'headphones');

        // 11. Henry opens sunglasses
        await openGift('Henry', 'sunglasses');

        // 12. Ingrid steals lego set (from Emily)
        await stealGift('Ingrid', 'lego set');

        // --- CHAIN REACTION START ---

        // 13. Emily (Victim) steals Coffee mug (from David)
        await stealGift('Emily', 'Coffee mug');

        // 14. David (Victim) steals Notebook (from Fred)
        await stealGift('David', 'Notebook');

        // 15. Fred (Victim) steals Coffee mug (from Emily)
        await stealGift('Fred', 'Coffee mug');

        // 16. Emily (Victim) opens Starbux card
        // (Note: Log said David opens compass, but Emily is the victim here.
        // We assume Emily opens card, clearing the stack).
        await openGift('Emily', 'Starbux card');

        // 17. Jim steals Notebook (from David)
        await stealGift('Jim', 'Notebook');

        // 18. David (Victim) opens Compass and match set
        await openGift('David', 'Compass and match set');

        // 19. Larry steals headphones (from Cheryl)
        await stealGift('Larry', 'headphones');

        // 20. Kim opens flashlight
        // (Wait, Cheryl is victim. Cheryl must go first? Or Kim is playing?)
        // With 3 active players, Kim MIGHT be active alongside Victim Cheryl.
        // Let's try Kim first.
        await openGift('Kim', 'flashlight');

        // 21. Cheryl (Victim) opens air freshener
        await openGift('Cheryl', 'air freshener');

        // 22. Minnie opens white elephant plunger
        await openGift('Minnie', 'white elephant plunger');


        // --- AUTOMATED VOTING SECTION ---
        console.log("⏳ Game Over. Waiting 15 seconds before voting...");
        await page.waitForTimeout(15000);

        console.log("🗳️ API: Triggering Voting Phase...");

        // 1. Switch Phase to VOTING (Using the Admin Password 'demo')
        await page.request.post(`http://localhost:3000/api/${GAME_ID}/phase/voting`, {
            headers: { 'x-admin-secret': 'demo' },
            data: { durationSeconds: 300 } // 5 Minutes
        });

        // 2. Fetch Game State (We need real Gift IDs to vote)
        const stateResponse = await page.request.get(`http://localhost:3000/api/${GAME_ID}/state`);
        const state = await stateResponse.json();

        // Helper to match names to IDs
        const findId = (partialName) => state.gifts.find(g => g.name.toLowerCase().includes(partialName.toLowerCase()))?.id;

        // 3. The Ballot
        const ballot = [
            { item: 'white elephant plunger', count: 5 },
            { item: 'air freshener', count: 4 },
            { item: 'water bottle', count: 1 },
            { item: 'flashlight', count: 1 }
        ];

        // 4. Cast the Votes
        console.log("🤖 API: Casting bot votes...");
        for (const entry of ballot) {
            const gid = findId(entry.item);
            if (!gid) {
                console.warn(`⚠️ Could not find gift: ${entry.item}`);
                continue;
            }

            for (let i = 0; i < entry.count; i++) {
                await page.request.post(`http://localhost:3000/api/${GAME_ID}/vote`, {
                    data: {
                        giftId: gid,
                        voterId: `bot_${entry.item.replace(/\s/g,'')}_${i}` // Unique Voter ID per vote
                    }
                });
            }
        }
        console.log("✅ Votes cast successfully!");

        // --- 5. END VOTING & SHOW RESULTS ---
        console.log("🏆 API: Ending Voting & Showing Results...");
        await page.request.post(`http://localhost:3000/api/${GAME_ID}/phase/results`, {
            headers: { 'x-admin-secret': 'demo' }
        });

        console.log("✨ Demo Complete! Look at the Scoreboard!");

        // ... (End of script)

        console.log("✨ Demo Complete! Leaving browser open.");

    } catch (e) {
        console.error("❌ Script Failed:", e);
    }
})();