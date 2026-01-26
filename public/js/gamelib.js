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

    // Threshold raised to 150 to prefer White text on mid-tones (like Orange)
    return (yiq >= 150) ? '#000000' : '#ffffff';
}


function applyTheme(settings) {
    if (!settings) return;

    const root = document.documentElement;
    const primary = settings.themeColor || '#2563eb';
    const bg = settings.themeBg || '';

    // Set CSS Variables
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--bg-image', bg ? `url('${bg}')` : 'none');

    const textCol = getContrastColor(primary);


    // Inject Dynamic Classes
    // We create a <style> tag to override specific button classes with the precise theme color and contrast text
    let styleTag = document.getElementById('dynamic-theme-style');

    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'dynamic-theme-style';
        document.head.appendChild(styleTag);
    }


styleTag.innerHTML = `
        /* 1. Main Action Buttons (The New Taxonomy) */
        .btn-primary,
        .btn-play,
        .btn-manage,
        .btn-nav {
            background-color: ${primary} !important;
            color: ${textCol} !important;
            border: 1px solid ${primary} !important;
        }

        /* 2. Menu / Toggle Buttons */
        .btn-toggle {
            background-color: ${primary} !important;
            color: ${textCol} !important;
            opacity: 0.75;
            border: 1px solid rgba(0,0,0,0.1) !important;
        }

        .btn-toggle:hover { opacity: 0.9; }

        .btn-toggle.active {
            opacity: 1.0 !important;
            box-shadow: inset 0 3px 6px rgba(0,0,0,0.3) !important;
            border-color: rgba(255,255,255,0.3) !important;
            font-weight: bold;
        }

        /* 3. Banner & Highlights */
        .admin-banner { color: ${textCol} !important; }
        .admin-banner .tagline { color: ${textCol} !important; opacity: 0.9; }

        .active-row, .active-turn {
            border-left: 5px solid ${primary} !important;
            background-color: ${primary}15 !important;
        }

        .victim-row, .status-victim {
            border-left: 5px solid #dc2626 !important;
            background-color: #fef2f2 !important;
        }
    `;


    // Update Logo if present
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

    // 1. SAFETY: Force integers to avoid "1"+"1"="11" bugs
    const currentTurn = parseInt(state.currentTurn || 1);
    const activeLimit = parseInt(state.settings?.activePlayerCount || 1);

    // 2. IDENTIFY VICTIMS (Priority Group)
    // Any player marked as a victim who doesn't currently hold a gift
    const victims = state.participants.filter(p => p.isVictim);

    // 3. IDENTIFY THE QUEUE (Standard Turn Order)
    // Players who are not victims, have no gift, and are waiting for their turn
    const queue = state.participants
        .filter(p => !p.isVictim && !p.heldGiftId && parseInt(p.number) >= currentTurn)
        .sort((a, b) => parseInt(a.number) - parseInt(b.number));

    // 4. FILL THE SLOTS
    // Logic: Victims take the first slots.
    // If we have room left (Limit - VictimCount), we fill it with the Queue.
    // Note: If victims exceed the limit, we let them ALL be active (never block a victim).
    const slotsRemaining = Math.max(0, activeLimit - victims.length);

    // Combine: All Victims + The next N players from the queue
    const activeParticipants = [...victims, ...queue.slice(0, slotsRemaining)];

    return activeParticipants.map(p => p.id);
}


// 3. SMART SORTING

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

