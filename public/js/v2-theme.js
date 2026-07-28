(function(){
  'use strict';
  const STORAGE_KEY='cx-view-theme';
  const root=document.documentElement;
  const meta=document.querySelector('meta[name="theme-color"]');
  function preferred(){
    const saved=localStorage.getItem(STORAGE_KEY);
    if(saved==='light'||saved==='dark') return saved;
    return window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
  }
  function apply(theme, persist){
    const value=theme==='light'?'light':'dark';
    root.dataset.theme=value;
    if(meta) meta.setAttribute('content',value==='light'?'#f3f5f8':'#0b0d12');
    if(persist) localStorage.setItem(STORAGE_KEY,value);
    const button=document.getElementById('theme-toggle');
    if(button){
      const next=value==='light'?'sombre':'clair';
      button.setAttribute('aria-label','Passer en mode '+next);
      button.setAttribute('title','Passer en mode '+next);
      button.setAttribute('aria-pressed',value==='light'?'true':'false');
    }
  }
  apply(preferred(),false);
  function bind(){
    const button=document.getElementById('theme-toggle');
    if(!button||button.dataset.bound==='1') return;
    button.dataset.bound='1';
    button.addEventListener('click',function(){apply(root.dataset.theme==='light'?'dark':'light',true)});
    apply(root.dataset.theme||preferred(),false);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();
  window.CXViewTheme={apply:apply,current:function(){return root.dataset.theme||preferred()}};
})();
