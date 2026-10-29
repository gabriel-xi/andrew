import { validateEvent,findConflicts } from '../src/calendar.js';
import { HttpError } from '../src/app.js';
import { courseById } from '../src/db.js';

export default function register(router) {
  router.add('GET','/api/calendar',({db,query,send}) => {
    const month = query.get('month');
    if (month && !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400,'Mese non valido');
    const events = month
      ? db.prepare("SELECT e.*,c.title AS course_title FROM calendar_events e JOIN courses c ON c.id=e.course_id WHERE substr(event_date,1,7)=? ORDER BY event_date,start_time").all(month)
      : db.prepare('SELECT e.*,c.title AS course_title FROM calendar_events e JOIN courses c ON c.id=e.course_id ORDER BY event_date DESC,start_time LIMIT 500').all();
    send(200,{status:'ok',events});
  });
  router.add('POST','/api/calendar',async ({db,body,send}) => {
    let e;
    try { e=validateEvent(await body()); } catch(error) { throw new HttpError(400,error.message); }
    if (!courseById(db,e.course_id)) throw new HttpError(404,'Corso inesistente');
    if(e.calendar_id){
      const parent=db.prepare('SELECT course_id FROM course_calendars WHERE id=?').get(e.calendar_id);
      if(!parent||parent.course_id!==e.course_id)throw new HttpError(400,'Il calendario non appartiene al corso');
    }
    const conflicts=findConflicts(db,e);
    if (conflicts.length) return send(409,{status:'error',message:'Sovrapposizione docente/tutor',conflicts});
    const result=db.prepare('INSERT INTO calendar_events (course_id,event_date,start_time,end_time,title,instructor,tutor_id,phase,status,notes,calendar_id,module,is_module_test,postponed_to,reschedule_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(e.course_id,e.event_date,e.start_time,e.end_time,e.title,e.instructor,e.tutor_id,e.phase,e.status,e.notes,e.calendar_id,e.module,e.is_module_test,e.postponed_to,e.reschedule_reason);
    send(201,{status:'ok',id:Number(result.lastInsertRowid)});
  },'admin');
  router.add('PUT','/api/calendar/:id',async ({db,params,body,send}) => {
    const id=Number(params.id);
    if (!db.prepare('SELECT id FROM calendar_events WHERE id=?').get(id)) throw new HttpError(404,'Evento inesistente');
    let e;
    try { e=validateEvent(await body()); } catch(error) { throw new HttpError(400,error.message); }
    if (!courseById(db,e.course_id)) throw new HttpError(404,'Corso inesistente');
    if(e.calendar_id){
      const parent=db.prepare('SELECT course_id FROM course_calendars WHERE id=?').get(e.calendar_id);
      if(!parent||parent.course_id!==e.course_id)throw new HttpError(400,'Il calendario non appartiene al corso');
    }
    const conflicts=findConflicts(db,e,id);
    if (conflicts.length) return send(409,{status:'error',message:'Sovrapposizione docente/tutor',conflicts});
    db.prepare('UPDATE calendar_events SET course_id=?,event_date=?,start_time=?,end_time=?,title=?,instructor=?,tutor_id=?,phase=?,status=?,notes=?,calendar_id=?,module=?,is_module_test=?,postponed_to=?,reschedule_reason=? WHERE id=?')
      .run(e.course_id,e.event_date,e.start_time,e.end_time,e.title,e.instructor,e.tutor_id,e.phase,e.status,e.notes,e.calendar_id,e.module,e.is_module_test,e.postponed_to,e.reschedule_reason,id);
    send(200,{status:'ok'});
  },'admin');
  router.add('DELETE','/api/calendar/:id',({db,params,send}) => {
    const result=db.prepare('DELETE FROM calendar_events WHERE id=?').run(Number(params.id));
    if (!result.changes) throw new HttpError(404,'Evento inesistente');
    send(200,{status:'ok'});
  },'admin');
}
