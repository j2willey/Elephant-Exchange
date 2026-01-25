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


// --- THEME LOADER ---
const themeDir = path.join(__dirname, 'themes');
let AVAILABLE_THEMES = [];

function loadThemes() {
    if (!fs.existsSync(themeDir)) {
        console.log("⚠️ No 'themes' directory found. Using defaults.");
        return;
    }

    const files = fs.readdirSync(themeDir).filter(f => f.endsWith('.json'));
    AVAILABLE_THEMES = files.map(f => {
        try {
            const content = fs.readFileSync(path.join(themeDir, f), 'utf8');
            return JSON.parse(content);
        } catch (e) {
            console.error(`❌ Failed to load theme ${f}:`, e.message);
            return null;
        }
    }).filter(t => t !== null);

    console.log(`🎨 Loaded ${AVAILABLE_THEMES.length} themes from disk.`);
}

// Load immediately on startup
loadThemes();



// --- 4. HELPER FUNCTIONS ---

async function getGameState(gameId) {
    const data = await redisClient.get(getGameKey(gameId));
    return data ? JSON.parse(data) : null;
}

async function saveGameState(gameId, state) {
    state.lastActivity = Date.now();
    await redisClient.set(getGameKey(gameId), JSON.stringify(state));
}

// Helper to generate simple IDs
function generateId(index = 'late_add') {
    return `p_${Date.now()}_${index}`;
}

// ==============================================================================
// API ROUTES
// ==============================================================================

// --- SECTION A: GAME MANAGEMENT ---

