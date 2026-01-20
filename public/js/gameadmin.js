/*
 * ==============================================================================
 * ELEPHANT EXCHANGE - ADMIN CONTROLLER
 * ==============================================================================
 * Manages the Host Dashboard, Game State, Phase Logic, and Settings.
 * Dependencies: gamelib.js (Shared Logic), socket.io
 */

// --- 1. GLOBALS & CONFIG ---
let socket;
let currentGameId = null;
let stealingPlayerId = null; 
let currentAdminGiftId = null; // Tracks which gift is being edited in the modal
let votingInterval = null;     // Tracks the countdown timer loop

// --- 2. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // A. UI: Restore Zoom Preference
    const scaleSlider = document.getElementById('uiScale');
    const savedScale = localStorage.getItem('elephantScale');
    if (savedScale && scaleSlider) {
        document.body.style.zoom = savedScale;
        scaleSlider.value = savedScale;
    }
    if(scaleSlider) {
        scaleSlider.addEventListener('input', (e) => {
            document.body.style.zoom = e.target.value;
            localStorage.setItem('elephantScale', e.target.value);
        });
    }

    // B. Auth: Auto-Login from URL param
    const params = new URLSearchParams(window.location.search);
    const urlGameId = params.get('game');
    if (urlGameId) {
        document.getElementById('gameIdInput').value = urlGameId;
        joinGame(urlGameId);
    }

    // C. Bind Enter Keys for convenience
    document.getElementById('gameIdInput').addEventListener('keypress', e => e.key === 'Enter' && joinGame());
    document.getElementById('pName').addEventListener('keypress', e => e.key === 'Enter' && addParticipant());
});

// --- 3. CONNECTION & STATE MANAGEMENT ---

async function joinGame(forceId = null) {
    const inputId = document.getElementById('gameIdInput').value.trim();
    const gameId = forceId || inputId;
    if(!gameId) return alert("Please enter a Game ID");

    // Create or Join Game via API
    const res = await fetch('/api/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ gameId })
    });

    if(res.ok) {
        currentGameId = gameId;
        
        // Update Browser URL (clean history)
        const newUrl = `${window.location.pathname}?game=${gameId}`;
        window.history.pushState({path: newUrl}, '', newUrl);

        // Switch Views
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

    // Real-time update listener
    socket.on('stateUpdate', (state) => {
        render(state);
    });
}

async function refreshState() {
    if(!currentGameId) return;
    try {
        const res = await fetch(`/api/${currentGameId}/state`);
        if(res.ok) render(await res.json());
    } catch(e) { console.error("State fetch failed", e); }
}

// --- 4. RENDER LOGIC (THE VIEW) ---

function render(state) {
    // A. Apply Theme (from gamelib.js)
    if(window.applyTheme) applyTheme(state.settings);

    // B. Render Phase Controls (Active vs Voting vs Results)
    renderPhaseControls(state);

    // C. Ghost Protocol: Clear stale steal state
    if (stealingPlayerId) {
        const thief = state.participants.find(p => p.id === stealingPlayerId);
        // If thief is done or holding a gift, they can't be stealing anymore
        if (!thief || thief.heldGiftId) stealingPlayerId = null;
    }

    // D. Update Header Info
    document.getElementById('displayGameId').innerHTML = 
        `${state.id} <span style="font-size:0.6em; color:#666;">(Turn #${state.currentTurn})</span>`;

    // E. Render Lists
    renderParticipants(state);
    renderGifts(state);
}

function renderPhaseControls(state) {
    const container = document.getElementById('phaseControls');
    if (!container) return;

    const phase = state.phase || 'active'; 

    // Cleanup: Kill timer if not in voting phase
    if (phase !== 'voting' && votingInterval) {
        clearInterval(votingInterval);
        votingInterval = null;
    }

    // State 1: Active Game
    if (phase === 'active') {
        container.innerHTML = `
            <h3 style="margin:0 0 10px 0;">🎁 Game in Progress</h3>
            <button onclick="triggerVoting()" class="btn-red" style="font-size:1.1rem; padding:10px 30px;">
                🛑 End Game & Start Voting
            </button>
        `;
    } 
    // State 2: Voting Live
    else if (phase === 'voting') {
        const now = Date.now();
        const endsAt = state.votingEndsAt || 0;
        let remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
        
        container.innerHTML = `
            <h3 style="margin:0 0 10px 0; color:#d97706;">🗳️ Voting in Progress</h3>
            <div id="votingTimerDisplay" style="font-size:2rem; font-weight:bold; font-family:monospace; margin-bottom:10px;">
                ${remaining}s
            </div>
            <button onclick="endVoting()" class="btn-gray">
                Skip Timer & Show Results ➡️
            </button>
        `;

        // Start Local Countdown Loop
        if (!votingInterval) {
            votingInterval = setInterval(() => {
                const el = document.getElementById('votingTimerDisplay');
                if (!el) return;
                
                const currentRemaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
                el.innerText = `${currentRemaining}s`;
                
                // Auto-refresh when time hits 0
                if (currentRemaining <= 0) {
                    clearInterval(votingInterval);
                    refreshState(); 
                }
            }, 1000);
        }
    } 
    // State 3: Game Over / Podium
    else if (phase === 'results') {
        container.innerHTML = `
            <h3 style="margin:0 0 10px 0; color:#16a34a;">🏆 Results are Live!</h3>
            <div style="display:flex; gap:10px; justify-content:center;">
                <button onclick="triggerVoting()" class="btn-gray">Re-open Voting</button>
                <button onclick="resetGame()" class="btn-red">💣 Reset Game</button>
            </div>
        `;
    }
}

