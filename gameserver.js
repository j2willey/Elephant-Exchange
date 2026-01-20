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
        // Sub-folder per game
        const gameId = req.params.gameId;
        const gameDir = path.join(uploadDir, gameId);
        if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
        cb(null, gameDir);
    },
    filename: (req, file, cb) => {
        // Format: img-TIMESTAMP-RANDOM.ext
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `img-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB Limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images are allowed'));
    }
});

// --- 4. MIDDLEWARE ---
app.use(express.static('public'));
app.use(express.json());


/*
 * ==============================================================================
 * API ROUTES
 * ==============================================================================
 */

// --- SECTION A: CORE GAME MANAGEMENT ---

// 1. Create/Join Game
app.post('/api/create', async (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    const key = getGameKey(gameId);
    
    // Only create if it doesn't exist
    const exists = await redisClient.exists(key);
    if (!exists) {
        console.log(`✨ Creating new game: ${gameId}`);
        const newState = getDefaultState(gameId);
        
        // ADD TIMESTAMPS
        newState.createdAt = Date.now();
        newState.lastActivity = Date.now();
        
        await redisClient.set(key, JSON.stringify(newState));    }
    res.json({ success: true, gameId });
});

// 2. Get Game State
app.get('/api/:gameId/state', async (req, res) => {
    const data = await redisClient.get(getGameKey(req.params.gameId));
    if (!data) return res.status(404).json({ error: "Game not found" });
    res.json(JSON.parse(data));
});

// 3. Reset Game (Nuclear Option)
app.post('/api/:gameId/reset', async (req, res) => {
    const { gameId } = req.params;
    console.log(`💥 Resetting Game: ${gameId}`);
    
    const newState = getDefaultState(gameId);
    await redisClient.set(getGameKey(gameId), JSON.stringify(newState));
    
    io.to(gameId).emit('stateUpdate', newState);
    res.json({ success: true });
});

// --- SECTION B: PARTICIPANTS & GAMEPLAY ---

// 4. Add Player
app.post('/api/:gameId/participants', async (req, res) => {
    const { gameId } = req.params;
    const { name, number } = req.body;
    const key = getGameKey(gameId);
    
    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    let finalNumber = number;
    if (!finalNumber) {
        const maxNum = gameState.participants.reduce((max, p) => Math.max(max, p.number), 0);
        finalNumber = maxNum + 1;
    }

    const newParticipant = {
        id: `p_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: name || `Player ${finalNumber}`,
        number: finalNumber,
        status: 'waiting',
        heldGiftId: null,
        forbiddenGiftId: null,
        isVictim: false,
        turnStartTime: null,
        timesStolenFrom: 0
    };

    gameState.participants.push(newParticipant);
    gameState.participants.sort((a,b) => a.number - b.number);
    updateActiveTimers(gameState);

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true, participant: newParticipant });
});

