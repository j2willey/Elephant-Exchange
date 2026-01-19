/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Import Logic
const { getDefaultState, isPlayerActive, updateActiveTimers } = require('./lib/gameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Connect to Redis (Service Name: 'redis-db')
const redisClient = createClient({ url: 'redis://redis-db:6379' });
redisClient.on('error', (err) => console.log('Redis Client Error', err));
(async () => { await redisClient.connect(); console.log('✅ Connected to Redis'); })();

// --- UPLOAD CONFIGURATION ---
const uploadDir = path.join(__dirname, 'public/uploads');

// Ensure directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage Engine
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Create a sub-folder per game to keep things tidy
        const gameId = req.params.gameId;
        const gameDir = path.join(uploadDir, gameId);
        if (!fs.existsSync(gameDir)) {
            fs.mkdirSync(gameDir, { recursive: true });
        }
        cb(null, gameDir);
    },
    filename: (req, file, cb) => {
        // Naming: giftId_timestamp_random.jpg
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

// --- MIDDLEWARE ---
app.use(express.static('public'));
app.use(express.json());

const getGameKey = (gameId) => `game:${gameId}`;

// --- API ROUTES ---

// 1. CREATE
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
    const data = await redisClient.get(getGameKey(req.params.gameId));
    if (!data) return res.status(404).json({ error: "Game not found" });
    res.json(JSON.parse(data));
});

// 3. ADD PARTICIPANT
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
        id: `p_${Date.now()}_${Math.floor(Math.random() * 1000)}`, // Unique ID
        name: name || `Player ${finalNumber}`,
        number: finalNumber,
        status: 'waiting',
        heldGiftId: null,
        forbiddenGiftId: null,
        isVictim: false,
        turnStartTime: null,    // NEW: Individual Timer
        timesStolenFrom: 0      // NEW: Victim Stats
    };

    gameState.participants.push(newParticipant);
    gameState.participants.sort((a,b) => a.number - b.number);

    // Check if this new player triggers a timer start
    updateActiveTimers(gameState);

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true, participant: newParticipant });
});

// 4. OPEN NEW GIFT
app.post('/api/:gameId/open-new', async (req, res) => {
    const { gameId } = req.params;
    const { description, playerId } = req.body;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    if (gameState.settings.isPaused) return res.status(400).json({ error: "Game is paused" });

    // Validate Active Player
    if (!isPlayerActive(gameState, playerId)) {
        return res.status(400).json({ error: "It is not this player's turn" });
    }

    const player = gameState.participants.find(p => p.id === playerId);
    
    const newGift = {
        id: `g_${Date.now()}_${Math.floor(Math.random() * 1000)}`, // Unique ID
        description,
        ownerId: player.id,
        stealCount: 0,
        isFrozen: false,
        history: [] // Track who held it
    };

    player.heldGiftId = newGift.id;
    player.status = 'done';
    player.isVictim = false; 
    player.turnStartTime = null; // Clear timer

    gameState.gifts.push(newGift);
    gameState.currentTurn += 1;
    gameState.activeVictimId = null;
    
    // NEW: Update everyone's timers
    updateActiveTimers(gameState);

    gameState.history.push(`${player.name} opened ${description}`);

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true });
});

// 5. STEAL GIFT
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

    // --- EXECUTE STEAL ---
    
    // 1. Update Victim (The person losing the gift)
    if (victim) {
        victim.heldGiftId = null;
        victim.isVictim = true;
        victim.status = 'waiting'; 
        victim.forbiddenGiftId = gift.id; // No take-backs
        
        // NEW: Increment Stats
        if (!victim.timesStolenFrom) victim.timesStolenFrom = 0;
        victim.timesStolenFrom++;
    }

    // 2. Update Thief
    if (thief.heldGiftId) {
        // Swap logic (if allowed) - currently simplified to simple steal
        // In simple mode, thief shouldn't have a gift usually.
    }
    thief.heldGiftId = gift.id;
    thief.status = 'done';
    thief.isVictim = false;
    thief.forbiddenGiftId = null; 
    thief.turnStartTime = null; // Clear timer

    // 3. Update Gift
    gift.ownerId = thief.id;
    gift.stealCount += 1;
    if (gift.stealCount >= gameState.settings.maxSteals) {
        gift.isFrozen = true;
    }

    // 4. Game State
    gameState.activeVictimId = victim ? victim.id : null;
    gameState.history.push(`${thief.name} stole ${gift.description} from ${victim ? victim.name : 'someone'}`);

    // NEW: Update timers (Victim needs a start time now)
    updateActiveTimers(gameState);

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    res.json({ success: true });
});

