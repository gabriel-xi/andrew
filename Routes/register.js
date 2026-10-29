import { registerAccount } from '../src/register.js';
import { HttpError } from '../src/app.js';
import {getGlobalSettings} from '../src/settings.js';
export default function register(router) {
  router.add('GET','/api/auth/setup-status',({db,send}) => {
    const hasAdmin = Boolean(db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get());
    send(200,{status:'ok',needs_setup:!hasAdmin});
  },'public');
  router.add('POST','/api/auth/register',async ({db,body,send}) => {
    if(db.prepare("SELECT 1 FROM users WHERE role='admin' AND is_active=1 LIMIT 1").get() && !getGlobalSettings(db).registration_enabled) {
      throw new HttpError(403,'Registrazione disabilitata dall’amministratore.');
    }
    const data = await body();
    try {
      const user = await registerAccount(db,data,data.setup_key);
      send(201,{status:'ok',user});
    } catch (error) {
      if (/UNIQUE constraint/i.test(error.message)) throw new HttpError(409,'Email già registrata');
      throw new HttpError(error.status || 400,error.message);
    }
  },'public');
}
