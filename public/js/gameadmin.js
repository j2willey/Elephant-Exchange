/*
 * ==============================================================================
 * ELEPHANT EXCHANGE - ADMIN CONTROLLER
 * ==============================================================================
 */

// --- 1. GLOBALS & INIT ---
let socket;
let currentGameId = null;
let stealingPlayerId = null;
let currentAdminGiftId = null;
let votingInterval = null;
let pendingLateName = null;
let serverThemes = {};
let adminPassword = sessionStorage.getItem('elephant_password') || null;

document.addEventListener('DOMContentLoaded', () => {
    loadThemeOptions();

    // UI Scaling
    const scaleSlider = document.getElementById('uiScale');
    const savedScale = localStorage.getItem('elephantScale');
    if (savedScale && scaleSlider) {
        document.body.style.zoom = savedScale;
        scaleSlider.value = savedScale;
    }
    if (scaleSlider) {
        scaleSlider.addEventListener('input', (e) => {
            document.body.style.zoom = e.target.value;
            localStorage.setItem('elephantScale', e.target.value);
        });
    }

    // Resizable Panels
    const resizer = document.getElementById('dragHandle');
    const leftPanel = document.getElementById('leftPanel');
    const container = document.getElementById('mainLayout');
    const savedWidth = localStorage.getItem('elephantSidebarWidth');
    if (savedWidth && leftPanel) {
        leftPanel.style.width = savedWidth;
        leftPanel.style.flex = "none";
    }

    if (resizer && leftPanel && container) {
        let isResizing = false;
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const containerRect = container.getBoundingClientRect();
            const newWidthPx = e.clientX - containerRect.left;
            const newWidthPercent = (newWidthPx / containerRect.width) * 100;
            if (newWidthPercent > 15 && newWidthPercent < 85) {
                leftPanel.style.width = `${newWidthPercent}%`;
                leftPanel.style.flex = "none";
            }
        });
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('dragging');
                document.body.style.cursor = 'default';
                localStorage.setItem('elephantSidebarWidth', leftPanel.style.width);
            }
        });
    }

    // Input Listeners
    const gDesc = document.getElementById('giftDescInput');
    if (gDesc) gDesc.addEventListener('keypress', (e) => { if (e.key === 'Enter') submitGiftModal(); });
    const hostInput = document.getElementById('hostNameInput');
    if (hostInput) hostInput.addEventListener('keypress', e => e.key === 'Enter' && handleHostGame());
    const joinInput = document.getElementById('joinNameInput');
    if (joinInput) joinInput.addEventListener('keypress', e => e.key === 'Enter' && handleReconnectGame());

    // Roster Count Listener (NEW)
    const countInput = document.getElementById('settingTotalPlayers');
    if (countInput) {
        countInput.addEventListener('input', syncRosterFromCount);
    }

    // Theme Logic
    const themeSelect = document.getElementById('themePresetSelect');
    const themeColor = document.getElementById('themeColorInput');
    const themeBg = document.getElementById('themeBgInput');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            const key = e.target.value;
            if (serverThemes[key]) {
                const t = serverThemes[key];
                const color = t.colors ? t.colors.primary : t.color;
                const bg = t.assets ? t.assets.background : t.bg;
                if (themeColor) themeColor.value = color || '#000000';
                if (themeBg) themeBg.value = bg || '';
            }
        });
    }
    const markAsCustom = () => { if (themeSelect) themeSelect.value = 'custom'; };
    if (themeColor) themeColor.addEventListener('input', markAsCustom);
    if (themeBg) themeBg.addEventListener('input', markAsCustom);

    // URL Params
    const params = new URLSearchParams(window.location.search);
    const urlGameId = params.get('game');
    const startVal = params.get('start');
    if (urlGameId) {
        document.getElementById('gameIdInput').value = urlGameId;
        joinGame(urlGameId);
        return;
    }
    if (startVal) {
        const decoded = decodeURIComponent(startVal);
        const cleanId = sanitizeGameId(decoded);
        if (cleanId) joinGame(cleanId, decoded);
    }
});

// WRAPPER: Automatically adds password header & handles 401 errors
async function authenticatedFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (adminPassword) {
        options.headers['x-admin-secret'] = adminPassword;
    }
    const response = await fetch(url, options);
    if (response.status === 401) {
        showModal('authModal');
        setTimeout(() => document.getElementById('authPasswordInput').focus(), 100);
        throw new Error("Authentication Required");
    }
    return response;
}

window.submitAuthPassword = function() {
    const input = document.getElementById('authPasswordInput');
    const val = input.value.trim();
    if (val) {
        adminPassword = val;
        sessionStorage.setItem('elephant_password', val);
        hideModal('authModal');
        customAlert("Password Saved. Please try your action again.");
    }
}

// --- 2. HOST & RECONNECT LOGIC ---

function sanitizeGameId(str) {
    return str.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
}

async function handleHostGame() {
    const rawName = document.getElementById('hostNameInput').value;
    const pass = document.getElementById('createPasswordInput').value.trim();

    if (!rawName.trim()) return customAlert("Please enter a name for your party!");
    const baseId = sanitizeGameId(rawName);
    if (!baseId) return customAlert("Please use letters and numbers.");

    // Collision Check (Now Public)
    const res = await fetch('/api/admin/games');
    const games = await res.json();
    const existingIds = new Set(games.map(g => g.id));

    let finalId = baseId;
    let counter = 1;
    while (existingIds.has(finalId)) {
        finalId = `${baseId}-${counter}`;
        counter++;
    }

    joinGame(finalId, rawName.trim(), pass);
}

