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
  router.add('POST','/api/me/entries',async ({db,user,body,send}) => {
    let value;
    try { value=validateWorkEntry(await body()); } catch (error) { throw new HttpError(400,error.message); }
    if (value.course_id && !db.prepare('SELECT id FROM courses WHERE id=?').get(value.course_id)) throw new HttpError(404,'Corso inesistente');
    const result=db.prepare('INSERT INTO work_entries (user_id,course_id,work_date,hours,kind,note) VALUES (?,?,?,?,?,?)')
      .run(user.id,value.course_id,value.work_date,value.hours,value.kind,value.note);
    send(201,{status:'ok',id:Number(result.lastInsertRowid)});
  });
  router.add('DELETE','/api/me/entries/:id',({db,user,params,send}) => {
    const result=db.prepare('DELETE FROM work_entries WHERE id=? AND user_id=?').run(Number(params.id),user.id);
    if (!result.changes) throw new HttpError(404,'Movimento inesistente');
    send(200,{status:'ok'});
  });
}
