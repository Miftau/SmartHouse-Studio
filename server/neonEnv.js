const fs = require('fs');
const path = require('path');
const { parseEnv } = require('@neon/env');

const repoRoot = path.resolve(__dirname, '..');
const envFiles = ['.env.local', '.env'];

for (const fileName of envFiles) {
  const fullPath = path.join(repoRoot, fileName);
  if (fs.existsSync(fullPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(fullPath);
  }
}

const neonConfigModule = require('../neon.ts');
const neonConfig = neonConfigModule.default || neonConfigModule;

const parsed = parseEnv(neonConfig, [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'NEON_AUTH_BASE_URL',
  'NEON_AUTH_JWKS_URL'
]);

module.exports = {
  databaseUrl: parsed.postgres.databaseUrl,
  databaseUrlUnpooled: parsed.postgres.databaseUrlUnpooled,
  authBaseUrl: parsed.auth.baseUrl,
  authJwksUrl: parsed.auth.jwksUrl,
  branch: process.env.NEON_BRANCH || 'production'
};
