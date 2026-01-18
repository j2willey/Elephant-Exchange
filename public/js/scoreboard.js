/*
 * Elephant Exchange (Scoreboard & Mobile)
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

let socket;
let currentGameId = null;
let isMobileMode = false;
let myBookmarks = new Set(); 
let scrollInterval;
let pauseCounter = 0;
let virtualScrollY = 0; 

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('game');
    const mode = params.get('mode');

    if (mode === 'mobile') {
        isMobileMode = true;
        document.body.classList.add('mobile-view');
    } else {
        document.body.classList.add('tv-mode');
    }

    if (gameId) {
        document.getElementById('gameIdInput').value = gameId;
        joinGame(gameId);
    }
});

function joinGame(urlGameId = null) {
    const inputId = document.getElementById('gameIdInput').value.trim();
    const gameId = urlGameId || inputId;
    if(!gameId) return;

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

function renderView(state) {
    // 1. AUTO SCROLL (TV Only)
    if (!isMobileMode) {
        window.currentScrollSpeed = state.settings.scrollSpeed !== undefined ? state.settings.scrollSpeed : 3;
        if (!scrollInterval) initAutoScroll();
    }

    // 2. ACTIVE PLAYER TABLE
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
                </tr>
            `;
        }).join('');
        tableHtml += `</table>`;
        banner.innerHTML = tableHtml;
    } else {
        banner.innerHTML = "<div style='padding:20px;'>Waiting...</div>";
        banner.style.background = "#374151";
    }

    // 3. GIFTS LIST
    const gList = document.getElementById('giftList');
    
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

    // --- RENDER LOGIC START ---
    let html = '';

    // STEP A: Mobile Header (Always render first)
    if (isMobileMode) {
        html += `
        <div class="mobile-table-header">
            <div>⭐</div>
            <div>Gift</div>
            <div style="text-align:center">#</div>
            <div>Holder</div>
            <div style="text-align:center">Steals</div> 
        </div>
        `;
    }

    // STEP B: Check Empty
    if (sortedGifts.length === 0) {
        html += '<li style="color:#6b7280; text-align:center; padding: 20px;">No gifts yet</li>';
        gList.innerHTML = html;
        return; // Stop here, but preserve the header in 'html'
    }

    // STEP C: Render Items (If not empty)
    const isStatsEnabled = state.settings.showVictimStats;

    if (isMobileMode) {
        // Mobile Rows
        html += sortedGifts.map(g => {
            const owner = state.participants.find(p => p.id === g.ownerId);
            let ownerName = owner ? owner.name : '?';
            
            if (isStatsEnabled && owner && owner.timesStolenFrom > 0) {
                ownerName += ` <span style="color:#ef4444; font-size:0.8em;">💔${owner.timesStolenFrom}</span>`;
            }
            
            const isStarred = myBookmarks.has(g.id);
            const match = g.description.match(/^(.*?) \(Item (\d+)\)$/);
            const giftName = match ? match[1] : g.description;
            const giftNum  = match ? match[2] : ''; 
            
            const starChar = isStarred ? '⭐' : '☆';
            const rowClass = isStarred ? 'highlight-gift' : '';
            const max = state.settings.maxSteals || 3;
            let stealBadge = `<span class="badge">${g.stealCount}/${max}</span>`;
            if (g.isFrozen) stealBadge = `<span class="badge locked">🔒</span>`;
            
            return `
            <li class="${rowClass}" onclick="toggleBookmark('${g.id}')">
                <div class="col-star"><span class="star-icon">${starChar}</span></div>
                <div class="col-gift">${giftName}</div>
                <div class="col-num">${giftNum}</div>
                <div class="col-held">${ownerName}</div>
                <div class="col-stl">${stealBadge}</div>
            </li>
            `;
        }).join('');
    } else {
        // TV Rows
        html += sortedGifts.map(g => {
            const owner = state.participants.find(p => p.id === g.ownerId);
            let ownerName = owner ? owner.name : 'Unknown';
            
            if (isStatsEnabled && owner && owner.timesStolenFrom > 0) {
                ownerName += ` <span style="color:#ef4444; font-size:0.8em; margin-left:5px;">💔${owner.timesStolenFrom}</span>`;
            }

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
            </li>
            `;
        }).join('');
    }

    gList.innerHTML = html;
}

// Helper: Determine who is active for the table
function getActivePlayersList(state) {
    const limit = state.settings.activePlayerCount || 1;
    const active = [];

    // 1. VICTIMS (Fix: Don't rely on state.activeVictimId)
    // We look for ANYONE who is a victim and waiting for a gift
    state.participants.filter(p => p.isVictim && !p.heldGiftId).forEach(v => {
         active.push({ player: v, type: 'steal' });
    });

    // 2. QUEUE
    const queue = state.participants
        .filter(p => !p.isVictim && !p.heldGiftId && p.number >= state.currentTurn)
        .sort((a,b) => a.number - b.number);

    // Calculate how many queue slots are left after victims
    const victimCount = active.length;
    let slotsAvailable = limit - victimCount;
    
    // Safety check (prevent negative slots if lots of victims)
    if (slotsAvailable < 0) slotsAvailable = 0;

    let i = 0;
    while (slotsAvailable > 0 && i < queue.length) {
        active.push({ player: queue[i], type: 'turn' });
        slotsAvailable--;
        i++;
    }
    return active;
}

// --- TIMER LOOP ---
setInterval(() => {
    const timers = document.querySelectorAll('.dynamic-timer');
    timers.forEach(el => {
        const start = parseInt(el.dataset.start);
        const duration = parseInt(el.dataset.duration) * 1000;
        if(!start || !duration) return;
        const now = Date.now();
        const remaining = Math.max(0, (duration - (now - start)) / 1000);
        const m = Math.floor(remaining / 60);
        const s = Math.floor(remaining % 60);
        el.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        if(remaining <= 0) el.innerText = "TIME'S UP!";
    });
}, 100);

// --- UTILS ---
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
    if (mode === 'rules') document.getElementById('overlay-rules').classList.remove('hidden');
    else if (mode === 'qr') { generateQrCode(); document.getElementById('overlay-qr').classList.remove('hidden'); }
}
function generateQrCode() {
    const url = window.location.href; 
    document.getElementById('joinUrlDisplay').innerText = url;
    const container = document.getElementById('qrcode');
    container.innerHTML = '';
    new QRCode(container, { text: url, width: 256, height: 256 });
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