import {HttpError} from '../src/app.js';
import {isDate} from '../src/db.js';
function parseId(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new HttpError(400,'ID non valido');return n;}
function checked(data){
 const courseId=parseId(data.course_id),title=String(data.title||'').trim();
 if(!title||title.length>180)throw new HttpError(400,'Titolo calendario obbligatorio');
 for(const key of ['start_date','expected_end_date','stage_start_date','stage_end_date'])
  if(data[key]&&!isDate(data[key]))throw new HttpError(400,'Data non valida: '+key);
 if(data.start_date&&data.expected_end_date&&data.start_date>data.expected_end_date)
  throw new HttpError(400,'Date del calendario invertite');
 if(data.stage_start_date&&data.stage_end_date&&data.stage_start_date>data.stage_end_date)
  throw new HttpError(400,'Date stage invertite');
 const tutorId=data.stage_tutor_id?parseId(data.stage_tutor_id):null;
 return {course_id:courseId,title,
  start_date:data.start_date||null,expected_end_date:data.expected_end_date||null,
  stage_start_date:data.stage_start_date||null,stage_end_date:data.stage_end_date||null,
  stage_tutor_id:tutorId,status:String(data.status||'In Corso').slice(0,60),
  notes:String(data.notes||'').slice(0,2500)};
}
function checkReferences(db,data){
 if(!db.prepare('SELECT id FROM courses WHERE id=?').get(data.course_id))throw new HttpError(404,'Corso inesistente');
 if(data.stage_tutor_id&&!db.prepare('SELECT id FROM users WHERE id=?').get(data.stage_tutor_id))
  throw new HttpError(400,'Tutor di stage inesistente');
}
export default function register(router){
 router.add('GET','/api/course-calendars',({db,send})=>{
  const calendars=db.prepare('SELECT cal.*,c.title AS course_title,u.name AS stage_tutor_name,'+
   '(SELECT COUNT(*) FROM calendar_events e WHERE e.calendar_id=cal.id) AS total_sessions,'+
   '(SELECT COALESCE(SUM((CAST(substr(e.end_time,1,2) AS INTEGER)*60+CAST(substr(e.end_time,4,2) AS INTEGER)-CAST(substr(e.start_time,1,2) AS INTEGER)*60-CAST(substr(e.start_time,4,2) AS INTEGER))/60.0),0) FROM calendar_events e WHERE e.calendar_id=cal.id AND e.status NOT IN (\'cancelled\',\'postponed\')) AS planned_hours '+
   'FROM course_calendars cal JOIN courses c ON c.id=cal.course_id LEFT JOIN users u ON u.id=cal.stage_tutor_id ORDER BY cal.start_date DESC,cal.id DESC').all();
  send(200,{status:'ok',calendars});
 });
 router.add('GET','/api/course-calendars/:id',({db,params,send})=>{
  const id=parseId(params.id);
  const cal=db.prepare('SELECT cal.*,c.title AS course_title FROM course_calendars cal JOIN courses c ON c.id=cal.course_id WHERE cal.id=?').get(id);
  if(!cal)throw new HttpError(404,'Calendario inesistente');
  const sessions=db.prepare('SELECT * FROM calendar_events WHERE calendar_id=? ORDER BY event_date,start_time').all(id);
  send(200,{status:'ok',calendar:{...cal,sessions}});
 });
 router.add('POST','/api/course-calendars',async ({db,body,send})=>{
  const c=checked(await body());checkReferences(db,c);
  const keys=Object.keys(c);
  const result=db.prepare('INSERT INTO course_calendars ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')')
   .run(...keys.map(k=>c[k]));
  send(201,{status:'ok',id:Number(result.lastInsertRowid)});
 },'admin');
 router.add('PUT','/api/course-calendars/:id',async ({db,params,body,send})=>{
  const id=parseId(params.id);
  if(!db.prepare('SELECT 1 FROM course_calendars WHERE id=?').get(id))throw new HttpError(404,'Calendario inesistente');
  const c=checked(await body());checkReferences(db,c);
  if(db.prepare('SELECT COUNT(*) AS n FROM calendar_events WHERE calendar_id=? AND course_id<>?').get(id,c.course_id).n)
   throw new HttpError(409,'Riassegna prima le lezioni a un calendario del corso corretto');
  const keys=Object.keys(c);
  db.prepare('UPDATE course_calendars SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>c[k]),id);
  send(200,{status:'ok'});
 },'admin');
 router.add('DELETE','/api/course-calendars/:id',({db,params,send})=>{
  const id=parseId(params.id);
  if(db.prepare('SELECT COUNT(*) AS n FROM calendar_events WHERE calendar_id=?').get(id).n)
   throw new HttpError(409,'Sposta o elimina prima le lezioni associate al calendario');
  const result=db.prepare('DELETE FROM course_calendars WHERE id=?').run(id);
  if(!result.changes)throw new HttpError(404,'Calendario inesistente');
  send(200,{status:'ok'});
 },'admin');
}
