import { HttpError } from '../src/app.js';
import { isDate } from '../src/db.js';

function positiveId(value) {
  const id=Number(value);
  if(!Number.isSafeInteger(id) || id<=0) throw new HttpError(400,'Identificativo non valido');
  return id;
}
function validate(value) {
  const title=String(value.title||'').trim().slice(0,180);
  const type=String(value.contract_type||'Altro').trim().slice(0,100);
  const status=String(value.status||'Attivo').trim().slice(0,80);
  if(!title || !type) throw new HttpError(400,'Titolo e tipologia obbligatori');
  for(const key of ['start_date','end_date']) {
    if(value[key] && !isDate(value[key])) throw new HttpError(400,'Data non valida: '+key);
  }
  if(value.start_date && value.end_date && value.start_date>value.end_date) throw new HttpError(400,'Date del contratto invertite');
  const daily=Number(value.daily_hours??4),weekly=Number(value.weekly_hours??20);
  if(!Number.isFinite(daily)||daily<0||daily>24||!Number.isFinite(weekly)||weekly<0||weekly>168)throw new HttpError(400,'Ore contrattuali non valide');
  const times=['work_start_time','work_end_time','lunch_break_start','lunch_break_end'];
  const clock=/^([01]\d|2[0-3]):[0-5]\d$/;
  for(const key of times) if(value[key] && !clock.test(value[key])) throw new HttpError(400,'Orario non valido: '+key);
  return {
    title, contract_type:type, contract_regime:String(value.contract_regime||'').slice(0,100),
    start_date:value.start_date||null,end_date:value.end_date||null,status,
    work_days:String(value.work_days??'lun,mar,mer,gio,ven').slice(0,70),
    work_start_time:String(value.work_start_time??'09:00'),work_end_time:String(value.work_end_time??'13:00'),
    lunch_break_start:String(value.lunch_break_start||''),lunch_break_end:String(value.lunch_break_end||''),
    daily_hours:daily,weekly_hours:weekly,has_fixed_schedule:value.has_fixed_schedule===false?0:1,
    schedule_details:typeof value.schedule_details==='object'?JSON.stringify(value.schedule_details):'{}',
    renewal_notes:String(value.renewal_notes||'').slice(0,1000),notes:String(value.notes||'').slice(0,2000)
  };
}
export default function register(router) {
  router.add('GET','/api/contracts',({db,user,query,send})=>{
    const target=query.get('user_id')?positiveId(query.get('user_id')):user.id;
    if(target!==user.id && user.role!=='admin') throw new HttpError(403,'Non puoi leggere i contratti di altri utenti');
    const contracts=db.prepare('SELECT * FROM employee_contracts WHERE user_id=? ORDER BY start_date DESC,id DESC').all(target);
    send(200,{status:'ok',contracts});
  });
  router.add('POST','/api/contracts',async ({db,user,body,send})=>{
    const raw=await body(),target=raw.user_id?positiveId(raw.user_id):user.id;
    if(target!==user.id && user.role!=='admin') throw new HttpError(403,'Operazione non consentita');
    if(!db.prepare('SELECT id FROM users WHERE id=? AND is_active=1').get(target)) throw new HttpError(404,'Utente inesistente');
    const c=validate(raw),fields=Object.keys(c);
    const sql='INSERT INTO employee_contracts (user_id,'+fields.join(',')+') VALUES (?,'+fields.map(()=>'?').join(',')+')';
    const result=db.prepare(sql).run(target,...fields.map(k=>c[k]));
    send(201,{status:'ok',id:Number(result.lastInsertRowid)});
  });
  router.add('PUT','/api/contracts/:id',async ({db,user,params,body,send})=>{
    const id=positiveId(params.id),old=db.prepare('SELECT user_id FROM employee_contracts WHERE id=?').get(id);
    if(!old) throw new HttpError(404,'Contratto inesistente');
    if(old.user_id!==user.id && user.role!=='admin') throw new HttpError(403,'Operazione non consentita');
    const c=validate(await body()),keys=Object.keys(c);
    db.prepare('UPDATE employee_contracts SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>c[k]),id);
    send(200,{status:'ok'});
  });
  router.add('DELETE','/api/contracts/:id',({db,user,params,send})=>{
    const id=positiveId(params.id),old=db.prepare('SELECT user_id FROM employee_contracts WHERE id=?').get(id);
    if(!old) throw new HttpError(404,'Contratto inesistente');
    if(old.user_id!==user.id && user.role!=='admin') throw new HttpError(403,'Operazione non consentita');
    db.prepare('DELETE FROM employee_contracts WHERE id=?').run(id);
    send(200,{status:'ok'});
  });
}