// 1. Create or Join Game
app.post('/api/create', async (req, res) => {
    const { gameId, partyName } = req.body;
    if (!gameId) return res.status(400).json({ error: "Game ID required" });

    const key = getGameKey(gameId);
    const exists = await redisClient.exists(key);

    if (!exists) {
        const newState = getDefaultState(gameId);
        newState.createdAt = Date.now(); // Track creation
        if (partyName) newState.settings.partyName = partyName;
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

// 4. Update Settings & Handle Roster Import
app.put('/api/:gameId/settings', async (req, res) => {
    const { gameId } = req.params;
    const { rosterNames, ...settingsUpdates } = req.body; // Extract rosterNames separately

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    // 1. Update Standard Settings
    state.settings = { ...state.settings, ...settingsUpdates };

    // 2. Handle Roster Import (The Randomizer)
    if (rosterNames && Array.isArray(rosterNames) && rosterNames.length > 0) {
        console.log(`🎲 Randomizing Roster for ${gameId} with ${rosterNames.length} names.`);

        // Fisher-Yates Shuffle
        const shuffled = [...rosterNames];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Create Participants from Shuffled List
        // WARNING: This replaces existing participants to prevent duplicates during setup
        state.participants = shuffled.map((name, index) => ({
            id: generateId(),
            name: name,
            number: index + 1, // Assign turn order 1..N based on shuffle
            heldGiftId: null,
            isVictim: false,
            timesStolenFrom: 0,
            turnStartTime: null
        }));

        // Reset turn to 1
        state.currentTurn = 1;
    }

    await saveGameState(gameId, state);

    // Broadcast updates
    io.to(gameId).emit('settingsUpdate', state.settings);
    io.to(gameId).emit('stateUpdate', state);

    res.json({ success: true });
});

// --- SECTION: THEME API ---

// 1. GET Available Themes
app.get('/api/themes', (req, res) => {
    res.json(AVAILABLE_THEMES);
});

// 2. RELOAD Themes (Admin Trigger)
app.post('/api/admin/reload-themes', (req, res) => {
    loadThemes();
    // Optional: Emit to clients so admin UI refreshes instantly
    // io.emit('themesUpdated', AVAILABLE_THEMES);
    res.json({ success: true, count: AVAILABLE_THEMES.length });
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

// 8. ADD PARTICIPANT (With Late Arrival Logic)
app.post('/api/:gameId/participants', async (req, res) => {
    const { gameId } = req.params;
    const { name, number, insertRandomly } = req.body; // <--- Added insertRandomly

    if (!name) return res.status(400).json({ error: "Name is required" });

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    // Determine the new player's number
    let newNumber;

    if (number) {
        // Manual override provided
        newNumber = parseInt(number);
    }
    else if (insertRandomly && state.participants.length > 0) {
        // --- LATE ARRIVAL LOGIC ---
        // Find the range of "Future Turns"
        // 1. Find the highest number currently in the game
        const maxNum = state.participants.reduce((max, p) => Math.max(max, p.number), 0);

        // 2. Find the "High Water Mark" (highest number that has already started/finished)
        //    (Players with a gift or the currently active player)
        //    We calculate this by looking at everyone.
        //    Actually, simpler: Find the lowest number that hasn't played yet?
        //    Let's just assume we insert between (ActiveNumber + 1) and (MaxNum + 1).

        // Find current active number (or 0 if game hasn't started)
        // We estimate "Active" as the lowest number that doesn't have a heldGift?
        // Or we rely on the client knowing the state.
        // Let's rely on "Max Held Gift Number".
        const maxPlayedNum = state.participants
            .filter(p => p.heldGiftId)
            .reduce((max, p) => Math.max(max, p.number), 0);

        const minInsert = maxPlayedNum + 1;
        const maxInsert = maxNum + 1;

        if (minInsert > maxInsert) {
             // Edge case: everyone finished. Just append.
             newNumber = maxNum + 1;
        } else {
             // Pick a random spot in the remaining timeline
             // Formula: Math.floor(Math.random() * (max - min + 1)) + min
             newNumber = Math.floor(Math.random() * (maxInsert - minInsert + 1)) + minInsert;
        }

        console.log(`🎲 Late Arrival: Inserting ${name} at #${newNumber} (Range: ${minInsert}-${maxInsert})`);

    }
    else {
        // Default: Append to end
        const maxNum = state.participants.reduce((max, p) => Math.max(max, p.number), 0);
        newNumber = maxNum + 1;
    }

    // SHIFT LOGIC: If the spot is taken, bump everyone up
    // We check if anyone is >= newNumber, and increment them
    // (We do this for both Manual and Random insertions to prevent collisions)
    const collision = state.participants.some(p => p.number === newNumber);
    if (collision || insertRandomly) {
         state.participants.forEach(p => {
             if (p.number >= newNumber) {
                 p.number++;
             }
         });
    }

    const newPlayer = {
        id: generateId(),
        number: newNumber,
        name: name.trim(),
        heldGiftId: null,
        isVictim: false,
        timesStolenFrom: 0
    };

    state.participants.push(newPlayer);

    // Sort to keep it tidy
    state.participants.sort((a,b) => a.number - b.number);

    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);

    res.json({ success: true, player: newPlayer });
});

// 9. Update Participant (Reset Timer, etc)
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
    const { name, description, playerId } = req.body;

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    const player = state.participants.find(p => p.id === playerId);
    if (!player) return res.status(404).json({ error: "Player not found" });

    const giftId = `g_${Date.now()}`;
    const newGift = {
        id: giftId,
        name: name,
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

// 10.5. Update Existing Gift (Edit Name/Description)
app.put('/api/:gameId/gift/:giftId', async (req, res) => {
    const { gameId, giftId } = req.params;
    const { name, description } = req.body;

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    const gift = state.gifts.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: "Gift not found" });

    // Update fields
    if (name !== undefined) gift.name = name;
    if (description !== undefined) gift.description = description;

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


// 11. SWAP/SKIP TURN (Bathroom Break)
app.post('/api/:gameId/participants/:participantId/swap', async (req, res) => {
    const { gameId, participantId } = req.params;
    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });

    const pA = state.participants.find(p => p.id === participantId);
    if (!pA) return res.status(404).json({ error: "Participant not found" });

    // FIX: Don't just look for "number + 1".
    // Look for the *next highest number* to handle gaps in the list.
    const pB = state.participants
        .filter(p => p.number > pA.number) // Everyone ahead of me
        .sort((a, b) => a.number - b.number)[0]; // The closest one

    if (!pB) {
        // If no one is ahead, we can't skip (you are last!)
        return res.status(400).json({ error: "Cannot skip: No next player found!" });
    }
    if (pB.heldGiftId) {
        return res.status(400).json({ error: "Cannot skip: Next player has already gone!" });
    }

    // PERFORM THE SWAP
    const temp = pA.number;
    pA.number = pB.number;
    pB.number = temp;

    // Sort list by new numbers to keep data clean
    state.participants.sort((a, b) => a.number - b.number);

    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);

    res.json({ success: true, message: `Swapped ${pA.name} with ${pB.name}` });
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


// DELETE PARTICIPANT (Safety Valve)
app.delete('/api/:gameId/participants/:participantId', async (req, res) => {
    const { gameId, participantId } = req.params;
    const state = await getGameState(gameId);

    if (!state) return res.status(404).json({ error: "Game not found" });

    const pIndex = state.participants.findIndex(p => p.id === participantId);
    if (pIndex === -1) return res.status(404).json({ error: "Participant not found" });

    const p = state.participants[pIndex];

    // SAFETY CHECK: Cannot delete if they have already acted (hold a gift)
    // This prevents breaking the history chain.
    if (p.heldGiftId) {
        return res.status(400).json({ error: "Cannot delete a player who has already taken a turn!" });
    }

    // Remove them
    state.participants.splice(pIndex, 1);

    await saveGameState(gameId, state);
    io.to(gameId).emit('stateUpdate', state);

    res.json({ success: true });
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