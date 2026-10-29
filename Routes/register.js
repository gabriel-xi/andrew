import { registerAccount } from '../src/register.js';
import { HttpError } from '../src/app.js';
export default function register(router) {
  router.add('GET','/api/auth/setup-status',({db,send}) => {
    const hasAdmin = Boolean(db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get());
    send(200,{status:'ok',needs_setup:!hasAdmin});
  },'public');
  router.add('POST','/api/auth/register',async ({db,body,send}) => {
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
