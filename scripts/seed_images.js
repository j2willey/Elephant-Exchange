const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const BASE_URL = 'http://localhost:3000';
const GAME_ID = 'demo-party'; 
const IMAGE_DIR = path.join(__dirname, '../tests/images');

// Define the gifts and which images to attach to them
const SCENARIO = [
    {
        player: 'Alice',
        gift: 'Espresso Machine',
        images: ['Gift.webp', 'Gift3.jpg'] 
    },
    {
        player: 'Bob',
        gift: 'Vintage Lava Lamp',
        images: ['gift2.webp']
    },
    {
        player: 'Charlie',
        gift: 'Mystery Box',
        images: ['Gift4.jpg'] 
    },
    {
        player: 'David', 
        gift: null // Waiting to steal
    },
    {
        player: 'Eve',
        gift: null
    }
];

// --- MAIN SCRIPT ---
(async () => {
    console.log(`🐘 Seeding Game: ${GAME_ID} with images...`);

    // 0. Create the Game (Crucial Step!)
    console.log('\n--- 🆕 Creating Game ---');
    await createGame(GAME_ID);

    // 1. Join Players
    console.log('\n--- 👥 Joining Players ---');
    for (const item of SCENARIO) {
        await joinGame(item.player);
    }

    // 2. Open Gifts & Upload Images
    console.log('\n--- 🎁 Opening Gifts & Uploading Photos ---');
    
    // Fetch state to get Player IDs
    let state = await fetchState();
    if (!state || !state.participants) {
        console.error("❌ CRITICAL: Could not fetch game state. Aborting.");
        process.exit(1);
    }

    for (const item of SCENARIO) {
        if (!item.gift) continue;

        const player = state.participants.find(p => p.name === item.player);
        if (!player) {
            console.error(`❌ Could not find player ${item.player} in state.`);
            continue;
        }

        // A. Open the Gift
        console.log(`🎁 ${item.player} is opening: ${item.gift}`);
        const moveRes = await fetch(`${BASE_URL}/api/${GAME_ID}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: player.id,
                action: 'open',
                description: item.gift
            })
        });

        if (!moveRes.ok) {
            console.error(`   ❌ Failed to open gift: ${await moveRes.text()}`);
            continue;
        }

        // B. Upload Images
        // Refresh state to get the new Gift ID
        state = await fetchState();
        const gift = state.gifts.find(g => g.description === item.gift);

        if (gift && item.images && item.images.length > 0) {
            for (const imgName of item.images) {
                await uploadImage(gift.id, imgName);
            }
        }
    }

    console.log('\n✅ Seeding Complete!');
    console.log(`👉 View the catalog: ${BASE_URL}/catalog.html?game=${GAME_ID}`);
})();

// --- HELPERS ---

async function createGame(gameId) {
    try {
        const res = await fetch(`${BASE_URL}/api/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId })
        });
        
        if (res.ok) {
            console.log(`   ✅ Game '${gameId}' created successfully.`);
        } else {
            // It might fail if it already exists, which is fine
            console.log(`   ℹ️  Game creation note: ${res.statusText} (Game might already exist)`);
        }
    } catch (e) {
        console.error(`   ❌ Error creating game: ${e.message}`);
        console.log("   👉 TIP: If this fails, try creating 'demo-party' manually in the browser first.");
    }
}

async function joinGame(name) {
    try {
        const res = await fetch(`${BASE_URL}/api/${GAME_ID}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (res.ok) console.log(`   ✅ ${name} joined.`);
        else console.log(`   ⚠️ ${name} failed to join: ${res.status} ${res.statusText}`);
    } catch (e) {
        console.error(`   ❌ Connection error joining ${name}: ${e.message}`);
    }
}

async function fetchState() {
    try {
        const res = await fetch(`${BASE_URL}/api/${GAME_ID}/state`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function uploadImage(giftId, filename) {
    const filePath = path.join(IMAGE_DIR, filename);

    if (!fs.existsSync(filePath)) {
        console.warn(`   ⚠️ Image file not found on disk: ${filename} (Skipping)`);
        return;
    }

    try {
        const fileBuffer = fs.readFileSync(filePath);
        const file = new File([fileBuffer], filename, { type: 'image/jpeg' });

        const formData = new FormData();
        formData.append('giftId', giftId);
        formData.append('photo', file);
        formData.append('uploaderName', 'SeederBot');

        const res = await fetch(`${BASE_URL}/api/${GAME_ID}/upload`, {
            method: 'POST',
            body: formData
        });

        if (res.ok) console.log(`      📸 Uploaded: ${filename}`);
        else console.error(`      ❌ Upload failed: ${await res.text()}`);

    } catch (err) {
        console.error(`      ❌ Error uploading ${filename}:`, err.message);
    }
}