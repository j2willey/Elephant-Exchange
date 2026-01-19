/*
 * ==============================================================================
 * ELEPHANT EXCHANGE - GAME ENGINE (Shared Logic)
 * ==============================================================================
 */

/**
 * Generates the initial empty state for a new game.
 */
function getDefaultState(gameId) {
    return {
        id: gameId,
        currentTurn: 1,
        activeVictimId: null,
        participants: [],
        gifts: [],
        history: [],
        settings: {
            maxSteals: 3,
            turnDurationSeconds: 60,
            activePlayerCount: 1, // Default to single file
            isPaused: false,
            scrollSpeed: 3,
            soundTheme: 'standard',
            showVictimStats: false,
            themeColor: '#2563eb',
            themeBg: ''
        }
    };
}

/**
 * Calculates exactly which Player IDs are allowed to act right now.
 * Priority: Victims > Queue
 */
function getActivePlayerIds(state) {
    const limit = state.settings.activePlayerCount || 1;
    
    // 1. VICTIMS (Highest Priority)
    // People who just had a gift stolen and need to pick a new one
    const victims = state.participants
        .filter(p => p.isVictim && !p.heldGiftId)
        .map(p => p.id);

    // 2. THE QUEUE (Standard Turns)
    // People who haven't gone yet, sorted by their number
    const queue = state.participants
        .filter(p => !p.isVictim && !p.heldGiftId && p.number >= state.currentTurn)
        .sort((a, b) => a.number - b.number)
        .map(p => p.id);

    // 3. COMBINE
    // Fill remaining "Active Slots" with people from the queue
    const slotsAvailable = Math.max(0, limit - victims.length);
    const activeQueue = queue.slice(0, slotsAvailable);
    
    return [...victims, ...activeQueue];
}

/**
 * Boolean check used by Server Routes to validate moves.
 */
function isPlayerActive(state, playerId) {
    const activeIds = getActivePlayerIds(state);
    return activeIds.includes(playerId);
}

/**
 * Updates the 'turnStartTime' for active players who don't have one yet.
 * Call this whenever the turn advances or a steal happens.
 */
function updateActiveTimers(state) {
    const activeIds = getActivePlayerIds(state);
    const now = Date.now();

    state.participants.forEach(p => {
        if (activeIds.includes(p.id)) {
            // If they just became active, start their timer
            if (!p.turnStartTime) {
                p.turnStartTime = now;
            }
        } else {
            // If they are no longer active, clear their timer
            p.turnStartTime = null;
        }
    });
}

module.exports = {
    getDefaultState,
    isPlayerActive,
    updateActiveTimers
};