import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import { getDb } from '../src/db.js';
import { importLegacy,migrationCounts } from '../src/migrate.js';
import { verifyPassword } from '../src/login.js';

test('migrazione: backup legacy in sola lettura, mapping e saldo conservato', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'andrew-migration-'));
 process.env.ANDREW_DATA_DIR=join(dir,'target');
 const source=new DatabaseSync(join(dir,'source.db'));
 try{
  source.exec("CREATE TABLE employees (id INTEGER,name TEXT,email TEXT,role TEXT,password_hash TEXT,salt TEXT,initial_bank_hours REAL,standard_day_hours REAL,is_active INTEGER,deleted_at TEXT);");
  source.exec("CREATE TABLE courses (id INTEGER,name TEXT,code TEXT,notes TEXT,status TEXT,total_allocated_hours REAL,employee_id INTEGER,docente_referente TEXT,color TEXT,integrates_with_contract INTEGER);");
  source.exec("CREATE TABLE work_entries (id INTEGER,employee_id INTEGER,course_id INTEGER,date TEXT,hours REAL,type TEXT,note TEXT);");
  const salt='1'.repeat(32),pass='legacy-test-password';
  const hash=pbkdf2Sync(pass,salt,100000,32,'sha256').toString('hex');
  source.prepare("INSERT INTO employees VALUES (?,?,?,?,?,?,?,?,?,?)").run(7,'Andrea','andrea@test.example','admin',hash,salt,124,7,1,null);
  source.prepare("INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?,?)").run(4,'Corso A','A1','Note','Attivo',40,7,'Docente','#64748b',0);
  source.prepare("INSERT INTO work_entries VALUES (?,?,?,?,?,?,?)").run(3,7,4,'2026-10-20',5,'maturata','Extra');
  source.prepare("INSERT INTO work_entries VALUES (?,?,?,?,?,?,?)").run(4,7,4,'2026-10-21',2,'utilizzata','Permesso');
  assert.equal(migrationCounts(source).work_entries,2);
  const db=getDb(),counts=importLegacy(source,db);
  assert.equal(counts.users,1);assert.equal(counts.courses,1);assert.equal(counts.entries,2);
  const u=db.prepare("SELECT * FROM users").get();
  assert.equal(u.initial_bank_hours,124);
  assert.equal(await verifyPassword(pass,u.password_hash),true);
  const c=db.prepare('SELECT * FROM courses').get();assert.equal(c.status,'active');
  assert.equal(db.prepare("SELECT SUM(CASE WHEN kind='credit' THEN hours ELSE -hours END) AS n FROM work_entries").get().n,3);
  assert.throws(()=>importLegacy(source,db),/non è vuoto/);
 }finally{source.close();rmSync(dir,{recursive:true,force:true});}
});