function renderParticipants(state) {
    const pList = document.getElementById('participantList');
    pList.innerHTML = '';

    // Logic: Use Shared Function from gamelib.js
    const activeIds = (window.getActiveIds) ? getActiveIds(state) : [];

    // Sort: Active Players > Queue Number
    const sorted = state.participants.sort((a,b) => {
        const aActive = activeIds.includes(a.id);
        const bActive = activeIds.includes(b.id);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return a.number - b.number;
    });

    sorted.forEach(p => {
        const isActive = activeIds.includes(p.id);
        const li = document.createElement('li');
        
        // Apply CSS Classes (Styled by gamelib theme engine)
        if (isActive) {
            li.classList.add('active-row');
            if (p.isVictim) { 
                li.classList.remove('active-row');
                li.classList.add('victim-row');
            }
        }

        // Status Icons
        let statusIcon = '⏳';
        if (p.heldGiftId) statusIcon = '🎁';
        if (isActive) statusIcon = '🔴';

        // Stats Badge (if stolen from)
        let statsBadge = '';
        if (p.timesStolenFrom > 0) {
            statsBadge = `<span style="font-size:0.8rem; background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px; margin-left:5px;">💔 ${p.timesStolenFrom}</span>`;
        }

        // Timer
        let timerHtml = '';
        if (isActive) {
            const duration = state.settings.turnDurationSeconds || 60;
            const startTime = p.turnStartTime || Date.now(); 
            timerHtml = ` <span class="player-timer" data-start="${startTime}" data-duration="${duration}" style="font-family:monospace; font-weight:bold; font-size:1.2em; margin-left:10px;">--:--</span>`;
        }

        // Build HTML
        let html = `<span><b>#${p.number}</b> ${p.name} ${statsBadge} ${timerHtml}</span>`;
        
        // Action Buttons (Open/Steal)
        if (isActive && !p.heldGiftId) {
            if (stealingPlayerId === p.id) {
                html += `
                    <div class="action-buttons">
                        <span style="color:#d97706; font-weight:bold; font-size:0.9em; margin-right:5px;">Select Gift below...</span>
                        <button onclick="cancelStealMode()" class="btn-gray">Cancel</button>
                    </div>`;
            } else if (stealingPlayerId) {
                html += `<div style="font-size:0.8em; color:#ccc;">Waiting...</div>`;
            } else {
                html += `
                    <div class="action-buttons">
                        <button onclick="promptOpenGift('${p.id}')" class="btn-green">🎁 Open</button>
                        <button onclick="enterStealMode('${p.id}')" class="btn-orange">😈 Steal</button>
                    </div>`;
            }
        } else {
            html += `<span>${statusIcon}</span>`;
        }

        li.innerHTML = html;
        pList.appendChild(li);
    });
}

