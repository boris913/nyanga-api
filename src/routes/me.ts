import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { ageFromBirthDate, moderateText } from '../lib/moderation.js';
import { ALLOWED_IMAGE_TYPES } from '../lib/storage.js';
import { PLAN_LIMITS } from '../lib/plans.js';
import { effectivePlan } from '../chariow/apply-pulse.js';

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  birthDate: z.coerce.date(),
  gender: z.enum(['FEMME', 'HOMME']),
  seeking: z.enum(['FEMME', 'HOMME']),
  citySlug: z.string().min(2),
});

export const meRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app;

  app.get('/', async (req) => {
    const user = await app.requireUser(req);
    const [{ plan, expiresAt }, city, listing] = await Promise.all([
      effectivePlan(prisma, user.id),
      user.cityId ? prisma.city.findUnique({ where: { id: user.cityId } }) : null,
      prisma.listing.findUnique({ where: { userId: user.id }, select: { id: true, status: true, moderationNote: true, featuredUntil: true } }),
    ]);
    const limits = PLAN_LIMITS[plan];
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      hasPassword: Boolean(user.passwordHash),
      googleLinked: Boolean(user.googleId),
      displayName: user.displayName,
      birthDate: user.birthDate,
      gender: user.gender,
      seeking: user.seeking,
      city: city && { slug: city.slug, name: city.name },
      role: user.role,
      verification: user.verification,
      profileComplete: Boolean(user.displayName && user.birthDate),
      plan,
      planExpiresAt: expiresAt,
      limits: { ...limits, messagesPerDay: Number.isFinite(limits.messagesPerDay) ? limits.messagesPerDay : null },
      listing,
    };
  });

  app.put('/profile', async (req) => {
    const user = await app.requireUser(req);
    const body = profileSchema.parse(req.body);
    if (ageFromBirthDate(body.birthDate) < 18) throw badRequest('Nyanga est réservé aux personnes majeures (18 ans et plus)');
    if (moderateText(body.displayName).decision === 'reject') throw badRequest('Ce nom n’est pas autorisé');
    const city = await prisma.city.findUnique({ where: { slug: body.citySlug } });
    if (!city) throw badRequest('Ville inconnue');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: body.displayName,
        birthDate: body.birthDate,
        gender: body.gender,
        seeking: body.seeking,
        cityId: city.id,
      },
    });
    return { ok: true };
  });

  app.post('/verification/upload', async (req) => {
    const user = await app.requireUser(req);
    const { contentType } = z.object({ contentType: z.enum(ALLOWED_IMAGE_TYPES as [string, ...string[]]) }).parse(req.body);
    return app.storage.presignUpload('selfies', user.id, contentType);
  });

  app.post('/verification', async (req) => {
    const user = await app.requireUser(req);
    const { key } = z.object({ key: z.string() }).parse(req.body);
    if (!key.startsWith(`selfies/${user.id}/`)) throw badRequest('Fichier invalide');
    await prisma.user.update({ where: { id: user.id }, data: { selfieKey: key, verification: 'PENDING' } });
    return { ok: true };
  });

  // Changement de mot de passe ; un compte Google sans mot de passe peut en définir un.
  app.put('/password', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
    const user = await app.requireUser(req);
    const body = z.object({ currentPassword: z.string().max(128).optional(), newPassword: z.string().min(8, 'Au moins 8 caractères').max(128) }).parse(req.body);
    if (user.passwordHash && !(body.currentPassword && (await verifyPassword(body.currentPassword, user.passwordHash)))) {
      throw badRequest('Mot de passe actuel incorrect');
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
    return { ok: true };
  });
};
