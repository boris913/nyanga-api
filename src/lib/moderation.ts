// Filtre automatique, appliqué à toutes les annonces avant publication (docs/adr/0002).
// Seule règle conservée : les références à des mineurs, refusées d'office.

export type ModerationResult = { decision: 'reject' | 'ok'; reasons: string[] };

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const MINORS = /\b(mineure?s?|1[0-7] ?ans|jeunes? filles? de tout|ecoliere|lyceenne|collegienne)\b/;

export function moderateText(...parts: (string | null | undefined)[]): ModerationResult {
  const text = normalize(parts.filter(Boolean).join(' \n '));
  if (MINORS.test(text)) return { decision: 'reject', reasons: ['Référence possible à des mineurs'] };
  return { decision: 'ok', reasons: [] };
}

export function ageFromBirthDate(birthDate: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = now.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthDate.getUTCDate())) age--;
  return age;
}
