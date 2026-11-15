const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const neonEnv = require('./neonEnv');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  const connectionString = neonEnv.databaseUrlUnpooled || neonEnv.databaseUrl;
  const client = new Client({ connectionString });

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      return [];
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const { rows: appliedRows } = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map(r => r.version));
    const newlyApplied = [];

    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
          [file, new Date().toISOString()]
        );
        await client.query('COMMIT');
        newlyApplied.push(file);
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
