import { Account } from '@grandmas-wallet/app';
import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';
import { Engine, XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork } from '@xo-cash/engine';

import type { Environment } from './environment.js';

/**
 * The XO engine account of a page: the keys of one set of twelve words, held in this browser.
 *
 * The engine is given one server: the first of the configured ones that answers. With several it takes the
 * first answer to a request for a new block's header, and a server that has not seen the block yet can
 * answer first, with nothing, which ends the engine's work. A server that is down or refuses a new
 * connection, as one at its limit of connections does, is passed over when the account is opened; the page
 * is loaded again to change server later. Reading the chain for the wallet's own decisions goes through all
 * configured servers (`connectChain`), not through the engine.
 *
 * Only one engine can be open in a page. A page that needs another account loads again.
 */

/** The parameters of a local regtest chain, for an engine that knows the public networks only. */
const REGTEST_TARGET = BigInt(`0x7fffff${'00'.repeat(29)}`);
const REGTEST_GENESIS = { height: 0, blockHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206', merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b' };

const parse = (endpoint: string): { host: string; port: number; encrypted: boolean } => {
  const url = new URL(endpoint);
  const encrypted = url.protocol === 'wss:';
  return { host: url.hostname, port: url.port === '' ? (encrypted ? 443 : 80) : Number(url.port), encrypted };
};

/** The first of the configured servers that takes a connection now. */
const firstAnswering = async (endpoints: string[]): Promise<string> => {
  if (endpoints.length === 0) throw new Error('This site is not configured: no server of the network is named.');
  for (const endpoint of endpoints) {
    try {
      const server = await Electrum.connect(endpoint);
      await server.disconnect();
      return endpoint;
    } catch {
      // the next one
    }
  }
  throw new Error('None of the network\'s servers could be reached. Check the connection and reload.');
};

/** The server entry the engine is created with. */
const engineServers = async (environment: Environment): Promise<unknown[]> => {
  const endpoint = await firstAnswering(environment.chain);
  const { host, port, encrypted } = parse(endpoint);
  if (environment.network === 'regtest') {
    // The engine connects to listed servers over TLS only, so it is handed a prepared socket. It also needs a
    // checkpoint above the genesis block: block 1 of this chain, with the root the server gives for it.
    const server = await Electrum.connect(endpoint);
    const checkpoint = await server.checkpoint(1);
    await server.disconnect();
    return [
      {
        electrumSocket: new ElectrumWebSocket(host, { port, encrypted }),
        blockchain: {
          genesis: REGTEST_GENESIS,
          checkpoint,
          difficultyParameters: {
            minimumDifficultyTarget: REGTEST_TARGET,
            allowMinimumDifficultyBlocks: true,
            difficultyAlgorithm: 'aserti3-2d',
            asertActivationHeight: 1,
            asertAnchoredBlockHeight: 0,
            asertAnchoredTarget: REGTEST_TARGET,
            asertAnchoredParentTimestamp: 1296688602,
            asertHalfLifeInSeconds: 3600,
            asertIdealBlockTimeInSeconds: 600,
          },
        },
      },
    ];
  }
  const [known] = resolveElectrumServersForNetwork(XO_SUPPORTED_NETWORKS.chipnet);
  if (known === undefined) throw new Error('The engine names no server for this network.');
  if (!encrypted) throw new Error('The engine connects to a public server over an encrypted connection only.');
  return [{ host, version: known.version, transports: { wss: port }, blockchain: known.blockchain }];
};

/**
 * Open the account of a set of twelve words. The engine keeps its state in this browser's database, apart
 * for each set of words. The account is ready when the engine's check of block headers has reached the tip.
 */
export const openAccount = async (words: string, environment: Environment): Promise<Account> => {
  const electrumServers = (await engineServers(environment)) as NonNullable<Parameters<typeof Engine.create>[1]>['electrumServers'];
  return Account.open(await Engine.create(words, { network: XO_SUPPORTED_NETWORKS.chipnet, ...(electrumServers === undefined ? {} : { electrumServers }) }));
};

/** The network the wallet's keys and addresses are made for. A local chain uses the test network's. */
export const keyNetwork = (environment: Environment): 'mainnet' | 'testnet' => (environment.network === 'mainnet' ? 'mainnet' : 'testnet');
