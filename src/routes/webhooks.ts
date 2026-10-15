import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { verifyPulseSignature, type PulsePayload } from '../chariow/pulse-core.js';
import { applyPulse } from '../chariow/apply-pulse.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Corps brut obligatoire : la signature porte sur les octets exacts envoyés par Chariow.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post('/chariow', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = req.body as Buffer;
    const signature = req.headers['x-chariow-signature'];
    if (!Buffer.isBuffer(raw) || !verifyPulseSignature(raw, typeof signature === 'string' ? signature : undefined, app.env.CHARIOW_PULSE_SECRET)) {
      return reply.status(401).send({ error: 'invalid_signature' });
    }

    let payload: PulsePayload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return reply.status(400).send({ error: 'invalid_json' });
    }

    const deliveryId = req.headers['x-pulse-delivery-id'];
    // Les "test pulses" n'ont pas d'identifiant de livraison : acceptés sans effet métier.
    if (typeof deliveryId !== 'string' || !deliveryId) return { ok: true, test: true };

    try {
      await app.prisma.pulseDelivery.create({ data: { id: deliveryId, event: payload.event ?? 'unknown', payload: payload as Prisma.InputJsonValue } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // Déjà reçu : on ne retraite que si le premier traitement a échoué (rejeu depuis Deliveries).
      const previous = await app.prisma.pulseDelivery.findUnique({ where: { id: deliveryId } });
      if (previous?.processedAt || !previous?.error) return { ok: true, duplicate: true };
    }

    // Réponse rapide (timeout Chariow 30 s), traitement après l'envoi.
    setImmediate(async () => {
      try {
        await applyPulse(payload, { prisma: app.prisma, byProductId: app.byProductId, log: app.log });
        await app.prisma.pulseDelivery.update({ where: { id: deliveryId }, data: { processedAt: new Date() } });
      } catch (err) {
        app.log.error({ err, deliveryId }, 'Échec du traitement du Pulse');
        await app.prisma.pulseDelivery.update({ where: { id: deliveryId }, data: { error: String(err) } }).catch(() => {});
      }
    });
    return { ok: true };
  });
};
