const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

// Configuration
const GAME_ID = 'demo-party';
const UPLOAD_DIR = path.join(__dirname, '../public/uploads', GAME_ID);
const SOURCE_DIR = path.join(__dirname, '../tests/images'); // Adjust if your images are elsewhere

// Database Connection
const redisUrl = process.env.REDIS_URL || 'redis://redis-db:6379'; 
const redisClient = createClient({ url: redisUrl });

const PLAYERS = [
    "Alice", "Bob", "Charlie", "David", "Eve", 
    "Frank", "Grace", "Heidi", "Ivan", "Judy"
];

const GIFTS = [
    { desc: "Espresso Machine", img: "Gift.webp" },
    { desc: "Vintage Lava Lamp", img: "gift2.webp" },
    { desc: "Mystery Box", img: "Gift3.jpg" },
    { desc: "Bluetooth Speaker", img: "Gift4.jpg" },
    { desc: "Scented Candle Set", img: "Gift.webp" }, // Reusing images for demo
    { desc: "Board Game Bundle", img: "gift2.webp" },
    { desc: "Electric Blanket", img: "Gift3.jpg" },
    { desc: "Fancy Cheese Knives", img: "Gift4.jpg" },
    { desc: "Novelty Socks", img: "Gift.webp" },
    { desc: "Gift Card Roulette", img: "gift2.webp" }
];

async function seed() {
    console.log(`🌱 Seeding Full Game: ${GAME_ID}`);
    
    // 1. Prepare Directories & Images
    if (fs.existsSync(SOURCE_DIR)) {
        if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        console.log("📂 Copying images from tests/images...");
    } else {
        console.warn(`⚠️  Source images not found at ${SOURCE_DIR}. Images will be broken.`);
    }

    await redisClient.connect();

    // 2. Build State
    const participants = PLAYERS.map((name, i) => ({
        id: `p_${i+1}`,
        name: name,
        number: i + 1,
        status: 'done', // Everyone has gone
        heldGiftId: null, // Will assign below
        forbiddenGiftId: null,
        isVictim: false,
        turnStartTime: null,
        timesStolenFrom: Math.floor(Math.random() * 2) // Fake some stats
    }));

    const gifts = GIFTS.map((g, i) => {
        const giftId = `g_${i+1}`;
        const playerId = `p_${i+1}`;
        
        // Copy Image File Logic
        let imageEntry = [];
        if (fs.existsSync(path.join(SOURCE_DIR, g.img))) {
            const destName = `seed_${Date.now()}_${g.img}`;
            fs.copyFileSync(path.join(SOURCE_DIR, g.img), path.join(UPLOAD_DIR, destName));
            imageEntry = [{
                id: `img_${i}`,
                path: `/uploads/${GAME_ID}/${destName}`,
                uploader: 'SeedScript',
                timestamp: Date.now()
            }];
        }

        // Assign to player
        participants[i].heldGiftId = giftId;

        return {
            id: giftId,
            description: g.desc,
            ownerId: playerId,
            stealCount: Math.floor(Math.random() * 3),
            isFrozen: false,
            images: imageEntry,
            primaryImageId: imageEntry.length > 0 ? imageEntry[0].id : null,
            downvotes: [] // Ready for voting
        };
    });

    const state = {
        id: GAME_ID,
        currentTurn: 11, // Game Over State
        phase: 'active', // Ready for Admin to click "End Game"
        activeVictimId: null,
        participants: participants,
        gifts: gifts,
        history: ["Game fully seeded with 10 players."],
        settings: {
            maxSteals: 3,
            turnDurationSeconds: 60,
            activePlayerCount: 1,
            isPaused: false,
            scrollSpeed: 3,
            soundTheme: 'standard',
            showVictimStats: true,
            themeColor: '#d97706',
            themeBg: 'https://images.unsplash.com/photo-1576618148400-f54bed99fcf8?auto=format&fit=crop&q=80' // Christmas Tree
        }
    };

    // 3. Save to Redis
    await redisClient.set(`game:${GAME_ID}`, JSON.stringify(state));
    console.log("✅ Game Ready! Refresh your browser.");
    await redisClient.disconnect();
    process.exit(0);
}

seed();