async function handleReconnectGame() {
    const input = document.getElementById('joinNameInput').value;
    if (!input.trim()) return customAlert("Enter a name to search.");
    const term = sanitizeGameId(input);
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '<p style="color:#6b7280;">Searching...</p>';

    const res = await fetch('/api/admin/games');
    const games = await res.json();
    const matches = games.filter(g => g.id.includes(term));

    resultsDiv.innerHTML = '';
    if (matches.length === 0) {
        resultsDiv.innerHTML = `<p style="color:#ef4444;">No games found matching "${term}"</p>`;
    } else if (matches.length === 1) {
        joinGame(matches[0].id);
    } else {
        let html = `<p style="font-weight:bold; color:#374151;">Found ${matches.length} games:</p><ul style="list-style:none; padding:0;">`;
        matches.forEach(g => {
            html += `<li style="margin-bottom:8px; border:1px solid #e5e7eb; padding:10px; border-radius:6px; display:flex; justify-content:space-between; align-items:center; background:#f9fafb;">
                    <span><b>${g.id}</b> <span style="font-size:0.8em; color:#6b7280;">(${new Date(g.createdAt).toLocaleDateString()})</span></span>
                    <button onclick="joinGame('${g.id}')" class="btn-primary" style="padding:4px 10px; font-size:0.8rem;">Join</button>
                </li>`;
        });
        html += '</ul>';
        resultsDiv.innerHTML = html;
    }
}

async function joinGame(forceId = null, partyName = null, password = null) {
    const inputId = document.getElementById('gameIdInput').value.trim().toLowerCase();
    const gameId = forceId || inputId;
    if (!gameId) return customAlert("Please enter a Game ID");

    if (password) {
        adminPassword = password;
        sessionStorage.setItem('elephant_password', password);
    }

    const isNewSession = !!partyName;
    const payload = { gameId };
    if (partyName) payload.partyName = partyName;
    if (password) payload.adminPassword = password;

    try {
        const res = await fetch('/api/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            currentGameId = gameId;
            const newUrl = `${window.location.pathname}?game=${gameId}`;
            window.history.pushState({ path: newUrl }, '', newUrl);

            document.getElementById('login-section').classList.add('hidden');
            document.getElementById('dashboard-section').classList.remove('hidden');

            initSocket(gameId);

            if (isNewSession) openSettings('defaults');
            else refreshState();
        } else {
            const err = await res.json();
            customAlert(`Cannot join game: ${err.error || res.statusText}`);
            if (res.status === 404) window.history.pushState({ path: '/gameadmin.html' }, '', '/gameadmin.html');
        }
    } catch (e) {
        console.error(e);
        customAlert("Network Error: Could not connect to server.");
    }
}

function initSocket(gameId) {
    if (socket) socket.disconnect();
    socket = io();
    socket.on('connect', () => socket.emit('joinGame', gameId));
    socket.on('stateUpdate', (state) => render(state));
}

async function refreshState() {
    if (!currentGameId) return;
    try {
        const res = await fetch(`/api/${currentGameId}/state`);
        if (res.ok) render(await res.json());
    } catch (e) { console.error("State fetch failed", e); }
}

// --- 3. RENDER LOOP ---
function render(state) {
    if (window.applyTheme) applyTheme(state.settings);
    const title = state.settings?.partyName || state.id || "Elephant Exchange";
    const tagline = state.settings?.tagline || "";
    document.getElementById('bannerTitle').innerText = title;
    document.getElementById('bannerTagline').innerText = tagline;
    renderPhaseControls(state);
    if (stealingPlayerId) {
        const thief = state.participants.find(p => p.id === stealingPlayerId);
        if (!thief || thief.heldGiftId) stealingPlayerId = null;
    }
    renderParticipants(state);
    renderGifts(state);

    // NEW: Dynamic Footer Button Logic
    const btnFooter = document.getElementById('btnGameState');
    if (btnFooter) {
        if (state.phase === 'voting') {
            btnFooter.innerHTML = "🗳️ End Voting & Show Results";
            btnFooter.onclick = endVoting; // Direct call to endVoting function
            btnFooter.className = "btn-nav";
            btnFooter.style.background = "#d97706"; // Orange
            btnFooter.style.borderColor = "#d97706";
        }
        else if (state.phase === 'results') {
            btnFooter.innerHTML = "🔄 Reset Game";
            btnFooter.onclick = resetGame;
            btnFooter.className = "btn-nav";
            btnFooter.style.background = "#dc2626"; // Red
            btnFooter.style.borderColor = "#dc2626";
        }
        else {
            // Default Active State
            btnFooter.innerHTML = "🛑 End Game";
            btnFooter.onclick = confirmEndGame;
            btnFooter.className = "btn-nav";
            btnFooter.style.background = ""; // Reset to default CSS
            btnFooter.style.borderColor = "";
        }
    }
}

