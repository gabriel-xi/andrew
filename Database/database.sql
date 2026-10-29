PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'tutor' CHECK(role IN ('admin','tutor')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned','active','completed')),
  total_hours REAL NOT NULL DEFAULT 0 CHECK(total_hours >= 0),
  tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  title TEXT NOT NULL,
  instructor TEXT NOT NULL DEFAULT '',
  tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  phase TEXT NOT NULL DEFAULT 'aula' CHECK(phase IN ('aula','stage')),
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK(status IN ('confirmed','completed','postponed','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(event_date,start_time);
CREATE INDEX IF NOT EXISTS idx_events_course ON calendar_events(course_id);

CREATE TABLE IF NOT EXISTS work_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  work_date TEXT NOT NULL,
  hours REAL NOT NULL CHECK(hours > 0 AND hours <= 24),
  kind TEXT NOT NULL CHECK(kind IN ('credit','debit')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_work_user_date ON work_entries(user_id,work_date);

CREATE TABLE IF NOT EXISTS employee_contracts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 contract_type TEXT NOT NULL DEFAULT 'Altro',
 contract_regime TEXT NOT NULL DEFAULT '',
 start_date TEXT, end_date TEXT, status TEXT NOT NULL DEFAULT 'Attivo',
 work_days TEXT NOT NULL DEFAULT 'lun,mar,mer,gio,ven',
 work_start_time TEXT NOT NULL DEFAULT '09:00',
 work_end_time TEXT NOT NULL DEFAULT '13:00',
 lunch_break_start TEXT NOT NULL DEFAULT '', lunch_break_end TEXT NOT NULL DEFAULT '',
 daily_hours REAL NOT NULL DEFAULT 4, weekly_hours REAL NOT NULL DEFAULT 20,
 has_fixed_schedule INTEGER NOT NULL DEFAULT 1,
 schedule_details TEXT NOT NULL DEFAULT '{}',
 renewal_notes TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_contract_user ON employee_contracts(user_id);
CREATE TABLE IF NOT EXISTS documents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
 title TEXT NOT NULL, filename TEXT NOT NULL,
 storage_key TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
 size_bytes INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'Generale',
 notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner_id);
CREATE TABLE IF NOT EXISTS course_calendars (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 start_date TEXT, expected_end_date TEXT, stage_start_date TEXT, stage_end_date TEXT,
 stage_tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'In Corso', notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS audit_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_batches (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sha256 TEXT NOT NULL,
 records INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(user_id,sha256)
);
