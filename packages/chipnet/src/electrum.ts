import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import { ElectrumClient, type ElectrumClientEvents } from '@electrum-cash/network';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';

/**
 * A minimal Electrum connection for the chipnet run: unspent outputs for a
 * script, transaction lookup, broadcast, and chain tip.
 */

export interface UnspentEntry {
  transactionId: string;
  index: number;
  valueSatoshis: bigint;
  /** 0 while unconfirmed. */
  height: number;
  hasToken: boolean;
}

export type BroadcastResult = { accepted: true; transactionId: string } | { accepted: false; reason: string };

export interface ChainTip {
  height: number;
  /** Block timestamp from the header, Unix seconds. */
  time: number;
}

const APPLICATION = 'grandmas-wallet-chipnet';
const PROTOCOL_VERSION = '1.4.1';
const TIMEOUT_MS = 30_000;

/** Electrum addresses scripts by the reversed SHA-256 of their locking bytecode. */
export const scriptHash = (lockingBytecode: Uint8Array): string => binToHex(sha256.hash(lockingBytecode).reverse());

const headerTime = (headerHex: string): number => {
  const header = hexToBin(headerHex);
  return new DataView(header.buffer, header.byteOffset).getUint32(68, true);
};

export class Electrum {
  private constructor(
    private readonly client: ElectrumClient<ElectrumClientEvents>,
    readonly endpoint: string,
  ) {}

  /** @param endpoint - `tcp://host:port`, `ssl://host:port`, `ws://host:port` or `wss://host:port` */
  static async connect(endpoint: string): Promise<Electrum> {
    const url = new URL(endpoint);
    const scheme = url.protocol.replace(':', '');
    // The URL parser drops a port that is the default for its scheme (443 for wss, 80 for ws).
    const defaults: Record<string, number> = { wss: 443, ws: 80, ssl: 50002, tls: 50002, tcp: 50001 };
    const port = url.port === '' ? (defaults[scheme] ?? 0) : Number(url.port);
    if (!['tcp', 'ssl', 'tls', 'ws', 'wss'].includes(scheme) || !Number.isInteger(port) || port <= 0) {
      throw new Error(`Endpoint must look like ssl://host:port (tcp, ssl, ws or wss), got "${endpoint}".`);
    }
    const encrypted = scheme === 'ssl' || scheme === 'tls' || scheme === 'wss';
    const client =
      scheme === 'ws' || scheme === 'wss'
        ? new ElectrumClient(APPLICATION, PROTOCOL_VERSION, new ElectrumWebSocket(url.hostname, { port, encrypted, timeoutInMilliSeconds: TIMEOUT_MS }))
        : new ElectrumClient(APPLICATION, PROTOCOL_VERSION, url.hostname, { port, encrypted, timeoutInMilliSeconds: TIMEOUT_MS });
    await client.connect();
    return new Electrum(client as ElectrumClient<ElectrumClientEvents>, endpoint);
  }

  get software(): string {
    return this.client.software;
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect(true);
  }

  /** A request whose failure is an error of this program, not an answer. */
  private async call<T>(method: string, ...parameters: (string | number | boolean)[]): Promise<T> {
    const response = await this.client.request(method, ...parameters);
    if (response instanceof Error) {
      throw new Error(`${method} failed: ${response.message}`);
    }
    return response as T;
  }

  async features(): Promise<Record<string, unknown>> {
    return this.call('server.features');
  }

  async relayFeePerKilobyte(): Promise<number> {
    return this.call('blockchain.relayfee');
  }

  async tip(): Promise<ChainTip> {
    const { height, hex } = await this.call<{ height: number; hex: string }>('blockchain.headers.get_tip');
    return { height, time: headerTime(hex) };
  }

  async headerTime(height: number): Promise<number> {
    return headerTime(await this.call<string>('blockchain.block.header', height));
  }

  async listUnspent(lockingBytecode: Uint8Array): Promise<UnspentEntry[]> {
    const entries = await this.call<
      { tx_hash: string; tx_pos: number; value: number; height: number; token_data?: unknown }[]
    >('blockchain.scripthash.listunspent', scriptHash(lockingBytecode));
    return entries.map((entry) => ({
      transactionId: entry.tx_hash,
      index: entry.tx_pos,
      valueSatoshis: BigInt(entry.value),
      height: entry.height,
      hasToken: entry.token_data !== undefined,
    }));
  }

  /** Every transaction that created or spent an output of the script; height is 0 or less while unconfirmed. */
  async getHistory(lockingBytecode: Uint8Array): Promise<{ transactionId: string; height: number }[]> {
    const entries = await this.call<{ tx_hash: string; height: number }[]>('blockchain.scripthash.get_history', scriptHash(lockingBytecode));
    return entries.map((entry) => ({ transactionId: entry.tx_hash, height: entry.height }));
  }

  /** The raw transaction, or `undefined` if the server does not know it. */
  async getTransaction(transactionId: string): Promise<string | undefined> {
    const response = await this.client.request('blockchain.transaction.get', transactionId, false);
    return response instanceof Error ? undefined : (response as string);
  }

  /** Number of confirmations, 0 while in the mempool, `undefined` if unknown to the server. */
  async confirmations(transactionId: string): Promise<number | undefined> {
    const response = await this.client.request('blockchain.transaction.get', transactionId, true);
    if (response instanceof Error) return undefined;
    return (response as { confirmations?: number }).confirmations ?? 0;
  }

  /** Submit a transaction. A refusal by the network is returned, not thrown. */
  async broadcast(transactionHex: string): Promise<BroadcastResult> {
    const response = await this.client.request('blockchain.transaction.broadcast', transactionHex);
    if (response instanceof Error) {
      return { accepted: false, reason: response.message };
    }
    return { accepted: true, transactionId: response as string };
  }
}
