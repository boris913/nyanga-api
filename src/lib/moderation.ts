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

// Tri des annonces à risque (docs/adr/0003) : un score, pas un refus. Au-delà du seuil,
// l'annonce passe en relecture, y compris pour Premium et VIP.
export const RISK_REVIEW_THRESHOLD = 30;

export type RiskInput = {
  title: string;
  body: string;
  neighborhood?: string | null;
  age?: number | null;
  // Nombre d'autres annonces qui utilisent le même numéro WhatsApp.
  sharedWhatsappCount?: number;
};
export type RiskResult = { score: number; reasons: string[] };

const RISK_SIGNALS: { pattern: RegExp; weight: number; reason: string }[] = [
  { pattern: /\b(adolescentes?|ados?)\b/, weight: 40, reason: 'Mention « adolescente » ou « ado »' },
  { pattern: /\b(lyceennes?|ecolieres?|collegiennes?)\b/, weight: 45, reason: 'Mention d’une élève (lycéenne, écolière, collégienne)' },
  { pattern: /\b(school ?girls?|uniformes? scolaires?)\b/, weight: 45, reason: 'Mention « school girl » ou « uniforme scolaire »' },
  { pattern: /\b(lolitas?|loli)\b/, weight: 50, reason: 'Mention « lolita »' },
  { pattern: /\b(vierges?|virgins?)\b/, weight: 25, reason: 'Mention « vierge »' },
  { pattern: /\b(tout juste|fraichement)\s+18\b/, weight: 35, reason: 'Mention « tout juste 18 ans »' },
  { pattern: /\b(teens?|teenagers?)\b/, weight: 20, reason: 'Mention « teen »' },
  { pattern: /\b(vacances scolaires|rentree scolaire|apres les cours)\b/, weight: 20, reason: 'Référence au calendrier scolaire' },
  { pattern: /\b(debutantes?|premiere fois)\b/, weight: 10, reason: 'Mention « débutante » ou « première fois »' },
];

export function riskScore({ title, body, neighborhood, age, sharedWhatsappCount = 0 }: RiskInput): RiskResult {
  const text = normalize([title, body, neighborhood].filter(Boolean).join(' \n '));
  let score = 0;
  const reasons: string[] = [];
  for (const s of RISK_SIGNALS) {
    if (s.pattern.test(text)) {
      score += s.weight;
      reasons.push(s.reason);
    }
  }
  if (age === 18) {
    score += 20;
    reasons.push('Annonceur âgé de 18 ans');
  } else if (age === 19) {
    score += 10;
    reasons.push('Annonceur âgé de 19 ans');
  }
  if (sharedWhatsappCount >= 9) {
    score += 25;
    reasons.push(`Numéro WhatsApp utilisé sur ${sharedWhatsappCount} autres annonces`);
  } else if (sharedWhatsappCount >= 2) {
    score += 15;
    reasons.push(`Numéro WhatsApp utilisé sur ${sharedWhatsappCount} autres annonces`);
  }
  return { score: Math.min(score, 100), reasons };
}
