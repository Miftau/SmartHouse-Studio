const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const neonEnv = require('./neonEnv');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Embedded fallback keeps serverless deployments (e.g. Vercel NFT) self-contained if .sql files aren't traced
const FALLBACK_INITIAL_SCHEMA = `
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
`;

async function runMigrations() {
  const connectionString = neonEnv.databaseUrlUnpooled || neonEnv.databaseUrl;
  if (!connectionString) {
    const err = new Error(
      'Database connection is not configured. Set DATABASE_URL in your environment.'
    );
    err.statusCode = 503;
    err.expose = true;
    throw err;
  }

  const client = new Client({ connectionString });

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    let migrations = [];
    if (fs.existsSync(MIGRATIONS_DIR)) {
      const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
      migrations = files.map(file => ({
        version: file,
        sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      }));
    }

    if (migrations.length === 0) {
      migrations = [
        {
          version: '001_initial_schema.sql',
          sql: FALLBACK_INITIAL_SCHEMA
        }
      ];
    }

    const { rows: appliedRows } = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map(r => r.version));
    const newlyApplied = [];

    for (const migration of migrations) {
      if (appliedSet.has(migration.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
          [migration.version, new Date().toISOString()]
        );
        await client.query('COMMIT');
        newlyApplied.push(migration.version);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }

    return newlyApplied;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log(`[Neon Migrate] Schema migrations up to date on branch ${neonEnv.branch}.`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[Neon Migrate] Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations };
