let allMedia = [];
let allFolders = [];

async function loadMedia() {
  const el = document.getElementById('page-media');
  el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement...</p></div>';
  try {
    [allMedia, allFolders] = await Promise.all([GET('/api/media'), GET('/api/folders')]);
    renderMedia();
  } catch (e) { el.innerHTML = `<div class="empty"><p>${e.message}</p></div>`; }
}

function renderMedia() {
  const el = document.getElementById('page-media');
  const search = el.querySelector('#m-search')?.value || '';
  const filterType = el.querySelector('#m-type')?.value || '';
  const filterClient = el.querySelector('#m-client')?.value || '';
  const filterFolder = el.querySelector('#m-folder')?.value || '';

  const filtered = allMedia.filter(m => {
    if (filterType && m.media_type !== filterType) return false;
    if (filterClient && String(m.client_id) !== filterClient) return false;
    if (filterFolder && String(m.folder_id) !== filterFolder) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">🗂️ Médiathèque</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="openFolderForm()">📁 Nouveau dossier</button>
        <button class="btn btn-primary" onclick="openUpload()">+ Importer</button>
      </div>
    </div>
    <div class="filters-bar">
      <input id="m-search" placeholder="Rechercher..." value="${search}" oninput="renderMedia()" style="flex:1;min-width:150px;max-width:240px">
      <select id="m-type" onchange="renderMedia()">
        <option value="">Tous les types</option>
        <option value="IMAGE" ${filterType==='IMAGE'?'selected':''}>Images</option>
        <option value="VIDEO" ${filterType==='VIDEO'?'selected':''}>Vidéos</option>
      </select>
      <select id="m-client" onchange="renderMedia()">
        <option value="">Tous les clients</option>
        ${allClients.map(c=>`<option value="${c.id}" ${filterClient===String(c.id)?'selected':''}>${c.name}</option>`).join('')}
      </select>
      <select id="m-folder" onchange="renderMedia()">
        <option value="">Tous les dossiers</option>
        ${allFolders.map(f=>`<option value="${f.id}" ${filterFolder===String(f.id)?'selected':''}>${f.name}${f.client_name?' ('+f.client_name+')':''}</option>`).join('')}
      </select>
    </div>
    <div style="font-size:.8rem;color:var(--text2);margin-bottom:12px">${filtered.length} média(s) trouvé(s)</div>
    ${filtered.length === 0 ? `<div class="empty"><div class="empty-icon">🗂️</div><p>Aucun média trouvé</p><button class="btn btn-primary" onclick="openUpload()">Importer des médias</button></div>` :
    `<div class="media-grid">${filtered.map(m => {
      const thumb = m.thumbnail_name ? `<img class="media-thumb" src="/files/thumbs/${m.thumbnail_name}" alt="">` : `<div class="media-thumb-placeholder">${m.media_type==='VIDEO'?'🎬':'🖼️'}</div>`;
      return `<div class="media-card">
        ${thumb}
        <div class="media-info">
          <div class="media-title" title="${m.title}">${m.title}</div>
          <div class="media-meta">${m.media_type} · ${fmtBytes(m.bytes)}</div>
          ${m.client_name?`<div class="media-meta" style="color:var(--accent)">${m.client_name}</div>`:''}
          ${m.folder_name?`<div class="media-meta">📁 ${m.folder_name}</div>`:''}
        </div>
        <div class="actions" style="padding:0 8px 8px">
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();editMedia(${m.id})">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteMedia(${m.id})">🗑️</button>
        </div>
      </div>`;
    }).join('')}</div>`}`;
}

function openUpload() {
  openModal('Importer des médias', `
    <div class="form-group"><label>Client</label>
      <select id="u-client"><option value="">Aucun</option>${allClients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select>
    </div>
    <div class="form-group"><label>Dossier</label>
      <select id="u-folder"><option value="">Aucun</option>${allFolders.map(f=>`<option value="${f.id}">${f.name}</option>`).join('')}</select>
    </div>
    <div class="upload-zone" id="drop-zone" onclick="document.getElementById('file-input').click()"
      ondragover="event.preventDefault();this.classList.add('drag')"
      ondragleave="this.classList.remove('drag')"
      ondrop="event.preventDefault();this.classList.remove('drag');handleFiles(event.dataTransfer.files)">
      <div style="font-size:2.5rem">📁</div>
      <p>Cliquez ou glissez vos fichiers ici</p>
      <p style="font-size:.75rem;margin-top:4px;color:var(--text2)">Images et vidéos (MP4, MOV, JPG, PNG, WebP…)</p>
    </div>
    <input type="file" id="file-input" multiple accept="image/*,video/*" style="display:none" onchange="handleFiles(this.files)">
    <div id="upload-progress"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
    </div>`);
}

async function handleFiles(files) {
  const prog = document.getElementById('upload-progress');
  const clientId = document.getElementById('u-client')?.value;
  const folderId = document.getElementById('u-folder')?.value;
  prog.innerHTML = `<p style="color:var(--text2);margin:8px 0">Envoi de ${files.length} fichier(s)...</p>`;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  if (clientId) fd.append('client_id', clientId);
  if (folderId) fd.append('folder_id', folderId);
  try {
    const results = await api('POST', '/api/media/upload', fd);
    const ok = results.filter(r=>r.ok).length;
    const fail = results.filter(r=>!r.ok).length;
    prog.innerHTML = `<p style="color:var(--success);margin:8px 0">✅ ${ok} fichier(s) importé(s)${fail?` · ❌ ${fail} échec(s)`:''}</p>`;
    allMedia = await GET('/api/media');
    renderMedia();
  } catch (e) {
    prog.innerHTML = `<p style="color:var(--danger);margin:8px 0">Erreur : ${e.message}</p>`;
  }
}

function editMedia(id) {
  const m = allMedia.find(x=>x.id===id);
  openModal('Modifier le média', `
    <div class="form-group"><label>Titre</label><input id="em-title" value="${m.title}"></div>
    <div class="form-group"><label>Client</label>
      <select id="em-client"><option value="">Aucun</option>${allClients.map(c=>`<option value="${c.id}" ${m.client_id===c.id?'selected':''}>${c.name}</option>`).join('')}</select>
    </div>
    <div class="form-group"><label>Dossier</label>
      <select id="em-folder"><option value="">Aucun</option>${allFolders.map(f=>`<option value="${f.id}" ${m.folder_id===f.id?'selected':''}>${f.name}</option>`).join('')}</select>
    </div>
    <div class="form-group"><label><input type="checkbox" id="em-keep" ${m.keep_forever?'checked':''}> Conserver définitivement</label></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="saveMedia(${id})">Enregistrer</button>
    </div>`);
}

async function saveMedia(id) {
  try {
    await PUT(`/api/media/${id}`, {
      title: document.getElementById('em-title').value,
      client_id: document.getElementById('em-client').value || null,
      folder_id: document.getElementById('em-folder').value || null,
      keep_forever: document.getElementById('em-keep').checked
    });
    closeModal(); toast('Média mis à jour');
    allMedia = await GET('/api/media'); renderMedia();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteMedia(id) {
  if (!confirm('Supprimer ce média ? Cette action est irréversible.')) return;
  try { await DEL(`/api/media/${id}`); toast('Média supprimé'); allMedia = await GET('/api/media'); renderMedia(); }
  catch (e) { toast(e.message, 'error'); }
}

function openFolderForm() {
  openModal('Nouveau dossier', `
    <div class="form-group"><label>Nom *</label><input id="f-name" placeholder="Nom du dossier"></div>
    <div class="form-group"><label>Client</label>
      <select id="f-client"><option value="">Aucun</option>${allClients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="saveFolder()">Créer</button>
    </div>`);
}

async function saveFolder() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { toast('Le nom est requis', 'error'); return; }
  try {
    await POST('/api/folders', { name, client_id: document.getElementById('f-client').value || null });
    closeModal(); toast('Dossier créé');
    allFolders = await GET('/api/folders'); renderMedia();
  } catch (e) { toast(e.message, 'error'); }
}
