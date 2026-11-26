import { createHash } from 'node:crypto';
import { Asset, Network, rpcUrl } from './networks';

/**
 * Reads a transaction from its blockchain and reports what it paid to our address. Nothing here
 * trusts the browser: the amount, recipient and payer all come from the chain itself.
 */
export type Verification =
  | { state: 'notfound' }
  | { state: 'failed'; reason: string }
  | { state: 'found'; payer: string; receivedRaw: bigint; confirmations: number; final: boolean; timestamp?: Date };

const TIMEOUT = 20_000;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Responses are checked field by field below, so they're read loosely here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

async function jsonRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const body = await postJson(url, { jsonrpc: '2.0', id: 1, method, params });
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result as T;
}

const sameEvm = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const topicFor = (address: string) => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;

async function verifyEvm(network: Network, asset: Asset, payTo: string, hash: string): Promise<Verification> {
  const url = rpcUrl(network);
  const tx = await jsonRpc<{ from: string; to: string | null; value: string; blockNumber: string | null; chainId?: string } | null>(url, 'eth_getTransactionByHash', [hash]);
  if (!tx) return { state: 'notfound' };
  if (tx.chainId && Number(tx.chainId) !== network.chainId) return { state: 'failed', reason: `This transaction is on another network, not ${network.name}.` };
  const receipt = await jsonRpc<{ status: string; blockNumber: string; logs: { address: string; topics: string[]; data: string }[] } | null>(url, 'eth_getTransactionReceipt', [hash]);
  if (!receipt) return { state: 'found', payer: tx.from, receivedRaw: 0n, confirmations: 0, final: false };
  if (receipt.status !== '0x1') return { state: 'failed', reason: 'The transaction failed on the blockchain (reverted), so no funds were sent.' };

  let received = 0n;
  if (!asset.contract) {
    if (sameEvm(tx.to, payTo)) received = BigInt(tx.value);
  } else {
    for (const log of receipt.logs) {
      if (sameEvm(log.address, asset.contract) && log.topics[0] === TRANSFER_TOPIC && log.topics[2]?.toLowerCase() === topicFor(payTo)) {
        received += BigInt(log.data);
      }
    }
  }
  const [latest, block] = await Promise.all([
    jsonRpc<string>(url, 'eth_blockNumber', []),
    jsonRpc<{ timestamp: string }>(url, 'eth_getBlockByNumber', [receipt.blockNumber, false]),
  ]);
  const confirmations = Number(BigInt(latest) - BigInt(receipt.blockNumber)) + 1;
  return {
    state: 'found',
    payer: tx.from,
    receivedRaw: received,
    confirmations,
    final: confirmations >= network.confirmations,
    timestamp: new Date(Number(BigInt(block.timestamp)) * 1000),
  };
}

