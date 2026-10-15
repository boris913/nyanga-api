// Filtre automatique appliqué avant la file de modération humaine.
// "reject" : refus immédiat (services tarifés, mineurs). "review" : publiable seulement après relecture attentive.
// Toute annonce passe de toute façon par un modérateur avant d'être visible.

export type ModerationResult = { decision: 'reject' | 'review' | 'ok'; reasons: string[] };

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const RULES: { pattern: RegExp; decision: 'reject' | 'review'; reason: string }[] = [
  { pattern: /\b(escort\w*|call ?girl|gigolo|prostitu\w*|sugar ?daddy|sugar ?mummy|plan ?cul|sodo\w*|fellation|pipe)\b/, decision: 'reject', reason: 'Services sexuels ou tarifés interdits' },
  { pattern: /\b(tarifs?|prix|fcfa|cfa|xaf|payant\w*|remuner\w*|pass(e)? ?\d|la nuit a|\d+ ?(k|mille|milles|f)\b)/, decision: 'reject', reason: 'Mention de prix ou de rémunération' },
  { pattern: /\b(mineure?s?|1[0-7] ?ans|jeunes? filles? de tout|ecoliere|lyceenne|collegienne)\b/, decision: 'reject', reason: 'Référence possible à des mineurs' },
  { pattern: /(\+?237[\s.-]?)?6[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}/, decision: 'review', reason: 'Numéro de téléphone dans le texte (utiliser la messagerie)' },
  { pattern: /\b(whatsapp|whats ?app|wa\.me|telegram|snap(chat)?|t\.me)\b/, decision: 'review', reason: 'Contact externe dans le texte' },
  { pattern: /\b(massage\w*|cadeau|discret\w*|sans tabou|chaude?s?|coquine?s?)\b/, decision: 'review', reason: 'Vocabulaire à vérifier' },
];

export function moderateText(...parts: (string | null | undefined)[]): ModerationResult {
  const text = normalize(parts.filter(Boolean).join(' \n '));
  const hits = RULES.filter((r) => r.pattern.test(text));
  if (hits.some((h) => h.decision === 'reject')) {
    return { decision: 'reject', reasons: hits.filter((h) => h.decision === 'reject').map((h) => h.reason) };
  }
  if (hits.length) return { decision: 'review', reasons: hits.map((h) => h.reason) };
  return { decision: 'ok', reasons: [] };
}

export function ageFromBirthDate(birthDate: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = now.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthDate.getUTCDate())) age--;
  return age;
}
