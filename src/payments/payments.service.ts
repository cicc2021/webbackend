import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Payment, Prisma } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { findAsset, NETWORKS, normaliseTxHash, payToAddress } from './networks';
import { captureOrder, createOrder, getOrder, PaypalError, paypalConfig, PaypalOrder } from './paypal';
import { cryptoAmount, fetchPrice, formatUnits, isEnough, QUOTE_MINUTES } from './quote';
import { verifyTransaction } from './verifiers';
import { CreatePaymentDto } from './payments.dto';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const paymentRef = (n: number) => `CICC-PAY-${String(n).padStart(6, '0')}`;

/** Currencies both PayPal and the price feed handle for CICC. */
export const PAYABLE_CURRENCIES = ['EUR', 'USD'] as const;

/**
 * The row for a new payment plus the secret that goes to the payer's browser once. Kept separate
 * from the service so event registration can create its payment inside its own transaction.
 */
export function draftPayment(input: { email: string; name?: string; purpose: string; externalRef?: string; notes?: string; amount: string; currency: string; registrationId?: string }) {
  const secret = randomBytes(32).toString('base64url');
  const data: Prisma.PaymentUncheckedCreateInput = {
    secretHash: hash(secret),
    email: input.email.toLowerCase().trim(),
    name: input.name?.trim() ?? '',
    purpose: input.purpose.trim().slice(0, 160),
    externalRef: input.externalRef?.trim() ?? '',
    notes: input.notes?.trim() ?? '',
    fiatAmount: new Prisma.Decimal(input.amount),
    fiatCurrency: input.currency,
    registrationId: input.registrationId ?? null,
  };
  return { secret, data };
}

