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

    // Idempotent, additive schema upgrades for existing installations.
    const upgrades = {
      users: { initial_bank_hours: 'REAL NOT NULL DEFAULT 0', standard_day_hours: 'REAL NOT NULL DEFAULT 7', is_active: 'INTEGER NOT NULL DEFAULT 1', legacy_id: 'INTEGER' },
      courses: { legacy_id: 'INTEGER', instructor: "TEXT NOT NULL DEFAULT ''", color: "TEXT NOT NULL DEFAULT '#3e74ed'", integrates_with_contract: 'INTEGER NOT NULL DEFAULT 0' },
      calendar_events: { calendar_id: 'INTEGER REFERENCES course_calendars(id) ON DELETE SET NULL', module: "TEXT NOT NULL DEFAULT ''", is_module_test: 'INTEGER NOT NULL DEFAULT 0', postponed_to: 'TEXT', reschedule_reason: "TEXT NOT NULL DEFAULT ''", legacy_id: 'INTEGER' },
      work_entries: { legacy_id: 'INTEGER', scheduled_start: 'TEXT', scheduled_end: 'TEXT', actual_start: 'TEXT', actual_end: 'TEXT', scheduled_hours: 'REAL', actual_hours: 'REAL', activity_type: 'TEXT', exit_date: 'TEXT', source_payload: 'TEXT' }
    };
    for (const [table, columns] of Object.entries(upgrades)) {
      const existing = new Set(connection.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name));
      for (const [name, declaration] of Object.entries(columns)) {
        if (!existing.has(name)) connection.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' ' + declaration);
      }
    }

  }
  return connection;
}

export function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export function userById(db, id) {
  return db.prepare('SELECT id, name, email, role, initial_bank_hours, standard_day_hours FROM users WHERE id = ? AND is_active = 1').get(id);
}

export function courseById(db, id) {
  return db.prepare('SELECT c.*, u.name AS tutor_name FROM courses c LEFT JOIN users u ON c.tutor_id=u.id WHERE c.id = ?').get(id);
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
