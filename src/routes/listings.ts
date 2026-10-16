import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Plan, Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { ageFromBirthDate, moderateText } from '../lib/moderation.js';
import { ALLOWED_IMAGE_TYPES } from '../lib/storage.js';
import { PLAN_LIMITS } from '../lib/plans.js';
import { maskWhatsapp, normalizeWhatsapp, whatsappLink } from '../lib/phone.js';
import { effectivePlan } from '../chariow/apply-pulse.js';

const PAGE_SIZE = 24;
const intents = ['AMITIE', 'RELATION', 'MARIAGE', 'SORTIES'] as const;

const listingSchema = z.object({
  title: z.string().trim().min(10).max(80),
  body: z.string().trim().min(40).max(1500),
  intent: z.enum(intents),
  citySlug: z.string().min(2),
  neighborhood: z.string().trim().max(60).optional(),
  whatsapp: z.string().trim().min(9).max(20),
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
    pinned: Boolean(l.pinnedUntil && l.pinnedUntil > new Date()),
    bumpedAt: l.bumpedAt,
    photos: l.photos.map((p) => ({
      id: p.id,
      url: app.storage.publicUrl(p.key),
      thumbUrl: app.storage.publicUrl(p.thumbKey ?? p.key),
    })),
    whatsappMasked: l.whatsapp ? maskWhatsapp(l.whatsapp) : null,
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

  async function statusAfterEdit(userId: string): Promise<'APPROVED' | 'PENDING'> {
    const { plan } = await effectivePlan(prisma, userId);
    return plan === 'STANDARD' ? 'PENDING' : 'APPROVED';
  }

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
      photos: { some: {} },
      user: userWhere,
      ...(q.city ? { city: { slug: q.city } } : {}),
      ...(q.intent ? { intent: q.intent } : {}),
    };
    // Remontées payantes en cours : en tête de la première page, hors pagination des autres annonces.
    const pinnedWhere: Prisma.ListingWhereInput = { AND: [where, { pinnedUntil: { gt: now } }] };
    const regularWhere: Prisma.ListingWhereInput = { AND: [where, { OR: [{ pinnedUntil: null }, { pinnedUntil: { lte: now } }] }] };
    const [featured, pinned, regular, pinnedCount, regularCount] = await Promise.all([
      q.page === 1
        ? prisma.listing.findMany({ where: { ...where, featuredUntil: { gt: now } }, include: listingInclude, orderBy: { featuredUntil: 'desc' }, take: 12 })
        : [],
      q.page === 1 ? prisma.listing.findMany({ where: pinnedWhere, include: listingInclude, orderBy: { bumpedAt: 'desc' }, take: 48 }) : [],
      prisma.listing.findMany({ where: regularWhere, include: listingInclude, orderBy: { bumpedAt: 'desc' }, skip: (q.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.listing.count({ where: pinnedWhere }),
      prisma.listing.count({ where: regularWhere }),
    ]);
    const items = [...pinned, ...regular];
    const plans = await plansFor(app, [...featured, ...items].map((l) => l.userId));
    return {
      featured: featured.map((l) => present(app, l, plans.get(l.userId))),
      items: items.map((l) => present(app, l, plans.get(l.userId))),
      total: pinnedCount + regularCount,
      page: q.page,
      pageSize: PAGE_SIZE,
      pages: Math.max(1, Math.ceil(regularCount / PAGE_SIZE)),
    };
  });

  app.get('/mine', async (req) => {
    const user = await app.requireUser(req);
    const listing = await prisma.listing.findUnique({ where: { userId: user.id }, include: listingInclude });
    if (!listing) throw notFound('Vous n’avez pas encore d’annonce');
    return { ...present(app, listing), whatsapp: listing.whatsapp, moderationNote: listing.moderationNote };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, include: listingInclude });
    if (!listing) throw notFound();
    if (listing.status !== 'APPROVED' || !listing.photos.length) {
      const viewer = await app.currentUser(req);
      if (!viewer || (viewer.id !== listing.userId && viewer.role === 'USER')) throw notFound();
    }
    const plans = await plansFor(app, [listing.userId]);
    return present(app, listing, plans.get(listing.userId));
  });

  // Création ou modification. Premium et VIP : publication automatique ; Standard : relecture par l'équipe (docs/adr/0002).
  // Une annonce sans photo n'est visible ni des visiteurs ni de la file de relecture.
  app.put('/mine', async (req) => {
    const user = await app.requireUser(req);
    if (!user.displayName || !user.birthDate) throw badRequest('Complétez votre profil avant de publier');
    const body = listingSchema.parse(req.body);
    const check = moderateText(body.title, body.body, body.neighborhood);
    if (check.decision === 'reject') throw badRequest('Annonce refusée par nos règles', check.reasons);
    const whatsapp = normalizeWhatsapp(body.whatsapp);
    if (!whatsapp) throw badRequest('Numéro WhatsApp invalide', { whatsapp: ['Numéro mobile camerounais attendu (6XX XX XX XX)'] });
    const city = await prisma.city.findUnique({ where: { slug: body.citySlug } });
    if (!city) throw badRequest('Ville inconnue');
    const data = {
      title: body.title,
      body: body.body,
      intent: body.intent,
      cityId: city.id,
      neighborhood: body.neighborhood || null,
      whatsapp,
      status: await statusAfterEdit(user.id),
      moderationNote: null,
    };
    const listing = await prisma.listing.upsert({ where: { userId: user.id }, update: data, create: { ...data, userId: user.id } });
    return { id: listing.id, status: listing.status };
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
    const { key, thumbKey } = z.object({ key: z.string(), thumbKey: z.string().optional() }).parse(req.body);
    const own = (k: string) => k.startsWith(`listings/${user.id}/`) && !k.includes('..');
    if (!own(key) || (thumbKey && !own(thumbKey))) throw badRequest('Fichier invalide');
    const listing = await prisma.listing.findUnique({ where: { userId: user.id }, include: { _count: { select: { photos: true } } } });
    if (!listing) throw badRequest('Créez d’abord votre annonce');
    const { plan } = await effectivePlan(prisma, user.id);
    if (listing._count.photos >= PLAN_LIMITS[plan].photos) throw conflict('Limite de photos atteinte');
    // Une nouvelle photo renvoie l'annonce en relecture, sauf pour Premium et VIP.
    const status = await statusAfterEdit(user.id);
    await prisma.$transaction(async (tx) => {
      await tx.photo.create({ data: { listingId: listing.id, key, thumbKey: thumbKey ?? null, position: listing._count.photos } });
      await tx.listing.update({ where: { id: listing.id }, data: { status } });
    });
    return { ok: true };
  });

  app.delete<{ Params: { photoId: string } }>('/mine/photos/:photoId', async (req) => {
    const user = await app.requireUser(req);
    const photo = await prisma.photo.findFirst({ where: { id: req.params.photoId, listing: { userId: user.id } } });
    if (!photo) throw notFound();
    if ((await prisma.photo.count({ where: { listingId: photo.listingId } })) <= 1) {
      throw conflict('Une annonce garde au moins une photo : ajoutez-en une autre avant de supprimer celle-ci');
    }
    await prisma.photo.delete({ where: { id: photo.id } });
    return { ok: true };
  });

  // Lien WhatsApp vers l'annonceur, ouvert à tous les visiteurs. Le numéro n'est jamais dans la page :
  // il n'est donné qu'au clic, et une même connexion est limitée pour empêcher l'aspiration des numéros.
  app.post<{ Params: { id: string } }>('/:id/whatsapp', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) => {
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { displayName: true, bannedAt: true } }, _count: { select: { photos: true } } },
    });
    if (!listing || listing.status !== 'APPROVED' || !listing._count.photos || listing.user.bannedAt || !listing.whatsapp) throw notFound();
    const text = `J'ai vu ton profil sur Nyanga -> ${listing.user.displayName ?? listing.title} et je veux te rencontrer.`;
    return { url: whatsappLink(listing.whatsapp, text) };
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
