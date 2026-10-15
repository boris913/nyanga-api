import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { badRequest, notFound, tooMany } from '../lib/errors.js';
import { moderateText } from '../lib/moderation.js';
import { PLAN_LIMITS } from '../lib/plans.js';
import { effectivePlan } from '../chariow/apply-pulse.js';

const bodySchema = z.object({ body: z.string().trim().min(1).max(1000) });

async function assertCanSend(app: FastifyInstance, user: User, text: string) {
  if (!user.displayName) throw badRequest('Complétez votre profil pour écrire');
  if (moderateText(text).decision === 'reject') throw badRequest('Message refusé par nos règles');
  const { plan } = await effectivePlan(app.prisma, user.id);
  const limit = PLAN_LIMITS[plan].messagesPerDay;
  if (Number.isFinite(limit)) {
    const sent = await app.prisma.message.count({ where: { senderId: user.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (sent >= limit) throw tooMany(`Limite de ${limit} messages par 24 h atteinte. Passez Premium pour écrire sans limite.`);
  }
}

export const messageRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app;

  app.get('/', async (req) => {
    const user = await app.requireUser(req);
    const convs = await prisma.conversation.findMany({
      where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        userA: { select: { id: true, displayName: true } },
        userB: { select: { id: true, displayName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return convs.map((c) => ({
      id: c.id,
      other: c.userAId === user.id ? c.userB : c.userA,
      lastMessage: c.messages[0] ? { body: c.messages[0].body, createdAt: c.messages[0].createdAt, mine: c.messages[0].senderId === user.id } : null,
      updatedAt: c.updatedAt,
    }));
  });

  // Premier message depuis une annonce.
  app.post('/', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
    const user = await app.requireUser(req);
    const { listingId, body } = bodySchema.extend({ listingId: z.string() }).parse(req.body);
    const listing = await prisma.listing.findFirst({ where: { id: listingId, status: 'APPROVED' } });
    if (!listing) throw notFound('Annonce introuvable');
    if (listing.userId === user.id) throw badRequest('C’est votre propre annonce');
    await assertCanSend(app, user, body);
    const [userAId, userBId] = [user.id, listing.userId].sort();
    const conv = await prisma.conversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: { listingId: listing.id },
      create: { userAId, userBId, listingId: listing.id },
    });
    await prisma.message.create({ data: { conversationId: conv.id, senderId: user.id, body } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    return { id: conv.id };
  });

  app.get<{ Params: { id: string } }>('/:id/messages', async (req) => {
    const user = await app.requireUser(req);
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, OR: [{ userAId: user.id }, { userBId: user.id }] },
      include: { userA: { select: { id: true, displayName: true } }, userB: { select: { id: true, displayName: true } } },
    });
    if (!conv) throw notFound();
    const messages = await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' }, take: 200 });
    return {
      id: conv.id,
      listingId: conv.listingId,
      other: conv.userAId === user.id ? conv.userB : conv.userA,
      messages: messages.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, mine: m.senderId === user.id })),
    };
  });

  app.post<{ Params: { id: string } }>('/:id/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const user = await app.requireUser(req);
    const { body } = bodySchema.parse(req.body);
    const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, OR: [{ userAId: user.id }, { userBId: user.id }] } });
    if (!conv) throw notFound();
    await assertCanSend(app, user, body);
    const msg = await prisma.message.create({ data: { conversationId: conv.id, senderId: user.id, body } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    return { id: msg.id, body: msg.body, createdAt: msg.createdAt, mine: true };
  });
};
