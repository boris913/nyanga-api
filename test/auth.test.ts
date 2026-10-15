import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import type { GoogleIdentity } from '../src/lib/google.js';
import type { Mail } from '../src/lib/mail.js';

type Row = Record<string, any>;

// Base en mémoire limitée aux appels des routes d'authentification.
function fakePrisma() {
  const users: Row[] = [];
  const tokens: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (v === null ? row[k] == null : row[k] === v));
  const apply = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
    return row;
  };
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) => users.find((u) => match(u, where)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: Row }) => users.find((u) => match(u, where))!,
      create: async ({ data }: { data: Row }) => {
        const u = { id: `u${++seq}`, role: 'USER', tokenVersion: 0, bannedAt: null, emailVerifiedAt: null, passwordHash: null, googleId: null, displayName: null, birthDate: null, ...data };
        users.push(u);
        return u;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => apply(users.find((u) => match(u, where))!, data),
    },
    passwordResetToken: {
      count: async ({ where }: { where: Row }) => tokens.filter((t) => t.userId === where.userId).length,
      create: async ({ data }: { data: Row }) => tokens.push({ id: `t${++seq}`, usedAt: null, createdAt: new Date(), ...data }),
      findUnique: async ({ where }: { where: Row }) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = tokens.filter((t) => match(t, where));
        rows.forEach((t) => apply(t, data));
        return { count: rows.length };
      },
    },
    $disconnect: async () => {},
  };
  return { prisma: prisma as unknown as PrismaClient, users };
}

async function setup(google: GoogleIdentity | null = null) {
  const { prisma, users } = fakePrisma();
  const mails: Mail[] = [];
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test',
    WEB_URL: 'http://localhost:3000',
    JWT_SECRET: 'j'.repeat(32),
    GOOGLE_CLIENT_ID: 'client-id',
    MAIL_DRIVER: 'console',
    ADMIN_EMAILS: 'admin@nyanga.cm',
  });
  const app = await buildApp(env, {
    prisma,
    mailer: { send: async (m) => void mails.push(m) },
    verifyGoogle: vi.fn(async () => google),
  });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/auth${url}`, payload });
  return { app, users, mails, post };
}

describe('auth par email', () => {
  it('inscription, doublon, connexion', async () => {
    const { app, post } = await setup();
    const reg = await post('/register', { email: 'Awa@Mail.cm', password: 'motdepasse1' });
    expect(reg.statusCode).toBe(200);
    expect(reg.cookies.find((c) => c.name === 'nyanga_session')?.httpOnly).toBe(true);
    expect((await post('/register', { email: 'awa@mail.cm', password: 'autre-mdp1' })).statusCode).toBe(409);
    expect((await post('/login', { email: 'awa@mail.cm', password: 'motdepasse1' })).statusCode).toBe(200);
    expect((await post('/login', { email: 'awa@mail.cm', password: 'mauvais-mdp' })).statusCode).toBe(401);
    expect((await post('/login', { email: 'inconnu@mail.cm', password: 'motdepasse1' })).statusCode).toBe(401);
    await app.close();
  });

  it('refuse un mot de passe trop court', async () => {
    const { app, post } = await setup();
    expect((await post('/register', { email: 'a@mail.cm', password: 'court' })).statusCode).toBe(400);
    await app.close();
  });

  it('un email non prouvé ne donne pas le rôle admin', async () => {
    const { app, post, users } = await setup();
    await post('/register', { email: 'admin@nyanga.cm', password: 'motdepasse1' });
    await post('/login', { email: 'admin@nyanga.cm', password: 'motdepasse1' });
    expect(users[0].role).toBe('USER');
    await app.close();
  });

  it('réinitialisation : lien à usage unique, sessions coupées, email prouvé', async () => {
    const { app, post, users, mails } = await setup();
    await post('/register', { email: 'admin@nyanga.cm', password: 'ancien-mdp1' });
    expect((await post('/password/forgot', { email: 'admin@nyanga.cm' })).json()).toEqual({ ok: true });
    expect((await post('/password/forgot', { email: 'personne@mail.cm' })).json()).toEqual({ ok: true });
    expect(mails).toHaveLength(1);
    const token = mails[0].text.match(/jeton=([\w-]+)/)![1];

    expect((await post('/password/reset', { token, password: 'nouveau-mdp1' })).statusCode).toBe(200);
    expect(users[0]).toMatchObject({ tokenVersion: 1, role: 'ADMIN' });
    expect(users[0].emailVerifiedAt).toBeInstanceOf(Date);
    expect((await post('/password/reset', { token, password: 'encore-mdp1' })).statusCode).toBe(400);
    expect((await post('/login', { email: 'admin@nyanga.cm', password: 'ancien-mdp1' })).statusCode).toBe(401);
    expect((await post('/login', { email: 'admin@nyanga.cm', password: 'nouveau-mdp1' })).statusCode).toBe(200);
    await app.close();
  });
});

describe('auth Google', () => {
  it('crée un compte avec un email prouvé', async () => {
    const { app, post, users } = await setup({ sub: 'g1', email: 'binta@gmail.com', name: 'Binta' });
    expect((await post('/google', { credential: 'jeton-google' })).json()).toEqual({ ok: true, profileComplete: false });
    expect(users[0]).toMatchObject({ email: 'binta@gmail.com', googleId: 'g1', displayName: 'Binta' });
    await app.close();
  });

  it('retire le mot de passe d’un compte non prouvé ouvert avec la même adresse', async () => {
    const { app, post, users } = await setup({ sub: 'g1', email: 'binta@gmail.com', name: 'Binta' });
    await post('/register', { email: 'binta@gmail.com', password: 'mdp-intrus1' });
    expect((await post('/google', { credential: 'jeton-google' })).statusCode).toBe(200);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ googleId: 'g1', passwordHash: null, tokenVersion: 1 });
    expect((await post('/login', { email: 'binta@gmail.com', password: 'mdp-intrus1' })).statusCode).toBe(401);
    await app.close();
  });

  it('refuse un jeton invalide', async () => {
    const { app, post } = await setup(null);
    expect((await post('/google', { credential: 'jeton-invalide' })).statusCode).toBe(401);
    await app.close();
  });
});

describe('MVP sans email', () => {
  it('désactive la demande de réinitialisation', async () => {
    const { prisma } = fakePrisma();
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test', WEB_URL: 'http://localhost:3000', JWT_SECRET: 'j'.repeat(32) });
    const app = await buildApp(env, { prisma });
    const res = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'a@mail.cm' } });
    expect(res.statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential: 'jeton-google' } })).statusCode).toBe(503);
    await app.close();
  });
});
