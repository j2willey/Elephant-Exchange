document.addEventListener('DOMContentLoaded', refreshList);

async function refreshList() {
    try {
        const res = await fetch('/api/admin/games');
        const games = await res.json();
        renderTable(games);
    } catch (e) {
        console.error(e);
        document.getElementById('gameTableBody').innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Error loading games</td></tr>';
    }
}

function renderTable(games) {
    const tbody = document.getElementById('gameTableBody');
    if (games.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:20px; text-align:center; color:#94a3b8;">No active games found.</td></tr>';
        return;
    }

    tbody.innerHTML = games.map(g => {
        const activeTime = g.lastActivity ? new Date(g.lastActivity).toLocaleString() : 'Never';
        const createdTime = g.createdAt ? new Date(g.createdAt).toLocaleDateString() : 'Unknown';
        
        let phaseBadge = `<span class="badge" style="background:#16a34a; color:white;">Active</span>`;
        if (g.phase === 'voting') phaseBadge = `<span class="badge" style="background:#d97706; color:white;">Voting</span>`;
        if (g.phase === 'results') phaseBadge = `<span class="badge" style="background:#dc2626; color:white;">Over</span>`;

        return `
            <tr style="border-bottom:1px solid #334155;">
                <td style="padding:15px; font-weight:bold; color:#60a5fa;">
                    <a href="/gameadmin.html?game=${g.id}" target="_blank" style="color:inherit; text-decoration:none;">${g.id}</a>
                </td>
                <td>👤 ${g.players}</td>
                <td>🎁 ${g.gifts}</td>
                <td>${phaseBadge}</td>
                <td style="font-size:0.9rem; color:#94a3b8;">
                    <div>${activeTime}</div>
                    <div style="font-size:0.75rem;">Created: ${createdTime}</div>
                </td>
                <td style="text-align:right;">
                    <button onclick="deleteGame('${g.id}')" class="btn-gray" style="font-size:0.8rem; padding:5px 10px;">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function deleteGame(gameId) {
    if (!confirm(`Are you sure you want to delete "${gameId}"?`)) return;
    await fetch(`/api/admin/games/${gameId}`, { method: 'DELETE' });
    refreshList();
}

async function nukeAll() {
    const promptVal = prompt("Type 'DELETE' to confirm wiping ALL games:");
    if (promptVal !== 'DELETE') return;
    
    await fetch('/api/admin/flush', { method: 'DELETE' });
    refreshList();
}