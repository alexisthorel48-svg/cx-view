let allPlaylists2 = [];
let currentPlaylistId = null;
let currentItems = [];

async function loadPlaylists() {
  const el = document.getElementById('page-playlists');
  el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement...</p></div>';
  try {
    [allPlaylists2] = await Promise.all([GET('/api/playlists')]);
    if (currentPlaylistId) renderPlaylistEditor();
    else renderPlaylistList();
  } catch (e) { el.innerHTML = `<div class="empty"><p>${e.message}</p></div>`; }
}

function renderPlaylistList() {
  currentPlaylistId = null;
  const el = document.getElementById('page-playlists');
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">▶️ Playlists</h1>
      <button class="btn btn-primary" onclick="openPlaylistForm()">+ Nouvelle playlist</button>
    </div>
    ${allPlaylists2.length === 0 ? `<div class="empty"><div class="empty-icon">▶️</div><p>Aucune playlist</p><button class="btn btn-primary" onclick="openPlaylistForm()">Créer la première playlist</button></div>` :
    `<div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th>Client</th><th>Éléments</th><th>Créée le</th><th>Actions</th></tr></thead>
      <tbody>${allPlaylists2.map(p => `<tr>
        <td><strong style="cursor:pointer;color:var(--accent)" onclick="openPlaylistEditor(${p.id})">${p.name}</strong></td>
        <td>${p.client_name||'—'}</td><td>${p.item_count} élément(s)</td><td>${fmtDate(p.created_at)}</td>
        <td><div class="actions"><button class="btn btn-sm btn-primary" onclick="openPlaylistEditor(${p.id})">✏️ Éditer</button><button class="btn btn-sm btn-danger" onclick="deletePlaylist(${p.id})">🗑️</button></div></td>
      </tr>`).join('')}</tbody>
    </table></div>`}`;
}

async function openPlaylistEditor(id) {
  currentPlaylistId = id;
  currentItems = await GET(`/api/playlists/${id}/items`);
  renderPlaylistEditor();
}

function renderPlaylistEditor() {
  const pl = allPlaylists2.find(p => p.id === currentPlaylistId);
  const el = document.getElementById('page-playlists');
  const totalDur = currentItems.reduce((a,i)=>a+(Number(i.duration_seconds)||0),0);
  el.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="renderPlaylistList()">← Retour</button>
        <h1 class="page-title">▶️ ${pl?.name || 'Playlist'}</h1>
        ${pl?.client_name ? `<span class="badge badge-blue">${pl.client_name}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="addWidget()">🧩 Widget</button>
        <button class="btn btn-primary" onclick="openPicker(addMediaItems)">🖼️ Ajouter médias</button>
        <button class="btn btn-primary" onclick="publishPlaylist(${currentPlaylistId})">📡 Publier</button>
      </div>
    </div>
    <div style="color:var(--text2);font-size:.85rem;margin-bottom:12px">
      ${currentItems.length} élément(s) · Durée totale : ${totalDur}s (${Math.floor(totalDur/60)} min ${totalDur%60}s)
    </div>
    <div class="timeline" id="timeline">
      ${currentItems.length === 0 ? `<div class="empty"><div class="empty-icon">▶️</div><p>Aucun élément</p></div>` : currentItems.map((item, idx) => renderTimelineItem(item, idx)).join('')}
    </div>`;
  initDragDrop();
}

function widgetIcon(type) {
  return ({CLOCK:'🕐', WEATHER:'🌤️', COUNTDOWN:'⏳', TICKER:'📰', QRCODE:'📱', WEBPAGE:'🌐', RSS:'📡'})[type] || '🧩';
}
function widgetLabel(type) {
  return ({CLOCK:'Horloge', WEATHER:'Météo', COUNTDOWN:'Compte à rebours', TICKER:'Texte défilant', QRCODE:'QR Code', WEBPAGE:'Aperçu web', RSS:'Flux RSS'})[type] || type;
}
function widgetSummary(item) {
  const c = item.widget_config || {};
  if (item.widget_type === 'WEATHER') return c.city ? `📍 ${c.city}` : 'Ville non configurée';
  if (item.widget_type === 'CLOCK') return `${c.timezone || 'Europe/Brussels'} · ${c.showDate ? 'date + heure' : 'heure'}`;
  if (item.widget_type === 'COUNTDOWN') return c.label || 'Compte à rebours';
  if (item.widget_type === 'TICKER') return c.text || 'Texte non configuré';
  if (item.widget_type === 'QRCODE') return c.url || 'URL non configurée';
  if (item.widget_type === 'WEBPAGE' || item.widget_type === 'RSS') return c.url || 'URL non configurée';
  return '';
}

function renderTimelineItem(item, idx) {
  const thumb = item.thumbnail_name ? `<img class="timeline-thumb" src="/files/thumbs/${item.thumbnail_name}" alt="">` :
    item.item_type === 'WIDGET' ? (() => {
      const cfg = item.widget_config || {};
      const sizes = { small:'1rem', normal:'1.5rem', large:'2rem', xlarge:'2.4rem' };
      const background = cfg.background || '#1e293b';
      const color = cfg.color || '#ffffff';
      const fontSize = sizes[cfg.size] || sizes.normal;
      const label = item.widget_type === 'WEATHER' && cfg.city ? cfg.city :
        item.widget_type === 'CLOCK' ? '12:34' :
        item.widget_type === 'TICKER' && cfg.text ? cfg.text :
        widgetIcon(item.widget_type);
      return `<div class="timeline-thumb" title="${widgetLabel(item.widget_type)}" style="display:flex;align-items:center;justify-content:center;padding:6px;text-align:center;overflow:hidden;line-height:1.1;font-size:${fontSize};background:${background};color:${color}">${label}</div>`;
    })() :
    `<div class="timeline-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;background:var(--surface2)">🎬</div>`;
  const schedule = item.schedule_time_from ? `⏰ ${item.schedule_time_from}–${item.schedule_time_to||''}` :
    item.schedule_days && item.schedule_days !== 'all' ? `⏰ ${item.schedule_days}` : '';
  const priority = item.is_priority ? `<span class="priority-badge">★ Prioritaire${item.priority_interval_minutes ? ' · 1/'+item.priority_interval_minutes+'min' : ''}</span>` : '';
  const summary = item.item_type === 'WIDGET' ? `<div class="timeline-schedule">${widgetSummary(item)}</div>` : '';
  return `<div class="timeline-item" draggable="true" data-id="${item.id}" data-idx="${idx}" ${!item.active?'style="opacity:.5"':''}>
    <span class="drag-handle">⠿</span>${thumb}
    <div class="timeline-info">
      <div class="timeline-title">${item.title || widgetLabel(item.widget_type)}</div>
      <div class="timeline-meta">${item.item_type === 'WIDGET' ? 'Widget · '+widgetLabel(item.widget_type) : item.media_type || ''} ${priority}</div>
      ${summary}${schedule ? `<div class="timeline-schedule">${schedule}</div>` : ''}
    </div>
    <span class="timeline-duration">${item.duration_seconds}s</span>
    <div class="timeline-actions">
      <button class="btn btn-sm btn-secondary" onclick="editTimelineItem(${item.id})" title="Modifier">✏️</button>
      <button class="btn btn-sm btn-secondary" onclick="toggleItemActive(${item.id},${!item.active})" title="${item.active?'Désactiver':'Activer'}">${item.active?'⏸':'▶'}</button>
      <button class="btn btn-sm btn-danger" onclick="removeItem(${item.id})" title="Supprimer">✕</button>
    </div>
  </div>`;
}

function initDragDrop() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;
  let dragIdx = null;
  timeline.querySelectorAll('.timeline-item').forEach(item => {
    item.addEventListener('dragstart', e => { dragIdx = Number(item.dataset.idx); item.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); timeline.querySelectorAll('.timeline-item').forEach(i=>i.classList.remove('drag-over')); });
    item.addEventListener('dragover', e => { e.preventDefault(); timeline.querySelectorAll('.timeline-item').forEach(i=>i.classList.remove('drag-over')); item.classList.add('drag-over'); });
    item.addEventListener('drop', async e => {
      e.preventDefault();
      const targetIdx = Number(item.dataset.idx);
      if (dragIdx === null || dragIdx === targetIdx) return;
      const next = [...currentItems]; const [moved] = next.splice(dragIdx,1); next.splice(targetIdx,0,moved);
      try {
        await POST(`/api/playlists/${currentPlaylistId}/reorder`, {order: next.map((it,i)=>({id:it.id,position:i}))});
        currentItems = await GET(`/api/playlists/${currentPlaylistId}/items`);
        renderPlaylistEditor(); toast('Ordre sauvegardé');
      } catch(err) { toast(err.message,'error'); }
    });
  });
}

async function addMediaItems(selected) {
  for (let i=0;i<selected.length;i++) await POST(`/api/playlists/${currentPlaylistId}/items`, {item_type:'MEDIA',media_id:selected[i].id,position:currentItems.length+i,duration_seconds:10});
  currentItems=await GET(`/api/playlists/${currentPlaylistId}/items`); renderPlaylistEditor(); toast(`${selected.length} média(s) ajouté(s)`);
}

function styleFields(c={}) {
  return `<div style="font-size:.85rem;color:var(--text2);font-weight:600;margin:12px 0 8px">STYLE</div>
    <div class="form-row">
      <div class="form-group"><label>Fond</label><input id="wc-background" type="color" value="${c.background||'#0f1923'}" oninput="updateWidgetStylePreview()"></div>
      <div class="form-group"><label>Texte</label><input id="wc-color" type="color" value="${c.color||'#ffffff'}" oninput="updateWidgetStylePreview()"></div>
      <div class="form-group"><label>Taille</label><select id="wc-size" onchange="updateWidgetStylePreview()"><option value="small" ${c.size==='small'?'selected':''}>Petite</option><option value="normal" ${!c.size||c.size==='normal'?'selected':''}>Normale</option><option value="large" ${c.size==='large'?'selected':''}>Grande</option></select></div>
    </div>
    <div id="widget-style-preview" style="margin-top:8px;min-height:68px;padding:12px 16px;border:1px solid rgba(255,255,255,.14);border-radius:6px;display:flex;align-items:center;justify-content:center;text-align:center">
      Aperçu du widget
    </div>`;
}

function updateWidgetStylePreview() {
  const preview = document.getElementById('widget-style-preview');
  if (!preview) return;
  const value = id => document.getElementById(id)?.value || '';
  const bg = value('wc-background') || '#0f1923';
  const color = value('wc-color') || '#ffffff';
  const sizeMap = { small: '15px', normal: '20px', large: '28px' };
  const size = sizeMap[value('wc-size')] || sizeMap.normal;
  const city = value('wc-city') || 'Ville';
  const text = value('wc-text') || 'Texte défilant';
  const caption = value('wc-caption') || 'Scannez-moi';
  const label = value('wc-label') || '00:00:00';
  const url = value('wc-url') || 'https://…';

  let sample = '🧩 Aperçu du widget';
  if (document.getElementById('wc-city')) sample = `🌤️ ${city} · 18°C`;
  else if (document.getElementById('wc-tz')) sample = '🕐 lundi 20 juillet · 14:30';
  else if (document.getElementById('wc-target')) sample = `⏳ ${label}`;
  else if (document.getElementById('wc-text')) sample = `📰 ${text}`;
  else if (document.getElementById('wc-caption')) sample = `▣ ${caption}`;
  else if (document.getElementById('wc-url')) sample = `🌐 ${url}`;

  preview.style.background = bg;
  preview.style.color = color;
  preview.style.fontSize = size;
  preview.textContent = sample;
}

function bindWidgetStylePreview() {
  const body = document.getElementById('modal-body');
  if (!body || body.dataset.widgetPreviewBound === '1') {
    updateWidgetStylePreview();
    return;
  }
  body.dataset.widgetPreviewBound = '1';
  body.querySelectorAll('input,select,textarea').forEach(el => {
    el.addEventListener('input', updateWidgetStylePreview);
    el.addEventListener('change', updateWidgetStylePreview);
  });
  updateWidgetStylePreview();
}

function widgetFields(type, c={}) {
  const esc = v => String(v||'').replace(/"/g,'&quot;');
  let fields = '';
  if (type==='CLOCK') fields = `<div class="form-group"><label>Fuseau horaire</label><input id="wc-tz" value="${esc(c.timezone||'Europe/Brussels')}" placeholder="Europe/Brussels"></div>
    <div class="form-row"><div class="form-group"><label>Format</label><select id="wc-fmt"><option value="24h" ${c.format!=='12h'?'selected':''}>24 h</option><option value="12h" ${c.format==='12h'?'selected':''}>12 h</option></select></div>
    <div class="form-group"><label>&nbsp;</label><label><input id="wc-show-date" type="checkbox" ${c.showDate?'checked':''}> Afficher la date</label></div></div>`;
  else if (type==='WEATHER') fields = `<div class="form-row"><div class="form-group"><label>Ville *</label><input id="wc-city" value="${esc(c.city)}" placeholder="Ex. Soignies"></div><div class="form-group"><label>Unité</label><select id="wc-unit"><option value="C" ${c.unit!=='F'?'selected':''}>°C</option><option value="F" ${c.unit==='F'?'selected':''}>°F</option></select></div></div>`;
  else if (type==='COUNTDOWN') fields = `<div class="form-group"><label>Date / heure cible *</label><input id="wc-target" type="datetime-local" value="${esc(c.target)}"></div><div class="form-group"><label>Libellé</label><input id="wc-label" value="${esc(c.label||'Compte à rebours')}"></div>`;
  else if (type==='TICKER') fields = `<div class="form-group"><label>Texte *</label><textarea id="wc-text" rows="2">${c.text||''}</textarea></div><div class="form-row"><div class="form-group"><label>Vitesse</label><select id="wc-speed"><option value="slow" ${c.speed==='slow'?'selected':''}>Lente</option><option value="medium" ${!c.speed||c.speed==='medium'?'selected':''}>Normale</option><option value="fast" ${c.speed==='fast'?'selected':''}>Rapide</option></select></div><div class="form-group"><label>Direction</label><select id="wc-direction"><option value="left" ${c.direction!=='right'?'selected':''}>Droite → gauche</option><option value="right" ${c.direction==='right'?'selected':''}>Gauche → droite</option></select></div></div>`;
  else if (type==='QRCODE') fields = `<div class="form-group"><label>URL *</label><input id="wc-url" type="url" value="${esc(c.url)}" placeholder="https://..."></div><div class="form-group"><label>Légende</label><input id="wc-caption" value="${esc(c.caption)}" placeholder="Scannez-moi"></div>`;
  else if (type==='WEBPAGE') fields = `<div class="form-group"><label>URL *</label><input id="wc-url" type="url" value="${esc(c.url)}" placeholder="https://..."></div><div class="form-group"><label>Rafraîchissement (secondes)</label><input id="wc-refresh" type="number" value="${c.refresh||60}" min="10"></div>`;
  else if (type==='RSS') fields = `<div class="form-group"><label>URL du flux RSS *</label><input id="wc-url" type="url" value="${esc(c.url)}" placeholder="https://..."></div>`;
  return fields + styleFields(c);
}

function addWidget() {
  openModal('Ajouter un widget', `
    <div class="form-group"><label>Type de widget</label><select id="w-type" onchange="renderWidgetConfig()">
      <option value="CLOCK">🕐 Horloge / Date</option><option value="WEATHER">🌤️ Météo</option><option value="COUNTDOWN">⏳ Compte à rebours</option>
      <option value="TICKER">📰 Texte défilant</option><option value="QRCODE">📱 QR Code</option><option value="WEBPAGE">🌐 Aperçu web</option><option value="RSS">📡 Flux RSS</option>
    </select></div>
    <div class="form-row"><div class="form-group"><label>Durée d'affichage (secondes)</label><input id="w-dur" type="number" value="15" min="1"></div>
    <div class="form-group"><label>&nbsp;</label><label><input id="w-forever" type="checkbox"> Jouer en continu</label></div></div>
    <div id="w-config"></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="saveWidget()">Ajouter</button></div>`);
  renderWidgetConfig();
  setTimeout(bindWidgetStylePreview, 0);
}
function renderWidgetConfig() {
  const type=document.getElementById('w-type')?.value;
  const node=document.getElementById('w-config');
  if(node) node.innerHTML=widgetFields(type,{});
  setTimeout(bindWidgetStylePreview, 0);
}
function getWidgetConfig(type) {
  const val=id=>document.getElementById(id)?.value?.trim() || '';
  const cfg={background: val('wc-background') || '#0f1923', color: val('wc-color') || '#ffffff', size: val('wc-size') || 'normal'};
  if(type==='CLOCK') Object.assign(cfg,{timezone:val('wc-tz')||'Europe/Brussels',format:val('wc-fmt')||'24h',showDate:!!document.getElementById('wc-show-date')?.checked});
  if(type==='WEATHER') Object.assign(cfg,{city:val('wc-city'),unit:val('wc-unit')||'C'});
  if(type==='COUNTDOWN') Object.assign(cfg,{target:val('wc-target'),label:val('wc-label')||'Compte à rebours'});
  if(type==='TICKER') Object.assign(cfg,{text:val('wc-text'),speed:val('wc-speed')||'medium',direction:val('wc-direction')||'left'});
  if(type==='QRCODE') Object.assign(cfg,{url:val('wc-url'),caption:val('wc-caption')});
  if(type==='WEBPAGE') Object.assign(cfg,{url:val('wc-url'),refresh:Number(val('wc-refresh'))||60});
  if(type==='RSS') Object.assign(cfg,{url:val('wc-url')});
  return cfg;
}
function validateWidget(type,cfg) {
  const required={WEATHER:'city',COUNTDOWN:'target',TICKER:'text',QRCODE:'url',WEBPAGE:'url',RSS:'url'};
  if(required[type] && !cfg[required[type]]) { toast('Le champ requis doit être renseigné', 'error'); return false; }
  return true;
}
async function saveWidget() {
  const type=document.getElementById('w-type').value;
  const cfg=getWidgetConfig(type);
  if(!validateWidget(type,cfg)) return;
  try {
    await POST(`/api/playlists/${currentPlaylistId}/items`, {item_type:'WIDGET',widget_type:type,widget_config:cfg,position:currentItems.length,duration_seconds:Number(document.getElementById('w-dur').value)||15,play_forever:!!document.getElementById('w-forever')?.checked});
    closeModal(); currentItems=await GET(`/api/playlists/${currentPlaylistId}/items`); renderPlaylistEditor(); toast('Widget ajouté');
  } catch(e){toast(e.message,'error');}
}

function editTimelineItem(id) {
  const item=currentItems.find(i=>i.id===id); const wc=item.widget_config||{};
  openModal('Modifier l’élément', `
    <div class="form-row"><div class="form-group"><label>Durée (secondes)</label><input id="ei-dur" type="number" value="${item.duration_seconds}" min="1"></div>
    <div class="form-group"><label>&nbsp;</label><label><input type="checkbox" id="ei-forever" ${item.play_forever?'checked':''}> Jouer en continu</label></div></div>
    ${item.item_type==='WIDGET'?`<div style="font-size:.85rem;color:var(--text2);font-weight:600;margin:12px 0 8px">CONFIGURATION DU WIDGET</div>${widgetFields(item.widget_type,wc)}`:''}
    <div style="font-size:.85rem;color:var(--text2);font-weight:600;margin:12px 0 8px">PRIORITÉ</div>
    <div class="form-group"><label><input type="checkbox" id="ei-priority" ${item.is_priority?'checked':''}> Média prioritaire</label></div>
    <div id="priority-fields" style="${item.is_priority?'':'display:none'}"><div class="form-row"><div class="form-group"><label>Passages minimum</label><input id="ei-pcount" type="number" value="${item.priority_count||1}" min="1"></div><div class="form-group"><label>Par X minutes</label><input id="ei-pinterval" type="number" value="${item.priority_interval_minutes||10}" min="1"></div></div></div>
    <div style="font-size:.85rem;color:var(--text2);font-weight:600;margin:12px 0 8px">PROGRAMMATION (optionnel)</div>
    <div class="form-row"><div class="form-group"><label>Début</label><input id="ei-start" type="datetime-local" value="${item.schedule_start?item.schedule_start.substring(0,16):''}"></div><div class="form-group"><label>Fin</label><input id="ei-end" type="datetime-local" value="${item.schedule_end?item.schedule_end.substring(0,16):''}"></div></div>
    <div class="form-group"><label>Jours</label><select id="ei-days"><option value="all" ${!item.schedule_days||item.schedule_days==='all'?'selected':''}>Tous les jours</option><option value="mon,tue,wed,thu,fri" ${item.schedule_days==='mon,tue,wed,thu,fri'?'selected':''}>Lundi–Vendredi</option><option value="sat,sun" ${item.schedule_days==='sat,sun'?'selected':''}>Week-end</option></select></div>
    <div class="form-row"><div class="form-group"><label>Heure début</label><input id="ei-from" type="time" value="${item.schedule_time_from||''}"></div><div class="form-group"><label>Heure fin</label><input id="ei-to" type="time" value="${item.schedule_time_to||''}"></div></div>
    <div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="saveTimelineItem(${id})">Enregistrer</button></div>`);
  document.getElementById('ei-priority')?.addEventListener('change',function(){document.getElementById('priority-fields').style.display=this.checked?'':'none';});
  setTimeout(bindWidgetStylePreview, 0);
}
async function saveTimelineItem(id) {
  const item=currentItems.find(i=>i.id===id); const isPriority=!!document.getElementById('ei-priority')?.checked;
  const widget_config=item.item_type==='WIDGET'?getWidgetConfig(item.widget_type):(item.widget_config||{});
  if(item.item_type==='WIDGET' && !validateWidget(item.widget_type,widget_config)) return;
  try {
    await PUT(`/api/playlists/${currentPlaylistId}/items/${id}`, {
      duration_seconds:Number(document.getElementById('ei-dur').value)||10,position:item.position,active:item.active,
      schedule_start:document.getElementById('ei-start').value||null,schedule_end:document.getElementById('ei-end').value||null,
      schedule_days:document.getElementById('ei-days').value,schedule_time_from:document.getElementById('ei-from').value||null,schedule_time_to:document.getElementById('ei-to').value||null,
      widget_config,play_forever:!!document.getElementById('ei-forever')?.checked,is_priority:isPriority,priority_count:Number(document.getElementById('ei-pcount')?.value)||1,priority_interval_minutes:Number(document.getElementById('ei-pinterval')?.value)||null
    });
    closeModal(); currentItems=await GET(`/api/playlists/${currentPlaylistId}/items`); renderPlaylistEditor(); toast('Élément mis à jour');
  } catch(e){toast(e.message,'error');}
}
async function toggleItemActive(id,active){const item=currentItems.find(i=>i.id===id);await PUT(`/api/playlists/${currentPlaylistId}/items/${id}`,{...item,active,widget_config:item.widget_config||{}});currentItems=await GET(`/api/playlists/${currentPlaylistId}/items`);renderPlaylistEditor();}
async function removeItem(id){if(!confirm('Retirer cet élément ?'))return;await DEL(`/api/playlists/${currentPlaylistId}/items/${id}`);currentItems=await GET(`/api/playlists/${currentPlaylistId}/items`);renderPlaylistEditor();}

function openPlaylistForm(pl) {
  openModal(pl?'Modifier la playlist':'Nouvelle playlist',`<div class="form-group"><label>Nom *</label><input id="pl-name" value="${pl?.name||''}" placeholder="Nom de la playlist"></div><div class="form-group"><label>Client</label><select id="pl-client"><option value="">Aucun</option>${(window.allClients||[]).map(c=>`<option value="${c.id}" ${pl?.client_id===c.id?'selected':''}>${c.name}</option>`).join('')}</select></div><div class="form-group"><label>Description</label><textarea id="pl-desc" rows="2">${pl?.description||''}</textarea></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="savePlaylist(${pl?.id||'null'})">Enregistrer</button></div>`);
}
async function savePlaylist(id) {
  const name=document.getElementById('pl-name').value.trim(); if(!name){toast('Le nom est requis','error');return;}
  try{if(id)await PUT(`/api/playlists/${id}`,{name,client_id:document.getElementById('pl-client').value||null,description:document.getElementById('pl-desc').value});else await POST('/api/playlists',{name,client_id:document.getElementById('pl-client').value||null,description:document.getElementById('pl-desc').value});closeModal();allPlaylists2=await GET('/api/playlists');renderPlaylistList();toast('Playlist enregistrée');}catch(e){toast(e.message,'error');}
}
async function deletePlaylist(id){if(!confirm('Supprimer cette playlist ?'))return;try{await DEL(`/api/playlists/${id}`);allPlaylists2=await GET('/api/playlists');renderPlaylistList();toast('Playlist supprimée');}catch(e){toast(e.message,'error');}}
async function publishPlaylist(id) {
  if(!id){toast('Ouvre une playlist avant de publier','error');return;}
  try{const r=await POST('/api/playlists/'+id+'/publish');const names=(r.screens||[]).map(s=>s.name).join(', ');toast(names?'Publié sur : '+names:'Aucun écran assigné à cette playlist');}catch(e){toast(e.message,'error');}
}
window.publishPlaylist=publishPlaylist;
