/**
 * JSON-RPC to a Bitcoin Cash node: the local node, for making blocks and
 * moving its clock, and a chipnet node, for trying a transaction without
 * sending it.
 */

export interface NodeRpcSettings {
  /** For example `http://127.0.0.1:18443/`. */
  url: string;
  user: string;
  password: string;
}

export type NodeRpc = <T = unknown>(method: string, ...parameters: unknown[]) => Promise<T>;

export const nodeRpc = ({ url, user, password }: NodeRpcSettings): NodeRpc => {
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  return async <T>(method: string, ...parameters: unknown[]): Promise<T> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authorization },
      body: JSON.stringify({ id: 1, method, params: parameters }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let body: { result?: T; error?: { message: string } | null };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(`${method}: the node answered HTTP ${response.status} without a result.`);
    }
    if (body.error !== undefined && body.error !== null) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  };
};

/** Whether the node would take the transaction into its mempool. Nothing is sent. */
export const testMempoolAccept = async (rpc: NodeRpc, transactionHex: string): Promise<{ allowed: true } | { allowed: false; reason: string }> => {
  const [verdict] = await rpc<{ allowed: boolean; 'reject-reason'?: string }[]>('testmempoolaccept', [transactionHex]);
  if (verdict === undefined) throw new Error('testmempoolaccept: the node gave no verdict.');
  return verdict.allowed ? { allowed: true } : { allowed: false, reason: verdict['reject-reason'] ?? 'no reason given' };
};

/** The settings in a node's `bitcoin.conf`, read as `key=value` lines. */
export const settingsFromBitcoinConf = (text: string): NodeRpcSettings => {
  const entries = new Map(
    text
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line): [string, string] => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );
  const need = (key: string): string => {
    const value = entries.get(key);
    if (value === undefined) throw new Error(`The node's configuration has no ${key}.`);
    return value;
  };
  return { url: `http://127.0.0.1:${need('rpcport')}/`, user: need('rpcuser'), password: need('rpcpassword') };
};
