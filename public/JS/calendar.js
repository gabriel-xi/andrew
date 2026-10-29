import {api,auth,$,clear,node,stat,table,badge,action,buttonGroup,openDialog,closeDialog,bindForm,formValue,formatDate,hours,showMessage,empty} from './shared.js';
const user=await auth();let events=[],editingId=null,calendars=[],editingCalendarId=null;
const now=new Date();
$('month').value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
for(const id of ['closeDialog','cancelDialog'])$(id).addEventListener('click',()=>closeDialog('editorDialog'));
const courses=(await api('/api/courses')).courses;
for(const c of courses){const option=node('option','',c.title);option.value=c.id;$('import_course_id').append(option);}
for(const c of courses){
 for(const id of ['course_id','calendar_course_id']){
  const option=node('option','',c.title);option.value=c.id;$(id).append(option);
 }
}
const tutors=(await api('/api/tutors')).tutors;
for(const tutor of tutors)for(const id of ['tutor_id','stage_tutor_id']){
 const option=node('option','',tutor.name);option.value=tutor.id;$(id).append(option);
}
$('addBtn').addEventListener('click',()=>openEditor());
$('addCalendar').addEventListener('click',()=>openCalendarEditor());
for(const id of ['closeCalendarDialog','cancelCalendarDialog'])$(id).addEventListener('click',()=>closeDialog('calendarMetaDialog'));
function openEditor(event=null){
 editingId=event?.id||null;const form=$('form');form.reset();
 $('dialogTitle').textContent=event?'Modifica lezione':'Nuova lezione';
 if(event)for(const name of ['course_id','calendar_id','title','event_date','start_time','end_time','instructor','tutor_id','phase','status','notes','module','postponed_to','reschedule_reason'])
   formValue(form,name,event[name]);
 else formValue(form,'event_date',new Date().toISOString().slice(0,10));
 form.elements.is_module_test.checked=Boolean(event?.is_module_test);
 openDialog('editorDialog');
}
const statusLabel={confirmed:'Confermata',completed:'Svolta',postponed:'Rinviata',cancelled:'Annullata'};
function renderCalendars(){
 const rows=calendars.map(c=>[
  c.title,c.course_title,c.start_date?formatDate(c.start_date):'—',c.expected_end_date?formatDate(c.expected_end_date):'—',
  String(c.total_sessions||0),hours(c.planned_hours||0),
  user.role==='admin'?buttonGroup(action('Modifica',()=>openCalendarEditor(c)),
   action('Elimina',async()=>{
    if(!confirm('Eliminare il calendario '+c.title+'? Le lezioni associate devono essere prima rimosse.'))return;
    try{await api('/api/course-calendars/'+c.id,'DELETE');await load();showMessage('Calendario eliminato','success');}catch(error){showMessage(error.message);}
   },'btn danger small')):'—'
 ]);
 table('officialCalendars',['Calendario','Corso','Inizio','Fine','Lezioni','Ore','Azioni'],rows);
 const select=$('calendar_id'),selected=select.value;select.replaceChildren();
 const none=node('option','','Nessuno');none.value='';select.append(none);
 for(const c of calendars){const opt=node('option','',c.title+' — '+c.course_title);opt.value=c.id;opt.dataset.course=c.course_id;select.append(opt);}
 select.value=selected;
 const importSelect=$('import_calendar_id'),prior=importSelect.value;importSelect.replaceChildren();
 const first=node('option','','Crea nuovo calendario');first.value='';importSelect.append(first);
 const selectedCourse=Number($('import_course_id').value);
 for(const c of calendars.filter(c=>c.course_id===selectedCourse)){
  const opt=node('option','',c.title);opt.value=c.id;importSelect.append(opt);
 }
 if([...importSelect.options].some(o=>o.value===prior))importSelect.value=prior;
}
function openCalendarEditor(item=null){
 editingCalendarId=item?.id||null;const form=$('calendarForm');form.reset();
 $('calendarDialogTitle').textContent=item?'Modifica calendario':'Nuovo calendario';
 if(item)for(const key of ['course_id','title','start_date','expected_end_date','stage_start_date','stage_end_date','stage_tutor_id','status','notes'])formValue(form,key,item[key]);
 openDialog('calendarMetaDialog');
}
function render(){
 renderCalendars();
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
  (e.instructor||'—')+(e.module?' · '+e.module:''),badge(statusLabel[e.status]||e.status,e.status),
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
async function load(){const data=await Promise.all([api('/api/calendar?month='+encodeURIComponent($('month').value)),api('/api/course-calendars')]);events=data[0].events;calendars=data[1].calendars;render();}
bindForm('form',async raw=>{
 const payload={...raw,course_id:Number(raw.course_id),calendar_id:raw.calendar_id?Number(raw.calendar_id):null,tutor_id:raw.tutor_id?Number(raw.tutor_id):null,is_module_test:raw.is_module_test==='on'};
 await api(editingId?'/api/calendar/'+editingId:'/api/calendar',editingId?'PUT':'POST',payload);
 closeDialog('editorDialog');await load();
});
bindForm('calendarForm',async raw=>{
 const payload={...raw,course_id:Number(raw.course_id),stage_tutor_id:raw.stage_tutor_id?Number(raw.stage_tutor_id):null};
 await api(editingCalendarId?'/api/course-calendars/'+editingCalendarId:'/api/course-calendars',editingCalendarId?'PUT':'POST',payload);
 closeDialog('calendarMetaDialog');await load();
});
$('month').addEventListener('change',load);
$('todayBtn').addEventListener('click',()=>{$('month').value=new Date().toISOString().slice(0,7);load();});
await load();

let previewFile=null;
const importFile=$('calendarImportFile'),importConfirm=$('confirmCalendarImport'),importInfo=$('calendarImportInfo');
$('import_course_id').addEventListener('change',()=>{renderCalendars();previewFile=null;importConfirm.disabled=true;});
$('import_calendar_id').addEventListener('change',()=>{previewFile=null;importConfirm.disabled=true;});
importFile.addEventListener('change',()=>{previewFile=null;importConfirm.disabled=true;importInfo.textContent='';});
async function importCalendar(file,confirm=false){
 const courseId=Number($('import_course_id').value);
 if(!courseId)throw Error('Seleziona un corso');
 const query=new URLSearchParams({course_id:String(courseId),confirm:String(confirm)});
 if($('import_calendar_id').value)query.set('calendar_id',$('import_calendar_id').value);
 const res=await fetch('/api/course-calendars/parse-file?'+query,{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':file.name.toLowerCase().endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:file});
 const data=await res.json();
 if(!res.ok)throw Error(data.message||'Impossibile analizzare il file');
 return data;
}
$('calendarImportForm').addEventListener('submit',async event=>{
 event.preventDefault();const file=importFile.files[0];if(!file)return;
 importConfirm.disabled=true;previewFile=null;
 if(file.size>8*1024*1024){showMessage('Il file supera 8 MiB');return;}
 try{
  const result=await importCalendar(file);
  importInfo.textContent='Lezioni: '+result.total+' · Righe scartate: '+result.skipped.length+
   ' · Sovrapposizioni: '+result.conflicts.length+(result.already_imported?' · GIÀ IMPORTATO':'');
  previewFile=file;
  importConfirm.disabled=!result.total||result.skipped.length>0||result.conflicts.length>0||result.already_imported;
  showMessage('Anteprima completata. Verifica errori e sovrapposizioni prima di importare.','success');
 }catch(error){showMessage(error.message);}
});
importConfirm.addEventListener('click',async()=>{
 if(!previewFile||previewFile!==importFile.files[0])return;
 if(!confirm('Confermi la registrazione delle lezioni nel calendario?'))return;
 importConfirm.disabled=true;
 try{
  const result=await importCalendar(previewFile,true);
  importInfo.textContent='Lezioni importate: '+result.imported+' · Calendario '+result.calendar_id;
  importFile.value='';previewFile=null;await load();
  showMessage('Importazione calendario completata','success');
 }catch(error){showMessage(error.message);}
});
