import test from 'node:test';
import assert from 'node:assert/strict';
import {createXlsx} from '../src/xlsx.js';
import {parseCalendarData,internalConflicts} from '../src/courseImport.js';
import {createServer} from '../src/app.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('parser calendario Excel e gestione collisioni locali',()=>{
 const book=createXlsx([{name:'Lezioni',headers:['Data','Inizio','Fine','Lezione','Modulo','Docente','Fase','Stato','Note','Test'],
 rows:[['2026-11-12','09:00','13:00','Aula','Modulo 1','Prof. A','aula','confermata','','Si'],
       ['2026-11-12','12:00','14:00','Aula 2','Modulo 2','Prof. A','aula','confermata','','No']]}]);
 const parsed=parseCalendarData(book,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 assert.equal(parsed.records.length,2);
 assert.equal(parsed.records[0].is_module_test,1);
 assert.equal(internalConflicts(parsed.records).length,1);
});
test('API import calendario: preview, consenso esplicito, controlli duplicate',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'andrew-course-import-'));
 process.env.ANDREW_DATA_DIR=dir;
 process.env.ANDREW_SETUP_KEY='calendar-import-test-123456789';
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 let cookie;
 async function call(path,method='GET',data,headers={}){
  const request={method,headers:{...headers,...(cookie?{Cookie:cookie}:{})}};
  if(data instanceof Buffer)request.body=data;
  else if(data){request.body=JSON.stringify(data);request.headers['Content-Type']='application/json';}
  return fetch(base+path,request);
 }
 try{
  const setup=await call('/api/auth/register','POST',{name:'Admin',email:'admin@example.test',password:'long-pass-123456789',setup_key:process.env.ANDREW_SETUP_KEY});
  assert.equal(setup.status,201);
  const logged=await call('/api/auth/login','POST',{email:'admin@example.test',password:'long-pass-123456789'});
  cookie=logged.headers.get('set-cookie').split(';')[0];
  const courseResult=await call('/api/courses','POST',{title:'Corso di prova',total_hours:40});
  assert.equal(courseResult.status,201);
  const courseId=(await courseResult.json()).id;
  const book=createXlsx([{name:'Lezioni',headers:['Data','Inizio','Fine','Lezione','Modulo','Docente','Fase','Stato','Note','Test'],
   rows:[['2026-11-12','09:00','13:00','Aula','Modulo 1','Prof. A','aula','confermata','','Si'],
         ['2026-11-13','09:00','13:00','Aula 2','Modulo 2','Prof. A','aula','confermata','','No']]}]);
  const url='/api/course-calendars/parse-file?course_id='+courseId;
  const options={'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  const preview=await call(url,'POST',book,options);
  assert.equal(preview.status,200);
  assert.equal((await preview.json()).total,2);
  const confirmed=await call(url+'&confirm=true','POST',book,options);
  assert.equal(confirmed.status,201);
  assert.equal((await confirmed.json()).imported,2);
  assert.equal((await call(url+'&confirm=true','POST',book,options)).status,409);
  const events=await call('/api/calendar?month=2026-11');
  assert.equal((await events.json()).events.length,2);
  const template=await call('/api/course-calendars/template');
  assert.equal(template.status,200);
  assert.equal(Buffer.from(await template.arrayBuffer()).subarray(0,2).toString(),'PK');
 }finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
