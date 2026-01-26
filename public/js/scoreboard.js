/*
 * ==============================================================================
 * ELEPHANT EXCHANGE - SCOREBOARD & MOBILE CLIENT
 * ==============================================================================
 * Handles logic for the TV Projector view and the Mobile Player view.
 */

let socket;
let currentGameId = null;
let isMobileMode = false;
let myBookmarks = new Set();
let scrollInterval;
let pauseCounter = 0;
let virtualScrollY = 0;
let currentUploadGiftId = null;
let showThumbnails = false;

// --- 1. INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('game');
    const mode = params.get('mode');

    if (mode === 'mobile') {
        isMobileMode = true;
        document.body.classList.add('mobile-view');
        createHiddenFileInput();
    } else {
        document.body.classList.add('tv-mode');
    }

    if (gameId) {
        document.getElementById('gameIdInput').value = gameId;
        joinGame(gameId);
    }
});

function createHiddenFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'hidden-file-input';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', handleFileUpload);
    document.body.appendChild(input);
}

function joinGame(urlGameId = null) {
    const inputId = document.getElementById('gameIdInput').value.trim();
    const gameId = urlGameId || inputId;
    if (!gameId) return;

    currentGameId = gameId;
    if (isMobileMode) loadBookmarks(gameId);

    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');

    if (socket) socket.disconnect();
    socket = io();

    socket.on('connect', () => {
        socket.emit('joinGame', gameId);
        refreshState();
        const banner = document.getElementById('activePlayerBanner');
        if (banner && banner.innerText.includes("Connection")) banner.innerHTML = "Reconnected!";
    });

    socket.on('stateUpdate', (state) => {
        renderView(state);
    });

    if (!isMobileMode) {
        socket.on('settingsPreview', (settings) => {
            if (settings.scrollSpeed !== undefined) {
                window.currentScrollSpeed = parseInt(settings.scrollSpeed);
                if (!scrollInterval && window.currentScrollSpeed > 0) initAutoScroll();
            }
            if (settings.tvMode !== undefined) {
                handleTvMode(settings.tvMode);
            }
        });
        socket.on('tvMode', handleTvMode);
    }

    refreshState();
}

async function refreshState() {
    if (!currentGameId) return;
    try {
        const res = await fetch(`/api/${currentGameId}/state`);
        if (res.ok) renderView(await res.json());
    } catch (e) { console.error(e); }
}

// --- 2. CORE RENDERING ---

function renderView(state) {
    if (window.applyTheme) applyTheme(state.settings);

    // 1. Setup Header (TV Only)
    const title = state.settings?.partyName;
    const tagline = state.settings?.tagline;
    let header = document.getElementById('tvHeader');

    if (!header && !isMobileMode) {
        header = document.createElement('div');
        header.id = 'tvHeader';
        header.style.textAlign = 'center';
        header.style.padding = '20px';
        header.style.background = 'var(--primary, #2563eb)';
        header.style.color = 'white';
        header.style.marginBottom = '20px';
        document.body.prepend(header);
    }

    if (header) {
        header.innerHTML = `<h1 style='margin:0; font-size:3rem;'>${title || 'Elephant Exchange'}</h1>`;
        if (tagline) header.innerHTML += `<div style='font-size:1.5rem; opacity:0.8;'>${tagline}</div>`;
    }

    // 2. Render Sub-Components
    renderTvCatalog(state);
    renderActiveBanner(state);
    renderGiftList(state);

    // 3. Auto-Scroll Logic (TV Only)
    if (!isMobileMode) {
        window.currentScrollSpeed = state.settings.scrollSpeed !== undefined ? state.settings.scrollSpeed : 3;
        if (!scrollInterval && window.currentScrollSpeed > 0) initAutoScroll();
    }
}

