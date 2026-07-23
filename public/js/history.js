async function loadHistory() {
  const el = document.getElementById('page-history');
  el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement...</p></div>';
  try {
    const logs = await GET('/api/history');
    el.innerHTML = `
      <div class="page-header"><h1 class="page-title">📋 Historique de diffusion</h1></div>
      ${logs.length === 0 ? `<div class="empty"><div class="empty-icon">📋</div><p>Aucun historique disponible</p></div>` :
      `<div class="table-wrap"><table>
        <thead><tr><th>Date/Heure</th><th>Écran</th><th>Média</th><th>Zone</th><th>Événement</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td>${new Date(l.played_at).toLocaleString('fr-BE')}</td>
          <td>${l.screen_name||'—'}</td>
          <td>${l.media_title||'—'}</td>
          <td><span class="badge badge-blue">${l.zone}</span></td>
          <td>${l.event}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}`;
  } catch (e) { el.innerHTML = `<div class="empty"><p>${e.message}</p></div>`; }
}
