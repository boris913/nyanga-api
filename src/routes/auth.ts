import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { HttpError, badRequest, conflict, unauthorized } from '../lib/errors.js';
import { dummyPasswordHash, hashPassword, hashResetToken, newResetToken, verifyPassword } from '../lib/password.js';
import { SESSION_COOKIE, SESSION_TTL_S, signSession } from '../lib/session.js';

const RESET_TTL_MS = 60 * 60 * 1000;

const email = z.string().trim().toLowerCase().email().max(120);
const password = z.string().min(8, 'Au moins 8 caractères').max(128);
const credentialsSchema = z.object({ email, password });

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { prisma, env } = app;

  // Rôle admin uniquement pour un email prouvé (Google ou lien de réinitialisation reçu).
  const adminRole = (mail: string, verified: boolean) => (verified && env.ADMIN_EMAILS.includes(mail) ? { role: 'ADMIN' as const } : {});

  async function openSession(reply: FastifyReply, user: User) {
    if (user.bannedAt) throw new HttpError(403, 'banned', 'Ce compte a été suspendu');
    const token = await signSession(env.JWT_SECRET, user.id, user.tokenVersion);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_S,
    });
    return { ok: true, profileComplete: Boolean(user.displayName && user.birthDate) };
  }

  app.post('/register', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict('Un compte existe déjà avec cet email');
    const user = await prisma.user.create({ data: { email: body.email, passwordHash: await hashPassword(body.password) } });
    return openSession(reply, user);
  });

  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user?.passwordHash || !ok) throw unauthorized('Email ou mot de passe incorrect');
    const promoted = adminRole(user.email, Boolean(user.emailVerifiedAt));
    return openSession(reply, 'role' in promoted ? await prisma.user.update({ where: { id: user.id }, data: promoted }) : user);
  });

  app.post('/google', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req, reply) => {
    if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'google_disabled', 'Connexion Google non configurée');
    const { credential } = z.object({ credential: z.string().min(10) }).parse(req.body);
    const identity = await app.verifyGoogle(credential);
    if (!identity) throw unauthorized('Connexion Google refusée');

    const now = new Date();
    let user = await prisma.user.findUnique({ where: { googleId: identity.sub } });
    if (!user) {
      const existing = await prisma.user.findUnique({ where: { email: identity.email } });
      if (existing) {
        // Compte créé par mot de passe sans email prouvé : quelqu'un a pu l'ouvrir avec l'adresse d'autrui.
        // On retire ce mot de passe et on coupe ses sessions avant de rattacher Google.
        const unproven = !existing.emailVerifiedAt;
        user = await prisma.user.update({
          where: { id: existing.id },
          data: {
            googleId: identity.sub,
            emailVerifiedAt: existing.emailVerifiedAt ?? now,
            ...(unproven ? { passwordHash: null, tokenVersion: { increment: 1 } } : {}),
            ...adminRole(identity.email, true),
          },
        });
      } else {
        user = await prisma.user.create({
          data: { email: identity.email, googleId: identity.sub, emailVerifiedAt: now, displayName: identity.name?.slice(0, 40), ...adminRole(identity.email, true) },
        });
      }
    } else if (env.ADMIN_EMAILS.includes(user.email) && user.role !== 'ADMIN') {
      user = await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    }
    return openSession(reply, user);
  });

  // Réponse identique que le compte existe ou non (pas d'énumération des emails).
  app.post('/password/forgot', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
    if (env.MAIL_DRIVER === 'none') throw new HttpError(503, 'mail_disabled', 'Réinitialisation du mot de passe indisponible pour le moment');
    const body = z.object({ email }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (user && !user.bannedAt) {
      const recent = await prisma.passwordResetToken.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_TTL_MS) } } });
      if (recent < 3) {
        const { token, tokenHash } = newResetToken();
        await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
        const link = `${env.WEB_URL}/mot-de-passe/nouveau?jeton=${token}`;
        await app.mailer.send({
          to: user.email,
          subject: 'Nyanga : choisir un nouveau mot de passe',
          text: `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n\nL'équipe Nyanga`,
        });
      }
    }
    return { ok: true };
  });

  app.post('/password/reset', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const body = z.object({ token: z.string().min(20), password }).parse(req.body);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(body.token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) throw badRequest('Lien expiré ou déjà utilisé, refaites une demande');
    const consumed = await prisma.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count !== 1) throw badRequest('Lien déjà utilisé');

    const current = await prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    // Le lien reçu prouve la possession de l'email ; toutes les autres sessions sont coupées.
    const user = await prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(body.password),
        emailVerifiedAt: current.emailVerifiedAt ?? new Date(),
        tokenVersion: { increment: 1 },
        ...adminRole(current.email, true),
      },
    });
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    return openSession(reply, user);
  });

  app.post('/logout', async (req, reply) => {
    const user = await app.currentUser(req);
    // Invalide toutes les sessions de l'utilisateur.
    if (user) await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
};
