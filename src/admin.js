import {existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {getStoragePaths} from './db.js';
import {hashPassword,verifyPassword} from './login.js';

export const positiveId=value=>{
 const id=Number(value);
 if(!Number.isSafeInteger(id)||id<1)throw Error('Identificativo utente non valido');
 return id;
};
export function adminCount(db){
 return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND is_active=1").get().n;
}
export function logAdmin(db,actor,action,entity='user',id=null){
 db.prepare('INSERT INTO audit_events(actor_id,action,entity,entity_id) VALUES (?,?,?,?)').run(actor,action,entity,id);
}
export function listUsers(db){
 return db.prepare(`SELECT u.id,u.name,u.email,u.role,u.is_active,u.initial_bank_hours,u.standard_day_hours,u.created_at,
  (SELECT COUNT(*) FROM work_entries e WHERE e.user_id=u.id) AS bank_entries,
  (SELECT COUNT(*) FROM timecards t WHERE t.user_id=u.id) AS timecards,
  (SELECT COUNT(*) FROM documents d WHERE d.owner_id=u.id) AS documents,
  (SELECT COUNT(*) FROM employee_contracts c WHERE c.user_id=u.id) AS contracts
  FROM users u ORDER BY u.is_active DESC,u.role,u.name COLLATE NOCASE`).all();
}
export function validateUserData(data,current=null){
 const d=data||{};
 const name=d.name===undefined?current?.name:String(d.name||'').trim();
 const email=d.email===undefined?current?.email:String(d.email||'').trim().toLowerCase();
 const role=d.role===undefined?current?.role:d.role;
 const active=d.is_active===undefined?Boolean(current?.is_active??1):d.is_active;
 const bank=d.initial_bank_hours===undefined?Number(current?.initial_bank_hours??0):Number(d.initial_bank_hours);
 const day=d.standard_day_hours===undefined?Number(current?.standard_day_hours??7):Number(d.standard_day_hours);
 if(!name||name.length<2||name.length>120)throw Error('Nome: 2–120 caratteri');
 if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Email non valida');
 if(!['admin','tutor'].includes(role))throw Error('Ruolo non valido');
 if(typeof active!=='boolean')throw Error('Stato account non valido');
 if(!Number.isFinite(bank)||Math.abs(bank)>1000000)throw Error('Saldo iniziale non valido');
 if(!Number.isFinite(day)||day<=0||day>24)throw Error('Ore giornaliere non valide');
 return {name,email,role,is_active:active,initial_bank_hours:bank,standard_day_hours:day};
}
export function removeUser(db,id){
 const record=db.prepare('SELECT * FROM users WHERE id=?').get(id);
 if(!record)throw Error('Utente inesistente');
 if(record.role==='admin' && record.is_active && adminCount(db)<=1) {
  throw Error('Non puoi eliminare l’ultimo amministratore. Utilizza Ripristino completo, oppure nomina un altro admin.');
 }
 const keys=db.prepare('SELECT storage_key FROM documents WHERE owner_id=?').all(id).map(r=>r.storage_key);
 db.exec('BEGIN IMMEDIATE');
 try {
  // A linked course can remain; account-specific data must be deleted.
  db.prepare('DELETE FROM calendar_import_batches WHERE user_id=?').run(id);
  db.prepare('DELETE FROM legacy_work_history WHERE user_id=?').run(id);
  db.prepare('DELETE FROM documents WHERE owner_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  // FK cascades: auth_sessions, user_preferences, entries, timecards, contracts, imports.
  // FK SET NULL: course tutor, event tutor, calendar stage tutor and audit actor.
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 const directory=getStoragePaths().documents;
 const failures=[];
 for(const key of keys) {
  if(!/^[\da-f-]{36}$/i.test(key))continue;
  const path=join(directory,key);
  try{if(existsSync(path))unlinkSync(path);}catch{failures.push(key);}
 }
 return {documents:keys.length,failed_deletions:failures.length};
}
export function resetWorkspace(db){
 const keys=db.prepare('SELECT storage_key FROM documents').all().map(r=>r.storage_key);
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const table of [
    'auth_sessions','calendar_import_batches','import_batches','legacy_work_history','legacy_unmapped_records',
    'timecards','work_entries','documents','calendar_events','course_calendars','employee_contracts',
    'courses','audit_events','user_preferences','users','app_settings'
  ])db.exec('DELETE FROM '+table);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 let failures=0;
 for(const key of keys){
  if(!/^[\da-f-]{36}$/i.test(key))continue;
  const path=join(getStoragePaths().documents,key);
  try{if(existsSync(path))unlinkSync(path);}catch{failures++;}
 }
 return {removed_documents:keys.length,failed_file_deletions:failures};
}
export async function verifyAdminPassword(db,actor,password){
 if(typeof password!=='string')return false;
 const record=db.prepare('SELECT password_hash FROM users WHERE id=?').get(actor);
 return Boolean(record && await verifyPassword(password,record.password_hash));
}
export async function makePasswordHash(raw){
 if(typeof raw!=='string'||raw.length<12||raw.length>1024)throw Error('Password di almeno 12 caratteri obbligatoria');
 return hashPassword(raw);
}
export function randomPassword(){return randomBytes(24).toString('base64url');}
