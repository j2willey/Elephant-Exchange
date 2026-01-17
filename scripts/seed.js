/*
 * Elephant Exchange Seeder
 * Usage: node scripts/seed.js [gameId]
 */

const BASE_URL = 'http://localhost:3000/api';
const GAME_ID = process.argv[2] || 'test-1';

const GIFTS = [
    "Echo Dot", "Blanket", "Whiskey Stones", "Star Wars Lego", "Candle",
    "Gift Card", "Blender", "Socks", "Coffee Maker", "Board Game",
    "Bluetooth Speaker", "Mug", "Hot Sauce Kit", "Puzzle", "Plant"
];

const NAMES = [
    "Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Heidi",
    "Ivan", "Judy", "Karl", "Leo", "Mike", "Nina", "Oscar", "Peggy",
    "Quinn", "Rupert", "Sybil", "Ted", "Ursula", "Victor", "Walter", "Xena"
];

async function seed() {
    console.log(`🌱 Seeding Game: ${GAME_ID}...`);

    // 1. Create Game
    await fetch(`${BASE_URL}/create`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ gameId: GAME_ID })
    });

    // 2. Add 30 Participants
    console.log("👥 Adding 30 participants...");
    const participants = [];
    for (let i = 1; i <= 30; i++) {
        const name = `${NAMES[i % NAMES.length]} ${i}`;
        const res = await fetch(`${BASE_URL}/${GAME_ID}/participants`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, number: i })
        });
        const data = await res.json();
        participants.push(data.participant);
    }

    // 3. Open 15 Gifts
    console.log("🎁 Opening 15 gifts...");
    for (let i = 0; i < 15; i++) {
        const p = participants[i]; // Player #1 to #15
        const giftName = `${GIFTS[i % GIFTS.length]} (Item ${i+1})`;
        
        await fetch(`${BASE_URL}/${GAME_ID}/open-new`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                description: giftName, 
                playerId: p.id 
            })
        });
    }

    // 4. Update Settings (Active Count: 3, Speed: 5)
    await fetch(`${BASE_URL}/${GAME_ID}/settings`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ activePlayerCount: 3, scrollSpeed: 5 })
    });

    console.log("✅ Done! Open http://localhost:3000/scoreboard.html?game=" + GAME_ID);
}

seed();