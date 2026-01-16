const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Connect to Redis (Service Name: 'redis-db')
const redisClient = createClient({
    url: 'redis://redis-db:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

(async () => {
    await redisClient.connect();
    console.log('✅ Connected to Redis');
})();

app.use(express.static('public'));
app.use(express.json());

// --- GAME STATE MANAGEMENT ---

// Helper: Get key for specific game
const getGameKey = (gameId) => `game:${gameId}`;

// Helper: Get default state
const getDefaultState = (gameId) => ({
    id: gameId,
    participants: [],
    gifts: [],
    settings: {
        maxSteals: 3,
        isPaused: false
    }
});

// --- API ROUTES ---

// 1. CREATE / JOIN GAME
app.post('/api/create', async (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });

    const key = getGameKey(gameId);
    const exists = await redisClient.exists(key);

    if (!exists) {
        console.log(`✨ Creating new game: ${gameId}`);
        const initialState = getDefaultState(gameId);
        await redisClient.set(key, JSON.stringify(initialState));
    } else {
        console.log(`🔙 Rejoining existing game: ${gameId}`);
    }

    res.json({ success: true, gameId });
});

// 2. GET GAME STATE
app.get('/api/:gameId/state', async (req, res) => {
    const { gameId } = req.params;
    const key = getGameKey(gameId);

    const data = await redisClient.get(key);
    if (!data) {
        return res.status(404).json({ error: "Game not found" });
    }

    res.json(JSON.parse(data));
});

// 3. RESET GAME (Dev Tool)
app.post('/api/:gameId/reset', async (req, res) => {
    const { gameId } = req.params;
    const key = getGameKey(gameId);

    console.log(`🔥 Resetting game: ${gameId}`);
    const initialState = getDefaultState(gameId);
    await redisClient.set(key, JSON.stringify(initialState));

    // Notify everyone in the room!
    io.to(gameId).emit('stateUpdate', initialState);

    res.json({ success: true });
});

// --- SOCKET.IO REALTIME ---

io.on('connection', (socket) => {
    console.log('🔌 A user connected:', socket.id);

    // Client MUST ask to join a specific game room
    socket.on('joinGame', (gameId) => {
        socket.join(gameId);
        console.log(`ID ${socket.id} joined room: ${gameId}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// --- START SERVER ---
// Important: Listen on 'server', not 'app'
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Elephant Exchange running on port ${PORT}`);
});