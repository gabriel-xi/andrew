import { mkdirSync,writeFileSync,readFileSync,unlinkSync,existsSync } from 'node:fs';
import { resolve,join,basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../src/app.js';

const storage=()=>{const dir=resolve(process.env.ANDREW_DATA_DIR||'./data','documents');mkdirSync(dir,{recursive:true,mode:0o700});return dir;};
function own(doc,user,db) {
  if (user.role==='admin' || doc.owner_id===user.id) return true;
  return doc.course_id && Boolean(db.prepare('SELECT 1 FROM courses WHERE id=? AND tutor_id=?').get(doc.course_id,user.id));
}
function identifier(raw){const id=Number(raw);if(!Number.isSafeInteger(id)||id<=0)throw new HttpError(400,'ID non valido');return id;}
export default function register(router){
  router.add('GET','/api/documents',({db,user,send})=>{
    const docs=user.role==='admin'
      ?db.prepare('SELECT id,title,filename,mime_type,size_bytes,category,notes,created_at,owner_id,course_id FROM documents ORDER BY id DESC').all()
      :db.prepare('SELECT d.id,d.title,d.filename,d.mime_type,d.size_bytes,d.category,d.notes,d.created_at,d.owner_id,d.course_id FROM documents d LEFT JOIN courses c ON c.id=d.course_id WHERE d.owner_id=? OR c.tutor_id=? ORDER BY d.id DESC').all(user.id,user.id);
    send(200,{status:'ok',documents:docs});
  });
  router.add('POST','/api/documents/upload',async ({db,user,req,send})=>{
    const name=basename(decodeURIComponent(String(req.headers['x-file-name']||'')).replaceAll('\\','/')).slice(0,180);
    if (!name || name==='.' || name==='..') throw new HttpError(400,'Nome file non valido');
    const type=String(req.headers['content-type']||'application/octet-stream');
    if (!['application/pdf','application/octet-stream','image/png','image/jpeg','text/plain','text/csv',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(type))throw new HttpError(415,'Tipo file non supportato');
    const rawCourse=req.headers['x-course-id'],cid=rawCourse?identifier(rawCourse):null;
    if(cid){
      const course=db.prepare('SELECT tutor_id FROM courses WHERE id=?').get(cid);
      if(!course)throw new HttpError(404,'Corso inesistente');
      if(user.role!=='admin' && course.tutor_id!==user.id)throw new HttpError(403,'Corso non autorizzato');
    }
    const chunks=[];let length=0;
    for await(const chunk of req){
      length+=chunk.length;
      if(length>10*1024*1024)throw new HttpError(413,'Dimensione massima: 10 MiB');
      chunks.push(chunk);
    }
    if(length===0)throw new HttpError(400,'File vuoto');
    const key=randomUUID(),file=join(storage(),key);
    const title=decodeURIComponent(String(req.headers['x-title']||encodeURIComponent(name))).slice(0,180);
    const category=decodeURIComponent(String(req.headers['x-category']||'Generale')).slice(0,80);
    writeFileSync(file,Buffer.concat(chunks),{flag:'wx',mode:0o600});
    try{
      const result=db.prepare('INSERT INTO documents (owner_id,course_id,title,filename,storage_key,mime_type,size_bytes,category) VALUES (?,?,?,?,?,?,?,?)')
        .run(user.id,cid,title,name,key,type,length,category);
      send(201,{status:'ok',id:Number(result.lastInsertRowid)});
    }catch(error){unlinkSync(file);throw error;}
  });
  router.add('GET','/api/documents/:id/download',({db,user,params,res})=>{
    const doc=db.prepare('SELECT * FROM documents WHERE id=?').get(identifier(params.id));
    if(!doc)throw new HttpError(404,'Documento inesistente');
    if(!own(doc,user,db))throw new HttpError(403,'Documento riservato');
    const file=join(storage(),doc.storage_key);
    if(!existsSync(file))throw new HttpError(404,'File fisico non disponibile');
    const content=readFileSync(file);
    const quoted=encodeURIComponent(doc.filename).replaceAll("'",'%27');
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+quoted,
       'Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(content);
  });
  router.add('DELETE','/api/documents/:id',({db,user,params,send})=>{
    const doc=db.prepare('SELECT * FROM documents WHERE id=?').get(identifier(params.id));
    if(!doc)throw new HttpError(404,'Documento inesistente');
    if(!own(doc,user,db))throw new HttpError(403,'Documento riservato');
    db.prepare('DELETE FROM documents WHERE id=?').run(doc.id);
    const file=join(storage(),doc.storage_key);
    if(existsSync(file))unlinkSync(file);
    send(200,{status:'ok'});
  });
}
