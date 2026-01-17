/*
 * Elephant Exchange (TV Mode)
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
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');

    socket = io();
    socket.emit('joinGame', gameId);
    
    socket.on('stateUpdate', (state) => {
        renderTV(state);
    });

    // Initial fetch
    fetch(`/api/${gameId}/state`)
        .then(res => res.json())
        .then(state => renderTV(state));
}

function renderTV(state) {
    // 1. FIND ACTIVE PLAYER
    const activeP = state.participants.find(p => 
        (state.activeVictimId && p.id === state.activeVictimId) || 
        (!state.activeVictimId && p.number === state.currentTurn)
    );

    // 2. UPDATE BANNER
    const banner = document.getElementById('activePlayerBanner');
    if (activeP) {
        if (state.activeVictimId && activeP.id === state.activeVictimId) {
             banner.style.background = "#dc2626"; // Red for Victim
             banner.innerHTML = `🚨 STEAL! ${activeP.name} is UP! 🚨`;
        } else {
             banner.style.background = "#2563eb"; // Blue for Normal Turn
             banner.innerHTML = `Current Turn: #${activeP.number} ${activeP.name}`;
        }
    } else {
        banner.innerHTML = "Game Over / Paused";
        banner.style.background = "#374151";
    }

    // 3. RENDER PLAYERS (Who holds what?)
    const pList = document.getElementById('participantList');
    pList.innerHTML = state.participants
        .sort((a,b) => a.number - b.number)
        .map(p => {
            const isActive = activeP && p.id === activeP.id;
            const giftDesc = p.heldGiftId 
                ? state.gifts.find(g => g.id === p.heldGiftId)?.description 
                : '<span style="color:#6b7280; font-style:italic;">Waiting...</span>';
            
            // Highlight Active
            const style = isActive ? 'background: rgba(37, 99, 235, 0.2); border: 2px solid #3b82f6;' : '';

            return `
                <li style="${style}">
                    <span><b>#${p.number}</b> ${p.name}</span>
                    <span style="color:#fbbf24; font-weight:bold;">${p.heldGiftId ? '🎁 ' + giftDesc : ''}</span>
                </li>
            `;
        }).join('');

    // 4. RENDER GIFTS (Steal Counts)
    const gList = document.getElementById('giftList');
    // Sort: Frozen (bottom), then Most Stolen (top)
    const sortedGifts = state.gifts.sort((a,b) => {
        if (a.isFrozen !== b.isFrozen) return a.isFrozen - b.isFrozen;
        return b.stealCount - a.stealCount;
    });

    gList.innerHTML = sortedGifts.map(g => {
        const owner = state.participants.find(p => p.id === g.ownerId);
        
        let badge = '';
        if (g.isFrozen) badge = '<span class="badge" style="background:#374151; color:#9ca3af">🔒 LOCKED</span>';
        else badge = `<span class="badge" style="background:#4b5563; color:white">${g.stealCount}/3 Steals</span>`;

        return `
            <li style="${g.isFrozen ? 'opacity:0.5' : ''}">
                <span>${g.description}</span>
                ${badge}
            </li>
        `;
    }).join('');
}