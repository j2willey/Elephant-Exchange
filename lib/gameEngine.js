/*
 * Elephant Exchange
 * Copyright (c) 2026 Jim Willey
 * Licensed under the MIT License.
 */
// Pure Logic Module - No Network Code Here!

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
            scrollSpeed: 3
        },
        timerStart: Date.now(), 
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

module.exports = { getDefaultState, isPlayerActive };