function renderParticipants(state) {
    const pList = document.getElementById('participantList');
    pList.innerHTML = '';
    const activeIds = (window.getActiveIds) ? getActiveIds(state) : [];

    const sorted = state.participants.sort((a, b) => {
        const aActive = activeIds.includes(a.id);
        const bActive = activeIds.includes(b.id);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        const aHasGift = !!a.heldGiftId;
        const bHasGift = !!b.heldGiftId;
        if (aHasGift && !bHasGift) return 1;
        if (!aHasGift && bHasGift) return -1;
        return a.number - b.number;
    });

    sorted.forEach(p => {
        const isActive = activeIds.includes(p.id);
        const li = document.createElement('li');
        if (isActive) {
            li.classList.add('active-row');
            if (p.isVictim) { li.classList.remove('active-row'); li.classList.add('victim-row'); }
        }

        let statusIcon = '⏳';
        if (p.heldGiftId) statusIcon = '🎁';
        if (isActive) statusIcon = '🔴';

        let statsBadge = '';
        if (p.timesStolenFrom > 0) statsBadge = `<span style="font-size:0.8rem; background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px; margin-left:5px;">💔 ${p.timesStolenFrom}</span>`;

        let timerHtml = '';
        if (isActive) {
            const duration = state.settings.turnDurationSeconds || 60;
            const startTime = p.turnStartTime || Date.now();
            timerHtml = ` <span class="player-timer" data-start="${startTime}" data-duration="${duration}" style="font-family:monospace; font-weight:bold; font-size:1.2em;">--:--</span>`;
        }

        const safeName = p.name.replace(/'/g, "\\'");
        const safePId = p.id.replace(/[^a-zA-Z0-9]/g, '_');
        const btnClass = isActive ? "btn-manage" : "btn-manage awaiting";
        const deleteBtn = !p.heldGiftId ? `<button id="${safePId}_delete" onclick="deleteParticipant('${p.id}', '${safeName}')" class="${btnClass}" title="Remove ${p.name}">🗑️</button>` : '';

        let html = `<span><b>#${p.number}</b> ${p.name} ${statsBadge} ${timerHtml}</span>`;
        if (isActive && !p.heldGiftId) {
            if (stealingPlayerId === p.id) {
                html += `<div class="action-buttons"><span style="color:#d97706; font-weight:bold; font-size:0.9em; margin-right:5px;">Select Gift below...</span><button onclick="cancelStealMode()" class="btn-manage" title="Cancel Steal">❌</button></div>`;
            } else if (stealingPlayerId) {
                html += `<div style="font-size:0.8em; color:#ccc;">Waiting...</div>`;
            } else {
                const isRosterMode = state.settings && state.settings.gameMode === 'roster';
                const btnOpen = `<button id="${safePId}_open" onclick="promptOpenGift('${p.id}', '${safeName}')" class="btn-play" title="Open Gift">🎁</button>`;
                const btnSteal = `<button id="${safePId}_steal" onclick="enterStealMode('${p.id}')" class="btn-play" title="Steal Gift">😈</button>`;
                const btnReset = `<button id="${safePId}_reset" onclick="resetTimer('${p.id}')" class="btn-manage" title="Reset Timer">🕒</button>`;
                const btnSkip = isRosterMode ? `<button id="${safePId}_skip" onclick="skipTurn('${p.id}', '${safeName}')" class="btn-manage" title="Skip Turn">⤵️</button>` : '';
                html += `<div class="action-buttons">${btnOpen}${btnSteal}${btnReset}${btnSkip}${deleteBtn}</div>`;
            }
        } else {
            html += `<div style="display:flex; align-items:center; gap: 8px;"><span>${statusIcon}</span>${deleteBtn}</div>`;
        }
        li.innerHTML = html;
        pList.appendChild(li);
    });
}

function renderGifts(state) {
    const gList = document.getElementById('giftList');
    const sorted = (window.sortGifts) ? sortGifts(state.gifts, state) : state.gifts;
    if (sorted.length === 0) { gList.innerHTML = `<li style="color:#ccc; justify-content:center;">No gifts revealed yet</li>`; return; }

    const isVoting = state.phase === 'voting' || state.phase === 'results';
    gList.innerHTML = sorted.map(g => {
        const owner = state.participants.find(p => p.id === g.ownerId);
        const ownerName = owner ? owner.name : 'Unknown';
        let mainName = g.name; let subDesc = g.description;
        if (String(mainName) === '{}' || String(mainName) === '[object Object]') mainName = null;
        if (String(subDesc) === '{}' || String(subDesc) === '[object Object]') subDesc = null;
        if (!mainName && subDesc) { mainName = subDesc; subDesc = null; }
        else if (!mainName && !subDesc) { mainName = "Mystery Gift"; }

        const safeName = String(mainName || "");
        const safeDesc = String(subDesc || "");
        const safeOwner = String(ownerName || "Unknown");
        const jsName = safeName.replace(/'/g, "\\'");
        const jsDesc = safeDesc.replace(/'/g, "\\'");
        const jsOwner = safeOwner.replace(/'/g, "\\'");

        if (isVoting) {
            const count = g.downvotes?.length || 0;
            const highlight = count > 0 ? "font-weight:bold; color:#ef4444;" : "color:#9ca3af;";
            return `<li><div><span style="font-size:1.1em; ${highlight}">${count} 👎</span> <span style="margin-left:10px;">${safeName}</span></div><div style="font-size:0.8em; color:#666;">Held by <b>${ownerName}</b></div></li>`;
        }

        let isForbidden = (stealingPlayerId && state.participants.find(p => p.id === stealingPlayerId)?.forbiddenGiftId === g.id);
        const itemStyle = g.isFrozen ? 'opacity: 0.5; background: #f1f5f9;' : '';
        let statusBadge = g.isFrozen ? `<span class="badge" style="background:#333; color:#fff;">🔒 LOCKED</span>` :
            (isForbidden ? `<span class="badge" style="background:#fde68a; color:#92400e;">🚫 NO TAKE-BACKS</span>` :
                (g.stealCount > 0 ? `<span class="badge stolen">${g.stealCount}/3 Steals</span>` : `<span class="badge">0/3 Steals</span>`));
        const imgCount = (g.images && g.images.length) || 0;
        const camColor = imgCount > 0 ? '#3b82f6' : '#9ca3af';
        const camIcon = imgCount > 0 ? `📷 ${imgCount}` : '➕';
        const showStealBtn = stealingPlayerId && !g.isFrozen && !isForbidden;

        return `<li style="${itemStyle}; align-items: flex-start;">
                <div style="flex: 1; padding-right: 10px;">
                    <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                        <span style="font-weight:600; font-size: 1.05rem; color:#1f2937;">${safeName}</span>
                        <button onclick="editGift('${g.id}', '${jsName}', '${jsDesc}', '${jsOwner}')" style="background:none; border:none; padding:0; cursor:pointer; font-size:0.9em; opacity:0.6;" title="Edit Gift">✏️</button>
                        <button onclick="openImgModal('${g.id}')" style="background:none; border:none; color:${camColor}; cursor:pointer; font-size:0.9em;" title="Manage Images">${camIcon}</button>
                    </div>
                    ${safeDesc ? `<div style="font-size:0.85em; color:#6b7280; margin-top:2px;">${safeDesc}</div>` : ''}
                </div>
                <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap: 4px;">
                    <div style="display:flex; align-items:center; gap: 8px;"><span style="font-size:0.8rem; color:#6b7280;">Held by <b style="color:#374151;">${ownerName}</b></span>${statusBadge}</div>
                    ${showStealBtn ? `<button onclick="attemptSteal('${g.id}', '${safeName.replace(/'/g, "\\'")}')" class="btn-play" style="font-size:0.8rem; padding:4px 10px; height:auto; width:auto;">Select Gift</button>` : ''}
                </div>
            </li>`;
    }).join('');
}

function renderPhaseControls(state) {
    const container = document.getElementById('phaseControls');
    if (!container) return;
    const phase = state.phase || 'active';
    if (phase !== 'voting' && votingInterval) { clearInterval(votingInterval); votingInterval = null; }

    if (phase === 'active') { container.innerHTML = ''; container.style.display = 'none'; }
    else if (phase === 'voting') {
        container.style.display = 'block';
        const now = Date.now();
        const endsAt = state.votingEndsAt || 0;
        let remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
        container.innerHTML = `<div style="background:#fff7ed; border:2px solid #f97316; padding:15px; border-radius:8px; text-align:center; margin-bottom:20px;"><h3 style="margin:0 0 10px 0; color:#d97706;">🗳️ Voting in Progress</h3><div id="votingTimerDisplay" style="font-size:2.5rem; font-weight:bold; font-family:monospace; color:#9a3412; margin-bottom:10px;">${remaining}s</div><button onclick="endVoting()" class="btn-gray">Skip Timer & Show Results ➡️</button></div>`;
        if (!votingInterval) {
            votingInterval = setInterval(() => {
                const el = document.getElementById('votingTimerDisplay');
                if (!el) return;
                const curr = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
                el.innerText = `${curr}s`;
                if (curr <= 0) { clearInterval(votingInterval); refreshState(); }
            }, 1000);
        }
    } else if (phase === 'results') {
        container.style.display = 'block';
        container.innerHTML = `<div style="background:#f0fdf4; border:2px solid #16a34a; padding:15px; border-radius:8px; text-align:center; margin-bottom:20px;"><h3 style="margin:0 0 10px 0; color:#16a34a;">🏆 Results are Live!</h3><div style="display:flex; gap:10px; justify-content:center;"><button onclick="triggerVoting()" class="btn-gray">Re-open Voting</button><button onclick="resetGame()" class="btn-red" title="Reset Game">💣 Reset Game</button></div></div>`;
    }
}

// --- 4. PARTICIPANT ACTIONS ---
async function addParticipant() {
    const name = document.getElementById('pName').value.trim();
    if (!name) return customAlert("Enter a name");
    const manualNum = document.getElementById('pNumber').value.trim();
    const hasPlayers = document.querySelectorAll('#participantList li').length > 0;
    if (!manualNum && hasPlayers) {
        pendingLateName = name;
        document.getElementById('latePlayerName').innerText = name;
        showModal('lateArrivalModal');
        return;
    }
    await executeAddPlayer(name, manualNum, false);
}

function closeLateModal() { hideModal('lateArrivalModal'); pendingLateName = null; }
async function confirmLateAdd(mode) { if (!pendingLateName) return; await executeAddPlayer(pendingLateName, null, mode === 'random'); closeLateModal(); }

async function executeAddPlayer(name, manualNum, insertRandomly) {
    try {
        const payload = { name, insertRandomly };
        if (manualNum) payload.number = manualNum;
        const res = await authenticatedFetch(`/api/${currentGameId}/participants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('pName').value = '';
            document.getElementById('pNumber').value = '';
            document.getElementById('pName').focus();
            if (insertRandomly) customAlert(`🎲 ${name} was assigned Number #${data.player.number}!`);
        } else customAlert(data.error);
    } catch (e) { console.error(e); }
}

async function deleteParticipant(participantId, name) {
    if (!customConfirm(`Are you sure you want to remove ${name}?`)) return;
    await authenticatedFetch(`/api/${currentGameId}/participants/${participantId}`, { method: 'DELETE' });
}

async function skipTurn(participantId, name) {
    if (!customConfirm(`Skip ${name} for now? They will swap spots with the next player.`)) return;
    await authenticatedFetch(`/api/${currentGameId}/participants/${participantId}/swap`, { method: 'POST' });
}

async function resetTimer(playerId) {
    if (!customConfirm("Restart the timer for this player?")) return;
    await authenticatedFetch(`/api/${currentGameId}/participants/${playerId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnStartTime: Date.now() }) });
}

// --- 5. GIFT ACTIONS ---
let giftModalMode = 'OPEN'; let targetPlayerId = null; let targetGiftId = null;

function promptOpenGift(playerId, playerName) {
    giftModalMode = 'OPEN';
    targetPlayerId = playerId;
    targetGiftId = null;
    document.getElementById('giftModalTitle').innerText = "Revealed Gift?";
    document.getElementById('giftModalSubtitle').innerText = "What is inside the package?";
    document.getElementById('giftModalContext').innerText = `🎁 Opening Gift for ${playerName}`;
    document.getElementById('giftModalContext').style.color = "#2563eb";
    document.getElementById('giftNameInput').value = ''; document.getElementById('giftDescInput').value = '';
    showModal('openGiftModal');
    setTimeout(() => document.getElementById('giftNameInput').focus(), 100);
}

function editGift(giftId, currentName, currentDesc, ownerName) {
    giftModalMode = 'EDIT'; targetGiftId = giftId; targetPlayerId = null;
    document.getElementById('giftModalTitle').innerText = "Update Gift";
    document.getElementById('giftModalSubtitle').innerText = "Correcting gift details.";
    document.getElementById('giftModalContext').innerText = `👤 Held by: ${ownerName}`;
    document.getElementById('giftModalContext').style.color = "#4b5563";
    document.getElementById('giftNameInput').value = currentName || ''; document.getElementById('giftDescInput').value = currentDesc || '';
    showModal('openGiftModal');
    setTimeout(() => document.getElementById('giftNameInput').focus(), 100);
}

async function submitGiftModal() {
    const name = document.getElementById('giftNameInput').value.trim();
    const description = document.getElementById('giftDescInput').value.trim();
    if (!name && !description) return await customAlert("Please enter at least a Name or Description.");
    try {
        if (giftModalMode === 'OPEN' && targetPlayerId) {
            await authenticatedFetch(`/api/${currentGameId}/open-new`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, playerId: targetPlayerId }) });
        } else if (giftModalMode === 'EDIT' && targetGiftId) {
            await authenticatedFetch(`/api/${currentGameId}/gift/${targetGiftId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) });
        }
        closeOpenGiftModal();
    } catch (e) { console.error(e); await customAlert("Failed to save gift details."); }
}

