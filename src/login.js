import { randomBytes, scrypt as nodeScrypt, createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
export const SESSION_SECONDS = 60 * 60 * 24;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return 'scrypt:' + salt + ':' + key.toString('hex');
}
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [algorithm, salt, hex] = stored.split(':');
  if (algorithm === 'pbkdf2') {
    if (!/^[0-9a-f]{32}$/.test(salt || '') || !/^[0-9a-f]{64}$/.test(hex || '')) return false;
    const computed = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    return timingSafeEqual(Buffer.from(hex, 'hex'), computed);
  }
  if (algorithm !== 'scrypt' || !/^[\da-f]{32}$/.test(salt || '') || !/^[\da-f]{128}$/.test(hex || '')) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(Buffer.from(hex, 'hex'), actual);
}
export function hashToken(value) {
  return createHash('sha256').update(value).digest('hex');
}
export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  db.prepare('INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(hashToken(token), userId, expiry);
  return token;
}
export function sessionCookie(token, request) {
  const secure = request.socket.encrypted ? '; Secure' : '';
  return 'andrew_session=' + token + '; Path=/; Max-Age=' + SESSION_SECONDS +
    '; HttpOnly; SameSite=Strict' + secure;
}
export function clearSessionCookie(request) {
  return sessionCookie('', request).replace('Max-Age=' + SESSION_SECONDS, 'Max-Age=0');
}
