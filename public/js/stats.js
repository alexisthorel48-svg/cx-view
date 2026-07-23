let statsFilters = {
  from: '',
  to: '',
  start_time: '06:00',
  end_time: '22:00',
  client_id: '',
  screen_id: ''
};

function statsDateValue(date) {
  return date.toISOString().slice(0, 10);
}

function statsFmtSeconds(value) {
  const seconds = Number(value || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`;
}

function statsEscape(value) {
  const div = document.createElement('div');
  div.textContent = String(value == null ? '' : value);
  return div.innerHTML;
}

async function loadStats() {
  const el = document.getElementById('page-stats');
  if (!el) return;

  const today = statsDateValue(new Date());
  if (!statsFilters.from) statsFilters.from = today;
  if (!statsFilters.to) statsFilters.to = today;

  let clients = window.allClients || [];
  let screens = window.allScreens || [];
  try {
    if (!clients.length) clients = await GET('/api/clients');
    if (!screens.length) screens = await GET('/api/screens');
  } catch (_) {}

  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">📈 Statistiques de diffusion</h1>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="form-row">
        <div class="form-group">
          <label>Du</label>
          <input id="stats-from" type="date" value="${statsFilters.from}">
        </div>
        <div class="form-group">
          <label>Au</label>
          <input id="stats-to" type="date" value="${statsFilters.to}">
        </div>
        <div class="form-group">
          <label>Heure de début</label>
          <input id="stats-start-time" type="time" value="${statsFilters.start_time}">
        </div>
        <div class="form-group">
          <label>Heure de fin</label>
          <input id="stats-end-time" type="time" value="${statsFilters.end_time}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Client</label>
          <select id="stats-client">
            <option value="">Tous les clients</option>
            ${clients.map(c => `<option value="${c.id}" ${String(statsFilters.client_id) === String(c.id) ? 'selected' : ''}>${statsEscape(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Écran</label>
          <select id="stats-screen">
            <option value="">Tous les écrans</option>
            ${screens.map(s => `<option value="${s.id}" ${String(statsFilters.screen_id) === String(s.id) ? 'selected' : ''}>${statsEscape(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="align-self:end">
          <button class="btn btn-primary" onclick="applyStatsFilters()">Appliquer les filtres</button>
        </div>
      </div>
      <div style="font-size:.8rem;color:var(--text2);margin-top:4px">
        Les statistiques ne comptabilisent que les diffusions réalisées entre les heures choisies. Par défaut : <strong>06:00–22:00</strong>.
      </div>
    </div>

    <div id="stats-results" class="empty"><div class="empty-icon">⏳</div><p>Calcul des statistiques…</p></div>
  `;

  await refreshStatsResults();
}

async function applyStatsFilters() {
  statsFilters = {
    from: document.getElementById('stats-from').value,
    to: document.getElementById('stats-to').value,
    start_time: document.getElementById('stats-start-time').value,
    end_time: document.getElementById('stats-end-time').value,
    client_id: document.getElementById('stats-client').value,
    screen_id: document.getElementById('stats-screen').value
  };
  await refreshStatsResults();
}

async function refreshStatsResults() {
  const results = document.getElementById('stats-results');
  if (!results) return;

  const params = new URLSearchParams();
  Object.entries(statsFilters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  try {
    const rows = await GET('/api/stats?' + params.toString());
    const totalPlays = rows.reduce((sum, row) => sum + Number(row.play_count || 0), 0);
    const totalSeconds = rows.reduce((sum, row) => sum + Number(row.total_seconds || 0), 0);

    results.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-value">${totalPlays}</div><div class="stat-label">Diffusions comptabilisées</div></div>
        <div class="stat-card"><div class="stat-value">${statsFmtSeconds(totalSeconds)}</div><div class="stat-label">Temps de diffusion estimé</div></div>
        <div class="stat-card"><div class="stat-value">${rows.length}</div><div class="stat-label">Médias diffusés</div></div>
      </div>

      ${rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Média</th><th>Client</th><th>Type</th><th>Lectures</th><th>Temps estimé</th><th>Dernière diffusion</th></tr></thead>
        <tbody>
          ${rows.map(row => `<tr>
            <td><strong>${statsEscape(row.title)}</strong></td>
            <td>${statsEscape(row.client_name || '—')}</td>
            <td>${statsEscape(row.media_type || '—')}</td>
            <td>${Number(row.play_count || 0)}</td>
            <td>${statsFmtSeconds(row.total_seconds)}</td>
            <td>${row.last_played ? fmtDateTime(row.last_played) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="empty"><div class="empty-icon">📭</div><p>Aucune diffusion pour cette plage.</p></div>`}
    `;
  } catch (e) {
    results.innerHTML = `<div class="empty"><p>${statsEscape(e.message)}</p></div>`;
  }
}

window.loadStats = loadStats;
window.applyStatsFilters = applyStatsFilters;
