import{api,guardAdmin,$,clear,stat,node,table,badge,action,formatDate,showMessage}from './shared.js';
const user=await guardAdmin();
const [overview,dbState,users]=await Promise.all([api('/api/admin/overview'),api('/api/db/status'),api('/api/tutors')]);
clear('adminStats').append(
 stat('Utenti',overview.users,'♙','#b19cfc'),
 stat('Corsi',overview.courses,'▤','#66dfc3'),
 stat('Movimenti banca ore',overview.entries,'◷','#6fdded'),
 stat('Integrità database',dbState.database==='ok'?'OK':'Verifica','✓',dbState.database==='ok'?'#62dfb2':'#ff9b9b')
);
const system=clear('system');
system.append(node('p','','Stato SQLite: '+dbState.database),node('p','muted','Il backup è una copia del database. Conserva i file in un luogo sicuro e cifrato.'));
function render(){
 table('admin',['Utente','Ruolo','Azioni'],users.tutors.map(u=>[
  u.name,badge(u.role==='admin'?'Amministratore':'Tutor',u.role),
  u.id===user.id?'Il tuo profilo':action(u.role==='admin'?'Rendi tutor':'Rendi admin',async()=>{
   const next=u.role==='admin'?'tutor':'admin';
   if(!confirm('Assegnare il ruolo '+next+' a '+u.name+'?'))return;
   try{await api('/api/tutors/'+u.id,'PUT',{role:next});u.role=next;render();showMessage('Ruolo aggiornato','success');}catch(error){showMessage(error.message);}
  })
 ]));
}
render();
