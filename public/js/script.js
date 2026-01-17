/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

let socket;
let currentGameId = null;
let stealingPlayerId = null; // Tracks who is currently looking for a gift to steal
let originalScrollSpeed = 3; // Store original value for canceling

// 1. AUTO-LOGIN ON LOAD
document.addEventListener('DOMContentLoaded', () => {
    // UI Scale Logic
    const scaleSlider = document.getElementById('uiScale');
    const savedScale = localStorage.getItem('elephantScale');
    if (savedScale) {
        document.body.style.zoom = savedScale;
        if(scaleSlider) scaleSlider.value = savedScale;
    }
    if(scaleSlider) {
        scaleSlider.addEventListener('input', (e) => {
            document.body.style.zoom = e.target.value;
            localStorage.setItem('elephantScale', e.target.value);
        });
    }

    // NEW: Check URL or LocalStorage for Game ID
    const params = new URLSearchParams(window.location.search);
    const urlGameId = params.get('game');
    
    if (urlGameId) {
        document.getElementById('gameIdInput').value = urlGameId;
        joinGame(urlGameId);
    }
});

async function joinGame(forceId = null) {
    const inputId = document.getElementById('gameIdInput').value.trim();
    const gameId = forceId || inputId;
    
    if(!gameId) return alert("Please enter a Game ID");

    const res = await fetch('/api/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ gameId })
    });

    if(res.ok) {
        currentGameId = gameId;
        
        // Update URL without reloading (so refresh works later)
        const newUrl = `${window.location.pathname}?game=${gameId}`;
        window.history.pushState({path: newUrl}, '', newUrl);

        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        document.getElementById('displayGameId').innerText = gameId;
        
        initSocket(gameId);
        refreshState();
    }
}

function initSocket(gameId) {
    if (socket) socket.disconnect(); // Prevent duplicates
    socket = io();
    
    // 2. RECONNECT LOGIC
    socket.on('connect', () => {
        console.log("🟢 Connected to server");
        // Re-join room immediately
        socket.emit('joinGame', gameId);
        
        document.getElementById('displayGameId').style.color = "inherit";
        document.getElementById('displayGameId').innerText = gameId;
        
        refreshState();
    });

    socket.on('disconnect', () => {
        console.log("🔴 Disconnected");
        document.getElementById('displayGameId').style.color = "red";
        document.getElementById('displayGameId').innerText = gameId + " (Offline)";
    });

    socket.on('stateUpdate', (state) => {
        render(state);
    });
}

async function refreshState() {
    const res = await fetch(`/api/${currentGameId}/state`);
    const state = await res.json();
    render(state);
}