async function verifyUtxo(network: Network, _asset: Asset, payTo: string, hash: string): Promise<Verification> {
  const token = process.env.BLOCKCYPHER_TOKEN ? `&token=${encodeURIComponent(process.env.BLOCKCYPHER_TOKEN)}` : '';
  const res = await fetch(`${rpcUrl(network)}/${network.blockcypher}/txs/${hash}?limit=500${token}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (res.status === 404) return { state: 'notfound' };
  if (!res.ok) throw new Error(`BlockCypher answered ${res.status}`);
  const tx = (await res.json()) as {
    inputs: { addresses?: string[] }[];
    outputs: { value: number; addresses?: string[] }[];
    confirmations: number;
    double_spend?: boolean;
    confirmed?: string;
    received?: string;
  };
  if (tx.double_spend) return { state: 'failed', reason: 'The network flagged this transaction as a double spend.' };
  const received = tx.outputs.filter((o) => o.addresses?.includes(payTo)).reduce((sum, o) => sum + BigInt(o.value), 0n);
  const confirmations = tx.confirmations ?? 0;
  return {
    state: 'found',
    payer: tx.inputs[0]?.addresses?.[0] ?? '',
    receivedRaw: received,
    confirmations,
    final: confirmations >= network.confirmations,
    timestamp: tx.confirmed ? new Date(tx.confirmed) : tx.received ? new Date(tx.received) : undefined,
  };
}

interface SolanaTx {
  blockTime: number | null;
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }[];
    postTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }[];
  } | null;
  transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[] } };
}

async function verifySolana(network: Network, asset: Asset, payTo: string, signature: string): Promise<Verification> {
  const url = rpcUrl(network);
  const tx = await jsonRpc<SolanaTx | null>(url, 'getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
  if (!tx || !tx.meta) return { state: 'notfound' };
  if (tx.meta.err) return { state: 'failed', reason: 'The transaction failed on the Solana network, so no funds were sent.' };
  const keys = tx.transaction.message.accountKeys;
  let received = 0n;
  if (!asset.contract) {
    const i = keys.findIndex((k) => k.pubkey === payTo);
    if (i >= 0) received = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
  } else {
    for (const post of tx.meta.postTokenBalances ?? []) {
      if (post.owner !== payTo || post.mint !== asset.contract) continue;
      const pre = tx.meta.preTokenBalances?.find((p) => p.accountIndex === post.accountIndex);
      received += BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? '0');
    }
  }
  const status = await jsonRpc<{ value: ({ confirmationStatus?: string } | null)[] }>(url, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  const final = status.value[0]?.confirmationStatus === 'finalized';
  return {
    state: 'found',
    payer: keys.find((k) => k.signer)?.pubkey ?? '',
    receivedRaw: received > 0n ? received : 0n,
    confirmations: final ? 1 : 0,
    final,
    timestamp: tx.blockTime ? new Date(tx.blockTime * 1000) : undefined,
  };
}

/* ---------- Tron: addresses are base58check of a 21-byte value that starts 0x41 ---------- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();

export function tronToHex(address: string): string {
  let n = 0n;
  for (const c of address) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('Invalid Tron address');
    n = n * 58n + BigInt(i);
  }
  const bytes = Buffer.from(n.toString(16).padStart(50, '0'), 'hex');
  const body = bytes.subarray(0, 21);
  if (!sha256(sha256(body)).subarray(0, 4).equals(bytes.subarray(21))) throw new Error('Invalid Tron address checksum');
  return body.toString('hex');
}

export function tronFromHex(hex: string): string {
  const body = Buffer.from(hex, 'hex');
  const full = Buffer.concat([body, sha256(sha256(body)).subarray(0, 4)]);
  let n = BigInt(`0x${full.toString('hex')}`);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of full) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

async function verifyTron(network: Network, asset: Asset, payTo: string, hash: string): Promise<Verification> {
  const url = rpcUrl(network);
  const headers = process.env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } : undefined;
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`TronGrid answered ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await res.json()) as any;
  };
  const tx = await call('/wallet/gettransactionbyid', { value: hash });
  if (!tx?.txID) return { state: 'notfound' };
  const info = await call('/wallet/gettransactioninfobyid', { value: hash });
  const contract = tx.raw_data?.contract?.[0];
  const payer = contract?.parameter?.value?.owner_address ? tronFromHex(contract.parameter.value.owner_address) : '';
  if (!info?.blockNumber) return { state: 'found', payer, receivedRaw: 0n, confirmations: 0, final: false };
  const result = tx.ret?.[0]?.contractRet;
  if (result && result !== 'SUCCESS') return { state: 'failed', reason: `The transaction failed on the Tron network (${result}).` };
  if (info.receipt?.result && info.receipt.result !== 'SUCCESS') return { state: 'failed', reason: `The transaction failed on the Tron network (${info.receipt.result}).` };

  const payToHex = tronToHex(payTo);
  let received = 0n;
  if (!asset.contract) {
    if (contract?.type === 'TransferContract' && contract.parameter.value.to_address?.toLowerCase() === payToHex) {
      received = BigInt(contract.parameter.value.amount);
    }
  } else {
    const tokenHex = tronToHex(asset.contract).slice(2);
    for (const log of info.log ?? []) {
      if (log.address?.toLowerCase() === tokenHex && `0x${log.topics?.[0]}` === TRANSFER_TOPIC && log.topics?.[2]?.slice(-40).toLowerCase() === payToHex.slice(2)) {
        received += BigInt(`0x${log.data}`);
      }
    }
  }
  const now = await call('/wallet/getnowblock', {});
  const confirmations = Number(now.block_header.raw_data.number) - Number(info.blockNumber) + 1;
  return {
    state: 'found',
    payer,
    receivedRaw: received,
    confirmations,
    final: confirmations >= network.confirmations,
    timestamp: info.blockTimeStamp ? new Date(Number(info.blockTimeStamp)) : undefined,
  };
}

/** Seconds between the Unix epoch and the XRP Ledger's epoch (1 Jan 2000). */
const RIPPLE_EPOCH = 946_684_800;

async function verifyXrp(network: Network, _asset: Asset, payTo: string, hash: string): Promise<Verification> {
  const body = await postJson(rpcUrl(network), { method: 'tx', params: [{ transaction: hash, binary: false }] });
  const r = body.result ?? {};
  if (r.error === 'txnNotFound') return { state: 'notfound' };
  if (r.error) throw new Error(`XRPL: ${r.error_message ?? r.error}`);
  const tx = r.tx_json ?? r;
  const meta = r.meta ?? {};
  if (tx.TransactionType !== 'Payment') return { state: 'failed', reason: 'This is not a payment transaction.' };
  if (meta.TransactionResult && meta.TransactionResult !== 'tesSUCCESS') return { state: 'failed', reason: `The payment failed on the XRP Ledger (${meta.TransactionResult}).` };
  const delivered = meta.delivered_amount ?? meta.DeliveredAmount;
  // A non-string amount is a token, not XRP.
  const received = tx.Destination === payTo && typeof delivered === 'string' ? BigInt(delivered) : 0n;
  const date = tx.date ?? r.date ?? r.close_time_iso;
  return {
    state: 'found',
    payer: tx.Account ?? '',
    receivedRaw: received,
    confirmations: r.validated ? 1 : 0,
    final: !!r.validated,
    timestamp: typeof date === 'number' ? new Date((date + RIPPLE_EPOCH) * 1000) : date ? new Date(date) : undefined,
  };
}

const VERIFIERS = { evm: verifyEvm, utxo: verifyUtxo, solana: verifySolana, tron: verifyTron, xrp: verifyXrp };

export function verifyTransaction(network: Network, asset: Asset, payTo: string, hash: string): Promise<Verification> {
  return VERIFIERS[network.kind](network, asset, payTo, hash);
}
