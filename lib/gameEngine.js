/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */

function getDefaultState(gameId) {
    return {
        id: gameId,
        participants: [],
        gifts: [],
        settings: { 
            maxSteals: 3, 
            isPaused: false, 
            turnDurationSeconds: 60, 
            activePlayerCount: 1,
            scrollSpeed: 3,
            soundTheme: 'standard',
            showVictimStats: false // NEW: Default to hidden
        },
        // REMOVED: timerStart (Global) 
        currentTurn: 1,
        activeVictimId: null,
        history: []
    };
}

function isPlayerActive(gameState, playerId) {
    const target = gameState.participants.find(p => p.id === playerId);
    if (!target) return false;
    
    // Rule 1: Done = Inactive
    if (target.status === 'done') return false;

    // Rule 2: Victim = Priority
    if (target.isVictim) return true;

    // Rule 3: Queue Slots
    const activeLimit = gameState.settings.activePlayerCount || 1;
    const activeVictims = gameState.participants.filter(p => p.isVictim && p.status !== 'done');
    const slotsTakenByVictims = activeVictims.length;
    
    let slotsForQueue = activeLimit - slotsTakenByVictims;
    if (slotsForQueue < 0) slotsForQueue = 0; 
    if (slotsForQueue === 0) return false;

    const sortedQueue = gameState.participants
        .filter(p => p.number >= gameState.currentTurn && p.status === 'waiting' && !p.isVictim)
        .sort((a,b) => a.number - b.number);

    const activeQueuePlayers = sortedQueue.slice(0, slotsForQueue);
    return activeQueuePlayers.some(p => p.id === playerId);
}

// NEW: Assign timestamps to active players
function updateActiveTimers(gameState) {
    const now = Date.now();
    const activeLimit = gameState.settings.activePlayerCount || 1;

    // 1. VICTIMS (Always Active)
    gameState.participants.forEach(p => {
        if (p.isVictim && !p.heldGiftId) {
            // If they don't have a start time, give them one NOW
            if (!p.turnStartTime) p.turnStartTime = now;
        }
    });

    // 2. QUEUE (The next N players)
    const victimCount = gameState.participants.filter(p => p.isVictim && !p.heldGiftId).length;
    let slotsForQueue = Math.max(0, activeLimit - victimCount);

    const sortedQueue = gameState.participants
        .filter(p => !p.isVictim && !p.heldGiftId && p.number >= gameState.currentTurn)
        .sort((a,b) => a.number - b.number);

    // Loop through queue candidates
    for (let i = 0; i < sortedQueue.length; i++) {
        const p = sortedQueue[i];
        if (i < slotsForQueue) {
            // Player is in the Active Window
            if (!p.turnStartTime) {
                p.turnStartTime = now; // They just entered the window!
            }
        } else {
            // Player is waiting in line (future)
            p.turnStartTime = null; 
        }
    }
}

module.exports = { getDefaultState, isPlayerActive, updateActiveTimers };