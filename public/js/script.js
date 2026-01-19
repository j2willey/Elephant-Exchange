/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

let socket;
let currentGameId = null;
let stealingPlayerId = null; 
let originalScrollSpeed = 3; 

document.addEventListener('DOMContentLoaded', () => {
    // 1. UI Zoom Restore
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

    // 2. Auto-Login from URL (Fixes "Reset" bug)
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

    // Create/Join Request
    const res = await fetch('/api/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ gameId })
    });

    if(res.ok) {
        currentGameId = gameId;
        
        // Update URL so Refresh works
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
    if (socket) socket.disconnect();
    socket = io();
    
    socket.on('connect', () => {
        socket.emit('joinGame', gameId);
        document.getElementById('displayGameId').style.color = "inherit";
    });

    socket.on('stateUpdate', (state) => {
        render(state);
    });
}

async function refreshState() {
    if(!currentGameId) return;
    try {
        const res = await fetch(`/api/${currentGameId}/state`);
        if(res.ok) {
            const state = await res.json();
            render(state);
        }
    } catch(e) { console.error("State fetch failed", e); }
}

function render(state) {
    // --- GHOST BUSTER PROTOCOL ---
    if (stealingPlayerId) {
        const thief = state.participants.find(p => p.id === stealingPlayerId);
        if (!thief || thief.heldGiftId) stealingPlayerId = null;
    }

    // 1. Header
    document.getElementById('displayGameId').innerHTML = 
        `${state.id} <span style="font-size:0.6em; color:#666;">(Turn #${state.currentTurn})</span>`;

    // 2. Participants
    const pList = document.getElementById('participantList');
    pList.innerHTML = '';

    // Calculate Active Players (Queue Logic)
    const activeIds = getActiveIds(state);

    // Sort: Active First, then Number
    const sortedParticipants = state.participants.sort((a,b) => {
        const aActive = activeIds.includes(a.id);
        const bActive = activeIds.includes(b.id);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return a.number - b.number;
    });

    sortedParticipants.forEach(p => {
        const isTrulyActive = activeIds.includes(p.id);

        const li = document.createElement('li');
        if (isTrulyActive) {
            li.style.border = "2px solid var(--primary)";
            li.style.background = "#eff6ff";
            
            // Highlight Victim Red
            if (p.isVictim) {
                li.style.borderColor = "#dc2626";
                li.style.background = "#fef2f2";
            }
        }

        let statusIcon = '⏳';
        if (p.heldGiftId) statusIcon = '🎁';
        if (isTrulyActive) statusIcon = '🔴';

        // Victim Stats Badge
        let statsBadge = '';
        if (p.timesStolenFrom > 0) {
            statsBadge = `<span style="font-size:0.8rem; background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px; margin-left:5px;">💔 ${p.timesStolenFrom}</span>`;
        }

        let html = `<span><b>#${p.number}</b> ${p.name} ${statsBadge}`;
        
        // Timer Display (Using Individual Start Time)
        if (isTrulyActive) {
            const duration = state.settings.turnDurationSeconds || 60;
            const startTime = p.turnStartTime || Date.now(); 
            html += ` <span class="player-timer" data-start="${startTime}" data-duration="${duration}" style="font-family:monospace; font-weight:bold; font-size:1.2em; margin-left:10px;">--:--</span>`;
        }
        html += `</span>`;
        
        // ACTION BUTTONS
        if (isTrulyActive && !p.heldGiftId) {
            if (stealingPlayerId === p.id) {
                html += `
                    <div class="action-buttons">
                        <span style="color:#d97706; font-weight:bold; font-size:0.9em; margin-right:5px;">Select Gift below...</span>
                        <button onclick="cancelStealMode()" class="btn-gray">Cancel</button>
                    </div>
                `;
            } else if (stealingPlayerId) {
                html += `<div style="font-size:0.8em; color:#ccc;">Waiting...</div>`;
            } else {
                html += `
                    <div class="action-buttons">
                        <button onclick="promptOpenGift('${p.id}')" class="btn-green">🎁 Open</button>
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

            // --- NEW: Camera Icon Logic ---
            const imgCount = (g.images && g.images.length) || 0;
            const camColor = imgCount > 0 ? '#3b82f6' : '#9ca3af'; // Blue if photos exist, Gray if empty
            const camIcon = imgCount > 0 ? `📷 ${imgCount}` : '➕';
            // ------------------------------

            return `
                <li style="${itemStyle}">
                    <div>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <span style="font-weight:500;">${g.description}</span>
                            <button onclick="editGift('${g.id}', '${g.description.replace(/'/g, "\\'")}')" style="background:none; border:none; padding:0; cursor:pointer; font-size:1em;" title="Edit Name">✏️</button>
                            
                            <button onclick="openImgModal('${g.id}')" style="background:none; border:none; color:${camColor}; cursor:pointer; font-size:0.9em; margin-left:8px;" title="Manage Images">
                                ${camIcon}
                            </button>
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

// --- LOGIC HELPERS ---
function getActiveIds(state) {
    const victims = state.participants.filter(p => p.isVictim && !p.heldGiftId);
    const queue = state.participants
        .filter(p => !p.isVictim && !p.heldGiftId && p.number >= state.currentTurn)
        .sort((a,b) => a.number - b.number);
    const limit = state.settings.activePlayerCount || 1;
    const slotsForQueue = Math.max(0, limit - victims.length);
    const activeQueue = queue.slice(0, slotsForQueue);
    return [...victims, ...activeQueue].map(p => p.id);
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

// RESET GAME LOGIC
async function clearDb() {
    if(!currentGameId) {
        alert("No Game ID found. Try refreshing.");
        return;
    }
    if(!confirm("⚠️ DANGER: This will delete ALL players and gifts for this game.\n\nAre you sure?")) return;
    
    try {
        const res = await fetch(`/api/${currentGameId}/reset`, { method: 'POST' });
        if(res.ok) {
            location.reload();
        } else {
            alert("Reset failed. Server might be down.");
        }
    } catch(e) {
        alert("Reset failed. Network error.");
    }
}

function enterStealMode(playerId) {
    stealingPlayerId = playerId;
    refreshState(); 
}

function cancelStealMode() {
    stealingPlayerId = null;
    refreshState();
}

// --- TIMER LOOP ---
setInterval(updateTimers, 1000);

function updateTimers() {
    const timerElements = document.querySelectorAll('.player-timer');
    if(timerElements.length === 0) return;

    timerElements.forEach(el => {
        const start = parseInt(el.dataset.start);
        const duration = parseInt(el.dataset.duration) * 1000;
        if (!start) return; // Wait for timestamp
        
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

// --- SETTINGS MODAL & TV REMOTE ---
function openSettings() {
    if(!currentGameId) return;
    fetch(`/api/${currentGameId}/state`)
        .then(res => res.json())
        .then(state => {
            const s = state.settings;
            document.getElementById('settingDuration').value = s.turnDurationSeconds || 60;
            document.getElementById('settingMaxSteals').value = s.maxSteals || 3;
            document.getElementById('settingActiveCount').value = s.activePlayerCount || 1;
            document.getElementById('settingScrollSpeed').value = (s.scrollSpeed !== undefined) ? s.scrollSpeed : 3;
            originalScrollSpeed = s.scrollSpeed;
            
            // New Settings (Checkboxes)
            const soundThemeEl = document.getElementById('settingSoundTheme');
            if(soundThemeEl) soundThemeEl.value = s.soundTheme || 'standard';
            
            const statsEl = document.getElementById('settingShowVictimStats');
            if(statsEl) statsEl.checked = s.showVictimStats || false;

            document.getElementById('settingsModal').classList.remove('hidden');
        });
}

async function saveSettings() {
    const turnDurationSeconds = document.getElementById('settingDuration').value;
    const maxSteals = document.getElementById('settingMaxSteals').value;
    const activePlayerCount = document.getElementById('settingActiveCount').value;
    const scrollSpeed = document.getElementById('settingScrollSpeed').value;
    
    // Optional fields
    const soundThemeEl = document.getElementById('settingSoundTheme');
    const soundTheme = soundThemeEl ? soundThemeEl.value : 'standard';
    
    const statsEl = document.getElementById('settingShowVictimStats');
    const showVictimStats = statsEl ? statsEl.checked : false;

    await fetch(`/api/${currentGameId}/settings`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
            turnDurationSeconds, maxSteals, activePlayerCount, scrollSpeed, 
            soundTheme, showVictimStats 
        })
    });
    document.getElementById('settingsModal').classList.add('hidden');
}

function cancelSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}
function setTvMode(mode) {
    if(!currentGameId) return;
    socket.emit('previewSettings', { gameId: currentGameId, settings: { tvMode: mode } });
}
function previewScrollSpeed() {
    const val = document.getElementById('settingScrollSpeed').value;
    socket.emit('previewSettings', { gameId: currentGameId, settings: { scrollSpeed: val } });
}

// --- LOCAL QR ---
function showLocalQr() {
    if(!currentGameId) return;
    const origin = window.location.origin;
    const url = `${origin}/scoreboard.html?game=${currentGameId}&mode=mobile`; // Auto mobile link
    
    const container = document.getElementById('localQrcode');
    container.innerHTML = '';
    document.getElementById('qrGameIdDisplay').innerText = currentGameId;
    
    new QRCode(container, { text: url, width: 200, height: 200 });

    // Clickable Link
    let link = document.getElementById('localQrLink');
    if(!link) {
        link = document.createElement('a');
        link.id = 'localQrLink';
        link.target = "_blank";
        link.style.display = "block";
        link.style.marginTop = "10px";
        link.style.color = "#2563eb";
        container.parentElement.appendChild(link);
    }
    link.href = url;
    link.innerText = "🔗 Click to Open Link";

    document.getElementById('localQrModal').classList.remove('hidden');
}

function closeLocalQr() {
    document.getElementById('localQrModal').classList.add('hidden');
}

// --- ADMIN IMAGE MANAGEMENT ---
let currentAdminGiftId = null;

window.openImgModal = function(giftId) {
    // Fetch latest state to ensure we have up-to-date image lists
    fetch(`/api/${currentGameId}/state`)
        .then(r => r.json())
        .then(state => {
            const gift = state.gifts.find(g => g.id === giftId);
            if (!gift) return;

            currentAdminGiftId = giftId;
            document.getElementById('imgModalTitle').innerText = `Images: ${gift.description}`;
            
            // USE NEW CSS CLASS
            document.getElementById('imageModal').classList.add('active'); 
            
            renderAdminImages(gift);
        });
}

window.closeImgModal = function() {
    document.getElementById('imageModal').classList.remove('active');
    currentAdminGiftId = null;
}

function renderAdminImages(gift) {
    const container = document.getElementById('imgList');
    container.innerHTML = '';

    if (!gift.images || gift.images.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; color:#9ca3af; text-align:center;">No images yet.</div>';
        return;
    }

    gift.images.forEach(img => {
        const isPrimary = img.id === gift.primaryImageId;
        const heroClass = isPrimary ? 'hero' : '';
        
        const div = document.createElement('div');
        div.className = `admin-img-card ${heroClass}`;
        
        div.innerHTML = `
            <img src="${img.path}">
            <div class="admin-img-controls">
                <button onclick="setPrimaryImage('${gift.id}', '${img.id}')" style="color:#10b981; background:none; border:none; cursor:pointer; font-weight:bold;">★ Hero</button>
                <button onclick="deleteImage('${gift.id}', '${img.id}')" style="color:#ef4444; background:none; border:none; cursor:pointer;">🗑 Del</button>
            </div>
            ${isPrimary ? '<div style="position:absolute; top:0; left:0; background:#10b981; color:white; font-size:0.7rem; padding:2px 6px;">HERO</div>' : ''}
        `;
        container.appendChild(div);
    });
}

window.deleteImage = async function(giftId, imageId) {
    if (!confirm("Permanently delete this photo?")) return;
    try {
        const res = await fetch(`/api/${currentGameId}/images/${giftId}/${imageId}`, { method: 'DELETE' });
        if (res.ok) reloadModal(giftId);
    } catch (e) { console.error(e); }
}

window.setPrimaryImage = async function(giftId, imageId) {
    try {
        const res = await fetch(`/api/${currentGameId}/images/${giftId}/primary`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageId })
        });
        if (res.ok) reloadModal(giftId);
    } catch(e) { console.error(e); }
}

window.adminUpload = async function() {
    const input = document.getElementById('adminFileInput');
    const file = input.files[0];
    if (!file || !currentAdminGiftId) return;

    const formData = new FormData();
    formData.append('photo', file);
    formData.append('giftId', currentAdminGiftId);
    formData.append('uploaderName', 'Admin');

    try {
        const res = await fetch(`/api/${currentGameId}/upload`, { method: 'POST', body: formData });
        if (res.ok) {
            input.value = '';
            reloadModal(currentAdminGiftId);
        }
    } catch (e) { console.error(e); }
}

window.openCatalog = function() {
    if(currentGameId) window.open(`/catalog.html?game=${currentGameId}`, '_blank');
    else alert("Please join a game first.");
}

function reloadModal(giftId) {
    fetch(`/api/${currentGameId}/state`)
        .then(r => r.json())
        .then(state => {
            const gift = state.gifts.find(g => g.id === giftId);
            if(gift) renderAdminImages(gift);
        });
}

// --- EVENT BINDINGS ---
document.getElementById('gameIdInput').addEventListener('keypress', e => e.key === 'Enter' && joinGame());
document.getElementById('pName').addEventListener('keypress', e => e.key === 'Enter' && addParticipant());