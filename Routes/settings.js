import {HttpError} from '../src/app.js';
import {getGlobalSettings,getUserPreferences,updateGlobalSettings,updateUserPreferences,storageStatus} from '../src/settings.js';
function log(db,actor,action,entity='settings',id=null){
 db.prepare('INSERT INTO audit_events(actor_id,action,entity,entity_id) VALUES (?,?,?,?)').run(actor,action,entity,id);
}
export default function register(router){
 router.add('GET','/api/settings/public',({db,send})=>{
  const {site_name,subtitle,default_theme,registration_enabled}=getGlobalSettings(db);
  send(200,{status:'ok',site_name,subtitle,default_theme,registration_enabled});
 },'public');
 router.add('GET','/api/settings/me',({db,user,send})=>{
  send(200,{status:'ok',preferences:getUserPreferences(db,user.id),global:getGlobalSettings(db)});
 });
 router.add('PUT','/api/settings/me',async ({db,user,body,send})=>{
  let preferences;
  try{preferences=updateUserPreferences(db,user.id,await body());}
  catch(error){throw new HttpError(400,error.message);}
  send(200,{status:'ok',preferences});
 });
 router.add('GET','/api/settings/global',({db,send})=>send(200,{status:'ok',settings:getGlobalSettings(db)}),'admin');
 router.add('PUT','/api/settings/global',async ({db,user,body,send})=>{
  let settings;
  try{settings=updateGlobalSettings(db,await body());}
  catch(error){throw new HttpError(400,error.message);}
  log(db,user.id,'update-app-settings');
  send(200,{status:'ok',settings});
 },'admin');
 router.add('GET','/api/settings/storage',({db,send})=>{
  send(200,{status:'ok',storage:storageStatus(db)});
 },'admin');
 router.add('GET','/api/settings/audit',({db,send})=>{
  const actions=db.prepare('SELECT a.id,a.action,a.entity,a.entity_id,a.created_at,u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100').all();
  send(200,{status:'ok',actions});
 },'admin');
}
