import { randomInt } from 'node:crypto';

// Adresse lisible d'une annonce : « <nom>-<ville>-<6 caractères> », fixée à la création, jamais modifiée.

const SLUG_MAX = 60;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function randomSuffix(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function listingSlug(name: string, citySlug: string, suffix = randomSuffix()): string {
  const city = slugify(citySlug);
  const room = SLUG_MAX - suffix.length - 1 - (city ? city.length + 1 : 0);
  const base = slugify(name).slice(0, Math.max(room, 1)).replace(/-+$/, '') || 'annonce';
  return [base, city, suffix].filter(Boolean).join('-');
}
