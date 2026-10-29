import { createHash } from 'node:crypto';
import { createXlsx,parseXlsx,parseCsv,interpretWorkRows } from '../src/xlsx.js';
import { HttpError } from '../src/app.js';
import { bankSummary } from '../src/me.js';
import { isDate } from '../src/db.js';

async function binary(req,max=12*1024*1024) {
 const chunks=[];let length=0;
 for await(const part of req){
  length+=part.length;
  if(length>max)throw new HttpError(413,'Dimensioni importazione oltre il limite');
  chunks.push(part);
 }
 if(length===0)throw new HttpError(400,'Il file è vuoto');
 return Buffer.concat(chunks);
}
export default function register(router){
 router.add('GET','/api/export/excel',({db,user,query,res})=>{
  const target=query.get('user_id') && user.role==='admin'?Number(query.get('user_id')):user.id;
  if(!Number.isSafeInteger(target)||target<=0)throw new HttpError(400,'Utente non valido');
  const userData=db.prepare('SELECT name FROM users WHERE id=?').get(target);
  if(!userData)throw new HttpError(404,'Profilo inesistente');
  const bank=bankSummary(db,target);
  const entries=db.prepare('SELECT work_date,kind,hours,note FROM work_entries WHERE user_id=? ORDER BY work_date,id').all(target);
  const courses=db.prepare('SELECT title,code,status,total_hours FROM courses ORDER BY id').all();
  const sessions=db.prepare('SELECT e.event_date,e.start_time,e.end_time,e.title,c.title AS course_name,e.instructor,e.phase,e.status,e.module FROM calendar_events e JOIN courses c ON c.id=e.course_id ORDER BY e.event_date,e.start_time').all();
  const buffer=createXlsx([
   {name:'Riepilogo',headers:['Indicatore','Valore'],rows:[
    ['Dipendente',userData.name],['Saldo iniziale',bank.initial],['Ore maturate',bank.credit],['Ore utilizzate',bank.debit],['Saldo finale',bank.balance]]},
   {name:'Registro movimenti',headers:['Data','Tipo','Ore','Nota'],
    rows:entries.map(e=>[e.work_date,e.kind==='credit'?'maturata':'utilizzata',e.hours,e.note])},
   {name:'Calendario',headers:['Data','Inizio','Fine','Attivita','Corso','Docente','Fase','Stato','Modulo'],
    rows:sessions.map(e=>[e.event_date,e.start_time,e.end_time,e.title,e.course_name,e.instructor,e.phase,e.status,e.module||''])},
   {name:'Corsi',headers:['Corso','Codice','Stato','Monte ore'],
    rows:courses.map(c=>[c.title,c.code,c.status,c.total_hours])}
  ]);
  res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   'Content-Disposition':'attachment; filename="andrew-report.xlsx"','Content-Length':buffer.length,
   'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(buffer);
 });
 router.add('POST','/api/import/excel',async ({db,user,req,query,send})=>{
  const input=await binary(req);
  const fingerprint=createHash('sha256').update(input).digest('hex');
  const mime=String(req.headers['content-type']||'');
  let result;
  try {
    if(input[0]===0x50 && input[1]===0x4b) {
      let lastError;
      for(let sheet=1;sheet<=8;sheet++) {
        try { result=interpretWorkRows(parseXlsx(input,sheet)); break; }
        catch(error) {lastError=error;}
      }
      if(!result)throw new Error(lastError?.message||'Nessun foglio con Data e Ore');
    } else if(mime.startsWith('text/csv')||mime.startsWith('text/plain')||mime==='application/octet-stream') {
      result=interpretWorkRows(parseCsv(input.toString('utf8')));
    } else throw new HttpError(415,'Carica un file XLSX o CSV');
  }catch(error){
    if(error.status)throw error;
    throw new HttpError(400,'File non leggibile: '+error.message);
  }
  const errors=result.records.filter(row=>!isDate(row.work_date) || row.hours>10000);
  if(errors.length)throw new HttpError(400,'Alcuni valori di data/ore non sono validi');
  const processed=db.prepare('SELECT id FROM import_batches WHERE user_id=? AND sha256=?').get(user.id,fingerprint);
  if(query.get('confirm')!=='true'){
   return send(200,{status:'ok',preview:true,total:result.records.length,skipped:result.skipped,
    headers_row:result.header_row,sample:result.records.slice(0,12),already_imported:Boolean(processed)});
  }
  if(processed)throw new HttpError(409,'Questo file è già stato importato');
  if(!result.records.length)throw new HttpError(400,'Nessun movimento valido da importare');
  db.exec('BEGIN IMMEDIATE');
  try{
   const statement=db.prepare('INSERT INTO work_entries (user_id,work_date,hours,kind,note,source_payload) VALUES (?,?,?,?,?,?)');
   let imported=0;
   for(const row of result.records){
    let remaining=row.hours;
    while(remaining>0){
     const chunk=Math.min(remaining,24);
     statement.run(user.id,row.work_date,chunk,row.kind,row.note,JSON.stringify({source:'xlsx',sha256:fingerprint}));
     remaining=Math.max(0,Math.round((remaining-chunk)*1000000)/1000000);
     imported++;
    }
   }
   db.prepare('INSERT INTO import_batches (user_id,sha256,records) VALUES (?,?,?)').run(user.id,fingerprint,imported);
   db.exec('COMMIT');
   send(201,{status:'ok',imported,skipped:result.skipped});
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
}