function render(state) {
    // --- GHOST BUSTER PROTOCOL 👻 ---
    if (stealingPlayerId) {
        const thief = state.participants.find(p => p.id === stealingPlayerId);
        if (!thief || thief.heldGiftId) {
            console.log("Ghost Buster: Clearing stale steal mode for", stealingPlayerId);
            stealingPlayerId = null;
        }
    }

    // 1. Header
    document.getElementById('displayGameId').innerHTML = 
        `${state.id} <span style="font-size:0.6em; color:#666;">(Turn #${state.currentTurn})</span>`;

    // 2. Participants
    const pList = document.getElementById('participantList');
    pList.innerHTML = '';

    // --- Active Set (Slots) Logic ---
    const victims = state.participants.filter(p => p.isVictim && !p.heldGiftId);
    
    // Identify Queue
    const queue = state.participants
        .filter(p => !p.isVictim && !p.heldGiftId && p.number >= state.currentTurn)
        .sort((a,b) => a.number - b.number);

    const limit = state.settings.activePlayerCount || 1;
    const slotsForQueue = Math.max(0, limit - victims.length);
    const activeQueue = queue.slice(0, slotsForQueue);
    
    // List of IDs that are currently "Active"
    const activeIds = [...victims, ...activeQueue].map(p => p.id);

    // SORTING: Active Players First, then by Number
    const sortedParticipants = state.participants.sort((a,b) => {
        const aActive = activeIds.includes(a.id);
        const bActive = activeIds.includes(b.id);
        
        if (aActive && !bActive) return -1; // A moves up
        if (!aActive && bActive) return 1;  // B moves up
        return a.number - b.number;         // Otherwise numeric
    });

    sortedParticipants.forEach(p => {
        const isTrulyActive = activeIds.includes(p.id);

        const li = document.createElement('li');
        if (isTrulyActive) {
            li.style.border = "2px solid var(--primary)";
            li.style.background = "#eff6ff";
            // Make sure active players are visible in the scroll container
            // (Optional: scrollIntoView logic could go here, but might be annoying if you are editing)
        }

        let statusIcon = '⏳';
        if (p.heldGiftId) statusIcon = '🎁';
        if (isTrulyActive) statusIcon = '🔴';

        let html = `<span><b>#${p.number}</b> ${p.name}`;
        
        if (isTrulyActive) {
            const duration = state.settings.turnDurationSeconds || 60;
            const startTime = state.timerStart || Date.now();
            html += ` <span class="player-timer" data-start="${startTime}" data-duration="${duration}" style="font-family:monospace; font-weight:bold; font-size:1.2em; margin-left:10px;">--:--</span>`;
        }
        html += `</span>`;
        
        // ACTION BUTTONS
        if (isTrulyActive && !p.heldGiftId) {
            if (stealingPlayerId === p.id) {
                // Stealing State
                html += `
                    <div class="action-buttons">
                        <span style="color:#d97706; font-weight:bold; font-size:0.9em; margin-right:5px;">Select Gift below...</span>
                        <button onclick="cancelStealMode()" class="btn-gray">Cancel</button>
                    </div>
                `;
            } else if (stealingPlayerId) {
                // Waiting State
                html += `<div style="font-size:0.8em; color:#ccc;">Waiting...</div>`;
            } else {
                // Normal State
                html += `
                    <div class="action-buttons">
                        <button onclick="promptOpenGift('${p.id}')" class="btn-green">🎁 Open New</button>
                        <button onclick="enterStealMode('${p.id}')" class="btn-orange">😈 Steal</button>
                    </div>
                `;
            }
        } else {
            html += `<span>${statusIcon}</span>`;
        }

        li.innerHTML = html;
        pList.appendChild(li);
    });

    // 3. Gifts
    const gList = document.getElementById('giftList');
    const sortedGifts = state.gifts.sort((a,b) => {
        if (a.isFrozen !== b.isFrozen) return a.isFrozen - b.isFrozen;
        return b.stealCount - a.stealCount;
    });

    if (sortedGifts.length === 0) {
        gList.innerHTML = `<li style="color:#ccc; justify-content:center;">No gifts revealed yet</li>`;
    } else {
        gList.innerHTML = sortedGifts.map(g => {
            const owner = state.participants.find(p => p.id === g.ownerId);
            const ownerName = owner ? owner.name : 'Unknown';
            
            let isForbidden = false;
            if (stealingPlayerId) {
                const thief = state.participants.find(p => p.id === stealingPlayerId);
                if (thief && thief.forbiddenGiftId === g.id) isForbidden = true;
            }

            const itemStyle = g.isFrozen ? 'opacity: 0.5; background: #f1f5f9;' : '';
            
            let statusBadge = '';
            if (g.isFrozen) statusBadge = `<span class="badge" style="background:#333; color:#fff;">🔒 LOCKED</span>`;
            else if (isForbidden) statusBadge = `<span class="badge" style="background:#fde68a; color:#92400e;">🚫 NO TAKE-BACKS</span>`;
            else statusBadge = g.stealCount > 0 ? `<span class="badge stolen">${g.stealCount}/3 Steals</span>` : `<span class="badge">0/3 Steals</span>`;

            const showStealBtn = stealingPlayerId && !g.isFrozen && !isForbidden;

            return `
                <li style="${itemStyle}">
                    <div>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <span style="font-weight:500;">${g.description}</span>
                            <button onclick="editGift('${g.id}', '${g.description.replace(/'/g, "\\'")}')" style="background:none; border:none; padding:0; cursor:pointer; font-size:1em;" title="Edit Name">✏️</button>
                        </div>
                        <div style="font-size:0.8em; color:#666;">Held by <b>${ownerName}</b></div>
                    </div>
                    <div style="text-align:right;">
                        ${statusBadge}
                        ${showStealBtn ? `<button onclick="attemptSteal('${g.id}', '${g.description.replace(/'/g, "\\'")}')" class="btn-orange" style="font-size:0.7em; margin-left:5px;">Select</button>` : ''}
                    </div>
                </li>
            `;
        }).join('');
    }
}


// --- ACTIONS ---

async function promptOpenGift(playerId) {
    const description = prompt("What is inside the gift?");
    if (!description) return;
    
    await fetch(`/api/${currentGameId}/open-new`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ description, playerId }) 
    });
}

async function addParticipant() {
    const numInput = document.getElementById('pNumber');
    const nameInput = document.getElementById('pName');
    if(!nameInput.value && !numInput.value) return;
    await fetch(`/api/${currentGameId}/participants`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name: nameInput.value, number: numInput.value })
    });
    nameInput.value = '';
    numInput.value = '';
    nameInput.focus();
}

// Updated STEAL: Includes Race Condition Fix
async function attemptSteal(giftId, description) {
    if (!stealingPlayerId) return; 

    if(!confirm(`Confirm steal: ${description}?`)) return;

    try {
        const res = await fetch(`/api/${currentGameId}/steal`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ giftId, thiefId: stealingPlayerId }) 
        });

        if(!res.ok) {
            const data = await res.json();
            alert("Error: " + data.error);
        }
    } catch (err) {
        console.error(err);
        alert("Steal failed.");
    } finally {
        stealingPlayerId = null;
        refreshState();
    }
}

async function editGift(giftId, currentDesc) {
    const newDesc = prompt("Update gift description:", currentDesc);
    if (!newDesc || newDesc === currentDesc) return;
    await fetch(`/api/${currentGameId}/gifts/${giftId}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ description: newDesc })
    });
}