function renderActiveBanner(state) {
    const banner = document.getElementById('activePlayerBanner');

    // 1. PHASE: VOTING
    if (state.phase === 'voting') {
        banner.innerHTML = "<div style='padding:20px; font-size:2.5rem;'>🗳️ Voting in Progress!</div>";
        banner.style.background = "#d97706";
        return;
    }

    // 2. PHASE: RESULTS
    if (state.phase === 'results') {
        banner.innerHTML = "<div style='padding:20px; font-size:2.5rem;'>🏆 The Results</div>";
        banner.style.background = "#16a34a";
        return;
    }

    // 3. PHASE: ACTIVE GAME
    // Use the shared helper if available, otherwise fallback
    const activeIds = (window.getActiveIds) ? getActiveIds(state) : [];

    if (activeIds.length > 0) {
        // FIX 1: "On Deck" must exclude anyone currently active!
        const nextPlayer = state.participants
            .filter(p => !activeIds.includes(p.id) && !p.isVictim && !p.heldGiftId)
            .sort((a, b) => a.number - b.number)[0];

        // Render Active Players
        const playersHtml = activeIds.map(id => {
            const p = state.participants.find(x => x.id === id);
            if (!p) return '';

            const duration = state.settings.turnDurationSeconds || 60;
            let timerHtml = `<span style="font-size:1.5rem; opacity:0.8;">Active</span>`;

            if (p.turnStartTime) {
                timerHtml = `<span class="player-timer dynamic-timer" data-start="${p.turnStartTime}" data-duration="${duration}">--:--</span>`;
            }

            return `
                <table class="active-table" style="margin-bottom:0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <tr>
                        <td class="col-active-name" style="width: 50%;">
                            <span style="font-size:0.4em; text-transform:uppercase; color:white; opacity:0.7; display:block;">Current Turn</span>
                            ${p.name}
                        </td>
                        <td class="col-active-time">
                            ${timerHtml}
                        </td>
                    </tr>
                </table>`;
        }).join('');

        // FIX 2: Render "On Deck" ONCE at the bottom
        let footerHtml = '';
        if (nextPlayer) {
            footerHtml = `
                <div style="background:rgba(0,0,0,0.2); padding:8px 15px; font-size:1rem; color:#e5e7eb; display:flex; justify-content:space-between; align-items:center;">
                    <span><span style="opacity:0.6; text-transform:uppercase; font-size:0.8em; margin-right:5px;">On Deck:</span> <b>${nextPlayer.name}</b></span>
                    <span style="opacity:0.6;">#${nextPlayer.number}</span>
                </div>`;
        }

        banner.dataset.active = "true";
        banner.style.background = "var(--primary, #2563eb)";
        banner.innerHTML = playersHtml + footerHtml;

    } else {
        // ... (Keep existing Wait/End states) ...
        const totalPlayers = state.participants.length;
        if (state.participants.length === 0) {
            banner.innerHTML = "<div style='padding:20px;'>Waiting for Players...</div>";
        } else if (state.currentTurn > totalPlayers) {
             banner.innerHTML = `
                <div style='padding:20px; animation: pulse 2s infinite;'>
                    <div style="font-size:2.5rem; margin-bottom:10px;">🎁 All Gifts Opened!</div>
                    <div style="font-size:1.2rem; color:#9ca3af;">Waiting for Host to start voting...</div>
                </div>`;
            banner.style.background = "#4b5563";
        } else {
            banner.innerHTML = "<div style='padding:20px;'>Waiting for Host...</div>";
            banner.style.background = "#374151";
        }
    }
}

// --- 3. GIFT LIST LOGIC (MOBILE & TV) ---

function renderGiftList(state) {
    const gList = document.getElementById('giftList');
    const isVoting = state.phase === 'voting';
    const isResults = state.phase === 'results';

    // Global Sorting
    const sorted = (window.sortGifts) ? sortGifts(state.gifts, state, isMobileMode, myBookmarks) : state.gifts;

    // A. VOTING PHASE
    if (isVoting) {
        if (isMobileMode) renderMobileVoting(gList, sorted, state);
        else renderTvVoting(gList, sorted);
        return;
    }

    // B. RESULTS PHASE (TV ONLY)
    if (!isMobileMode && isResults) {
        renderPodium(state);
        return;
    }

    // C. STANDARD GAME VIEW
    const sortedGifts = state.gifts.sort((a, b) => {
        if (a.isFrozen !== b.isFrozen) return a.isFrozen - b.isFrozen;
        if (isMobileMode) {
            const aStarred = myBookmarks.has(a.id);
            const bStarred = myBookmarks.has(b.id);
            if (aStarred && !bStarred) return -1;
            if (!aStarred && bStarred) return 1;
        }
        return b.stealCount - a.stealCount;
    });

    if (sortedGifts.length === 0) {
        gList.innerHTML = '<li style="color:#6b7280; text-align:center; padding: 20px;">No gifts yet</li>';
        return;
    }

    if (isMobileMode) {
        renderMobileList(gList, sortedGifts, state);
    } else {
        renderTvList(gList, sortedGifts, state);
    }
}

