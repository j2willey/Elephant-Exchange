/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');

// NEW: Import the logic from the library
const { getDefaultState, isPlayerActive } = require('./lib/gameEngine');

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

const getGameKey = (gameId) => `game:${gameId}`;

// --- API ROUTES ---

// 1. CREATE / JOIN
app.post('/api/create', async (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });

    const key = getGameKey(gameId);
    const exists = await redisClient.exists(key);

    if (!exists) {
        console.log(`✨ Creating new game: ${gameId}`);
        // Uses the imported function
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
    // Uses the imported function
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

    const nextNumber = gameState.participants.length + 1;
    const finalNumber = number ? parseInt(number) : nextNumber;

    const newParticipant = {
        id: `p_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: name || `Player ${finalNumber}`,
        number: finalNumber,
        status: 'waiting',
        heldGiftId: null,
        forbiddenGiftId: null,
        isVictim: false
    };

    gameState.participants.push(newParticipant);
    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);

    res.json({ success: true, participant: newParticipant });
});

// 5. OPEN NEW GIFT
app.post('/api/:gameId/open-new', async (req, res) => {
    const { gameId } = req.params;
    const { description, playerId } = req.body;
    
    const key = getGameKey(gameId);
    
    if (!description) return res.status(400).json({ error: "Description required" });
    
    const data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);
       
    // VALIDATE PLAYER (Uses imported function)
    if (!isPlayerActive(gameState, playerId)) {
        return res.status(403).json({ error: "This player is not currently active" });
    }
    const activePlayer = gameState.participants.find(p => p.id === playerId);
    
    activePlayer.forbiddenGiftId = null;

    const newGift = {
        id: `g_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        description,
        isFrozen: false,
        stealCount: 0,
        ownerId: activePlayer.id,
        ownerHistory: [activePlayer.id]
    };

    // UPDATE STATE
    gameState.gifts.push(newGift); 
    activePlayer.heldGiftId = newGift.id;
    activePlayer.status = 'done';
    activePlayer.isVictim = false; 

    const turnPlayer = gameState.participants.find(p => p.number === gameState.currentTurn);
    if (turnPlayer && turnPlayer.status === 'done') {
        gameState.currentTurn += 1;
    }
    
    gameState.activeVictimId = null;
    gameState.timerStart = Date.now();

    gameState.history.push(`${activePlayer.name} opened a new gift: ${description}`);
    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);

    res.json({ success: true, activePlayer, gift: newGift });
});

// 6. STEAL GIFT
app.post('/api/:gameId/steal', async (req, res) => {
    const { gameId } = req.params;
    const { giftId, thiefId } = req.body;
    const key = getGameKey(gameId);

    const data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    // Validate (Uses imported function)
    if (!isPlayerActive(gameState, thiefId)) {
        return res.status(403).json({ error: "This player is not allowed to steal right now" });
    }
    const thief = gameState.participants.find(p => p.id === thiefId);
    
    const gift = gameState.gifts.find(g => g.id === giftId);
    if (!gift || !gift.ownerId) return res.status(404).json({ error: "Invalid gift" });
    if (gift.isFrozen) return res.status(400).json({ error: "Gift is frozen" });
    if (gift.ownerId === thief.id) return res.status(400).json({ error: "Cannot steal from self" });
    if (thief.forbiddenGiftId === gift.id) return res.status(400).json({ error: "No take-backs!" });

    const victim = gameState.participants.find(p => p.id === gift.ownerId);

    // Execute Swap
    victim.heldGiftId = null;
    victim.status = 'waiting';
    victim.forbiddenGiftId = gift.id; 
    victim.isVictim = true; 

    thief.heldGiftId = gift.id;
    thief.status = 'done';
    thief.forbiddenGiftId = null;
    thief.isVictim = false; 

    gameState.activeVictimId = null;

    gift.ownerId = thief.id;
    gift.ownerHistory.push(thief.id);
    gift.stealCount += 1;
    if (gift.stealCount >= gameState.settings.maxSteals) gift.isFrozen = true;

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

// 9. UPDATE SETTINGS
app.put('/api/:gameId/settings', async (req, res) => {
    const { gameId } = req.params;
    const { maxSteals, turnDurationSeconds, activePlayerCount, scrollSpeed } = req.body;
    const key = getGameKey(gameId);

    const data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    if (maxSteals !== undefined) gameState.settings.maxSteals = parseInt(maxSteals);
    if (turnDurationSeconds !== undefined) gameState.settings.turnDurationSeconds = parseInt(turnDurationSeconds);
    if (activePlayerCount !== undefined) gameState.settings.activePlayerCount = parseInt(activePlayerCount);
    if (scrollSpeed !== undefined) gameState.settings.scrollSpeed = parseInt(scrollSpeed);

    gameState.gifts.forEach(g => {
        if (g.stealCount >= gameState.settings.maxSteals) {
            g.isFrozen = true;
        } else {
            g.isFrozen = false;
        }
    });

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);

    res.json({ success: true, settings: gameState.settings });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);
    
    socket.on('joinGame', (gameId) => {
        socket.join(gameId);
        console.log(`Joined room: ${gameId}`);
    });

    // NEW: Live Preview Relay (Does not save to DB)
    socket.on('previewSettings', (data) => {
        // Broadcast to the room (Scoreboard will hear this)
        socket.to(data.gameId).emit('settingsPreview', data.settings);
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Elephant Exchange running on port ${PORT}`));
