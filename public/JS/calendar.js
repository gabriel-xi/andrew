import {api,auth,$,clear,node,stat,table,badge,action,buttonGroup,openDialog,closeDialog,bindForm,formValue,formatDate,hours,showMessage,empty} from './shared.js';
const user=await auth();let events=[],editingId=null;
const now=new Date();
$('month').value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
for(const id of ['closeDialog','cancelDialog'])$(id).addEventListener('click',()=>closeDialog('editorDialog'));
const courses=(await api('/api/courses')).courses;
for(const c of courses){
 const option=node('option','',c.title);option.value=c.id;$('course_id').append(option);
}
$('addBtn').addEventListener('click',()=>openEditor());
function openEditor(event=null){
 editingId=event?.id||null;const form=$('form');form.reset();
 $('dialogTitle').textContent=event?'Modifica lezione':'Nuova lezione';
 if(event)for(const name of ['course_id','title','event_date','start_time','end_time','instructor','phase','status','notes'])
   formValue(form,name,event[name]);
 else formValue(form,'event_date',new Date().toISOString().slice(0,10));
 openDialog('editorDialog');
}
const statusLabel={confirmed:'Confermata',completed:'Svolta',postponed:'Rinviata',cancelled:'Annullata'};
function render(){
 const [year,month]=$('month').value.split('-').map(Number);
 const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
 const firstDay=(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7;
 const today=new Date().toISOString().slice(0,10),calendar=clear('calendar');
 for(const d of ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'])calendar.append(node('div','day-label',d));
 const byDate=new Map();
 for(const ev of events){const a=byDate.get(ev.event_date)||[];a.push(ev);byDate.set(ev.event_date,a);}
 const cells=Math.ceil((firstDay+daysInMonth)/7)*7;
 for(let index=0;index<cells;index++){
  const date=new Date(Date.UTC(year,month-1,1+index-firstDay)),key=date.toISOString().slice(0,10),day=date.getUTCDate();
  const card=node('div','calendar-day'+(date.getUTCMonth()!==month-1?' other':'')+(key===today?' today':''));
  card.append(node('div','calendar-number',day));
  for(const e of (byDate.get(key)||[]).slice(0,3)){
    const chip=node('button','event-chip',e.start_time+' '+e.title);
    chip.title=e.title+' • '+e.instructor+' • '+statusLabel[e.status];
    chip.disabled=user.role!=='admin';chip.addEventListener('click',()=>openEditor(e));card.append(chip);
  }
  const overflow=(byDate.get(key)||[]).length-3;
  if(overflow>0)card.append(node('div','pill-count','+'+overflow+' altre'));
  calendar.append(card);
 }
 const agenda=clear('agenda');
 const rows=events.map(e=>[
  formatDate(e.event_date),e.start_time+'–'+e.end_time,e.title,e.course_title,
  e.instructor||'—',badge(statusLabel[e.status]||e.status,e.status),
  user.role==='admin'?buttonGroup(action('Modifica',()=>openEditor(e)),
   action('Elimina',async()=>{
    if(!confirm('Eliminare la lezione "'+e.title+'"?'))return;
    try{await api('/api/calendar/'+e.id,'DELETE');await load();showMessage('Lezione eliminata','success');}catch(error){showMessage(error.message);}
   },'btn danger small')):'—'
 ]);
 table(agenda,['Data','Ora','Lezione','Corso','Docente','Stato','Azioni'],rows);
 $('calendarRange').textContent=new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric'}).format(new Date(Date.UTC(year,month-1,1)));
 const duration=e=>(Number(e.end_time.slice(0,2))*60+Number(e.end_time.slice(3,5))-Number(e.start_time.slice(0,2))*60-Number(e.start_time.slice(3,5)))/60;
 clear('calendarStats').append(stat('Lezioni del mese',events.length,'▦','#b39aff'),
   stat('Ore programmate',hours(events.filter(e=>!['cancelled','postponed'].includes(e.status)).reduce((n,e)=>n+duration(e),0)),'◷','#67dce6'),
   stat('Concluse',events.filter(e=>e.status==='completed').length,'✓','#72e0b2'));
}
async function load(){events=(await api('/api/calendar?month='+encodeURIComponent($('month').value))).events;render();}
bindForm('form',async raw=>{
 const payload={...raw,course_id:Number(raw.course_id)};
 await api(editingId?'/api/calendar/'+editingId:'/api/calendar',editingId?'PUT':'POST',payload);
 closeDialog('editorDialog');await load();
});
$('month').addEventListener('change',load);
$('todayBtn').addEventListener('click',()=>{$('month').value=new Date().toISOString().slice(0,7);load();});
await load();
