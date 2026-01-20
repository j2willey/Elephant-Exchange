/*
 * ELEPHANT EXCHANGE - SCOREBOARD / MOBILE VIEW
 * Handles the TV display and Mobile Guest interface
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

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('game');
    const mode = params.get('mode');

    // 1. Determine Mode
    if (mode === 'mobile') {
        isMobileMode = true;
        document.body.classList.add('mobile-view');
        createHiddenFileInput(); 
    } else {
        document.body.classList.add('tv-mode');
    }

    // 2. Auto-Join if URL has game ID
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

// --- CONNECTION & STATE ---

function joinGame(urlGameId = null) {
    const inputId = document.getElementById('gameIdInput').value.trim();
    const gameId = urlGameId || inputId;
    if(!gameId) return;

    currentGameId = gameId;
    if (isMobileMode) loadBookmarks(gameId);

    // Switch View from Login to Dashboard
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    // Connect Socket
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

    // TV-Specific Listeners
    if (!isMobileMode) {
        socket.on('settingsPreview', (settings) => {
            if (settings.scrollSpeed !== undefined) {
                window.currentScrollSpeed = parseInt(settings.scrollSpeed);
                if (!scrollInterval && window.currentScrollSpeed > 0) initAutoScroll();
            }
            if (settings.tvMode) handleTvMode(settings.tvMode);
        });
        socket.on('tvMode', handleTvMode);
    }
    
    refreshState();
}

async function refreshState() {
    if(!currentGameId) return;
    try {
        const res = await fetch(`/api/${currentGameId}/state`);
        if(res.ok) renderView(await res.json());
    } catch(e) { console.error(e); }
}

// --- MAIN RENDER ENGINE ---

function renderView(state) {
    // 1. Apply Theme (Shared Library)
    if(window.applyTheme) applyTheme(state.settings);
    
    // 2. Render Overlay (Catalog/Rules/QR)
    renderTvCatalog(state); // The grid overlay

    // 3. TV Specifics
    if (!isMobileMode) {
        window.currentScrollSpeed = state.settings.scrollSpeed !== undefined ? state.settings.scrollSpeed : 3;
        if (!scrollInterval && window.currentScrollSpeed > 0) initAutoScroll();
        
    }
    renderActiveBanner(state);
    
    // 4. Render the Main List (Mobile & TV)
    renderGiftList(state);
}

// --- SUB-RENDERERS ---

// A. UPDATE THIS FUNCTION (Fixes "Waiting..." confusion)
function renderActiveBanner(state) {
    const banner = document.getElementById('activePlayerBanner');
    
    // 1. Handle Phases first
    if (state.phase === 'voting') {
        banner.innerHTML = "<div style='padding:20px; font-size:2.5rem;'>🗳️ Voting in Progress!</div>";
        banner.style.background = "#d97706"; // Gold
        return;
    }
    if (state.phase === 'results') {
        banner.innerHTML = "<div style='padding:20px; font-size:2.5rem;'>🏆 The Results</div>";
        banner.style.background = "#16a34a"; // Green
        return;
    }

    // 2. Handle Active Game (Standard Logic)
    const activeIds = (window.getActiveIds) ? getActiveIds(state) : [];
    
    if (activeIds.length > 0) {
        banner.dataset.active = "true";
        banner.style.background = "#1f2937"; 

        let tableHtml = `<table class="active-table">`;
        activeIds.forEach(id => {
            const p = state.participants.find(x => x.id === id);
            if(!p) return;
            
            const isSteal = p.isVictim;
            const rowClass = isSteal ? 'row-steal' : 'row-turn';
            const label = isSteal ? `🚨 ${p.name}` : `${p.name} (#${p.number})`;
            const startTime = p.turnStartTime || Date.now(); 
            const duration = state.settings.turnDurationSeconds || 60;

            tableHtml += `
                <tr class="${rowClass}">
                    <td class="col-active-name">${label}</td>
                    <td class="col-active-time">
                        <span class="dynamic-timer" data-start="${startTime}" data-duration="${duration}">--:--</span>
                    </td>
                </tr>`;
        });
        tableHtml += `</table>`;
        banner.innerHTML = tableHtml;
    } else {
        // Only show "Waiting" if phase is active but no one is up (e.g. Game Over before Voting starts)
        banner.innerHTML = "<div style='padding:20px;'>Waiting for Admin...</div>";
        banner.style.background = "#374151";
    }
}

// B. UPDATE THIS FUNCTION (Enables Photos in Voting Mode)
function renderGiftList(state) {
    const gList = document.getElementById('giftList');
    const isVoting = state.phase === 'voting';
    const isResults = state.phase === 'results';

    // --- A. MOBILE VOTING VIEW (Fixed) ---
    if (isMobileMode && isVoting) {
        gList.innerHTML = state.gifts.map(g => {
            const votes = g.downvotes || [];
            const myId = getMyVoterId(); 
            const isVoted = votes.includes(myId);
            
            // Icons
            const thumbOutline = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: scaleY(-1);"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>`;
            const thumbFilled = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="#ef4444" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: scaleY(-1);"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>`;

            const icon = isVoted ? thumbFilled : thumbOutline;
            const btnStyle = isVoted ? 'opacity:1;' : 'opacity:0.5; color:#9ca3af;';

            // --- PHOTO LOGIC (NEW) ---
            let thumbHtml = '';
            if (showThumbnails && g.images && g.images.length > 0) {
                const heroId = g.primaryImageId || g.images[0].id;
                const imgObj = g.images.find(i => i.id === heroId) || g.images[0];
                thumbHtml = `<div style="grid-column: 1/-1; padding: 5px 0 10px 0;"><img src="${imgObj.path}" style="height:120px; border-radius:4px;"></div>`;
            }

            return `
            <li style="display:grid; grid-template-columns: 1fr 60px; align-items:center; padding:15px;">
                <div>
                    <div class="gift-name" style="font-size:1.1rem; font-weight:bold;">${g.description}</div>
                    <div class="gift-owner" style="font-size:0.9rem; color:#888;">${getOwnerName(state, g.ownerId)}</div>
                </div>
                <button onclick="castVote('${g.id}')" style="background:none; border:none; cursor:pointer; ${btnStyle}">
                    ${icon}
                </button>
                ${thumbHtml}
            </li>`;
        }).join('');
        return;
    }

    // ... (Keep existing TV Voting, Results, and Standard Views) ...
    // Note: Ensure you keep the 'else' blocks from the previous version for TV/Results
    
    // --- B. TV VOTING VIEW (Keep existing) ---
    if (!isMobileMode && isVoting) {
        const sorted = state.gifts.sort((a,b) => (b.downvotes?.length || 0) - (a.downvotes?.length || 0));
        gList.innerHTML = sorted.map(g => {
            const count = g.downvotes?.length || 0;
            const percent = Math.min(100, count * 5); 
            return `
            <li class="voting-row">
                <div class="vote-bar" style="width:${percent}%;"></div>
                <div class="vote-content">
                    <span>${g.description}</span>
                    <span style="font-weight:bold; color:#ef4444;">${count} 👎</span>
                </div>
            </li>`;
        }).join('');
        return;
    }

    // --- C. RESULTS VIEW (Keep existing) ---
    if (!isMobileMode && isResults) {
        renderPodium(state);
        return;
    }

    // --- D. STANDARD VIEW (Keep existing) ---
    // (Copy the Standard View logic from previous turn here)
    // ...
    
    // Sort Logic (Standard)
    const sortedGifts = state.gifts.sort((a,b) => {
        if (a.isFrozen !== b.isFrozen) return a.isFrozen - b.isFrozen;
        if (isMobileMode) {
            const aStarred = myBookmarks.has(a.id);
            const bStarred = myBookmarks.has(b.id);
            if (aStarred && !bStarred) return -1;
            if (!aStarred && bStarred) return 1;
        }
        return b.stealCount - a.stealCount;
    });

    let html = '';
    if (isMobileMode) {
        renderMobileControls();
        html += `
        <li class="mobile-table-header" style="display:grid; grid-template-columns: 30px 1fr 30px 1fr 40px 40px; gap:5px; position:sticky; top:0; z-index:10;">
            <div>⭐</div><div>Gift</div><div style="text-align:center">#</div><div>Holder</div><div style="text-align:center">Stl</div><div style="text-align:center">📷</div> 
        </li>`;
    }

    if (sortedGifts.length === 0) {
        html += '<li style="color:#6b7280; text-align:center; padding: 20px;">No gifts yet</li>';
        gList.innerHTML = html;
        return; 
    }

    html += sortedGifts.map(g => {
        const ownerName = getOwnerName(state, g.ownerId);
        
        if (isMobileMode) {
            const isStarred = myBookmarks.has(g.id);
            const rowClass = isStarred ? 'highlight-gift' : '';
            const starChar = isStarred ? '⭐' : '☆';
            const max = state.settings.maxSteals || 3;
            let stealBadge = `<span class="badge">${g.stealCount}/${max}</span>`;
            if (g.isFrozen) stealBadge = `<span class="badge locked">🔒</span>`;
            const hasImages = g.images && g.images.length > 0;
            const cameraIcon = hasImages ? '📸' : '➕';
            const cameraClass = hasImages ? 'btn-camera-view' : 'btn-camera-add';

            let thumbHtml = '';
            if (showThumbnails && hasImages) {
                const heroId = g.primaryImageId || g.images[0].id;
                const imgObj = g.images.find(i => i.id === heroId) || g.images[0];
                thumbHtml = `<div style="grid-column: 1/-1; padding: 5px 0 10px 35px;"><img src="${imgObj.path}" style="height:80px; border-radius:4px;"></div>`;
            }

            return `
            <li class="${rowClass}" style="display:grid; grid-template-columns: 30px 1fr 30px 1fr 40px 40px; gap:5px; align-items:center;">
                <div class="col-star" onclick="toggleBookmark('${g.id}')"><span class="star-icon">${starChar}</span></div>
                <div class="col-gift" onclick="toggleBookmark('${g.id}')">${g.description}</div>
                <div class="col-num"></div>
                <div class="col-held" onclick="toggleBookmark('${g.id}')">${ownerName}</div>
                <div class="col-stl" onclick="toggleBookmark('${g.id}')">${stealBadge}</div>
                <div class="col-cam" style="text-align:center; cursor:pointer;" onclick="initUpload('${g.id}')">
                    <span class="${cameraClass}">${cameraIcon}</span>
                </div>
                ${thumbHtml} 
            </li>`;
        } else {
            // TV Row
             let badge = '';
            if (g.isFrozen) badge = '<span class="badge" style="background:#374151;">🔒 LOCKED</span>';
            else badge = `<span class="badge">${g.stealCount}/3 Steals</span>`;
            
            return `
            <li style="${g.isFrozen ? 'opacity:0.5' : ''}">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-weight:600;">${g.description}</span>
                </div>
                <span class="owner-col">Held by <b>${ownerName}</b></span>
                ${badge}
            </li>`;
        }
    }).join('');

    gList.innerHTML = html;
}

function renderTvCatalog(state) {
    const grid = document.getElementById('tvCatalogGrid');
    if (!grid) return; 

    const gifts = state.gifts.sort((a,b) => {
        const aHas = (a.images && a.images.length > 0) ? 1 : 0;
        const bHas = (b.images && b.images.length > 0) ? 1 : 0;
        return bHas - aHas || a.id.localeCompare(b.id);
    });

    if (gifts.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; font-size:2rem; color:#6b7280;">No gifts opened yet</div>';
        return;
    }

    grid.innerHTML = gifts.map(g => {
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
                    <div class="card-title" style="font-size:1.5rem;">${g.description}</div>
                    <div class="card-meta" style="font-size:1.2rem; margin-top:10px;">
                        <span>👤 ${ownerName}</span>
                        ${statusBadge}
                    </div>
                </div>
            </div>`;
    }).join('');
}

function renderPodium(state) {
    const sorted = state.gifts.sort((a,b) => (b.downvotes?.length || 0) - (a.downvotes?.length || 0));
    const top5 = sorted.slice(0, 5);
    const msg = state.settings.endMessage || "Thanks for playing! See you next year! 🐘";

    let html = `<div style="text-align:center; padding:50px;">
        <h1 style="font-size:4rem; margin-bottom:40px;">🏆 WORST GIFTS 🏆</h1>`;

    top5.forEach((g, i) => {
        const size = 3 - (i * 0.4); 
        const count = g.downvotes?.length || 0;
        let img = '';
        if(g.images?.length && i === 0) {
            img = `<img src="${g.images[0].path}" style="max-height:300px; border-radius:10px; margin:20px;">`;
        }

        html += `
        <div style="font-size:${size}rem; margin-bottom:20px; color:${i===0 ? '#ef4444' : 'inherit'};">
            #${i+1}: <b>${g.description}</b> (${count} votes)
            ${img}
        </div>`;
    });

    html += `<h2 style="margin-top:50px; color:var(--primary);">${msg}</h2></div>`;
    document.getElementById('giftList').innerHTML = html;
}

// --- UTILS & HELPERS ---

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
    if(input) input.click();
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

// Timer Loop
setInterval(() => {
    const timers = document.querySelectorAll('.dynamic-timer');
    timers.forEach(el => {
        const start = parseInt(el.dataset.start);
        const duration = parseInt(el.dataset.duration) * 1000;
        if(!start || !duration) return;
        const remaining = Math.max(0, (duration - (Date.now() - start)) / 1000);
        const m = Math.floor(remaining / 60);
        const s = Math.floor(remaining % 60);
        el.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        if(remaining <= 0) el.innerText = "TIME'S UP!";
    });
}, 100);

// --- HELPERS ---

function getOwnerName(state, ownerId) {
    const p = state.participants.find(p => p.id === ownerId);
    return p ? p.name : "Unclaimed";
}

function getMyVoterId() {
    let id = localStorage.getItem('voterId');
    if(!id) {
        id = 'v_' + Date.now() + Math.random();
        localStorage.setItem('voterId', id);
    }
    return id;
}

async function castVote(giftId) {
    const voterId = getMyVoterId();
    await fetch(`/api/${currentGameId}/vote`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
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

    if (mode === 'rules') document.getElementById('overlay-rules').classList.remove('hidden');
    else if (mode === 'qr') {
        const url = window.location.href; 
        document.getElementById('joinUrlDisplay').innerText = url;
        const container = document.getElementById('qrcode');
        container.innerHTML = '';
        new QRCode(container, { text: url, width: 256, height: 256 });
        document.getElementById('overlay-qr').classList.remove('hidden');
    } else if (mode === 'catalog') {
        if (catalogOverlay) { catalogOverlay.classList.remove('hidden'); refreshState(); }
    }
}