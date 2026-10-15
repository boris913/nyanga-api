// Test d'intégration manuel (base PostgreSQL réelle) : DATABASE_URL=... npx tsx test/pinned.integration.ts
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { applyPulse } from '../src/chariow/apply-pulse.js';

const prisma = new PrismaClient();
const env = loadEnv({ ...process.env, NODE_ENV: 'test', WEB_URL: 'http://localhost:3000', JWT_SECRET: 'j'.repeat(32), CHARIOW_PRODUCT_BUMP: 'prd_bump' });
const app = await buildApp(env, { prisma });
const city = await prisma.city.findUniqueOrThrow({ where: { slug: 'douala' } });
const mk = async (n: string, bumpedAt: Date) => {
  const u = await prisma.user.create({ data: { email: `${n}@t.invalid`, displayName: n, birthDate: new Date('1990-01-01') } });
  return prisma.listing.create({ data: { userId: u.id, title: `Annonce ${n}`, body: 'x'.repeat(40), intent: 'RELATION', cityId: city.id, status: 'APPROVED', bumpedAt } });
};
const h = (n: number) => new Date(Date.now() - n * 3600_000);
const old = await mk('ancienne', h(48));
await mk('recente', h(1));
const expired = await mk('expiree', h(30));
await prisma.listing.update({ where: { id: expired.id }, data: { pinnedUntil: h(2) } });

const order = async () => (await app.inject({ url: '/api/listings' })).json().items.map((l: { title: string }) => l.title.replace('Annonce ', ''));
console.log('avant achat  :', (await order()).join(' > '));

const pulse = { event: 'successful.sale', customer: { email: 'ancienne@t.invalid' }, product: { id: 'prd_bump' }, sale: { id: 'sale_1' } };
await applyPulse(pulse, { prisma, byProductId: app.byProductId, log: app.log });
const after = await prisma.listing.findUniqueOrThrow({ where: { id: old.id } });
console.log('après achat  :', (await order()).join(' > '), '| en tête pendant', Math.round((after.pinnedUntil!.getTime() - Date.now()) / 3600_000), 'h');
await applyPulse(pulse, { prisma, byProductId: app.byProductId, log: app.log });
const replay = await prisma.listing.findUniqueOrThrow({ where: { id: old.id } });
console.log('Pulse rejoué :', replay.pinnedUntil!.getTime() === after.pinnedUntil!.getTime() ? 'pas de prolongation (OK)' : 'PROLONGÉ (BUG)');
await app.close();
