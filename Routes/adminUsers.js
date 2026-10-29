import {HttpError} from '../src/app.js';
import {clearSessionCookie} from '../src/login.js';
import {positiveId,adminCount,listUsers,validateUserData,removeUser,resetWorkspace,verifyAdminPassword,makePasswordHash,randomPassword,logAdmin} from '../src/admin.js';

const bad=(error)=>new HttpError(/UNIQUE constraint/i.test(error.message)?409:400,/UNIQUE constraint/i.test(error.message)?'Email già utilizzata':error.message);
const userById=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
async function passwordGate(db,actor,provided){
 if(!await verifyAdminPassword(db,actor,provided))throw new HttpError(403,'Password amministratore non valida');
}
export default function register(router){
 router.add('GET','/api/admin/users',({db,send})=>send(200,{status:'ok',users:listUsers(db)}),'admin');
 router.add('POST','/api/admin/users',async ({db,user,body,send})=>{
  const data=await body();
  let values,hashed;
  try{values=validateUserData(data);hashed=await makePasswordHash(data.password);}
  catch(error){throw bad(error);}
  try{
   const result=db.prepare('INSERT INTO users(name,email,password_hash,role,is_active,initial_bank_hours,standard_day_hours) VALUES (?,?,?,?,?,?,?)')
    .run(values.name,values.email,hashed,values.role,values.is_active?1:0,values.initial_bank_hours,values.standard_day_hours);
   logAdmin(db,user.id,'create-user','user',Number(result.lastInsertRowid));
   send(201,{status:'ok',id:Number(result.lastInsertRowid)});
  }catch(error){throw bad(error);}
 },'admin');
 router.add('PUT','/api/admin/users/:id',async ({db,user,params,body,send})=>{
  let id,old,values;try{
    id=positiveId(params.id);old=userById(db,id);
    if(!old)throw new HttpError(404,'Utente inesistente');
    values=validateUserData(await body(),old);
  }catch(error){if(error.status)throw error;throw bad(error);}
  if(old.role==='admin'&&old.is_active&&(values.role!=='admin'||!values.is_active)&&adminCount(db)<=1)
    throw new HttpError(409,'Non è possibile disattivare o rimuovere l’ultimo admin.');
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('UPDATE users SET name=?,email=?,role=?,is_active=?,initial_bank_hours=?,standard_day_hours=? WHERE id=?')
    .run(values.name,values.email,values.role,values.is_active?1:0,values.initial_bank_hours,values.standard_day_hours,id);
   if(old.role!==values.role||Number(old.is_active)!==Number(values.is_active))
    db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
   logAdmin(db,user.id,'update-user','user',id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw bad(error);}
  send(200,{status:'ok'});
 },'admin');
 router.add('POST','/api/admin/users/:id/reset-password',async ({db,user,params,body,send})=>{
  const id=positiveId(params.id);
  if(!userById(db,id))throw new HttpError(404,'Utente inesistente');
  const data=await body();
  const password=typeof data.new_password==='string'&&data.new_password?data.new_password:randomPassword();
  let hash;try{hash=await makePasswordHash(password);}catch(error){throw bad(error);}
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,id);
   db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
   logAdmin(db,user.id,'reset-password','user',id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  send(200,{status:'ok',temporary_password:password});
 },'admin');
 router.add('POST','/api/admin/users/:id/revoke-sessions',({db,user,params,send})=>{
  const id=positiveId(params.id);
  if(!userById(db,id))throw new HttpError(404,'Utente inesistente');
  const result=db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
  logAdmin(db,user.id,'revoke-sessions','user',id);
  send(200,{status:'ok',revoked:result.changes});
 },'admin');
 router.add('DELETE','/api/admin/users/:id',async ({db,user,params,body,send,res,req})=>{
  const id=positiveId(params.id),target=userById(db,id);
  if(!target)throw new HttpError(404,'Utente inesistente');
  const data=await body();
  if(data.confirmation!=='ELIMINA ACCOUNT')throw new HttpError(400,'Scrivi ELIMINA ACCOUNT per confermare');
  await passwordGate(db,user.id,data.password);
  let result;try{result=removeUser(db,id);}catch(error){throw new HttpError(409,error.message);}
  if(id===user.id)res.setHeader('Set-Cookie',clearSessionCookie(req));
  else logAdmin(db,user.id,'delete-user','user',id);
  send(200,{status:'ok',...result,session_revoked:id===user.id});
 },'admin');
 router.add('DELETE','/api/account',async ({db,user,body,req,res,send})=>{
  const data=await body();
  if(data.confirmation!=='ELIMINA ACCOUNT')throw new HttpError(400,'Scrivi ELIMINA ACCOUNT');
  if(!await verifyAdminPassword(db,user.id,data.password))throw new HttpError(403,'Password errata');
  let result;try{result=removeUser(db,user.id);}catch(error){throw new HttpError(409,error.message);}
  res.setHeader('Set-Cookie',clearSessionCookie(req));
  send(200,{status:'ok',...result});
 });
 router.add('DELETE','/api/admin/workspace',async ({db,user,body,req,res,send})=>{
  const data=await body();
  if(data.confirmation!=='ELIMINA TUTTO')throw new HttpError(400,'Scrivi ELIMINA TUTTO per confermare');
  await passwordGate(db,user.id,data.password);
  let result;try{result=resetWorkspace(db);}catch(error){throw new HttpError(409,error.message);}
  res.setHeader('Set-Cookie',clearSessionCookie(req));
  send(200,{status:'ok',...result,restart_setup:true});
 },'admin');
}
