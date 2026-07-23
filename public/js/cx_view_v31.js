/* CX-View V3.1 — Explorateur médias + classement d'écrans + programmation */
(() => {
  const esc = value => {
    const d = document.createElement('div'); d.textContent = String(value ?? ''); return d.innerHTML;
  };
  const api = (method, url, body) => {
    if (typeof window.api === 'function') return window.api(method, url, body);
    const options = { method, headers: {} };
    if (body && !(body instanceof FormData)) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    else if (body) options.body = body;
    return fetch(url, options).then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Erreur serveur');
      return data;
    });
  };
  const get = url => api('GET', url);
  const post = (url, body) => api('POST', url, body);
  const put = (url, body) => api('PUT', url, body);
  const del = url => api('DELETE', url);
  const say = (message, type = 'success') => window.toast ? window.toast(message, type) : alert(message);

  let folders = [], activeFolderId = null, media = [], selectedMedia = new Set();
  let groups = [], screens = [], activeGroupId = null, screenSearch = '';

  function tree(items, parent, render) {
    return items.filter(x => String(x.parent_id || '') === String(parent || '')).map(item => {
      const children = tree(items, item.id, render);
      return render(item, children);
    }).join('');
  }
  function folderDescendants(id) {
    const result = [Number(id)];
    let changed = true;
    while (changed) {
      changed = false;
      folders.filter(f => result.includes(Number(f.parent_id))).forEach(f => {
        if (!result.includes(Number(f.id))) { result.push(Number(f.id)); changed = true; }
      });
    }
    return result;
  }
  function folderPath(id) {
    const out = []; let current = folders.find(f => Number(f.id) === Number(id));
    while (current) { out.unshift(current); current = folders.find(f => Number(f.id) === Number(current.parent_id)); }
    return out;
  }
  async function refreshMedia() {
    [folders, media] = await Promise.all([
      get('/api/v31/folders'),
      activeFolderId ? get('/api/v31/media?folder_id=' + activeFolderId) : get('/api/v31/media')
    ]);
  }
  window.loadMedia = async function() {
    const el = document.getElementById('page-media');
    el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement de la médiathèque…</p></div>';
    try { await refreshMedia(); renderMediaExplorer(); } catch (e) { el.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
  };
  function renderMediaExplorer() {
    const el = document.getElementById('page-media');
    const pathItems = activeFolderId ? folderPath(activeFolderId) : [];
    const displayed = activeFolderId ? media : media.filter(m => !m.folder_id);
    const folderCards = folders.filter(f => String(f.parent_id || '') === String(activeFolderId || ''));
    el.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">🗂️ Médiathèque</h1><div class="v31-breadcrumb"><button onclick="v31OpenFolder(null)">Médiathèque</button>${pathItems.map(f => `<span>›</span><button onclick="v31OpenFolder(${f.id})">${esc(f.name)}</button>`).join('')}</div></div>
        <div class="actions"><button class="btn btn-secondary" onclick="v31NewFolder()">📁 Nouveau dossier</button><button class="btn btn-primary" onclick="v31ChooseImport(false)">+ Importer ici</button><button class="btn btn-primary" onclick="v31ChooseImport(true)">↳ Importer un dossier</button></div>
      </div>
      <div class="v31-explorer">
        <aside class="v31-tree"><div class="v31-tree-title">DOSSIERS</div><button class="v31-tree-root ${activeFolderId ? '' : 'active'}" onclick="v31OpenFolder(null)">🏠 Tous les médias</button>
          ${tree(folders, null, (f, children) => `<div class="v31-tree-node"><button class="${Number(activeFolderId)===Number(f.id)?'active':''}" onclick="v31OpenFolder(${f.id})">📁 ${esc(f.name)}</button>${children ? `<div class="v31-tree-children">${children}</div>` : ''}</div>`)}
        </aside>
        <section class="v31-content">
          <div id="v31-dropzone" class="v31-dropzone"><strong>Déposez vos fichiers ici</strong><span>Ils seront importés directement dans le dossier ouvert.</span></div>
          <div class="v31-selection-bar">${selectedMedia.size ? `<strong>${selectedMedia.size} média(s) sélectionné(s)</strong><button class="btn btn-secondary btn-sm" onclick="v31MoveSelected()">Déplacer vers un dossier</button><button class="btn btn-secondary btn-sm" onclick="v31ClearSelection()">Annuler</button>` : `<span>${displayed.length} média(s) · ${folderCards.length} dossier(s)</span>`}</div>
          <div class="v31-folder-grid">${folderCards.map(f => `<button class="v31-folder-card" onclick="v31OpenFolder(${f.id})"><span>📁</span><strong>${esc(f.name)}</strong><small>${f.client_name ? esc(f.client_name) : 'Interne'}</small></button>`).join('')}</div>
          <div class="media-grid">${displayed.map(m => {
            const thumb = m.thumbnail_name ? `<img class="media-thumb" src="/files/thumbs/${esc(m.thumbnail_name)}">` : `<div class="media-thumb-placeholder">${m.media_type==='VIDEO'?'🎬':'🖼️'}</div>`;
            return `<div class="media-card ${selectedMedia.has(Number(m.id))?'selected':''}" onclick="v31ToggleMedia(${m.id})">${thumb}<div class="media-info"><div class="media-title">${esc(m.title)}</div><div class="media-meta">${esc(m.media_type)} · ${window.fmtBytes ? fmtBytes(m.bytes) : m.bytes+' octets'}</div><div class="media-meta">${esc(m.folder_path || 'Sans dossier')}</div></div></div>`;
          }).join('') || '<div class="empty"><div class="empty-icon">📭</div><p>Ce dossier est vide.</p></div>'}</div>
        </section>
      </div>
      <input id="v31-file-input" type="file" multiple accept="image/*,video/*" style="display:none">
      <input id="v31-dir-input" type="file" webkitdirectory directory multiple style="display:none">
    `;
    const drop = document.getElementById('v31-dropzone');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); v31Upload(e.dataTransfer.files, false); });
    document.getElementById('v31-file-input').onchange = e => v31Upload(e.target.files, false);
    document.getElementById('v31-dir-input').onchange = e => v31Upload(e.target.files, true);
  }
  window.v31OpenFolder = async id => { activeFolderId = id ? Number(id) : null; selectedMedia.clear(); await window.loadMedia(); };
  window.v31ToggleMedia = id => { id = Number(id); selectedMedia.has(id) ? selectedMedia.delete(id) : selectedMedia.add(id); renderMediaExplorer(); };
  window.v31ClearSelection = () => { selectedMedia.clear(); renderMediaExplorer(); };
  window.v31NewFolder = () => {
    const current = activeFolderId ? folders.find(f => Number(f.id) === Number(activeFolderId)) : null;
    window.openModal('Nouveau dossier', `<div class="form-group"><label>Nom du dossier</label><input id="v31-folder-name" placeholder="Ex. Campagne été"></div><div class="v2-note">Le dossier sera créé dans : <strong>${current ? esc(current.path || current.name) : 'Racine'}</strong>.</div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="v31CreateFolder()">Créer</button></div>`);
  };
  window.v31CreateFolder = async () => {
    const name = document.getElementById('v31-folder-name').value.trim();
    if (!name) return say('Le nom est requis.', 'error');
    try { await post('/api/v31/folders', { name, parent_id: activeFolderId }); closeModal(); await window.loadMedia(); say('Dossier créé.'); } catch (e) { say(e.message, 'error'); }
  };
  window.v31ChooseImport = directory => {
    if (!activeFolderId) return say('Ouvrez ou créez d’abord un dossier de destination.', 'error');
    document.getElementById(directory ? 'v31-dir-input' : 'v31-file-input').click();
  };
  window.v31Upload = async (files, directory) => {
    if (!activeFolderId) return say('Ouvrez un dossier de destination avant l’import.', 'error');
    const list = Array.from(files || []);
    if (!list.length) return;
    const body = new FormData(); body.append('folder_id', activeFolderId);
    const paths = [];
    list.forEach(file => { body.append('files', file); paths.push(directory ? (file.webkitRelativePath || file.name) : file.name); });
    body.append('relative_paths', JSON.stringify(paths));
    try { const r = await post('/api/v31/media/upload', body); await window.loadMedia(); say(`${r.imported.length} fichier(s) importé(s)${r.failed.length ? ' · '+r.failed.length+' échec(s)' : ''}`); } catch (e) { say(e.message, 'error'); }
  };
  window.v31MoveSelected = () => {
    if (!selectedMedia.size) return;
    window.openModal('Déplacer les médias', `<div class="form-group"><label>Dossier cible</label><select id="v31-target-folder">${folders.map(f => `<option value="${f.id}">${esc(f.path || f.name)}</option>`).join('')}</select></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="v31ConfirmMove()">Déplacer</button></div>`);
  };
  window.v31ConfirmMove = async () => {
    try { await post('/api/v31/media/move', { media_ids: [...selectedMedia], folder_id: Number(document.getElementById('v31-target-folder').value) }); selectedMedia.clear(); closeModal(); await window.loadMedia(); say('Médias déplacés.'); } catch (e) { say(e.message, 'error'); }
  };

  function groupTree(parent) {
    return groups.filter(g => String(g.parent_id || '') === String(parent || '')).map(g => `<div class="v31-tree-node"><button class="${Number(activeGroupId)===Number(g.id)?'active':''}" onclick="v31OpenGroup(${g.id})">🖥️ ${esc(g.name)} <small>(${g.screen_count})</small></button><div class="v31-tree-children">${groupTree(g.id)}</div></div>`).join('');
  }
  async function refreshScreens() {
    [groups, screens] = await Promise.all([get('/api/v31/groups'), get('/api/v31/screens?' + new URLSearchParams({ ...(activeGroupId ? { group_id: activeGroupId } : {}), ...(screenSearch ? { search: screenSearch } : {}) }))]);
  }
  window.loadScreens = async function() {
    const el = document.getElementById('page-screens');
    el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement des écrans…</p></div>';
    try { await refreshScreens(); renderScreensExplorer(); } catch (e) { el.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
  };
  function renderScreensExplorer() {
    const el = document.getElementById('page-screens'); const now = Date.now();
    el.innerHTML = `<div class="page-header"><div><h1 class="page-title">🖥️ Écrans</h1><div class="v2-note">Classez vos écrans par client, site, ville ou bâtiment.</div></div><div class="actions"><button class="btn btn-secondary" onclick="v31NewGroup()">+ Nouveau groupe / site</button><button class="btn btn-primary" onclick="openScreenForm()">+ Nouvel écran</button></div></div>
      <div class="v31-screen-layout"><aside class="v31-tree"><div class="v31-tree-title">GROUPES / SITES</div><button class="v31-tree-root ${activeGroupId?'':'active'}" onclick="v31OpenGroup(null)">Tous les écrans</button>${groupTree(null)}</aside>
      <section class="v31-content"><div class="filters-bar"><input id="v31-screen-search" value="${esc(screenSearch)}" placeholder="Rechercher nom, code, client ou site…" oninput="v31SearchScreens(this.value)" style="min-width:280px"></div>
      <div class="screens-grid">${screens.map(s => {
        const online = s.last_seen_at && now - new Date(s.last_seen_at).getTime() < 300000;
        return `<div class="screen-card"><div class="screen-card-header"><div><div class="screen-name">${esc(s.name)}</div><div class="screen-detail">${esc(s.client_name || 'Sans client')} · ${esc(s.group_name || 'Sans groupe')}</div></div><span class="badge ${online?'badge-green':'badge-red'}">${online?'En ligne':'Hors ligne'}</span></div><div class="screen-code">${esc(s.pairing_code)}</div><div class="screen-detail">${s.width_px}×${s.height_px}px · ${esc(s.layout)}</div><div class="screen-playlists"><div class="screen-zone"><span>Zone A</span><span>${esc(s.playlist_a_name||'—')}</span></div>${s.layout!=='SINGLE'?`<div class="screen-zone"><span>Zone B</span><span>${esc(s.playlist_b_name||'—')}</span></div>`:''}</div><div class="actions" style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="v31Schedule(${s.id})">🗓️ Programmation</button><button class="btn btn-sm btn-secondary" onclick="v31AssignGroup(${s.id})">📂 Classer</button><button class="btn btn-sm btn-secondary" onclick="openScreenForm(${s.id})">✏️ Modifier</button><button class="btn btn-sm btn-secondary" onclick="syncScreen(${s.id})">📡 Sync</button></div></div>`;
      }).join('') || '<div class="empty"><div class="empty-icon">🖥️</div><p>Aucun écran dans ce groupe.</p></div>'}</div></section></div>`;
  }
  window.v31OpenGroup = async id => { activeGroupId = id ? Number(id) : null; await window.loadScreens(); };
  let searchTimer;
  window.v31SearchScreens = value => { clearTimeout(searchTimer); screenSearch = value; searchTimer = setTimeout(() => window.loadScreens(), 180); };
  window.v31NewGroup = () => window.openModal('Nouveau groupe / site', `<div class="form-group"><label>Nom</label><input id="v31-group-name" placeholder="Ex. Bruxelles — Centre-ville"></div><div class="form-group"><label>Groupe parent</label><select id="v31-group-parent"><option value="">Aucun (racine)</option>${groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="v31CreateGroup()">Créer</button></div>`);
  window.v31CreateGroup = async () => { try { await post('/api/v31/groups',{name:document.getElementById('v31-group-name').value.trim(),parent_id:document.getElementById('v31-group-parent').value||null}); closeModal(); await window.loadScreens(); say('Groupe créé.'); } catch(e){say(e.message,'error');} };
  window.v31AssignGroup = id => window.openModal('Classer l’écran', `<div class="form-group"><label>Groupe / site</label><select id="v31-screen-group"><option value="">Sans groupe</option>${groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="v31SaveGroup(${id})">Enregistrer</button></div>`);
  window.v31SaveGroup = async id => { try { await put('/api/v31/screens/'+id+'/group',{group_id:document.getElementById('v31-screen-group').value||null}); closeModal(); await window.loadScreens(); say('Écran classé.'); } catch(e){say(e.message,'error');} };

  const days = [['mon','L'],['tue','M'],['wed','M'],['thu','J'],['fri','V'],['sat','S'],['sun','D']];
  window.v31Schedule = async screenId => {
    try {
      const [rules, playlists] = await Promise.all([get('/api/v31/screens/'+screenId+'/rules'), get('/api/playlists')]);
      const table = rules.map(r => `<tr><td>${esc(r.name||'Règle')}</td><td>${r.zone}</td><td>${esc(r.playlist_name)}</td><td>${esc(r.days||'all')}</td><td>${r.time_from?String(r.time_from).slice(0,5):'—'}–${r.time_to?String(r.time_to).slice(0,5):'—'}</td><td>${r.active?'Active':'Inactive'}</td><td><button class="btn btn-sm btn-danger" onclick="v31DeleteRule(${r.id},${screenId})">✕</button></td></tr>`).join('');
      window.openModal('Programmation des playlists', `<div class="v2-note">La règle remplace temporairement la playlist par défaut de l’écran. La priorité la plus élevée gagne.</div><div class="table-wrap" style="margin:12px 0"><table><thead><tr><th>Règle</th><th>Zone</th><th>Playlist</th><th>Jours</th><th>Heures</th><th>État</th><th></th></tr></thead><tbody>${table || '<tr><td colspan="7">Aucune règle programmée.</td></tr>'}</tbody></table></div><div class="form-group"><label>Nom de la règle</label><input id="v31-rule-name" placeholder="Ex. Campagne Noël"></div><div class="form-row"><div class="form-group"><label>Zone</label><select id="v31-rule-zone"><option value="A">Zone A</option><option value="B">Zone B</option></select></div><div class="form-group"><label>Playlist de remplacement</label><select id="v31-rule-playlist">${playlists.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div></div><div class="form-row"><div class="form-group"><label>Du (optionnel)</label><input id="v31-rule-start" type="date"></div><div class="form-group"><label>Au (optionnel)</label><input id="v31-rule-end" type="date"></div></div><div class="form-row"><div class="form-group"><label>De</label><input id="v31-rule-from" type="time"></div><div class="form-group"><label>À</label><input id="v31-rule-to" type="time"></div></div><div class="form-group"><label>Jours</label><div class="v31-days">${days.map(([key,label])=>`<label><input type="checkbox" value="${key}" class="v31-day"> ${label}</label>`).join('')}<label><input type="checkbox" id="v31-all-days" checked onchange="document.querySelectorAll('.v31-day').forEach(x=>x.checked=false)"> Tous</label></div></div><div class="form-row"><div class="form-group"><label>Priorité</label><input id="v31-rule-priority" type="number" value="100" min="1"></div><div class="form-group"><label>&nbsp;</label><label style="text-transform:none"><input id="v31-rule-active" type="checkbox" checked> Règle active</label></div></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Fermer</button><button class="btn btn-primary" onclick="v31AddRule(${screenId})">Ajouter la règle</button></div>`);
    } catch(e){say(e.message,'error');}
  };
  window.v31AddRule = async screenId => {
    const checked = [...document.querySelectorAll('.v31-day:checked')].map(x=>x.value);
    const data = { name:document.getElementById('v31-rule-name').value.trim() || 'Règle de programmation', zone:document.getElementById('v31-rule-zone').value, playlist_id:Number(document.getElementById('v31-rule-playlist').value), start_date:document.getElementById('v31-rule-start').value||null, end_date:document.getElementById('v31-rule-end').value||null, time_from:document.getElementById('v31-rule-from').value||null, time_to:document.getElementById('v31-rule-to').value||null, days:document.getElementById('v31-all-days').checked||!checked.length?'all':checked.join(','), priority:Number(document.getElementById('v31-rule-priority').value)||100, active:document.getElementById('v31-rule-active').checked };
    try { await post('/api/v31/screens/'+screenId+'/rules',data); say('Règle enregistrée et synchronisation envoyée.'); window.v31Schedule(screenId); } catch(e){say(e.message,'error');}
  };
  window.v31DeleteRule = async (id, screenId) => { if (!confirm('Supprimer cette règle ?')) return; try { await del('/api/v31/rules/'+id); say('Règle supprimée et synchronisation envoyée.'); window.v31Schedule(screenId); } catch(e){say(e.message,'error');} };

  const style = document.createElement('style');
  style.textContent = `.v31-explorer,.v31-screen-layout{display:grid;grid-template-columns:245px minmax(0,1fr);gap:16px}.v31-tree{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px;height:max-content;max-height:72vh;overflow:auto}.v31-tree-title{font-size:.72rem;font-weight:700;color:var(--text2);padding:6px 8px}.v31-tree button{width:100%;text-align:left;border:0;background:transparent;color:var(--text);padding:7px 8px;border-radius:5px;cursor:pointer}.v31-tree button:hover,.v31-tree button.active,.v31-tree-root.active{background:rgba(255,210,26,.15);color:var(--accent)}.v31-tree-children{padding-left:14px}.v31-content{min-width:0}.v31-breadcrumb{display:flex;gap:6px;align-items:center;margin-top:6px;color:var(--text2);font-size:.82rem;flex-wrap:wrap}.v31-breadcrumb button{border:0;background:transparent;color:var(--accent);cursor:pointer}.v31-dropzone{border:2px dashed var(--border);border-radius:9px;padding:16px;margin-bottom:12px;text-align:center;color:var(--text2);display:flex;flex-direction:column;gap:4px}.v31-dropzone.drag{border-color:var(--accent);background:rgba(255,210,26,.08)}.v31-selection-bar{min-height:32px;display:flex;gap:8px;align-items:center;color:var(--text2);font-size:.84rem}.v31-folder-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:10px 0}.v31-folder-card{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:13px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:4px}.v31-folder-card:hover{border-color:var(--accent)}.v31-folder-card span{font-size:1.8rem}.v31-folder-card small{color:var(--text2)}.v31-days{display:flex;gap:9px;flex-wrap:wrap}.v31-days label{font-size:.85rem!important;text-transform:none!important;color:var(--text)!important}@media(max-width:800px){.v31-explorer,.v31-screen-layout{grid-template-columns:1fr}.v31-tree{max-height:220px}}`;
  document.head.appendChild(style);
})();
