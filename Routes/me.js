import { bankSummary,validateWorkEntry } from '../src/me.js';
import { publicUser } from '../src/db.js';
import { HttpError } from '../src/app.js';
export default function register(router) {
  router.add('GET','/api/auth/me',({user,send}) => send(200,{status:'ok',user:publicUser(user)}));
  router.add('GET','/api/me',({db,user,send}) => send(200,{status:'ok',user:publicUser(user),bank:bankSummary(db,user.id)}));
  router.add('GET','/api/me/entries',({db,user,send}) => {
    const entries=db.prepare('SELECT * FROM work_entries WHERE user_id=? ORDER BY work_date DESC,id DESC LIMIT 500').all(user.id);
    send(200,{status:'ok',entries});
  });
  router.add('GET','/api/me/history',({db,user,query,send})=>{
    const month=query.get('month');
    if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpError(400,'Mese non valido');
    const clause=month?" AND substr(h.work_date,1,7)=?":"";
    const params=month?[user.id,month]:[user.id];
    const history=db.prepare(
      'SELECT h.legacy_id,h.work_date,h.entry_type,h.hours,h.scheduled_hours,h.actual_hours,h.note,c.title AS course_title '+
      'FROM legacy_work_history h LEFT JOIN courses c ON h.course_id=c.id WHERE h.user_id=?'+clause+
      ' ORDER BY h.work_date DESC,h.legacy_id DESC LIMIT 1000').all(...params);
    const total=db.prepare('SELECT COUNT(*) AS n FROM legacy_work_history WHERE user_id=?').get(user.id).n;
    send(200,{status:'ok',history,total});
  });
  router.add('POST','/api/me/entries',async ({db,user,body,send}) => {
    let value;
    try { value=validateWorkEntry(await body()); } catch (error) { throw new HttpError(400,error.message); }
    if (value.course_id && !db.prepare('SELECT id FROM courses WHERE id=?').get(value.course_id)) throw new HttpError(404,'Corso inesistente');
    const result=db.prepare('INSERT INTO work_entries (user_id,course_id,work_date,hours,kind,note) VALUES (?,?,?,?,?,?)')
      .run(user.id,value.course_id,value.work_date,value.hours,value.kind,value.note);
    send(201,{status:'ok',id:Number(result.lastInsertRowid)});
  });
  router.add('DELETE','/api/me/entries/:id',({db,user,params,send}) => {
    const linked=db.prepare('SELECT id FROM timecards WHERE linked_entry_id=? AND user_id=?').get(Number(params.id),user.id);
    if(linked)throw new HttpError(409,'Questa registrazione deriva da una presenza. Modificala nella sezione Presenze.');
    const result=db.prepare('DELETE FROM work_entries WHERE id=? AND user_id=?').run(Number(params.id),user.id);
    if (!result.changes) throw new HttpError(404,'Movimento inesistente');
    send(200,{status:'ok'});
  });
}
