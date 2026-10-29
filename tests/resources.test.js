import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../src/app.js';

test('contratti, documenti, permessi e backup SQLite',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'andrew-api-'));
  process.env.ANDREW_DATA_DIR=dir;
  process.env.ANDREW_SETUP_KEY='test-local-secret-very-long-value';
  const app=createServer();
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const root='http://127.0.0.1:'+app.address().port;
  async function call(path,method='GET',data,cookie,headers={}){
    return fetch(root+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...headers,
      ...(data&&!(data instanceof Buffer)?{'Content-Type':'application/json'}:{})},
      body:data instanceof Buffer?data:data?JSON.stringify(data):undefined});
  }
  async function json(...args){const res=await call(...args);return {status:res.status,value:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
  try{
    assert.equal((await json('/api/auth/register','POST',{name:'Admin',email:'admin@example.test',password:'strong-pass-123456',setup_key:process.env.ANDREW_SETUP_KEY})).status,201);
    assert.equal((await json('/api/auth/register','POST',{name:'Tutor',email:'tutor@example.test',password:'strong-pass-123456'})).status,201);
    const admin=(await json('/api/auth/login','POST',{email:'admin@example.test',password:'strong-pass-123456'})).cookie;
    const tutor=(await json('/api/auth/login','POST',{email:'tutor@example.test',password:'strong-pass-123456'})).cookie;
    assert.equal((await json('/api/admin/overview','GET',null,tutor)).status,403);
    assert.equal((await json('/api/contracts','POST',{title:'Tutoraggio',weekly_hours:18},tutor)).status,201);
    assert.equal((await json('/api/contracts','GET',null,tutor)).value.contracts.length,1);
    const uploaded=await call('/api/documents/upload','POST',Buffer.from('Esempio'),tutor,{'Content-Type':'text/plain','X-File-Name':'prova.txt'});
    assert.equal(uploaded.status,201);
    const id=(await uploaded.json()).id;
    assert.equal((await call('/api/documents/'+id+'/download','GET',null,tutor)).status,200);
    assert.equal((await json('/api/documents','GET',null,admin)).value.documents.length,1);
    assert.equal((await call('/api/admin/backup','GET',null,tutor)).status,403);
    const backup=await call('/api/admin/backup','GET',null,admin);
    assert.equal(backup.status,200);
    const bytes=Buffer.from(await backup.arrayBuffer());
    assert.equal(bytes.subarray(0,15).toString('ascii'),'SQLite format 3');
  }finally{
    await new Promise(resolve=>app.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
