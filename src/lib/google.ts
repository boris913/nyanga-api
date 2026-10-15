import { createRemoteJWKSet, jwtVerify } from 'jose';

export type GoogleIdentity = { sub: string; email: string; name: string | null };
export type GoogleVerifier = (credential: string) => Promise<GoogleIdentity | null>;

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

// Vérifie le jeton d'identité renvoyé par le bouton "Se connecter avec Google" (Google Identity Services).
export function createGoogleVerifier(clientId: string): GoogleVerifier {
  return async (credential) => {
    if (!clientId) return null;
    try {
      const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: clientId,
      });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email_verified !== true) return null;
      const name = typeof payload.given_name === 'string' ? payload.given_name : typeof payload.name === 'string' ? payload.name : null;
      return { sub: payload.sub, email: payload.email.toLowerCase(), name };
    } catch {
      return null;
    }
  };
}
