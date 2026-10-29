import { api,auth,$,clear,stat,node,table,badge,action,buttonGroup,openDialog,closeDialog,bindForm,formValue,showMessage,hours } from './shared.js';
const user=await auth();let courses=[],editingId=null;
const dialogs=['closeDialog','cancelDialog'];
for(const id of dialogs)$(id).addEventListener('click',()=>closeDialog('editorDialog'));
$('addBtn').addEventListener('click',()=>openEditor());
const tutors=(await api('/api/tutors')).tutors;
for(const t of tutors){
 const option=node('option','',t.name);option.value=t.id;$('tutor_id').append(option);
}
function openEditor(course=null){
 editingId=course?.id||null;
 const form=$('form');form.reset();
 $('dialogTitle').textContent=course?'Modifica corso':'Nuovo corso';
 for(const name of ['title','code','total_hours','status','tutor_id','description'])
  if(course)formValue(form,name,course[name]??'');
 if(course?.tutor_id)formValue(form,'tutor_id',String(course.tutor_id));
 openDialog('editorDialog');
}
function filtered(){
 const q=$('search').value.toLowerCase().trim(),status=$('statusFilter').value;
 return courses.filter(c=>(!status||status===c.status)&&
  (!q||(c.title+' '+c.code+' '+(c.tutor_name||'')).toLowerCase().includes(q)));
}
function render(){
 const result=filtered(),target=clear('courses');
 const labels={active:'Attivo',planned:'Pianificato',completed:'Concluso'};
 const rows=result.map(c=>{
  const name=node('div','list-copy');name.append(node('strong','',c.title),node('small','',c.description?.slice(0,90)||'Nessuna descrizione'));
  const controls=user.role==='admin'?buttonGroup(
   action('Modifica',()=>openEditor(c)),
   action('Elimina',async()=>{
    if(!confirm('Eliminare definitivamente il corso "'+c.title+'" e le sue lezioni?'))return;
    try{await api('/api/courses/'+c.id,'DELETE');await load();showMessage('Corso eliminato','success');}catch(error){showMessage(error.message);}
   },'btn danger small')):'—';
  return [name,c.code||'—',badge(labels[c.status]||c.status,c.status),hours(c.total_hours),c.tutor_name||'Non assegnato',controls];
 });
 table(target,['Corso','Codice','Stato','Monte ore','Tutor','Azioni'],rows);
}
async function load(){
 courses=(await api('/api/courses')).courses;
 clear('courseStats').append(stat('Corsi totali',courses.length,'▤','#ae9afc'),
  stat('Corsi attivi',courses.filter(c=>c.status==='active').length,'●','#70e2bc'),
  stat('Monte ore totale',hours(courses.reduce((n,c)=>n+Number(c.total_hours||0),0),0),'◷','#68dce8'));
 render();
}
bindForm('form',async raw=>{
 const payload={...raw,total_hours:Number(raw.total_hours),tutor_id:raw.tutor_id?Number(raw.tutor_id):null};
 await api(editingId?'/api/courses/'+editingId:'/api/courses',editingId?'PUT':'POST',payload);
 closeDialog('editorDialog');await load();
});
$('search').addEventListener('input',render);
$('statusFilter').addEventListener('change',render);
await load();
