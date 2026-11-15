CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  config_hash TEXT NOT NULL,
  config_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  strict_session_lock INTEGER NOT NULL DEFAULT 0,
  environment_id TEXT DEFAULT 'default-smart-house',
  environment_name TEXT DEFAULT 'Default Smart House'
);

CREATE TABLE IF NOT EXISTS annotations (
  id SERIAL PRIMARY KEY,
  client_uuid TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant TEXT NOT NULL,
  seq INTEGER NOT NULL,
  timestamp_started TEXT NOT NULL,
  timestamp_submitted TEXT NOT NULL,
  timestamp_received TEXT NOT NULL,
  location_id INTEGER NOT NULL,
  location TEXT NOT NULL,
  activity_id INTEGER NOT NULL,
  activity TEXT NOT NULL,
  interaction TEXT NOT NULL,
  other_person TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  config_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_annotations_session_participant ON annotations(session_id, participant);
CREATE INDEX IF NOT EXISTS idx_annotations_ts ON annotations(timestamp_submitted);

CREATE TABLE IF NOT EXISTS wearables (
  device_id TEXT PRIMARY KEY,
  session_id TEXT,
  participant TEXT,
  device_name TEXT,
  device_family TEXT,
  battery_level INTEGER DEFAULT 100,
  last_seen TEXT,
  status TEXT DEFAULT 'connected'
);

CREATE TABLE IF NOT EXISTS sensor_chunks (
  chunk_uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant TEXT NOT NULL,
  device_id TEXT,
  stream_type TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  ts_first_device BIGINT,
  ts_last_device BIGINT,
  ts_received TEXT NOT NULL,
  payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_chunks_session ON sensor_chunks(session_id, participant);

CREATE TABLE IF NOT EXISTS sync_points (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant TEXT NOT NULL,
  device_id TEXT,
  client_now BIGINT,
  server_now BIGINT,
  offset_ms DOUBLE PRECISION,
  rtt_ms DOUBLE PRECISION,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collaborator_locks (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  taken_person TEXT NOT NULL,
  taken_by TEXT NOT NULL,
  activity TEXT,
  locked_at TEXT NOT NULL,
  PRIMARY KEY (session_id, taken_person)
);

CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES admin_users(username) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participant_tokens (
  token TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, participant)
);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  config_hash TEXT NOT NULL,
  config_snapshot TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
