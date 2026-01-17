/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

let socket;
let currentGameId = null;

document.addEventListener('DOMContentLoaded', () => {
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
});

async function joinGame() {
    const gameId = document.getElementById('gameIdInput').value.trim();
    if(!gameId) return alert("Please enter a Game ID");

    const res = await fetch('/api/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ gameId })
    });

    if(res.ok) {
        currentGameId = gameId;
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        document.getElementById('displayGameId').innerText = gameId;
        initSocket(gameId);
        refreshState();
    }
}

function initSocket(gameId) {
    socket = io();
    socket.emit('joinGame', gameId);
    socket.on('stateUpdate', (state) => {
        console.log("⚡ Update:", state);
        render(state);
    });
}

async function refreshState() {
    const res = await fetch(`/api/${currentGameId}/state`);
    const state = await res.json();
    render(state);
}

function render(state) {
    // 1. Header
    document.getElementById('displayGameId').innerHTML = 
        `${state.id} <span style="font-size:0.6em; color:#666;">(Turn #${state.currentTurn})</span>`;

    // 2. Participants
    const pList = document.getElementById('participantList');
    pList.innerHTML = '';
    const sortedParticipants = state.participants.sort((a,b) => a.number - b.number);

    sortedParticipants.forEach(p => {
        const isActiveVictim = state.activeVictimId && p.id === state.activeVictimId;
        const isTurnOwner = !state.activeVictimId && p.number === state.currentTurn;
        const isTrulyActive = isActiveVictim || isTurnOwner;

        const li = document.createElement('li');
        if (isTrulyActive) {
            li.style.border = "2px solid var(--primary)";
            li.style.background = "#eff6ff";
        }

        let statusIcon = '⏳';
        if (p.heldGiftId) statusIcon = '🎁';
        if (isTrulyActive) statusIcon = '🔴';

        let html = `<span><b>#${p.number}</b> ${p.name}</span>`;
        
        if (isTrulyActive && !p.heldGiftId) {
            html += `
                <div class="action-buttons">
                    <button onclick="promptOpenGift()" class="btn-green">🎁 Open New</button>
                    <button onclick="showStealOptions()" class="btn-orange">😈 Steal</button>
                </div>
            `;
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
            
            // Find active player to check Forbidden status
            const activeP = state.participants.find(p => 
                (state.activeVictimId && p.id === state.activeVictimId) || 
                (!state.activeVictimId && p.number === state.currentTurn)
            );
            const isForbidden = activeP && activeP.forbiddenGiftId === g.id;

            const itemStyle = g.isFrozen ? 'opacity: 0.5; background: #f1f5f9;' : '';
            
            let statusBadge = '';
            if (g.isFrozen) statusBadge = `<span class="badge" style="background:#333; color:#fff;">🔒 LOCKED</span>`;
            else if (isForbidden) statusBadge = `<span class="badge" style="background:#fde68a; color:#92400e;">🚫 NO TAKE-BACKS</span>`;
            else statusBadge = g.stealCount > 0 ? `<span class="badge stolen">${g.stealCount}/3 Steals</span>` : `<span class="badge">0/3 Steals</span>`;

            const showStealBtn = !g.isFrozen && !isForbidden && activeP && !activeP.heldGiftId;

            return `
                <li style="${itemStyle}">
                    <div>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <span style="font-weight:500;">${g.description}</span>
                            <button onclick="editGift('${g.id}', '${g.description.replace(/'/g, "\\'")}')" style="background:none; border:none; padding:0; cursor:pointer; font-size:1em;" title="Edit Name">✏️</button>
                        </div>
                        <div style="font-size:0.8em; color:#666;">Held by <b>${ownerName}</b></div>
                    </div>
                    <div style="text-align:right;">
                        ${statusBadge}
                        ${showStealBtn ? `<button onclick="attemptSteal('${g.id}', '${g.description.replace(/'/g, "\\'")}')" class="btn-orange" style="font-size:0.7em; margin-left:5px;">Steal</button>` : ''}
                    </div>
                </li>
            `;
        }).join('');
    }
}

// --- ACTIONS ---
async function promptOpenGift() {
    const description = prompt("What is inside the gift?");
    if (!description) return;
    await fetch(`/api/${currentGameId}/open-new`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ description })
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
    if(!confirm(`Are you sure you want to steal the ${description}?`)) return;
    const res = await fetch(`/api/${currentGameId}/steal`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ giftId })
    });
    if(!res.ok) {
        const data = await res.json();
        alert("Error: " + data.error);
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

async function clearDb() {
    if(!confirm("Are you sure? This deletes all players and gifts.")) return;
    await fetch(`/api/${currentGameId}/reset`, { method: 'POST' });
    location.reload();
}

function showStealOptions() {
    document.getElementById('giftList').scrollIntoView({behavior: 'smooth'});
    // Flash the list to draw attention
    const list = document.getElementById('giftList');
    list.style.transition = "background 0.2s";
    list.style.background = "#fff7ed";
    setTimeout(() => list.style.background = "transparent", 300);
}

document.getElementById('gameIdInput').addEventListener('keypress', e => e.key === 'Enter' && joinGame());
document.getElementById('pName').addEventListener('keypress', e => e.key === 'Enter' && addParticipant());
