import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

let connection;
export function getDb() {
  if (!connection) {
    const directory = resolve(process.env.ANDREW_DATA_DIR || './data');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    connection = new DatabaseSync(join(directory, 'andrew.sqlite'));
    connection.exec('PRAGMA busy_timeout = 10000');
    connection.exec(readFileSync(new URL('../Database/database.sql', import.meta.url), 'utf8'));
  }
  return connection;
}

export function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export function userById(db, id) {
  return db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(id);
}

export function courseById(db, id) {
  return db.prepare('SELECT c.*, u.name AS tutor_name FROM courses c LEFT JOIN users u ON c.tutor_id=u.id WHERE c.id = ?').get(id);
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
