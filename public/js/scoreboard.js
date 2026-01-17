/*
 * Elephant Exchange (Scoreboard)
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

let socket;
let currentGameId = null;

// Auto-join if URL has ?game=ID
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('game');
    
    if (gameId) {
        document.getElementById('gameIdInput').value = gameId;
        joinGame();
    }
});

function joinGame() {
    const gameId = document.getElementById('gameIdInput').value.trim();
    if(!gameId) return;

    currentGameId = gameId;
    
    // Switch UI
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    updateDebugFooter("Connecting...", gameId);

    // Socket Connection
    socket = io();
    socket.emit('joinGame', gameId);
    
    socket.on('connect', () => {
        updateDebugFooter("Socket Connected", gameId);
    });

    socket.on('stateUpdate', (state) => {
        renderTV(state);
        updateDebugFooter("Live Sync Active", gameId);
    });

    socket.on('settingsPreview', (settings) => {
        if (settings.scrollSpeed !== undefined) {
            window.currentScrollSpeed = parseInt(settings.scrollSpeed);
            // If it was stopped (0) and is now moving, kickstart the loop
            if (!scrollInterval && window.currentScrollSpeed > 0) initAutoScroll();
        }
        // 2. Handle TV Mode (NEW)
        if (settings.tvMode) {
            document.getElementById('overlay-rules').classList.add('hidden');
            document.getElementById('overlay-qr').classList.add('hidden');
            
            if (settings.tvMode === 'rules') {
                document.getElementById('overlay-rules').classList.remove('hidden');
            } else if (settings.tvMode === 'qr') {
                generateQrCode();
                document.getElementById('overlay-qr').classList.remove('hidden');
            }
        }

    });

    // NEW: Listen for TV Mode changes
    socket.on('tvMode', (mode) => {
        // Hide all first
        document.getElementById('overlay-rules').classList.add('hidden');
        document.getElementById('overlay-qr').classList.add('hidden');

        // Show selected
        if (mode === 'rules') {
            document.getElementById('overlay-rules').classList.remove('hidden');
        } else if (mode === 'qr') {
            generateQrCode(); // Helper function below
            document.getElementById('overlay-qr').classList.remove('hidden');
        }
        // mode === 'game' just keeps everything hidden
    });

    socket.on('disconnect', () => {
        updateDebugFooter("Socket Disconnected!", gameId);
        const banner = document.getElementById('activePlayerBanner');
        if(banner) {
            banner.innerText = "⚠️ Connection Lost";
            banner.style.background = "#b91c1c";
            banner.dataset.active = "false";
        }
    });

    // Initial Fetch
    fetch(`/api/${gameId}/state`)
        .then(res => {
            if (!res.ok) throw new Error("Game not found");
            return res.json();
        })
        .then(state => renderTV(state))
        .catch(err => {
            console.error(err);
            const banner = document.getElementById('activePlayerBanner');
            if(banner) banner.innerText = "Game Not Found";
            updateDebugFooter("Error: Game Not Found", gameId);
        });
}

function updateDebugFooter(status, gameId) {
    const footer = document.getElementById('debugFooter');
    if(footer) footer.innerHTML = `Game: <b>${gameId}</b> | Status: ${status}`;
}

// --- RENDER LOGIC ---

function renderTV(state) {
    // Save speed globally for the scroller
    window.currentScrollSpeed = state.settings.scrollSpeed !== undefined ? state.settings.scrollSpeed : 3;
    
    // START SCROLLER IF NOT STARTED
    if (!scrollInterval) initAutoScroll();

    // 1. FIND ACTIVE PLAYER
    const activeP = state.participants.find(p => 
        (state.activeVictimId && p.id === state.activeVictimId) || 
        (!state.activeVictimId && p.number === state.currentTurn)
    );

    // 2. UPDATE BANNER & TIMER DATA
    const banner = document.getElementById('activePlayerBanner');
    
    if (activeP) {
        // Setup Timer Data
        const duration = state.settings.turnDurationSeconds || 60;
        const startTime = state.timerStart || Date.now();
        banner.dataset.start = startTime;
        banner.dataset.duration = duration;
        banner.dataset.active = "true";

        if (state.activeVictimId && activeP.id === state.activeVictimId) {
             banner.style.background = "#dc2626"; // Red
             banner.innerHTML = `<div>🚨 STEAL! ${activeP.name} is UP! 🚨</div><div class="tv-timer" style="font-size:0.5em; margin-top:10px;">--:--</div>`;
        } else {
             banner.style.background = "#2563eb"; // Blue
             banner.innerHTML = `<div>Turn #${activeP.number}: ${activeP.name}</div><div class="tv-timer" style="font-size:0.5em; margin-top:10px;">--:--</div>`;
        }
    } else {
        banner.dataset.active = "false";
        banner.innerHTML = "Waiting for game start...";
        banner.style.background = "#374151";
        document.body.style.animation = "none";
    }

    // 3. RENDER GIFTS (The Master List)
    const gList = document.getElementById('giftList');
    
    const sortedGifts = state.gifts.sort((a,b) => {
        if (a.isFrozen !== b.isFrozen) return a.isFrozen - b.isFrozen;
        return b.stealCount - a.stealCount;
    });

    if (sortedGifts.length === 0) {
        gList.innerHTML = '<li style="color:#6b7280; text-align:center; display:block;">No gifts opened yet</li>';
    } else {
        gList.innerHTML = sortedGifts.map(g => {
            const owner = state.participants.find(p => p.id === g.ownerId);
            const ownerName = owner ? owner.name : 'Unknown';

            let badge = '';
            if (g.isFrozen) badge = '<span class="badge" style="background:#374151; color:#9ca3af">🔒 LOCKED</span>';
            else badge = `<span class="badge" style="background:#4b5563; color:white">${g.stealCount}/3 Steals</span>`;

            return `
                <li style="${g.isFrozen ? 'opacity:0.5' : ''}">
                    <span style="font-weight:600; color: white;">${g.description}</span>
                    <span class="owner-col">Held by <b>${ownerName}</b></span>
                    ${badge}
                </li>
            `;
        }).join('');
    }
}

// --- ANIMATION & SCROLL LOOP ---
let scrollInterval;
let pauseCounter = 0;
let virtualScrollY = 0; // The Accumulator! 🛡️

// Run loop at 60 FPS (approx 16ms)
setInterval(() => {
    updateScoreboardTimer();
    // We combine the loops for efficiency
}, 100); 

function initAutoScroll() {
    if (scrollInterval) clearInterval(scrollInterval);
    
    // Smoother scroll loop (30ms)
    scrollInterval = setInterval(() => {
        const container = document.querySelector('.card'); 
        if (!container) return;
        
        // 1. Check Settings
        if (!window.currentScrollSpeed || window.currentScrollSpeed <= 0) return;

        // 2. Detect if scrolling is needed
        if (container.scrollHeight <= container.clientHeight) return;

        // 3. Pause Logic
        if (pauseCounter > 0) {
            pauseCounter--;
            return;
        }

        // 4. Scroll Logic (with Accumulator)
        // Ensure we start from the current visual position if we just reset
        if (virtualScrollY === 0 && container.scrollTop > 0) {
             virtualScrollY = container.scrollTop;
        }

        // Speed Factor: 0.5px per tick (smoother) * Speed Setting
        const speed = window.currentScrollSpeed * 0.15; 
        virtualScrollY += speed;
        
        container.scrollTop = virtualScrollY;

        // 5. Bottom Detection
        // buffer of 5px to be safe
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 5) {
            pauseCounter = 100; // Pause ~3 seconds at bottom
            virtualScrollY = 0; // Reset accumulator
            container.scrollTop = 0; // SNAP back to top
        }
    }, 30);
}

function updateScoreboardTimer() {
    const banner = document.getElementById('activePlayerBanner');
    if (!banner || banner.dataset.active !== "true") return;

    const start = parseInt(banner.dataset.start);
    const duration = parseInt(banner.dataset.duration) * 1000;
    const now = Date.now();
    const remaining = Math.max(0, (duration - (now - start)) / 1000);
    
    // Update Text
    const timerDisplay = banner.querySelector('.tv-timer');
    if (timerDisplay) {
        const m = Math.floor(remaining / 60);
        const s = Math.floor(remaining % 60);
        timerDisplay.innerText = `${m}:${s.toString().padStart(2, '0')}`;
    }

    // ANIMATION LOGIC
    const body = document.body;
    
    if (remaining <= 0) {
        banner.style.background = "#000"; 
        body.style.animation = "none";
        if(timerDisplay) timerDisplay.innerText = "TIME'S UP!";
    } 
    else if (remaining <= 10) {
        body.style.animation = "flashRed 0.5s infinite";
    } 
    else if (remaining <= 30) {
        body.style.animation = "flashOrange 2s infinite";
    } 
    else {
        body.style.animation = "none";
    }
}

let qrCodeObj = null;

function generateQrCode() {
    const url = window.location.href; // The current URL (e.g. localhost:3000/scoreboard.html?game=xyz)

    // Update text
    document.getElementById('joinUrlDisplay').innerText = url;

    // Clear previous if exists
    const container = document.getElementById('qrcode');
    container.innerHTML = '';

    // Generate
    new QRCode(container, {
        text: url,
        width: 256,
        height: 256,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}