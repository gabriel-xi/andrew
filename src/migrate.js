/**
 * Non-destructive migration from the original Bottle/SQLite database.
 * Usage:
 *   node src/migrate.js --source /absolute/path/banca_ore.db --dry-run
 *   node src/migrate.js --source /absolute/path/banca_ore.db --apply
 *
 * Never writes to the source DB. Refuses to merge into a populated target.
 * Documents are copied only when --documents DIR explicitly points to the source files.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, realpathSync, copyFileSync, unlinkSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDb, isDate } from './db.js';

const sourceArg = process.argv.indexOf('--source');
const docsArg = process.argv.indexOf('--documents');
const documentsPath = docsArg >= 0 ? process.argv[docsArg + 1] : null;
const sourcePath = sourceArg >= 0 ? process.argv[sourceArg + 1] : null;
const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
const allowed = new Set(['--source','--documents','--apply','--dry-run']);
export function validTime(time) { return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time); }
export function mappingLabel(value) {
  return String(value || '').normalize('NFKC').trim();
}
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
export function migrationCounts(source) {
  const counts = {};
  for (const name of ['employees','courses','course_calendars','course_calendar_sessions','work_entries','employee_contracts','documents']) {
    counts[name] = tableExists(source,name) ? source.prepare('SELECT COUNT(*) AS n FROM '+name).get().n : 0;
  }
  return counts;
}
function iso(value) { return isDate(String(value || '')) ? value : null; }
function val(value, fallback='') { return value == null ? fallback : String(value); }
function integerMap(map, raw) { return raw != null && map.has(Number(raw)) ? map.get(Number(raw)) : null; }
function mapRole(role) { return role === 'admin' ? 'admin' : 'tutor'; }
function mapStatus(status) { return status === 'Concluso' ? 'completed' : status === 'Attivo' ? 'active' : 'planned'; }
function mapEventStatus(status) {
  return ({confermata:'confirmed',svolta:'completed',rinviata:'postponed',annullata:'cancelled'})[status] || 'confirmed';
}
function addAudit(db, entity, id, action) {
  db.prepare('INSERT INTO audit_events (actor_id,action,entity,entity_id) VALUES (NULL,?,?,?)').run(action,entity,id);
}
export function importLegacy(source, target, options={}) {
  for(const name of ['users','courses','calendar_events','work_entries','employee_contracts','documents','legacy_work_history']){
    if (target.prepare('SELECT COUNT(*) AS n FROM '+name).get().n) {
      throw Error('Il database di destinazione non è vuoto ('+name+'). Interrotto senza modifiche.');
    }
  }
  if(!tableExists(source,'employees') || !tableExists(source,'courses') || !tableExists(source,'work_entries')) {
    throw Error('Formato legacy non riconosciuto: tabelle mancanti.');
  }
  const users = new Map(), courses = new Map(), calendars = new Map();
  const createdFiles=[];
  const documentsRoot=options.documentsDir && existsSync(options.documentsDir) ? realpathSync(options.documentsDir) : null;
  const targetDocuments=resolve(process.env.ANDREW_DATA_DIR||'./data','documents');
  const counts = { users:0,courses:0,calendars:0,events:0,entries:0,ordinary_entries:0,historical_entries:0,contracts:0,skipped_events:0,skipped_entries:0,locked_users:0,document_metadata:0,documents_not_copied:0,unmapped:0,duplicate_emails:0 };
  const seenEmails=new Set();
  const unmapped = target.prepare('INSERT INTO legacy_unmapped_records (legacy_table,legacy_id,reason,record) VALUES (?,?,?,?)');
  target.exec('BEGIN IMMEDIATE');
  try {
    const insertUser = target.prepare(
      'INSERT INTO users (name,email,password_hash,role,initial_bank_hours,standard_day_hours,is_active,legacy_id) VALUES (?,?,?,?,?,?,?,?)');
    for(const row of source.prepare('SELECT * FROM employees ORDER BY id').all()) {
      // Never transfer old default weak 1234 PINs as authentication.
      const validHash = /^[a-f0-9]{64}$/i.test(row.password_hash || '') && /^[a-f0-9]{32}$/i.test(row.salt || '');
      const hash = validHash ? 'pbkdf2:'+row.salt+':'+row.password_hash : 'locked:legacy-password-reset-required';
      let email = String(row.email || '').includes('@') ? row.email.trim().toLowerCase() : 'legacy-user-'+row.id+'@invalid.local';
      if(seenEmails.has(email)) {
        unmapped.run('employees',Number(row.id),'Duplicate email: assigned placeholder address',JSON.stringify(row));
        email='legacy-user-'+row.id+'@invalid.local';
        counts.duplicate_emails++;counts.unmapped++;
      }
      seenEmails.add(email);
      const active = row.deleted_at || row.is_active === 0 ? 0 : 1;
      const result = insertUser.run(mappingLabel(row.name)||'Utente legacy '+row.id,email,hash,mapRole(row.role),
        Number(row.initial_bank_hours)||0,Number(row.standard_day_hours)||7,active,Number(row.id));
      users.set(Number(row.id),Number(result.lastInsertRowid));
      counts.users++;
      if (!validHash) counts.locked_users++;
    }
    const insertCourse = target.prepare(
      'INSERT INTO courses (title,code,description,status,total_hours,tutor_id,legacy_id,instructor,color,integrates_with_contract) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for(const row of source.prepare('SELECT * FROM courses ORDER BY id').all()) {
      const result=insertCourse.run(val(row.name,'Corso legacy '+row.id),val(row.code),val(row.notes),
        mapStatus(row.status),Math.max(0,Number(row.total_allocated_hours)||0),integerMap(users,row.employee_id),
        Number(row.id),val(row.docente_referente),val(row.color,'#3e74ed'),Number(row.integrates_with_contract)||0);
      courses.set(Number(row.id),Number(result.lastInsertRowid));counts.courses++;
    }
    if(tableExists(source,'course_calendars')) {
      const insert=target.prepare('INSERT INTO course_calendars (course_id,title,start_date,expected_end_date,stage_start_date,stage_end_date,stage_tutor_id,status,notes) VALUES (?,?,?,?,?,?,?,?,?)');
      for(const row of source.prepare('SELECT * FROM course_calendars ORDER BY id').all()) {
        const id=integerMap(courses,row.course_id);if(!id)continue;
        const newId=insert.run(id,val(row.title,'Calendario'),iso(row.start_date),iso(row.expected_end_date),iso(row.stage_start_date),iso(row.stage_end_date),integerMap(users,row.stage_tutor_id),val(row.status,'In Corso'),val(row.notes));
        calendars.set(Number(row.id),Number(newId.lastInsertRowid));counts.calendars++;
      }
    }
    if(tableExists(source,'course_calendar_sessions')) {
      const insert=target.prepare('INSERT INTO calendar_events (course_id,calendar_id,event_date,start_time,end_time,title,instructor,tutor_id,phase,status,notes,module,is_module_test,postponed_to,reschedule_reason,legacy_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const row of source.prepare('SELECT * FROM course_calendar_sessions ORDER BY id').all()) {
        const cid=integerMap(calendars,row.calendar_id);
        const parent=cid && target.prepare('SELECT course_id FROM course_calendars WHERE id=?').get(cid);
        if(!parent || !iso(row.date) || !validTime(row.start_time) || !validTime(row.end_time) || row.start_time >= row.end_time) {
          unmapped.run('course_calendar_sessions',Number(row.id),'Invalid calendar/date/time',JSON.stringify(row));
          counts.skipped_events++;counts.unmapped++;continue;
        }
        insert.run(parent.course_id,cid,row.date,row.start_time,row.end_time,
          val(row.modulo || row.docente,'Lezione'),val(row.docente),integerMap(users,row.tutor_id),
          row.phase === 'stage'?'stage':'aula',mapEventStatus(row.status),val(row.notes),
          val(row.modulo),Number(row.is_module_test)||0,iso(row.rescheduled_to_date),val(row.reschedule_reason),Number(row.id));
        counts.events++;
      }
    }
    const insertHistory=target.prepare(
      'INSERT INTO legacy_work_history (legacy_id,user_id,course_id,work_date,entry_type,hours,scheduled_hours,actual_hours,bank_kind,note,original_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const insertWork=target.prepare('INSERT INTO work_entries (user_id,course_id,work_date,hours,kind,note,legacy_id,scheduled_start,scheduled_end,actual_start,actual_end,scheduled_hours,actual_hours,activity_type,exit_date,source_payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const row of source.prepare('SELECT * FROM work_entries ORDER BY id').all()) {
      const uid=integerMap(users,row.employee_id),courseId=integerMap(courses,row.course_id);
      const date=iso(row.date),type=String(row.type||'').toLowerCase().trim();
      const kind=type==='maturata'?'credit':type==='utilizzata'?'debit':null;
      const rawHours=Number(row.hours),hours=Math.abs(rawHours);
      const note=val(row.note || row.causale);
      // Every original row is represented, including ordinary working days and invalid records.
      insertHistory.run(Number(row.id),uid,courseId,date,type,Number.isFinite(rawHours)?rawHours:0,
        Number(row.scheduled_hours)||0,Number(row.actual_hours)||0,kind,note,JSON.stringify(row));
      counts.historical_entries++;
      if(type==='ordinaria'||type==='ordinario'||type==='presenza_corso') {
        counts.ordinary_entries++;
        continue; // Do not corrupt the bank with ordinary attendance hours.
      }
      if(!uid || !date || !kind || !Number.isFinite(hours) || hours<=0) {
        unmapped.run('work_entries',Number(row.id),'Bank record missing user/date/type/hours',JSON.stringify(row));
        counts.skipped_entries++;counts.unmapped++;
        continue;
      }
      let remaining=hours;
      while(remaining>0) {
        const chunk=Math.min(24,remaining);
        insertWork.run(uid,courseId,date,chunk,kind,note,Number(row.id),
          val(row.scheduled_start),val(row.scheduled_end),val(row.actual_start),val(row.actual_end),
          Number(row.scheduled_hours)||0,Number(row.actual_hours)||0,val(row.activity_type),iso(row.exit_date),
          JSON.stringify(row));
        remaining=Math.max(0,Math.round((remaining-chunk)*1000000)/1000000);
        counts.entries++;
      }
    }
    if(tableExists(source,'employee_contracts')) {
      const insert=target.prepare('INSERT INTO employee_contracts (user_id,title,contract_type,contract_regime,start_date,end_date,status,work_days,work_start_time,work_end_time,lunch_break_start,lunch_break_end,daily_hours,weekly_hours,has_fixed_schedule,schedule_details,renewal_notes,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const row of source.prepare('SELECT * FROM employee_contracts ORDER BY id').all()){
        const uid=integerMap(users,row.employee_id);if(!uid)continue;
        insert.run(uid,val(row.title,'Contratto'),val(row.contract_type,'Altro'),val(row.contract_regime),iso(row.start_date),iso(row.end_date),
          val(row.status,'Attivo'),val(row.work_days),val(row.work_start_time),val(row.work_end_time),
          val(row.lunch_break_start),val(row.lunch_break_end),Number(row.daily_hours)||0,Number(row.weekly_hours)||0,
          row.has_fixed_schedule==null?1:Number(row.has_fixed_schedule),val(row.schedule_details,'{}'),val(row.renewal_notes),val(row.notes));
        counts.contracts++;
      }
    }
    if(tableExists(source,'documents')) {
      const insertDoc=target.prepare('INSERT INTO documents (owner_id,course_id,title,filename,storage_key,mime_type,size_bytes,category,notes) VALUES (?,?,?,?,?,?,?,?,?)');
      for(const row of source.prepare('SELECT * FROM documents ORDER BY id').all()) {
        let original=null;
        if(documentsRoot) {
          for(const candidate of [basename(val(row.stored_path)),basename(val(row.filename))]) {
            if(!candidate || candidate==='.' || candidate==='..')continue;
            try {
              const path=realpathSync(join(documentsRoot,candidate));
              if(path.startsWith(documentsRoot+sep)) {original=path;break;}
            }catch{}
          }
        }
        if(!original) {
          unmapped.run('documents',Number(row.id),'Physical file missing or --documents not supplied',JSON.stringify(row));
          counts.documents_not_copied++;counts.unmapped++;continue;
        }
        const key=randomUUID(),destination=join(targetDocuments,key);
        mkdirSync(targetDocuments,{recursive:true,mode:0o700});
        copyFileSync(original,destination,constants.COPYFILE_EXCL);
        createdFiles.push(destination);
        const size=Number(row.file_size)||0;
        insertDoc.run(integerMap(users,row.employee_id),integerMap(courses,row.course_id),
          val(row.title,row.filename),basename(val(row.filename)),key,
          val(row.file_type,'application/octet-stream'),size,val(row.category,'Generale'),val(row.notes));
        counts.document_metadata++;
      }
    }
    addAudit(target,'migration',null,'legacy-import-v1');
    target.exec('COMMIT');
    return counts;
  } catch(error) {
    target.exec('ROLLBACK');
    for(const file of createdFiles)try{unlinkSync(file);}catch{}
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!sourcePath || apply===dryRun || process.argv.some(x=>x.startsWith('--')&&!allowed.has(x))) {
    console.error('Uso: node src/migrate.js --source /path/banca_ore.db [--documents /path/documents] --dry-run|--apply'); process.exitCode=2;
  } else if (!existsSync(sourcePath)) {
    console.error('Database sorgente non trovato'); process.exitCode=2;
  } else {
    const original=new DatabaseSync(resolve(sourcePath),{readOnly:true});
    try {
      const counts=migrationCounts(original);
      console.log(JSON.stringify({source:resolve(sourcePath),counts,mode:apply?'apply':'dry-run'},null,2));
      if(apply) console.log(JSON.stringify({imported:importLegacy(original,getDb(),{documentsDir:documentsPath})},null,2));
    } catch(error) {console.error('Migrazione interrotta:',error.message);process.exitCode=1;}
    finally{original.close();}
  }
}