function renderGifts(state) {
    const gList = document.getElementById('giftList');
    
    // 1. USE SHARED SORT (Handles Votes logic from gamelib.js)
    const sorted = (window.sortGifts) ? sortGifts(state.gifts, state) : state.gifts;
    const isVoting = state.phase === 'voting' || state.phase === 'results';

    if (sorted.length === 0) {
        gList.innerHTML = `<li style="color:#ccc; justify-content:center;">No gifts revealed yet</li>`;
        return;
    }

    gList.innerHTML = sorted.map(g => {
        const ownerName = state.participants.find(p => p.id === g.ownerId)?.name || 'Unknown';
        
        // A. VOTING VIEW (Shows Vote Counts)
        if (isVoting) {
            const count = g.downvotes?.length || 0;
            const highlight = count > 0 ? "font-weight:bold; color:#ef4444;" : "color:#9ca3af;";
            return `
            <li>
                <div>
                    <span style="font-size:1.1em; ${highlight}">${count} 👎</span>
                    <span style="margin-left:10px;">${g.description}</span>
                </div>
                <div style="font-size:0.8em; color:#666;">Held by <b>${ownerName}</b></div>
            </li>`;
        }

        // B. STANDARD VIEW (Shows Steal Buttons)
        let isForbidden = (stealingPlayerId && state.participants.find(p => p.id === stealingPlayerId)?.forbiddenGiftId === g.id);
        
        const itemStyle = g.isFrozen ? 'opacity: 0.5; background: #f1f5f9;' : '';
        let statusBadge = '';
        if (g.isFrozen) statusBadge = `<span class="badge" style="background:#333; color:#fff;">🔒 LOCKED</span>`;
        else if (isForbidden) statusBadge = `<span class="badge" style="background:#fde68a; color:#92400e;">🚫 NO TAKE-BACKS</span>`;
        else statusBadge = g.stealCount > 0 ? `<span class="badge stolen">${g.stealCount}/3 Steals</span>` : `<span class="badge">0/3 Steals</span>`;

        const imgCount = (g.images && g.images.length) || 0;
        const camColor = imgCount > 0 ? '#3b82f6' : '#9ca3af';
        const camIcon = imgCount > 0 ? `📷 ${imgCount}` : '➕';
        const showStealBtn = stealingPlayerId && !g.isFrozen && !isForbidden;

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

// --- 5. GAMEPLAY ACTIONS ---

async function addParticipant() {
    const num = document.getElementById('pNumber').value;
    const name = document.getElementById('pName').value;
    if(!name && !num) return;
    
    await fetch(`/api/${currentGameId}/participants`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name, number: num })
    });
    
    document.getElementById('pName').value = '';
    document.getElementById('pNumber').value = '';
    document.getElementById('pName').focus();
}

async function promptOpenGift(playerId) {
    const description = prompt("What is inside the gift?");
    if (!description) return;
    await fetch(`/api/${currentGameId}/open-new`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ description, playerId }) 
    });
}

function enterStealMode(playerId) {
    stealingPlayerId = playerId;
    refreshState(); 
}

function cancelStealMode() {
    stealingPlayerId = null;
    refreshState();
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
        if(!res.ok) alert("Error: " + (await res.json()).error);
    } catch (err) { alert("Steal failed."); } 
    finally {
        stealingPlayerId = null;
        refreshState();
    }
}

async function editGift(giftId, currentDesc) {
    const newDesc = prompt("Update gift description:", currentDesc);
    if (newDesc && newDesc !== currentDesc) {
        await fetch(`/api/${currentGameId}/gifts/${giftId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ description: newDesc })
        });
    }
}

async function clearDb() {
    if(!currentGameId) return;
    if(!confirm("⚠️ DANGER: This will delete ALL players and gifts.\n\nAre you sure?")) return;
    
    const res = await fetch(`/api/${currentGameId}/reset`, { method: 'POST' });
    if(res.ok) location.reload();
}

// --- 6. VOTING ACTIONS (Phase Management) ---

async function triggerVoting() {
    const duration = prompt("Start Voting Phase?\n\nEnter seconds:", "180");
    if (!duration) return;
    await fetch(`/api/${currentGameId}/phase/voting`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ durationSeconds: parseInt(duration) })
    });
}

async function endVoting() {
    if(!confirm("Close voting early and show the Podium?")) return;
    await fetch(`/api/${currentGameId}/phase/results`, { method: 'POST' });
}

async function resetGame() {
    if(!confirm("⚠️ DANGER: This will delete ALL history and start fresh.\n\nAre you sure?")) return;
    await fetch(`/api/${currentGameId}/reset`, { method: 'POST' });
}

// --- 7. SETTINGS & BRANDING ---

function openSettings() {
    if(!currentGameId) return;
    fetch(`/api/${currentGameId}/state`)
        .then(res => res.json())
        .then(state => {
            const s = state.settings || {};
            
            // Standard
            document.getElementById('settingDuration').value = s.turnDurationSeconds || 60;
            document.getElementById('settingMaxSteals').value = s.maxSteals || 3;
            document.getElementById('settingActiveCount').value = s.activePlayerCount || 1;
            document.getElementById('settingScrollSpeed').value = (s.scrollSpeed !== undefined) ? s.scrollSpeed : 3;
            
            // Checkboxes
            const sound = document.getElementById('settingSoundTheme');
            if(sound) sound.value = s.soundTheme || 'standard';
            
            const stats = document.getElementById('settingShowVictimStats');
            if(stats) stats.checked = s.showVictimStats || false;

            // Branding
            const color = document.getElementById('settingThemeColor');
            if(color) color.value = s.themeColor || '#2563eb';

            const bg = document.getElementById('settingThemeBg');
            if(bg) bg.value = s.themeBg || '';

            document.getElementById('settingsModal').classList.remove('hidden');
        });
}

async function saveSettings() {
    const payload = {
        turnDurationSeconds: document.getElementById('settingDuration').value,
        maxSteals: document.getElementById('settingMaxSteals').value,
        activePlayerCount: document.getElementById('settingActiveCount').value,
        scrollSpeed: document.getElementById('settingScrollSpeed').value,
        soundTheme: document.getElementById('settingSoundTheme')?.value || 'standard',
        showVictimStats: document.getElementById('settingShowVictimStats')?.checked || false,
        themeColor: document.getElementById('settingThemeColor')?.value,
        themeBg: document.getElementById('settingThemeBg')?.value
    };

    await fetch(`/api/${currentGameId}/settings`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });
    document.getElementById('settingsModal').classList.add('hidden');
}

function cancelSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

async function uploadLogo() {
    const input = document.getElementById('themeLogoInput');
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    const res = await fetch(`/api/${currentGameId}/upload-logo`, { method: 'POST', body: formData });
    if (res.ok) alert("Logo Updated!");
}

// --- 8. ADMIN IMAGE MODAL LOGIC ---

window.openImgModal = function(giftId) {
    fetch(`/api/${currentGameId}/state`)
        .then(r => r.json())
        .then(state => {
            const gift = state.gifts.find(g => g.id === giftId);
            if (!gift) return;

            currentAdminGiftId = giftId; // GLOBAL USED HERE
            document.getElementById('imgModalTitle').innerText = `Images: ${gift.description}`;
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
    const res = await fetch(`/api/${currentGameId}/images/${giftId}/${imageId}`, { method: 'DELETE' });
    if (res.ok) reloadModal(giftId);
}

window.setPrimaryImage = async function(giftId, imageId) {
    const res = await fetch(`/api/${currentGameId}/images/${giftId}/primary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId })
    });
    if (res.ok) reloadModal(giftId);
}

