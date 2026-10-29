import { hashToken } from '../../src/login.js';
import { userById } from '../../src/db.js';

export function readCookie(request, name) {
  for (const section of String(request.headers.cookie || '').split(';')) {
    const [key, ...value] = section.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}
export function currentUser(request, db) {
  const token = readCookie(request, 'andrew_session');
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = db.prepare('SELECT user_id FROM auth_sessions WHERE token_hash=? AND expires_at>?')
    .get(hashToken(token), Math.floor(Date.now() / 1000));
  return row ? userById(db, row.user_id) : null;
}
