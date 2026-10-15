import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export const CLIENT_IP_HEADER = 'x-nyanga-client-ip';
export const PROXY_SECRET_HEADER = 'x-nyanga-proxy-secret';

/**
 * Adresse du visiteur. Derrière le site Vercel, l'API ne voit que les serveurs de Vercel :
 * le proxy du site transmet l'adresse réelle, acceptée seulement avec le secret partagé PROXY_SECRET.
 */
export function clientIp(req: FastifyRequest, proxySecret: string): string {
  if (proxySecret) {
    const given = Buffer.from(String(req.headers[PROXY_SECRET_HEADER] ?? ''));
    const expected = Buffer.from(proxySecret);
    const ip = req.headers[CLIENT_IP_HEADER];
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected) && typeof ip === 'string' && ip.length <= 64) {
      return ip.trim();
    }
  }
  return req.ip;
}
