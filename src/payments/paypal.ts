/**
 * PayPal Orders v2, called from the server only: the browser never decides whether a payment
 * succeeded. Card payments go through PayPal too, as its guest checkout.
 */
export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  mode: 'sandbox' | 'live';
}

export function paypalConfig(env: NodeJS.ProcessEnv = process.env): PaypalConfig | null {
  const clientId = (env.PAYPAL_CLIENT_ID ?? '').trim();
  const clientSecret = (env.PAYPAL_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, mode: env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox' };
}

const base = (c: PaypalConfig) => (c.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

let token: { value: string; expires: number } | null = null;

async function accessToken(c: PaypalConfig): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch(`${base(c)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`PayPal sign-in failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return token.value;
}

export class PaypalError extends Error {
  constructor(message: string, public issue?: string) {
    super(message);
  }
}

async function call<T>(c: PaypalConfig, method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${base(c)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(c)}`,
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { details?: { issue?: string; description?: string }[]; message?: string };
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue as string | undefined;
    throw new PaypalError(json?.details?.[0]?.description ?? json?.message ?? `PayPal answered ${res.status}`, issue);
  }
  return json as T;
}

export interface PaypalOrder {
  id: string;
  status: string;
  payer?: { email_address?: string };
  purchase_units?: {
    custom_id?: string;
    payments?: { captures?: { id: string; status: string; amount: { currency_code: string; value: string } }[] };
  }[];
}

export function createOrder(c: PaypalConfig, p: { id: string; reference: string; amount: string; currency: string; description: string }) {
  return call<PaypalOrder>(c, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: p.reference,
      custom_id: p.id,
      invoice_id: p.reference,
      description: p.description.slice(0, 127),
      amount: { currency_code: p.currency, value: p.amount },
    }],
    application_context: { brand_name: 'CICC', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
  }, `create-${p.id}-${p.amount}-${p.currency}`);
}

export const captureOrder = (c: PaypalConfig, orderId: string) =>
  call<PaypalOrder>(c, 'POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${orderId}`);

export const getOrder = (c: PaypalConfig, orderId: string) => call<PaypalOrder>(c, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
