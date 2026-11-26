import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findAsset, invalidAddresses, NETWORKS, normaliseTxHash } from '../src/payments/networks';
import { cryptoAmount, formatUnits, isEnough } from '../src/payments/quote';
import { tronFromHex, tronToHex } from '../src/payments/verifiers';

const asset = (n: string, s: string) => findAsset(n, s)!.asset;

test('stablecoin quote rounds up to whole cents', () => {
  // 250 EUR at 0.93 EUR per USDT = 268.817… → 268.82 USDT, never less
  const q = cryptoAmount('250.00', 0.93, asset('ethereum', 'USDT'));
  assert.equal(q.display, '268.82');
  assert.equal(q.raw, 268_820_000n);
});

test('18-decimal tokens keep their full precision', () => {
  const q = cryptoAmount('100', 1, asset('bsc', 'USDT'));
  assert.equal(q.raw, 100n * 10n ** 18n);
  assert.equal(q.display, '100');
});

test('native coin quote: ETH to 6 decimals, rounded up', () => {
  // 500 EUR at 2,987.65 EUR/ETH: 0.167355 ETH is worth 499.998, so the quote must be 0.167356
  const q = cryptoAmount('500.00', 2987.65, asset('ethereum', 'ETH'));
  assert.equal(q.display, '0.167356');
  assert.equal(q.raw, 167_356_000_000_000_000n);
  assert.ok(0.167356 * 2987.65 >= 500 && 0.167355 * 2987.65 < 500);
});

test('BTC quote to the satoshi', () => {
  // The smallest number of satoshis worth at least 60,000 EUR
  const q = cryptoAmount('60000.00', 81234.5, asset('bitcoin', 'BTC'));
  assert.equal(q.raw, 73_860_245n);
  assert.equal(formatUnits(q.raw, 8), '0.73860245');
  assert.ok(0.73860245 * 81234.5 >= 60000 && 0.73860244 * 81234.5 < 60000);
});

test('tolerance: 0.5% short is accepted, more is not', () => {
  assert.ok(isEnough(995n, 1000n));
  assert.ok(isEnough(1200n, 1000n));
  assert.ok(!isEnough(994n, 1000n));
  assert.ok(!isEnough(0n, 1000n));
});

test('Tron addresses convert both ways and reject a bad checksum', () => {
  const hex = tronToHex('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  assert.equal(hex, '41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
  assert.equal(tronFromHex(hex), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  assert.throws(() => tronToHex('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'));
});

test('transaction ids are normalised so case changes cannot reuse one', () => {
  const eth = NETWORKS.find((n) => n.id === 'ethereum')!;
  const h = '0x' + 'AB'.repeat(32);
  assert.equal(normaliseTxHash(eth, h), h.toLowerCase());
  assert.equal(normaliseTxHash(eth, 'nope'), null);
  const btc = NETWORKS.find((n) => n.id === 'bitcoin')!;
  assert.equal(normaliseTxHash(btc, 'AB'.repeat(32)), 'ab'.repeat(32));
  const xrp = NETWORKS.find((n) => n.id === 'xrp')!;
  assert.equal(normaliseTxHash(xrp, 'ab'.repeat(32)), 'AB'.repeat(32));
});

test('mistyped receiving addresses are caught at boot', () => {
  assert.deepEqual(invalidAddresses({ PAYMENT_ADDRESS_EVM: '0x1234', PAYMENT_ADDRESS_TRON: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }), ['PAYMENT_ADDRESS_EVM']);
  assert.deepEqual(invalidAddresses({}), []);
});
