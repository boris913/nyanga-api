import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clientIp } from '../src/lib/client-ip.js';
import { maskWhatsapp, normalizeCameroonPhone, normalizeWhatsapp, whatsappLink } from '../src/lib/phone.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { ageFromBirthDate, moderateText, RISK_REVIEW_THRESHOLD, riskScore } from '../src/lib/moderation.js';
import { listingSlug, randomSuffix, slugify } from '../src/lib/slug.js';
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
    ['mineurs', 'Lycéenne cherche ami'],
    ['âge mineur', 'J’ai 16 ans'],
  ])('refuse : %s', (_label, text) => expect(moderateText(text).decision).toBe('reject'));

  it('ne confond pas 31 ans avec un âge mineur', () => expect(moderateText('Femme de 31 ans').decision).toBe('ok'));
  it('laisse passer le reste, filtré seulement par la relecture', () => {
    expect(moderateText('Écris-moi au 6 90 12 34 56').decision).toBe('ok');
    expect(moderateText('Femme discrète, massage et cadeau').decision).toBe('ok');
  });
});

describe('whatsapp', () => {
  it('accepte un mobile camerounais', () => expect(normalizeWhatsapp('6 90 12 34 56')).toBe('+237690123456'));
  it('refuse un fixe', () => expect(normalizeWhatsapp('222 12 34 56')).toBeNull());
  it('masque tout sauf le premier chiffre', () => expect(maskWhatsapp('+237690123456')).toBe('+237 6XX XX XX XX'));
  it('prépare le lien wa.me', () =>
    expect(whatsappLink('+237690123456', 'Salut à toi')).toBe('https://wa.me/237690123456?text=Salut%20%C3%A0%20toi'));
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

describe('riskScore', () => {
  const base = { title: 'Femme de 30 ans cherche relation', body: 'J’aime la cuisine et les balades à Kribi le dimanche.' };
  it('donne 0 à une annonce ordinaire', () => expect(riskScore({ ...base, age: 30 })).toEqual({ score: 0, reasons: [] }));
  it.each([
    ['Adolescente sérieuse', 40],
    ['petite ado', 40],
    ['Lycéenne', 45],
    ['écolière', 45],
    ['school girl', 45],
    ['uniforme scolaire', 45],
    ['lolita', 50],
    ['vierge', 25],
    ['tout juste 18 ans', 35],
    ['fraîchement 18', 35],
    ['teenager', 20],
    ['dispo après les cours', 20],
    ['pendant les vacances scolaires', 20],
    ['débutante', 10],
    ['première fois', 10],
  ])('« %s » → %i', (phrase, expected) => {
    const r = riskScore({ ...base, body: `${base.body} ${phrase}` });
    expect(r.score).toBe(expected);
    expect(r.reasons).toHaveLength(1);
  });
  it('ne confond pas « adore » avec « ado »', () => expect(riskScore({ ...base, body: 'J’adore danser, je suis adorable.' }).score).toBe(0));
  it('lit aussi le quartier', () => expect(riskScore({ ...base, neighborhood: 'Près du lycée, après les cours' }).score).toBe(20));
  it.each([
    [18, 20],
    [19, 10],
    [20, 0],
    [null, 0],
  ])('âge %s → %i', (age, expected) => expect(riskScore({ ...base, age }).score).toBe(expected));
  it.each([
    [1, 0],
    [2, 15],
    [8, 15],
    [9, 25],
  ])('WhatsApp partagé avec %i autres annonces → %i', (n, expected) =>
    expect(riskScore({ ...base, sharedWhatsappCount: n }).score).toBe(expected),
  );
  it('cumule les signaux et plafonne à 100', () => {
    const r = riskScore({ title: 'Lolita lycéenne', body: 'ado vierge, tout juste 18', age: 18, sharedWhatsappCount: 10 });
    expect(r.score).toBe(100);
    expect(r.reasons.length).toBeGreaterThan(4);
  });
  it('seuil de relecture à 30', () => {
    expect(RISK_REVIEW_THRESHOLD).toBe(30);
    expect(riskScore({ ...base, body: 'vierge', age: 19 }).score).toBeGreaterThanOrEqual(RISK_REVIEW_THRESHOLD);
  });
});

describe('slug d’annonce', () => {
  it('retire accents et ponctuation', () => expect(slugify('  Ngaoundéré : Cœur Élégant !! ')).toBe('ngaoundere-coeur-elegant'));
  it('assemble nom, ville et suffixe', () => expect(listingSlug('Amélie N.', 'douala', 'ab12cd')).toBe('amelie-n-douala-ab12cd'));
  it('suffixe aléatoire de 6 caractères minuscules', () => {
    expect(listingSlug('Paul', 'yaounde')).toMatch(/^paul-yaounde-[a-z0-9]{6}$/);
    expect(randomSuffix()).not.toBe(randomSuffix());
  });
  it('reste sous ~60 caractères sans tiret final', () => {
    const s = listingSlug('Un nom de profil vraiment très très long pour une annonce de rencontre', 'ngaoundere', 'zzzzzz');
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(s.endsWith('-ngaoundere-zzzzzz')).toBe(true);
  });
  it('se replie sur « annonce » si le nom est vide après nettoyage', () => expect(listingSlug('😀', 'kribi', 'abcdef')).toBe('annonce-kribi-abcdef'));
});
