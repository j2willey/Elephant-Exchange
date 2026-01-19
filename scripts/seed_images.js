const { createClient } = require('redis');
const redisUrl = process.env.REDIS_URL || 'redis://redis-db:6379';
const gameId = 'demo-party';

const redisClient = createClient({ url: redisUrl });

async function seedImages() {
    await redisClient.connect();
    
    const data = await redisClient.get(`game:${gameId}`);
    if(!data) { 
        console.log("❌ Game not found. Run seed.js first."); 
        process.exit(1); 
    }
    
    let state = JSON.parse(data);
    
    // Add fake image to Espresso Machine
    const g1 = state.gifts.find(g => g.description === 'Espresso Machine');
    if(g1) {
        g1.images = [{
            id: 'img_demo_1',
            path: 'https://images.unsplash.com/photo-1517080517725-e51c6eb3da42?auto=format&fit=crop&q=80',
            uploader: 'SeedScript',
            timestamp: Date.now()
        }];
        g1.primaryImageId = 'img_demo_1';
    }

    await redisClient.set(`game:${gameId}`, JSON.stringify(state));
    console.log("📸 Fake images added!");
    await redisClient.disconnect();
    process.exit(0);
}

seedImages();