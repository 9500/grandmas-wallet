// The engine pointed at a local regtest chain (node and Fulcrum under ~/.local/share/grandmas-wallet/regtest).
// The engine knows mainnet, chipnet and testnet4 only; it is given chipnet's key and address settings and a
// server entry that describes the regtest chain.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { lockingBytecodeToCashAddress, hexToBin } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';
import { mnemonicFor } from './common.mjs';

const INSTANCE = process.env.REGTEST_INSTANCE ?? '1';
const dir = `${homedir()}/.local/share/grandmas-wallet/regtest`;
const conf = Object.fromEntries(
  readFileSync(`${dir}/node${INSTANCE === '1' ? '' : INSTANCE}/bitcoin.conf`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((p) => p.trim())),
);
const wsPort = Number(/ws = 127\.0\.0\.1:(\d+)/.exec(readFileSync(`${dir}/fulcrum${INSTANCE === '1' ? '' : INSTANCE}/fulcrum.conf`, 'utf8'))[1]);

export const rpc = async (method, ...params) => {
  const response = await fetch(`http://127.0.0.1:${conf.rpcport}/`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${conf.rpcuser}:${conf.rpcpassword}`).toString('base64') },
    body: JSON.stringify({ id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
};

export const regtestAddress = (lockingBytecodeHex) => lockingBytecodeToCashAddress({ prefix: 'bchreg', bytecode: hexToBin(lockingBytecodeHex) }).address;
/** Mine blocks whose reward goes to a locking script; returns the block hashes. */
export const mine = (count, lockingBytecodeHex) => rpc('generatetoaddress', count, regtestAddress(lockingBytecodeHex));
export const BURN = '76a914' + '00'.repeat(20) + '88ac';

const REGTEST_TARGET = BigInt('0x7fffff' + '00'.repeat(29));
const genesis = { height: 0, blockHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206', merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b' };
const electrum = (method, ...params) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onmessage = (message) => { const body = JSON.parse(message.data); socket.close(); body.error ? reject(new Error(body.error.message)) : resolve(body.result); };
    socket.onerror = () => reject(new Error('local Electrum server not reachable'));
  });

/**
 * The engine connects to listed servers over TLS only, so it is handed a plain WebSocket to the local server.
 * It also needs a checkpoint above the genesis block: block 1 of this chain, with the root the server gives for it.
 */
export const regtestServers = async () => {
  const blockHash = await rpc('getblockhash', 1);
  const { root } = await electrum('blockchain.block.header', 1, 1);
  return [{
    electrumSocket: new ElectrumWebSocket('127.0.0.1', { port: wsPort, encrypted: false }),
    blockchain: {
      genesis,
      checkpoint: { height: 1, blockHash, merkleRoot: root },
      difficultyParameters: {
        minimumDifficultyTarget: REGTEST_TARGET, allowMinimumDifficultyBlocks: true, difficultyAlgorithm: 'aserti3-2d',
        asertActivationHeight: 1, asertAnchoredBlockHeight: 0, asertAnchoredTarget: REGTEST_TARGET,
        asertAnchoredParentTimestamp: 1296688602, asertHalfLifeInSeconds: 3600, asertIdealBlockTimeSchedule: [{ fromHeight: 0, idealBlockTimeInSeconds: 600 }],
      },
    },
  }];
};

export const openEngineRegtest = async (account, extra = {}) =>
  Engine.create(mnemonicFor(account), { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers: await regtestServers(), ...extra });
