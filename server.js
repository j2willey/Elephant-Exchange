/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

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

const getGameKey = (gameId) => `game:${gameId}`;

const getDefaultState = (gameId) => ({
    id: gameId,
    participants: [], // { id, name, number, status, heldGiftId, forbiddenGiftId }
    gifts: [],        // { id, description, ownerId, stealCount, isFrozen }
    settings: { maxSteals: 3, 
                isPaused: false, 
                turnDurationSeconds: 60 // seconds
    },
    timerStart: Date.now(), // Track when the current action started
    currentTurn: 1,
    activeVictimId: null, // Priority override for steals
    history: []
});

// HELPER: Find who is truly active (Turn Number vs Victim)
function getActivePlayer(gameState) {
    if (gameState.activeVictimId) {
        return gameState.participants.find(p => p.id === gameState.activeVictimId);
    }
    return gameState.participants.find(p => p.number === gameState.currentTurn);
}

// --- API ROUTES ---

// 1. CREATE / JOIN
app.post('/api/create', async (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });

    const key = getGameKey(gameId);
    const exists = await redisClient.exists(key);

    if (!exists) {
        console.log(`✨ Creating new game: ${gameId}`);
        await redisClient.set(key, JSON.stringify(getDefaultState(gameId)));
    }
    res.json({ success: true, gameId });
});

// 2. GET STATE
app.get('/api/:gameId/state', async (req, res) => {
    const { gameId } = req.params;
    const data = await redisClient.get(getGameKey(gameId));
    if (!data) return res.status(404).json({ error: "Game not found" });
    res.json(JSON.parse(data));
});

// 3. RESET (CLEAR DB)
app.post('/api/:gameId/reset', async (req, res) => {
    const { gameId } = req.params;
    const key = getGameKey(gameId);
    const initialState = getDefaultState(gameId);
    await redisClient.set(key, JSON.stringify(initialState));
    io.to(gameId).emit('stateUpdate', initialState);
    res.json({ success: true });
});

// 4. ADD PARTICIPANT
app.post('/api/:gameId/participants', async (req, res) => {
    const { gameId } = req.params;
    const { name, number } = req.body;
    const key = getGameKey(gameId);
    
    if (!name && !number) return res.status(400).json({ error: "Name or Number required" });

    const data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    const gameState = JSON.parse(data);

    // Auto-number logic
    const nextNumber = gameState.participants.length + 1;
    const finalNumber = number ? parseInt(number) : nextNumber;

    const newParticipant = {
        id: `p_${Date.now()}`,
        name: name || `Player ${finalNumber}`,
        number: finalNumber,
        status: 'waiting',
        heldGiftId: null,
        forbiddenGiftId: null
    };

    gameState.participants.push(newParticipant);
    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);

    res.json({ success: true, participant: newParticipant });
});

// 5. OPEN NEW GIFT
app.post('/api/:gameId/open-new', async (req, res) => {
    const { gameId } = req.params;
    const { description } = req.body;
    const key = getGameKey(gameId);

    if (!description) return res.status(400).json({ error: "Description required" });

    const data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    const activePlayer = getActivePlayer(gameState);
    if (!activePlayer) return res.status(400).json({ error: "No active player for this turn" });

    // Clear "No Take-Back" restriction since they chose to open
    activePlayer.forbiddenGiftId = null;

    const newGift = {
        id: `g_${Date.now()}`,
        description,
        isFrozen: false,
        stealCount: 0,
        ownerId: activePlayer.id,
        ownerHistory: [activePlayer.id]
    };

    // UPDATE STATE
    gameState.gifts.push(newGift); // <--- THIS WAS LIKELY MISSING
    activePlayer.heldGiftId = newGift.id;
    activePlayer.status = 'done';

    // Advance Turn Logic
    if (gameState.activeVictimId) {
        gameState.activeVictimId = null; // Victim satisfied
        // Check if original turn owner is done
        const turnPlayer = gameState.participants.find(p => p.number === gameState.currentTurn);
        if (turnPlayer && turnPlayer.heldGiftId) {
             gameState.currentTurn += 1;
        }
    } else {
        gameState.currentTurn += 1;
    }
    // RESET CLOCK FOR THE NEXT PERSON
    gameState.timerStart = Date.now();

    gameState.history.push(`${activePlayer.name} opened a new gift: ${description}`);
    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);

    res.json({ success: true, activePlayer, gift: newGift });
});

// 6. STEAL GIFT
app.post('/api/:gameId/steal', async (req, res) => {
    const { gameId } = req.params;
    const { giftId } = req.body;
    const key = getGameKey(gameId);

    const data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    const thief = getActivePlayer(gameState);
    if (!thief) return res.status(400).json({ error: "No active player" });

    const gift = gameState.gifts.find(g => g.id === giftId);
    if (!gift || !gift.ownerId) return res.status(404).json({ error: "Invalid gift" });
    if (gift.isFrozen) return res.status(400).json({ error: "Gift is frozen" });
    if (gift.ownerId === thief.id) return res.status(400).json({ error: "Cannot steal from self" });
    if (thief.forbiddenGiftId === gift.id) return res.status(400).json({ error: "No take-backs!" });

    const victim = gameState.participants.find(p => p.id === gift.ownerId);

    // Execute Swap
    thief.heldGiftId = gift.id;
    thief.status = 'done';
    thief.forbiddenGiftId = null;

    victim.heldGiftId = null;
    victim.status = 'waiting';
    victim.forbiddenGiftId = gift.id; // Apply "No Take-Back" Rule

    gift.ownerId = thief.id;
    gift.ownerHistory.push(thief.id);
    gift.stealCount += 1;
    if (gift.stealCount >= gameState.settings.maxSteals) gift.isFrozen = true;

    gameState.activeVictimId = victim.id;
    gameState.history.push(`${thief.name} stole ${gift.description} from ${victim.name}!`);
    gameState.timerStart = Date.now();

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);

    res.json({ success: true });
});

// 7. EDIT GIFT
app.put('/api/:gameId/gifts/:giftId', async (req, res) => {
    const { gameId, giftId } = req.params;
    const { description } = req.body;
    const key = getGameKey(gameId);

    const data = await redisClient.get(key);
    let gameState = JSON.parse(data);
    
    const gift = gameState.gifts.find(g => g.id === giftId);
    if (gift) {
        gift.description = description;
        await redisClient.set(key, JSON.stringify(gameState));
        io.to(gameId).emit('stateUpdate', gameState);
    }
    res.json({ success: true });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);
    socket.on('joinGame', (gameId) => {
        socket.join(gameId);
        console.log(`Joined room: ${gameId}`);
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Elephant Exchange running on port ${PORT}`));