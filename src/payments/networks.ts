/**
 * Every network and coin the payment page offers. A network appears only when its receiving address
 * is configured (PAYMENT_ADDRESS_EVM covers all EVM chains). Token contracts were checked on-chain
 * (symbol and decimals) on 22 November 2026.
 */
export type NetworkKind = 'evm' | 'utxo' | 'solana' | 'tron' | 'xrp';

export interface Asset {
  symbol: string;
  name: string;
  decimals: number;
  /** Decimals shown to the payer; the quote is rounded up to this. */
  displayDecimals: number;
  /** CoinGecko id, for the price. */
  priceId: string;
  /** Token contract (EVM, Tron) or mint (Solana). Absent for the network's own coin. */
  contract?: string;
}

export interface Network {
  id: string;
  name: string;
  kind: NetworkKind;
  /** EVM chain id. */
  chainId?: number;
  /** Address env var. */
  addressEnv: string;
  rpcUrl: string;
  /** Explorer transaction URL, with {tx} for the hash. */
  explorerTx: string;
  /** How many confirmations make a payment final. */
  confirmations: number;
  assets: Asset[];
  /** BlockCypher coin path for UTXO chains. */
  blockcypher?: string;
}

const usdt = (contract: string, decimals = 6): Asset => ({ symbol: 'USDT', name: 'Tether USD', decimals, displayDecimals: 2, priceId: 'tether', contract });
const usdc = (contract: string, decimals = 6): Asset => ({ symbol: 'USDC', name: 'USD Coin', decimals, displayDecimals: 2, priceId: 'usd-coin', contract });
const eth: Asset = { symbol: 'ETH', name: 'Ether', decimals: 18, displayDecimals: 6, priceId: 'ethereum' };

