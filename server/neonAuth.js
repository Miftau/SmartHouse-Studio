const { createRemoteJWKSet, jwtVerify } = require('jose');
const neonEnv = require('./neonEnv');

let cachedJwks = null;
let cachedIssuer = null;

function getJwksAndIssuer() {
  if (!neonEnv.authJwksUrl || !neonEnv.authBaseUrl) {
    return null;
  }
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(neonEnv.authJwksUrl));
    cachedIssuer = new URL(neonEnv.authBaseUrl).origin;
  }
  return { jwks: cachedJwks, issuer: cachedIssuer };
}

function isNeonAuthConfigured() {
  return Boolean(neonEnv.authBaseUrl && neonEnv.authJwksUrl);
}

async function verifyNeonAuthToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const ctx = getJwksAndIssuer();
  if (!ctx) return null;

  try {
    const { payload } = await jwtVerify(rawToken.trim(), ctx.jwks, {
      issuer: ctx.issuer
    });
    if (!payload?.sub) return null;
    return {
      userId: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : null,
      username:
        (typeof payload.email === 'string' && payload.email) ||
        (typeof payload.name === 'string' && payload.name) ||
        String(payload.sub)
    };
  } catch {
    return null;
  }
}

module.exports = {
  isNeonAuthConfigured,
  verifyNeonAuthToken
};
