/*
 * ==============================================================================
 * ELEPHANT EXCHANGE - SCOREBOARD / MOBILE
 * ==============================================================================
 * Handles the "Big Screen" view and the Mobile Guest view.
 */

// --- 1. GLOBALS & INIT ---
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

    // Determine Mode
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

// --- 2. CONNECTION & STATE ---

function joinGame(urlGameId = null) {
    const inputId = document.getElementById('gameIdInput').value.trim();
    const gameId = urlGameId || inputId;
    if(!gameId) return;

    currentGameId = gameId;
    if (isMobileMode) loadBookmarks(gameId);

    // Switch View
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

// --- 3. MAIN RENDER ENGINE ---

function renderView(state) {
    // A. APPLY BRANDING / THEME (Priority 1)
    if (state.settings) {
        const root = document.documentElement;
        
        // Color
        if (state.settings.themeColor) {
            root.style.setProperty('--primary', state.settings.themeColor);
            
            // Force override for buttons using injected style (stronger than CSS)
            let styleTag = document.getElementById('dynamic-theme');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'dynamic-theme';
                document.head.appendChild(styleTag);
            }
            styleTag.innerHTML = `
                .btn-primary { background-color: ${state.settings.themeColor} !important; }
                .active-turn { border-color: ${state.settings.themeColor} !important; background-color: ${state.settings.themeColor}15 !important; }
            `;
        }

        // Background
        if (state.settings.themeBg) {
             root.style.setProperty('--bg-image', `url('${state.settings.themeBg}')`);
        } else {
             root.style.setProperty('--bg-image', 'none');
        }
        
        // Logo
        const titleEl = document.querySelector('h1');
        if (state.settings.themeLogo && !document.getElementById('customLogo')) {
            const img = document.createElement('img');
            img.src = state.settings.themeLogo;
            img.id = 'customLogo';
            img.className = 'game-logo';
            if(titleEl) titleEl.parentNode.insertBefore(img, titleEl);
        } else if (state.settings.themeLogo) {
            document.getElementById('customLogo').src = state.settings.themeLogo;
        }
    }
    
    // B. RENDER COMPONENTS
    renderTvCatalog(state); // The overlay grid
    
    if (!isMobileMode) {
        renderTvAutoScroll(state);
        renderActiveBanner(state);
    }

    renderGiftList(state);
}

// --- 4. SUB-RENDERERS ---

function renderActiveBanner(state) {
    const banner = document.getElementById('activePlayerBanner');
    const activeList = getActivePlayersList(state);
    
    if (activeList.length > 0) {
        banner.dataset.active = "true";
        banner.style.background = "#1f2937"; 

        let tableHtml = `<table class="active-table">`;
        tableHtml += activeList.map(item => {
            const p = item.player;
            const isSteal = item.type === 'steal';
            const rowClass = isSteal ? 'row-steal' : 'row-turn';
            const label = isSteal ? `🚨 ${p.name}` : `${p.name} (#${p.number})`;
            const startTime = p.turnStartTime || Date.now(); 
            const duration = state.settings.turnDurationSeconds || 60;

            return `
                <tr class="${rowClass}">
                    <td class="col-active-name">${label}</td>
                    <td class="col-active-time">
                        <span class="dynamic-timer" data-start="${startTime}" data-duration="${duration}">--:--</span>
                    </td>
                </tr>`;
        }).join('');
        tableHtml += `</table>`;
        banner.innerHTML = tableHtml;
    } else {
        banner.innerHTML = "<div style='padding:20px;'>Waiting...</div>";
        banner.style.background = "#374151";
    }
}

function renderGiftList(state) {
    const gList = document.getElementById('giftList');
    
    // Sorting Logic
    const sortedGifts = state.gifts.sort((a,b) => {
        if (a.isFrozen !== b.isFrozen) return a.isFrozen - b.isFrozen;
        if (isMobileMode) {
            // Starred items float to top on mobile
            const aStarred = myBookmarks.has(a.id);
            const bStarred = myBookmarks.has(b.id);
            if (aStarred && !bStarred) return -1;
            if (!aStarred && bStarred) return 1;
        }
        return b.stealCount - a.stealCount;
    });

    // Mobile Header Injection
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

    // Render Rows
    html += sortedGifts.map(g => {
        const owner = state.participants.find(p => p.id === g.ownerId);
        let ownerName = owner ? owner.name : 'Unknown';
        
        // Stats
        if (state.settings.showVictimStats && owner && owner.timesStolenFrom > 0) {
            ownerName += ` <span style="color:#ef4444; font-size:0.8em;">💔${owner.timesStolenFrom}</span>`;
        }

        // --- MOBILE RENDER ---
        if (isMobileMode) {
            const isStarred = myBookmarks.has(g.id);
            const rowClass = isStarred ? 'highlight-gift' : '';
            const starChar = isStarred ? '⭐' : '☆';
            
            // Steal Badge
            const max = state.settings.maxSteals || 3;
            let stealBadge = `<span class="badge">${g.stealCount}/${max}</span>`;
            if (g.isFrozen) stealBadge = `<span class="badge locked">🔒</span>`;

            // Camera Button
            const hasImages = g.images && g.images.length > 0;
            const cameraIcon = hasImages ? '📸' : '➕';
            const cameraClass = hasImages ? 'btn-camera-view' : 'btn-camera-add';

            // Thumbnail
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
        } 
        
        // --- TV RENDER ---
        else {
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

    // Catalog Sort: Photos first
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
        const owner = state.participants.find(p => p.id === g.ownerId);
        const ownerName = owner ? owner.name : "Unclaimed";
        
        // Image Logic
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

// --- 5. MOBILE & UTILS ---

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

// Auto Scroll (TV)
function renderTvAutoScroll(state) {
    window.currentScrollSpeed = state.settings.scrollSpeed !== undefined ? state.settings.scrollSpeed : 3;
    if (!scrollInterval && window.currentScrollSpeed > 0) initAutoScroll();
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

// File Upload
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
        if (res.ok) {
            alert('Photo uploaded! 📸'); 
            refreshState();
        } else {
            alert('Upload failed: ' + (await res.json()).error);
        }
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

// Helpers
function getActivePlayersList(state) {
    const limit = state.settings.activePlayerCount || 1;
    const active = [];

    // Victims get priority
    state.participants.filter(p => p.isVictim && !p.heldGiftId).forEach(v => {
         active.push({ player: v, type: 'steal' });
    });

    // Then Queue
    const queue = state.participants
        .filter(p => !p.isVictim && !p.heldGiftId && p.number >= state.currentTurn)
        .sort((a,b) => a.number - b.number);

    let slots = Math.max(0, limit - active.length);
    let i = 0;
    while (slots > 0 && i < queue.length) {
        active.push({ player: queue[i], type: 'turn' });
        slots--;
        i++;
    }
    return active;
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
        const url = window.location.href; 
        document.getElementById('joinUrlDisplay').innerText = url;
        const container = document.getElementById('qrcode');
        container.innerHTML = '';
        new QRCode(container, { text: url, width: 256, height: 256 });
        document.getElementById('overlay-qr').classList.remove('hidden');
    } else if (mode === 'catalog') {
        if (catalogOverlay) {
            catalogOverlay.classList.remove('hidden');
            refreshState();
        }
    }
}
