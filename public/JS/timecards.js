import {api,auth,$,clear,stat,node,table,badge,action,buttonGroup,
  openDialog,closeDialog,bindForm,formValue,formatDate,hours,showMessage} from './shared.js';
const user=await auth();let rows=[],editingId=null;
const now=new Date();$('month').value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
for(const item of ['closeDialog','cancelDialog'])$(item).addEventListener('click',()=>closeDialog('editorDialog'));
for(const c of (await api('/api/courses')).courses){const option=node('option','',c.title);option.value=c.id;$('course_id').append(option);}
function openEditor(row=null){
 const form=$('form');form.reset();editingId=row?.id||null;
 $('dialogTitle').textContent=row?'Modifica giornata':'Nuova giornata';
 const attrs=['work_date','course_id','scheduled_start','scheduled_end',
   'actual_start','actual_end','lunch_start','lunch_end','activity','note'];
 if(row)for(const name of attrs)formValue(form,name,row[name]||'');
 else formValue(form,'work_date',new Date().toISOString().slice(0,10));
 openDialog('editorDialog');
}
function render(){
 const signed=rows.reduce((sum,r)=>sum+Number(r.delta_minutes||0),0);
 clear('timeStats').append(stat('Giornate registrate',rows.length,'▣','#a99afc'),
  stat('Ore effettive',hours(rows.reduce((s,r)=>s+Number(r.actual_minutes||0),0)/60),'◷','#76e5b5'),
  stat('Scostamento',((signed>0)?'+':'')+hours(signed/60),'↗',signed>=0?'#72e6cb':'#ff93a3'));
 table('timecards',['Data','Attività','Previsto','Effettivo','Differenza','Corso','Azioni'],rows.map(r=>[
  formatDate(r.work_date),r.activity,r.scheduled_start+'–'+r.scheduled_end,
  r.actual_start+'–'+r.actual_end,
  badge(((r.delta_minutes||0)>0?'+':'')+hours(r.delta_minutes/60),(r.delta_minutes||0)>=0?'completed':'cancelled'),
  r.course_title||'—',
  buttonGroup(action('Modifica',()=>openEditor(r)),
   action('Elimina',async()=>{
     if(!confirm('Rimuovere questa giornata e la relativa differenza dalla banca ore?'))return;
     try{await api('/api/timecards/'+r.id,'DELETE');await load();showMessage('Registrazione eliminata','success');}
     catch(error){showMessage(error.message);}
   },'btn danger small'))
 ]));
}
async function load(){rows=(await api('/api/timecards?month='+encodeURIComponent($('month').value))).timecards;render();}
$('addBtn').addEventListener('click',()=>openEditor());
$('month').addEventListener('change',load);
bindForm('form',async raw=>{
 const payload={...raw,course_id:raw.course_id?Number(raw.course_id):null};
 await api(editingId?'/api/timecards/'+editingId:'/api/timecards',editingId?'PUT':'POST',payload);
 closeDialog('editorDialog');await load();
});
await load();
