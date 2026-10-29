import {api,auth,$,clear,node,table,action,buttonGroup,formatDate,showMessage,empty} from './shared.js';
const user=await auth();
for(const course of (await api('/api/courses')).courses){
 const option=node('option','',course.title);option.value=course.id;$('course_id').append(option);
}
async function load(){
 const docs=(await api('/api/documents')).documents;
 table('documents',['Titolo','Categoria','Dimensioni','Data','Azioni'],docs.map(d=>[
  d.title,d.category,(Number(d.size_bytes)/1024).toFixed(1)+' KB',formatDate(d.created_at.slice(0,10)),
  buttonGroup(action('Scarica',()=>location.assign('/api/documents/'+d.id+'/download')),
    action('Elimina',async()=>{
      if(!confirm('Eliminare il documento "'+d.title+'"?'))return;
      try{await api('/api/documents/'+d.id,'DELETE');await load();showMessage('Documento eliminato','success');}catch(error){showMessage(error.message);}
    },'btn danger small'))
 ]));
}
$('uploadForm').addEventListener('submit',async event=>{
 event.preventDefault();showMessage('');
 const form=event.currentTarget,file=$('file').files[0],submit=form.querySelector('button');
 if(!file){showMessage('Seleziona un documento');return;}
 if(file.size>10*1024*1024){showMessage('Il file supera 10 MB');return;}
 submit.disabled=true;
 try{
  const values=Object.fromEntries(new FormData(form));
  const response=await fetch('/api/documents/upload',{method:'POST',credentials:'same-origin',headers:{
    'Content-Type':file.type||'application/octet-stream',
    'X-File-Name':encodeURIComponent(file.name),
    'X-Title':encodeURIComponent(values.title||file.name),
    'X-Category':encodeURIComponent(values.category||'Generale'),
    ...(values.course_id?{'X-Course-Id':values.course_id}:{})
  },body:file});
  const result=await response.json();
  if(!response.ok)throw Error(result.message||'Upload non riuscito');
  form.reset();await load();showMessage('Documento caricato con successo','success');
 }catch(error){showMessage(error.message);}finally{submit.disabled=false;}
});
await load();
