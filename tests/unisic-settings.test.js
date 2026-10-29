import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../src/app.js';
import {getStoragePaths} from '../src/db.js';

test('Unisic: themes, admin settings, users, privacy, reset and old db compatibility',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'unisic-test-'));
 process.env.UNISIC_DATA_DIR=folder;process.env.UNISIC_SETUP_KEY='safe-unisic-test-key-1234567890';
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 let cookie='',secondCookie='';
 async function call(path,method='GET',data,authCookie=cookie){
  const r=await fetch(base+path,{method,headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(authCookie?{Cookie:authCookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const body=await r.json();return {code:r.status,body,cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 try{
  assert.equal(getStoragePaths().database,join(folder,'unisic.sqlite'));
  assert.equal((await call('/api/settings/public')).body.site_name,'Unisic');
  assert.equal((await call('/api/settings/global')).code,401);
  assert.equal((await call('/api/auth/register','POST',{name:'Admin',email:'owner@example.test',password:'first-admin-pass-123',setup_key:process.env.UNISIC_SETUP_KEY})).code,201);
  cookie=(await call('/api/auth/login','POST',{email:'owner@example.test',password:'first-admin-pass-123'})).cookie;
  assert.ok(cookie);
  assert.equal((await call('/api/settings/me','PUT',{theme:'light',compact_mode:true})).code,200);
  assert.equal((await call('/api/settings/me')).body.preferences.theme,'light');
  assert.equal((await call('/api/settings/me')).body.preferences.compact_mode,true);
  assert.equal((await call('/api/settings/me','PUT',{theme:'rainbow'})).code,400);
  assert.equal((await call('/api/settings/global','PUT',{site_name:'Unisic Pro',default_theme:'dark',registration_enabled:false,allow_tutor_uploads:false})).code,200);
  assert.equal((await call('/api/settings/public')).body.default_theme,'dark');
  assert.equal((await call('/api/auth/register','POST',{name:'Visitor',email:'visitor@example.test',password:'visitor-test-pass-123'})).code,403);
  const created=await call('/api/admin/users','POST',{name:'Tutor',email:'tutor@example.test',password:'tutor-test-pass-123',role:'tutor',is_active:true,initial_bank_hours:8,standard_day_hours:7});
  assert.equal(created.code,201);const tutorId=created.body.id;
  secondCookie=(await call('/api/auth/login','POST',{email:'tutor@example.test',password:'tutor-test-pass-123'},'')).cookie;
  assert.ok(secondCookie);
  assert.equal((await call('/api/settings/global','GET',undefined,secondCookie)).code,403);
  assert.equal((await call('/api/admin/users','GET',undefined,secondCookie)).code,403);
  assert.equal((await call('/api/settings/storage')).body.storage.database,join(folder,'unisic.sqlite'));
  assert.equal((await call('/api/admin/users/'+tutorId,'PUT',{name:'Tutor Updated',role:'tutor',is_active:false})).code,200);
  assert.equal((await call('/api/settings/me','GET',undefined,secondCookie)).code,401);
  assert.equal((await call('/api/admin/users/'+tutorId,'PUT',{is_active:true})).code,200);
  const passwordReset=await call('/api/admin/users/'+tutorId+'/reset-password','POST',{});
  assert.equal(passwordReset.code,200);assert.ok(passwordReset.body.temporary_password.length>=12);
  const newCookie=(await call('/api/auth/login','POST',{email:'tutor@example.test',password:passwordReset.body.temporary_password},'')).cookie;
  assert.ok(newCookie);
  assert.equal((await call('/api/admin/users/1','DELETE',{confirmation:'ELIMINA ACCOUNT',password:'first-admin-pass-123'})).code,409);
  assert.equal((await call('/api/admin/users/'+tutorId,'DELETE',{confirmation:'ELIMINA ACCOUNT',password:'wrong'})).code,403);
  assert.equal((await call('/api/admin/users/'+tutorId,'DELETE',{confirmation:'ELIMINA ACCOUNT',password:'first-admin-pass-123'})).code,200);
  assert.equal((await call('/api/settings/me','GET',undefined,newCookie)).code,401);
  assert.equal((await call('/api/admin/workspace','DELETE',{confirmation:'ELIMINA TUTTO',password:'incorrect'})).code,403);
  assert.equal((await call('/api/admin/workspace','DELETE',{confirmation:'ELIMINA TUTTO',password:'first-admin-pass-123'})).code,200);
  assert.equal((await call('/api/settings/me')).code,401);
  assert.equal((await call('/api/auth/setup-status')).body.needs_setup,true);
  assert.equal((await call('/api/settings/public')).body.site_name,'Unisic');
 }finally{
  await new Promise(resolve=>server.close(resolve));rmSync(folder,{recursive:true,force:true});
 }
});