/** A transaction sent this long before the payment was started can't be for it. */
const EARLIEST_TX_MS = 10 * 60_000;
/** Funds sent this long after the quote expired are recorded but not accepted at that price. */
const LATE_TX_MS = 60 * 60_000;
/** How long a submitted transaction may stay unfindable before the payment is marked failed. */
const NOT_FOUND_GIVE_UP_MS = 3 * 60 * 60_000;
/** Minimum gap between chain checks for one payment, so polling can't hammer public RPCs. */
const CHECK_INTERVAL_MS = 8_000;

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** What the payment page may offer: only networks with a configured address, and PayPal if set up. */
  config() {
    const paypal = paypalConfig();
    return {
      currencies: ['EUR', 'USD'],
      quoteMinutes: QUOTE_MINUTES,
      paypal: paypal ? { clientId: paypal.clientId, mode: paypal.mode } : null,
      networks: NETWORKS.filter((n) => payToAddress(n)).map((n) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        chainId: n.chainId ?? null,
        confirmations: n.confirmations,
        assets: n.assets.map((a) => ({ symbol: a.symbol, name: a.name, decimals: a.decimals, contract: a.contract ?? null })),
      })),
    };
  }

  async create(dto: CreatePaymentDto) {
    const { secret, data } = draftPayment(dto);
    const p = await this.prisma.payment.create({ data });
    return { ...this.view(p), secret };
  }

  /** Every payer action needs the secret their browser was given; a payment id alone is not enough. */
  private async authorised(id: string, secret: string | undefined) {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Payment not found');
    const a = Buffer.from(hash(secret ?? ''));
    const b = Buffer.from(p.secretHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Not allowed');
    return p;
  }

  async get(id: string, secret: string | undefined) {
    const p = await this.authorised(id, secret);
    return this.view(await this.refresh(p));
  }

  async quote(id: string, secret: string | undefined, networkId: string, symbol: string) {
    const p = await this.authorised(id, secret);
    this.assertOpen(p);
    const found = findAsset(networkId, symbol);
    const payTo = found && payToAddress(found.network);
    if (!found || !payTo) throw new BadRequestException('That network or coin is not available');
    let price: number;
    try {
      price = await fetchPrice(found.asset.priceId, p.fiatCurrency);
    } catch (e) {
      this.log.warn(`Price lookup failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Live prices are unavailable right now. Please try again in a minute.');
    }
    const amount = cryptoAmount(p.fiatAmount.toFixed(2), price, found.asset);
    const updated = await this.prisma.payment.update({
      where: { id },
      data: {
        method: 'CRYPTO',
        network: found.network.id,
        asset: found.asset.symbol,
        expectedRaw: amount.raw.toString(),
        expectedAmount: amount.display,
        quotePrice: String(price),
        quoteExpiresAt: new Date(Date.now() + QUOTE_MINUTES * 60_000),
        payToAddress: payTo,
        paypalOrderId: null,
        // A new quote starts a fresh attempt: a failed earlier transaction no longer applies.
        txHash: null,
        submittedAt: null,
        payerWallet: null,
        receivedRaw: null,
        confirmations: null,
        failureReason: '',
        status: 'PENDING',
      },
    });
    return this.view(updated);
  }

  async submitTx(id: string, secret: string | undefined, txHash: string) {
    const p = await this.authorised(id, secret);
    if (p.status === 'PAID') return this.view(p);
    if (p.status === 'CONFIRMING' && p.txHash) throw new ConflictException('A transaction is already being confirmed for this payment');
    const network = NETWORKS.find((n) => n.id === p.network);
    if (p.method !== 'CRYPTO' || !network || !p.expectedRaw) throw new BadRequestException('Choose a coin first');
    const normalised = normaliseTxHash(network, txHash);
    if (!normalised) throw new BadRequestException(`That doesn't look like a ${network.name} transaction ID`);
    const used = await this.prisma.payment.findFirst({ where: { network: network.id, txHash: normalised, NOT: { id } } });
    if (used) throw new ConflictException('This transaction has already been used for another payment');
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { txHash: normalised, submittedAt: new Date(), status: 'CONFIRMING', failureReason: '', lastCheckedAt: null, payerWallet: null, receivedRaw: null, confirmations: null },
    });
    return this.view(await this.refresh(updated, true));
  }

  /* ---------------- PayPal ---------------- */

  async paypalCreate(id: string, secret: string | undefined) {
    const p = await this.authorised(id, secret);
    this.assertOpen(p);
    const c = paypalConfig();
    if (!c) throw new BadRequestException('PayPal is not available');
    try {
      const order = await createOrder(c, { id: p.id, reference: paymentRef(p.reference), amount: p.fiatAmount.toFixed(2), currency: p.fiatCurrency, description: `CICC – ${p.purpose}` });
      await this.prisma.payment.update({
        where: { id },
        data: { method: 'PAYPAL', paypalOrderId: order.id, network: null, asset: null, expectedRaw: null, expectedAmount: null, payToAddress: null, quoteExpiresAt: null, txHash: null, submittedAt: null, payerWallet: null, receivedRaw: null, confirmations: null, status: 'PENDING', failureReason: '' },
      });
      return { orderId: order.id };
    } catch (e) {
      this.log.error(`PayPal order failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('PayPal could not start the payment. Please try again.');
    }
  }

  async paypalCapture(id: string, secret: string | undefined) {
    const p = await this.authorised(id, secret);
    if (p.status === 'PAID') return { ...this.view(p), issue: null };
    const c = paypalConfig();
    if (!c || !p.paypalOrderId) throw new BadRequestException('No PayPal order to complete');
    try {
      const order = await captureOrder(c, p.paypalOrderId);
      return { ...this.view(await this.applyPaypal(p, order)), issue: null };
    } catch (e) {
      // A declined card or funding source: PayPal lets the payer pick another one without starting over.
      if (e instanceof PaypalError && e.issue === 'INSTRUMENT_DECLINED') return { ...this.view(p), issue: 'INSTRUMENT_DECLINED' };
      this.log.error(`PayPal capture failed: ${(e as Error).message}`);
      const failed = await this.prisma.payment.update({ where: { id }, data: { status: 'FAILED', failureReason: `PayPal could not complete the payment: ${(e as Error).message}` } });
      return { ...this.view(failed), issue: (e as PaypalError).issue ?? null };
    }
  }

  /** Only a completed capture of the exact amount and currency counts as paid. */
  private async applyPaypal(p: Payment, order: PaypalOrder) {
    return this.settle(await this.applyPaypalOrder(p, order));
  }

  private async applyPaypalOrder(p: Payment, order: PaypalOrder) {
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    const base = { paypalPayerEmail: order.payer?.email_address ?? p.paypalPayerEmail, paypalCaptureId: capture?.id ?? p.paypalCaptureId, lastCheckedAt: new Date() };
    if (order.purchase_units?.[0]?.custom_id && order.purchase_units[0].custom_id !== p.id) {
      return this.prisma.payment.update({ where: { id: p.id }, data: { ...base, status: 'FAILED', failureReason: 'The PayPal order belongs to a different payment.' } });
    }
    if (capture?.status === 'COMPLETED') {
      const matches = capture.amount.currency_code === p.fiatCurrency && capture.amount.value === p.fiatAmount.toFixed(2);
      return this.prisma.payment.update({
        where: { id: p.id },
        data: matches
          ? { ...base, status: 'PAID', paidAt: new Date(), failureReason: '' }
          : { ...base, status: 'UNDERPAID', failureReason: `PayPal captured ${capture.amount.value} ${capture.amount.currency_code}, not ${p.fiatAmount.toFixed(2)} ${p.fiatCurrency}.` },
      });
    }
    if (capture?.status === 'PENDING') return this.prisma.payment.update({ where: { id: p.id }, data: { ...base, status: 'CONFIRMING', failureReason: 'PayPal is still processing this payment.' } });
    return this.prisma.payment.update({ where: { id: p.id }, data: { ...base, status: 'FAILED', failureReason: `PayPal reported the payment as ${capture?.status ?? order.status}.` } });
  }

  /* ---------------- Checking ---------------- */

  private assertOpen(p: Payment) {
    if (p.status === 'PAID') throw new ConflictException('This payment has already been completed');
    if (p.status === 'CONFIRMING') throw new ConflictException('A payment is already being confirmed');
  }

  /**
   * Brings a payment up to date with the chain or PayPal. Called when the payer's page polls and
   * when an admin presses Re-check, so no background job is needed.
   */
  async refresh(p: Payment, force = false): Promise<Payment> {
    return this.settle(await this.check(p, force));
  }

  /**
   * A paid event-package payment confirms its registration. Only a pending one: if staff
   * cancelled it meanwhile, they decide what happens (the payment shows as paid either way).
   */
  private async settle(p: Payment): Promise<Payment> {
    if (p.status === 'PAID' && p.registrationId) {
      await this.prisma.eventRegistration.updateMany({ where: { id: p.registrationId, status: 'PENDING' }, data: { status: 'CONFIRMED' } });
    }
    return p;
  }

  private async check(p: Payment, force: boolean): Promise<Payment> {
    if (p.status === 'PENDING' && p.method === 'CRYPTO' && p.quoteExpiresAt && p.quoteExpiresAt < new Date() && !p.txHash) {
      return this.prisma.payment.update({ where: { id: p.id }, data: { status: 'EXPIRED', failureReason: 'The price quote expired before a transaction was submitted.' } });
    }
    if (p.status !== 'CONFIRMING') return p;
    if (!force && p.lastCheckedAt && Date.now() - p.lastCheckedAt.getTime() < CHECK_INTERVAL_MS) return p;

    if (p.method === 'PAYPAL') {
      const c = paypalConfig();
      if (!c || !p.paypalOrderId) return p;
      try {
        return await this.applyPaypal(p, await getOrder(c, p.paypalOrderId));
      } catch (e) {
        this.log.warn(`PayPal check failed: ${(e as Error).message}`);
        return this.prisma.payment.update({ where: { id: p.id }, data: { lastCheckedAt: new Date() } });
      }
    }

    const found = p.network && p.asset ? findAsset(p.network, p.asset) : null;
    if (!found || !p.txHash || !p.payToAddress || !p.expectedRaw) return p;
    let v;
    try {
      v = await verifyTransaction(found.network, found.asset, p.payToAddress, p.txHash);
    } catch (e) {
      // The chain service was unreachable: stay in CONFIRMING and try again on the next check.
      this.log.warn(`Chain check failed for ${p.id}: ${(e as Error).message}`);
      return this.prisma.payment.update({ where: { id: p.id }, data: { lastCheckedAt: new Date() } });
    }
    const now = new Date();
    if (v.state === 'notfound') {
      const waited = now.getTime() - (p.submittedAt ?? p.updatedAt).getTime();
      if (waited > NOT_FOUND_GIVE_UP_MS) {
        return this.prisma.payment.update({ where: { id: p.id }, data: { status: 'FAILED', lastCheckedAt: now, failureReason: `The transaction could not be found on ${found.network.name}. Check that the ID is right and that it was sent on this network.` } });
      }
      return this.prisma.payment.update({ where: { id: p.id }, data: { lastCheckedAt: now, failureReason: `Waiting for the transaction to appear on ${found.network.name}…` } });
    }
    if (v.state === 'failed') {
      return this.prisma.payment.update({ where: { id: p.id }, data: { status: 'FAILED', lastCheckedAt: now, failureReason: v.reason } });
    }

    const data: Prisma.PaymentUpdateInput = { payerWallet: v.payer, receivedRaw: v.receivedRaw.toString(), confirmations: v.confirmations, lastCheckedAt: now };
    const expected = BigInt(p.expectedRaw);
    if (v.timestamp && v.timestamp.getTime() < p.createdAt.getTime() - EARLIEST_TX_MS) {
      return this.prisma.payment.update({ where: { id: p.id }, data: { ...data, status: 'FAILED', failureReason: 'This transaction was sent before the payment was started, so it cannot be used for it.' } });
    }
    if (!v.final) {
      return this.prisma.payment.update({ where: { id: p.id }, data: { ...data, failureReason: `Waiting for confirmations (${v.confirmations} of ${found.network.confirmations}).` } });
    }
    const received = formatUnits(v.receivedRaw, found.asset.decimals);
    if (v.receivedRaw === 0n) {
      return this.prisma.payment.update({ where: { id: p.id }, data: { ...data, status: 'FAILED', failureReason: `This transaction didn't send ${found.asset.symbol} to CICC's ${found.network.name} address.` } });
    }
    if (p.quoteExpiresAt && v.timestamp && v.timestamp.getTime() > p.quoteExpiresAt.getTime() + LATE_TX_MS) {
      return this.prisma.payment.update({ where: { id: p.id }, data: { ...data, status: 'UNDERPAID', failureReason: `${received} ${found.asset.symbol} arrived after the price quote expired. Please contact support to complete this payment.` } });
    }
    if (!isEnough(v.receivedRaw, expected)) {
      return this.prisma.payment.update({ where: { id: p.id }, data: { ...data, status: 'UNDERPAID', failureReason: `Received ${received} ${found.asset.symbol}, less than the ${p.expectedAmount} ${found.asset.symbol} due.` } });
    }
    return this.prisma.payment.update({ where: { id: p.id }, data: { ...data, status: 'PAID', paidAt: now, failureReason: '' } });
  }

  /** What the payer's page sees. Never includes the secret or internal ids beyond its own. */
  view(p: Payment) {
    const found = p.network && p.asset ? findAsset(p.network, p.asset) : null;
    return {
      id: p.id,
      reference: paymentRef(p.reference),
      status: p.status,
      email: p.email,
      name: p.name,
      purpose: p.purpose,
      externalRef: p.externalRef,
      forRegistration: !!p.registrationId,
      amount: p.fiatAmount.toFixed(2),
      currency: p.fiatCurrency,
      method: p.method,
      network: p.network,
      networkName: found?.network.name ?? null,
      asset: p.asset,
      cryptoAmount: p.expectedAmount,
      cryptoAmountRaw: p.expectedRaw,
      decimals: found?.asset.decimals ?? null,
      contract: found?.asset.contract ?? null,
      chainId: found?.network.chainId ?? null,
      payTo: p.payToAddress,
      quoteExpiresAt: p.quoteExpiresAt,
      txHash: p.txHash,
      explorerUrl: found && p.txHash ? found.network.explorerTx.replace('{tx}', p.txHash) : null,
      confirmations: p.confirmations,
      requiredConfirmations: found?.network.confirmations ?? null,
      payerWallet: p.payerWallet,
      received: found && p.receivedRaw ? formatUnits(BigInt(p.receivedRaw), found.asset.decimals) : null,
      message: p.failureReason,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    };
  }

  /* ---------------- Admin ---------------- */

  async adminList() {
    const rows = await this.prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 2000 });
    return rows.map((p) => ({ ...this.view(p), paypalOrderId: p.paypalOrderId, paypalCaptureId: p.paypalCaptureId, paypalPayerEmail: p.paypalPayerEmail, notes: p.notes, quotePrice: p.quotePrice, updatedAt: p.updatedAt }));
  }

  async adminRecheck(id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Payment not found');
    // An admin can re-open a failed or underpaid crypto payment, e.g. after more confirmations or a support case.
    const reopened = p.txHash && ['FAILED', 'UNDERPAID'].includes(p.status) ? await this.prisma.payment.update({ where: { id }, data: { status: 'CONFIRMING' } }) : p;
    return this.view(await this.refresh(reopened, true));
  }
}
