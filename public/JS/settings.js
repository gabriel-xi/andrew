import {api,auth,$,clear,node,table,badge,buttonGroup,action,openDialog,closeDialog,bindForm,formValue,showMessage,formatDate} from './shared.js';

const current=await auth();
let editingUserId=null,users=[],dangerCallback=null,dangerPhrase='';
const isAdmin=current.role==='admin';

function fillSettings(data) {
 const field=$('personalForm').elements;
 field.namedItem('theme').value=data.preferences.theme;
 field.namedItem('compact_mode').checked=Boolean(data.preferences.compact_mode);
}
function identity() {
 const item=clear('myAccount');
 item.append(node('strong','',current.name),node('p','muted',current.email),
  node('div','',current.role==='admin'?'Amministratore · controllo completo':'Tutor · account personale'));
}
const config=await api('/api/settings/me');
fillSettings(config);
identity();
$('themeSelect').addEventListener('change',()=>{
 window.UnisicTheme?.set($('themeSelect').value);
});
$('compactMode').addEventListener('change',()=>{
 document.documentElement.dataset.compact=$('compactMode').checked?'true':'false';
});
bindForm('personalForm',async raw=>{
 const preferences=await api('/api/settings/me','PUT',{
  theme:raw.theme,compact_mode:$('compactMode').checked
 });
 window.UnisicTheme?.set(preferences.preferences.theme);
 document.documentElement.dataset.compact=preferences.preferences.compact_mode?'true':'false';
},{success:'Preferenze salvate sul tuo account',clearAfter:false});

function confirmDanger({title,description,phrase,callback}) {
 dangerCallback=callback;dangerPhrase=phrase;
 $('dangerTitle').textContent=title;
 $('dangerDescription').textContent=description;
 $('requiredPhrase').textContent=phrase;
 $('dangerForm').reset();
 openDialog('dangerDialog');
}
for(const id of ['closeDangerDialog','cancelDangerDialog']){
 $(id).addEventListener('click',()=>closeDialog('dangerDialog'));
}
bindForm('dangerForm',async raw=>{
 if(raw.confirmation!==dangerPhrase)throw Error('La frase di conferma non coincide');
 if(!dangerCallback)throw Error('Operazione non disponibile');
 if(!confirm('Questa operazione non può essere annullata. Procedere davvero?'))return;
 await dangerCallback(raw);
 closeDialog('dangerDialog');
},{success:'Operazione completata',clearAfter:true});

$('deleteOwnBtn').addEventListener('click',()=>{
 confirmDanger({
  title:'Elimina definitivamente il tuo account',
  description:'Saranno cancellati il profilo, le sessioni, le presenze, i contratti, i movimenti personali e i documenti di proprietà. I corsi rimarranno nell’organizzazione senza il tutor assegnato. Se sei l’ultimo amministratore devi usare il ripristino totale.',
  phrase:'ELIMINA ACCOUNT',
  callback:async data=>{
   await api('/api/account','DELETE',data);
   location.replace('/register.html');
  }
 });
});

