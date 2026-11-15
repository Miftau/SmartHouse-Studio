const fs = require('fs');
const path = require('path');

const searchDirs = [path.resolve(__dirname, '..'), __dirname];
const envFiles = ['.env.local', '.env'];

for (const dir of searchDirs) {
  for (const fileName of envFiles) {
    const fullPath = path.join(dir, fileName);
    if (fs.existsSync(fullPath) && typeof process.loadEnvFile === 'function') {
      try {
        process.loadEnvFile(fullPath);
      } catch {
        // Ignore malformed or unreadable local env files in serverless runtimes
      }
    }
  }
}

// Normalize common Vercel/Postgres integration aliases before parsing
if (!process.env.DATABASE_URL) {
  const alias = process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  if (alias) process.env.DATABASE_URL = alias;
}
if (!process.env.DATABASE_URL_UNPOOLED && process.env.POSTGRES_URL_NON_POOLING) {
  process.env.DATABASE_URL_UNPOOLED = process.env.POSTGRES_URL_NON_POOLING;
}

let parsed = null;
try {
  const { defineConfig } = require('@neon/config/v1');
  const { parseEnv } = require('@neon/env');

  if (process.env.DATABASE_URL) {
    const neonConfig = defineConfig({ auth: true });
    const optionalKeys = ['DATABASE_URL_UNPOOLED', 'NEON_AUTH_BASE_URL', 'NEON_AUTH_JWKS_URL'].filter(
      key => Boolean(process.env[key])
    );
    parsed = parseEnv(neonConfig, ['DATABASE_URL', ...optionalKeys]);
  }
} catch {
  // Fall back to raw process.env if ESM require is unsupported or env validation fails at cold start
  parsed = null;
}

const databaseUrl = parsed?.postgres?.databaseUrl || process.env.DATABASE_URL || '';
const databaseUrlUnpooled =
  parsed?.postgres?.databaseUrlUnpooled || process.env.DATABASE_URL_UNPOOLED || databaseUrl || '';

module.exports = {
  databaseUrl,
  databaseUrlUnpooled,
  authBaseUrl: parsed?.auth?.baseUrl || process.env.NEON_AUTH_BASE_URL || '',
  authJwksUrl: parsed?.auth?.jwksUrl || process.env.NEON_AUTH_JWKS_URL || '',
  branch: process.env.NEON_BRANCH || 'production'
};
