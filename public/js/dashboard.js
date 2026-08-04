async function loadDashboard() {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement...</p></div>';
  try {
    const d = await GET('/api/dashboard');
    el.innerHTML = `
      <div class="page-header"><h1 class="page-title">📊 Tableau de bord</h1><div class="actions">${['SUPER_ADMIN','SUPER'].includes(String(window.cxCurrentUser?.role||'').toUpperCase())?'<a class="btn btn-secondary" href="/api/player/latest/download">⬇ Télécharger le dernier Player</a>':''}</div></div>
      <div class="cards-grid">
        <div class="stat-card"><div class="stat-label">Clients actifs</div><div class="stat-value">${d.clients}</div></div>
        <div class="stat-card"><div class="stat-label">Médias actifs</div><div class="stat-value">${d.media}</div></div>
        <div class="stat-card"><div class="stat-label">Playlists</div><div class="stat-value">${d.playlists}</div></div>
        <div class="stat-card"><div class="stat-label">Écrans</div><div class="stat-value">${d.screens}<span style="font-size:1rem;color:var(--success);margin-left:8px">${d.screensOnline} en ligne</span></div></div>
        <div class="stat-card"><div class="stat-label">Diffusions aujourd'hui</div><div class="stat-value">${d.logsToday}</div></div>
        <div class="stat-card"><div class="stat-label">Stockage utilisé</div><div class="stat-value" style="font-size:1.4rem">${d.diskUsedMb} Mo</div></div>
      </div>`;
  } catch (e) { el.innerHTML = `<div class="empty"><p>${e.message}</p></div>`; }
}
