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

// 1. INITIALIZATION ON LOAD
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('game');
    const mode = params.get('mode');

    // DETECT MOBILE
    if (mode === 'mobile') {
        isMobileMode = true;
        document.body.classList.add('mobile-view'); // Apply CSS class
        console.log("📱 Mobile Mode Active");
    }

    // AUTO-JOIN
    if (gameId) {
        document.getElementById('gameIdInput').value = gameId;
        joinGame(gameId); 
    }
});

// 2. JOIN GAME LOGIC
function joinGame(urlGameId = null) {
    const inputId = document.getElementById('gameIdInput').value.trim();
    const gameId = urlGameId || inputId;
    
    if(!gameId) return;

    currentGameId = gameId;
    
    if (isMobileMode) loadBookmarks(gameId);

    // Switch UI
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    updateDebugFooter("Connecting...", gameId);

    // 3. SOCKET LOGIC
    if (socket) socket.disconnect(); // Clean slate if retrying
    socket = io();
    
    // ON CONNECT / RECONNECT
    socket.on('connect', () => {
        console.log("🟢 Socket Connected");
        updateDebugFooter("Live Sync Active", gameId);
        
        // CRITICAL: Tell server we are in this room
        socket.emit('joinGame', gameId);
        
        // Refresh data immediately
        refreshState();

        // Clear error banner
        const banner = document.getElementById('activePlayerBanner');
        if (banner && banner.innerText.includes("Connection Lost")) {
            banner.innerHTML = "Reconnected!"; 
            setTimeout(() => refreshState(), 1000);
        }
    });

    socket.on('stateUpdate', (state) => {
        renderView(state);
    });

    socket.on('disconnect', () => {
        console.warn("🔴 Socket Disconnected");
        updateDebugFooter("Connection Lost! Retrying...", gameId);
        const banner = document.getElementById('activePlayerBanner');
        if(banner) {
            banner.innerHTML = "⚠️ Connection Lost... Retrying";
            banner.style.background = "#b91c1c";
        }
    });

    // TV-Only Listeners
    if (!isMobileMode) {
        socket.on('settingsPreview', (settings) => {
            if (settings.scrollSpeed !== undefined) {
                window.currentScrollSpeed = parseInt(settings.scrollSpeed);
                if (!scrollInterval && window.currentScrollSpeed > 0) initAutoScroll();
            }
            if (settings.tvMode) handleTvMode(settings.tvMode);
        });

        // Listen for direct TV Mode commands
        socket.on('tvMode', handleTvMode);
    }

    // Initial Fetch (Fallback if socket is slow)
    refreshState();
}

async function refreshState() {
    if(!currentGameId) return;
    try {
        const res = await fetch(`/api/${currentGameId}/state`);
        if(res.ok) {
            const state = await res.json();
            renderView(state);
        }
    } catch(e) { console.error(e); }
}

// --- RENDER LOGIC ---

function renderView(state) {
    // 1. TV AUTO SCROLL (Only if NOT mobile)
    if (!isMobileMode) {
        window.currentScrollSpeed = state.settings.scrollSpeed !== undefined ? state.settings.scrollSpeed : 3;
        if (!scrollInterval) initAutoScroll();
    }

    // 2. HEADER
    const banner = document.getElementById('activePlayerBanner');
    const activeP = state.participants.find(p => 
        (state.activeVictimId && p.id === state.activeVictimId) || 
        (!state.activeVictimId && p.number === state.currentTurn)
    );
    
    if (activeP) {
        // Setup Timer Data
        const duration = state.settings.turnDurationSeconds || 60;
        const startTime = state.timerStart || Date.now();
        banner.dataset.start = startTime;
        banner.dataset.duration = duration;
        banner.dataset.active = "true";
        
        // Simple banner text logic
        let bannerHtml = `<div>Turn #${activeP.number}: ${activeP.name}</div>`;
        if (state.activeVictimId && activeP.id === state.activeVictimId) {
             banner.style.background = "#dc2626"; // Red
             bannerHtml = `<div>🚨 STEAL! ${activeP.name} is UP! 🚨</div>`;
        } else {
             banner.style.background = "#2563eb"; // Blue
        }
        // Only show timer on TV
        if(!isMobileMode) bannerHtml += `<div class="tv-timer" style="font-size:0.5em; margin-top:10px;">--:--</div>`;
        banner.innerHTML = bannerHtml;

    } else {
        banner.innerHTML = "Waiting...";
        banner.style.background = "#374151";
    }

    // 3. GIFTS
    const gList = document.getElementById('giftList');
    
    // SMART SORT
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

    if (sortedGifts.length === 0) {
        gList.innerHTML = '<li style="color:#6b7280; text-align:center;">No gifts yet</li>';
    } else {
        gList.innerHTML = sortedGifts.map(g => {
            const owner = state.participants.find(p => p.id === g.ownerId);
            const ownerName = owner ? owner.name : 'Unknown';
            const isStarred = myBookmarks.has(g.id);

            let badge = '';
            if (g.isFrozen) badge = '<span class="badge" style="background:#374151;">🔒 LOCKED</span>';
            else badge = `<span class="badge">${g.stealCount}/3 Steals</span>`;

            // Star Click Handler
            // Note: We use onclick attribute for simplicity here
            const starIcon = isMobileMode 
                ? `<span class="star-icon" onclick="toggleBookmark('${g.id}')">${isStarred ? '⭐' : '☆'}</span>` 
                : '';
            
            const rowClass = isStarred ? 'highlight-gift' : '';

            return `
                <li class="${rowClass}" style="${g.isFrozen ? 'opacity:0.5' : ''}">
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${starIcon}
                        <span style="font-weight:600;">${g.description}</span>
                    </div>
                    <span class="owner-col">Held by <b>${ownerName}</b></span>
                    ${badge}
                </li>
            `;
        }).join('');
    }
}

