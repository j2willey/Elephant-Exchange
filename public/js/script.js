/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

let socket;
let currentGameId = null;
let stealingPlayerId = null; // Tracks who is currently looking for a gift to steal

document.addEventListener('DOMContentLoaded', () => {
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
});

async function joinGame() {
    const gameId = document.getElementById('gameIdInput').value.trim();
    if(!gameId) return alert("Please enter a Game ID");

    const res = await fetch('/api/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ gameId })
    });

    if(res.ok) {
        currentGameId = gameId;
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        document.getElementById('displayGameId').innerText = gameId;
        initSocket(gameId);
        refreshState();
    }
}

function initSocket(gameId) {
    socket = io();
    socket.emit('joinGame', gameId);
    socket.on('stateUpdate', (state) => {
        console.log("⚡ Update:", state);
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
    // If the UI thinks someone is stealing, but the Server says they are Done (have a gift),
    // we must force-clear the stealing mode immediately.
    if (stealingPlayerId) {
        const thief = state.participants.find(p => p.id === stealingPlayerId);
        // If thief doesn't exist, OR they have a gift, OR they became a victim... stop waiting!
        if (!thief || thief.heldGiftId) {
            console.log("Ghost Buster: Clearing stale steal mode for", stealingPlayerId);
            stealingPlayerId = null;
        }
    }
    // --------------------------------

    // 1. Header
    document.getElementById('displayGameId').innerHTML = 
        `${state.id} <span style="font-size:0.6em; color:#666;">(Turn #${state.currentTurn})</span>`;

    // 2. Participants
    const pList = document.getElementById('participantList');
    pList.innerHTML = '';
    const sortedParticipants = state.participants.sort((a,b) => a.number - b.number);

    // --- Active Set (Slots) Logic ---
    const victims = state.participants.filter(p => p.isVictim && !p.heldGiftId);
    
    // Identify Queue (Non-Victims, Waiting, >= CurrentTurn)
    const queue = state.participants
        .filter(p => !p.isVictim && !p.heldGiftId && p.number >= state.currentTurn)
        .sort((a,b) => a.number - b.number);

    const limit = state.settings.activePlayerCount || 1;
    const slotsForQueue = Math.max(0, limit - victims.length);
    
    const activeQueue = queue.slice(0, slotsForQueue);
    const activeIds = [...victims, ...activeQueue].map(p => p.id);
    // --------------------------------

    sortedParticipants.forEach(p => {
        const isTrulyActive = activeIds.includes(p.id);

        const li = document.createElement('li');
        if (isTrulyActive) {
            li.style.border = "2px solid var(--primary)";
            li.style.background = "#eff6ff";
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
                // This player is actively selecting
                html += `
                    <div class="action-buttons">
                        <span style="color:#d97706; font-weight:bold; font-size:0.9em; margin-right:5px;">Select Gift below...</span>
                        <button onclick="cancelStealMode()" class="btn-gray">Cancel</button>
                    </div>
                `;
            } else if (stealingPlayerId) {
                // Someone ELSE is stealing. We must wait.
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
async function promptOpenGift() {
    const description = prompt("What is inside the gift?");
    if (!description) return;
    await fetch(`/api/${currentGameId}/open-new`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ description })
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
        // ALWAYS run this, success or fail
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

function showStealOptions() {
    document.getElementById('giftList').scrollIntoView({behavior: 'smooth'});
    // Flash the list to draw attention
    const list = document.getElementById('giftList');
    list.style.transition = "background 0.2s";
    list.style.background = "#fff7ed";
    setTimeout(() => list.style.background = "transparent", 300);
}

// 6. TIMER LOGIC
setInterval(updateTimers, 1000); // Run every second

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

        // Format: "0:59"
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        el.innerText = `${m}:${s.toString().padStart(2, '0')}`;

        // Visual Cues (Red text when low)
        if (seconds <= 10) el.style.color = "#dc2626"; // Red
        else if (seconds <= 30) el.style.color = "#d97706"; // Orange
        else el.style.color = "#2563eb"; // Blue
    });
}

// 7. SETTINGS MODAL LOGIC
function openSettings() {
    // Current state should be available globally via render, 
    // but better to fetch fresh or store state in a global variable.
    // For now, let's fetch state to be safe.
    fetch(`/api/${currentGameId}/state`)
        .then(res => res.json())
        .then(state => {
            document.getElementById('settingDuration').value = state.settings.turnDurationSeconds || 60;
            document.getElementById('settingMaxSteals').value = state.settings.maxSteals || 3;
            document.getElementById('settingActiveCount').value = state.settings.activePlayerCount || 1;
            
            document.getElementById('settingsModal').classList.remove('hidden');
        });
}

function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

async function saveSettings() {
    const turnDurationSeconds = document.getElementById('settingDuration').value;
    const maxSteals = document.getElementById('settingMaxSteals').value;
    const activePlayerCount = document.getElementById('settingActiveCount').value;

    await fetch(`/api/${currentGameId}/settings`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ turnDurationSeconds, maxSteals, activePlayerCount })
    });

    closeSettings();
}

// --- NEW ACTION HANDLERS ---

function enterStealMode(playerId) {
    stealingPlayerId = playerId;
    // Re-render to update UI (hide other buttons, show gift buttons)
    // We can fetch state to trigger a re-render
    refreshState(); 
}

function cancelStealMode() {
    stealingPlayerId = null;
    refreshState();
}

// Updated OPEN: Accepts playerId
async function promptOpenGift(playerId) {
    const description = prompt("What is inside the gift?");
    if (!description) return;
    
    await fetch(`/api/${currentGameId}/open-new`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ description, playerId }) // NEW: Send ID
    });
}

// Updated STEAL: Uses global stealingPlayerId
async function attemptSteal(giftId, description) {
    if (!stealingPlayerId) return; // Safety check

    if(!confirm(`Confirm steal: ${description}?`)) return;

    const res = await fetch(`/api/${currentGameId}/steal`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ giftId, thiefId: stealingPlayerId }) // NEW: Send ID
    });

    if(!res.ok) {
        const data = await res.json();
        alert("Error: " + data.error);
    } else {
        // Reset mode on success
        stealingPlayerId = null;
    }
}

document.getElementById('gameIdInput').addEventListener('keypress', e => e.key === 'Enter' && joinGame());
document.getElementById('pName').addEventListener('keypress', e => e.key === 'Enter' && addParticipant());
