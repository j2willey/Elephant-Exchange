/*
 * ==============================================================================
 * ELEPHANT EXCHANGE - CATALOG
 * ==============================================================================
 * Handles the Catalog view.
 */



/* Visual Catalog Logic */
let socket;
let currentGameId = null;
let currentGiftId = null; // For modal context
let currentState = null;

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentGameId = params.get('game');

    if (!currentGameId) {
        // Fallback: Ask user or redirect (simple prompt for MVP)
        currentGameId = prompt("Enter Game ID to view catalog:");
        if (currentGameId) window.location.search = `?game=${currentGameId}`;
        return;
    }

    initSocket();
});

function initSocket() {
    socket = io();
    socket.on('connect', () => {
        document.getElementById('connectionStatus').innerText = "🟢 Live";
        socket.emit('joinGame', currentGameId);
        fetchState();
    });

    socket.on('stateUpdate', (state) => {
        renderGrid(state);
    });
}

async function fetchState() {
    try {
        const res = await fetch(`/api/${currentGameId}/state`);
        if (res.ok) renderGrid(await res.json());
    } catch (e) { console.error(e); }
}

function renderGrid(state) {
    currentState = state;

    if (window.applyTheme) applyTheme(state.settings);

    const grid = document.getElementById('catalogGrid');

    const gifts = state.gifts.sort((a,b) => {
        const aHas = (a.images && a.images.length > 0) ? 1 : 0;
        const bHas = (b.images && b.images.length > 0) ? 1 : 0;
        return bHas - aHas || a.id.localeCompare(b.id);
    });

    if (gifts.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center;">No gifts found.</div>';
        return;
    }

    grid.innerHTML = gifts.map(g => {
        const owner = state.participants.find(p => p.id === g.ownerId);
        const ownerName = owner ? owner.name : "Unclaimed";

        // DATA CLEANUP
        let mainName = g.name;
        let subDesc = g.description;
        if (String(mainName) === '{}' || String(mainName) === '[object Object]') mainName = null;
        if (String(subDesc) === '{}' || String(subDesc) === '[object Object]') subDesc = null;
        if (!mainName && subDesc) { mainName = subDesc; subDesc = null; }
        else if (!mainName && !subDesc) { mainName = "Mystery Gift"; }

        // Determine Hero Image
        let imgHtml = `<div class="card-placeholder">🐘</div>`;
        if (g.images && g.images.length > 0) {
            const heroId = g.primaryImageId || g.images[0].id;
            const imgObj = g.images.find(i => i.id === heroId) || g.images[0];
            imgHtml = `<img src="${imgObj.path}" class="card-img" alt="Gift">`;

            if (g.images.length > 1) {
                imgHtml += `<div style="position:absolute; bottom:10px; right:10px; background:rgba(0,0,0,0.7); color:white; padding:2px 8px; border-radius:10px; font-size:0.8rem;">📸 ${g.images.length}</div>`;
            }
        }

        let statusBadge = `<span class="card-badge" style="background:#10b981;">Safe</span>`;
        if (g.isFrozen) statusBadge = `<span class="card-badge" style="background:#374151;">🔒 Locked</span>`;
        else if (g.stealCount > 0) statusBadge = `<span class="card-badge" style="background:#f59e0b;">Steals: ${g.stealCount}</span>`;

        return `
            <div class="gift-card" onclick="openModal('${g.id}')">
                <div class="card-image-container">
                    ${imgHtml}
                </div>
                <div class="card-details">
                    <div class="card-title">${mainName}</div>
                    ${subDesc ? `<div style="font-size:0.9rem; color:#6b7280; margin-bottom:5px;">${subDesc}</div>` : ''}
                    <div class="card-meta">
                        <span>👤 ${ownerName}</span>
                        ${statusBadge}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// --- MODAL LOGIC ---

window.openModal = function(giftId) {
    currentGiftId = giftId;
    const gift = currentState.gifts.find(g => g.id === giftId);
    if (!gift) return;

    document.getElementById('modalTitle').innerText = gift.description;

    // Render Gallery
    updateModalGallery(gift);

    document.getElementById('galleryModal').style.display = 'flex';
}

window.closeModal = function() {
    document.getElementById('galleryModal').style.display = 'none';
    currentGiftId = null;
}

function updateModalGallery(gift) {
    const hero = document.getElementById('heroImage');
    const place = document.getElementById('heroPlaceholder');
    const strip = document.getElementById('thumbStrip');

    strip.innerHTML = '';

    if (!gift.images || gift.images.length === 0) {
        hero.style.display = 'none';
        place.style.display = 'flex';
    } else {
        place.style.display = 'none';
        hero.style.display = 'block';

        // Show primary first
        const primary = gift.images.find(i => i.id === gift.primaryImageId) || gift.images[0];
        hero.src = primary.path;

        // Thumbs
        gift.images.forEach(img => {
            const thumb = document.createElement('img');
            thumb.src = img.path;
            thumb.className = 'thumb';
            if (img.path === hero.src) thumb.classList.add('active');

            thumb.onclick = () => {
                hero.src = img.path;
                document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
                thumb.classList.add('active');
            };
            strip.appendChild(thumb);
        });
    }
}

// --- UPLOAD FROM MODAL ---
window.triggerUpload = function() {
    document.getElementById('modalFileInput').click();
}

window.handleModalUpload = async function(input) {
    if (!input.files[0] || !currentGiftId) return;

    const file = input.files[0];
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('giftId', currentGiftId);
    formData.append('uploaderName', 'CatalogUser');

    try {
        const res = await fetch(`/api/${currentGameId}/upload`, { method: 'POST', body: formData });
        if (res.ok) {
            // Socket will refresh the grid, but let's clear input
            input.value = '';
            // Ideally we wait for socket update to refresh modal,
            // but for now we rely on the grid refresh to allow reopening or just visual feedback.
            alert("Uploaded! 📸");
            closeModal(); // Close to refresh state (simple MVP)
        } else {
            alert("Upload failed.");
        }
    } catch (e) {
        console.error(e);
        alert("Error uploading.");
    }
}