// --- 3a. MOBILE RENDERERS ---

function renderMobileVoting(container, sorted, state) {
    container.innerHTML = sorted.map(g => {
        const votes = g.downvotes || [];
        const isVoted = votes.includes(getMyVoterId());
        const data = getSafeGiftData(g);
        const ownerName = getOwnerName(state, g.ownerId);

        const thumbOutline = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: scaleY(-1);"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>`;
        const thumbFilled = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="#ef4444" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: scaleY(-1);"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>`;
        const icon = isVoted ? thumbFilled : thumbOutline;

        let thumbHtml = '';
        if (showThumbnails && g.images && g.images.length > 0) {
            const imgObj = g.images.find(i => i.id === g.primaryImageId) || g.images[0];
            thumbHtml = `<div style="grid-column:1/-1; padding:5px 0 10px 0;"><img src="${imgObj.path}" style="height:120px; border-radius:4px;"></div>`;
        }

        return `
        <li style="display:grid; grid-template-columns: 1fr 60px; align-items:center; padding:15px;">
            <div>
                <div class="gift-name" style="font-size:1.1rem; font-weight:bold;">${data.name}</div>
                ${data.desc ? `<div style="font-size:0.9rem; color:#6b7280;">${data.desc}</div>` : ''}
                <div class="gift-owner" style="font-size:0.85rem; color:#888; margin-top:4px;">Held by: ${ownerName}</div>
            </div>
            <button onclick="castVote('${g.id}')" style="background:none; border:none; cursor:pointer;">${icon}</button>
            ${thumbHtml}
        </li>`;
    }).join('');
}