// --- BOOKMARK LOGIC ---
function loadBookmarks(gameId) {
    const saved = localStorage.getItem(`bookmarks_${gameId}`);
    if (saved) {
        myBookmarks = new Set(JSON.parse(saved));
    }
}

// MAKE GLOBAL SO HTML CAN CALL IT
window.toggleBookmark = function(giftId) {
    console.log("Toggling bookmark", giftId);
    if (myBookmarks.has(giftId)) {
        myBookmarks.delete(giftId);
    } else {
        myBookmarks.add(giftId);
    }
    localStorage.setItem(`bookmarks_${currentGameId}`, JSON.stringify([...myBookmarks]));
    refreshState(); 
}

// --- SCROLL LOGIC ---
function initAutoScroll() {
    if (scrollInterval) clearInterval(scrollInterval);
    
    scrollInterval = setInterval(() => {
        if (isMobileMode) return; // DOUBLE CHECK

        const container = document.querySelector('.card'); 
        if (!container) return;
        
        if (!window.currentScrollSpeed || window.currentScrollSpeed <= 0) return;
        if (container.scrollHeight <= container.clientHeight) return;

        if (pauseCounter > 0) {
            pauseCounter--;
            return;
        }

        if (virtualScrollY === 0 && container.scrollTop > 0) virtualScrollY = container.scrollTop;

        const speed = window.currentScrollSpeed * 0.15; 
        virtualScrollY += speed;
        container.scrollTop = virtualScrollY;

        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 5) {
            pauseCounter = 100; 
            virtualScrollY = 0; 
            container.scrollTop = 0; 
        }
    }, 30);
}

// Timer Loop
setInterval(() => {
    if(!isMobileMode) updateScoreboardTimer();
}, 100);

function updateScoreboardTimer() {
    const banner = document.getElementById('activePlayerBanner');
    if (!banner || banner.dataset.active !== "true") return;

    const start = parseInt(banner.dataset.start);
    const duration = parseInt(banner.dataset.duration) * 1000;
    const now = Date.now();
    const remaining = Math.max(0, (duration - (now - start)) / 1000);
    
    const timerDisplay = banner.querySelector('.tv-timer');
    if (timerDisplay) {
        const m = Math.floor(remaining / 60);
        const s = Math.floor(remaining % 60);
        timerDisplay.innerText = `${m}:${s.toString().padStart(2, '0')}`;
    }

    const body = document.body;
    if (remaining <= 0) {
        banner.style.background = "#000"; 
        body.style.animation = "none";
        if(timerDisplay) timerDisplay.innerText = "TIME'S UP!";
    } else if (remaining <= 10) {
        body.style.animation = "flashRed 0.5s infinite";
    } else if (remaining <= 30) {
        body.style.animation = "flashOrange 2s infinite";
    } else {
        body.style.animation = "none";
    }
}

function handleTvMode(mode) {
    document.getElementById('overlay-rules').classList.add('hidden');
    document.getElementById('overlay-qr').classList.add('hidden');
    
    if (mode === 'rules') {
        document.getElementById('overlay-rules').classList.remove('hidden');
    } else if (mode === 'qr') {
        generateQrCode();
        document.getElementById('overlay-qr').classList.remove('hidden');
    }
}

function updateDebugFooter(status, gameId) {
    const footer = document.getElementById('debugFooter');
    if(footer) footer.innerHTML = `Game: <b>${gameId}</b> | Status: ${status}`;
}

function generateQrCode() {
    const url = window.location.href; 
    document.getElementById('joinUrlDisplay').innerText = url;
    const container = document.getElementById('qrcode');
    container.innerHTML = '';
    new QRCode(container, {
        text: url,
        width: 256,
        height: 256,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}