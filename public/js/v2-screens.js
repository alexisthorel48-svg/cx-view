(()=>{
const esc=s=>String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
const typeLabel={FIXED:'Écran fixe',TRAILER:'Remorque',TV:'Télévision',KIOSK:'Borne',OTHER:'Autre'};
let ctx=null,workspaces=[],playlists=[];
function normalizePlaylists(payload){
 const rows=Array.isArray(payload)?payload:(Array.isArray(payload?.rows)?payload.rows:(Array.isArray(payload?.playlists)?payload.playlists:[]));
 return rows.filter(p=>p&&p.id!=null&&String(p.name||'').trim()).map(p=>({...p,id:Number(p.id),name:String(p.name).trim()}));
}
async function loadPlaylists(){
 // Source dédiée à l'affectation écran. On recharge à chaque ouverture de la configuration
 // pour ne jamais conserver une liste vide ou obsolète dans la SPA.
 try{
  playlists=normalizePlaylists(await cxApi.get('/api/v242/screen-playlists?_='+Date.now()));
 }catch(primaryError){
  console.warn('Route dédiée aux playlists écran indisponible, fallback /api/playlists',primaryError);
  playlists=normalizePlaylists(await cxApi.get('/api/playlists?_='+Date.now()));
 }
 return playlists;
}
async function load(){
 [ctx,workspaces]=await Promise.all([cxApi.get('/api/v24/context'),cxApi.get('/api/v24/workspaces')]);
 await refresh();
}
async function refresh(){
 const q=new URLSearchParams(); const search=document.querySelector('#screen-search')?.value; const type=document.querySelector('#screen-type')?.value; const status=document.querySelector('#screen-status')?.value; const ws=document.querySelector('#screen-workspace')?.value;
 if(search)q.set('search',search);if(type)q.set('type',type);if(status)q.set('status',status);if(ws)q.set('workspace_id',ws);
 const rows=await cxApi.get('/api/v24/screens?'+q.toString());
 const online=rows.filter(x=>x.online).length;
 document.querySelector('#screen-summary').innerHTML=`<strong>${rows.length}</strong> écrans · <span class="screen-ok">${online} en ligne</span> · ${rows.length-online} hors ligne`;
 document.querySelector('#screen-grid').innerHTML=rows.length?rows.map(card).join(''):'<article class="panel empty-state"><h3>Aucun écran</h3><p>Aucun écran ne correspond aux filtres actuels.</p></article>';
 document.querySelectorAll('[data-config]').forEach(b=>b.onclick=()=>openConfig(Number(b.dataset.config)));
 document.querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>assign(Number(b.dataset.assign),b.dataset.name));
 document.querySelectorAll('[data-sync]').forEach(b=>b.onclick=()=>syncScreen(Number(b.dataset.sync),'SYNC'));
 document.querySelectorAll('[data-force-sync]').forEach(b=>b.onclick=()=>syncScreen(Number(b.dataset.forceSync),'FORCE'));
 document.querySelectorAll('[data-copy-code]').forEach(b=>b.onclick=()=>copyPairingCode(b.dataset.copyCode,b));
 document.querySelectorAll('[data-qr-screen]').forEach(b=>b.onclick=()=>openQrToScreen(Number(b.dataset.qrScreen),b.dataset.name));
 document.querySelectorAll('[data-delete-screen]').forEach(b=>b.onclick=()=>deleteScreen(Number(b.dataset.deleteScreen),b.dataset.name));
}
function layoutLabel(s){return s.layout==='VERTICAL'?'2 zones côte à côte':s.layout==='HORIZONTAL'?'2 zones superposées':'Zone unique'}
function card(s){return `<article class="screen-card"><div class="screen-card-top"><span class="screen-kind">${typeLabel[s.screen_type]||s.screen_type}</span><span class="screen-state ${s.online?'online':'offline'}">${s.online?'En ligne':'Hors ligne'}</span></div><div class="screen-visual"><span>${s.screen_type==='TRAILER'?'▰':s.screen_type==='TV'?'▣':s.screen_type==='KIOSK'?'▯':'▭'}</span><small>${s.width_px} × ${s.height_px}</small></div><h3>${esc(s.name)}</h3><p>${esc(s.location_label||s.group_name||'Emplacement non renseigné')}</p><div class="screen-api-code"><span>Code d’appairage / API</span><div><code>${esc(s.pairing_code||'—')}</code><button type="button" class="copy-code-btn" data-copy-code="${esc(s.pairing_code||'')}" ${s.pairing_code?'':'disabled'}>Copier</button></div></div><dl><div><dt>Diffusion</dt><dd>${layoutLabel(s)}</dd></div><div><dt>Attribué à</dt><dd>${esc(s.assigned_workspace_name||'Non attribué')}</dd></div><div><dt>Dernier contact</dt><dd>${s.last_seen_at?new Date(s.last_seen_at).toLocaleString('fr-BE'):'Jamais'}</dd></div></dl><div class="screen-actions"><button class="primary-btn full" data-config="${s.id}">Configurer la diffusion</button><button class="ghost-btn full" data-sync="${s.id}">Synchroniser</button><button class="ghost-btn full" data-force-sync="${s.id}">Forcer la synchronisation</button><button class="ghost-btn full" data-qr-screen="${s.id}" data-name="${esc(s.name)}">QR vers cet écran</button>${ctx?.super_admin?`<button class="ghost-btn full" data-assign="${s.id}" data-name="${esc(s.name)}">Gérer l’attribution</button><button class="danger-btn full" data-delete-screen="${s.id}" data-name="${esc(s.name)}">Supprimer l’écran</button>`:''}</div></article>`}
async function copyPairingCode(code,button){if(!code)return;try{await navigator.clipboard.writeText(code);const old=button.textContent;button.textContent='Copié';setTimeout(()=>button.textContent=old,1200);cxUI.toast({type:'success',title:'Code copié',message:'Le code d’appairage '+code+' est dans le presse-papiers.'});}catch(e){window.prompt('Copie ce code d’appairage :',code);}}
async function deleteScreen(id,name){const label=name||('Écran #'+id);if(!window.confirm('Supprimer définitivement « '+label+' » ?\n\nLes programmations, commandes et données liées à cet écran seront supprimées. Cette action est irréversible.'))return;try{await cxApi.delete('/api/screens/'+id);cxUI.toast({type:'success',title:'Écran supprimé',message:label+' a été supprimé.'});await refresh();}catch(e){cxUI.toast({type:'error',title:'Suppression impossible',message:e.message});}}
async function openCreateScreen(){
 const html=`<div class="modal-backdrop" id="create-screen-modal"><form class="modal-card" id="create-screen-form"><div class="panel-head"><div><span class="eyebrow">Nouvel appareil</span><h3>Créer un écran</h3></div><button type="button" class="icon-btn" id="create-screen-close">×</button></div><label>Nom de l’écran<input name="name" required maxlength="120" placeholder="Ex. Écran vitrine Soignies"></label><div class="form-grid"><label>Largeur (px)<input name="width_px" type="number" min="100" value="1920" required></label><label>Hauteur (px)<input name="height_px" type="number" min="100" value="1080" required></label><label>Rotation<input name="orientation" type="number" min="0" max="359" value="0"></label><label>Moniteur Windows<input name="monitor_id" type="number" min="0" value="0"></label></div><label>Disposition<select name="layout"><option value="SINGLE">Zone unique</option><option value="VERTICAL">Deux zones côte à côte</option><option value="HORIZONTAL">Deux zones superposées</option></select></label><label>Mode d’affichage<select name="display_mode"><option value="WINDOW">Fenêtre</option><option value="KIOSK">Plein écran / kiosque</option></select></label><label>Fond d’attente<input name="standby_color" type="color" value="#000000"></label><div class="modal-actions"><button type="button" class="ghost-btn" id="create-screen-cancel">Annuler</button><button class="primary-btn">Créer l’écran</button></div></form></div>`;
 document.body.insertAdjacentHTML('beforeend',html);
 const modal=document.querySelector('#create-screen-modal');const form=document.querySelector('#create-screen-form');const close=()=>modal?.remove();
 document.querySelector('#create-screen-close').onclick=close;document.querySelector('#create-screen-cancel').onclick=close;
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button[type="submit"],button.primary-btn');button.disabled=true;button.textContent='Création…';try{const data=Object.fromEntries(new FormData(form));data.width_px=Number(data.width_px);data.height_px=Number(data.height_px);data.orientation=Number(data.orientation||0);data.monitor_id=Number(data.monitor_id||0);const created=await cxApi.post('/api/screens',data);close();cxUI.toast({type:'success',title:'Écran créé',message:'Le code d’appairage est '+(created.pairing_code||'disponible dans la fiche écran')+'.'});await refresh();}catch(err){button.disabled=false;button.textContent='Créer l’écran';cxUI.toast({type:'error',title:'Création impossible',message:err.message});}};
 form.querySelector('input[name="name"]').focus();
}

async function syncScreen(id,mode){try{const r=await cxApi.post('/api/v27/screens/'+id+'/sync',{mode});cxUI.toast({type:'success',title:mode==='FORCE'?'Synchronisation forcée demandée':'Synchronisation demandée',message:r.command?.realtime?'Commande envoyée immédiatement.':'Commande enregistrée pour le prochain contact.'});await refresh();}catch(e){cxUI.toast({type:'error',title:'Synchronisation impossible',message:e.message})}}
function playlistOptions(selected){return `<option value="">Aucune playlist</option>`+playlists.map(p=>`<option value="${p.id}" ${Number(selected)===Number(p.id)?'selected':''}>${esc(p.name)}${p.client_name?' · '+esc(p.client_name):''}</option>`).join('')}
function previewMarkup(s){const vertical=s.layout==='VERTICAL',horizontal=s.layout==='HORIZONTAL',single=s.layout==='SINGLE';const split=Number(s.zone_split_percent||50);return `<div class="zone-preview ${single?'single':vertical?'vertical':'horizontal'}" style="--split:${split}%"><div class="zone zone-a"><strong>${esc(s.zone_a_name||'Zone A')}</strong><small>${esc(s.playlist_a_name||'Aucune playlist')}</small></div>${single?'':`<div class="zone zone-b"><strong>${esc(s.zone_b_name||'Zone B')}</strong><small>${esc(s.playlist_b_name||'Aucune playlist')}</small></div>`}</div>`}
async function openConfig(id){
 const [s]=await Promise.all([
  cxApi.get('/api/v242/screens/'+id+'/config'),
  loadPlaylists()
 ]);
 if(!playlists.length){
  cxUI.toast({type:'warning',title:'Aucune playlist disponible',message:'La base ne renvoie actuellement aucune playlist. Vérifie la page Playlists ou les logs API.'});
 }
 const cropFields=(zone,label)=>`<div class="crop-card"><div class="crop-card-head"><strong>${label}</strong><span>Pixels à neutraliser</span></div><div class="crop-grid"><label>Haut<input name="${zone}_crop_top" type="number" min="0" value="${Number(s[zone+'_crop_top']||0)}"></label><label>Droite<input name="${zone}_crop_right" type="number" min="0" value="${Number(s[zone+'_crop_right']||0)}"></label><label>Bas<input name="${zone}_crop_bottom" type="number" min="0" value="${Number(s[zone+'_crop_bottom']||0)}"></label><label>Gauche<input name="${zone}_crop_left" type="number" min="0" value="${Number(s[zone+'_crop_left']||0)}"></label></div><label>Comportement<select name="${zone}_crop_mode"><option value="HIDE" ${s[zone+'_crop_mode']!=='FIT'?'selected':''}>Masquer sans déformer</option><option value="FIT" ${s[zone+'_crop_mode']==='FIT'?'selected':''}>Adapter à la zone restante</option></select></label></div>`;
 const html=`<div class="modal-backdrop config-backdrop" id="config-modal"><form class="modal-card config-card" id="config-form"><div class="panel-head"><div><span class="eyebrow">Screen Engine V2.4.2</span><h3>Configuration de diffusion · ${esc(s.name)}</h3></div><button type="button" class="icon-btn" id="config-close">×</button></div>
 <div class="config-layout"><div class="config-fields">
 <section class="config-section"><h4>Position du player</h4><p class="section-help">La fenêtre Windows prendra automatiquement la taille exacte de la zone de diffusion.</p><div class="form-grid"><label>Moniteur Windows<input name="monitor_id" type="number" min="0" value="${Number(s.monitor_id||0)}"></label><label>Position X<input name="window_x" type="number" value="${Number(s.window_x||0)}"></label><label>Position Y<input name="window_y" type="number" value="${Number(s.window_y||0)}"></label></div></section>
 <section class="config-section"><h4>Résolution de diffusion</h4><div class="form-grid"><label>Largeur (px)<input name="width_px" type="number" min="100" value="${Number(s.width_px||1920)}"></label><label>Hauteur (px)<input name="height_px" type="number" min="100" value="${Number(s.height_px||1080)}"></label><label>Rotation<input name="orientation" type="number" min="0" max="359" value="${Number(s.orientation||0)}"></label><label>Fond d’attente<input name="standby_color" type="color" value="${esc(s.standby_color||'#000000')}"></label></div></section>
 <section class="config-section"><h4>Zones de diffusion</h4><div class="layout-choices"><label><input type="radio" name="layout" value="SINGLE" ${s.layout==='SINGLE'?'checked':''}><span>Zone unique</span></label><label><input type="radio" name="layout" value="VERTICAL" ${s.layout==='VERTICAL'?'checked':''}><span>Split vertical</span></label><label><input type="radio" name="layout" value="HORIZONTAL" ${s.layout==='HORIZONTAL'?'checked':''}><span>Split horizontal</span></label></div><label class="split-field">Répartition de la zone A <strong id="split-value">${Number(s.zone_split_percent||50)}%</strong><input name="zone_split_percent" type="range" min="10" max="90" value="${Number(s.zone_split_percent||50)}"></label><div class="zone-settings"><div><label>Nom zone A<input name="zone_a_name" value="${esc(s.zone_a_name||'Zone A')}"></label><label>Playlist zone A<select name="playlist_a_id">${playlistOptions(s.playlist_a_id)}</select></label></div><div class="zone-b-fields"><label>Nom zone B<input name="zone_b_name" value="${esc(s.zone_b_name||'Zone B')}"></label><label>Playlist zone B<select name="playlist_b_id">${playlistOptions(s.playlist_b_id)}</select></label></div></div></section>
 <section class="config-section"><h4>Correction des LED défectueuses</h4><p class="section-help">Recadre chaque zone indépendamment. Exemple : mets <strong>16 px en bas</strong> si les 16 dernières lignes de LED ne fonctionnent plus.</p><div class="crop-settings">${cropFields('zone_a','Zone A')}<div class="zone-b-crop">${cropFields('zone_b','Zone B')}</div></div></section>
 </div><aside class="config-preview"><span class="eyebrow">Aperçu</span><div id="live-zone-preview">${previewMarkup(s)}</div><div id="crop-summary" class="crop-summary"></div><p>Position par défaut : <strong>0,0</strong>. La fenêtre est sans bordure, carrée et dimensionnée automatiquement selon la résolution ci-contre.</p></aside></div>
 <div class="modal-actions"><button type="button" class="ghost-btn" id="config-cancel">Annuler</button><button class="primary-btn">Enregistrer et synchroniser</button></div></form></div>`;
 document.body.insertAdjacentHTML('beforeend',html);const modal=document.querySelector('#config-modal');const form=document.querySelector('#config-form');const close=()=>modal.remove();document.querySelector('#config-close').onclick=close;document.querySelector('#config-cancel').onclick=close;
 const update=()=>{const fd=new FormData(form),layout=fd.get('layout'),split=Number(fd.get('zone_split_percent'));document.querySelector('#split-value').textContent=split+'%';document.querySelector('.zone-b-fields').style.display=layout==='SINGLE'?'none':'grid';document.querySelector('.zone-b-crop').style.display=layout==='SINGLE'?'none':'block';const preview={layout,zone_split_percent:split,zone_a_name:fd.get('zone_a_name'),zone_b_name:fd.get('zone_b_name'),playlist_a_name:form.playlist_a_id.selectedOptions[0]?.textContent,playlist_b_name:form.playlist_b_id.selectedOptions[0]?.textContent};document.querySelector('#live-zone-preview').innerHTML=previewMarkup(preview);const summary=['A','B'].filter(z=>z==='A'||layout!=='SINGLE').map(z=>{const p=z==='A'?'zone_a':'zone_b';const vals=['top','right','bottom','left'].map(side=>Number(fd.get(p+'_crop_'+side)||0));return `<strong>Zone ${z}</strong> : H ${vals[0]} · D ${vals[1]} · B ${vals[2]} · G ${vals[3]} px`;}).join('<br>');document.querySelector('#crop-summary').innerHTML=summary;};
 form.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',update));update();
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button.primary-btn');const original=button?.textContent;if(button){button.disabled=true;button.textContent='Enregistrement…';}try{const fd=new FormData(form),data=Object.fromEntries(fd);await cxApi.put('/api/v242/screens/'+id+'/config',data);close();cxUI.toast({type:'success',title:'Configuration enregistrée',message:'La disposition et les playlists ont été envoyées au player.'});await refresh();}catch(err){if(button){button.disabled=false;button.textContent=original||'Enregistrer';}cxUI.toast({type:'error',title:'Enregistrement impossible',message:err.hint||err.message});}};
}

async function openQrToScreen(id,name){
 let session=null,step='form';
 const render=()=>{
  document.querySelector('#qr-screen-modal')?.remove();
  const formStep=`<p class="qr-screen-hint">Génère un lien à scanner pour envoyer une photo ou une vidéo directement sur cet écran.</p>
   <form id="qr-screen-form" class="qr-screen-form"><div class="qr-screen-params">
    <label>Durée par envoi (s)<input id="qr-screen-duration" type="number" min="5" max="600" value="${session?session.duration_seconds:30}"></label>
    <label>Validité du lien (min)<input id="qr-screen-minutes" type="number" min="1" max="1440" value="${session?session.expires_in_minutes:15}"></label>
    <label>Envois maximum<input id="qr-screen-maxuses" type="number" min="1" max="500" value="${session?session.max_uses:20}"></label>
   </div><button type="submit" class="primary-btn full">${session?'Régénérer avec ces paramètres':'Générer le QR'}</button></form>`;
  const resultStep=session?`<button type="button" class="qr-back-btn" id="qr-screen-back">← Modifier les paramètres</button>
   <div class="qr-screen-preview"><img src="${esc(session.qr_svg)}" alt="QR Code pour envoyer un média sur l’écran"></div>
   <p class="qr-screen-hint"><strong>Affiche ce QR Code sur l’écran</strong> pour que le public le scanne, ou scanne-le toi-même pour tester.</p>
   <div class="qr-screen-link"><input id="qr-screen-url" value="${esc(session.url)}" readonly><button type="button" class="ghost-btn" id="qr-screen-copy">Copier</button></div>
   <p class="muted qr-screen-meta">Valable ${session.expires_in_minutes} min · ${session.max_uses} envois max · images/vidéos jusqu’à 100 Mo · affichage ${session.duration_seconds}s par envoi.</p>
   <div class="qr-screen-actions"><button type="button" class="ghost-btn" id="qr-screen-download">Télécharger</button><button type="button" class="ghost-btn" id="qr-screen-open">Tester</button></div>
   <div class="qr-screen-actions"><button type="button" class="danger-btn" id="qr-screen-hide">Masquer de l’écran</button><button type="button" class="primary-btn" id="qr-screen-display">Afficher sur l’écran</button></div>`:'';
  const html=`<div class="modal-backdrop" id="qr-screen-modal"><div class="modal-card qr-screen-card">
   <div class="panel-head"><div><span class="eyebrow">QR to Screen</span><h3>${esc(name||'Écran')}</h3></div><button type="button" class="icon-btn" id="qr-screen-close">×</button></div>
   ${step==='result'&&session?resultStep:formStep}
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  const close=()=>document.querySelector('#qr-screen-modal')?.remove();
  document.querySelector('#qr-screen-close').onclick=close;
  const form=document.querySelector('#qr-screen-form');
  if(form)form.onsubmit=async e=>{
   e.preventDefault();
   const btn=form.querySelector('button[type="submit"]');const original=btn.textContent;btn.disabled=true;btn.textContent='Génération…';
   try{
    session=await cxApi.post('/api/v2/integrations/qr_to_screen/session',{
     screen_id:id,
     duration_seconds:Number(document.querySelector('#qr-screen-duration').value)||30,
     minutes:Number(document.querySelector('#qr-screen-minutes').value)||15,
     max_uses:Number(document.querySelector('#qr-screen-maxuses').value)||20
    });
    step='result';
    render();
   }catch(err){btn.disabled=false;btn.textContent=original;cxUI.toast({type:'error',title:'QR to Screen indisponible',message:err.message})}
  };
  if(step==='result'&&session){
   document.querySelector('#qr-screen-back').onclick=()=>{step='form';render()};
   document.querySelector('#qr-screen-copy').onclick=async()=>{try{await navigator.clipboard.writeText(session.url);cxUI.toast({type:'success',title:'Lien copié',message:'Le lien QR to Screen est dans le presse-papiers.'});}catch(_){window.prompt('Copie ce lien :',session.url)}};
   document.querySelector('#qr-screen-download').onclick=()=>{const a=document.createElement('a');a.href=session.qr_svg;a.download='qr-to-screen-'+String(name||id).replace(/[^a-z0-9_-]+/gi,'-')+'.svg';a.target='_blank';a.rel='noopener';a.click()};
   document.querySelector('#qr-screen-open').onclick=()=>window.open(session.url,'_blank','noopener');
   document.querySelector('#qr-screen-display').onclick=async()=>{try{const r=await cxApi.post('/api/v2/integrations/qr_to_screen/screens/'+id+'/display',{qr_svg:session.qr_svg,url:session.url,caption:'Scannez pour envoyer une photo ou une vidéo',display_seconds:session.expires_in_minutes*60});cxUI.toast({type:'success',title:'QR affiché',message:r.realtime?'Envoyé immédiatement à l’écran.':'Sera affiché à la prochaine connexion du player.'})}catch(err){cxUI.toast({type:'error',title:'Impossible d’afficher le QR',message:err.message})}};
   document.querySelector('#qr-screen-hide').onclick=async()=>{try{await cxApi.post('/api/v2/integrations/qr_to_screen/screens/'+id+'/hide',{});cxUI.toast({type:'success',title:'QR masqué',message:'Commande envoyée à l’écran.'})}catch(err){cxUI.toast({type:'error',title:'Impossible de masquer le QR',message:err.message})}};
  }
 };
 render();
}

async function assign(id,name){
 const options=workspaces.filter(w=>w.kind!=='OWNER').map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('');
 const html=`<div class="modal-backdrop" id="assign-modal"><form class="modal-card" id="assign-form"><div class="panel-head"><div><span class="eyebrow">Attribution</span><h3>${esc(name)}</h3></div><button type="button" class="icon-btn" id="assign-close">×</button></div><label>Espace client<select name="workspace_id" required><option value="">Choisir…</option>${options}</select></label><div class="form-grid"><label>Début<input type="datetime-local" name="starts_at"></label><label>Fin<input type="datetime-local" name="ends_at"></label></div><label>Note<textarea name="notes" rows="3"></textarea></label><div class="modal-actions"><button type="button" class="danger-btn" id="unassign">Retirer</button><button class="primary-btn">Attribuer</button></div></form></div>`;document.body.insertAdjacentHTML('beforeend',html);const close=()=>document.querySelector('#assign-modal')?.remove();document.querySelector('#assign-close').onclick=close;document.querySelector('#unassign').onclick=async()=>{await cxApi.del('/api/v24/screens/'+id+'/assignment');close();refresh()};document.querySelector('#assign-form').onsubmit=async e=>{e.preventDefault();await cxApi.post('/api/v24/screens/'+id+'/assign',Object.fromEntries(new FormData(e.target)));close();refresh()};
}
window.openCreateScreen=openCreateScreen;
window.openConfig=openConfig;
window.openQrToScreen=openQrToScreen;
window.renderScreenEngine=async()=>{content.innerHTML=`<section class="hero compact"><div><span class="eyebrow">Screen Engine V2.4.2</span><h2>Écrans & appareils</h2><p>Fenêtre automatique, zones indépendantes et correction des parties LED défectueuses.</p></div><div class="hero-actions"><div id="screen-summary" class="version-badge">Chargement…</div><button id="create-screen-btn" class="primary-btn" type="button">+ Nouvel écran</button><button id="quick-qr-screen-btn" class="ghost-btn" type="button">QR to Screen</button></div></section><section class="screen-toolbar panel"><input id="screen-search" type="search" placeholder="Rechercher un écran, un code, un lieu…"><select id="screen-type"><option value="">Tous les types</option><option value="FIXED">Écrans fixes</option><option value="TRAILER">Remorques</option><option value="TV">Télévisions</option><option value="KIOSK">Bornes</option></select><select id="screen-status"><option value="">Tous les statuts</option><option value="online">En ligne</option><option value="offline">Hors ligne</option></select><select id="screen-workspace"><option value="">Tous les espaces</option></select></section><section id="screen-grid" class="screen-grid"><div class="loading-card">Chargement…</div></section>`;try{await load();const ws=document.querySelector('#screen-workspace');if(ctx?.super_admin){ws.innerHTML='<option value="">Tous les espaces</option>'+workspaces.filter(w=>w.kind!=='OWNER').map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}else ws.remove();const createBtn=document.querySelector('#create-screen-btn');const canCreateScreen=Boolean(ctx?.can_create_screen ?? ctx?.super_admin);if(canCreateScreen){createBtn.onclick=openCreateScreen}else{createBtn.remove()}document.querySelector('#quick-qr-screen-btn').onclick=async()=>{const rows=await cxApi.get('/api/v24/screens');if(!rows.length)return cxUI.toast({type:'error',title:'Aucun écran',message:'Crée d’abord un écran.'});const choices=rows.map(s=>s.id+' — '+s.name).join('\n');const picked=window.prompt('Entre l’identifiant de l’écran :\n\n'+choices,String(rows[0].id));const screen=rows.find(s=>String(s.id)===String(picked||'').trim());if(screen)openQrToScreen(screen.id,screen.name)};document.querySelectorAll('.screen-toolbar input,.screen-toolbar select').forEach(el=>el.oninput=refresh)}catch(e){showError(e)}};
})();
