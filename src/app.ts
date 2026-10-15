import crypto from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient, type User } from '@prisma/client';
import { ZodError } from 'zod';
import type { Env } from './env.js';
import { HttpError, forbidden, unauthorized } from './lib/errors.js';
import { SESSION_COOKIE, verifySession } from './lib/session.js';
import { createMailer, type Mailer } from './lib/mail.js';
import { createGoogleVerifier, type GoogleVerifier } from './lib/google.js';
import { createStorage, type Storage } from './lib/storage.js';
import { buildCatalog, catalogByProductId, type CatalogItem } from './lib/plans.js';
import { createChariowClient, type ChariowClient } from './chariow/client.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { cityRoutes } from './routes/cities.js';
import { listingRoutes } from './routes/listings.js';
import { messageRoutes } from './routes/messages.js';
import { billingRoutes } from './routes/billing.js';
import { webhookRoutes } from './routes/webhooks.js';
import { adminRoutes } from './routes/admin.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    prisma: PrismaClient;
    mailer: Mailer;
    verifyGoogle: GoogleVerifier;
    storage: Storage;
    chariow: ChariowClient;
    catalog: CatalogItem[];
    byProductId: Record<string, CatalogItem>;
    currentUser(req: FastifyRequest): Promise<User | null>;
    requireUser(req: FastifyRequest): Promise<User>;
    requireStaff(req: FastifyRequest): Promise<User>;
  }
}

export type AppOverrides = Partial<{ prisma: PrismaClient; chariow: ChariowClient; mailer: Mailer; verifyGoogle: GoogleVerifier }>;

export async function buildApp(env: Env, overrides: AppOverrides = {}) {
  const app = Fastify({
    trustProxy: true,
    logger: env.NODE_ENV === 'test' ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
  });

  const prisma = overrides.prisma ?? new PrismaClient();
  const catalog = buildCatalog(env);
  app.decorate('env', env);
  app.decorate('prisma', prisma);
  app.decorate('mailer', overrides.mailer ?? createMailer(env.MAIL_DRIVER, app.log));
  app.decorate('verifyGoogle', overrides.verifyGoogle ?? createGoogleVerifier(env.GOOGLE_CLIENT_ID));
  app.decorate('storage', createStorage(env));
  app.decorate('chariow', overrides.chariow ?? createChariowClient(env.CHARIOW_API_KEY));
  app.decorate('catalog', catalog);
  app.decorate('byProductId', catalogByProductId(catalog));

  app.decorate('currentUser', async (req: FastifyRequest) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return null;
    const claims = await verifySession(env.JWT_SECRET, token);
    if (!claims) return null;
    const user = await prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.bannedAt || user.tokenVersion !== claims.v) return null;
    return user;
  });
  app.decorate('requireUser', async (req: FastifyRequest) => {
    const user = await app.currentUser(req);
    if (!user) throw unauthorized();
    return user;
  });
  app.decorate('requireStaff', async (req: FastifyRequest) => {
    const user = await app.requireUser(req);
    if (user.role === 'USER') throw forbidden();
    return user;
  });

  if (env.ORIGIN_SECRET) {
    const expected = Buffer.from(env.ORIGIN_SECRET);
    app.addHook('onRequest', async (req, reply) => {
      const got = Buffer.from(String(req.headers['x-origin-verify'] ?? ''));
      if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return reply.status(403).send({ error: 'forbidden' });
    });
  }

  await app.register(helmet);
  await app.register(cookie);
  await app.register(cors, { origin: [env.WEB_URL], credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation', message: 'Données invalides', details: err.flatten().fieldErrors });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'request', message: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Erreur interne' });
  });

  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.register(cityRoutes, { prefix: '/api/cities' });
  await app.register(listingRoutes, { prefix: '/api/listings' });
  await app.register(messageRoutes, { prefix: '/api/conversations' });
  await app.register(billingRoutes, { prefix: '/api/billing' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  app.addHook('onClose', async () => prisma.$disconnect());
  return app;
}
