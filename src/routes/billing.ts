import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { normalizeCameroonPhone } from '../lib/phone.js';
import { clientIp } from '../lib/client-ip.js';

const checkoutSchema = z.object({
  sku: z.enum(['PREMIUM', 'VIP', 'BUMP', 'FEATURED_24H', 'FEATURED_7D']),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  // Numéro Mobile Money (Orange Money, MTN MoMo) utilisé pour le paiement.
  phone: z.string().min(9).max(20),
});

export const billingRoutes: FastifyPluginAsync = async (app) => {
  const { prisma, env } = app;

  app.get('/catalog', async () =>
    app.catalog.map(({ productId, ...item }) => ({ ...item, available: Boolean(productId && env.CHARIOW_API_KEY) })),
  );

  // Démarre un paiement Chariow. L'accès n'est accordé qu'à réception du Pulse signé, jamais ici.
  app.post('/checkout', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const user = await app.requireUser(req);
    const body = checkoutSchema.parse(req.body);
    const item = app.catalog.find((c) => c.sku === body.sku);
    if (!item?.productId) throw badRequest('Produit indisponible pour le moment');

    const metadata: Record<string, string> = { user_id: user.id, sku: item.sku };
    if (item.kind === 'boost') {
      const listing = await prisma.listing.findUnique({ where: { userId: user.id } });
      if (!listing || listing.status !== 'APPROVED') throw badRequest('Votre annonce doit être publiée pour être mise en avant');
      metadata.listing_id = listing.id;
    }

    const phone = normalizeCameroonPhone(body.phone);
    if (!phone) throw badRequest('Numéro camerounais invalide');
    if (phone !== user.phone) await prisma.user.update({ where: { id: user.id }, data: { phone } });

    const customerIp = clientIp(req, env.PROXY_SECRET);
    const result = await app.chariow.checkout({
      productId: item.productId,
      // L'email du compte rattache ensuite les Pulses license.* à cet utilisateur.
      email: user.email,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: { number: phone.replace('+237', ''), countryCode: 'CM' },
      metadata,
      redirectUrl: `${env.WEB_URL}/paiement/retour?sku=${item.sku}`,
      customerIp,
    });
    return result;
  });
};
