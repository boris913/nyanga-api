import { HttpError } from '../lib/errors.js';

export type CheckoutInput = {
  productId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: { number: string; countryCode: string };
  metadata: Record<string, string>;
  redirectUrl: string;
  customerIp?: string;
};

export type CheckoutResult =
  | { step: 'payment'; checkoutUrl: string }
  | { step: 'completed' }
  | { step: 'already_purchased' };

export function createChariowClient(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return {
    async checkout(input: CheckoutInput): Promise<CheckoutResult> {
      if (!apiKey) throw new HttpError(503, 'payments_disabled', 'Paiements non configurés');
      const res = await fetchImpl('https://api.chariow.com/v1/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          product_id: input.productId,
          email: input.email,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: { number: input.phone.number, country_code: input.phone.countryCode },
          custom_metadata: input.metadata,
          redirect_url: input.redirectUrl,
          ...(input.customerIp ? { customer_ip: input.customerIp } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { step?: string; payment?: { checkout_url?: string } };
        message?: string;
      };
      if (!res.ok) throw new HttpError(502, 'checkout_failed', json.message ?? 'Le paiement n’a pas pu démarrer');
      const step = json.data?.step;
      if (step === 'payment' && json.data?.payment?.checkout_url) return { step, checkoutUrl: json.data.payment.checkout_url };
      if (step === 'completed' || step === 'already_purchased') return { step };
      throw new HttpError(502, 'checkout_failed', 'Réponse Chariow inattendue');
    },
  };
}

export type ChariowClient = ReturnType<typeof createChariowClient>;
