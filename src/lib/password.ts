import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// Paramètres équivalents OWASP (N=2^15, r=8, p=3) : ~32 Mo par calcul.
const N = 2 ** 15;
const R = 8;
const P = 3;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return crypto.timingSafeEqual(actual, expected);
}

// Hash factice : un email inconnu coûte le même temps qu'un mauvais mot de passe.
let dummyHash: Promise<string> | undefined;
export const dummyPasswordHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

export function newResetToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

export const hashResetToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
