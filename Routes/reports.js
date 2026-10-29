import { HttpError } from '../src/app.js';
import { isDate } from '../src/db.js';
import { bankSummary } from '../src/me.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync,unlinkSync } from 'node:fs';
function csvValue(value) {
  let s=String(value??'');
  if(/^[\s]*[=+@\-]/.test(s))s="'"+s; // Prevent spreadsheet formula injection.
  return '"'+s.replaceAll('"','""')+'"';
}
export function toCsv(headers,rows) {
  return '\ufeff'+[headers,...rows].map(r=>r.map(csvValue).join(';')).join('\r\n')+'\r\n';
}
export default function register(router) {
  router.add('GET','/api/reports/overview',({db,user,send})=>{
    const courses=db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM courses").get();
    const events=db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled FROM calendar_events").get();
    const upcoming=db.prepare("SELECT e.*,c.title AS course_title FROM calendar_events e JOIN courses c ON c.id=e.course_id WHERE e.event_date>=date('now') AND e.status='confirmed' ORDER BY e.event_date,e.start_time LIMIT 8").all();
    const myEntries=db.prepare('SELECT work_date,kind,hours FROM work_entries WHERE user_id=? ORDER BY work_date DESC LIMIT 8').all(user.id);
    send(200,{status:'ok',courses,events,upcoming,my_entries:myEntries,bank:bankSummary(db,user.id)});
  });
  router.add('GET','/api/reports/monthly',({db,user,query,send})=>{
    const month=query.get('month')||new Date().toISOString().slice(0,7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpError(400,'Mese non valido');
    let target=user.id;
    if(query.get('user_id') && user.role==='admin')target=Number(query.get('user_id'));
    if(!Number.isSafeInteger(target)||target<=0)throw new HttpError(400,'Utente non valido');
    const movements=db.prepare("SELECT work_date,kind,hours,note FROM work_entries WHERE user_id=? AND substr(work_date,1,7)=? ORDER BY work_date,id").all(target,month);
    const days=db.prepare("SELECT work_date, COALESCE(SUM(CASE WHEN kind='credit' THEN hours ELSE -hours END),0) AS delta FROM work_entries WHERE user_id=? AND substr(work_date,1,7)=? GROUP BY work_date ORDER BY work_date").all(target,month);
    send(200,{status:'ok',month,user_id:target,movements,days,bank:bankSummary(db,target)});
  });
  router.add('GET','/api/reports/weekly',({db,user,query,send})=>{
    const date=query.get('date')||new Date().toISOString().slice(0,10);
    if(!isDate(date))throw new HttpError(400,'Data non valida');
    const day=new Date(date+'T12:00:00Z'),offset=(day.getUTCDay()+6)%7;
    day.setUTCDate(day.getUTCDate()-offset);
    const monday=day.toISOString().slice(0,10);
    day.setUTCDate(day.getUTCDate()+6);
    const sunday=day.toISOString().slice(0,10);
    const entries=db.prepare('SELECT * FROM work_entries WHERE user_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date,id').all(user.id,monday,sunday);
    const sessions=db.prepare('SELECT e.*, c.title AS course_title FROM calendar_events e JOIN courses c ON c.id=e.course_id WHERE (e.tutor_id=? OR c.tutor_id=?) AND e.event_date BETWEEN ? AND ? ORDER BY e.event_date,e.start_time').all(user.id,user.id,monday,sunday);
    send(200,{status:'ok',from:monday,to:sunday,entries,sessions});
  });
  router.add('GET','/api/reports/instructors',({db,send})=>{
    const instructors=db.prepare("SELECT instructor,COUNT(*) AS sessions,ROUND(SUM((CAST(substr(end_time,1,2) AS INTEGER)*60+CAST(substr(end_time,4,2) AS INTEGER)-CAST(substr(start_time,1,2) AS INTEGER)*60-CAST(substr(start_time,4,2) AS INTEGER))/60.0),2) AS hours FROM calendar_events WHERE TRIM(instructor)<>'' AND status<>'cancelled' AND status<>'postponed' GROUP BY instructor ORDER BY instructor COLLATE NOCASE").all();
    send(200,{status:'ok',instructors});
  });
  router.add('GET','/api/export/csv',({db,user,query,res})=>{
    const target=query.get('user_id')&&user.role==='admin'?Number(query.get('user_id')):user.id;
    if(!Number.isSafeInteger(target)||target<=0)throw new HttpError(400,'Utente non valido');
    const rows=db.prepare('SELECT work_date,kind,hours,note FROM work_entries WHERE user_id=? ORDER BY work_date,id').all(target);
    const result=toCsv(['Data','Tipo','Ore','Nota'],rows.map(x=>[x.work_date,x.kind,x.hours,x.note]));
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="banca_ore.csv"','Cache-Control':'no-store'});
    res.end(result);
  });
  router.add('GET','/api/admin/backup',({db,res})=>{
    const snapshot=join(tmpdir(),'andrew-'+randomUUID()+'.sqlite');
    try{
      db.prepare('VACUUM INTO ?').run(snapshot);
      const data=readFileSync(snapshot);
      res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Disposition':'attachment; filename="andrew-backup.sqlite"','Cache-Control':'no-store'});
      res.end(data);
    }finally{try{unlinkSync(snapshot);}catch{}}
  },'admin');
}
