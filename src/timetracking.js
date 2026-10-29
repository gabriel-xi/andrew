import {isDate} from './db.js';

const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
export function minutes(clock){
 if(!TIME.test(String(clock||'')))throw new Error('Orario non valido: '+clock);
 const [h,m]=clock.split(':').map(Number);return h*60+m;
}
export function duration(start,end,breakStart='',breakEnd=''){
 let left=minutes(start),right=minutes(end);
 if(right<=left)right+=1440;
 let span=right-left;
 if(Boolean(breakStart)!==Boolean(breakEnd))throw new Error('Pausa incompleta');
 if(breakStart){
  let bStart=minutes(breakStart),bEnd=minutes(breakEnd);
  if(bStart<left)bStart+=1440;
  if(bEnd<=bStart)bEnd+=1440;
  const overlap=Math.max(0,Math.min(right,bEnd)-Math.max(left,bStart));
  span-=overlap;
 }
 if(span<0||span>24*60)throw new Error('Durata giornaliera non valida');
 return span;
}
export function validateTimecard(data){
 if(!data || !isDate(data.work_date))throw new Error('Data non valida');
 const keys=['scheduled_start','scheduled_end','actual_start','actual_end','lunch_start','lunch_end'];
 for(const name of keys.slice(0,4))minutes(data[name]);
 if(data.lunch_start)minutes(data.lunch_start);
 if(data.lunch_end)minutes(data.lunch_end);
 const planned=duration(data.scheduled_start,data.scheduled_end,data.lunch_start||'',data.lunch_end||'');
 const actual=duration(data.actual_start,data.actual_end,data.lunch_start||'',data.lunch_end||'');
 const courseId=data.course_id?Number(data.course_id):null;
 if(courseId!==null && (!Number.isSafeInteger(courseId)||courseId<=0))throw new Error('Corso non valido');
 return {work_date:data.work_date,course_id:courseId,scheduled_start:data.scheduled_start,
  scheduled_end:data.scheduled_end,actual_start:data.actual_start,actual_end:data.actual_end,
  lunch_start:data.lunch_start||'',lunch_end:data.lunch_end||'',
  scheduled_minutes:planned,actual_minutes:actual,delta_minutes:actual-planned,
  activity:String(data.activity||'Lavoro ordinario').trim().slice(0,120),
  note:String(data.note||'').trim().slice(0,1000)};
}
export function saveTimecard(db,userId,record,existingId=null){
 const keys=Object.keys(record);
 db.exec('BEGIN IMMEDIATE');
 try{
  let id=existingId;
  if(existingId){
   const old=db.prepare('SELECT * FROM timecards WHERE id=? AND user_id=?').get(existingId,userId);
   if(!old)throw new Error('Registrazione non trovata');
   if(old.linked_entry_id)db.prepare('DELETE FROM work_entries WHERE id=? AND user_id=?').run(old.linked_entry_id,userId);
   db.prepare('UPDATE timecards SET '+keys.map(k=>k+'=?').join(',')+',linked_entry_id=NULL WHERE id=?')
    .run(...keys.map(k=>record[k]),existingId);
  }else{
   const result=db.prepare('INSERT INTO timecards (user_id,'+keys.join(',')+') VALUES (?,'+keys.map(()=>'?').join(',')+')')
    .run(userId,...keys.map(k=>record[k]));
   id=Number(result.lastInsertRowid);
  }
  if(record.delta_minutes!==0){
   const bank=db.prepare('INSERT INTO work_entries (user_id,course_id,work_date,hours,kind,note,scheduled_start,scheduled_end,actual_start,actual_end,scheduled_hours,actual_hours,activity_type,source_payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    userId,record.course_id,record.work_date,Math.abs(record.delta_minutes)/60,
    record.delta_minutes>0?'credit':'debit',record.note,
    record.scheduled_start,record.scheduled_end,record.actual_start,record.actual_end,
    record.scheduled_minutes/60,record.actual_minutes/60,record.activity,JSON.stringify({timecard_id:id}));
   db.prepare('UPDATE timecards SET linked_entry_id=? WHERE id=?').run(Number(bank.lastInsertRowid),id);
  }
  db.exec('COMMIT');
  return id;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function removeTimecard(db,userId,id){
 db.exec('BEGIN IMMEDIATE');
 try{
  const card=db.prepare('SELECT * FROM timecards WHERE id=? AND user_id=?').get(id,userId);
  if(!card){db.exec('ROLLBACK');return false;}
  if(card.linked_entry_id)db.prepare('DELETE FROM work_entries WHERE id=? AND user_id=?').run(card.linked_entry_id,userId);
  db.prepare('DELETE FROM timecards WHERE id=? AND user_id=?').run(id,userId);
  db.exec('COMMIT');return true;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
