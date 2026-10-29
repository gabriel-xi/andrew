import { hashPassword } from './login.js';

export function validateRegistration(data) {
  const name = String(data?.name || '').trim();
  const email = String(data?.email || '').trim().toLowerCase();
  const password = data?.password;
  if (name.length < 2 || name.length > 120) throw new Error('Nome non valido');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Email non valida');
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    throw new Error('La password deve contenere almeno 12 caratteri');
  }
  return { name, email, password };
}
export async function registerAccount(db, data, setupKey) {
  const { name, email, password } = validateRegistration(data);
  const passwordHash = await hashPassword(password);
  // The first-admin check and INSERT must be atomic even with concurrent registration requests.
  db.exec('BEGIN IMMEDIATE');
  try {
    const firstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    const role = firstUser ? 'admin' : 'tutor';
    if (firstUser && (!process.env.ANDREW_SETUP_KEY ||
      process.env.ANDREW_SETUP_KEY.length < 20 ||
      typeof setupKey !== 'string' || setupKey !== process.env.ANDREW_SETUP_KEY)) {
      const error = new Error('Per il primo amministratore è richiesta ANDREW_SETUP_KEY (minimo 20 caratteri)');
      error.status = 403; throw error;
    }
    const result = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
      .run(name, email, passwordHash, role);
    db.exec('COMMIT');
    return { id:Number(result.lastInsertRowid), name, email, role };
  } catch(error) {
    db.exec('ROLLBACK'); throw error;
  }
}
