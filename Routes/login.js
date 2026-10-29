import { verifyPassword,createSession,sessionCookie,clearSessionCookie,hashToken } from '../src/login.js';
import { readCookie } from './middleware/auth.js';
import { publicUser } from '../src/db.js';
import { HttpError } from '../src/app.js';

const attempts = new Map();
export default function register(router) {
  router.add('POST','/api/auth/login',async ({req,res,db,body,send}) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter(time => now-time < 60000);
    if (recent.length >= 5) throw new HttpError(429,'Troppi tentativi: riprova tra un minuto');
    recent.push(now); attempts.set(ip,recent);
    // Bound the in-memory map even if many different clients attempt login.
    if (attempts.size > 10000) attempts.clear();
    const data = await body();
    const identifier = String(data.email || '').trim().toLowerCase();
    const password = data.password;
    if (typeof password !== 'string' || identifier.length > 254) throw new HttpError(400,'Credenziali non valide');
    const user = db.prepare('SELECT * FROM users WHERE email=? AND is_active=1').get(identifier);
    // Always perform comparable expensive work, even for unknown accounts.
    const valid = user ? await verifyPassword(password,user.password_hash) : false;
    if (!valid) throw new HttpError(401,'Email o password errati');
    attempts.delete(ip);
    const token = createSession(db,user.id);
    res.setHeader('Set-Cookie', sessionCookie(token,req));
    send(200,{status:'ok',user:publicUser(user)});
  },'public');
  router.add('POST','/api/auth/logout',({req,res,db,send}) => {
    const token=readCookie(req,'andrew_session');
    if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hashToken(token));
    res.setHeader('Set-Cookie', clearSessionCookie(req));
    send(200,{status:'ok'});
  },'public');
}