function renderMobileList(container, sortedGifts, state) {
    renderMobileControls();

    let html = `
        <li class="mobile-table-header" style="
            display:grid;
            grid-template-columns: 25px 1.2fr 25px 1fr 35px 35px;
            gap:4px;
            position:sticky;
            top:0;
            z-index:10;
            font-weight:700;
            background:white;
            border-bottom: 2px solid #94a3b8;
            padding: 8px 5px;
            font-size: 0.9rem;
        ">
            <div style="text-align:center">⭐</div>
            <div>Gift</div>
            <div style="text-align:center">#</div>
            <div>Holder</div>
            <div style="text-align:center">Steals</div>
            <div style="text-align:center">📷</div>
        </li>`;

    html += sortedGifts.map(g => {
        const data = getSafeGiftData(g);
        const ownerName = getOwnerName(state, g.ownerId);

        const isStarred = myBookmarks.has(g.id);
        const rowClass = isStarred ? 'highlight-gift' : '';
        const starChar = isStarred ? '⭐' : '☆';
        const max = state.settings.maxSteals || 3;

        let stealBadge = `<span class="badge" style="font-size:0.75rem; padding:2px 4px;">${g.stealCount}/${max}</span>`;
        if (g.isFrozen) stealBadge = `<span class="badge locked" style="font-size:0.75rem; padding:2px 4px;">🔒</span>`;

        const hasImages = g.images && g.images.length > 0;
        const cameraIcon = hasImages ? '📸' : '➕';
        const cameraClass = hasImages ? 'btn-camera-view' : 'btn-camera-add';

        let thumbHtml = '';
        if (showThumbnails && hasImages) {
            const heroId = g.primaryImageId || g.images[0].id;
            const imgObj = g.images.find(i => i.id === heroId) || g.images[0];
            thumbHtml = `<div style="grid-column: 1/-1; padding: 5px 0 10px 30px;"><img src="${imgObj.path}" style="height:80px; border-radius:4px;"></div>`;
        }

        return `
        <li class="${rowClass}" style="
            display:grid;
            grid-template-columns: 25px 1.2fr 25px 1fr 35px 35px;
            gap:4px;
            align-items:center;
            padding: 8px 5px;
            border-bottom: 1px solid #f1f5f9;
        ">
            <div class="col-star" onclick="toggleBookmark('${g.id}')" style="text-align:center; cursor:pointer;">
                <span class="star-icon" style="font-size:1.2rem;">${starChar}</span>
            </div>

            <div class="col-gift" onclick="toggleBookmark('${g.id}')" style="overflow:hidden; cursor:pointer;">
                <div style="font-weight:600; font-size:0.95rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${data.name}</div>
                ${data.desc ? `<div style="font-size:0.75rem; color:#6b7280; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${data.desc}</div>` : ''}
            </div>

            <div class="col-num" style="text-align:center; font-size:0.85rem; color:#6b7280;">${g.number || '-'}</div>

            <div class="col-held" onclick="toggleBookmark('${g.id}')" style="font-size:0.85rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ownerName}</div>

            <div class="col-stl" onclick="toggleBookmark('${g.id}')" style="text-align:center;">${stealBadge}</div>

            <div class="col-cam" style="text-align:center; cursor:pointer;" onclick="initUpload('${g.id}')">
                <span class="${cameraClass}" style="font-size:1rem;">${cameraIcon}</span>
            </div>
            ${thumbHtml}
        </li>`;
    }).join('');

    container.innerHTML = html;
}

// --- 3b. TV RENDERERS ---

function renderTvVoting(container, sorted) {
    container.innerHTML = sorted.map(g => {
        const data = getSafeGiftData(g);
        const count = g.downvotes?.length || 0;
        const maxVotes = Math.max(...sorted.map(x => x.downvotes?.length || 0)) || 1;
        const percent = (count / maxVotes) * 100;
        return `
        <li class="voting-row">
            <div class="vote-bar" style="width:${percent}%;"></div>
            <div class="vote-content">
                <span>${data.name}</span>
                <span style="font-weight:bold; color:#ef4444;">${count} 👎</span>
            </div>
        </li>`;
    }).join('');
}

function renderTvList(container, sortedGifts, state) {
    // 1. TV Header Row
    let html = `
    <li style="
        display:grid;
        grid-template-columns: 1fr 20% 15%;
        gap: 20px;
        padding: 15px 20px;
        background: rgba(0,0,0,0.05);
        border-bottom: 3px solid #cbd5e1;
        font-weight: 700;
        font-size: 1.4rem;
        color: #334155;
        position: sticky;
        top: 0;
        z-index: 10;
    ">
        <div>Gift Details</div>
        <div>Holder</div>
        <div style="text-align:right;">Status</div>
    </li>`;

    // 2. Render Rows
    html += sortedGifts.map(g => {
        const data = getSafeGiftData(g);
        const ownerName = getOwnerName(state, g.ownerId);

        let badge = '';
        if (g.isFrozen) {
            badge = `<span class="badge" style="font-size:1.1rem; padding:6px 12px; background:#374151; color:#fff;">🔒 LOCKED</span>`;
        } else {
            const max = state.settings.maxSteals || 3;
            const stealColor = (g.stealCount >= max - 1) ? '#c2410c' : '#f59e0b';
            badge = `<span class="badge" style="font-size:1.1rem; padding:6px 12px; background:${stealColor}; color:#fff;">${g.stealCount}/${max} Steals</span>`;
        }

        let thumbHtml = '';
        if (g.images && g.images.length > 0) {
            const imgObj = g.images.find(i => i.id === g.primaryImageId) || g.images[0];
            thumbHtml = `<img src="${imgObj.path}" style="height:50px; width:50px; object-fit:cover; border-radius:6px; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.1);">`;
        }

        return `
        <li style="
            display:grid;
            grid-template-columns: 1fr 20% 15%;
            gap: 20px;
            padding: 15px 20px;
            align-items: center;
            border-bottom: 1px solid #e2e8f0;
            background: white;
            font-size: 1.3rem;
            opacity: ${g.isFrozen ? '0.6' : '1'};
        ">
            <div style="display:flex; align-items:center; gap:15px;">
                ${thumbHtml}
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:700; color:#1e293b;">${data.name}</span>
                    ${data.desc ? `<span style="font-size:1rem; color:#64748b; margin-top:4px;">${data.desc}</span>` : ''}
                </div>
            </div>

            <div style="font-weight:500; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${ownerName}
            </div>

            <div style="text-align:right;">
                ${badge}
            </div>
        </li>`;
    }).join('');

    container.innerHTML = html;
}

// --- 4. TV CATALOG OVERLAY ---

function renderTvCatalog(state) {
    const grid = document.getElementById('tvCatalogGrid');
    if (!grid) return;

    const gifts = state.gifts.sort((a, b) => {
        const aHas = (a.images && a.images.length > 0) ? 1 : 0;
        const bHas = (b.images && b.images.length > 0) ? 1 : 0;
        return bHas - aHas || a.id.localeCompare(b.id);
    });

    if (gifts.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; font-size:2rem; color:#6b7280;">No gifts opened yet</div>';
        return;
    }

    grid.innerHTML = gifts.map(g => {
        const data = getSafeGiftData(g);
        const ownerName = getOwnerName(state, g.ownerId);

        let imgHtml = `<div class="card-placeholder">🐘</div>`;
        if (g.images && g.images.length > 0) {
            const heroId = g.primaryImageId || g.images[0].id;
            const imgObj = g.images.find(i => i.id === heroId) || g.images[0];
            imgHtml = `<img src="${imgObj.path}" class="card-img" style="height:300px;">`;
            if (g.images.length > 1) {
                imgHtml += `<div style="position:absolute; bottom:15px; right:15px; background:rgba(0,0,0,0.8); color:white; padding:5px 12px; border-radius:20px; font-size:1rem;">📸 ${g.images.length}</div>`;
            }
        }

        let statusBadge = '';
        if (g.isFrozen) statusBadge = `<span class="card-badge" style="background:#374151; font-size:1rem; padding:5px 10px;">🔒 Locked</span>`;
        else if (g.stealCount > 0) statusBadge = `<span class="card-badge" style="background:#f59e0b; font-size:1rem; padding:5px 10px;">Steals: ${g.stealCount}</span>`;

        return `
            <div class="gift-card" style="cursor:default;">
                <div class="card-image-container" style="height:300px;">
                    ${imgHtml}
                </div>
                <div class="card-details">
                    <div class="card-title" style="font-size:1.5rem;">${data.name}</div>
                    ${data.desc ? `<div style="font-size:1rem; color:#6b7280; margin-bottom:10px;">${data.desc}</div>` : ''}
                    <div class="card-meta" style="font-size:1.2rem;">
                        <span>👤 ${ownerName}</span>
                        ${statusBadge}
                    </div>
                </div>
            </div>`;
    }).join('');
}

// --- 5. PODIUM (WORST GIFTS) ---

function renderPodium(state) {
    const sorted = state.gifts.sort((a, b) => (b.downvotes?.length || 0) - (a.downvotes?.length || 0));
    const top5 = sorted.slice(0, 5);
    const msg = state.settings.endMessage || "Thanks for playing! See you next year! 🐘";

    let html = `<div style="text-align:center; padding:50px;">
        <h1 style="font-size:4rem; margin-bottom:40px;">🏆 WORST GIFTS 🏆</h1>`;

    top5.forEach((g, i) => {
        const size = 3 - (i * 0.4);
        const count = g.downvotes?.length || 0;
        const data = getSafeGiftData(g);

        let img = '';
        if (g.images?.length && i === 0) {
            img = `<img src="${g.images[0].path}" style="max-height:300px; border-radius:10px; margin:20px;">`;
        }

        html += `
        <div style="font-size:${size}rem; margin-bottom:20px; color:${i === 0 ? '#ef4444' : 'inherit'};">
            #${i + 1}: <b>${data.name}</b> (${count} votes)
            ${img}
        </div>`;
    });

    html += `<h2 style="margin-top:50px; color:var(--primary);">${msg}</h2></div>`;
    document.getElementById('giftList').innerHTML = html;
}

// --- 6. UTILITIES ---

function getSafeGiftData(g) {
    let mainName = g.name;
    let subDesc = g.description;
    if (String(mainName) === '{}' || String(mainName) === '[object Object]') mainName = null;
    if (String(subDesc) === '{}' || String(subDesc) === '[object Object]') subDesc = null;
    if (!mainName && subDesc) { mainName = subDesc; subDesc = null; }
    else if (!mainName && !subDesc) { mainName = "Mystery Gift"; }
    return { name: mainName, desc: subDesc };
}

function getOwnerName(state, ownerId) {
    const p = state.participants.find(p => p.id === ownerId);
    return p ? p.name : "Unclaimed";
}

function renderMobileControls() {
    let controls = document.getElementById('mobile-controls');
    if (controls) return;
    controls = document.createElement('div');
    controls.id = 'mobile-controls';
    controls.className = 'mobile-controls';
    controls.innerHTML = `
        <label class="toggle-switch">
            <input type="checkbox" id="togglePhotos" onchange="window.togglePhotoView(this)">
            <span class="slider round"></span>
            <span class="toggle-label">Show Photos</span>
        </label>
        <a href="/catalog.html?game=${currentGameId}" class="btn-sm btn-blue">View Catalog ➡️</a>
    `;
    const gList = document.getElementById('giftList');
    gList.parentNode.insertBefore(controls, gList);
}

window.togglePhotoView = function(el) {
    showThumbnails = el.checked;
    refreshState();
}

function initAutoScroll() {
    if (scrollInterval) clearInterval(scrollInterval);
    scrollInterval = setInterval(() => {
        if (isMobileMode) return;
        const container = document.querySelector('.card');
        if (!container || !window.currentScrollSpeed || window.currentScrollSpeed <= 0) return;
        if (container.scrollHeight <= container.clientHeight) return;
        if (pauseCounter > 0) { pauseCounter--; return; }

        if (virtualScrollY === 0 && container.scrollTop > 0) virtualScrollY = container.scrollTop;
        const speed = window.currentScrollSpeed * 0.15;
        virtualScrollY += speed;
        container.scrollTop = virtualScrollY;

        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 5) {
            pauseCounter = 100; virtualScrollY = 0; container.scrollTop = 0;
        }
    }, 30);
}

window.initUpload = function(giftId) {
    currentUploadGiftId = giftId;
    const input = document.getElementById('hidden-file-input');
    if (input) input.click();
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentUploadGiftId) return;
    e.target.value = '';

    const formData = new FormData();
    formData.append('photo', file);
    formData.append('giftId', currentUploadGiftId);
    formData.append('uploaderName', 'MobileUser');

    try {
        const res = await fetch(`/api/${currentGameId}/upload`, { method: 'POST', body: formData });
        if (res.ok) { alert('Photo uploaded! 📸'); refreshState(); }
        else { alert('Upload failed: ' + (await res.json()).error); }
    } catch (err) { console.error(err); alert('Upload error.'); }
}

setInterval(() => {
    const timers = document.querySelectorAll('.dynamic-timer');
    timers.forEach(el => {
        const start = parseInt(el.dataset.start);
        const duration = parseInt(el.dataset.duration) * 1000;
        if (!start || !duration) return;
        const remaining = Math.max(0, (duration - (Date.now() - start)) / 1000);
        const m = Math.floor(remaining / 60);
        const s = Math.floor(remaining % 60);
        el.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        if (remaining <= 0) el.innerText = "TIME'S UP!";
    });
}, 100);

function getMyVoterId() {
    let id = localStorage.getItem('voterId');
    if (!id) {
        id = 'v_' + Date.now() + Math.random();
        localStorage.setItem('voterId', id);
    }
    return id;
}

async function castVote(giftId) {
    const voterId = getMyVoterId();
    await fetch(`/api/${currentGameId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ giftId, voterId })
    });
}

