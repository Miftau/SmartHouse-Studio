const { Pool } = require('pg');
const neonEnv = require('./neonEnv');
const { runMigrations } = require('./migrate');
const { hashPassword, generateToken } = require('./security');

let poolInstance = null;

function createMissingDbConfigError() {
  const err = new Error(
    'Database connection is not configured. Set DATABASE_URL in your environment.'
  );
  err.statusCode = 503;
  err.expose = true;
  return err;
}

function getPool() {
  if (!neonEnv.databaseUrl) {
    throw createMissingDbConfigError();
  }
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: neonEnv.databaseUrl,
      allowExitOnIdle: true
    });
  }
  return poolInstance;
}

const pool = {
  query: (...args) => getPool().query(...args),
  connect: (...args) => getPool().connect(...args),
  end: (...args) => {
    if (!poolInstance) return Promise.resolve();
    const current = poolInstance;
    poolInstance = null;
    return current.end(...args);
  }
};

let initPromise = null;

async function ensureInitialized() {
  if (!neonEnv.databaseUrl) {
    throw createMissingDbConfigError();
  }
  if (!initPromise) {
    initPromise = (async () => {
      await runMigrations();

      const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM admin_users');
      const count = rows[0]?.cnt ?? 0;
      if (count === 0) {
        const defaultUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
        const defaultPassword = process.env.ADMIN_PASSWORD || 'SmartHouse@2026';
        const { hash, salt } = hashPassword(defaultPassword);
        await pool.query(
          `INSERT INTO admin_users (username, password_hash, salt, must_change_password, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (username) DO NOTHING`,
          [
            defaultUsername,
            hash,
            salt,
            process.env.ADMIN_PASSWORD ? 0 : 1,
            new Date().toISOString()
          ]
        );
        console.log(
          `[Auth] Seeded initial admin user "${defaultUsername}".${process.env.ADMIN_PASSWORD ? '' : ' Change default password after first login.'}`
        );
      }
    })().catch(err => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

function mapEnvironmentRow(row) {
  if (!row) return null;
  let snapshot = null;
  try {
    snapshot = JSON.parse(row.config_snapshot);
  } catch {
    snapshot = null;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config_hash: row.config_hash,
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
    snapshot
  };
}

module.exports = {
  pool,
  init: ensureInitialized,

  async ensureDefaultEnvironment(configHash, configSnapshot) {
    await ensureInitialized();
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO environments (id, name, description, config_hash, config_snapshot, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         config_hash = EXCLUDED.config_hash,
         config_snapshot = EXCLUDED.config_snapshot,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        'default-smart-house',
        'Default Smart House',
        'Built-in PRD Smart House configuration (3 residents, 11 rooms)',
        configHash,
        JSON.stringify(configSnapshot),
        now,
        now
      ]
    );
    return rows[0] || null;
  },

  async listEnvironments() {
    await ensureInitialized();
    const { rows } = await pool.query(
      `SELECT id, name, description, config_hash, config_snapshot, is_default, created_at, updated_at
       FROM environments
       ORDER BY is_default DESC, created_at DESC`
    );
    return rows.map(mapEnvironmentRow);
  },

  async getEnvironment(id) {
    await ensureInitialized();
    const { rows } = await pool.query('SELECT * FROM environments WHERE id = $1', [id]);
    return mapEnvironmentRow(rows[0]);
  },

  async createEnvironment({ id, name, description = '', configHash, configSnapshot }) {
    await ensureInitialized();
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO environments (id, name, description, config_hash, config_snapshot, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
       RETURNING *`,
      [id, name, description, configHash, JSON.stringify(configSnapshot), now, now]
    );
    return mapEnvironmentRow(rows[0]);
  },

  async deleteEnvironment(id) {
    await ensureInitialized();
    const res = await pool.query('DELETE FROM environments WHERE id = $1 AND is_default = 0', [id]);
    return { deleted: (res.rowCount || 0) > 0, id };
  },

  async getSession(id) {
    await ensureInitialized();
    const { rows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async listSessions() {
    await ensureInitialized();
    const { rows } = await pool.query(
      `SELECT id, config_hash, status, timezone, started_at, ended_at, strict_session_lock, environment_id, environment_name
       FROM sessions
       ORDER BY started_at DESC`
    );
    return rows;
  },

  async getSessionSummaries() {
    await ensureInitialized();
    const { rows } = await pool.query(
      `SELECT
         s.id,
         s.status,
         s.timezone,
         s.started_at,
         s.ended_at,
         s.config_hash,
         COALESCE(s.environment_id, 'default-smart-house') AS environment_id,
         COALESCE(s.environment_name, 'Default Smart House') AS environment_name,
         (SELECT COUNT(*)::int FROM annotations a WHERE a.session_id = s.id) AS annotation_count,
         (SELECT COUNT(*)::int FROM sensor_chunks c WHERE c.session_id = s.id) AS chunk_count,
         (SELECT STRING_AGG(DISTINCT a.participant, ',') FROM annotations a WHERE a.session_id = s.id) AS active_participants
       FROM sessions s
       ORDER BY s.started_at DESC`
    );
    return rows;
  },

  async createSession(
    id,
    configHash,
    configSnapshot,
    timezone = 'Europe/Paris',
    environmentId = 'default-smart-house',
    environmentName = 'Default Smart House'
  ) {
    await ensureInitialized();
    const startedAt = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO sessions (id, config_hash, config_snapshot, status, timezone, started_at, environment_id, environment_name)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
       RETURNING *`,
      [id, configHash, JSON.stringify(configSnapshot), timezone, startedAt, environmentId, environmentName]
    );
    return rows[0] || null;
  },

  async startSession(id) {
    await ensureInitialized();
    const { rows } = await pool.query(
      `UPDATE sessions
       SET status = 'active', ended_at = NULL
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return rows[0] || null;
  },

  async stopSession(id) {
    await ensureInitialized();
    const endedAt = new Date().toISOString();
    const { rows } = await pool.query(
      `UPDATE sessions
       SET status = 'stopped', ended_at = $1
       WHERE id = $2
       RETURNING *`,
      [endedAt, id]
    );
    return rows[0] || null;
  },

  async endSession(id) {
    return this.stopSession(id);
  },

  async deleteSession(id) {
    await ensureInitialized();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM participant_tokens WHERE session_id = $1', [id]);
      await client.query('DELETE FROM collaborator_locks WHERE session_id = $1', [id]);
      await client.query('DELETE FROM annotations WHERE session_id = $1', [id]);
      await client.query('DELETE FROM sensor_chunks WHERE session_id = $1', [id]);
      await client.query('DELETE FROM wearables WHERE session_id = $1', [id]);
      await client.query('DELETE FROM sync_points WHERE session_id = $1', [id]);
      await client.query('DELETE FROM sessions WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { success: true, id };
  },

  async setSessionLockPolicy(sessionId, strict) {
    await ensureInitialized();
    const { rows } = await pool.query(
      `UPDATE sessions
       SET strict_session_lock = $1
       WHERE id = $2
       RETURNING strict_session_lock`,
      [strict ? 1 : 0, sessionId]
    );
    return rows[0] ? Boolean(rows[0].strict_session_lock) : false;
  },

  async getAdminUser(username) {
    await ensureInitialized();
    const { rows } = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    return rows[0] || null;
  },

  async updateAdminPassword(username, hash, salt) {
    await ensureInitialized();
    const { rows } = await pool.query(
      `UPDATE admin_users
       SET password_hash = $1, salt = $2, must_change_password = 0, updated_at = $3
       WHERE username = $4
       RETURNING *`,
      [hash, salt, new Date().toISOString(), username]
    );
    return rows[0] || null;
  },

  async createAdminSession(tokenHash, username, ttlMs) {
    await ensureInitialized();
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    await pool.query('DELETE FROM admin_sessions WHERE expires_at <= $1', [createdAt]);
    await pool.query(
      `INSERT INTO admin_sessions (token_hash, username, expires_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, username, expiresAt, createdAt]
    );
    return { tokenHash, username, expiresAt };
  },

  async getAdminSession(tokenHash) {
    await ensureInitialized();
    if (!tokenHash) return null;
    const { rows } = await pool.query('SELECT * FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
    const row = rows[0];
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
      return null;
    }
    return row;
  },

  async deleteAdminSession(tokenHash) {
    await ensureInitialized();
    if (tokenHash) {
      await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
    }
  },

  async ensureParticipantTokens(sessionId, roles) {
    await ensureInitialized();
    const { rows: existing } = await pool.query(
      'SELECT * FROM participant_tokens WHERE session_id = $1',
      [sessionId]
    );
    const byRole = {};
    for (const row of existing) {
      byRole[row.participant] = row.token;
    }
    const now = new Date().toISOString();
    for (const role of roles) {
      if (!byRole[role]) {
        const tok = generateToken(24);
        await pool.query(
          `INSERT INTO participant_tokens (token, session_id, participant, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (session_id, participant) DO NOTHING`,
          [tok, sessionId, role, now]
        );
        byRole[role] = tok;
      }
    }
    const { rows: finalRows } = await pool.query(
      'SELECT * FROM participant_tokens WHERE session_id = $1',
      [sessionId]
    );
    const result = {};
    for (const row of finalRows) {
      result[row.participant] = row.token;
    }
    return result;
  },

  async getParticipantToken(token) {
    await ensureInitialized();
    if (!token || typeof token !== 'string') return null;
    const { rows } = await pool.query(
      'SELECT * FROM participant_tokens WHERE token = $1',
      [token.trim()]
    );
    return rows[0] || null;
  },

  async getSessionLocks(_sessionId) {
    await ensureInitialized();
    return [];
  },

  async releaseLock(sessionId, takenPerson) {
    await ensureInitialized();
    await pool.query(
      'DELETE FROM collaborator_locks WHERE session_id = $1 AND taken_person = $2',
      [sessionId, takenPerson]
    );
    return [];
  },

  async releaseAllLocks(sessionId) {
    await ensureInitialized();
    await pool.query('DELETE FROM collaborator_locks WHERE session_id = $1', [sessionId]);
    return [];
  },

  async saveAnnotation(data) {
    await ensureInitialized();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: sessionRows } = await client.query(
        'SELECT * FROM sessions WHERE id = $1 FOR UPDATE',
        [data.session_id]
      );
      const session = sessionRows[0];
      if (!session) {
        const err = new Error(`Session "${data.session_id}" does not exist.`);
        err.statusCode = 404;
        throw err;
      }
      if (session.status !== 'active') {
        const err = new Error(
          `Session "${data.session_id}" is currently ${session.status.toUpperCase()}. Annotations cannot be submitted while the session is stopped.`
        );
        err.statusCode = 409;
        throw err;
      }

      const { rows: existingRows } = await client.query(
        'SELECT * FROM annotations WHERE client_uuid = $1',
        [data.client_uuid]
      );
      if (existingRows[0]) {
        await client.query('COMMIT');
        return { row: existingRows[0], isDuplicate: true };
      }

      const otherPerson = data.other_person ? String(data.other_person).trim() : '';
      if (otherPerson && otherPerson === data.participant) {
        const err = new Error('Participant cannot select themselves as a collaborator.');
        err.statusCode = 400;
        throw err;
      }

      const { rows: seqRows } = await client.query(
        `SELECT (COALESCE(MAX(seq), 0) + 1)::int AS next_seq
         FROM annotations
         WHERE session_id = $1 AND participant = $2`,
        [data.session_id, data.participant]
      );
      const nextSeq = seqRows[0].next_seq;
      const tsReceived = new Date().toISOString();

      const { rows: savedRows } = await client.query(
        `INSERT INTO annotations (
           client_uuid, session_id, participant, seq,
           timestamp_started, timestamp_submitted, timestamp_received,
           location_id, location, activity_id, activity,
           interaction, other_person, edited, config_version
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7,
           $8, $9, $10, $11,
           $12, $13, $14, $15
         )
         RETURNING *`,
        [
          data.client_uuid,
          data.session_id,
          data.participant,
          nextSeq,
          data.timestamp_started,
          data.timestamp_submitted,
          tsReceived,
          data.location_id,
          data.location,
          data.activity_id,
          data.activity,
          data.interaction,
          otherPerson,
          data.edited ? 1 : 0,
          data.config_version
        ]
      );

      await client.query('COMMIT');
      return { row: savedRows[0], isDuplicate: false };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async getAnnotations(sessionId, participant = null) {
    await ensureInitialized();
    if (participant) {
      const { rows } = await pool.query(
        `SELECT * FROM annotations
         WHERE session_id = $1 AND participant = $2
         ORDER BY timestamp_submitted ASC`,
        [sessionId, participant]
      );
      return rows;
    }
    const { rows } = await pool.query(
      `SELECT * FROM annotations
       WHERE session_id = $1
       ORDER BY timestamp_submitted ASC, participant ASC`,
      [sessionId]
    );
    return rows;
  },

  async saveSensorChunk(chunk) {
    await ensureInitialized();
    await pool.query(
      `INSERT INTO sensor_chunks (
         chunk_uuid, session_id, participant, device_id,
         stream_type, sample_count, ts_first_device, ts_last_device,
         ts_received, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (chunk_uuid) DO NOTHING`,
      [
        chunk.chunk_uuid,
        chunk.session_id,
        chunk.participant,
        chunk.device_id || null,
        chunk.stream_type,
        chunk.sample_count,
        chunk.ts_first_device || null,
        chunk.ts_last_device || null,
        chunk.ts_received || new Date().toISOString(),
        typeof chunk.payload === 'string' ? chunk.payload : JSON.stringify(chunk.payload)
      ]
    );
  },

  async updateWearableStatus(device) {
    await ensureInitialized();
    await pool.query(
      `INSERT INTO wearables (device_id, session_id, participant, device_name, device_family, battery_level, last_seen, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (device_id) DO UPDATE SET
         session_id = EXCLUDED.session_id,
         participant = EXCLUDED.participant,
         device_name = EXCLUDED.device_name,
         battery_level = EXCLUDED.battery_level,
         last_seen = EXCLUDED.last_seen,
         status = EXCLUDED.status`,
      [
        device.device_id,
        device.session_id || null,
        device.participant || null,
        device.device_name || 'Smartwatch',
        device.device_family || 'polar',
        device.battery_level ?? 100,
        new Date().toISOString(),
        device.status || 'connected'
      ]
    );
  },

  async listWearables() {
    await ensureInitialized();
    const { rows } = await pool.query('SELECT * FROM wearables ORDER BY last_seen DESC');
    return rows;
  }
};