if(isAdmin){
 for(const id of ['adminGeneral','adminUsers','adminData','resetWorkspaceBtn'])$(id).hidden=false;
 const global=await api('/api/settings/global');
 const form=$('globalForm');
 for(const key of ['site_name','subtitle','default_theme'])formValue(form,key,global.settings[key]);
 $('registrationEnabled').checked=global.settings.registration_enabled;
 $('tutorUploads').checked=global.settings.allow_tutor_uploads;
 bindForm('globalForm',async raw=>{
  const updated=await api('/api/settings/global','PUT',{
   site_name:raw.site_name,
   subtitle:raw.subtitle,
   default_theme:raw.default_theme,
   registration_enabled:$('registrationEnabled').checked,
   allow_tutor_uploads:$('tutorUploads').checked
  });
  document.querySelectorAll('.brand-name,.crumb-brand').forEach(el=>el.textContent=updated.settings.site_name);
 },{success:'Impostazioni generali salvate',clearAfter:false});

 async function loadUsers(){
  users=(await api('/api/admin/users')).users;
  table('usersTable',['Utente','Ruolo','Stato','Dati','Gestione'],users.map(u=>[
   node('div','list-copy'),badge(u.role==='admin'?'Amministratore':'Tutor',u.role),
   badge(u.is_active?'Attivo':'Sospeso',u.is_active?'completed':'cancelled'),
   'Presenze '+u.timecards+' · Documenti '+u.documents,
   buttonGroup(
    action('Modifica',()=>openUserEditor(u)),
    action('Password',()=>resetPassword(u)),
    action('Sessioni',()=>revokeSessions(u)),
    action('Elimina',()=>askDeleteUser(u),'btn danger small')
   )
  ]));
  // User data is inserted using textContent, never innerHTML.
  const root=$('usersTable').querySelector('tbody');
  if(root)for(const [index,row] of Array.from(root.rows).entries()){
   const display=users[index];
   row.cells[0].replaceChildren(node('strong','',display.name),node('p','muted',display.email));
  }
 }

 function openUserEditor(user=null){
  editingUserId=user?.id??null;
  $('userDialogTitle').textContent=user?'Modifica utente':'Crea nuovo utente';
  const form=$('userForm');form.reset();
  $('newPasswordLabel').hidden=Boolean(user);
  form.elements.namedItem('password').required=!user;
  formValue(form,'name',user?.name??'');
  formValue(form,'email',user?.email??'');
  formValue(form,'role',user?.role??'tutor');
  formValue(form,'standard_day_hours',user?.standard_day_hours??7);
  formValue(form,'initial_bank_hours',user?.initial_bank_hours??0);
  $('userActive').checked=user?Boolean(user.is_active):true;
  openDialog('userDialog');
 }
 $('createUserBtn').addEventListener('click',()=>openUserEditor());
 for(const id of ['closeUserDialog','cancelUserDialog'])$(id).addEventListener('click',()=>closeDialog('userDialog'));
 bindForm('userForm',async raw=>{
  const body={
   name:raw.name,email:raw.email,role:raw.role,
   is_active:$('userActive').checked,
   initial_bank_hours:Number(raw.initial_bank_hours),
   standard_day_hours:Number(raw.standard_day_hours)
  };
  if(editingUserId===null)body.password=raw.password;
  await api(editingUserId===null?'/api/admin/users':'/api/admin/users/'+editingUserId,
    editingUserId===null?'POST':'PUT',body);
  closeDialog('userDialog');
  await loadUsers();
 },{success:'Account salvato'});

 async function resetPassword(user){
  if(!confirm('Generare una nuova password per '+user.name+'? Le sessioni esistenti saranno revocate.'))return;
  try{
   const result=await api('/api/admin/users/'+user.id+'/reset-password','POST',{});
   $('secretDisplay').textContent=result.temporary_password;
   openDialog('secretDialog');
   showMessage('Nuova password generata e sessioni precedenti revocate','success');
  }catch(error){showMessage(error.message);}
 }
 $('closeSecretDialog').addEventListener('click',()=>{
  $('secretDisplay').textContent='';
  closeDialog('secretDialog');
 });
 $('copySecret').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('secretDisplay').textContent);
   showMessage('Password copiata. Condividila solo con il destinatario.','success');
  }catch{showMessage('Copia non riuscita: seleziona la password manualmente.');}
 });
 async function revokeSessions(user){
  if(!confirm('Disconnettere '+user.name+' da tutti i dispositivi?'))return;
  try{
   await api('/api/admin/users/'+user.id+'/revoke-sessions','POST',{});
   showMessage('Tutte le sessioni sono state revocate','success');
  }catch(error){showMessage(error.message);}
 }
 function askDeleteUser(user){
  confirmDanger({
   title:'Elimina '+user.name,
   description:'Elimina account e tutti i dati personali associati, inclusi allegati fisici, contratti, movimenti e sessioni. Non è possibile annullare questa operazione.',
   phrase:'ELIMINA ACCOUNT',
   callback:async data=>{
    await api('/api/admin/users/'+user.id,'DELETE',data);
    if(user.id===current.id){location.replace('/register.html');return;}
    await loadUsers();
   }
  });
 }
 $('resetWorkspaceBtn').addEventListener('click',()=>confirmDanger({
  title:'Elimina l’intero workspace Unisic',
  description:'OPERAZIONE IRREVERSIBILE: verranno cancellati tutti gli utenti, i corsi, i calendari, i documenti, la banca ore, le presenze, i contratti e le impostazioni. Scarica prima un backup. L’app tornerà alla prima registrazione.',
  phrase:'ELIMINA TUTTO',
  callback:async data=>{
   await api('/api/admin/workspace','DELETE',data);
   location.replace('/register.html');
  }
 }));
 async function loadStorage(){
  const {storage}=await api('/api/settings/storage');
  const wrapper=clear('storageInfo');
  for(const [name,value] of [
   ['Cartella dati',storage.directory],['Database SQLite',storage.database],
   ['Documenti',storage.documents],['Compatibilità precedente',storage.legacy_database?'Database Andrew originale':'Database Unisic']
  ]){
   const row=node('div','settings-choice');row.append(node('strong','',name),node('span','settings-code',value));wrapper.append(row);
  }
  const record=node('p','muted','Record: '+Object.entries(storage.records).map(([key,val])=>key+': '+val).join(' · '));
  wrapper.append(record);
  const audit=(await api('/api/settings/audit')).actions;
  const section=clear('auditEvents');
  section.append(node('h3','','Ultime operazioni amministrative'));
  const panel=node('div');section.append(panel);
  table(panel,['Quando','Operazione','Autore'],audit.map(a=>[a.created_at,a.action,a.actor||'Utente eliminato']));
 }
 await Promise.all([loadUsers(),loadStorage()]);
}else{
 for(const el of document.querySelectorAll('[data-admin-nav="true"]'))el.hidden=true;
}
