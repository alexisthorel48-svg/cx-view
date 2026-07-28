(function(){
  const state={folders:[],media:[],current:null,selected:new Set(),view:'grid',search:'',sort:'recent'};
  const esc=s=>window.cxUI?.escape?cxUI.escape(s):String(s??'');
  const bytes=n=>{n=Number(n||0);if(!n)return '0 o';const u=['o','Ko','Mo','Go'];const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),3);return `${(n/1024**i).toFixed(i?1:0)} ${u[i]}`};
  const date=v=>v?new Intl.DateTimeFormat('fr-BE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'—';
  const mediaUrl=f=>f.file_name?`/files/uploads/${encodeURIComponent(f.file_name)}`:'';
  const thumbUrl=f=>f.thumbnail_name?`/files/thumbs/${encodeURIComponent(f.thumbnail_name)}`:(f.media_type==='IMAGE'?mediaUrl(f):'');
  const currentFolder=()=>state.folders.find(f=>Number(f.id)===Number(state.current))||null;
  const childFolders=()=>state.folders.filter(f=>(f.parent_id??null)===(state.current??null));
  const folderChildren=id=>state.folders.filter(f=>Number(f.parent_id)===Number(id));
  const visibleMedia=()=>{
    if(state.current===null)return [];
    const q=state.search.trim().toLowerCase();
    return state.media.filter(m=>Number(m.folder_id)===Number(state.current)&&(!q||`${m.title||''} ${m.original_name||''} ${m.client_name||''}`.toLowerCase().includes(q)))
      .sort((a,b)=>state.sort==='name'?String(a.title||a.original_name).localeCompare(String(b.title||b.original_name),'fr'):(new Date(b.created_at)-new Date(a.created_at)));
  };
  const selectedMedia=()=>state.media.filter(m=>state.selected.has(Number(m.id)));

  async function load(){
    document.getElementById('content').innerHTML=cxUI.loading('Chargement de la médiathèque…');
    try{
      [state.folders,state.media]=await Promise.all([cxApi.get('/api/v31/folders'),cxApi.get('/api/v31/media')]);
      state.current=null;state.selected.clear();render();
    }catch(e){document.getElementById('content').innerHTML=`<div class="error-state"><h3>Médiathèque indisponible</h3><p>${esc(e.message)}</p><button class="primary-btn" onclick="renderMediaFinder()">Réessayer</button></div>`}
  }

  function treeNode(folder,depth=0){
    const kids=folderChildren(folder.id);
    return `<button class="mf-tree-item ${Number(state.current)===Number(folder.id)?'active':''}" data-folder="${folder.id}" style="--depth:${depth}"><span>${kids.length?'▸':'·'}</span><b>▰</b><em>${esc(folder.name)}</em><small>${Number(folder.media_count||0)}</small></button>${kids.map(k=>treeNode(k,depth+1)).join('')}`;
  }
  function tree(){return state.folders.filter(f=>!f.parent_id).map(f=>treeNode(f)).join('')||'<div class="mf-tree-empty">Aucun dossier</div>'}
  function breadcrumbs(){
    const chain=[];let f=currentFolder();
    while(f){chain.unshift(f);f=state.folders.find(x=>Number(x.id)===Number(f.parent_id));}
    return `<button data-breadcrumb="root">Médiathèque</button>${chain.map(x=>`<span>›</span><button data-breadcrumb="${x.id}">${esc(x.name)}</button>`).join('')}`;
  }
  function folderCard(f){
    const count=Number(f.media_count||0),children=Number(f.child_count||0);
    return `<article class="mf-item mf-folder" data-folder-open="${f.id}"><div class="mf-folder-icon">▰</div><div class="mf-item-copy"><strong>${esc(f.name)}</strong><span>${count} média${count!==1?'s':''}${children?` · ${children} sous-dossier${children!==1?'s':''}`:''}${f.client_name?` · ${esc(f.client_name)}`:''}</span></div><button class="mf-more" data-folder-menu="${f.id}" aria-label="Actions du dossier">•••</button></article>`;
  }
  function mediaCard(m){
    const sel=state.selected.has(Number(m.id));
    const thumb=thumbUrl(m);
    return `<article class="mf-item mf-file ${sel?'selected':''}" data-media-id="${m.id}"><div class="mf-select-mark">${sel?'✓':''}</div><div class="mf-thumb">${thumb?`<img src="${thumb}" alt="" loading="lazy">`:`<span>${m.media_type==='VIDEO'?'▶':'▧'}</span>`}<i>${m.media_type==='VIDEO'?'VIDÉO':'IMAGE'}</i></div><div class="mf-item-copy"><strong>${esc(m.title||m.original_name)}</strong><span>${bytes(m.bytes)}${m.client_name?` · ${esc(m.client_name)}`:''}</span></div><button class="mf-more" data-media-menu="${m.id}" aria-label="Actions du média">•••</button></article>`;
  }
  function details(){
    const items=selectedMedia();
    if(!items.length)return `<div class="mf-details-empty"><div>◎</div><h3>Aucune sélection</h3><p>Sélectionnez un média pour afficher ses informations.</p></div>`;
    if(items.length>1)return `<div class="mf-details-empty mf-multi"><div>${items.length}</div><h3>Médias sélectionnés</h3><p>Déplacez ou supprimez toute la sélection en une seule action.</p><button class="cx-btn cx-btn-ghost" id="mf-move-selected">Déplacer</button><button class="cx-btn cx-btn-danger" id="mf-delete-selected-side">Supprimer la sélection</button></div>`;
    const m=items[0];
    return `<div class="mf-preview">${m.media_type==='VIDEO'?`<video controls preload="metadata" poster="${thumbUrl(m)}" src="${mediaUrl(m)}"></video>`:`<img src="${mediaUrl(m)}" alt="">`}</div><div class="mf-details-title"><div><h3>${esc(m.title||m.original_name)}</h3><span>${esc(m.media_type||'MÉDIA')}</span></div><button class="mf-more" data-media-menu="${m.id}">•••</button></div><dl class="mf-meta"><div><dt>Nom du fichier</dt><dd>${esc(m.original_name||m.file_name)}</dd></div><div><dt>Poids</dt><dd>${bytes(m.bytes)}</dd></div><div><dt>Type</dt><dd>${esc(m.mime_type||m.media_type)}</dd></div><div><dt>Dossier</dt><dd>${esc(m.folder_path||m.folder_name||'Racine')}</dd></div><div><dt>Client</dt><dd>${esc(m.client_name||'Non attribué')}</dd></div><div><dt>Ajouté</dt><dd>${date(m.created_at)}</dd></div></dl><div class="mf-detail-actions"><button class="cx-btn cx-btn-ghost" data-rename-media="${m.id}">Renommer</button><button class="cx-btn cx-btn-danger" data-delete-media="${m.id}">Supprimer</button></div>`;
  }
  function selectionBar(){
    const count=state.selected.size;if(!count)return '';
    return `<div class="mf-selection-bar"><strong>${count} média${count>1?'s':''} sélectionné${count>1?'s':''}</strong><div>${count===1?'<button class="cx-btn cx-btn-ghost" id="mf-rename-selected">Renommer</button>':''}<button class="cx-btn cx-btn-ghost" id="mf-move-selected-top">Déplacer</button><button class="cx-btn cx-btn-danger" id="mf-delete-selected">Supprimer</button><button class="icon-btn" id="mf-clear-selection" title="Annuler la sélection">×</button></div></div>`;
  }

  function render(){
    const folders=childFolders(),files=visibleMedia(),isRoot=state.current===null;
    document.getElementById('content').innerHTML=`<section class="mf-shell">
      <aside class="mf-nav"><div class="mf-nav-head"><strong>Bibliothèque</strong><button class="icon-btn" id="mf-new-folder" title="Nouveau dossier">＋</button></div><button class="mf-special ${isRoot?'active':''}" data-folder-root><span>▦</span>Tous les fichiers</button><div class="mf-divider"></div><div class="mf-tree">${tree()}</div></aside>
      <section class="mf-main"><header class="mf-toolbar"><div class="mf-history"><button id="mf-back" class="icon-btn" ${isRoot?'disabled':''}>←</button><button id="mf-up" class="icon-btn" ${isRoot?'disabled':''}>↑</button></div><div class="mf-breadcrumbs">${breadcrumbs()}</div>${!isRoot?`<label class="mf-search"><span>⌕</span><input id="mf-search" value="${esc(state.search)}" placeholder="Rechercher dans ce dossier…"></label>`:''}<button class="cx-btn cx-btn-ghost" id="mf-unused">Médias inutilisés</button><button class="cx-btn cx-btn-ghost" id="mf-new-folder-top">Nouveau dossier</button><button class="cx-btn cx-btn-primary" id="mf-upload" ${isRoot?'disabled title="Ouvrez un dossier pour importer"':''}>Importer</button></header>
      ${selectionBar()}<div class="mf-subbar"><div><strong>${isRoot?'Tous les fichiers':esc(currentFolder().name)}</strong><span>${folders.length} dossier${folders.length!==1?'s':''}${isRoot?'':` · ${files.length} média${files.length!==1?'s':''}`}</span></div><div><select id="mf-sort"><option value="recent" ${state.sort==='recent'?'selected':''}>Plus récents</option><option value="name" ${state.sort==='name'?'selected':''}>Nom</option></select><button class="icon-btn ${state.view==='grid'?'active':''}" data-view="grid">▦</button><button class="icon-btn ${state.view==='list'?'active':''}" data-view="list">☷</button></div></div>
      <div class="mf-drop" id="mf-drop"><input type="file" id="mf-file-input" multiple hidden><div class="mf-items ${state.view}">${folders.map(folderCard).join('')}${files.map(mediaCard).join('')}${!folders.length&&!files.length?`<div class="mf-empty"><div>${isRoot?'▰':'⇧'}</div><h3>${isRoot?'Aucun dossier':'Ce dossier est vide'}</h3><p>${isRoot?'Créez un dossier pour organiser votre médiathèque.':'Glissez des images ou vidéos ici, ou utilisez le bouton Importer.'}</p><button class="cx-btn cx-btn-primary" id="${isRoot?'mf-empty-folder':'mf-empty-upload'}">${isRoot?'Créer un dossier':'Importer des fichiers'}</button></div>`:''}</div></div></section>
      <aside class="mf-details" id="mf-details">${details()}</aside></section>`;
    bind();
  }

  function bind(){
    document.querySelectorAll('[data-folder],[data-folder-open],[data-breadcrumb]').forEach(el=>el.onclick=e=>{if(e.target.closest('.mf-more'))return;e.stopPropagation();const raw=el.dataset.folder||el.dataset.folderOpen||el.dataset.breadcrumb;state.current=raw==='root'?null:Number(raw);state.selected.clear();state.search='';render()});
    document.querySelector('[data-folder-root]').onclick=()=>{state.current=null;state.selected.clear();state.search='';render()};
    document.getElementById('mf-up').onclick=()=>{const f=currentFolder();state.current=f?.parent_id?Number(f.parent_id):null;state.selected.clear();state.search='';render()};
    document.getElementById('mf-back').onclick=()=>document.getElementById('mf-up').click();
    document.getElementById('mf-search')?.addEventListener('input',e=>{state.search=e.target.value;renderItemsOnly()});
    document.getElementById('mf-sort').onchange=e=>{state.sort=e.target.value;render()};
    document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render()});
    document.getElementById('mf-unused')?.addEventListener('click',showUnused);
    ['mf-new-folder','mf-new-folder-top','mf-empty-folder'].forEach(id=>document.getElementById(id)?.addEventListener('click',createFolder));
    ['mf-upload','mf-empty-upload'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>{if(state.current!==null)document.getElementById('mf-file-input').click()}));
    document.getElementById('mf-file-input').onchange=e=>upload([...e.target.files]);
    const drop=document.getElementById('mf-drop');
    ['dragenter','dragover'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();if(state.current!==null)drop.classList.add('dragging')}));
    ['dragleave','drop'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.remove('dragging')}));
    drop.ondrop=e=>{if(state.current!==null)upload([...e.dataTransfer.files])};
    document.querySelectorAll('[data-media-id]').forEach(el=>el.onclick=e=>{if(e.target.closest('.mf-more'))return;const id=Number(el.dataset.mediaId);if(!(e.metaKey||e.ctrlKey||e.shiftKey))state.selected.clear();state.selected.has(id)?state.selected.delete(id):state.selected.add(id);render()});
    document.querySelectorAll('[data-folder-menu]').forEach(b=>b.onclick=e=>{e.stopPropagation();folderMenu(Number(b.dataset.folderMenu))});
    document.querySelectorAll('[data-media-menu]').forEach(b=>b.onclick=e=>{e.stopPropagation();mediaMenu(Number(b.dataset.mediaMenu))});
    document.querySelectorAll('[data-rename-media]').forEach(b=>b.onclick=()=>renameMedia(Number(b.dataset.renameMedia)));
    document.querySelectorAll('[data-delete-media]').forEach(b=>b.onclick=()=>deleteMedia([Number(b.dataset.deleteMedia)]));
    document.getElementById('mf-move-selected')?.addEventListener('click',()=>moveMedia([...state.selected]));
    document.getElementById('mf-move-selected-top')?.addEventListener('click',()=>moveMedia([...state.selected]));
    document.getElementById('mf-delete-selected-side')?.addEventListener('click',()=>deleteMedia([...state.selected]));
    document.getElementById('mf-delete-selected')?.addEventListener('click',()=>deleteMedia([...state.selected]));
    document.getElementById('mf-rename-selected')?.addEventListener('click',()=>renameMedia([...state.selected][0]));
    document.getElementById('mf-clear-selection')?.addEventListener('click',()=>{state.selected.clear();render()});
  }
  function renderItemsOnly(){render()}

  async function createFolder(){
    cxUI.modal({title:'Nouveau dossier',body:`<label class="cx-field"><span>Nom du dossier</span><input id="mf-folder-name" class="cx-input" placeholder="Ex. Campagne été" autofocus></label>`,footer:`<button class="cx-btn cx-btn-ghost" data-cancel>Annuler</button><button class="cx-btn cx-btn-primary" data-save>Créer</button>`,onMount:(el,close)=>{el.querySelector('[data-cancel]').onclick=close;el.querySelector('[data-save]').onclick=async()=>{const name=el.querySelector('#mf-folder-name').value.trim();if(!name)return;try{await cxApi.post('/api/v31/folders',{name,parent_id:state.current});close();await refresh('Dossier créé')}catch(e){cxUI.toast({type:'danger',title:'Création impossible',message:e.message})}}}});
  }
  async function upload(files){
    if(!files.length)return;if(state.current===null){cxUI.toast({type:'warning',title:'Choisissez un dossier',message:'Les imports doivent être placés dans un dossier.'});return}
    const fd=new FormData();files.forEach(f=>fd.append('files',f));fd.append('folder_id',state.current);fd.append('relative_paths',JSON.stringify(files.map(f=>f.webkitRelativePath||f.name)));
    const toast=cxUI.toast({title:'Import en cours',message:`${files.length} fichier(s)…`,duration:0});
    try{const result=await cxApi.upload('/api/v31/media/upload',fd);toast.remove();await refresh(`${result.imported?.length||files.length} fichier(s) importé(s)`)}catch(e){toast.remove();cxUI.toast({type:'danger',title:'Import impossible',message:e.message})}
  }
  function folderMenu(id){const f=state.folders.find(x=>Number(x.id)===id);cxUI.modal({title:f.name,body:`<div class="mf-action-list"><button data-open>Ouvrir</button><button data-rename>Renommer</button><button class="danger" data-delete>Supprimer le dossier complet</button></div>`,onMount:(el,close)=>{el.querySelector('[data-open]').onclick=()=>{close();state.current=id;render()};el.querySelector('[data-rename]').onclick=()=>{close();renameFolder(id)};el.querySelector('[data-delete]').onclick=()=>{close();deleteFolder(id)}}})}
  function mediaMenu(id){const m=state.media.find(x=>Number(x.id)===id);cxUI.modal({title:m.title||m.original_name,body:`<div class="mf-action-list"><button data-preview>Afficher les informations</button><button data-rename>Renommer</button><button data-move>Déplacer</button><button class="danger" data-delete>Supprimer</button></div>`,onMount:(el,close)=>{el.querySelector('[data-preview]').onclick=()=>{close();state.selected=new Set([id]);render()};el.querySelector('[data-rename]').onclick=()=>{close();renameMedia(id)};el.querySelector('[data-move]').onclick=()=>{close();moveMedia([id])};el.querySelector('[data-delete]').onclick=()=>{close();deleteMedia([id])}}})}
  function renameFolder(id){const f=state.folders.find(x=>Number(x.id)===id);cxUI.modal({title:'Renommer le dossier',body:`<label class="cx-field"><span>Nouveau nom</span><input id="mf-rename" class="cx-input" value="${esc(f.name)}"></label>`,footer:`<button class="cx-btn cx-btn-ghost" data-cancel>Annuler</button><button class="cx-btn cx-btn-primary" data-save>Enregistrer</button>`,onMount:(el,close)=>{el.querySelector('[data-cancel]').onclick=close;el.querySelector('[data-save]').onclick=async()=>{const name=el.querySelector('#mf-rename').value.trim();if(!name)return;try{await cxApi.put(`/api/v31/folders/${id}`,{name});close();await refresh('Dossier renommé')}catch(e){cxUI.toast({type:'danger',title:'Erreur',message:e.message})}}}})}
  async function deleteFolder(id){
    const f=state.folders.find(x=>Number(x.id)===id);if(!f)return;
    if(!await cxUI.confirm({title:`Supprimer « ${f.name} » ?`,message:'Le dossier, ses sous-dossiers et tous les médias qu’il contient seront supprimés définitivement.',confirmText:'Supprimer le dossier',danger:true}))return;
    try{await cxApi.delete(`/api/v31/folders/${id}?recursive=1`);if(Number(state.current)===id)state.current=f.parent_id?Number(f.parent_id):null;state.selected.clear();await refresh('Dossier supprimé')}
    catch(e){cxUI.toast({type:'danger',title:'Suppression impossible',message:e.message})}
  }
  function renameMedia(id){const m=state.media.find(x=>Number(x.id)===id);cxUI.modal({title:'Renommer le média',body:`<label class="cx-field"><span>Nouveau nom</span><input id="mf-rename" class="cx-input" value="${esc(m.title||'')}"></label>`,footer:`<button class="cx-btn cx-btn-ghost" data-cancel>Annuler</button><button class="cx-btn cx-btn-primary" data-save>Enregistrer</button>`,onMount:(el,close)=>{el.querySelector('[data-cancel]').onclick=close;el.querySelector('[data-save]').onclick=async()=>{const title=el.querySelector('#mf-rename').value.trim();if(!title)return;try{await cxApi.put(`/api/media/${id}`,{title,folder_id:m.folder_id,client_id:m.client_id,keep_forever:m.keep_forever,delete_after:m.delete_after});close();await refresh('Média renommé')}catch(e){cxUI.toast({type:'danger',title:'Erreur',message:e.message})}}}})}
  async function deleteMedia(ids){
    if(!ids.length)return;
    if(!await cxUI.confirm({title:`Supprimer ${ids.length>1?'ces médias':'ce média'} ?`,message:`${ids.length} fichier${ids.length>1?'s seront':' sera'} supprimé${ids.length>1?'s':''} définitivement du serveur.`,confirmText:'Supprimer',danger:true}))return;
    try{await cxApi.post('/api/v31/media/delete',{media_ids:ids});state.selected.clear();await refresh(ids.length>1?'Médias supprimés':'Média supprimé')}
    catch(e){cxUI.toast({type:'danger',title:'Suppression impossible',message:e.message})}
  }
  function moveMedia(ids){const options=state.folders.map(f=>`<option value="${f.id}">${esc(f.path||f.name)}</option>`).join('');cxUI.modal({title:'Déplacer les médias',body:`<label class="cx-field"><span>Dossier de destination</span><select id="mf-target" class="cx-select">${options}</select></label>`,footer:`<button class="cx-btn cx-btn-ghost" data-cancel>Annuler</button><button class="cx-btn cx-btn-primary" data-save>Déplacer</button>`,onMount:(el,close)=>{el.querySelector('[data-cancel]').onclick=close;el.querySelector('[data-save]').onclick=async()=>{try{await cxApi.post('/api/v31/media/move',{media_ids:ids,folder_id:Number(el.querySelector('#mf-target').value)});close();state.selected.clear();await refresh('Média déplacé')}catch(e){cxUI.toast({type:'danger',title:'Déplacement impossible',message:e.message})}}}})}

  async function showUnused(){
    try{
      const items=await cxApi.get('/api/v31/media/unused');
      if(!items.length){cxUI.toast({type:'success',title:'Bibliothèque propre',message:'Aucun média inutilisé.'});return}
      const body=`<p><b>${items.length}</b> média(s) ne sont utilisés dans aucune playlist.</p><div style="max-height:420px;overflow:auto">${items.map(m=>`<label style="display:flex;gap:10px;padding:8px;border-bottom:1px solid #eee"><input type="checkbox" data-unused value="${m.id}" checked><span>${esc(m.title||m.original_name)} <small>· ${bytes(m.bytes)}</small></span></label>`).join('')}</div>`;
      cxUI.modal({title:'Médias inutilisés',body,footer:`<button class="cx-btn cx-btn-ghost" data-cancel>Annuler</button><button class="cx-btn cx-btn-danger" data-delete>Supprimer la sélection</button>`,onMount:(el,close)=>{el.querySelector('[data-cancel]').onclick=close;el.querySelector('[data-delete]').onclick=async()=>{const ids=[...el.querySelectorAll('[data-unused]:checked')].map(x=>Number(x.value));if(!ids.length)return;close();await deleteMedia(ids)}}});
    }catch(e){cxUI.toast({type:'danger',title:'Analyse impossible',message:e.message})}
  }

  async function refresh(message){[state.folders,state.media]=await Promise.all([cxApi.get('/api/v31/folders'),cxApi.get('/api/v31/media')]);render();if(message)cxUI.toast({type:'success',title:message})}
  window.renderMediaFinder=load;
})();