window.adminUpload = async function() {
    const input = document.getElementById('adminFileInput');
    const file = input.files[0];
    if (!file || !currentAdminGiftId) return;

    const formData = new FormData();
    formData.append('photo', file);
    formData.append('giftId', currentAdminGiftId);
    formData.append('uploaderName', 'Admin');

    const res = await fetch(`/api/${currentGameId}/upload`, { method: 'POST', body: formData });
    if (res.ok) {
        input.value = '';
        reloadModal(currentAdminGiftId);
    }
}

function reloadModal(giftId) {
    fetch(`/api/${currentGameId}/state`)
        .then(r => r.json())
        .then(state => {
            const gift = state.gifts.find(g => g.id === giftId);
            if(gift) renderAdminImages(gift);
        });
}

// --- 9. UTILS & REMOTES ---

// Timer Loop
setInterval(() => {
    const timers = document.querySelectorAll('.player-timer');
    timers.forEach(el => {
        const start = parseInt(el.dataset.start);
        const duration = parseInt(el.dataset.duration) * 1000;
        if (!start) return;
        
        const remaining = Math.max(0, duration - (Date.now() - start));
        const seconds = Math.ceil(remaining / 1000);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        el.innerText = `${m}:${s.toString().padStart(2, '0')}`;

        if (seconds <= 10) el.style.color = "#dc2626"; 
        else if (seconds <= 30) el.style.color = "#d97706"; 
        else el.style.color = "#2563eb"; 
    });
}, 1000);

// TV Remote Control
function setTvMode(mode) {
    if(!currentGameId) return;
    socket.emit('previewSettings', { gameId: currentGameId, settings: { tvMode: mode } });
}
function previewScrollSpeed() {
    const val = document.getElementById('settingScrollSpeed').value;
    socket.emit('previewSettings', { gameId: currentGameId, settings: { scrollSpeed: val } });
}
function showLocalQr() {
    const url = `${window.location.origin}/scoreboard.html?game=${currentGameId}&mode=mobile`;
    document.getElementById('qrGameIdDisplay').innerText = currentGameId;
    document.getElementById('localQrcode').innerHTML = '';
    new QRCode(document.getElementById('localQrcode'), { text: url, width: 200, height: 200 });
    
    let link = document.getElementById('localQrLink');
    if(!link) {
        link = document.createElement('a');
        link.id = 'localQrLink';
        link.target = "_blank";
        link.style.display = "block";
        link.style.marginTop = "10px";
        link.style.color = "#2563eb";
        document.getElementById('localQrcode').parentNode.appendChild(link);
    }
    link.href = url;
    link.innerText = "🔗 Click to Open Link";

    document.getElementById('localQrModal').classList.remove('hidden');
}
function closeLocalQr() {
    document.getElementById('localQrModal').classList.add('hidden');
}
window.openCatalog = function() {
    if(currentGameId) window.open(`/catalog.html?game=${currentGameId}`, '_blank');
}
