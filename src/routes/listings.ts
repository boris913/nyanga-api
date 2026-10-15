import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Plan, Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { ageFromBirthDate, moderateText } from '../lib/moderation.js';
import { ALLOWED_IMAGE_TYPES } from '../lib/storage.js';
import { PLAN_LIMITS } from '../lib/plans.js';
import { effectivePlan } from '../chariow/apply-pulse.js';

const PAGE_SIZE = 24;
const intents = ['AMITIE', 'RELATION', 'MARIAGE', 'SORTIES'] as const;

const listingSchema = z.object({
  title: z.string().trim().min(10).max(80),
  body: z.string().trim().min(40).max(1500),
  intent: z.enum(intents),
  citySlug: z.string().min(2),
  neighborhood: z.string().trim().max(60).optional(),
});

const searchSchema = z.object({
  city: z.string().optional(),
  intent: z.enum(intents).optional(),
  gender: z.enum(['FEMME', 'HOMME']).optional(),
  minAge: z.coerce.number().int().min(18).max(99).optional(),
  maxAge: z.coerce.number().int().min(18).max(99).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

const listingInclude = {
  city: true,
  photos: { orderBy: { position: 'asc' } },
  user: { select: { id: true, displayName: true, birthDate: true, gender: true, verification: true } },
} satisfies Prisma.ListingInclude;
type ListingWithRelations = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;

async function plansFor(app: FastifyInstance, userIds: string[]): Promise<Map<string, Plan>> {
  const subs = await app.prisma.subscription.findMany({
    where: { userId: { in: userIds }, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { userId: true, plan: true },
  });
  const map = new Map<string, Plan>();
  for (const s of subs) if (s.userId && (s.plan === 'VIP' || !map.has(s.userId))) map.set(s.userId, s.plan);
  return map;
}

function present(app: FastifyInstance, l: ListingWithRelations, plan: Plan = 'STANDARD') {
  return {
    id: l.id,
    title: l.title,
    body: l.body,
    intent: l.intent,
    city: { slug: l.city.slug, name: l.city.name },
    neighborhood: l.neighborhood,
    status: l.status,
    featured: Boolean(l.featuredUntil && l.featuredUntil > new Date()),
    bumpedAt: l.bumpedAt,
    photos: l.photos.map((p) => ({ id: p.id, url: app.storage.publicUrl(p.key) })),
    author: {
      id: l.user.id,
      displayName: l.user.displayName,
      age: l.user.birthDate ? ageFromBirthDate(l.user.birthDate) : null,
      gender: l.user.gender,
      verified: l.user.verification === 'VERIFIED',
      plan,
    },
  };
}

export const listingRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app;

  app.get('/', async (req) => {
    const q = searchSchema.parse(req.query);
    const now = new Date();
    const userWhere: Prisma.UserWhereInput = { bannedAt: null };
    if (q.gender) userWhere.gender = q.gender;
    if (q.minAge || q.maxAge) {
      userWhere.birthDate = {};
      if (q.minAge) userWhere.birthDate.lte = new Date(Date.UTC(now.getUTCFullYear() - q.minAge, now.getUTCMonth(), now.getUTCDate()));
      if (q.maxAge) userWhere.birthDate.gt = new Date(Date.UTC(now.getUTCFullYear() - q.maxAge - 1, now.getUTCMonth(), now.getUTCDate()));
    }
    const where: Prisma.ListingWhereInput = {
      status: 'APPROVED',
      user: userWhere,
      ...(q.city ? { city: { slug: q.city } } : {}),
      ...(q.intent ? { intent: q.intent } : {}),
    };
    const [featured, items, total] = await Promise.all([
      q.page === 1
        ? prisma.listing.findMany({ where: { ...where, featuredUntil: { gt: now } }, include: listingInclude, orderBy: { featuredUntil: 'desc' }, take: 12 })
        : [],
      prisma.listing.findMany({ where, include: listingInclude, orderBy: { bumpedAt: 'desc' }, skip: (q.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.listing.count({ where }),
    ]);
    const plans = await plansFor(app, [...featured, ...items].map((l) => l.userId));
    return {
      featured: featured.map((l) => present(app, l, plans.get(l.userId))),
      items: items.map((l) => present(app, l, plans.get(l.userId))),
      total,
      page: q.page,
      pageSize: PAGE_SIZE,
    };
  });

  app.get('/mine', async (req) => {
    const user = await app.requireUser(req);
    const listing = await prisma.listing.findUnique({ where: { userId: user.id }, include: listingInclude });
    if (!listing) throw notFound('Vous n’avez pas encore d’annonce');
    return { ...present(app, listing), moderationNote: listing.moderationNote };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, include: listingInclude });
    if (!listing) throw notFound();
    if (listing.status !== 'APPROVED') {
      const viewer = await app.currentUser(req);
      if (!viewer || (viewer.id !== listing.userId && viewer.role === 'USER')) throw notFound();
    }
    const plans = await plansFor(app, [listing.userId]);
    return present(app, listing, plans.get(listing.userId));
  });

  // Création ou modification : toute écriture repasse en modération.
  app.put('/mine', async (req) => {
    const user = await app.requireUser(req);
    if (!user.displayName || !user.birthDate) throw badRequest('Complétez votre profil avant de publier');
    const body = listingSchema.parse(req.body);
    const check = moderateText(body.title, body.body, body.neighborhood);
    if (check.decision === 'reject') throw badRequest('Annonce refusée par nos règles', check.reasons);
    const city = await prisma.city.findUnique({ where: { slug: body.citySlug } });
    if (!city) throw badRequest('Ville inconnue');
    const data = {
      title: body.title,
      body: body.body,
      intent: body.intent,
      cityId: city.id,
      neighborhood: body.neighborhood || null,
      status: 'PENDING' as const,
      moderationNote: check.reasons.length ? `Filtre auto : ${check.reasons.join(' ; ')}` : null,
    };
    const listing = await prisma.listing.upsert({ where: { userId: user.id }, update: data, create: { ...data, userId: user.id } });
    return { id: listing.id, status: listing.status, warnings: check.reasons };
  });

  app.post('/mine/photos/upload', async (req) => {
    const user = await app.requireUser(req);
    const { contentType } = z.object({ contentType: z.enum(ALLOWED_IMAGE_TYPES as [string, ...string[]]) }).parse(req.body);
    const listing = await prisma.listing.findUnique({ where: { userId: user.id }, include: { _count: { select: { photos: true } } } });
    if (!listing) throw badRequest('Créez d’abord votre annonce');
    const { plan } = await effectivePlan(prisma, user.id);
    if (listing._count.photos >= PLAN_LIMITS[plan].photos) throw conflict(`Limite de ${PLAN_LIMITS[plan].photos} photos atteinte pour votre formule`);
    return app.storage.presignUpload('listings', user.id, contentType);
  });

  app.post('/mine/photos', async (req) => {
    const user = await app.requireUser(req);
    const { key } = z.object({ key: z.string() }).parse(req.body);
    if (!key.startsWith(`listings/${user.id}/`)) throw badRequest('Fichier invalide');
    const listing = await prisma.listing.findUnique({ where: { userId: user.id }, include: { _count: { select: { photos: true } } } });
    if (!listing) throw badRequest('Créez d’abord votre annonce');
    const { plan } = await effectivePlan(prisma, user.id);
    if (listing._count.photos >= PLAN_LIMITS[plan].photos) throw conflict('Limite de photos atteinte');
    // Une nouvelle photo renvoie l'annonce en modération.
    await prisma.$transaction(async (tx) => {
      await tx.photo.create({ data: { listingId: listing.id, key, position: listing._count.photos } });
      await tx.listing.update({ where: { id: listing.id }, data: { status: 'PENDING' } });
    });
    return { ok: true };
  });

  app.delete<{ Params: { photoId: string } }>('/mine/photos/:photoId', async (req) => {
    const user = await app.requireUser(req);
    const deleted = await prisma.photo.deleteMany({ where: { id: req.params.photoId, listing: { userId: user.id } } });
    if (!deleted.count) throw notFound();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/report', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const user = await app.requireUser(req);
    const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) throw notFound();
    await prisma.report.upsert({
      where: { reporterId_listingId: { reporterId: user.id, listingId: listing.id } },
      update: { reason, resolvedAt: null },
      create: { reporterId: user.id, listingId: listing.id, reason },
    });
    return { ok: true };
  });
};