// 6. UPDATE SETTINGS
app.put('/api/:gameId/settings', async (req, res) => {
    const { gameId } = req.params;
    const { maxSteals, turnDurationSeconds, activePlayerCount, scrollSpeed, soundTheme, showVictimStats } = req.body;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    if (maxSteals !== undefined) gameState.settings.maxSteals = parseInt(maxSteals);
    if (turnDurationSeconds !== undefined) gameState.settings.turnDurationSeconds = parseInt(turnDurationSeconds);
    if (activePlayerCount !== undefined) gameState.settings.activePlayerCount = parseInt(activePlayerCount);
    if (scrollSpeed !== undefined) gameState.settings.scrollSpeed = parseInt(scrollSpeed);
    if (soundTheme !== undefined) gameState.settings.soundTheme = soundTheme;
    // NEW: Setting
    if (showVictimStats !== undefined) gameState.settings.showVictimStats = showVictimStats;

    // Recalculate locks if maxSteals changed
    if (maxSteals !== undefined) {
        gameState.gifts.forEach(g => {
            g.isFrozen = (g.stealCount >= gameState.settings.maxSteals);
        });
    }

    // Recalculate queue if activeCount changed
    if (activePlayerCount !== undefined) {
        updateActiveTimers(gameState);
    }

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    // Also emit specific settings event for lightweight listeners
    io.to(gameId).emit('settingsPreview', gameState.settings);

    res.json({ success: true, settings: gameState.settings });
});

// 7. RESET GAME
app.post('/api/:gameId/reset', async (req, res) => {
    const { gameId } = req.params;
    const key = getGameKey(gameId);
    
    console.log(`💥 Resetting Game: ${gameId}`);
    
    // Overwrite existing data with a fresh default state
    const newState = getDefaultState(gameId);
    await redisClient.set(key, JSON.stringify(newState));
    
    // Tell everyone to refresh
    io.to(gameId).emit('stateUpdate', newState);
    
    res.json({ success: true });
});

// 8. EDIT GIFT
app.put('/api/:gameId/gifts/:giftId', async (req, res) => {
    const { gameId, giftId } = req.params;
    const { description } = req.body;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    const gift = gameState.gifts.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: "Gift not found" });

    // Update the description
    console.log(`✏️ Renaming Gift ${giftId}: ${gift.description} -> ${description}`);
    gift.description = description;

    // Save & Broadcast
    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState); // <--- This line updates the TV!

    res.json({ success: true });
});

// 9. UPLOAD IMAGE
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

    // Initialize image array if missing
    if (!gift.images) gift.images = [];

    // Create Image Object
    const newImage = {
        id: `img_${Date.now()}`,
        filename: req.file.filename,
        path: `/uploads/${gameId}/${req.file.filename}`, // Web-accessible path
        uploader: uploaderName || 'Anonymous',
        timestamp: Date.now()
    };

    // If first image, make it primary automatically
    if (gift.images.length === 0) {
        gift.primaryImageId = newImage.id;
    }

    gift.images.push(newImage);

    console.log(`📸 New Photo for ${gift.description}: ${newImage.filename}`);

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);

    res.json({ success: true, image: newImage });
});

// 10. DELETE IMAGE
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

    // 1. Remove from Disk
    const filePath = path.join(uploadDir, gameId, imageToDelete.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    // 2. Remove from Data
    gift.images.splice(imageIndex, 1);

    // 3. Handle Primary Image Logic
    if (gift.primaryImageId === imageId) {
        gift.primaryImageId = gift.images.length > 0 ? gift.images[0].id : null;
    }

    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);

    res.json({ success: true });
});


// --- TEST/AUTOMATION ROUTES ---

// 1. HTTP Join (for seeding scripts)
app.post('/api/:gameId/join', async (req, res) => {
    const { gameId } = req.params;
    const { name } = req.body;
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    
    let gameState = JSON.parse(data);
    
    // Use your existing logic or simple push
    // Check for duplicates to be safe
    if (!gameState.participants.find(p => p.name === name)) {
        const newPlayer = {
            id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: name,
            number: gameState.participants.length + 1,
            isVictim: false,
            heldGiftId: null,
            turnStartTime: null
        };
        gameState.participants.push(newPlayer);
        await redisClient.set(key, JSON.stringify(gameState));
        io.to(gameId).emit('stateUpdate', gameState);
    }
    
    res.json({ success: true });
});

// 2. HTTP Move (for seeding scripts)
app.post('/api/:gameId/move', async (req, res) => {
    const { gameId } = req.params;
    const { playerId, action, description, targetId } = req.body; // targetId used for steals
    const key = getGameKey(gameId);

    let data = await redisClient.get(key);
    if (!data) return res.status(404).json({ error: "Game not found" });
    let gameState = JSON.parse(data);

    // --- LOGIC REPLICATION (Simplified for Seeding) ---
    const player = gameState.participants.find(p => p.id === playerId);
    if (!player) return res.status(400).json({ error: "Player not found" });

    if (action === 'open') {
        const newGift = {
            id: `g_${Date.now()}`,
            description: description || "Mystery Gift",
            ownerId: player.id,
            isFrozen: false,
            stealCount: 0,
            openOrder: gameState.gifts.length + 1,
            images: [] // Initialize empty images array
        };
        gameState.gifts.push(newGift);
        player.heldGiftId = newGift.id;
        
        // Advance turn logic (simple)
        gameState.currentTurn++; 
    }
    
    await redisClient.set(key, JSON.stringify(gameState));
    io.to(gameId).emit('stateUpdate', gameState);
    
    res.json({ success: true });
});


// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('joinGame', (gameId) => {
        socket.join(gameId);
    });
    socket.on('previewSettings', (data) => {
        socket.to(data.gameId).emit('settingsPreview', data.settings);
    });
});

server.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
});