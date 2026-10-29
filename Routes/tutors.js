import { HttpError } from '../src/app.js';
export default function register(router) {
  router.add('GET','/api/tutors',({db,send}) => {
    const tutors=db.prepare("SELECT id,name,role FROM users ORDER BY name COLLATE NOCASE").all();
    send(200,{status:'ok',tutors});
  });
  router.add('PUT','/api/tutors/:id',async ({db,params,body,send}) => {
    const id=Number(params.id), value=await body();
    if (!['admin','tutor'].includes(value.role)) throw new HttpError(400,'Ruolo non valido');
    if (id <= 0 || !Number.isSafeInteger(id)) throw new HttpError(400,'Identificativo non valido');
    const old=db.prepare('SELECT role FROM users WHERE id=?').get(id);
    if (!old) throw new HttpError(404,'Utente inesistente');
    if (old.role === 'admin' && value.role !== 'admin') {
      const admins=db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
      if (admins <= 1) throw new HttpError(409,'Impossibile rimuovere l’ultimo amministratore');
    }
    db.prepare('UPDATE users SET role=? WHERE id=?').run(value.role,id);
    send(200,{status:'ok'});
  },'admin');
}
