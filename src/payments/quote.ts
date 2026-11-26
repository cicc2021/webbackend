import { Asset } from './networks';

/** How long a crypto price is held for the payer. */
export const QUOTE_MINUTES = 20;
/** Payments within 0.5% below the quote still count, because some wallets and exchanges round or take fees. */
export const TOLERANCE_PER_MILLE = 995n;

const cache = new Map<string, { at: number; price: number }>();
const CACHE_MS = 60_000;

/** Price of one unit of each asset in the given fiat currency, from CoinGecko, cached for a minute. */
export async function fetchPrice(priceId: string, currency: string): Promise<number> {
  const key = `${priceId}:${currency}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.price;
  const apiKey = process.env.COINGECKO_API_KEY;
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(priceId)}&vs_currencies=${currency.toLowerCase()}`, {
    headers: apiKey ? { 'x-cg-demo-api-key': apiKey } : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Price service answered ${res.status}`);
  const body = (await res.json()) as Record<string, Record<string, number> | undefined>;
  const price = Number(body[priceId]?.[currency.toLowerCase()]);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`No price for ${priceId}`);
  cache.set(key, { at: Date.now(), price });
  return price;
}

/**
 * Turns a fiat amount into an exact crypto amount: rounded up to what the payer sees, so the amount
 * shown and the amount checked are the same number. Works in integers to avoid float rounding.
 */
export function cryptoAmount(fiatAmount: string, price: number, asset: Asset) {
  const [whole, frac = ''] = fiatAmount.split('.');
  const cents = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  const priceE9 = BigInt(Math.round(price * 1e9));
  const shown = 10n ** BigInt(asset.displayDecimals);
  // units of the displayed precision = ceil(cents / 100 / price * 10^displayDecimals)
  const numerator = cents * shown * 1_000_000_000n;
  const denominator = priceE9 * 100n;
  const units = (numerator + denominator - 1n) / denominator;
  const raw = units * 10n ** BigInt(asset.decimals - asset.displayDecimals);
  return { raw, display: formatUnits(raw, asset.decimals) };
}

/** 1234500000000000000n with 18 decimals → "1.2345". */
export function formatUnits(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

export function isEnough(received: bigint, expected: bigint): boolean {
  return received * 1000n >= expected * TOLERANCE_PER_MILLE;
}
