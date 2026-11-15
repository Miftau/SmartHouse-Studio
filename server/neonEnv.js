const fs = require('fs');
const path = require('path');
const { defineConfig } = require('@neon/config/v1');
const { parseEnv } = require('@neon/env');

const repoRoot = path.resolve(__dirname, '..');
const envFiles = ['.env.local', '.env'];

for (const fileName of envFiles) {
  const fullPath = path.join(repoRoot, fileName);
  if (fs.existsSync(fullPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(fullPath);
  }
}

const neonConfig = defineConfig({ auth: true });

const optionalKeys = ['DATABASE_URL_UNPOOLED', 'NEON_AUTH_BASE_URL', 'NEON_AUTH_JWKS_URL'].filter(
  key => Boolean(process.env[key])
);
const keysToParse = ['DATABASE_URL', ...optionalKeys];

const parsed = parseEnv(neonConfig, keysToParse);

module.exports = {
  databaseUrl: parsed.postgres.databaseUrl,
  databaseUrlUnpooled: parsed.postgres.databaseUrlUnpooled || parsed.postgres.databaseUrl,
  authBaseUrl: parsed.auth?.baseUrl || '',
  authJwksUrl: parsed.auth?.jwksUrl || '',
  branch: process.env.NEON_BRANCH || 'production'
};
