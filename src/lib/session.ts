import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'nyanga_session';
export const SESSION_TTL_S = 60 * 60 * 24 * 30;

export type SessionClaims = { sub: string; v: number };

export async function signSession(secret: string, userId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({ v: tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifySession(secret: string, token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.v !== 'number') return null;
    return { sub: payload.sub, v: payload.v };
  } catch {
    return null;
  }
}
