/*
 * ==============================================================================
 * 🐘 ELEPHANT EXCHANGE - GAME SERVER
 * ==============================================================================
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 *
 * Architecture: Node.js + Express + Socket.io + Redis
 * Entry Point for Docker Container
 * ==============================================================================
 */

// --- 1. IMPORTS & SETUP ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Import Game Logic Library
const { getDefaultState, isPlayerActive, updateActiveTimers } = require('./lib/gameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 2. DATABASE (REDIS) ---
// Connect to Redis Container (Service Name: 'redis-db')
const redisClient = createClient({ url: 'redis://redis-db:6379' });
redisClient.on('error', (err) => console.log('Redis Client Error', err));
(async () => { await redisClient.connect(); console.log('✅ Connected to Redis'); })();

const getGameKey = (gameId) => `game:${gameId}`;

// --- 3. FILE UPLOAD CONFIGURATION ---
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(uploadDir, req.params.gameId || 'default');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(express.static('public'));
app.use(express.json());


// --- 4. HELPER FUNCTIONS ---

async function getGameState(gameId) {
    const data = await redisClient.get(getGameKey(gameId));
    return data ? JSON.parse(data) : null;
}

async function saveGameState(gameId, state) {
    state.lastActivity = Date.now();
    await redisClient.set(getGameKey(gameId), JSON.stringify(state));
}


// ==============================================================================
// API ROUTES
// ==============================================================================

// --- SECTION A: GAME MANAGEMENT ---

// 1. Create or Join Game
app.post('/api/create', async (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: "Game ID required" });

    const key = getGameKey(gameId);
    const exists = await redisClient.exists(key);

    if (!exists) {
        const newState = getDefaultState(gameId);
        newState.createdAt = Date.now(); // Track creation
        await saveGameState(gameId, newState);
        console.log(`✨ New Game Created: ${gameId}`);
    }
    res.json({ success: true, gameId });
});

// 2. Get Game State (Polling/Refresh)
app.get('/api/:gameId/state', async (req, res) => {
    const state = await getGameState(req.params.gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });
    res.json(state);
});

// 3. Reset Game (Clear Data)
app.post('/api/:gameId/reset', async (req, res) => {
    const { gameId } = req.params;
    const newState = getDefaultState(gameId);
    // Preserve Branding Settings if they exist in the old state
    const oldState = await getGameState(gameId);
    if (oldState && oldState.settings) {
        newState.settings = { ...newState.settings, ...oldState.settings };
    }
    
    await saveGameState(gameId, newState);
    io.to(gameId).emit('stateUpdate', newState);
    res.json({ success: true });
});

// 4. Update Settings
app.put('/api/:gameId/settings', async (req, res) => {
    const { gameId } = req.params;
    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    state.settings = { ...state.settings, ...req.body };

    await saveGameState(gameId, state);
    io.to(gameId).emit('settingsUpdate', state.settings);
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});

// 5. Upload Logo
app.post('/api/:gameId/upload-logo', upload.single('logo'), async (req, res) => {
    const { gameId } = req.params;
    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });
    
    if (req.file) {
        state.settings.themeLogo = `/uploads/${gameId}/${req.file.filename}`;
        await saveGameState(gameId, state);
        io.to(gameId).emit('stateUpdate', state);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "No file uploaded" });
    }
});


// --- SECTION B: PHASE MANAGEMENT ---

// 6. Start Voting
app.post('/api/:gameId/phase/voting', async (req, res) => {
    const { gameId } = req.params;
    const { durationSeconds } = req.body;
    
    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    state.phase = 'voting';
    state.votingEndsAt = Date.now() + (durationSeconds * 1000);
    
    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});

// 7. End Game / Show Results
app.post('/api/:gameId/phase/results', async (req, res) => {
    const { gameId } = req.params;
    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    state.phase = 'results';
    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});


// --- SECTION C: PARTICIPANTS ---

// 8. Add Participant
app.post('/api/:gameId/participants', async (req, res) => {
    const { gameId } = req.params;
    const { name, number } = req.body;
    
    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    const num = parseInt(number) || (state.participants.length + 1);
    const newPlayer = {
        id: `p_${Date.now()}`,
        name: name || `Player ${num}`,
        number: num,
        heldGiftId: null,
        isVictim: false,
        timesStolenFrom: 0,
        turnStartTime: null
    };

    state.participants.push(newPlayer);
    updateActiveTimers(state);

    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});

// 9. NEW ROUTE: Update Participant (Reset Timer, etc)
app.put('/api/:gameId/participants/:pId', async (req, res) => {
    const { gameId, pId } = req.params;
    const updates = req.body;

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    const p = state.participants.find(x => x.id === pId);
    if (!p) return res.status(404).json({ error: "Player not found" });

    if (updates.turnStartTime !== undefined) p.turnStartTime = updates.turnStartTime;
    if (updates.name !== undefined) p.name = updates.name;

    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});


// --- SECTION D: GAMEPLAY ACTIONS ---

// 10. Open New Gift
app.post('/api/:gameId/open-new', async (req, res) => {
    const { gameId } = req.params;
    const { description, playerId } = req.body;

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    const player = state.participants.find(p => p.id === playerId);
    if (!player) return res.status(404).json({ error: "Player not found" });

    const giftId = `g_${Date.now()}`;
    const newGift = {
        id: giftId,
        description: description,
        ownerId: playerId,
        stealCount: 0,
        isFrozen: false,
        images: [],
        downvotes: []
    };

    state.gifts.push(newGift);
    player.heldGiftId = giftId;
    
    if (!player.isVictim) {
        state.currentTurn++;
    }
    player.isVictim = false;
    updateActiveTimers(state);

    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});


