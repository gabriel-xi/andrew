import {createHash} from 'node:crypto';
import {HttpError} from '../src/app.js';
import {parseCalendarData,internalConflicts} from '../src/courseImport.js';
import {findConflicts} from '../src/calendar.js';
import {createXlsx} from '../src/xlsx.js';

async function readInput(req) {
  const chunks=[];let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>8*1024*1024)throw new HttpError(413,'Dimensione massima file calendario: 8 MiB');
    chunks.push(chunk);
  }
  if(!size)throw new HttpError(400,'File vuoto');
  return Buffer.concat(chunks);
}
function id(raw,label='ID') {
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<=0)throw new HttpError(400,label+' non valido');
  return value;
}
function ownedCalendar(db,courseId,raw) {
  if(!raw)return null;
  const calendarId=id(raw,'Calendario');
  const cal=db.prepare('SELECT course_id FROM course_calendars WHERE id=?').get(calendarId);
  if(!cal||cal.course_id!==courseId)throw new HttpError(400,'Calendario non associato al corso');
  return calendarId;
}
export default function register(router) {
  router.add('GET','/api/course-calendars/template',({res})=>{
    const data=createXlsx([{name:'Calendario',headers:['Data','Inizio','Fine','Lezione','Modulo','Docente','Fase','Stato','Note','Test'],rows:[
      ['2026-11-02','09:00','13:00','Introduzione','Modulo 1','Docente','aula','confermata','','No'],
      ['2026-11-03','09:00','13:00','Stage','','','stage','confermata','','No']
    ]}]);
    res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':'attachment; filename="modello-calendario-andrew.xlsx"',
      'Content-Length':data.length,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(data);
  });
  router.add('POST','/api/course-calendars/parse-file',async ({db,user,req,query,send})=>{
    const courseId=id(query.get('course_id'),'Corso');
    const course=db.prepare('SELECT id,title FROM courses WHERE id=?').get(courseId);
    if(!course)throw new HttpError(404,'Corso inesistente');
    const calendarId=ownedCalendar(db,courseId,query.get('calendar_id'));
    const file=await readInput(req);
    const fingerprint=createHash('sha256').update(file).digest('hex');
    const existing=db.prepare('SELECT id FROM calendar_import_batches WHERE course_id=? AND sha256=?').get(courseId,fingerprint);
    let parsed;
    try {parsed=parseCalendarData(file,String(req.headers['content-type']||''));}
    catch(error){throw new HttpError(400,'Formato calendario non valido: '+error.message);}
    const within=internalConflicts(parsed.records);
    const conflicts=parsed.records.flatMap(row=>findConflicts(db,{...row,course_id:courseId})
      .map(c=>({event:row.title,date:row.event_date,other:c.title,other_id:c.id,resource:c.instructor||c.tutor_id})));
    const allConflicts=[...within,...conflicts];
    if(query.get('confirm')!=='true') {
      send(200,{status:'ok',preview:true,total:parsed.records.length,skipped:parsed.skipped,
        conflicts:allConflicts.slice(0,100),sample:parsed.records.slice(0,15),already_imported:Boolean(existing)});
      return;
    }
    if(existing)throw new HttpError(409,'Questo calendario è già stato importato nel corso');
    if(!parsed.records.length)throw new HttpError(400,'Nessuna lezione valida');
    if(parsed.skipped.length)throw new HttpError(409,'Righe scartate: correggi il file prima di confermare');
    if(allConflicts.length)throw new HttpError(409,'Sono presenti sovrapposizioni: correggi il calendario');
    db.exec('BEGIN IMMEDIATE');
    try {
      let targetCalendar=calendarId;
      if(!targetCalendar) {
        const dates=parsed.records.map(r=>r.event_date).sort();
        const calendar=db.prepare('INSERT INTO course_calendars (course_id,title,start_date,expected_end_date,status) VALUES (?,?,?,?,?)')
          .run(courseId,'Import - '+course.title+' - '+dates[0],dates[0],dates[dates.length-1],'In Corso');
        targetCalendar=Number(calendar.lastInsertRowid);
      }
      const statement=db.prepare('INSERT INTO calendar_events (course_id,calendar_id,event_date,start_time,end_time,title,instructor,tutor_id,phase,status,notes,module,is_module_test) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const e of parsed.records) {
        if(e.tutor_id && !db.prepare('SELECT id FROM users WHERE id=?').get(e.tutor_id))throw new HttpError(400,'Tutor inesistente nel file');
        statement.run(courseId,targetCalendar,e.event_date,e.start_time,e.end_time,e.title,e.instructor,e.tutor_id,e.phase,e.status,e.notes,e.module,e.is_module_test);
      }
      db.prepare('INSERT INTO calendar_import_batches (user_id,course_id,calendar_id,sha256,records) VALUES (?,?,?,?,?)')
        .run(user.id,courseId,targetCalendar,fingerprint,parsed.records.length);
      db.exec('COMMIT');
      send(201,{status:'ok',imported:parsed.records.length,calendar_id:targetCalendar});
    }catch(error){db.exec('ROLLBACK');throw error;}
  },'admin');
}
