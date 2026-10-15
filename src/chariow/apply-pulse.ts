import type { FastifyBaseLogger } from 'fastify';
import type { Plan, PrismaClient } from '@prisma/client';
import type { CatalogItem } from '../lib/plans.js';
import { isActionSafe, toEntitlementAction, type PulsePayload } from './pulse-core.js';

type Deps = { prisma: PrismaClient; byProductId: Record<string, CatalogItem>; log: FastifyBaseLogger };

export async function applyPulse(payload: PulsePayload, { prisma, byProductId, log }: Deps): Promise<void> {
  const planByProductId: Record<string, Plan> = {};
  for (const [id, item] of Object.entries(byProductId)) if (item.kind === 'plan') planByProductId[id] = item.plan;

  const action = toEntitlementAction(payload, planByProductId, new Set(Object.keys(byProductId)));
  if (!isActionSafe(action)) {
    log.warn({ event: payload.event, productId: payload.product?.id }, 'Pulse refusé (fail closed)');
    return;
  }

  switch (action.type) {
    case 'ignore':
      return;

    case 'record_purchase': {
      const user = action.userId ? await prisma.user.findUnique({ where: { id: action.userId } }) : null;
      const userId = user?.id ?? null;
      const purchase = await prisma.purchase.upsert({
        where: { saleId: action.saleId! },
        update: {},
        create: { saleId: action.saleId!, userId, email: action.email!, productId: action.productId!, listingId: action.listingId },
      });
      if (userId) {
        // Une licence arrivée avant la vente est rattachée maintenant.
        await prisma.subscription.updateMany({
          where: { userId: null, email: action.email!, productId: action.productId! },
          data: { userId },
        });
      }
      const item = byProductId[action.productId!];
      if (item?.kind === 'boost' && userId && purchase.listingId) await applyBoost(prisma, userId, purchase.listingId, item);
      return;
    }

    case 'grant': {
      const purchase = await prisma.purchase.findFirst({
        where: { email: action.email!, productId: action.productId!, userId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      const userId = purchase?.userId ?? (await prisma.user.findUnique({ where: { email: action.email! } }))?.id ?? null;
      const expiresAt = action.expiresAt ? new Date(action.expiresAt) : null;
      await prisma.subscription.upsert({
        where: { licenseKey: action.licenseKey! },
        update: { status: 'ACTIVE', expiresAt, userId: userId ?? undefined },
        create: { licenseKey: action.licenseKey!, email: action.email!, productId: action.productId!, plan: action.plan!, expiresAt, userId },
      });
      return;
    }

    case 'downgrade':
    case 'revoke':
      await prisma.subscription.updateMany({
        where: { licenseKey: action.licenseKey! },
        data: { status: action.type === 'revoke' ? 'REVOKED' : 'EXPIRED' },
      });
      return;

    case 'remind_renewal':
      // Branchement futur : SMS ou notification de relance.
      log.info({ email: action.email, plan: action.plan, days: action.days }, 'Relance de renouvellement à envoyer');
      return;
  }
}

async function applyBoost(prisma: PrismaClient, userId: string, listingId: string, item: Extract<CatalogItem, { kind: 'boost' }>) {
  const listing = await prisma.listing.findFirst({ where: { id: listingId, userId } });
  if (!listing) return;
  const now = new Date();
  const base = listing.featuredUntil && listing.featuredUntil > now ? listing.featuredUntil : now;
  await prisma.listing.update({
    where: { id: listing.id },
    data: {
      bumpedAt: now,
      ...(item.featuredHours ? { featuredUntil: new Date(base.getTime() + item.featuredHours * 3600_000) } : {}),
    },
  });
}

export async function effectivePlan(prisma: PrismaClient, userId: string): Promise<{ plan: Plan; expiresAt: Date | null }> {
  const now = new Date();
  const subs = await prisma.subscription.findMany({
    where: { userId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  });
  let best: { plan: Plan; expiresAt: Date | null } = { plan: 'STANDARD', expiresAt: null };
  const rank = { STANDARD: 0, PREMIUM: 1, VIP: 2 } as const;
  for (const s of subs) if (rank[s.plan] > rank[best.plan]) best = { plan: s.plan, expiresAt: s.expiresAt };
  return best;
}