export const NETWORKS: Network[] = [
  {
    id: 'ethereum', name: 'Ethereum', kind: 'evm', chainId: 1, addressEnv: 'PAYMENT_ADDRESS_EVM',
    rpcUrl: 'https://ethereum-rpc.publicnode.com', explorerTx: 'https://etherscan.io/tx/{tx}', confirmations: 3,
    assets: [eth, usdt('0xdAC17F958D2ee523a2206206994597C13D831ec7'), usdc('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')],
  },
  {
    id: 'bsc', name: 'BNB Smart Chain', kind: 'evm', chainId: 56, addressEnv: 'PAYMENT_ADDRESS_EVM',
    rpcUrl: 'https://bsc-rpc.publicnode.com', explorerTx: 'https://bscscan.com/tx/{tx}', confirmations: 5,
    assets: [
      { symbol: 'BNB', name: 'BNB', decimals: 18, displayDecimals: 5, priceId: 'binancecoin' },
      usdt('0x55d398326f99059fF775485246999027B3197955', 18),
      usdc('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18),
    ],
  },
  {
    id: 'polygon', name: 'Polygon', kind: 'evm', chainId: 137, addressEnv: 'PAYMENT_ADDRESS_EVM',
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com', explorerTx: 'https://polygonscan.com/tx/{tx}', confirmations: 10,
    assets: [
      { symbol: 'POL', name: 'Polygon', decimals: 18, displayDecimals: 3, priceId: 'polygon-ecosystem-token' },
      usdt('0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
      usdc('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
    ],
  },
  {
    id: 'arbitrum', name: 'Arbitrum One', kind: 'evm', chainId: 42161, addressEnv: 'PAYMENT_ADDRESS_EVM',
    rpcUrl: 'https://arb1.arbitrum.io/rpc', explorerTx: 'https://arbiscan.io/tx/{tx}', confirmations: 3,
    assets: [eth, usdt('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'), usdc('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')],
  },
  {
    id: 'optimism', name: 'Optimism', kind: 'evm', chainId: 10, addressEnv: 'PAYMENT_ADDRESS_EVM',
    rpcUrl: 'https://mainnet.optimism.io', explorerTx: 'https://optimistic.etherscan.io/tx/{tx}', confirmations: 3,
    assets: [eth, usdt('0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'), usdc('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85')],
  },
  {
    // Base has no Tether-issued USDT, only bridged copies, so USDC is the only stablecoin offered.
    id: 'base', name: 'Base', kind: 'evm', chainId: 8453, addressEnv: 'PAYMENT_ADDRESS_EVM',
    rpcUrl: 'https://base-rpc.publicnode.com', explorerTx: 'https://basescan.org/tx/{tx}', confirmations: 3,
    assets: [eth, usdc('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')],
  },
  {
    id: 'avalanche', name: 'Avalanche C-Chain', kind: 'evm', chainId: 43114, addressEnv: 'PAYMENT_ADDRESS_EVM',
    rpcUrl: 'https://avalanche-c-chain-rpc.publicnode.com', explorerTx: 'https://snowtrace.io/tx/{tx}', confirmations: 2,
    assets: [
      { symbol: 'AVAX', name: 'Avalanche', decimals: 18, displayDecimals: 4, priceId: 'avalanche-2' },
      usdt('0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'),
      usdc('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'),
    ],
  },
  {
    id: 'bitcoin', name: 'Bitcoin', kind: 'utxo', addressEnv: 'PAYMENT_ADDRESS_BTC', blockcypher: 'btc/main',
    rpcUrl: 'https://api.blockcypher.com/v1', explorerTx: 'https://mempool.space/tx/{tx}', confirmations: 2,
    assets: [{ symbol: 'BTC', name: 'Bitcoin', decimals: 8, displayDecimals: 8, priceId: 'bitcoin' }],
  },
  {
    id: 'litecoin', name: 'Litecoin', kind: 'utxo', addressEnv: 'PAYMENT_ADDRESS_LTC', blockcypher: 'ltc/main',
    rpcUrl: 'https://api.blockcypher.com/v1', explorerTx: 'https://litecoinspace.org/tx/{tx}', confirmations: 4,
    assets: [{ symbol: 'LTC', name: 'Litecoin', decimals: 8, displayDecimals: 6, priceId: 'litecoin' }],
  },
  {
    id: 'dogecoin', name: 'Dogecoin', kind: 'utxo', addressEnv: 'PAYMENT_ADDRESS_DOGE', blockcypher: 'doge/main',
    rpcUrl: 'https://api.blockcypher.com/v1', explorerTx: 'https://blockchair.com/dogecoin/transaction/{tx}', confirmations: 6,
    assets: [{ symbol: 'DOGE', name: 'Dogecoin', decimals: 8, displayDecimals: 2, priceId: 'dogecoin' }],
  },
  {
    id: 'solana', name: 'Solana', kind: 'solana', addressEnv: 'PAYMENT_ADDRESS_SOL',
    rpcUrl: 'https://api.mainnet-beta.solana.com', explorerTx: 'https://solscan.io/tx/{tx}', confirmations: 1,
    assets: [
      { symbol: 'SOL', name: 'Solana', decimals: 9, displayDecimals: 5, priceId: 'solana' },
      usdc('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      usdt('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
    ],
  },
  {
    id: 'tron', name: 'Tron', kind: 'tron', addressEnv: 'PAYMENT_ADDRESS_TRON',
    rpcUrl: 'https://api.trongrid.io', explorerTx: 'https://tronscan.org/#/transaction/{tx}', confirmations: 20,
    assets: [
      { symbol: 'TRX', name: 'Tron', decimals: 6, displayDecimals: 2, priceId: 'tron' },
      usdt('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
    ],
  },
  {
    id: 'xrp', name: 'XRP Ledger', kind: 'xrp', addressEnv: 'PAYMENT_ADDRESS_XRP',
    rpcUrl: 'https://xrplcluster.com', explorerTx: 'https://livenet.xrpl.org/transactions/{tx}', confirmations: 1,
    assets: [{ symbol: 'XRP', name: 'XRP', decimals: 6, displayDecimals: 4, priceId: 'ripple' }],
  },
];

/** Configured receiving address for a network, or '' when that network isn't offered. */
export function payToAddress(network: Network, env: NodeJS.ProcessEnv = process.env): string {
  return (env[network.addressEnv] ?? '').trim();
}

/** RPC override per network, e.g. RPC_URL_ETHEREUM, for a paid provider with higher limits. */
export function rpcUrl(network: Network, env: NodeJS.ProcessEnv = process.env): string {
  return (env[`RPC_URL_${network.id.toUpperCase()}`] ?? '').trim() || network.rpcUrl;
}

export function findAsset(networkId: string, symbol: string) {
  const network = NETWORKS.find((n) => n.id === networkId);
  const asset = network?.assets.find((a) => a.symbol === symbol);
  return network && asset ? { network, asset } : null;
}

const FORMATS: Record<NetworkKind, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  utxo: /^[a-zA-Z0-9]{25,90}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  xrp: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
};

/** Catches a mistyped address at boot, before anyone pays to it. */
export function invalidAddresses(env: NodeJS.ProcessEnv = process.env): string[] {
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const n of NETWORKS) {
    if (seen.has(n.addressEnv)) continue;
    seen.add(n.addressEnv);
    const address = payToAddress(n, env);
    if (address && !FORMATS[n.kind].test(address)) bad.push(n.addressEnv);
  }
  return bad;
}

/** Normalises a transaction id so the same transaction can't be submitted twice in a different case. */
export function normaliseTxHash(network: Network, hash: string): string | null {
  const h = hash.trim();
  if (network.kind === 'evm') return /^0x[0-9a-fA-F]{64}$/.test(h) ? h.toLowerCase() : null;
  if (network.kind === 'utxo' || network.kind === 'tron') return /^(0x)?[0-9a-fA-F]{64}$/.test(h) ? h.replace(/^0x/, '').toLowerCase() : null;
  if (network.kind === 'xrp') return /^[0-9a-fA-F]{64}$/.test(h) ? h.toUpperCase() : null;
  return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(h) ? h : null;
}
