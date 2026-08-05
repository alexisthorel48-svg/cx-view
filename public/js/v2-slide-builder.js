(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const fileUrl=m=>m?.file_name?`/files/uploads/${encodeURIComponent(m.file_name)}`:'';
  const thumbUrl=m=>m?.thumbnail_name?`/files/thumbs/${encodeURIComponent(m.thumbnail_name)}`:fileUrl(m);
  const widgetDefs=[['CLOCK','◷','Horloge'],['WEATHER','☁','Météo'],['COUNTDOWN','⌛','Compte à rebours'],['TICKER','≋','Bandeau texte'],['RSS','≡','Flux RSS'],['WEBPAGE','⌁','Page web']];
  const widgetIcon=t=>({CLOCK:'◷',WEATHER:'☁',COUNTDOWN:'⌛',TICKER:'≋',RSS:'≡',WEBPAGE:'⌁'}[t]||'◆');

  let state=null,drag=null,nextLocalId=1;

  function newState(playlistId,item,onDone,mediaList,startPosition){
    const cfg=item?.widget_config||{};
    return {
      playlistId,itemId:item?.id||null,onDone,
      duration:Number(item?.duration_seconds||15),
      background:cfg.background||'#000000',
      elements:Array.isArray(cfg.elements)?cfg.elements.map(el=>({...el})):[],
      selected:null,media:mediaList,mediaQuery:'',position:item?Number(item.position||0):startPosition,
      _sourceItem:item
    };
  }

  function elLabel(el){if(el.kind==='MEDIA'){const m=state.media.find(x=>Number(x.id)===Number(el.media_id));return m?(m.title||m.original_name||'Média'):'Média (introuvable)'}return `${widgetIcon(el.widget_type)} ${el.widget_config?.name||el.widget_type||'Widget'}`}

  function elContent(el){
    if(el.kind==='MEDIA'){
      const m=state.media.find(x=>Number(x.id)===Number(el.media_id));
      if(!m)return '<div class="sb-el-missing">Média introuvable</div>';
      if((m.media_type||'').toUpperCase()==='VIDEO')return `<video src="${fileUrl(m)}" muted loop autoplay playsinline></video>`;
      return `<img src="${fileUrl(m)}" alt="">`;
    }
    return `<div class="sb-el-widget"><b>${widgetIcon(el.widget_type)}</b><span>${esc(el.widget_config?.name||el.widget_type||'Widget')}</span></div>`;
  }

  function stageHtml(){
    const maxW=900,maxH=506;const scale=Math.min(maxW/1920,maxH/1080,1);
    const sorted=[...state.elements].sort((a,b)=>(a.layer||0)-(b.layer||0));
    return `<div class="sb-stage" id="sb-stage" style="width:${1920*scale}px;height:${1080*scale}px;background:${esc(state.background)}">${sorted.map(el=>`
      <div class="sb-el ${state.selected===el.id?'selected':''}" data-el="${el.id}" style="left:${el.x}%;top:${el.y}%;width:${el.width}%;height:${el.height}%;z-index:${el.layer||0}">
        <div class="sb-el-inner">${elContent(el)}</div>
        <div class="sb-el-label">${esc(elLabel(el))}</div>
        <i class="sb-resize"></i>
      </div>`).join('')}${!state.elements.length?'<div class="sb-stage-empty">Ajoutez un média ou un widget pour commencer</div>':''}</div>`;
  }

  function mediaPickerHtml(){
    const q=state.mediaQuery.toLowerCase();
    const rows=state.media.filter(m=>`${m.title||''} ${m.original_name||''}`.toLowerCase().includes(q));
    return `<div class="sb-picker"><div class="panel-head"><h4>Ajouter un média</h4><button type="button" class="icon-btn" id="sb-media-close">×</button></div>
      <input class="cx-input" id="sb-media-search" placeholder="Rechercher…" value="${esc(state.mediaQuery)}">
      <div class="sb-picker-grid">${rows.length?rows.map(m=>`<button class="sb-picker-card" data-pick-media="${m.id}">${thumbUrl(m)?`<img src="${thumbUrl(m)}" alt="">`:`<span>${(m.media_type||'')==='VIDEO'?'▶':'◇'}</span>`}<strong>${esc(m.title||m.original_name||m.file_name)}</strong></button>`).join(''):'<div class="sb-picker-empty">Aucun média. Importez-en un depuis la Médiathèque.</div>'}</div></div>`;
  }

  function widgetPickerHtml(){
    return `<div class="sb-picker"><div class="panel-head"><h4>Ajouter un widget</h4><button type="button" class="icon-btn" id="sb-widget-close">×</button></div>
      <div class="pl-widget-grid">${widgetDefs.map(([v,i,n])=>`<button data-pick-widget="${v}"><b>${i}</b><strong>${n}</strong></button>`).join('')}</div></div>`;
  }

  function inspectorHtml(){
    const el=state.elements.find(x=>x.id===state.selected);
    if(!el)return `<div class="sb-inspector-empty"><p>Sélectionnez un élément sur le canevas pour modifier sa position, sa taille ou son contenu.</p></div>`;
    const posFields=`<div class="pl-form-grid"><label class="cx-field"><span>X %</span><input class="cx-input" id="sb-x" type="number" step="0.1" value="${el.x}"></label><label class="cx-field"><span>Y %</span><input class="cx-input" id="sb-y" type="number" step="0.1" value="${el.y}"></label></div><div class="pl-form-grid"><label class="cx-field"><span>Largeur %</span><input class="cx-input" id="sb-w" type="number" step="0.1" value="${el.width}"></label><label class="cx-field"><span>Hauteur %</span><input class="cx-input" id="sb-h" type="number" step="0.1" value="${el.height}"></label></div>`;
    const layerBtns=`<div class="sb-layer-btns"><button type="button" class="cx-btn cx-btn-ghost" id="sb-layer-back">Arrière-plan</button><button type="button" class="cx-btn cx-btn-ghost" id="sb-layer-front">Premier plan</button></div>`;
    if(el.kind==='MEDIA'){
      return `<h4>Élément média</h4>${posFields}${layerBtns}<button type="button" class="cx-btn cx-btn-ghost" id="sb-replace-media" style="margin-top:10px">Remplacer le média</button><button type="button" class="cx-btn cx-btn-danger" id="sb-delete-el" style="margin-top:8px">Supprimer l'élément</button>`;
    }
    const type=el.widget_type;
    const fields=(window.cxWidgetFields?window.cxWidgetFields(type,el.widget_config||{}):'');
    return `<h4>Widget — ${esc(type)}</h4><label class="cx-field"><span>Nom</span><input class="cx-input" id="wg-name" value="${esc(el.widget_config?.name||type)}"></label>${fields}${posFields}${layerBtns}<button type="button" class="cx-btn cx-btn-primary" id="sb-save-widget-config" style="margin-top:10px">Appliquer la configuration</button><button type="button" class="cx-btn cx-btn-danger" id="sb-delete-el" style="margin-top:8px">Supprimer l'élément</button>`;
  }

  function render(){
    content.innerHTML=`<section class="sb-shell">
      <header class="sb-top"><div><span class="eyebrow">Playlist</span><h2>${state.itemId?'Modifier le slide':'Nouveau slide composé'}</h2></div>
        <div class="sb-top-actions"><button class="cx-btn cx-btn-ghost" id="sb-back">← Retour à la playlist</button><button class="cx-btn cx-btn-primary" id="sb-save">Enregistrer</button></div></header>
      <p class="cx-help sb-warning">Les slides composés nécessitent une version à jour du Player pour s'afficher sur les écrans. Sur un player non mis à jour, ce slide est simplement ignoré (aucune erreur).</p>
      <div class="sb-layout">
        <aside class="sb-palette">
          <button class="cx-btn cx-btn-primary" id="sb-add-media">+ Média</button>
          <button class="cx-btn cx-btn-primary" id="sb-add-widget">+ Widget</button>
          <label class="cx-field" style="margin-top:16px"><span>Durée d'affichage (secondes)</span><input class="cx-input" id="sb-duration" type="number" min="1" value="${state.duration}"></label>
          <label class="cx-field"><span>Fond</span><input class="cx-input" id="sb-bg" type="color" value="${state.background}"></label>
          <div class="sb-el-list">${state.elements.map(el=>`<button class="sb-el-list-item ${state.selected===el.id?'active':''}" data-select-el="${el.id}">${esc(elLabel(el))}</button>`).join('')||'<small class="muted">Aucun élément</small>'}</div>
        </aside>
        <section class="sb-stage-wrap"><div id="sb-stage-shell">${stageHtml()}</div></section>
        <aside class="sb-inspector" id="sb-inspector">${inspectorHtml()}</aside>
      </div>
      <div id="sb-overlay"></div>
    </section>`;
    bind();
  }

  function bind(){
    document.getElementById('sb-back').onclick=()=>{state.onDone?.()};
    document.getElementById('sb-save').onclick=save;
    document.getElementById('sb-duration').onchange=e=>{state.duration=Number(e.target.value)||15};
    document.getElementById('sb-bg').oninput=e=>{state.background=e.target.value;document.getElementById('sb-stage-shell').innerHTML=stageHtml();bindStage()};
    document.getElementById('sb-add-media').onclick=()=>{document.getElementById('sb-overlay').innerHTML=mediaPickerHtml();bindMediaPicker()};
    document.getElementById('sb-add-widget').onclick=()=>{document.getElementById('sb-overlay').innerHTML=widgetPickerHtml();bindWidgetPicker()};
    document.querySelectorAll('[data-select-el]').forEach(b=>b.onclick=()=>{state.selected=Number(b.dataset.selectEl);renderStageAndInspector()});
    bindStage();
    bindInspector();
  }

  function bindMediaPicker(){
    const close=()=>{document.getElementById('sb-overlay').innerHTML=''};
    document.getElementById('sb-media-close').onclick=close;
    document.getElementById('sb-media-search').oninput=e=>{state.mediaQuery=e.target.value;document.getElementById('sb-overlay').innerHTML=mediaPickerHtml();bindMediaPicker()};
    document.querySelectorAll('[data-pick-media]').forEach(b=>b.onclick=()=>{
      const id=Number(b.dataset.pickMedia);
      const localId=nextLocalId++;
      state.elements.push({id:localId,kind:'MEDIA',media_id:id,x:10,y:10,width:50,height:50,layer:state.elements.length});
      state.selected=localId;close();render();
    });
  }
  function bindWidgetPicker(){
    const close=()=>{document.getElementById('sb-overlay').innerHTML=''};
    document.getElementById('sb-widget-close').onclick=close;
    document.querySelectorAll('[data-pick-widget]').forEach(b=>b.onclick=()=>{
      const type=b.dataset.pickWidget;
      const localId=nextLocalId++;
      state.elements.push({id:localId,kind:'WIDGET',widget_type:type,widget_config:{name:type,fullscreen:false},x:5,y:5,width:35,height:25,layer:state.elements.length});
      state.selected=localId;close();render();
    });
  }

  function renderStageAndInspector(){
    document.getElementById('sb-stage-shell').innerHTML=stageHtml();
    document.getElementById('sb-inspector').innerHTML=inspectorHtml();
    document.querySelectorAll('[data-select-el]').forEach(b=>b.classList.toggle('active',Number(b.dataset.selectEl)===state.selected));
    bindStage();bindInspector();
  }

  function bindStage(){
    document.querySelectorAll('.sb-el').forEach(el=>{
      el.onpointerdown=startDrag;
      el.onclick=e=>{e.stopPropagation();state.selected=Number(el.dataset.el);renderStageAndInspector()};
    });
    document.getElementById('sb-stage')?.addEventListener('click',()=>{state.selected=null;renderStageAndInspector()});
  }

  function startDrag(e){
    const el=e.currentTarget,item=state.elements.find(x=>x.id===Number(el.dataset.el));
    if(!item)return;
    const resize=e.target.classList.contains('sb-resize');
    e.stopPropagation();el.setPointerCapture(e.pointerId);
    drag={el,item,resize,sx:e.clientX,sy:e.clientY,x:+item.x,y:+item.y,w:+item.width,h:+item.height};
    el.onpointermove=moveDrag;el.onpointerup=endDrag;
  }
  function moveDrag(e){
    if(!drag)return;
    const stage=drag.el.parentElement;
    const dx=(e.clientX-drag.sx)/stage.clientWidth*100,dy=(e.clientY-drag.sy)/stage.clientHeight*100;
    if(drag.resize){
      drag.item.width=Math.max(2,Math.min(100-drag.x,drag.w+dx));
      drag.item.height=Math.max(2,Math.min(100-drag.y,drag.h+dy));
    }else{
      drag.item.x=Math.max(0,Math.min(100-drag.w,drag.x+dx));
      drag.item.y=Math.max(0,Math.min(100-drag.h,drag.y+dy));
    }
    drag.el.style.left=drag.item.x+'%';drag.el.style.top=drag.item.y+'%';
    drag.el.style.width=drag.item.width+'%';drag.el.style.height=drag.item.height+'%';
  }
  function endDrag(){
    if(!drag)return;
    state.selected=drag.item.id;
    drag=null;
    renderStageAndInspector();
  }

  function bindInspector(){
    const el=state.elements.find(x=>x.id===state.selected);
    if(!el)return;
    const num=(id,key)=>{const input=document.getElementById(id);if(input)input.onchange=()=>{el[key]=Number(input.value)||0;document.getElementById('sb-stage-shell').innerHTML=stageHtml();bindStage()}};
    num('sb-x','x');num('sb-y','y');num('sb-w','width');num('sb-h','height');
    document.getElementById('sb-layer-front').onclick=()=>{el.layer=Math.max(0,...state.elements.map(x=>x.layer||0))+1;renderStageAndInspector()};
    document.getElementById('sb-layer-back').onclick=()=>{el.layer=Math.min(0,...state.elements.map(x=>x.layer||0))-1;renderStageAndInspector()};
    document.getElementById('sb-delete-el').onclick=()=>{state.elements=state.elements.filter(x=>x.id!==el.id);state.selected=null;render()};
    if(el.kind==='MEDIA'){
      document.getElementById('sb-replace-media').onclick=()=>{document.getElementById('sb-overlay').innerHTML=mediaPickerHtml();
        document.getElementById('sb-media-close').onclick=()=>{document.getElementById('sb-overlay').innerHTML=''};
        document.getElementById('sb-media-search').oninput=e=>{state.mediaQuery=e.target.value;document.getElementById('sb-overlay').innerHTML=mediaPickerHtml();document.getElementById('sb-media-close').onclick=()=>{document.getElementById('sb-overlay').innerHTML=''};document.querySelectorAll('[data-pick-media]').forEach(b=>b.onclick=()=>{el.media_id=Number(b.dataset.pickMedia);document.getElementById('sb-overlay').innerHTML='';render()})};
        document.querySelectorAll('[data-pick-media]').forEach(b=>b.onclick=()=>{el.media_id=Number(b.dataset.pickMedia);document.getElementById('sb-overlay').innerHTML='';render()});
      };
    }else{
      document.getElementById('sb-save-widget-config').onclick=()=>{
        const cfg=window.cxWidgetReadConfig?window.cxWidgetReadConfig(document,el.widget_type):{};
        el.widget_config={...cfg,name:document.getElementById('wg-name').value.trim()||el.widget_type};
        cxUI.toast({type:'success',title:'Configuration appliquée'});
        renderStageAndInspector();
      };
    }
  }

  async function save(){
    const btn=document.getElementById('sb-save');btn.disabled=true;btn.textContent='Enregistrement…';
    const widget_config={background:state.background,elements:state.elements.map(({id,kind,x,y,width,height,layer,media_id,widget_type,widget_config})=>({id,kind,x,y,width,height,layer,media_id,widget_type,widget_config}))};
    try{
      if(state.itemId){
        await cxApi.put(`/api/playlists/${state.playlistId}/items/${state.itemId}`,{...state._sourceItem,widget_config,duration_seconds:state.duration});
      }else{
        await cxApi.post(`/api/playlists/${state.playlistId}/items`,{item_type:'CANVAS',widget_config,duration_seconds:state.duration,position:state.position});
      }
      cxUI.toast({type:'success',title:state.itemId?'Slide modifié':'Slide ajouté'});
      state.onDone?.();
    }catch(e){
      btn.disabled=false;btn.textContent='Enregistrer';
      cxUI.toast({type:'danger',title:'Enregistrement impossible',message:e.message});
    }
  }

  window.openSlideBuilder=async function(item,playlistId,onDone){
    content.innerHTML=cxUI.loading('Chargement du slide builder…');
    try{
      const [mediaList,items]=await Promise.all([cxApi.get('/api/v31/media'),cxApi.get(`/api/playlists/${playlistId}/items`)]);
      state=newState(playlistId,item,onDone,mediaList,items.length);
      nextLocalId=Math.max(1,...state.elements.map(e=>Number(e.id)||0))+1;
      render();
    }catch(e){
      content.innerHTML=`<div class="error-state"><h3>Slide builder indisponible</h3><p>${esc(e.message)}</p></div>`;
    }
  };
})();
