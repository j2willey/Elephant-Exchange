const { createClient } = require('redis');

// Default to 'redis-db' if inside Docker, 'localhost' if running locally with mapped ports
const redisUrl = process.env.REDIS_URL || 'redis://redis-db:6379';

const gameId = 'demo-party';
const redisClient = createClient({ url: redisUrl });

redisClient.on('error', err => console.error('Redis Client Error', err));

async function seed() {
    console.log(`🌱 Connecting to Redis at ${redisUrl}...`);
    await redisClient.connect();

    // 0. OPTIONAL: Clear old data first to avoid conflicts
    // await redisClient.del(`game:${gameId}`);

    // 1. Create Default State
    const state = {
        id: gameId,
        currentTurn: 3, // Simulate mid-game
        phase: 'active',
        activeVictimId: null,
        participants: [],
        gifts: [],
        history: ["Game seeded by script"],
        settings: {
            partyName: "Mid-Game Test",
            tagline: "Testing the new layout...",
            maxSteals: 3,
            turnDurationSeconds: 60,
            activePlayerCount: 1,
            isPaused: false,
            scrollSpeed: 3,
            soundTheme: 'standard',
            showVictimStats: true,
            themeColor: '#d97706',
            themeBg: 'https://images.unsplash.com/photo-1513297887119-d46091b24bfa?auto=format&fit=crop&q=80'
        }
    };

    // 2. Add Participants
    const names = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank"];
    state.participants = names.map((name, i) => ({
        id: `p_${i + 1}`,
        name: name,
        number: i + 1,
        status: i < 2 ? 'done' : 'waiting', // Alice & Bob are done
        heldGiftId: null,
        forbiddenGiftId: null,
        isVictim: false,
        turnStartTime: null,
        timesStolenFrom: 0
    }));

    // 3. Add Gifts (UPDATED SCHEMA)
    const g1 = {
        id: 'g_101',
        name: 'Espresso Machine',           // <--- NEW HEADLINE
        description: 'Breville Barista Express, barely used', // <--- DETAILS
        ownerId: 'p_1',
        stealCount: 0, isFrozen: false, images: [], primaryImageId: null,
        downvotes: []
    };
    state.participants[0].heldGiftId = g1.id;

    const g2 = {
        id: 'g_102',
        name: 'Lava Lamp',                  // <--- NEW HEADLINE
        description: 'Vintage 1970s Red w/ extra bulb', // <--- DETAILS
        ownerId: 'p_2',
        stealCount: 1, isFrozen: false, images: [], primaryImageId: null,
        downvotes: []
    };
    state.participants[1].heldGiftId = g2.id;

    state.gifts = [g1, g2];

    // 4. Save
    await redisClient.set(`game:${gameId}`, JSON.stringify(state));
    console.log(`✅ Game '${gameId}' seeded successfully with NEW schema!`);
    await redisClient.disconnect();
    process.exit(0);
}

seed();