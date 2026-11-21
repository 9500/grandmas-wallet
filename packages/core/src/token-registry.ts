import { binToUtf8 } from '@bitauth/libauth';

/**
 * What the wallet reads of a token's registry (Bitcoin Cash Metadata Registries, version 2): the publication an
 * authchain transaction carries, the registry file, and the rules for writing what it says. Pure: no network and
 * no chain. Whatever comes out of here is the issuer's claim; the wallet shows it and never acts on it.
 */

/** The start of a publication output: OP_RETURN, then a push of the four bytes `BCMR`. */
export const PUBLICATION_PREFIX = Uint8Array.of(0x6a, 0x04, 0x42, 0x43, 0x4d, 0x52);

/** A publication: the SHA-256 of the registry file, as the output carries it, and where the file may be had. */
export interface Publication {
  hash: Uint8Array;
  uris: string[];
}

/** The pushes of a script, or `undefined` if it holds anything other than pushes. */
const pushes = (bytecode: Uint8Array): Uint8Array[] | undefined => {
  const found: Uint8Array[] = [];
  let at = 0;
  while (at < bytecode.length) {
    const opcode = bytecode[at] as number;
    at += 1;
    let length: number;
    if (opcode === 0x00) length = 0;
    else if (opcode <= 0x4b) length = opcode;
    else if (opcode === 0x4c) {
      length = bytecode[at] ?? -1;
      at += 1;
    } else if (opcode === 0x4d) {
      length = at + 2 <= bytecode.length ? (bytecode[at] as number) | ((bytecode[at + 1] as number) << 8) : -1;
      at += 2;
    } else if (opcode === 0x4e) {
      length = at + 4 <= bytecode.length ? new DataView(bytecode.buffer, bytecode.byteOffset + at, 4).getUint32(0, true) : -1;
      at += 4;
    } else return undefined;
    if (length < 0 || at + length > bytecode.length) return undefined;
    found.push(bytecode.slice(at, at + length));
    at += length;
  }
  return found;
};

const startsWith = (bytes: Uint8Array, prefix: Uint8Array): boolean => bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/** Whether an output's script is a publication's, by its first bytes. */
export const isPublicationOutput = (lockingBytecode: Uint8Array): boolean => startsWith(lockingBytecode, PUBLICATION_PREFIX);

/**
 * The publication a transaction carries: its first output whose script starts as a publication's. `undefined` when
 * there is none, or when that output is not a hash of 32 bytes followed by addresses.
 */
export const readPublication = (outputs: { lockingBytecode: Uint8Array }[]): Publication | undefined => {
  const output = outputs.find(({ lockingBytecode }) => isPublicationOutput(lockingBytecode));
  if (output === undefined) return undefined;
  const found = pushes(output.lockingBytecode.slice(1));
  const [, hash, ...uris] = found ?? [];
  if (hash?.length !== 32) return undefined;
  return { hash, uris: uris.map((uri) => binToUtf8(uri)) };
};

const WELL_KNOWN = '/.well-known/bitcoin-cash-metadata-registry.json';

/**
 * Where to fetch the file a publication's address names: HTTPS, or `ipfs://` through the configured gateway. An
 * address without a scheme is HTTPS; a host without a path means the well-known path. Other schemes give nothing.
 */
