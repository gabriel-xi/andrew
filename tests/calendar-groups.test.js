import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../src/app.js';

test('calendari ufficiali: lezioni, moduli, rinvii e protezione referenziale',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'andrew-calendars-'));
 process.env.ANDREW_DATA_DIR=dir;
 process.env.ANDREW_SETUP_KEY='calendar-test-secret-key-123456';
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;let cookie;
 async function req(path,method='GET',body){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 try{
  assert.equal((await req('/api/auth/register','POST',{name:'Admin',email:'admin@example.test',password:'super-safe-123456',setup_key:process.env.ANDREW_SETUP_KEY})).status,201);
  cookie=(await req('/api/auth/login','POST',{email:'admin@example.test',password:'super-safe-123456'})).cookie;
  const course=(await req('/api/courses','POST',{title:'Informatica',total_hours:40})).data.id;
  const calendar=(await req('/api/course-calendars','POST',{course_id:course,title:'ED 2026',start_date:'2026-11-01',expected_end_date:'2026-12-31'}));
  assert.equal(calendar.status,201);
  const id=calendar.data.id;
  const event={course_id:course,calendar_id:id,event_date:'2026-11-15',start_time:'09:00',
   end_time:'13:00',title:'Introduzione',instructor:'Docente',module:'Introduzione',is_module_test:1};
  const session=await req('/api/calendar','POST',event);
  assert.equal(session.status,201);
  const cal=await req('/api/course-calendars/'+id);
  assert.equal(cal.data.calendar.sessions.length,1);
  assert.equal(cal.data.calendar.sessions[0].is_module_test,1);
  assert.equal((await req('/api/course-calendars/'+id,'DELETE')).status,409);
  const postponed=await req('/api/calendar/'+session.data.id,'PUT',{...event,status:'postponed',postponed_to:'2026-11-22',reschedule_reason:'Aula indisponibile'});
  assert.equal(postponed.status,200);
  assert.equal((await req('/api/course-calendars/'+id)).data.calendar.sessions[0].postponed_to,'2026-11-22');
  assert.equal((await req('/api/calendar/'+session.data.id,'DELETE')).status,200);
  assert.equal((await req('/api/course-calendars/'+id,'DELETE')).status,200);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 }
});
