/* Shared, dependency-free theme bootstrap for every public and private page. */
(()=>{
 const STORAGE='unisic.theme',VALID=['system','light','dark'],root=document.documentElement;
 const isValid=value=>VALID.includes(value);
 const system=()=>window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
 const saved=()=>{try{return localStorage.getItem(STORAGE);}catch{return null;}};
 const resolved=mode=>mode==='system'?system():mode;
 const apply=(mode,persist=true)=>{
  const next=isValid(mode)?mode:'system';
  root.dataset.theme=resolved(next);
  root.dataset.themeMode=next;
  if(persist)try{localStorage.setItem(STORAGE,next);}catch{}
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',root.dataset.theme==='light'?'#f6f8ff':'#080e1d');
  window.dispatchEvent(new CustomEvent('unisic:theme-change',{detail:{mode:next,resolved:root.dataset.theme}}));
  return next;
 };
 window.UnisicTheme={set:apply,get:()=>root.dataset.themeMode||'system',resolved:()=>root.dataset.theme};
 apply(saved()||'system',false);
 const mq=window.matchMedia?.('(prefers-color-scheme: dark)');
 mq?.addEventListener?.('change',()=>{if(window.UnisicTheme.get()==='system')apply('system',false);});
 const useBrand=settings=>{
  const name=String(settings.site_name||'Unisic');
  for(const el of document.querySelectorAll('.brand-name,.crumb-brand'))el.textContent=name;
 };
 document.addEventListener('DOMContentLoaded',()=>{
  fetch('/api/settings/public',{credentials:'same-origin'})
   .then(r=>r.ok?r.json():null)
   .then(data=>{
     if(!data)return;
     useBrand(data);
     // Personal choice always wins. A site default is used only for fresh browsers.
     if(!saved()&&isValid(data.default_theme))apply(data.default_theme,false);
   }).catch(()=>{});
 });
})();
