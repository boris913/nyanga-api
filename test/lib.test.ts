import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clientIp } from '../src/lib/client-ip.js';
import { normalizeCameroonPhone } from '../src/lib/phone.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { ageFromBirthDate, moderateText } from '../src/lib/moderation.js';
import { signSession, verifySession } from '../src/lib/session.js';

describe('normalizeCameroonPhone', () => {
  it.each([
    ['690123456', '+237690123456'],
    ['6 90 12 34 56', '+237690123456'],
    ['+237 690-12-34-56', '+237690123456'],
    ['00237690123456', '+237690123456'],
    ['222123456', '+237222123456'],
  ])('%s → %s', (input, expected) => expect(normalizeCameroonPhone(input)).toBe(expected));

  it.each(['59012345', '790123456', '+33612345678', '6901234567', 'abc'])('rejette %s', (input) =>
    expect(normalizeCameroonPhone(input)).toBeNull(),
  );
});

describe('mots de passe', () => {
  it('vérifie le bon mot de passe et rejette les autres', async () => {
    const hash = await hashPassword('motdepasse-solide');
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword('motdepasse-solide', hash)).toBe(true);
    expect(await verifyPassword('motdepasse-solidE', hash)).toBe(false);
  });
  it('sale chaque hash', async () => expect(await hashPassword('x'.repeat(8))).not.toBe(await hashPassword('x'.repeat(8))));
  it('rejette un format inconnu', async () => expect(await verifyPassword('a', 'bcrypt$abc')).toBe(false));
});

describe('moderateText', () => {
  it('accepte une annonce ordinaire', () => {
    expect(moderateText('Homme de 34 ans cherche relation sérieuse', 'J’aime la cuisine et les balades à Kribi.').decision).toBe('ok');
  });
  it.each([
    ['services tarifés', 'Escort disponible ce soir'],
    ['prix', 'Rencontre 20000 FCFA la nuit'],
    ['montant abrégé', 'Disponible pour 10k'],
    ['mineurs', 'Lycéenne cherche ami'],
    ['âge mineur', 'J’ai 16 ans'],
  ])('refuse : %s', (_label, text) => expect(moderateText(text).decision).toBe('reject'));

  it('ne confond pas 31 ans avec un âge mineur', () => expect(moderateText('Femme de 31 ans').decision).toBe('ok'));
  it('signale un numéro ou un contact externe', () => {
    expect(moderateText('Écris-moi au 6 90 12 34 56').decision).toBe('review');
    expect(moderateText('Contacte-moi sur WhatsApp').decision).toBe('review');
  });
});

describe('ageFromBirthDate', () => {
  const now = new Date(Date.UTC(2026, 9, 15));
  it('compte les années pleines', () => {
    expect(ageFromBirthDate(new Date(Date.UTC(2008, 9, 15)), now)).toBe(18);
    expect(ageFromBirthDate(new Date(Date.UTC(2008, 9, 16)), now)).toBe(17);
  });
});

describe('session', () => {
  const secret = 's'.repeat(32);
  it('aller-retour signé', async () => {
    const token = await signSession(secret, 'user1', 3);
    expect(await verifySession(secret, token)).toEqual({ sub: 'user1', v: 3 });
  });
  it('rejette un autre secret ou un jeton altéré', async () => {
    const token = await signSession(secret, 'user1', 0);
    expect(await verifySession('x'.repeat(32), token)).toBeNull();
    expect(await verifySession(secret, token.slice(0, -2) + 'aa')).toBeNull();
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, string>) => ({ headers, ip: '98.84.176.5' }) as unknown as FastifyRequest;
  it('prend l’adresse transmise par le proxy avec le bon secret', () =>
    expect(clientIp(req({ 'x-nyanga-client-ip': '102.244.1.7', 'x-nyanga-proxy-secret': 'secret' }), 'secret')).toBe('102.244.1.7'));
  it('ignore l’adresse sans secret valide ou sans secret configuré', () => {
    expect(clientIp(req({ 'x-nyanga-client-ip': '1.2.3.4', 'x-nyanga-proxy-secret': 'faux' }), 'secret')).toBe('98.84.176.5');
    expect(clientIp(req({ 'x-nyanga-client-ip': '1.2.3.4' }), 'secret')).toBe('98.84.176.5');
    expect(clientIp(req({ 'x-nyanga-client-ip': '1.2.3.4', 'x-nyanga-proxy-secret': '' }), '')).toBe('98.84.176.5');
  });
});