async function clearDb() {
    if(!confirm("Are you sure? This deletes all players and gifts.")) return;
    await fetch(`/api/${currentGameId}/reset`, { method: 'POST' });
    location.reload();
}

function enterStealMode(playerId) {
    stealingPlayerId = playerId;
    refreshState(); 
}

function cancelStealMode() {
    stealingPlayerId = null;
    refreshState();
}

// --- TIMER LOGIC ---
setInterval(updateTimers, 1000);

function updateTimers() {
    const timerElements = document.querySelectorAll('.player-timer');
    if(timerElements.length === 0) return;

    timerElements.forEach(el => {
        const start = parseInt(el.dataset.start);
        const duration = parseInt(el.dataset.duration) * 1000;
        const now = Date.now();
        const elapsed = now - start;
        const remaining = Math.max(0, duration - elapsed);

        const seconds = Math.ceil(remaining / 1000);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        el.innerText = `${m}:${s.toString().padStart(2, '0')}`;

        if (seconds <= 10) el.style.color = "#dc2626"; 
        else if (seconds <= 30) el.style.color = "#d97706"; 
        else el.style.color = "#2563eb"; 
    });
}

// --- SETTINGS MODAL LOGIC (FIXED) ---
function openSettings() {
    // Uses current game ID to fetch active settings
    if(!currentGameId) return;

    fetch(`/api/${currentGameId}/state`)
        .then(res => res.json())
        .then(state => {
            const s = state.settings;
            document.getElementById('settingDuration').value = s.turnDurationSeconds || 60;
            document.getElementById('settingMaxSteals').value = s.maxSteals || 3;
            document.getElementById('settingActiveCount').value = s.activePlayerCount || 1;

            // Load and Store Original
            const speed = (s.scrollSpeed !== undefined) ? s.scrollSpeed : 3;
            document.getElementById('settingScrollSpeed').value = speed;
            originalScrollSpeed = speed;

            document.getElementById('settingsModal').classList.remove('hidden');
        });
}

function cancelSettings() {
    // REVERT: Send the original value back to the TV
    socket.emit('previewSettings', { 
        gameId: currentGameId, 
        settings: { scrollSpeed: originalScrollSpeed } 
    });

    document.getElementById('settingsModal').classList.add('hidden');
}

function previewScrollSpeed() {
    const val = document.getElementById('settingScrollSpeed').value;
    // Emit directly to server (bypassing DB)
    socket.emit('previewSettings', { 
        gameId: currentGameId, 
        settings: { scrollSpeed: val } 
    });
}

async function saveSettings() {
    const turnDurationSeconds = document.getElementById('settingDuration').value;
    const maxSteals = document.getElementById('settingMaxSteals').value;
    const activePlayerCount = document.getElementById('settingActiveCount').value;
    const scrollSpeed = document.getElementById('settingScrollSpeed').value;

    await fetch(`/api/${currentGameId}/settings`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ turnDurationSeconds, maxSteals, activePlayerCount, scrollSpeed })
    });

// Close the modal directly (no dependency on other functions)
    document.getElementById('settingsModal').classList.add('hidden');
}

// BROADCAST TV MODE
function setTvMode(mode) {
    if(!currentGameId) return;
    socket.emit('previewSettings', { 
        gameId: currentGameId, 
        settings: { tvMode: mode } // We hijack the existing preview channel!
    });
}

// --- TV REMOTE FUNCTIONS ---
function setTvMode(mode) {
    if(!currentGameId) return;
    // Piggyback on the preview channel to send commands to TV
    socket.emit('previewSettings', { 
        gameId: currentGameId, 
        settings: { tvMode: mode } 
    });
}

// --- LOCAL QR FUNCTIONS ---
function showLocalQr() {
    if(!currentGameId) return;

    const origin = window.location.origin;
    // Construct the URL with the mobile flag
    const url = `${origin}/scoreboard.html?game=${currentGameId}&mode=mobile`;

    const container = document.getElementById('localQrcode');
    container.innerHTML = '';
    
    // Update the Game ID text
    document.getElementById('qrGameIdDisplay').innerText = currentGameId;

    // 1. Generate QR
    new QRCode(container, {
        text: url,
        width: 200,
        height: 200
    });

    // 2. Add Clickable Link (NEW)
    // We append a simple link below the QR code for easy testing
    const link = document.createElement('a');
    link.href = url;
    link.target = "_blank";
    link.innerText = "🔗 Click to Open Link";
    link.style.display = "block";
    link.style.marginTop = "15px";
    link.style.color = "#2563eb";
    link.style.textDecoration = "underline";
    
    container.appendChild(link);

    // Show Modal
    document.getElementById('localQrModal').classList.remove('hidden');
}

function closeLocalQr() {
    document.getElementById('localQrModal').classList.add('hidden');
}

// EVENT LISTENERS
document.getElementById('gameIdInput').addEventListener('keypress', e => e.key === 'Enter' && joinGame());
document.getElementById('pName').addEventListener('keypress', e => e.key === 'Enter' && addParticipant());