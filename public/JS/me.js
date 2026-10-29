import {api,auth,$,clear,stat,node,table,badge,action,buttonGroup,openDialog,closeDialog,bindForm,formatDate,hours,showMessage,empty} from './shared.js';
const user=await auth();
$('work_date').value=new Date().toISOString().slice(0,10);
const courseSelect=$('course_id');
for(const c of (await api('/api/courses')).courses){const opt=node('option','',c.title);opt.value=c.id;courseSelect.append(opt);}
async function load(){
 const [profile,entryResponse,contractResponse,legacyResponse]=await Promise.all([api('/api/me'),api('/api/me/entries'),api('/api/contracts'),api('/api/me/history')]);
 const bank=profile.bank,entries=entryResponse.entries;
 clear('profileStats').append(stat('Saldo disponibile',hours(bank.balance),'◷','#b6a0ff','Saldo progressivo'),
  stat('Crediti maturati',hours(bank.credit),'↗','#66e0b9','Ore aggiunte'),
  stat('Ore utilizzate',hours(bank.debit),'↘','#ff99a8','Debiti e permessi'),
  stat('Giorni equivalenti',bank.days_on_standard===null?'—':String(Math.round(bank.days_on_standard*100)/100),'▣','#6fe3e8','Sulla giornata standard'));
 const chart=clear('bankVisual');chart.append(node('div','balance-big',hours(bank.balance)));
 const credit=Math.max(0,bank.credit),debit=Math.max(0,bank.debit),total=credit+debit||1;
 const meter=node('div','meter'),positive=node('span'),negative=node('span','debit');
 positive.style.width=(credit/total*100)+'%';negative.style.width=(debit/total*100)+'%';
 meter.append(positive,negative);chart.append(meter,node('p','muted','Saldo iniziale: '+hours(bank.initial)+' · Crediti: '+hours(credit)+' · Debiti: '+hours(debit)));
 table('entries',['Data','Tipo','Ore','Nota','Azioni'],entries.map(e=>[
  formatDate(e.work_date),badge(e.kind==='credit'?'Maturate':'Utilizzate',e.kind==='credit'?'completed':'cancelled'),
  (e.kind==='credit'?'+':'−')+hours(e.hours),e.note||'—',
  action('Elimina',async()=>{
    if(!confirm('Eliminare questo movimento?'))return;
    try{await api('/api/me/entries/'+e.id,'DELETE');await load();showMessage('Movimento eliminato','success');}catch(error){showMessage(error.message);}
  },'btn danger small')
 ]));
 $('legacyCount').textContent=legacyResponse.total+' registrazioni';
 table('legacyHistory',['Data','Attività','Ore registrate','Ore effettive','Corso'],legacyResponse.history.map(e=>[
  formatDate(e.work_date),e.entry_type, hours(e.hours),hours(e.actual_hours),e.course_title||'—'
 ]));
 table('contracts',['Contratto','Tipo','Periodo','Ore/settimana','Stato','Azioni'],contractResponse.contracts.map(c=>[
  c.title,c.contract_type,(c.start_date?formatDate(c.start_date):'—')+' → '+(c.end_date?formatDate(c.end_date):'—'),
  hours(c.weekly_hours),badge(c.status),action('Elimina',async()=>{
    if(!confirm('Eliminare il contratto "'+c.title+'"?'))return;
    try{await api('/api/contracts/'+c.id,'DELETE');await load();showMessage('Contratto eliminato','success');}catch(error){showMessage(error.message);}
  },'btn danger small')
 ]));
}
bindForm('form',async raw=>{
 await api('/api/me/entries','POST',{...raw,hours:Number(raw.hours),course_id:raw.course_id?Number(raw.course_id):null});
 await load();
});
$('addContract').addEventListener('click',()=>openDialog('contractDialog'));
$('closeContract').addEventListener('click',()=>closeDialog('contractDialog'));
bindForm('contractForm',async raw=>{
 await api('/api/contracts','POST',{...raw,daily_hours:Number(raw.daily_hours),weekly_hours:Number(raw.weekly_hours)});
 closeDialog('contractDialog');await load();
});
await load();

let previewFile=null;
const fileInput=$('importFile'),confirmImport=$('confirmImport'),importInfo=$('importInfo');
fileInput.addEventListener('change',()=>{previewFile=null;confirmImport.disabled=true;importInfo.textContent='';});
async function uploadForImport(file,confirm){
 const type=file.name.toLowerCase().endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 const response=await fetch('/api/import/excel?confirm='+(confirm?'true':'false'),{
  method:'POST',credentials:'same-origin',headers:{'Content-Type':type},body:file
 });
 const data=await response.json();
 if(!response.ok)throw Error(data.message||'Importazione non riuscita');
 return data;
}
$('importForm').addEventListener('submit',async event=>{
 event.preventDefault();const file=fileInput.files[0];if(!file)return;
 if(file.size>12*1024*1024){showMessage('File troppo grande');return;}
 confirmImport.disabled=true;previewFile=null;
 try{
  const result=await uploadForImport(file,false);
  importInfo.textContent='Righe valide: '+result.total+' · Righe scartate: '+result.skipped.length+
   (result.skipped.length?' (righe '+result.skipped.slice(0,20).join(', ')+')':'')+
   (result.already_imported?' · FILE GIÀ IMPORTATO':'');
  previewFile=file;confirmImport.disabled=result.already_imported||result.total===0;
  showMessage('Anteprima pronta. Verifica il numero di record prima di confermare.','success');
 }catch(error){showMessage(error.message);}
});
confirmImport.addEventListener('click',async()=>{
 if(!previewFile||previewFile!==fileInput.files[0])return;
 if(!confirm('Confermi l’importazione dei movimenti nel tuo saldo ore?'))return;
 confirmImport.disabled=true;
 try{
  const result=await uploadForImport(previewFile,true);
  importInfo.textContent='Importati '+result.imported+' movimenti.';
  fileInput.value='';previewFile=null;await load();showMessage('Importazione completata','success');
 }catch(error){showMessage(error.message);}
});

bindForm('passwordForm',async raw=>{
 await api('/api/auth/change-password','POST',raw);
 showMessage('Password aggiornata. Le altre sessioni sono state chiuse.','success');
},{success:'Password aggiornata'});
