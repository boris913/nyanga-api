import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { forbidden, notFound } from '../lib/errors.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app;

  // File de modération : les annonces les plus anciennes d'abord.
  app.get('/listings', async (req) => {
    await app.requireStaff(req);
    const { status } = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN']).default('PENDING') }).parse(req.query);
    const listings = await prisma.listing.findMany({
      where: { status },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      include: {
        city: true,
        photos: { orderBy: { position: 'asc' } },
        user: { select: { id: true, displayName: true, email: true, birthDate: true, verification: true } },
        _count: { select: { reports: { where: { resolvedAt: null } } } },
      },
    });
    return listings.map((l) => ({
      id: l.id,
      title: l.title,
      body: l.body,
      intent: l.intent,
      city: l.city.name,
      neighborhood: l.neighborhood,
      status: l.status,
      moderationNote: l.moderationNote,
      updatedAt: l.updatedAt,
      openReports: l._count.reports,
      photos: l.photos.map((p) => app.storage.publicUrl(p.key)),
      user: l.user,
    }));
  });

  app.post<{ Params: { id: string } }>('/listings/:id/decision', async (req) => {
    const staff = await app.requireStaff(req);
    const body = z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'HIDDEN']), note: z.string().max(500).optional() }).parse(req.body);
    const updated = await prisma.listing.updateMany({
      where: { id: req.params.id },
      data: { status: body.decision, moderationNote: body.note ? `${body.note} (par ${staff.displayName ?? staff.email})` : null },
    });
    if (!updated.count) throw notFound();
    if (body.decision !== 'APPROVED') await prisma.report.updateMany({ where: { listingId: req.params.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
    return { ok: true };
  });

  app.get('/reports', async (req) => {
    await app.requireStaff(req);
    return prisma.report.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { listing: { select: { id: true, title: true, status: true } }, reporter: { select: { id: true, displayName: true } } },
    });
  });

  app.post<{ Params: { id: string } }>('/reports/:id/resolve', async (req) => {
    await app.requireStaff(req);
    await prisma.report.updateMany({ where: { id: req.params.id }, data: { resolvedAt: new Date() } });
    return { ok: true };
  });

  app.get('/verifications', async (req) => {
    await app.requireStaff(req);
    const users = await prisma.user.findMany({
      where: { verification: 'PENDING' },
      take: 50,
      include: { listing: { include: { photos: { orderBy: { position: 'asc' }, take: 3 } } } },
    });
    return Promise.all(
      users.map(async (u) => ({
        id: u.id,
        displayName: u.displayName,
        selfie: u.selfieKey ? await app.storage.signedUrl(u.selfieKey) : null,
        photos: u.listing?.photos.map((p) => app.storage.publicUrl(p.key)) ?? [],
      })),
    );
  });

  app.post<{ Params: { id: string } }>('/users/:id/verification', async (req) => {
    await app.requireStaff(req);
    const { decision } = z.object({ decision: z.enum(['VERIFIED', 'REJECTED']) }).parse(req.body);
    await prisma.user.updateMany({ where: { id: req.params.id, verification: 'PENDING' }, data: { verification: decision } });
    return { ok: true };
  });

  // Bannissement : coupe les sessions et masque l'annonce.
  app.post<{ Params: { id: string } }>('/users/:id/ban', async (req) => {
    const staff = await app.requireStaff(req);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound();
    if (target.role !== 'USER' && staff.role !== 'ADMIN') throw forbidden();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { bannedAt: new Date(), tokenVersion: { increment: 1 } } });
      await tx.listing.updateMany({ where: { userId: target.id }, data: { status: 'HIDDEN' } });
    });
    return { ok: true };
  });
};
