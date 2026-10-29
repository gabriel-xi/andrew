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
