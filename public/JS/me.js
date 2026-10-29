import {api,auth,$,clear,stat,node,table,badge,action,buttonGroup,openDialog,closeDialog,bindForm,formatDate,hours,showMessage,empty} from './shared.js';
const user=await auth();
$('work_date').value=new Date().toISOString().slice(0,10);
const courseSelect=$('course_id');
for(const c of (await api('/api/courses')).courses){const opt=node('option','',c.title);opt.value=c.id;courseSelect.append(opt);}
async function load(){
 const [profile,entryResponse,contractResponse]=await Promise.all([api('/api/me'),api('/api/me/entries'),api('/api/contracts')]);
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