export const registryUrl = (uri: string, ipfsGateway?: string): string | undefined => {
  const text = uri.trim();
  if (text.startsWith('ipfs://')) return ipfsGateway === undefined || ipfsGateway === '' ? undefined : `${ipfsGateway.replace(/\/?$/, '/')}${text.slice('ipfs://'.length)}`;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined;
  if (url.pathname === '/' && url.search === '' && !withScheme.replace(/^https:\/\//i, '').includes('/')) url.pathname = WELL_KNOWN;
  return url.toString();
};

/** The specification's rule for a token's symbol. */
export const SYMBOL_RULE = /^[A-Z0-9]+[-A-Z0-9]*$/;

/** What a checked registry says of one token category: the issuer's words. */
export interface RegistryToken {
  name: string;
  /** The symbol as the registry writes it. */
  symbol: string;
  decimals: number;
  /** The names of sequential NFT types, by commitment (hex). */
  nftTypes?: Record<string, string>;
}

export type RegistryReading = { ok: true; token: RegistryToken } | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The current snapshot of an identity: the one with the latest timestamp that has been reached, or the oldest when
 * none has. Keys that are not timestamps are left out.
 */
export const currentSnapshot = <T>(snapshots: Record<string, T>, nowMs: number): T | undefined => {
  const dated = Object.entries(snapshots)
    .map(([key, value]) => ({ at: Date.parse(key), value }))
    .filter(({ at }) => !Number.isNaN(at))
    .sort((a, b) => a.at - b.at);
  const reached = dated.filter(({ at }) => at <= nowMs);
  return (reached.length > 0 ? reached[reached.length - 1] : dated[0])?.value;
};

/**
 * What a registry file says of a category, after the checks of the specification that the wallet relies on: the
 * category's identity is there, its current snapshot names a token of this category, the symbol follows the rule and
 * the decimals are a whole number from 0 to 18. The file's hash is checked before this, by whoever fetched it.
 */
export const readRegistry = (text: string, category: string, nowMs: number): RegistryReading => {
  let registry: unknown;
  try {
    registry = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'The registry is not JSON.' };
  }
  if (!isRecord(registry) || !isRecord(registry.identities)) return { ok: false, reason: 'The registry has no identities.' };
  const snapshots = registry.identities[category];
  if (!isRecord(snapshots)) return { ok: false, reason: 'The registry does not describe this category.' };
  const snapshot = currentSnapshot(snapshots, nowMs);
  if (!isRecord(snapshot) || typeof snapshot.name !== 'string') return { ok: false, reason: 'The registry has no current name for this category.' };
  const token = snapshot.token;
  if (!isRecord(token)) return { ok: false, reason: 'The registry describes no token for this category.' };
  if (typeof token.category !== 'string' || token.category.toLowerCase() !== category.toLowerCase()) return { ok: false, reason: 'The registry names another category.' };
  if (typeof token.symbol !== 'string' || !SYMBOL_RULE.test(token.symbol)) return { ok: false, reason: 'The registry\'s symbol breaks the rule for symbols.' };
  const decimals = token.decimals ?? 0;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return { ok: false, reason: 'The registry\'s decimals are not a whole number from 0 to 18.' };
  const nftTypes: Record<string, string> = {};
  const parse = isRecord(token.nfts) && isRecord(token.nfts.parse) ? token.nfts.parse : undefined;
  // Sequential types only: a parse without bytecode keys its types by the commitment itself.
  if (parse !== undefined && parse.bytecode === undefined && isRecord(parse.types)) {
    for (const [commitment, type] of Object.entries(parse.types)) {
      if (/^([0-9a-f]{2})*$/.test(commitment) && isRecord(type) && typeof type.name === 'string') nftTypes[commitment] = cleanName(type.name, Infinity);
    }
  }
  return { ok: true, token: { name: cleanName(snapshot.name, Infinity), symbol: token.symbol, decimals, ...(Object.keys(nftTypes).length === 0 ? {} : { nftTypes }) } };
};

/** A name as plain text: its first line, without control characters, cut at `length` characters with an ellipsis. */
export const cleanName = (name: string, length = 20): string => {
  // eslint-disable-next-line no-control-regex
  const line = (name.split(/\r?\n/)[0] ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const characters = [...line];
  return characters.length > length ? `${characters.slice(0, length - 1).join('').trimEnd()}…` : line;
};

/** The symbol as it is shown: the part before the first hyphen. */
export const shownSymbol = (symbol: string): string => symbol.split('-')[0] ?? symbol;

/**
 * Symbols the specification reserves (public domain, from its repository): ISO 4217 currency codes, and the hundred
 * largest cryptocurrencies when it was published. A token whose shown symbol is one of them is shown as unknown.
 */
export const RESERVED_SYMBOLS: ReadonlySet<string> = new Set([
  // reserved-token-symbols-ISO-4217.json
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB',
  'BOV', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHE', 'CHF', 'CHW', 'CLF', 'CLP', 'COP', 'COU', 'CRC', 'CUC', 'CUP',
  'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ',
  'GYD', 'HKD', 'HNL', 'HRK', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF',
  'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU',
  'MUR', 'MVR', 'MWK', 'MXN', 'MXV', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR',
  'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'CNY', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP',
  'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'USN', 'UYI', 'UYU',
  'UYW', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XDR', 'XOF', 'XPD', 'XPF',
  'XPT', 'XSU', 'XTS', 'XUA', 'XXX', 'YER', 'ZAR', 'ZMW', 'ZWL',
  // reserved-token-symbols-cryptocurrencies.json
  '1INCH', 'AAVE', 'ADA', 'ALGO', 'APE', 'APT', 'ATOM', 'AVAX', 'AXS', 'BAT', 'BCH', 'BIT', 'BNB', 'BNX', 'BSV', 'BTC', 'BTT', 'BUSD',
  'CAKE', 'CHZ', 'COMP', 'CRO', 'CRV', 'CSPR', 'CVX', 'DAI', 'DASH', 'DCR', 'DOGE', 'DOT', 'EGLD', 'ENJ', 'ENS', 'EOS', 'ETC', 'ETH',
  'ETHW', 'FEI', 'FIL', 'FLOW', 'FTM', 'FTT', 'GRT', 'GT', 'HBAR', 'HNT', 'HOT', 'HT', 'ICP', 'KAVA', 'KCS', 'KLAY', 'LDO', 'LEO', 'LINK',
  'LRC', 'LTC', 'LUNC', 'MANA', 'MATIC', 'MINA', 'MIOTA', 'MKR', 'NEAR', 'NEO', 'NEXO', 'OKB', 'PAXG', 'QNT', 'RUNE', 'RVN', 'SAND',
  'SHIB', 'SNX', 'SOL', 'STX', 'THETA', 'TON', 'TRX', 'TUSD', 'TWT', 'UNI', 'USDC', 'USDD', 'USDN', 'USDP', 'USDT', 'USTC', 'VET', 'WAVES',
  'WBTC', 'XCN', 'XDC', 'XEC', 'XLM', 'XMR', 'XRP', 'XTZ', 'ZEC', 'ZIL',
]);

export const isReservedSymbol = (symbol: string): boolean => RESERVED_SYMBOLS.has(shownSymbol(symbol));
