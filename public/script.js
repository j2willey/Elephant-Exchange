// public/script.js

let socket;
let currentGameId = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if we have a game ID in the URL or LocalStorage in the future
    // For now, just wait for login
    // 2. NEW: Setup UI Scaler
    const scaleSlider = document.getElementById('uiScale');
    
    // Load saved scale from previous session
    const savedScale = localStorage.getItem('elephantScale');
    if (savedScale) {
        document.body.style.zoom = savedScale;
        if(scaleSlider) scaleSlider.value = savedScale;
    }

    // Listen for changes
    if(scaleSlider) {
        scaleSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            document.body.style.zoom = val;
            localStorage.setItem('elephantScale', val);
        });
    }
});

// --- AUTH & SETUP ---
async function joinGame() {
    const gameId = document.getElementById('gameIdInput').value.trim();
    if(!gameId) return alert("Please enter a Game ID");

    // 1. Tell Server to Init Game
    const res = await fetch('/api/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ gameId })
    });

    if(res.ok) {
        currentGameId = gameId;
        // Switch Screens
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        document.getElementById('displayGameId').innerText = gameId;
        
        // Connect Realtime
        initSocket(gameId);
        refreshState();
    }
}

function initSocket(gameId) {
    socket = io();
    socket.emit('joinGame', gameId);
    
    // Listen for server updates
    socket.on('stateUpdate', (state) => {
        console.log("⚡ Update received:", state);
        render(state);
    });
}

// --- DATA HANDLING ---
async function refreshState() {
    const res = await fetch(`/api/${currentGameId}/state`);
    const state = await res.json();
    render(state);
}

// --- RENDER LOGIC ---
function render(state) {
    // 1. Header & Turn Info
    document.getElementById('displayGameId').innerHTML = 
        `${state.id} <span style="font-size:0.6em; color:#666;">(Turn #${state.currentTurn})</span>`;

    // 2. Render Participants
    const pList = document.getElementById('participantList');
    pList.innerHTML = '';

    // Sort: 1, 2, 3...
    const sortedParticipants = state.participants.sort((a,b) => a.number - b.number);

    sortedParticipants.forEach(p => {
        const isCurrentTurn = (p.number === state.currentTurn);
        const li = document.createElement('li');
        
        // Status Icons
        let statusIcon = '⏳'; // Default waiting
        if (p.heldGiftId) statusIcon = '🎁'; // Has gift
        if (isCurrentTurn) statusIcon = '🔴'; // ACTIVE PLAYER

        // Highlight Active Player
        if (isCurrentTurn) {
            li.style.border = "2px solid var(--primary)";
            li.style.background = "#eff6ff";
        }

        // HTML Content
        let html = `<span><b>#${p.number}</b> ${p.name}</span>`;
        
        // If this is the ACTIVE player, show the Action Buttons (Open/Steal)
        // AND ensuring they don't already have a gift (unless we support multi-gift later)
        if (isCurrentTurn && !p.heldGiftId) {
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

    // 3. Render Gifts
    const gList = document.getElementById('giftList');
    if (state.gifts.length === 0) {
        gList.innerHTML = `<li style="color:#ccc; justify-content:center;">No gifts revealed yet</li>`;
    } else {
        gList.innerHTML = state.gifts.map(g => {
            // Find who owns this gift
            const owner = state.participants.find(p => p.id === g.ownerId);
            const ownerName = owner ? owner.name : 'Unknown';
            
            // Format the badge text
            let badgeHtml = '';
            if (g.ownerId) {
                // If stolen, show count. If just owned, show owner name.
                const stealText = g.stealCount > 0 ? `Stolen ${g.stealCount}x` : '';
                badgeHtml = `
                    <span style="font-size:0.85em; color:#666; margin-right:5px;">Held by <b>${ownerName}</b></span>
                    <span class="badge ${g.stealCount > 0 ? 'stolen' : ''}">${stealText}</span>
                `;
            } else {
                badgeHtml = '<span class="badge">Wrapped</span>';
            }

            return `
                <li>
                    <span>${g.description}</span>
                    <div style="text-align:right;">${badgeHtml}</div>
                </li>
            `;
        }).join('');
    }
}

// --- ACTIONS ---

// 1. OPEN NEW GIFT (Combined Create + Assign)
async function promptOpenGift() {
    const description = prompt("What is inside the gift?");
    if (!description) return;

    await fetch(`/api/${currentGameId}/open-new`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ description })
    });
}

// 2. ADD PARTICIPANT
async function addParticipant() {
    const numInput = document.getElementById('pNumber');
    const nameInput = document.getElementById('pName');
    
    if(!nameInput.value && !numInput.value) return;

    await fetch(`/api/${currentGameId}/participants`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
            name: nameInput.value, 
            number: numInput.value 
        })
    });

    nameInput.value = '';
    numInput.value = '';
    nameInput.focus();
}

// 3. CLEAR DB (Reset Game)
async function clearDb() {
    if(!confirm("Are you sure? This deletes all players and gifts.")) return;
    
    await fetch(`/api/${currentGameId}/reset`, { method: 'POST' });
    location.reload(); // Refresh page to clear local state
}

// 4. Steal (Stub for now)
function showStealOptions() {
    alert("Steal logic coming next! This will open a picker to select a victim.");
}

// Global enter key handlers
document.getElementById('gameIdInput').addEventListener('keypress', e => e.key === 'Enter' && joinGame());
document.getElementById('pName').addEventListener('keypress', e => e.key === 'Enter' && addParticipant());