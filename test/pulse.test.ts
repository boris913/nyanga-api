import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { isActionSafe, toEntitlementAction, verifyPulseSignature } from '../src/chariow/pulse-core.js';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

const SECRET = 'pulse-secret';
const sign = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

describe('verifyPulseSignature', () => {
  const body = Buffer.from('{"event":"successful.sale"}');
  it('accepte la bonne signature', () => expect(verifyPulseSignature(body, sign(body.toString()), SECRET)).toBe(true));
  it('refuse signature absente, fausse ou secret vide', () => {
    expect(verifyPulseSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyPulseSignature(body, sign('autre'), SECRET)).toBe(false);
    expect(verifyPulseSignature(body, 'sha256=' + crypto.createHmac('sha256', '').update(body).digest('hex'), '')).toBe(false);
  });
});

describe('toEntitlementAction', () => {
  const plans = { prod_premium: 'PREMIUM' as const };
  const known = new Set(['prod_premium', 'prod_bump']);

  it('vente connue avec métadonnées', () => {
    const a = toEntitlementAction(
      { event: 'successful.sale', customer: { email: ' A@B.cm ' }, product: { id: 'prod_bump' }, sale: { id: 's1', custom_metadata: { user_id: 'u1', listing_id: 'l1' } } },
      plans,
      known,
    );
    expect(a).toMatchObject({ type: 'record_purchase', email: 'a@b.cm', userId: 'u1', listingId: 'l1', known: true });
    expect(isActionSafe(a)).toBe(true);
  });

  it('produit inconnu : rien n’est accordé', () => {
    const sale = toEntitlementAction({ event: 'successful.sale', customer: { email: 'a@b.cm' }, product: { id: 'x' }, sale: { id: 's1' } }, plans, known);
    expect(isActionSafe(sale)).toBe(false);
    const grant = toEntitlementAction({ event: 'license.issued', customer: { email: 'a@b.cm' }, product: { id: 'x' }, license: { key: 'K' } }, plans, known);
    expect(isActionSafe(grant)).toBe(false);
  });

  it('licence émise sur un plan connu', () => {
    const a = toEntitlementAction(
      { event: 'license.issued', customer: { email: 'a@b.cm' }, product: { id: 'prod_premium' }, license: { key: 'K', expires_at: '2026-11-14T00:00:00Z' } },
      plans,
      known,
    );
    expect(a).toEqual({ type: 'grant', email: 'a@b.cm', productId: 'prod_premium', plan: 'PREMIUM', licenseKey: 'K', expiresAt: '2026-11-14T00:00:00Z' });
    expect(isActionSafe(a)).toBe(true);
  });

  it('expiration et révocation exigent une clé', () => {
    expect(isActionSafe(toEntitlementAction({ event: 'license.expired' }, plans, known))).toBe(false);
    expect(toEntitlementAction({ event: 'license.revoked', license: { key: 'K' } }, plans, known)).toMatchObject({ type: 'revoke', licenseKey: 'K' });
  });

  it('événement inconnu ignoré', () => expect(toEntitlementAction({ event: 'autre' }, plans, known)).toEqual({ type: 'ignore' }));
});

describe('POST /api/webhooks/chariow', () => {
  async function setup() {
    const deliveries = new Map<string, { processedAt: Date | null; error: string | null }>();
    const prisma = {
      pulseDelivery: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          if (deliveries.has(data.id)) {
            const { Prisma } = await import('@prisma/client');
            throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
          }
          deliveries.set(data.id, { processedAt: null, error: null });
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => deliveries.get(where.id) ?? null),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(deliveries.get(where.id)!, data)),
      },
      $disconnect: vi.fn(),
    } as unknown as PrismaClient;
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test',
      WEB_URL: 'http://localhost:3000',
      JWT_SECRET: 'j'.repeat(32),
      CHARIOW_PULSE_SECRET: SECRET,
    });
    const app = await buildApp(env, { prisma });
    return { app, prisma };
  }

  const payload = JSON.stringify({ event: 'autre' });

  it('refuse une signature invalide', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/chariow',
      headers: { 'content-type': 'application/json', 'x-chariow-signature': sign('faux'), 'x-pulse-delivery-id': 'd1' },
      payload,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepte une fois puis signale le doublon', async () => {
    const { app, prisma } = await setup();
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/webhooks/chariow',
        headers: { 'content-type': 'application/json', 'x-chariow-signature': sign(payload), 'x-pulse-delivery-id': 'd1' },
        payload,
      });
    expect((await send()).json()).toEqual({ ok: true });
    await new Promise((r) => setImmediate(r));
    await vi.waitFor(() => expect(prisma.pulseDelivery.update).toHaveBeenCalled());
    expect((await send()).json()).toEqual({ ok: true, duplicate: true });
    await app.close();
  });

  it('accepte un test pulse sans identifiant de livraison', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/chariow',
      headers: { 'content-type': 'application/json', 'x-chariow-signature': sign(payload) },
      payload,
    });
    expect(res.json()).toEqual({ ok: true, test: true });
    await app.close();
  });
});
