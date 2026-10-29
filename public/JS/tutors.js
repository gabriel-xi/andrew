import {api,auth,$,clear,node,badge,action,empty,showMessage} from './shared.js';
const user=await auth();
const data=await api('/api/tutors');let tutors=data.tutors;
$('teamCount').textContent=tutors.length+' profili';
function render(){
 const query=$('search').value.toLowerCase().trim(),target=clear('tutors');
 const filtered=tutors.filter(u=>(u.name+' '+u.role).toLowerCase().includes(query));
 if(!filtered.length){target.append(empty('Nessun tutor trovato'));return;}
 for(const member of filtered){
  const item=node('article','person'),avatar=node('span','avatar',member.name.slice(0,1).toUpperCase()),content=node('div');
  content.append(node('strong','',member.name),node('small','',''),badge(member.role==='admin'?'Amministratore':'Tutor',member.role));
  if(user.role==='admin' && user.id!==member.id){
   const next=member.role==='admin'?'tutor':'admin';
   content.append(action('Imposta '+next,async()=>{
    if(!confirm('Modificare il ruolo di '+member.name+'?'))return;
    try{await api('/api/tutors/'+member.id,'PUT',{role:next});member.role=next;render();showMessage('Ruolo aggiornato','success');}catch(error){showMessage(error.message);}
   }));
  }
  item.append(avatar,content);target.append(item);
 }
}
$('search').addEventListener('input',render);render();