function loadBookmarks(gameId) {
    const saved = localStorage.getItem(`bookmarks_${gameId}`);
    if (saved) myBookmarks = new Set(JSON.parse(saved));
}
window.toggleBookmark = function(giftId) {
    if (myBookmarks.has(giftId)) myBookmarks.delete(giftId);
    else myBookmarks.add(giftId);
    localStorage.setItem(`bookmarks_${currentGameId}`, JSON.stringify([...myBookmarks]));
    refreshState();
}

function handleTvMode(mode) {
    document.getElementById('overlay-rules').classList.add('hidden');
    document.getElementById('overlay-qr').classList.add('hidden');
    const catalogOverlay = document.getElementById('overlay-catalog');
    if (catalogOverlay) catalogOverlay.classList.add('hidden');

    if (mode === 'rules') {
        document.getElementById('overlay-rules').classList.remove('hidden');
    } else if (mode === 'qr') {
        const url = `${window.location.origin}${window.location.pathname}?game=${currentGameId}&mode=mobile`;
        document.getElementById('joinUrlDisplay').innerText = url;
        const container = document.getElementById('qrcode');
        container.innerHTML = '';
        new QRCode(container, { text: url, width: 256, height: 256 });
        document.getElementById('overlay-qr').classList.remove('hidden');
    } else if (mode === 'catalog') {
        if (catalogOverlay) { catalogOverlay.classList.remove('hidden'); refreshState(); }
    }
}
