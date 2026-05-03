-- AIMS English D1 Schema
-- Run in: Cloudflare Dashboard > D1 > aims-db > Console tab
-- Paste ALL of this and tap Execute

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  status TEXT NOT NULL DEFAULT 'pending',
  course_type TEXT DEFAULT '',
  enrollment_date TEXT,
  course_fee INTEGER DEFAULT 0,
  amount_paid INTEGER DEFAULT 0,
  total_mocks INTEGER DEFAULT 0,
  completed_mocks INTEGER DEFAULT 0,
  services TEXT DEFAULT '{}',
  last_payment_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  student_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  day TEXT NOT NULL,
  time TEXT NOT NULL,
  room TEXT,
  instructor TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_notifs       ON notifications(target, student_id);
CREATE INDEX IF NOT EXISTS idx_schedule     ON schedule(day);
