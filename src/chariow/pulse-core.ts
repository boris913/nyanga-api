// Logique pure reprise du skill chariow-saas-billing (scripts/pulse-core.mjs), typée.
import crypto from 'node:crypto';

/** rawBody : Buffer EXACT reçu (jamais JSON.stringify du JSON parsé). header : valeur de x-chariow-signature. */
export function verifyPulseSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith('sha256=') || !secret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type PulsePayload = {
  event?: string;
  customer?: { email?: string; id?: string };
  product?: { id?: string };
  sale?: { id?: string; custom_metadata?: Record<string, string> };
  license?: { key?: string; expires_at?: string | null };
  days_until_expiry?: number;
};

export type EntitlementAction<P extends string = string> =
  | { type: 'record_purchase'; email?: string; productId?: string; known: boolean; saleId?: string; userId: string | null; listingId: string | null }
  | { type: 'grant'; email?: string; productId?: string; plan?: P; licenseKey?: string; expiresAt: string | null }
  | { type: 'remind_renewal'; email?: string; plan?: P; days?: number }
  | { type: 'downgrade' | 'revoke'; email?: string; plan?: P; licenseKey?: string }
  | { type: 'ignore' };

/** planByProductId : produits Chariow de type licence → plan. knownProducts : tous les produits vendus. */
export function toEntitlementAction<P extends string>(
  payload: PulsePayload,
  planByProductId: Record<string, P>,
  knownProducts: Set<string>,
): EntitlementAction<P> {
  const email = payload.customer?.email?.trim().toLowerCase();
  const productId = payload.product?.id;
  const plan = productId ? planByProductId[productId] : undefined;
  switch (payload.event) {
    case 'successful.sale':
      return {
        type: 'record_purchase', email, productId, known: Boolean(productId && knownProducts.has(productId)),
        saleId: payload.sale?.id,
        userId: payload.sale?.custom_metadata?.user_id ?? null,
        listingId: payload.sale?.custom_metadata?.listing_id ?? null,
      };
    case 'license.issued':
    case 'license.activated':
      return { type: 'grant', email, productId, plan, licenseKey: payload.license?.key, expiresAt: payload.license?.expires_at ?? null };
    case 'license.nearing_expiry':
      return { type: 'remind_renewal', email, plan, days: payload.days_until_expiry };
    case 'license.expired':
      return { type: 'downgrade', email, plan, licenseKey: payload.license?.key };
    case 'license.revoked':
      return { type: 'revoke', email, plan, licenseKey: payload.license?.key };
    default:
      return { type: 'ignore' };
  }
}

/** Produit inconnu, email ou identifiant absent : on n'accorde rien (fail closed). */
export function isActionSafe(action: EntitlementAction): boolean {
  switch (action.type) {
    case 'ignore':
      return true;
    case 'record_purchase':
      return Boolean(action.email && action.saleId && action.known);
    case 'grant':
      return Boolean(action.email && action.plan && action.licenseKey);
    case 'downgrade':
    case 'revoke':
      return Boolean(action.licenseKey);
    case 'remind_renewal':
      return Boolean(action.email && action.plan);
  }
}
