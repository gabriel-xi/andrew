import {getStoragePaths} from './db.js';

export const DEFAULTS=Object.freeze({
  site_name:'Unisic',
  subtitle:'Workspace corsi e banca ore',
  default_theme:'system',
  registration_enabled:true,
  allow_tutor_uploads:true
});
export function getGlobalSettings(db) {
  const settings={...DEFAULTS};
  for(const row of db.prepare('SELECT setting_key,setting_value FROM app_settings').all()) {
    if(Object.hasOwn(DEFAULTS,row.setting_key)) {
      try {settings[row.setting_key]=JSON.parse(row.setting_value);} catch {}
    }
  }
  return settings;
}
export function updateGlobalSettings(db,changes) {
  if(!changes || typeof changes!=='object' || Array.isArray(changes))throw Error('Impostazioni non valide');
  const current=getGlobalSettings(db);
  const next={...current};
  for(const [key,value] of Object.entries(changes)){
    if(!Object.hasOwn(DEFAULTS,key))throw Error('Impostazione non riconosciuta: '+key);
    if(key==='site_name'){
      if(typeof value!=='string'||value.trim().length<2||value.trim().length>48)throw Error('Nome applicazione: 2–48 caratteri');
      next[key]=value.trim();
    }else if(key==='subtitle'){
      if(typeof value!=='string'||value.trim().length>120)throw Error('Sottotitolo troppo lungo');
      next[key]=value.trim();
    }else if(key==='default_theme'){
      if(!['system','light','dark'].includes(value))throw Error('Tema non valido');
      next[key]=value;
    }else if(typeof value==='boolean')next[key]=value;
    else throw Error('Questa impostazione richiede vero/falso: '+key);
  }
  const statement=db.prepare('INSERT INTO app_settings(setting_key,setting_value) VALUES (?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value');
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const [key,value] of Object.entries(changes))statement.run(key,JSON.stringify(next[key]));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return next;
}
export function getUserPreferences(db,userId) {
  const row=db.prepare('SELECT theme,compact_mode FROM user_preferences WHERE user_id=?').get(userId);
  return {theme:row?.theme??'system',compact_mode:Boolean(row?.compact_mode)};
}
export function updateUserPreferences(db,userId,data){
  const prev=getUserPreferences(db,userId);
  const theme=data.theme??prev.theme,compact=data.compact_mode??prev.compact_mode;
  if(!['system','light','dark'].includes(theme))throw Error('Tema non valido');
  if(typeof compact!=='boolean')throw Error('Modalità compatta non valida');
  db.prepare('INSERT INTO user_preferences(user_id,theme,compact_mode) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,compact_mode=excluded.compact_mode')
    .run(userId,theme,compact?1:0);
  return {theme,compact_mode:compact};
}
export function storageStatus(db){
 const paths=getStoragePaths();
 const count=table=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
 return {directory:paths.directory,database:paths.database,documents:paths.documents,legacy_database:paths.legacy_database,
  records:{users:count('users'),courses:count('courses'),events:count('calendar_events'),documents:count('documents'),entries:count('work_entries'),timecards:count('timecards')}};
}
