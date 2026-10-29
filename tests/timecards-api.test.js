import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../src/app.js';

test('presenze notturne: creazione, aggiornamento e saldo collegato',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'andrew-timecard-'));
 process.env.ANDREW_DATA_DIR=dir;
 process.env.ANDREW_SETUP_KEY='a-strong-setup-key-test-123';
 const s=createServer();
 await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+s.address().port;
 let cookie='';
 async function call(path,method='GET',value){
  const res=await fetch(url+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),
    ...(value?{'Content-Type':'application/json'}:{})},
    body:value?JSON.stringify(value):undefined});
  return {code:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 try{
  assert.equal((await call('/api/auth/register','POST',
   {name:'Admin',email:'admin@example.test',password:'password-long-123',setup_key:process.env.ANDREW_SETUP_KEY})).code,201);
  cookie=(await call('/api/auth/login','POST',{email:'admin@example.test',password:'password-long-123'})).cookie;
  const work={work_date:'2026-10-29',scheduled_start:'22:00',scheduled_end:'06:00',
    actual_start:'22:00',actual_end:'07:00',activity:'Stage'};
  const created=await call('/api/timecards','POST',work);
  assert.equal(created.code,201);
  assert.equal(created.data.delta_hours,1);
  assert.equal((await call('/api/me')).data.bank.balance,1);
  const id=created.data.id;
  const entry=(await call('/api/me/entries')).data.entries[0];
  assert.equal((await call('/api/me/entries/'+entry.id,'DELETE')).code,409);
  const updated=await call('/api/timecards/'+id,'PUT',{...work,actual_end:'05:00'});
  assert.equal(updated.code,200);
  assert.equal(updated.data.delta_hours,-1);
  assert.equal((await call('/api/me')).data.bank.balance,-1);
  assert.equal((await call('/api/timecards')).data.timecards.length,1);
  assert.equal((await call('/api/timecards/'+id,'DELETE')).code,200);
  assert.equal((await call('/api/me')).data.bank.balance,0);
 }finally{
  await new Promise(resolve=>s.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 }
});
