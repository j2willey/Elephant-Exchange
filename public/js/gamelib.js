/*
 * ==============================================================================
 * ELEPHANT EXCHANGE - SHARED LIBRARY
 * ==============================================================================
 * Common logic for Admin and Scoreboard
 */

/*
 * ELEPHANT EXCHANGE - SHARED LIBRARY
 */

// 1. THEME ENGINE
function getContrastColor(hex) {
    if (!hex || hex.length < 7) return '#ffffff';
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
}

function applyTheme(settings) {
    if (!settings) return;
    const root = document.documentElement;
    const primary = settings.themeColor || '#2563eb';
    const bg = settings.themeBg || '';

    root.style.setProperty('--primary', primary);
    root.style.setProperty('--bg-image', bg ? `url('${bg}')` : 'none');
    
    const textCol = getContrastColor(primary);

    let styleTag = document.getElementById('dynamic-theme-style');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'dynamic-theme-style';
        document.head.appendChild(styleTag);
    }

    styleTag.innerHTML = `
        .btn-primary, .btn-blue, .btn-sm, .btn-green, .btn-orange { 
            background-color: ${primary} !important; 
            color: ${textCol} !important; 
        }
        .active-row, .active-turn { 
            border: 2px solid ${primary} !important; 
            background-color: ${primary}15 !important; 
        }
        .btn-camera-add { background-color: ${primary}; color: ${textCol}; }
        .victim-row, .status-victim { border-color: #dc2626 !important; background-color: #fef2f2 !important; }
    `;

    const titleEl = document.querySelector('h1');
    const existingLogo = document.getElementById('customGameLogo');
    if (settings.themeLogo) {
        if (!existingLogo && titleEl) {
            const img = document.createElement('img');
            img.src = settings.themeLogo;
            img.id = 'customGameLogo';
            img.className = 'game-logo';
            const target = document.getElementById('activePlayerBanner') || titleEl;
            target.parentNode.insertBefore(img, target);
        } else if (existingLogo) {
            existingLogo.src = settings.themeLogo;
        }
    }
}

// 2. ACTIVE PLAYER LOGIC
function getActiveIds(state) {
    if (!state || !state.participants) return [];
    const victims = state.participants.filter(p => p.isVictim && !p.heldGiftId);
    const queue = state.participants
        .filter(p => !p.isVictim && !p.heldGiftId && p.number >= state.currentTurn)
        .sort((a,b) => a.number - b.number);
    const limit = state.settings.activePlayerCount || 1;
    const slots = Math.max(0, limit - victims.length);
    return [...victims, ...queue.slice(0, slots)].map(p => p.id);
}

// 3. SMART SORTING (NEW!)
// Handles Voting, Mobile Bookmarks, and Standard Steal counts
function sortGifts(gifts, state, isMobile = false, bookmarks = new Set()) {
    return [...gifts].sort((a, b) => {
        // A. Voting Phase: High Votes Top
        if (state.phase === 'voting' || state.phase === 'results') {
            const votesA = a.downvotes?.length || 0;
            const votesB = b.downvotes?.length || 0;
            if (votesA === votesB) return a.id.localeCompare(b.id);
            return votesB - votesA;
        }
        
        // B. Mobile Bookmarks
        if (isMobile) {
            const aStarred = bookmarks.has(a.id);
            const bStarred = bookmarks.has(b.id);
            if (aStarred && !bStarred) return -1;
            if (!aStarred && bStarred) return 1;
        }

        // C. Standard Game Phase
        if (a.isFrozen !== b.isFrozen) return a.isFrozen - b.isFrozen;
        return b.stealCount - a.stealCount;
    });
}