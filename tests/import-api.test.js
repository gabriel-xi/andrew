import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../src/app.js';
import {createXlsx,parseXlsx} from '../src/xlsx.js';

test('Excel upload preview -> confirm -> blocco duplicati -> export',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'andrew-xlsx-api-'));
 process.env.ANDREW_DATA_DIR=dir;
 process.env.ANDREW_SETUP_KEY='another-very-long-test-key-321';
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try {
  const reg=await fetch(base+'/api/auth/register',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'Responsabile',email:'res@example.test',password:'strong-password-123',setup_key:process.env.ANDREW_SETUP_KEY})});
  assert.equal(reg.status,201);
  const login=await fetch(base+'/api/auth/login',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:'res@example.test',password:'strong-password-123'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const input=createXlsx([
   {name:'Riepilogo',headers:['Campo','Valore'],rows:[['Saldo',0]]},
   {name:'Registro',headers:['Data','Tipo','Ore','Nota'],rows:[
    ['2026-10-29','maturata',3,'Extra'],['2026-10-30','utilizzata',1,'Permesso']]}
  ]);
  const options={method:'POST',headers:{Cookie:cookie,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:input};
  const preview=await fetch(base+'/api/import/excel',options);
  assert.equal(preview.status,200);
  assert.equal((await preview.json()).total,2);
  const target=base+'/api/import/excel?confirm=true';
  assert.equal((await fetch(target,options)).status,201);
  assert.equal((await fetch(target,options)).status,409);
  const me=await fetch(base+'/api/me',{headers:{Cookie:cookie}});
  assert.equal((await me.json()).bank.balance,2);
  const exported=await fetch(base+'/api/export/excel',{headers:{Cookie:cookie}});
  assert.equal(exported.status,200);
  const rows=parseXlsx(Buffer.from(await exported.arrayBuffer()),2);
  assert.equal(rows.length,3);
  assert.equal(rows[1][3],'Extra');
 }finally {
  await new Promise(resolve=>server.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 }
});
