const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

// Configuration
const GAME_ID = 'demo-party';
const UPLOAD_DIR = path.join(__dirname, '../public/uploads', GAME_ID);
// Adjust this path if your images are elsewhere
const SOURCE_DIR = path.join(__dirname, '../tests/images');

// Database Connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'; // Default to localhost if running outside docker
const redisClient = createClient({ url: redisUrl });

const PLAYERS = [
    "Alice", "Bob", "Charlie", "David", "Eve",
    "Frank", "Grace", "Heidi", "Ivan", "Judy"
];

// UPDATED DATA: Split into 'name' (Headline) and 'desc' (Details)
const GIFTS = [
    { name: "Espresso Machine", desc: "Breville Barista Express", img: "Gift.webp" },
    { name: "Vintage Lava Lamp", desc: "1970s Original Red/Yellow", img: "gift2.webp" },
    { name: "Mystery Box", desc: "Heavy... shakes like Lego?", img: "Gift3.jpg" },
    { name: "Bluetooth Speaker", desc: "JBL Flip 5 Waterproof", img: "Gift4.jpg" },
    { name: "Scented Candle Set", desc: "Vanilla, Sandalwood, and Pine", img: "Gift.webp" },
    { name: "Board Game Bundle", desc: "Catan + Ticket to Ride", img: "gift2.webp" },
    { name: "Electric Blanket", desc: "Queen size, dual controls", img: "Gift3.jpg" },
    { name: "Fancy Cheese Knives", desc: "Stainless steel w/ wood handles", img: "Gift4.jpg" },
    { name: "Novelty Socks", desc: "12-pack of pizza patterns", img: "Gift.webp" },
    { name: "Gift Card Roulette", desc: "$50 to somewhere...", img: "gift2.webp" }
];

async function seed() {
    console.log(`🌱 Seeding Full Game: ${GAME_ID}`);

    // 1. Prepare Directories & Images
    // We check if we are in the root or a subfolder to find public/uploads
    const targetUploadDir = fs.existsSync(path.join(__dirname, 'public'))
        ? path.join(__dirname, 'public/uploads', GAME_ID)
        : path.join(__dirname, '../public/uploads', GAME_ID);

    if (fs.existsSync(SOURCE_DIR)) {
        if (!fs.existsSync(targetUploadDir)) fs.mkdirSync(targetUploadDir, { recursive: true });
        console.log("📂 Copying images...");
    }

    await redisClient.connect();

    // 2. Build State
    const participants = PLAYERS.map((name, i) => ({
        id: `p_${i+1}`,
        name: name,
        number: i + 1,
        status: 'done', // Everyone has gone
        heldGiftId: null,
        forbiddenGiftId: null,
        isVictim: false,
        turnStartTime: null,
        timesStolenFrom: Math.floor(Math.random() * 2)
    }));

    const gifts = GIFTS.map((g, i) => {
        const giftId = `g_${i+1}`;
        const playerId = `p_${i+1}`;

        // Copy Image File Logic
        let imageEntry = [];
        if (fs.existsSync(path.join(SOURCE_DIR, g.img))) {
            const destName = `seed_${Date.now()}_${g.img}`;
            fs.copyFileSync(path.join(SOURCE_DIR, g.img), path.join(targetUploadDir, destName));

            // Determine web path based on where we are running
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
            name: g.name,           // <--- NEW: Headline
            description: g.desc,    // <--- NEW: Details
            ownerId: playerId,
            stealCount: Math.floor(Math.random() * 3),
            isFrozen: false,
            images: imageEntry,
            primaryImageId: imageEntry.length > 0 ? imageEntry[0].id : null,
            downvotes: []
        };
    });

    const state = {
        id: GAME_ID,
        currentTurn: 11, // Game Over State
        phase: 'active',
        activeVictimId: null,
        participants: participants,
        gifts: gifts,
        history: ["Game fully seeded with 10 players."],
        settings: {
            partyName: "Acme Holiday 2026",
            tagline: "It's going to be a gas!",
            maxSteals: 3,
            turnDurationSeconds: 60,
            activePlayerCount: 1,
            isPaused: false,
            scrollSpeed: 3,
            soundTheme: 'standard',
            showVictimStats: true,
            themeColor: '#d97706',
            themeBg: 'https://images.unsplash.com/photo-1576618148400-f54bed99fcf8?auto=format&fit=crop&q=80'
        }
    };

    // 3. Save to Redis
    await redisClient.set(`game:${GAME_ID}`, JSON.stringify(state));
    console.log("✅ Game Ready with NEW SCHEMA (Name + Description)! Refresh your browser.");
    await redisClient.disconnect();
    process.exit(0);
}

seed();