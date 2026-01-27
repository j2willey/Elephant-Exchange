/*
 * ELEPHANT EXCHANGE - "BOB'S GAME" DEMO (PRESENTER MODE)
 * Usage:
 * node scripts/demo-game.js              -> Auto-run (2s delay between chapters)
 * node scripts/demo-game.js 5            -> Auto-run (5s delay between chapters)
 * node scripts/demo-game.js interactive  -> PRESENTER MODE (Waits for Spacebar or 30s)
 */

const { chromium } = require('playwright');
const readline = require('readline');

// --- CONFIGURATION ---
const args = process.argv.slice(2);
const IS_INTERACTIVE = args.includes('interactive') || args.includes('present');
let CHAPTER_DELAY = 2000; // Default 2 seconds

const numArg = args.find(a => !isNaN(parseFloat(a)));
if (numArg) CHAPTER_DELAY = parseFloat(numArg) * 1000;

const MAX_PRESENTER_WAIT = 30000;

// --- HELPER: NARRATIVE PAUSE ---
async function narrativePause(message) {
    console.log(`\n📘 [STORY]: ${message}`);

    if (!IS_INTERACTIVE) {
        console.log(`   (Waiting ${CHAPTER_DELAY/1000}s...)`);
        return new Promise(resolve => setTimeout(resolve, CHAPTER_DELAY));
    }

    return new Promise(resolve => {
        process.stdout.write(`   👉 Press SPACE to continue (or wait ${MAX_PRESENTER_WAIT/1000}s)...`);
        const timer = setTimeout(() => { cleanup(); console.log(" (Timeout)"); resolve(); }, MAX_PRESENTER_WAIT);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        process.stdin.setRawMode(true);

        const listener = (key) => {
            if (key[0] === 3) process.exit(); // Ctrl+C
            if (key[0] === 32 || key[0] === 13) { cleanup(); process.stdout.write(" ✅\n"); resolve(); }
        };
        process.stdin.on('data', listener);
        function cleanup() { clearTimeout(timer); process.stdin.removeListener('data', listener); process.stdin.setRawMode(false); rl.close(); }
    });
}

(async () => {
    console.log("🐘 Starting Bob's Demo...");
    if (IS_INTERACTIVE) console.log("🎤 PRESENTER MODE ACTIVE: Get ready to talk!");

    const browser = await chromium.launch({
        headless: false,
        slowMo: 100, // Fast UI actions, we control the pacing
        args: ['--start-maximized']
    });

    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();

    // GAME DATA
    const GAME_ID = 'bob-party';
    const PLAYERS = [
        "Andy", "Bob", "Cheryl", "David", "Emily",
        "Fred", "Greg", "Henry", "Ingrid", "Jim",
        "Kim", "Larry", "Minnie"
    ];

    try {
        // --- CHAPTER 1: INTRO ---
        await narrativePause("Welcome. We are hosting a game for 13 people.");

        await page.goto('http://localhost:3000/gameadmin.html');
        await page.fill('#hostNameInput', GAME_ID);
        await page.fill('#createPasswordInput', 'demo');

        await narrativePause("Details entered. Creating the party...");
        await page.click('text=Create & Host');

        // --- CHAPTER 2: SETTINGS (ROSTER IMPORT) ---
        console.log("⚙️ Configuring Settings...");
        const saveBtn = page.locator('#btnSaveSettings');
        await saveBtn.waitFor();

        // 1. Set Active Players to 3
        await page.fill('#settingActiveCount', "3");

        // 2. Select "Fixed Order" (Enables the textarea)
        await page.check('input[value="fixed"]');

        // 3. Paste Roster
        await page.fill('#settingRosterNames', PLAYERS.join('\n'));

        await narrativePause("We've pasted the guest list. Saving...");
        await page.click('#btnSaveSettings');

        // Wait for dashboard to load
        await page.locator('#dashboard-section').waitFor();
        await page.waitForTimeout(500); // Visual settling

        // --- HELPERS (Defined inside context to access 'page') ---
        async function openGift(playerName, giftName) {
            await narrativePause(`${playerName} opens a gift: ${giftName}`);

            // 1. Find the Player Row
            const row = page.locator('#participantList li', { hasText: playerName });

            // 2. Click "Open Gift" inside that row
            await row.locator('button[title="Open Gift"]').click();

            // 3. Fill Modal
            await page.fill('#giftNameInput', giftName);
            await page.click('text=Save 💾');
        }

        async function stealGift(thiefName, giftName) {
            await narrativePause(`${thiefName} decides to STEAL the ${giftName}!`);

            // 1. Find Thief Row -> Click Steal Icon
            const thiefRow = page.locator('#participantList li', { hasText: thiefName });
            await thiefRow.locator('button[title="Steal Gift"]').click();

            // 2. Wait for UI to flip to "Select Mode"
            await page.waitForTimeout(300);

            // 3. ROBUST SELECTOR: Find the list item that has the gift name
            // Then click the "Select Gift" button INSIDE that list item.
            const giftCard = page.locator('#giftList li', { hasText: giftName });
            await giftCard.locator('button', { hasText: 'Select Gift' }).click();

            // 4. Handle Confirmation Modal (New System)
            const confirmBtn = page.locator('#btnSysOk');
            await confirmBtn.waitFor();
            await confirmBtn.click();

            // 5. Wait for animation
            await page.waitForTimeout(1000);
        }

        // --- CHAPTER 3: THE GAME SCRIPT ---

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

        // 13. Emily (Victim) steals Coffee mug (from David)
        await stealGift('Emily', 'Coffee mug');

        // 14. David (Victim) steals Notebook (from Fred)
        await stealGift('David', 'Notebook');

        // 15. Fred (Victim) steals Coffee mug (from Emily)
        await stealGift('Fred', 'Coffee mug');

        // 16. Emily (Victim) opens Starbux card
        await openGift('Emily', 'Starbux card');

        // 17. Jim steals Notebook (from David)
        await stealGift('Jim', 'Notebook');

        // 18. David (Victim) opens Compass and match set
        await openGift('David', 'Compass and match set');

        // 19. Larry steals headphones (from Cheryl)
        await stealGift('Larry', 'headphones');

        // 20. Kim opens flashlight
        await openGift('Kim', 'flashlight');

        // 21. Cheryl (Victim) opens air freshener
        await openGift('Cheryl', 'air freshener');

        // 22. Minnie opens white elephant plunger
        await openGift('Minnie', 'white elephant plunger');


        // --- CHAPTER 4: END GAME ---
        await narrativePause("Game Over! Now we trigger 'Worst Gift Voting'.");

        // Click End Game Footer Button
        await page.click('#btnGameState');

        await narrativePause("The Host starts the 3-minute timer.");

        // Click "Start Voting" (New Modal ID)
        await page.click('#btnEndVote');

        await narrativePause("Voting is live on the TV. Let's reveal the winners.");

        // Stop Voting
        await page.click('#btnGameState'); // "Stop Voting"
        await page.click('#btnSysOk'); // Confirm

        console.log("✨ Demo Complete!");

        if (IS_INTERACTIVE) {
            console.log("\n🎤 Presentation finished. Press Ctrl+C to close browser.");
            await new Promise(() => {});
        }

    } catch (e) {
        console.error("❌ Demo interrupted:", e);
    }

    if (!IS_INTERACTIVE) await browser.close();

})();