(function(){
  const UI={};
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  UI.escape=esc;
  UI.toast=function({title='Information',message='',type='info',duration=3600}={}){
    let stack=document.querySelector('.cx-toast-stack');
    if(!stack){stack=document.createElement('div');stack.className='cx-toast-stack';document.body.appendChild(stack)}
    const icons={success:'✓',warning:'!',danger:'×',info:'i'};
    const toast=document.createElement('div');toast.className='cx-toast';
    toast.innerHTML=`<div class="cx-toast-icon">${icons[type]||'i'}</div><div class="cx-toast-content"><strong>${esc(title)}</strong>${message?`<p>${esc(message)}</p>`:''}</div><button class="cx-toast-close" aria-label="Fermer">×</button>`;
    const close=()=>{toast.style.opacity='0';toast.style.transform='translateY(8px)';setTimeout(()=>toast.remove(),180)};
    toast.querySelector('button').onclick=close;stack.appendChild(toast);if(duration)setTimeout(close,duration);return toast;
  };
  UI.confirm=function({title='Confirmer',message='Voulez-vous continuer ?',confirmText='Confirmer',cancelText='Annuler',danger=false}={}){
    return new Promise(resolve=>{
      const back=document.createElement('div');back.className='cx-modal-backdrop';
      back.innerHTML=`<div class="cx-modal" role="dialog" aria-modal="true"><div class="cx-modal-header"><h3>${esc(title)}</h3><button class="cx-btn cx-btn-ghost cx-btn-icon" data-close>×</button></div><div class="cx-modal-body"><p class="muted" style="margin:0;line-height:1.6">${esc(message)}</p></div><div class="cx-modal-footer"><button class="cx-btn cx-btn-ghost" data-cancel>${esc(cancelText)}</button><button class="cx-btn ${danger?'cx-btn-danger':'cx-btn-primary'}" data-confirm>${esc(confirmText)}</button></div></div>`;
      const done=v=>{back.remove();resolve(v)};back.querySelector('[data-close]').onclick=()=>done(false);back.querySelector('[data-cancel]').onclick=()=>done(false);back.querySelector('[data-confirm]').onclick=()=>done(true);back.onclick=e=>{if(e.target===back)done(false)};document.body.appendChild(back);back.querySelector('[data-confirm]').focus();
    });
  };
  UI.modal=function({title='Fenêtre',body='',footer='',onMount}={}){
    const back=document.createElement('div');back.className='cx-modal-backdrop';back.innerHTML=`<div class="cx-modal" role="dialog" aria-modal="true"><div class="cx-modal-header"><h3>${esc(title)}</h3><button class="cx-btn cx-btn-ghost cx-btn-icon" data-close>×</button></div><div class="cx-modal-body">${body}</div>${footer?`<div class="cx-modal-footer">${footer}</div>`:''}</div>`;const close=()=>back.remove();back.querySelector('[data-close]').onclick=close;back.onclick=e=>{if(e.target===back)close()};document.body.appendChild(back);if(onMount)onMount(back,close);return {element:back,close};
  };
  UI.loading=function(label='Chargement…'){return `<div class="loading-card"><div class="cx-skeleton" style="width:160px;height:16px;margin:0 auto 14px"></div><span class="muted">${esc(label)}</span></div>`};
  UI.empty=function({icon='◇',title='Aucun élément',message='',action=''}={}){return `<article class="cx-card empty-state"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3>${message?`<p>${esc(message)}</p>`:''}${action}</article>`};
  window.cxUI=UI;
})();
