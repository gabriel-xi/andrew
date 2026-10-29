import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvent} from '../src/calendar.js';
import {validateRegistration} from '../src/register.js';
import {createServer} from '../src/app.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('validazione input',()=>{
  assert.throws(()=>validateEvent({course_id:1,event_date:'2026-02-30',title:'X',start_time:'10:00',end_time:'11:00'}));
  assert.throws(()=>validateRegistration({name:'A',email:'bad',password:'short'}));
});
test('API: login, ruoli, calendari, conflitti e banca ore',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'andrew-'));
  process.env.ANDREW_DATA_DIR=dir;
  process.env.ANDREW_SETUP_KEY='long-test-secret-setup-key-123456';
  const server=createServer();
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const root='http://127.0.0.1:'+server.address().port;
  async function api(path,method='GET',body,cookie){
    const r=await fetch(root+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
    const contentType=r.headers.get('content-type')||'';
    const value=contentType.includes('json')?await r.json():null;
    return {status:r.status,value,cookie:r.headers.get('set-cookie')?.split(';')[0],text:contentType};
  }
  try{
    assert.equal((await api('/api/health')).status,200);
    assert.equal((await api('/api/me')).status,401);
    assert.equal((await api('/api/admin/overview')).status,401);
    assert.equal((await api('/index.html')).status,200);
    assert.equal((await api('/api/auth/register','POST',{name:'Admin',email:'admin@test.example',password:'longpassword123'})).status,403);
    assert.equal((await api('/api/auth/register','POST',{name:'Admin',email:'admin@test.example',password:'longpassword123',setup_key:process.env.ANDREW_SETUP_KEY})).status,201);
    assert.equal((await api('/api/auth/register','POST',{name:'Tutor',email:'tutor@test.example',password:'longpassword123'})).status,201);
    const admin=(await api('/api/auth/login','POST',{email:'admin@test.example',password:'longpassword123'})).cookie;
    const tutor=(await api('/api/auth/login','POST',{email:'tutor@test.example',password:'longpassword123'})).cookie;
    assert.match(admin,/andrew_session=/);assert.match(tutor,/andrew_session=/);
    assert.equal((await api('/api/courses','POST',{title:'Corso'},tutor)).status,403);
    const course=(await api('/api/courses','POST',{title:'Corso',total_hours:20},admin));
    assert.equal(course.status,201);
    const event={course_id:course.value.id,event_date:'2026-11-04',start_time:'10:00',end_time:'12:00',title:'Lezione',instructor:'Mario'};
    assert.equal((await api('/api/calendar','POST',event,tutor)).status,403);
    assert.equal((await api('/api/calendar','POST',event,admin)).status,201);
    assert.equal((await api('/api/calendar','POST',{...event,start_time:'11:00',end_time:'13:00'},admin)).status,409);
    assert.equal((await api('/api/me/entries','POST',{work_date:'2026-10-29',hours:2,kind:'credit'},tutor)).status,201);
    assert.equal((await api('/api/me','GET',null,tutor)).value.bank.balance,2);
    assert.equal((await api('/api/admin/overview','GET',null,tutor)).status,403);
    assert.equal((await api('/api/auth/logout','POST',null,tutor)).status,200);
    assert.equal((await api('/api/me','GET',null,tutor)).status,401);
  }finally{
    await new Promise(r=>server.close(r));
    rmSync(dir,{recursive:true,force:true});
  }
});