function closeOpenGiftModal() { hideModal('openGiftModal'); targetPlayerId = null; targetGiftId = null; }
function enterStealMode(playerId) { stealingPlayerId = playerId; refreshState(); }
function cancelStealMode() { stealingPlayerId = null; refreshState(); }

async function attemptSteal(giftId, description) {
    if (!stealingPlayerId) return;
    if (!await customConfirm(`Confirm steal: ${description}?`)) return;
    try {
        const res = await authenticatedFetch(`/api/${currentGameId}/steal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ giftId, thiefId: stealingPlayerId }) });
        if (!res.ok) { const err = await res.json(); await customAlert(err.error || "Steal failed"); }
    } catch (err) { console.error(err); await customAlert("Network error during steal."); }
    finally { stealingPlayerId = null; refreshState(); }
}

// --- 6. GAME CONTROL ---
async function confirmEndGame() {
    const enableVoting = await customConfirm("Would you like to enable 'Worst Gift Voting'?\n\nOK = Yes, Start Voting.\nCancel = No, just end game.");
    if (enableVoting) {
        const duration = await customPrompt("Voting Duration (seconds)?", "180");
        if (!duration) return;
        await authenticatedFetch(`/api/${currentGameId}/phase/voting`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durationSeconds: parseInt(duration) }) });
    } else {
        await authenticatedFetch(`/api/${currentGameId}/phase/results`, { method: 'POST' });
    }
}
async function endVoting() { if (!await customConfirm("Close voting early?")) return; await authenticatedFetch(`/api/${currentGameId}/phase/results`, { method: 'POST' }); }
async function resetGame() { if (!await customConfirm("⚠️ DANGER: This will delete ALL history.\n\nAre you sure?")) return; await authenticatedFetch(`/api/${currentGameId}/reset`, { method: 'POST' }); }

// --- 7. SETTINGS & THEMES ---
async function loadThemeOptions() {
    try {
        const res = await fetch('/api/themes');
        const themes = await res.json();
        serverThemes = {};
        const select = document.getElementById('themePresetSelect');
        if(!select) return;
        const currentVal = select.value;
        while (select.options.length > 2) select.remove(2);
        themes.forEach(t => {
            serverThemes[t.id] = t;
            const opt = document.createElement('option'); opt.value = t.id; opt.innerText = `🎨 ${t.name}`; select.appendChild(opt);
        });
        if (currentVal && (currentVal === 'custom' || serverThemes[currentVal])) select.value = currentVal;
    } catch (e) { console.error("Failed to load themes:", e); }
}

function openSettings(mode = 'edit') {
    if (!currentGameId) return;
    const title = document.getElementById('settingsModalTitle');
    const btnSave = document.getElementById('btnSaveSettings');
    const btnCancel = document.getElementById('btnCancelSettings');

    if (mode === 'defaults') {
        title.innerText = "Setup Game Defaults";
        btnSave.innerText = "Start Game 🚀";
        btnCancel.style.display = 'none';
    } else {
        title.innerText = "Game Settings";
        btnSave.innerText = "Save Changes";
        btnCancel.style.display = 'inline-block';
    }

    fetch(`/api/${currentGameId}/state`).then(res => res.json()).then(state => {
        const s = state.settings || {};
        document.getElementById('settingPartyName').value = s.partyName || currentGameId;
        document.getElementById('settingTagline').value = s.tagline || '';
        document.getElementById('settingDuration').value = s.turnDurationSeconds || 60;
        document.getElementById('settingMaxSteals').value = s.maxSteals || 3;
        document.getElementById('settingActiveCount').value = s.activePlayerCount || 1;
        document.getElementById('settingTotalPlayers').value = s.totalPlayerCount || '';

        // RADIO BUTTON LOGIC
        const assignmentMode = s.assignmentMode || 'manual';
        const radios = document.getElementsByName('assignmentMode');
        for(const r of radios) {
            r.checked = (r.value === assignmentMode);
        }

        // Populate Roster Text
        let rosterText = '';
        if (state.participants && state.participants.length > 0) {
            const sorted = state.participants.sort((a, b) => a.number - b.number);
            rosterText = sorted.map(p => p.name).join('\n');
            document.getElementById('settingTotalPlayers').value = sorted.length;
        } else if (s.rosterNames) {
            rosterText = s.rosterNames.join('\n');
        }
        document.getElementById('settingRosterNames').value = rosterText;

        toggleRosterInput(); // Update UI visibility based on what we just loaded
        showModal('settingsModal');
    });
}
function cancelSettings() { hideModal('settingsModal'); }

async function saveSettings() {
    // Get checked radio value
    const selected = document.querySelector('input[name="assignmentMode"]:checked');
    const mode = selected ? selected.value : 'manual';

    let roster = [];
    if (mode !== 'manual') {
        const rawText = document.getElementById('settingRosterNames').value;
        roster = rawText.split('\n').map(n => n.trim()).filter(n => n.length > 0);
    }

    const payload = {
        partyName: document.getElementById('settingPartyName').value,
        tagline: document.getElementById('settingTagline').value,
        turnDurationSeconds: parseInt(document.getElementById('settingDuration').value) || 60,
        maxSteals: parseInt(document.getElementById('settingMaxSteals').value) || 3,
        activePlayerCount: Math.max(1, parseInt(document.getElementById('settingActiveCount').value) || 1),
        assignmentMode: mode,
        totalPlayerCount: parseInt(document.getElementById('settingTotalPlayers').value) || 0,
        rosterNames: (mode !== 'manual' && roster.length > 0) ? roster : null,
    };

    await authenticatedFetch(`/api/${currentGameId}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    hideModal('settingsModal');
}

function openThemeSettings() {
    if (!currentGameId) return;
    fetch(`/api/${currentGameId}/state`).then(res => res.json()).then(state => {
        const s = state.settings || {};
        document.getElementById('themeColorInput').value = s.themeColor || '#2563eb';
        document.getElementById('themeBgInput').value = s.themeBg || '';
        const themeSelect = document.getElementById('themePresetSelect');
        let matchedTheme = 'custom';
        if (s.themeName && serverThemes[s.themeName]) matchedTheme = s.themeName;
        else {
            for (const [key, val] of Object.entries(serverThemes)) {
                const c = val.colors ? val.colors.primary : val.color;
                const b = val.assets ? val.assets.background : val.bg;
                if (c === s.themeColor && b === s.themeBg) { matchedTheme = key; break; }
            }
        }
        if(themeSelect) themeSelect.value = matchedTheme;
        showModal('themeModal');
    });
}
function closeThemeSettings() { hideModal('themeModal'); }
async function saveThemeSettings() {
    const themeName = document.getElementById('themePresetSelect').value;
    const themeColor = document.getElementById('themeColorInput').value;
    const themeBg = document.getElementById('themeBgInput').value;
    await authenticatedFetch(`/api/${currentGameId}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ themeName, themeColor, themeBg }) });
    closeThemeSettings(); refreshState();
}

async function uploadLogo() {
    const input = document.getElementById('themeLogoInput');
    const file = input.files[0];
    if (!file) return customAlert("Please select a file first.");
    const formData = new FormData(); formData.append('logo', file);
    try {
        const res = await authenticatedFetch(`/api/${currentGameId}/upload-logo`, { method: 'POST', body: formData });
        if (res.ok) { customAlert("Logo Updated! Check the TV View."); input.value = ''; } else customAlert("Upload failed.");
    } catch (e) { console.error(e); }
}

// --- 8. IMAGES ---
window.openImgModal = function(giftId) {
    fetch(`/api/${currentGameId}/state`).then(r => r.json()).then(state => {
        const gift = state.gifts.find(g => g.id === giftId);
        if (!gift) return;
        currentAdminGiftId = giftId;
        document.getElementById('imgModalTitle').innerText = `Images: ${gift.description}`;
        showModal('imageModal');
        renderAdminImages(gift);
    });
}
window.closeImgModal = function() { hideModal('imageModal'); currentAdminGiftId = null; }
function renderAdminImages(gift) {
    const container = document.getElementById('imgList'); container.innerHTML = '';
    if (!gift.images || gift.images.length === 0) { container.innerHTML = '<div style="grid-column:1/-1; color:#9ca3af; text-align:center;">No images yet.</div>'; return; }
    gift.images.forEach(img => {
        const isPrimary = img.id === gift.primaryImageId;
        const heroClass = isPrimary ? 'hero' : '';
        const div = document.createElement('div');
        div.className = `admin-img-card ${heroClass}`;
        div.innerHTML = `<img src="${img.path}"><div class="admin-img-controls"><button onclick="setPrimaryImage('${gift.id}', '${img.id}')" style="color:#10b981; background:none; border:none; cursor:pointer;">★ Hero</button><button onclick="deleteImage('${gift.id}', '${img.id}')" style="color:#ef4444; background:none; border:none; cursor:pointer;">🗑 Del</button></div>${isPrimary ? '<div style="position:absolute; top:0; left:0; background:#10b981; color:white; font-size:0.7rem; padding:2px 6px;">HERO</div>' : ''}`;
        container.appendChild(div);
    });
}
window.deleteImage = async function(giftId, imageId) {
    if (!await customConfirm("Delete this photo?")) return;
    const res = await authenticatedFetch(`/api/${currentGameId}/images/${giftId}/${imageId}`, { method: 'DELETE' });
    if (res.ok) reloadModal(giftId);
}
window.setPrimaryImage = async function(giftId, imageId) {
    const res = await authenticatedFetch(`/api/${currentGameId}/images/${giftId}/primary`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId }) });
    if (res.ok) reloadModal(giftId);
}
window.adminUpload = async function() {
    const input = document.getElementById('adminFileInput'); const file = input.files[0];
    if (!file || !currentAdminGiftId) return;
    const formData = new FormData(); formData.append('photo', file); formData.append('giftId', currentAdminGiftId); formData.append('uploaderName', 'Admin');
    const res = await authenticatedFetch(`/api/${currentGameId}/upload`, { method: 'POST', body: formData });
    if (res.ok) { input.value = ''; reloadModal(currentAdminGiftId); }
}
function reloadModal(giftId) { fetch(`/api/${currentGameId}/state`).then(r => r.json()).then(state => { const gift = state.gifts.find(g => g.id === giftId); if (gift) renderAdminImages(gift); }); }

// --- 9. HELPERS ---
setInterval(() => {
    const timers = document.querySelectorAll('.player-timer');
    timers.forEach(el => {
        const start = parseInt(el.dataset.start); const duration = parseInt(el.dataset.duration) * 1000;
        if (!start) return;
        const remaining = Math.max(0, duration - (Date.now() - start));
        const seconds = Math.ceil(remaining / 1000); const m = Math.floor(seconds / 60); const s = seconds % 60;
        el.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        if (seconds <= 10) el.style.color = "#dc2626"; else if (seconds <= 30) el.style.color = "#d97706"; else el.style.color = "#2563eb";
    });
}, 1000);

function setTvMode(mode) {
    if (!currentGameId) return;
    socket.emit('previewSettings', { gameId: currentGameId, settings: { tvMode: mode } });
    document.querySelectorAll('.menu-bar .btn-toggle').forEach(btn => btn.classList.remove('active'));
    if (mode === 'rules') document.getElementById('btnTvRules').classList.add('active');
    else if (mode === 'qr') document.getElementById('btnTvQr').classList.add('active');
    else if (mode === 'catalog') document.getElementById('btnTvGrid').classList.add('active');
    else document.getElementById('btnTvList').classList.add('active');
}

function showLocalQr() {
    const url = `${window.location.origin}/scoreboard.html?game=${currentGameId}&mode=mobile`;
    document.getElementById('qrGameIdDisplay').innerText = currentGameId;
    const container = document.getElementById('localQrcode'); container.innerHTML = '';
    new QRCode(container, { text: url, width: 200, height: 200 });
    let link = document.getElementById('localQrLink');
    if (!link) { link = document.createElement('a'); link.id = 'localQrLink'; link.target = "_blank"; link.style.display = "block"; link.style.marginTop = "10px"; link.style.color = "#2563eb"; container.parentNode.appendChild(link); }
    link.href = url; link.innerText = "🔗 Click to Open Link";
    showModal('localQrModal');
}
function closeLocalQr() { hideModal('localQrModal'); }
window.openCatalog = function() { if (currentGameId) window.open(`/catalog.html?game=${currentGameId}`, '_blank'); }

function toggleRosterInput() {
    // Find checked radio
    const selected = document.querySelector('input[name="assignmentMode"]:checked');
    const mode = selected ? selected.value : 'manual';

    const rosterArea = document.getElementById('settingRosterNames');
    const countInput = document.getElementById('settingTotalPlayers');

    if (mode === 'manual') {
        // DISABLE
        rosterArea.disabled = true;
        rosterArea.style.backgroundColor = "#f3f4f6"; // Gray
        rosterArea.style.color = "#9ca3af";           // Muted text
        rosterArea.placeholder = "Select a 'Pre-Enter' option above to enable editing...";

        // Disable Count Input (User Request)
        countInput.disabled = true;
        countInput.style.backgroundColor = "#f3f4f6";
    } else {
        // ENABLE
        rosterArea.disabled = false;
        rosterArea.style.backgroundColor = "#ffffff"; // White
        rosterArea.style.color = "#000000";           // Normal text
        rosterArea.placeholder = "Alice\nBob\nCharlie...";

        // Enable Count Input
        countInput.disabled = false;
        countInput.style.backgroundColor = "#ffffff";

        // Auto-init count if needed
        if (!countInput.value || parseInt(countInput.value) === 0) {
            countInput.value = 5;
            syncRosterFromCount();
        } else {
            syncRosterFromCount();
        }
    }
}

function syncRosterFromCount() {
    const selected = document.querySelector('input[name="assignmentMode"]:checked');
    const mode = selected ? selected.value : 'manual';

    // If we are in Manual/Live mode, do not run this logic.
    if (mode === 'manual') return;

    const countInput = document.getElementById('settingTotalPlayers');
    const rosterArea = document.getElementById('settingRosterNames');

    const targetCount = parseInt(countInput.value) || 0;
    if (targetCount > 100) return;

    let currentLines = rosterArea.value.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    // If we have fewer lines than target, add placeholders
    if (currentLines.length < targetCount) {
        for (let i = currentLines.length + 1; i <= targetCount; i++) {
            currentLines.push(`Player ${i}`);
        }
    }
    // If we have more lines (user reduced count), we respect the count input?
    // Usually safer to NOT delete names automatically.
    // But user requirement says "auto fill", let's just match count for now.
    // Ideally, we'd only trim placeholders, but simpler logic matches expectations.
    else if (currentLines.length > targetCount) {
         currentLines = currentLines.slice(0, targetCount);
    }

    rosterArea.value = currentLines.join('\n');
    updateCountDisplay(targetCount);
}

function syncCountFromRoster() {
    const rosterArea = document.getElementById('settingRosterNames');
    const countInput = document.getElementById('settingTotalPlayers');
    const lines = rosterArea.value.split('\n').filter(line => line.trim().length > 0);
    const count = lines.length;
    updateCountDisplay(count);
    if (countInput.value != count) countInput.value = count;
}
function updateCountDisplay(n) { const el = document.getElementById('rosterCountDisplay'); if (el) el.innerText = n; }
const rosterAreaRef = document.getElementById('settingRosterNames');
if (rosterAreaRef) {
    rosterAreaRef.addEventListener('blur', function() {
        // Clean up empty lines on blur
        const cleanText = this.value.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
        if (this.value !== cleanText) { this.value = cleanText; syncCountFromRoster(); }
    });
}

function showModal(id) { const el = document.getElementById(id); if (el) { el.classList.remove('hidden'); el.classList.add('active'); } }
function hideModal(id) { const el = document.getElementById(id); if (el) { el.classList.remove('active'); setTimeout(() => el.classList.add('hidden'), 200); } }

function showDialog(type, message, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('sysDialogModal');
        const title = document.getElementById('sysDialogTitle');
        const msg = document.getElementById('sysDialogMessage');
        const input = document.getElementById('sysDialogInput');
        const btnOk = document.getElementById('btnSysOk');
        const btnCancel = document.getElementById('btnSysCancel');
        input.classList.add('hidden'); btnCancel.classList.add('hidden'); btnOk.innerText = "OK";
        msg.innerText = message; input.value = defaultValue;
        if (type === 'alert') title.innerText = '⚠️ Notice';
        else if (type === 'confirm') { title.innerText = '❓ Confirmation'; btnCancel.classList.remove('hidden'); btnOk.innerText = "Yes, Proceed"; }
        else if (type === 'prompt') { title.innerText = '✍️ Input Required'; input.classList.remove('hidden'); btnCancel.classList.remove('hidden'); btnOk.innerText = "Submit"; }
        modal.classList.remove('hidden'); modal.classList.add('active');
        if (type === 'prompt') setTimeout(() => input.focus(), 100);
        const close = (val) => { modal.classList.remove('active'); setTimeout(() => modal.classList.add('hidden'), 200); resolve(val); };
        btnOk.onclick = () => { if (type === 'prompt') close(input.value); else close(true); };
        btnCancel.onclick = () => { if (type === 'prompt') close(null); else close(false); };
        input.onkeydown = (e) => { if (e.key === 'Enter') btnOk.click(); if (e.key === 'Escape') btnCancel.click(); };
    });
}
window.customAlert = async (msg) => await showDialog('alert', msg);
window.customConfirm = async (msg) => await showDialog('confirm', msg);
window.customPrompt = async (msg, val) => await showDialog('prompt', msg, val);