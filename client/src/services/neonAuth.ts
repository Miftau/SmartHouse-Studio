import { createAuthClient } from '@neon/auth';
import { BetterAuthReactAdapter } from '@neon/auth/react/adapters';

const neonAuthUrl = (import.meta.env.VITE_NEON_AUTH_URL || '').trim();

export const authClient = neonAuthUrl
  ? createAuthClient(neonAuthUrl, {
      adapter: BetterAuthReactAdapter(),
    })
  : null;

export function isNeonAuthAvailable(): boolean {
  return Boolean(authClient);
}

type TokenResult = {
  data?: { token?: string } | null;
  error?: { message?: string } | null;
};

type NeonAuthClientWithToken = NonNullable<typeof authClient> & {
  token: () => Promise<TokenResult>;
};

export async function getNeonAuthJwt(): Promise<string | null> {
  if (!authClient) return null;
  const res = await (authClient as NeonAuthClientWithToken).token();
  if (res?.error) {
    throw new Error(res.error.message || 'Failed to obtain Neon Auth JWT');
  }
  return res?.data?.token || null;
}

export async function signInWithNeonAuth(email: string, password: string): Promise<string> {
  if (!authClient) {
    throw new Error('Neon Auth is not configured');
  }
  const res = await authClient.signIn.email({ email, password });
  if (res?.error) {
    throw new Error(res.error.message || 'Neon Auth sign in failed');
  }
  const token = await getNeonAuthJwt();
  if (!token) {
    throw new Error('Signed in with Neon Auth, but no access token was returned');
  }
  return token;
}

export async function signUpWithNeonAuth(
  email: string,
  password: string,
  name: string
): Promise<string> {
  if (!authClient) {
    throw new Error('Neon Auth is not configured');
  }
  const res = await authClient.signUp.email({ email, password, name });
  if (res?.error) {
    throw new Error(res.error.message || 'Neon Auth sign up failed');
  }
  const token = await getNeonAuthJwt();
  if (!token) {
    throw new Error('Account created. Complete verification if required, then sign in.');
  }
  return token;
}

export async function signOutNeonAuth(): Promise<void> {
  if (!authClient) return;
  try {
    await authClient.signOut();
  } catch {
    // Ignore errors when no Neon Auth browser session exists
  }
}
