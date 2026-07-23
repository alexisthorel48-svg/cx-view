let allScreens = [];

async function loadScreens() {
  const el = document.getElementById('page-screens');
  el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement...</p></div>';
  try {
    [allScreens] = await Promise.all([GET('/api/screens')]);
    renderScreens();
  } catch (e) { el.innerHTML = `<div class="empty"><p>${e.message}</p></div>`; }
}

function renderScreens() {
  const el = document.getElementById('page-screens');
  const now = new Date();
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">🖥️ Écrans</h1>
      <div class="actions"><button class="btn btn-secondary" onclick="openPlayerUpdatePanel()">⬆ Mise à jour Player</button><button class="btn btn-primary" onclick="openScreenForm()">+ Nouvel écran</button></div>
    </div>
    ${allScreens.length === 0 ? `<div class="empty"><div class="empty-icon">🖥️</div><p>Aucun écran configuré</p><button class="btn btn-primary" onclick="openScreenForm()">Ajouter un écran</button></div>` :
    `<div class="screens-grid">${allScreens.map(s => {
      const online = s.last_seen_at && (now - new Date(s.last_seen_at)) < 5*60*1000;
      return `<div class="screen-card">
        <div class="screen-card-header">
          <div>
            <div class="screen-name">${s.name}</div>
            ${s.client_name?`<div class="screen-detail">${s.client_name}</div>`:''}
          </div>
          <span class="badge ${online?'badge-green':'badge-red'}">${online?'En ligne':'Hors ligne'}</span>
        </div>
        <div class="screen-code">${s.pairing_code}</div>
        <div class="screen-detail">${s.width_px}×${s.height_px}px · ${s.orientation}° · ${s.layout}</div>
        <div class="screen-detail">Mode : <strong>${s.display_mode==='KIOSK'?'Plein écran Windows':'Fenêtre administrée'}</strong> · Moniteur ${Number(s.monitor_id||0)}</div>
        <div class="screen-playlists">
          <div class="screen-zone"><span class="zone-label">Zone A</span><span class="zone-value">${s.playlist_a_name||'—'}</span></div>
          ${s.layout!=='SINGLE'?`<div class="screen-zone"><span class="zone-label">Zone B</span><span class="zone-value">${s.playlist_b_name||'—'}</span></div>`:''}
        </div>
        <div class="actions" style="margin-top:12px">
          <button class="btn btn-sm btn-secondary" onclick="openScreenForm(${s.id})">✏️ Modifier</button>
          <button class="btn btn-sm btn-primary" onclick="syncScreen(${s.id})">📡 Synchroniser</button>
          <button class="btn btn-sm btn-danger" onclick="deleteScreen(${s.id})">🗑️</button>
        </div>
        <div style="font-size:.7rem;color:var(--text2);margin-top:8px">Dernière vue : ${s.last_seen_at?fmtDate(s.last_seen_at):'jamais'}</div>
      </div>`;
    }).join('')}</div>`}`;
}

function openScreenForm(id) {
  const s = id ? allScreens.find(x=>x.id===id) : null;
  openModal(s ? 'Modifier l\'écran' : 'Nouvel écran', `
    <div class="form-group"><label>Nom *</label><input id="s-name" value="${s?.name||''}" placeholder="Ex: Magasin Lyon - Vitrine"></div>
    <div class="form-group"><label>Client</label>
      <select id="s-client"><option value="">Aucun</option>${allClients.map(c=>`<option value="${c.id}" ${s?.client_id===c.id?'selected':''}>${c.name}</option>`).join('')}</select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Largeur (px)</label><input id="s-w" type="number" value="${s?.width_px||1920}"></div>
      <div class="form-group"><label>Hauteur (px)</label><input id="s-h" type="number" value="${s?.height_px||1080}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Orientation</label>
        <select id="s-orient">
          <option value="0" ${!s||s.orientation===0?'selected':''}>0° (Normal)</option>
          <option value="90" ${s?.orientation===90?'selected':''}>90° (Droite)</option>
          <option value="180" ${s?.orientation===180?'selected':''}>180° (Retourné)</option>
          <option value="270" ${s?.orientation===270?'selected':''}>270° (Gauche)</option>
        </select>
      </div>
      <div class="form-group"><label>Mode</label>
        <select id="s-layout" onchange="toggleZoneB()">
          <option value="SINGLE" ${!s||s.layout==='SINGLE'?'selected':''}>Zone unique</option>
          <option value="DOUBLE_H" ${s?.layout==='DOUBLE_H'?'selected':''}>Double — Horizontal</option>
          <option value="DOUBLE_V" ${s?.layout==='DOUBLE_V'?'selected':''}>Double — Vertical</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Playlist — Zone A</label>
      <select id="s-pa"><option value="">Aucune</option>${allPlaylists.map(p=>`<option value="${p.id}" ${s?.playlist_a_id===p.id?'selected':''}>${p.name}</option>`).join('')}</select>
    </div>
    <div class="form-group" id="zone-b-group" style="${s?.layout&&s.layout!=='SINGLE'?'':'display:none'}">
      <label>Playlist — Zone B</label>
      <select id="s-pb"><option value="">Aucune</option>${allPlaylists.map(p=>`<option value="${p.id}" ${s?.playlist_b_id===p.id?'selected':''}>${p.name}</option>`).join('')}</select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Mode d'affichage du Player</label>
        <select id="s-display-mode"><option value="WINDOW" ${s?.display_mode!=='KIOSK'?'selected':''}>Fenêtre administrée</option>
        <option value="KIOSK" ${s?.display_mode==='KIOSK'?'selected':''}>Plein écran Windows (Kiosk)</option></select>
      </div>
      <div class="form-group"><label>Moniteur cible</label>
        <select id="s-monitor"><option value="0" ${Number(s?.monitor_id||0)===0?'selected':''}>Moniteur 0</option>
        <option value="1" ${Number(s?.monitor_id)===1?'selected':''}>Moniteur 1</option>
        <option value="2" ${Number(s?.monitor_id)===2?'selected':''}>Moniteur 2</option></select>
      </div>
    </div>
    <div class="form-group"><label>Couleur de veille</label><input id="s-standby" type="color" value="${s?.standby_color||'#000000'}"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="saveScreen(${id||'null'})">Enregistrer</button>
    </div>`);
}

function toggleZoneB() {
  const layout = document.getElementById('s-layout').value;
  document.getElementById('zone-b-group').style.display = layout !== 'SINGLE' ? '' : 'none';
}

async function saveScreen(id) {
  const name = document.getElementById('s-name').value.trim();
  if (!name) { toast('Le nom est requis', 'error'); return; }
  const data = {
    name, client_id: document.getElementById('s-client').value||null,
    width_px: parseInt(document.getElementById('s-w').value)||1920,
    height_px: parseInt(document.getElementById('s-h').value)||1080,
    orientation: parseInt(document.getElementById('s-orient').value)||0,
    layout: document.getElementById('s-layout').value,
    playlist_a_id: document.getElementById('s-pa').value||null,
    playlist_b_id: document.getElementById('s-pb').value||null,
    standby_color: document.getElementById('s-standby').value,
    display_mode: document.getElementById('s-display-mode').value,
    monitor_id: parseInt(document.getElementById('s-monitor').value, 10) || 0
  };
  try {
    if (id) await PUT(`/api/screens/${id}`, data);
    else await POST('/api/screens', data);
    closeModal(); toast('Écran enregistré');
    allScreens = await GET('/api/screens'); renderScreens();
  } catch (e) { toast(e.message, 'error'); }
}

async function syncScreen(id) {
  try {
    const r = await POST(`/api/screens/${id}/sync`);
    const s = allScreens.find(x => x.id === id);
    toast(r.synced ? `Synchronisation envoyée à ${s?.name||'l\'écran'}` : 'Synchronisation demandée — le Player l\'appliquera à la prochaine connexion');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteScreen(id) {
  if (!confirm('Supprimer cet écran ?')) return;
  try { await DEL(`/api/screens/${id}`); toast('Écran supprimé'); allScreens = await GET('/api/screens'); renderScreens(); }
  catch (e) { toast(e.message, 'error'); }
}


async function openPlayerUpdatePanel() {
  try {
    const updates = await GET('/api/player-updates');
    openModal('Publier une mise à jour Player', `
      <div class="form-group"><label>Version *</label><input id="player-update-version" placeholder="6.5.2"></div>
      <div class="form-group"><label>Installateur Windows (.exe) *</label><input id="player-update-file" type="file" accept=".exe"></div>
      <div class="form-group"><label>Notes de version</label><textarea id="player-update-notes" rows="3" placeholder="Nouvelles fonctionnalités et corrections"></textarea></div>
      <label class="check"><input id="player-update-mandatory" type="checkbox"> Installer automatiquement dès la réception</label>
      <div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="publishPlayerUpdate()">Publier et envoyer</button></div>
      <div class="screen-detail" style="margin-top:16px">${updates.length ? 'Dernière version publiée : <strong>'+updates[0].version+'</strong>' : 'Aucune version Player publiée.'}</div>
    `);
  } catch (e) { toast(e.message, 'error'); }
}

async function publishPlayerUpdate() {
  const version = document.getElementById('player-update-version').value.trim();
  const installer = document.getElementById('player-update-file').files[0];
  if (!version || !installer) return toast('La version et l’installateur .exe sont requis.', 'error');
  const body = new FormData();
  body.append('version', version);
  body.append('installer', installer);
  body.append('notes', document.getElementById('player-update-notes').value.trim());
  body.append('mandatory', document.getElementById('player-update-mandatory').checked ? 'true' : 'false');
  try {
    const response = await fetch('/api/player-updates', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Publication impossible');
    closeModal();
    toast(`Version ${data.update.version} publiée : ${data.notified_players} player(s) averti(s).`);
  } catch (e) { toast(e.message, 'error'); }
}
window.openPlayerUpdatePanel = openPlayerUpdatePanel;
window.publishPlayerUpdate = publishPlayerUpdate;
