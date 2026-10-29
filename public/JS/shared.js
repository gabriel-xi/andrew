const $=id=>document.getElementById(id);
export { $ };
export class ApiError extends Error { constructor(status,data){super(data?.message||'Richiesta non riuscita');this.status=status;this.data=data;} }
export async function api(path,method='GET',body=null){
  const options={method,credentials:'same-origin',headers:{}};
  if(body!==null){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  let response;
  try{response=await fetch(path,options);}catch{throw new Error('Server non raggiungibile. Verifica la connessione.');}
  let data;try{data=await response.json();}catch{throw new ApiError(response.status,{message:'Risposta server non valida'});}
  if(!response.ok)throw new ApiError(response.status,data);
  return data;
}
export const formatDate=date=>date?new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00')):'—';
export const formatNum=(n,d=1)=>new Intl.NumberFormat('it-IT',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(n)||0);
export const hours=(v,d=1)=>formatNum(v,d)+' h';
export const startOfToday=()=>new Date().toLocaleDateString('en-CA');
export function node(tag,classes='',text=null){
  const item=document.createElement(tag);
  if(classes)item.className=classes;
  if(text!==null)item.textContent=String(text);
  return item;
}
export function clear(target){const item=typeof target==='string'?$(target):target;if(item)item.replaceChildren();return item;}
export function badge(label,status=''){
  const variants={active:'green',completed:'green',planned:'amber',cancelled:'red',confirmed:'green',
    postponed:'amber',done:'green',admin:'green',tutor:''};
  return node('span','tag '+(variants[status]||''),label);
}
export function stat(label,value,icon='◈',color='#9b8cff',foot=''){
  const card=node('article','stat');card.style.setProperty('--accent',color);
  card.append(node('div','stat-icon',icon),node('div','stat-label',label),node('div','stat-number',value));
  if(foot)card.append(node('div','stat-foot',foot));
  return card;
}
export function showMessage(message,kind='error'){
  const target=$('message');if(!target)return;
  target.textContent=message||'';
  target.setAttribute('data-kind',kind);
  if(message && kind==='success')target.style.color='#88f0c5';else target.style.color='';
}
export function empty(message='Nessun elemento presente'){
  const wrap=node('div','empty');wrap.append(node('strong','',message));return wrap;
}
export function infoRow(symbol,title,details,right=''){
  const row=node('div','list-item'),symbolEl=node('div','list-marker',symbol),copy=node('div','list-copy');
  copy.append(node('strong','',title),node('small','',details));
  row.append(symbolEl,copy,node('span','list-end',right));
  return row;
}
export function table(container,columns,rows){
  const parent=clear(container);if(!parent)return;
  if(!rows.length){parent.append(empty('Nessun risultato'));return;}
  const wrap=node('div','table-scroll'),t=node('table','data-table'),head=node('thead'),tr=node('tr');
  for(const title of columns)tr.append(node('th','',title));
  head.append(tr);t.append(head);
  const tbody=node('tbody');
  for(const cells of rows){
    const row=node('tr');for(const content of cells){
      const td=node('td');
      if(content instanceof Node)td.append(content);
      else td.textContent=content===null||content===undefined?'—':String(content);
      row.append(td);
    }tbody.append(row);
  }t.append(tbody);wrap.append(t);parent.append(wrap);
}
export function action(label,callback,classes='btn ghost small'){
  const button=node('button',classes,label);button.type='button';button.addEventListener('click',callback);return button;
}
export function buttonGroup(...buttons){
  const wrap=node('div','actions');wrap.append(...buttons);return wrap;
}
export function openDialog(id){const item=$(id);if(item && !item.open)item.showModal();}
export function closeDialog(id){const item=$(id);if(item?.open)item.close();}
export function bindForm(id,callback,{success='Operazione completata',clearAfter=true}={}){
  const form=$(id);if(!form)return;
  form.addEventListener('submit',async event=>{
    event.preventDefault();showMessage('');
    const submit=form.querySelector('button[type=submit],button:not([type])');if(submit)submit.disabled=true;
    try{
      const raw=Object.fromEntries(new FormData(form));
      await callback(raw,form);
      if(clearAfter)form.reset();
      showMessage(success,'success');
    }catch(error){
      showMessage(error.message);
      if(error.data?.conflicts?.length) showMessage(error.message+' · '+error.data.conflicts.map(c=>c.title||c.instructor).join(', '));
    }finally{if(submit)submit.disabled=false;}
  });
}
export function showLoading(container){const item=clear(container);if(item)item.append(node('div','empty','Caricamento…'));}
export async function auth(){
  try{
    const {user}=await api('/api/auth/me');
    if(!user)throw new Error('Sessione non valida');
    // Personal settings live in SQLite; localStorage is only a fast theme cache.
    try {
      const settings=await api('/api/settings/me');
      window.UnisicTheme?.set(settings.preferences.theme);
      document.documentElement.dataset.compact=settings.preferences.compact_mode?'true':'false';
      const name=settings.global.site_name||'Unisic';
      document.querySelectorAll('.brand-name,.crumb-brand').forEach(el=>el.textContent=name);
    } catch {
      // Older deployments might not expose settings yet: auth must still work.
    }
    document.querySelectorAll('[data-admin-nav="true"]').forEach(el=>{el.hidden=user.role!=='admin';});
    const quick=$('quickTheme');
    if(quick)quick.addEventListener('click',async()=>{
      const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
      window.UnisicTheme?.set(next);
      try {await api('/api/settings/me','PUT',{theme:next});}
      catch(error){showMessage('Il tema è stato applicato solo in questo browser: '+error.message);}
    });
    const avatar=$('avatar');
    if(avatar)avatar.textContent=(user.name||'A').slice(0,1).toUpperCase();
    const date=$('todayDate');
    if(date)date.textContent=new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
    const logout=$('logout');
    logout?.addEventListener('click',async()=>{try{await api('/api/auth/logout','POST')}finally{location.assign('/login.html')}});
    const toggle=$('menuToggle');
    toggle?.addEventListener('click',()=>document.querySelector('.sidebar')?.classList.toggle('open'));
    document.querySelectorAll('[data-admin="true"]').forEach(el=>{if(user.role!=='admin')el.hidden=true;});
    return user;
  }catch{location.replace('/login.html');throw new Error('Autenticazione richiesta');}
}
export async function guardAdmin(){
  const user=await auth();
  if(user.role!=='admin'){location.replace('/homepage.html');throw new Error('Riservato agli amministratori');}
  return user;
}
export function formValue(form,name,value){const field=form?.elements?.namedItem(name);if(field && 'value' in field)field.value=value??'';}