// 5. Open New Gift
app.post('/api/:gameId/open-new', async (req, res) => {
    const { gameId } = req.params;
    const { description, playerId } = req.body;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    if (gameState.settings.isPaused) return res.status(400).json({ error: "Game is paused" });
    if (!isPlayerActive(gameState, playerId)) return res.status(400).json({ error: "Not this player's turn" });

    const player = gameState.participants.find(p => p.id === playerId);
    
    const newGift = {
        id: `g_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        description,
        ownerId: player.id,
        stealCount: 0,
        isFrozen: false,
        history: [],
        images: []
    };

    player.heldGiftId = newGift.id;
    player.status = 'done';
    player.isVictim = false; 
    player.turnStartTime = null;

    gameState.gifts.push(newGift);
    gameState.currentTurn += 1;
    gameState.activeVictimId = null;
    updateActiveTimers(gameState);

    gameState.history.push(`${player.name} opened ${description}`);

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true });
});

// 6. Steal Gift
app.post('/api/:gameId/steal', async (req, res) => {
    const { gameId } = req.params;
    const { thiefId, giftId } = req.body;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    if (gameState.settings.isPaused) return res.status(400).json({ error: "Game is paused" });

    const thief = gameState.participants.find(p => p.id === thiefId);
    const gift = gameState.gifts.find(g => g.id === giftId);
    const victim = gameState.participants.find(p => p.id === gift.ownerId);

    if (!isPlayerActive(gameState, thiefId)) return res.status(400).json({ error: "Not thief's turn" });
    if (gift.isFrozen) return res.status(400).json({ error: "Gift is locked" });
    if (thief.forbiddenGiftId === gift.id) return res.status(400).json({ error: "Cannot steal back immediately" });

    // Execute Steal
    if (victim) {
        victim.heldGiftId = null;
        victim.isVictim = true;
        victim.status = 'waiting'; 
        victim.forbiddenGiftId = gift.id;
        victim.timesStolenFrom = (victim.timesStolenFrom || 0) + 1;
    }

    thief.heldGiftId = gift.id;
    thief.status = 'done';
    thief.isVictim = false;
    thief.forbiddenGiftId = null; 
    thief.turnStartTime = null;

    gift.ownerId = thief.id;
    gift.stealCount += 1;
    if (gift.stealCount >= gameState.settings.maxSteals) gift.isFrozen = true;

    gameState.activeVictimId = victim ? victim.id : null;
    gameState.history.push(`${thief.name} stole ${gift.description} from ${victim ? victim.name : 'someone'}`);
    updateActiveTimers(gameState);

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true });
});

// 7. Edit Gift Name
app.put('/api/:gameId/gifts/:giftId', async (req, res) => {
    const { gameId, giftId } = req.params;
    const { description } = req.body;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    const gift = gameState.gifts.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: "Gift not found" });

    console.log(`✏️ Renaming Gift ${giftId}: ${gift.description} -> ${description}`);
    gift.description = description;

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true });
});

// --- SECTION C: SETTINGS & BRANDING ---

// 8. Update Game Settings (Includes Branding)
app.put('/api/:gameId/settings', async (req, res) => {
    const { gameId } = req.params;
    // Destructure known settings to ensure safety, but INCLUDE branding now
    const { 
        maxSteals, turnDurationSeconds, activePlayerCount, scrollSpeed, 
        soundTheme, showVictimStats,
        themeColor, themeBg // <--- The Fix: Accept these fields!
    } = req.body;
    
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    if (!gameState.settings) gameState.settings = {};

    // Apply updates if they exist
    if (maxSteals !== undefined) gameState.settings.maxSteals = parseInt(maxSteals);
    if (turnDurationSeconds !== undefined) gameState.settings.turnDurationSeconds = parseInt(turnDurationSeconds);
    if (activePlayerCount !== undefined) gameState.settings.activePlayerCount = parseInt(activePlayerCount);
    if (scrollSpeed !== undefined) gameState.settings.scrollSpeed = parseInt(scrollSpeed);
    if (soundTheme !== undefined) gameState.settings.soundTheme = soundTheme;
    if (showVictimStats !== undefined) gameState.settings.showVictimStats = showVictimStats;
    
    // Branding Updates
    if (themeColor !== undefined) gameState.settings.themeColor = themeColor;
    if (themeBg !== undefined) gameState.settings.themeBg = themeBg;

    // Logic: Recalculate locks if maxSteals changed
    if (maxSteals !== undefined) {
        gameState.gifts.forEach(g => {
            g.isFrozen = (g.stealCount >= gameState.settings.maxSteals);
        });
    }

    // Logic: Recalculate queue if activeCount changed
    if (activePlayerCount !== undefined) {
        updateActiveTimers(gameState);
    }

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    io.to(gameId).emit('settingsPreview', gameState.settings);

    res.json({ success: true, settings: gameState.settings });
});

// 9. Upload Branding Logo
app.post('/api/:gameId/upload-logo', upload.single('logo'), async (req, res) => {
    const { gameId } = req.params;
    const key = getGameKey(gameId);
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    const logoPath = `/uploads/${gameId}/${req.file.filename}`;
    if (!gameState.settings) gameState.settings = {};
    gameState.settings.themeLogo = logoPath;

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true, path: logoPath });
});

// --- SECTION D: IMAGE MANAGEMENT ---

// 10. Upload Gift Image
app.post('/api/:gameId/upload', upload.single('photo'), async (req, res) => {
    const { gameId } = req.params;
    const { giftId, uploaderName } = req.body;
    const key = getGameKey(gameId);

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    const gift = gameState.gifts.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: "Gift not found" });

    if (!gift.images) gift.images = [];

    const newImage = {
        id: `img_${Date.now()}`,
        filename: req.file.filename,
        path: `/uploads/${gameId}/${req.file.filename}`,
        uploader: uploaderName || 'Anonymous',
        timestamp: Date.now()
    };

    // Auto-set primary if first
    if (gift.images.length === 0) gift.primaryImageId = newImage.id;
    gift.images.push(newImage);

    console.log(`📸 New Photo for ${gift.description}: ${newImage.filename}`);
    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true, image: newImage });
});

// 11. Delete Image
app.delete('/api/:gameId/images/:giftId/:imageId', async (req, res) => {
    const { gameId, giftId, imageId } = req.params;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    const gift = gameState.gifts.find(g => g.id === giftId);
    if (!gift || !gift.images) return res.status(404).json({ error: "Gift/Images not found" });

    const imageIndex = gift.images.findIndex(img => img.id === imageId);
    if (imageIndex === -1) return res.status(404).json({ error: "Image not found" });

    const imageToDelete = gift.images[imageIndex];

    // Remove file from disk
    const filePath = path.join(uploadDir, gameId, imageToDelete.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Remove from array
    gift.images.splice(imageIndex, 1);

    // Fix primary image pointer
    if (gift.primaryImageId === imageId) {
        gift.primaryImageId = gift.images.length > 0 ? gift.images[0].id : null;
    }

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true });
});

// 12. Set Primary Image (Hero)
app.put('/api/:gameId/images/:giftId/primary', async (req, res) => {
    const { gameId, giftId } = req.params;
    const { imageId } = req.body;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    const gift = gameState.gifts.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: "Gift not found" });

    const exists = gift.images.find(img => img.id === imageId);
    if (!exists) return res.status(404).json({ error: "Image not found" });

    gift.primaryImageId = imageId;

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true });
});

// --- SECTION F: WORST GIFT VOTING ---

// 13. Start Voting Phase
app.post('/api/:gameId/phase/voting', async (req, res) => {
    const { gameId } = req.params;
    const { durationSeconds } = req.body; // Default 180
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let state = JSON.parse(data);

    state.phase = 'voting';
    state.votingEndsAt = Date.now() + (durationSeconds * 1000);
    
    // Clear old votes if restarting? Or keep them? Let's reset for fairness.
    // state.gifts.forEach(g => g.downvotes = []); 

    await redisClient.set(key, JSON.stringify(state));
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});

// 14. Cast Vote (Toggle)
app.post('/api/:gameId/vote', async (req, res) => {
    const { gameId } = req.params;
    const { giftId, voterId } = req.body; // voterId can be a random string from localStorage
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let state = JSON.parse(data);

    if (state.phase !== 'voting') return res.status(400).json({ error: "Voting not active" });

    const gift = state.gifts.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: "Gift not found" });

    if (!gift.downvotes) gift.downvotes = [];

    // Toggle logic
    const idx = gift.downvotes.indexOf(voterId);
    if (idx > -1) {
        gift.downvotes.splice(idx, 1); // Remove vote
    } else {
        gift.downvotes.push(voterId); // Add vote
    }
    state.lastActivity = Date.now();

    await redisClient.set(key, JSON.stringify(state));
    // Emit 'voteUpdate' for lighter bandwidth, or just full state
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});

// 15. End Game / Show Results
app.post('/api/:gameId/phase/results', async (req, res) => {
    const { gameId } = req.params;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let state = JSON.parse(data);

    state.phase = 'results';
    state.votingEndsAt = null;

    await redisClient.set(key, JSON.stringify(state));
    io.to(gameId).emit('stateUpdate', state);
    res.json({ success: true });
});

// --- SECTION G: SITE ADMIN (SUPER USER) ---

// 16. List All Games (with Metadata)
app.get('/api/admin/games', async (req, res) => {
    // NOTE: In production, you would password protect this route!
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
    
    // Sort by most recently active
    games.sort((a,b) => b.lastActivity - a.lastActivity);
    res.json(games);
});

// 17. Delete Specific Game
app.delete('/api/admin/games/:gameId', async (req, res) => {
    const { gameId } = req.params;
    await redisClient.del(getGameKey(gameId));
    // Also delete uploads? For now, we leave them or you can implement fs.rm
    console.log(`🗑️ Super Admin deleted game: ${gameId}`);
    res.json({ success: true });
});

// 18. Delete ALL Games (Nuclear)
app.delete('/api/admin/flush', async (req, res) => {
    const keys = await redisClient.keys('game:*');
    if (keys.length > 0) await redisClient.del(keys);
    console.log(`☢️ Super Admin flushed ${keys.length} games`);
    res.json({ success: true, count: keys.length });
});


// --- SECTION E: SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('joinGame', (gameId) => {
        socket.join(gameId);
    });
    // Used for real-time preview of scroll speed / tv modes
    socket.on('previewSettings', (data) => {
        socket.to(data.gameId).emit('settingsPreview', data.settings);
    });
});

server.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
});