// 11. Steal Gift
app.post('/api/:gameId/steal', async (req, res) => {
    const { gameId } = req.params;
    const { giftId, thiefId } = req.body;

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    const thief = state.participants.find(p => p.id === thiefId);
    const gift = state.gifts.find(g => g.id === giftId);
    if (!thief || !gift) return res.status(404).json({ error: "Not found" });

    const maxSteals = state.settings.maxSteals || 3;
    if (gift.isFrozen) return res.status(400).json({ error: "Gift is Frozen" });
    if (gift.stealCount >= maxSteals) return res.status(400).json({ error: "Max Steals Reached" });
    if (thief.forbiddenGiftId === giftId) return res.status(400).json({ error: "No Take-Backs!" });

    const victim = state.participants.find(p => p.id === gift.ownerId);
    
    if (victim) {
        victim.heldGiftId = null;
        victim.isVictim = true;
        victim.forbiddenGiftId = giftId;
        victim.timesStolenFrom++;
    }

    thief.heldGiftId = giftId;
    thief.isVictim = false;
    thief.forbiddenGiftId = null;
    
    gift.ownerId = thiefId;
    gift.stealCount++;
    if (gift.stealCount >= maxSteals) {
        gift.isFrozen = true;
    }

    if (!thief.isVictim && state.participants.find(p => p.number === state.currentTurn)?.id === thiefId) {
         state.currentTurn++;
    }
    
    updateActiveTimers(state);

    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});

// 12. Upload Photo
app.post('/api/:gameId/upload', upload.single('photo'), async (req, res) => {
    const { gameId } = req.params;
    const { giftId, uploaderName } = req.body;
    
    const state = await getGameState(gameId);
    const gift = state.gifts.find(g => g.id === giftId);
    
    if (gift && req.file) {
        const imgEntry = {
            id: `img_${Date.now()}`,
            path: `/uploads/${gameId}/${req.file.filename}`,
            uploader: uploaderName || 'Anonymous',
            timestamp: Date.now()
        };
        
        if (!gift.images) gift.images = [];
        gift.images.push(imgEntry);
        
        if (!gift.primaryImageId) gift.primaryImageId = imgEntry.id;
        
        await saveGameState(gameId, state);
        io.to(gameId).emit('stateUpdate', state);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "Invalid upload" });
    }
});

// 13. Set Primary Image
app.put('/api/:gameId/images/:giftId/primary', async (req, res) => {
    const { gameId, giftId } = req.params;
    const { imageId } = req.body;
    
    const state = await getGameState(gameId);
    const gift = state.gifts.find(g => g.id === giftId);
    
    if (gift) {
        gift.primaryImageId = imageId;
        await saveGameState(gameId, state);
        io.to(gameId).emit('stateUpdate', state);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Gift not found" });
    }
});

// 14. Delete Image
app.delete('/api/:gameId/images/:giftId/:imageId', async (req, res) => {
    const { gameId, giftId, imageId } = req.params;
    
    const state = await getGameState(gameId);
    const gift = state.gifts.find(g => g.id === giftId);
    
    if (gift && gift.images) {
        gift.images = gift.images.filter(img => img.id !== imageId);
        if (gift.primaryImageId === imageId) {
            gift.primaryImageId = gift.images.length > 0 ? gift.images[0].id : null;
        }
        await saveGameState(gameId, state);
        io.to(gameId).emit('stateUpdate', state);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Not found" });
    }
});

// 15. Vote for Worst Gift
app.post('/api/:gameId/vote', async (req, res) => {
    const { gameId } = req.params;
    const { giftId, voterId } = req.body;

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    state.gifts.forEach(g => {
        if (g.downvotes) g.downvotes = g.downvotes.filter(id => id !== voterId);
    });

    const gift = state.gifts.find(g => g.id === giftId);
    if (gift) {
        if (!gift.downvotes) gift.downvotes = [];
        gift.downvotes.push(voterId);
    }

    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});


// --- SECTION E: SUPER ADMIN ---

app.get('/api/admin/games', async (req, res) => {
    const keys = await redisClient.keys('game:*');
    const games = [];
    
    for (const key of keys) {
        const data = await redisClient.get(key);
        if (data) {
            const state = JSON.parse(data);
            games.push({
                id: state.id,
                players: state.participants ? state.participants.length : 0,
                gifts: state.gifts ? state.gifts.length : 0,
                createdAt: state.createdAt || 0,
                lastActivity: state.lastActivity || 0,
                phase: state.phase || 'active'
            });
        }
    }
    
    games.sort((a,b) => b.lastActivity - a.lastActivity);
    res.json(games);
});

app.delete('/api/admin/games/:gameId', async (req, res) => {
    const { gameId } = req.params;
    await redisClient.del(getGameKey(gameId));
    res.json({ success: true });
});

app.delete('/api/admin/flush', async (req, res) => {
    const keys = await redisClient.keys('game:*');
    if (keys.length > 0) await redisClient.del(keys);
    res.json({ success: true, count: keys.length });
});


// --- SECTION F: SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('joinGame', (gameId) => {
        socket.join(gameId);
    });
    socket.on('previewSettings', ({ gameId, settings }) => {
        io.to(gameId).emit('settingsPreview', settings);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});