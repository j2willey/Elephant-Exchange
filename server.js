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
    participants: [], // { id, name, number, status, heldGiftId, forbiddenGiftId, isVictim }
    gifts: [],        // { id, description, ownerId, stealCount, isFrozen }
    settings: { 
        maxSteals: 3, 
        isPaused: false, 
        turnDurationSeconds: 60, 
        activePlayerCount: 1
    },
    timerStart: Date.now(), 
    currentTurn: 1,
    activeVictimId: null, // Legacy global, replaced by isVictim flag for multi-player
    history: []
});

// HELPER: The "Slots" Logic (Multi-Player)
function isPlayerActive(gameState, playerId) {
    const target = gameState.participants.find(p => p.id === playerId);
    if (!target) return false;
    
    // Rule 1: If you are done, you are NOT active.
    if (target.status === 'done') return false;

    // Rule 2: If you are a Victim, you are ALWAYS active (Priority).
    if (target.isVictim) return true;

    // Rule 3: The Queue
    const activeLimit = gameState.settings.activePlayerCount || 1;
    
    // Count how many victims are currently taking up slots
    const activeVictims = gameState.participants.filter(p => p.isVictim && p.status !== 'done');
    const slotsTakenByVictims = activeVictims.length;
    
    // How many slots are left for the normal queue?
    let slotsForQueue = activeLimit - slotsTakenByVictims;
    if (slotsForQueue < 0) slotsForQueue = 0; 

    if (slotsForQueue === 0) return false; // No room for normal players

    // Find the next X people in the queue
    const sortedQueue = gameState.participants
        .filter(p => p.number >= gameState.currentTurn && p.status === 'waiting' && !p.isVictim)
        .sort((a,b) => a.number - b.number);

    // Is our target in the top X of this list?
    const activeQueuePlayers = sortedQueue.slice(0, slotsForQueue);
    return activeQueuePlayers.some(p => p.id === playerId);
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

    const nextNumber = gameState.participants.length + 1;
    const finalNumber = number ? parseInt(number) : nextNumber;

    const newParticipant = {
        id: `p_${Date.now()}`,
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
       
    // VALIDATE PLAYER
    if (!isPlayerActive(gameState, playerId)) {
        return res.status(403).json({ error: "This player is not currently active" });
    }
    const activePlayer = gameState.participants.find(p => p.id === playerId);
    
    // Clear restrictions
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
    gameState.gifts.push(newGift); 
    activePlayer.heldGiftId = newGift.id;
    activePlayer.status = 'done';
    activePlayer.isVictim = false; // Satisfied

    // Advance Turn Logic: Only advance if the "Turn Owner" is done
    const turnPlayer = gameState.participants.find(p => p.number === gameState.currentTurn);
    if (turnPlayer && turnPlayer.status === 'done') {
        gameState.currentTurn += 1;
    }
    
    // Clear legacy global just in case
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
    const { giftId, thiefId } = req.body; // FIX: Expect thiefId, avoid name collision
    const key = getGameKey(gameId);

    const data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    // Validate using the ID
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
    // Victim updates
    victim.heldGiftId = null;
    victim.status = 'waiting';
    victim.forbiddenGiftId = gift.id; 
    victim.isVictim = true; // Mark as Priority

    // Thief updates
    thief.heldGiftId = gift.id;
    thief.status = 'done';
    thief.forbiddenGiftId = null;
    thief.isVictim = false; // Satisfied

    // CLEANUP: We do NOT set gameState.activeVictimId here anymore.
    // We rely entirely on the .isVictim flag for multi-player logic.
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

// 9. ACTION: UPDATE SETTINGS
app.put('/api/:gameId/settings', async (req, res) => {
    const { gameId } = req.params;
    const { maxSteals, turnDurationSeconds, activePlayerCount } = req.body;
    const key = getGameKey(gameId);

    const data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    // Update fields if provided
    if (maxSteals !== undefined) gameState.settings.maxSteals = parseInt(maxSteals);
    if (turnDurationSeconds !== undefined) gameState.settings.turnDurationSeconds = parseInt(turnDurationSeconds);
    if (activePlayerCount !== undefined) gameState.settings.activePlayerCount = parseInt(activePlayerCount);

    // Re-evaluate Frozen status
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
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Elephant Exchange running on port ${PORT}`));