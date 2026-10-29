import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../src/app.js';

test('password rotation invalidates previous sessions; setup stays single-admin',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'andrew-rotate-'));
 process.env.ANDREW_DATA_DIR=dir;
 process.env.ANDREW_SETUP_KEY='very-long-random-secret-1234567890';
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 async function call(path,method='GET',body,cookie){
  const response=await fetch(base+path,{method,
   headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},
   body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 try{
  const first=await call('/api/auth/register','POST',{name:'Admin',email:'admin@example.test',password:'first-password-1234',setup_key:process.env.ANDREW_SETUP_KEY});
  assert.equal(first.status,201);
  const second=await call('/api/auth/register','POST',{name:'Tutor',email:'tutor@example.test',password:'first-password-1234',setup_key:process.env.ANDREW_SETUP_KEY});
  assert.equal(second.status,201);assert.equal(second.body.user.role,'tutor');
  const firstCookie=(await call('/api/auth/login','POST',{email:'admin@example.test',password:'first-password-1234'})).cookie;
  const secondCookie=(await call('/api/auth/login','POST',{email:'admin@example.test',password:'first-password-1234'})).cookie;
  const changed=await call('/api/auth/change-password','POST',{current_password:'first-password-1234',new_password:'second-password-5678'},firstCookie);
  assert.equal(changed.status,200);
  assert.equal((await call('/api/auth/me','GET',null,secondCookie)).status,401);
  assert.equal((await call('/api/auth/me','GET',null,changed.cookie)).status,200);
  assert.equal((await call('/api/auth/login','POST',{email:'admin@example.test',password:'first-password-1234'})).status,401);
  assert.equal((await call('/api/auth/login','POST',{email:'admin@example.test',password:'second-password-5678'})).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
