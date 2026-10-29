import {HttpError} from '../src/app.js';
import {validateTimecard,saveTimecard,removeTimecard} from '../src/timetracking.js';
export default function register(router){
 router.add('GET','/api/timecards',({db,user,query,send})=>{
  const target=query.get('user_id')&&user.role==='admin'?Number(query.get('user_id')):user.id;
  const month=query.get('month');
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpError(400,'Mese non valido');
  if(!Number.isSafeInteger(target)||target<=0)throw new HttpError(400,'Profilo non valido');
  const sql='SELECT t.*,c.title AS course_title FROM timecards t LEFT JOIN courses c ON c.id=t.course_id WHERE t.user_id=?'
   +(month?" AND substr(t.work_date,1,7)=?":'')+' ORDER BY t.work_date DESC,t.id DESC LIMIT 500';
  const rows=month?db.prepare(sql).all(target,month):db.prepare(sql).all(target);
  send(200,{status:'ok',timecards:rows});
 });
 router.add('POST','/api/timecards',async ({db,user,body,send})=>{
  let data;
  try{data=validateTimecard(await body());}catch(error){throw new HttpError(400,error.message);}
  if(data.course_id&&!db.prepare('SELECT 1 FROM courses WHERE id=?').get(data.course_id))throw new HttpError(404,'Corso inesistente');
  const id=saveTimecard(db,user.id,data);
  send(201,{status:'ok',id,delta_hours:data.delta_minutes/60});
 });
 router.add('PUT','/api/timecards/:id',async ({db,user,params,body,send})=>{
  const id=Number(params.id);
  if(!Number.isSafeInteger(id)||id<=0)throw new HttpError(400,'ID non valido');
  let data;try{data=validateTimecard(await body());}catch(error){throw new HttpError(400,error.message);}
  if(data.course_id&&!db.prepare('SELECT 1 FROM courses WHERE id=?').get(data.course_id))throw new HttpError(404,'Corso inesistente');
  const old=db.prepare('SELECT 1 FROM timecards WHERE id=? AND user_id=?').get(id,user.id);
  if(!old)throw new HttpError(404,'Registrazione non trovata');
  saveTimecard(db,user.id,data,id);send(200,{status:'ok',delta_hours:data.delta_minutes/60});
 });
 router.add('DELETE','/api/timecards/:id',({db,user,params,send})=>{
  const id=Number(params.id);
  if(!Number.isSafeInteger(id)||id<=0)throw new HttpError(400,'ID non valido');
  if(!removeTimecard(db,user.id,id))throw new HttpError(404,'Registrazione non trovata');
  send(200,{status:'ok'});
 });
}
