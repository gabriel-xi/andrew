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

const migration=await api('/api/admin/migration/reconciliation');
$('migrationBadge').textContent=migration.mismatches?'Differenze: '+migration.mismatches:'Saldi coerenti';
table('migrationReconciliation',['Profilo','Atteso','Attuale','Differenza'],migration.users.map(x=>[
 x.name,x.expected.toFixed(2)+' h',x.actual.toFixed(2)+' h',
 x.difference===0?'OK':x.difference.toFixed(2)+' h'
]));
const unmapped=clear('migrationUnmapped');
unmapped.append(node('h3','','Dati storici da verificare'));
const grid=node('div');unmapped.append(grid);
table(grid,['Tabella legacy','Record da controllare'],migration.unmapped.map(e=>[e.legacy_table,e.n]));
