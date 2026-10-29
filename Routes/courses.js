import { courseById } from '../src/db.js';
import { HttpError } from '../src/app.js';
function checked(data) {
  const title=String(data.title || '').trim();
  const code=String(data.code || '').trim();
  const description=String(data.description || '').trim();
  const status=data.status || 'planned';
  const total=Number(data.total_hours || 0);
  const tutor=data.tutor_id ? Number(data.tutor_id) : null;
  if (!title || title.length > 180 || code.length > 40 || description.length > 4000 ||
    !['planned','active','completed'].includes(status) || !Number.isFinite(total) || total < 0 ||
    total > 100000 || (tutor && (!Number.isSafeInteger(tutor) || tutor <= 0))) throw new HttpError(400,'Dati corso non validi');
  return {title,code,description,status,total,tutor};
}
export default function register(router) {
  router.add('GET','/api/courses',({db,send}) => {
    const courses=db.prepare('SELECT c.*,u.name AS tutor_name FROM courses c LEFT JOIN users u ON c.tutor_id=u.id ORDER BY c.created_at DESC,c.id DESC').all();
    send(200,{status:'ok',courses});
  });
  router.add('GET','/api/courses/:id',({db,params,send}) => {
    const course=courseById(db,Number(params.id));
    if (!course) throw new HttpError(404,'Corso inesistente');
    send(200,{status:'ok',course});
  });
  router.add('POST','/api/courses',async ({db,body,send}) => {
    const c=checked(await body());
    if (c.tutor && !db.prepare('SELECT id FROM users WHERE id=?').get(c.tutor)) throw new HttpError(400,'Tutor inesistente');
    const result=db.prepare('INSERT INTO courses (title,code,description,status,total_hours,tutor_id) VALUES (?,?,?,?,?,?)')
      .run(c.title,c.code,c.description,c.status,c.total,c.tutor);
    send(201,{status:'ok',id:Number(result.lastInsertRowid)});
  },'admin');
  router.add('PUT','/api/courses/:id',async ({db,params,body,send}) => {
    const id=Number(params.id);
    if (!courseById(db,id)) throw new HttpError(404,'Corso inesistente');
    const c=checked(await body());
    if (c.tutor && !db.prepare('SELECT id FROM users WHERE id=?').get(c.tutor)) throw new HttpError(400,'Tutor inesistente');
    db.prepare('UPDATE courses SET title=?,code=?,description=?,status=?,total_hours=?,tutor_id=? WHERE id=?')
      .run(c.title,c.code,c.description,c.status,c.total,c.tutor,id);
    send(200,{status:'ok'});
  },'admin');
  router.add('DELETE','/api/courses/:id',({db,params,send}) => {
    const result=db.prepare('DELETE FROM courses WHERE id=?').run(Number(params.id));
    if (!result.changes) throw new HttpError(404,'Corso inesistente');
    send(200,{status:'ok'});
  },'admin');
}
