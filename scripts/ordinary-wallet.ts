// An ordinary wallet on the command line, for trying an application without a wallet app:
// it connects over WizardConnect, shares the public keys of its address chains and signs
// whatever it is asked to, printing each request's prompt.
//
// usage: node --import tsx scripts/ordinary-wallet.ts [--name ordinary]            print the address to fund
//        node --import tsx scripts/ordinary-wallet.ts [--name ordinary] <wiz://…>  connect and sign
//        node --import tsx scripts/ordinary-wallet.ts [--name ordinary] --sweep <address> [--server wss://…]  send every coin away
//
// The seed is kept in .xo-demo/ordinary/<name>.seed, so the same wallet returns each time.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { binToHex, cashAddressToLockingBytecode, decodeHdPublicKey, deriveHdPublicNodeChild, encodeCashAddress, encodeTransactionBch, hash160, hexToBin } from '@bitauth/libauth';
import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import { ordinaryWallet } from '@grandmas-wallet/testing';
import { readPaths, scanWallet } from '../apps/jar/src/plain.js';
import { PROTOCOL_NAME, RelayMsgAction, type RelayClient, chunkExtensionAdvertisement, initiateWalletRelay, peerSupportsChunk } from '@wizardconnect/core';

const args = process.argv.slice(2);
const nameAt = args.indexOf('--name');
const name = nameAt === -1 ? 'ordinary' : (args[nameAt + 1] ?? 'ordinary');
const uri = args.find((arg) => arg.toLowerCase().startsWith('wiz://'));

const directory = resolve('.xo-demo/ordinary');
mkdirSync(directory, { recursive: true });
const seedFile = resolve(directory, `${name}.seed`);
if (!existsSync(seedFile)) writeFileSync(seedFile, binToHex(crypto.getRandomValues(new Uint8Array(32))), { mode: 0o600 });
const seed = hexToBin(readFileSync(seedFile, 'utf8').trim());
const wallet = ordinaryWallet(seed, 'testnet');

const receive = decodeHdPublicKey(wallet.paths.find((path) => path.name === 'receive')?.xpub ?? '');
if (typeof receive === 'string') throw new Error(receive);
const first = deriveHdPublicNodeChild(receive.node, 0);
if (typeof first === 'string') throw new Error(first);
console.log(`Wallet "${name}" receives at ${encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: hash160(first.publicKey) }).address}`);

const sweepAt = args.indexOf('--sweep');
if (sweepAt !== -1) {
  // Every coin of the wallet to one address, less the fee.
  const destination = cashAddressToLockingBytecode(args[sweepAt + 1] ?? '');
  if (typeof destination === 'string') throw new Error(destination);
  const serverAt = args.indexOf('--server');
  const electrum = await Electrum.connect(serverAt === -1 ? 'wss://chipnet.imaginary.cash:50004' : (args[serverAt + 1] ?? ''));
  const { coins, balance } = await scanWallet({ ...electrum, getTransaction: (id) => electrum.getTransaction(id), getHistory: (script) => electrum.getHistory(script), listUnspent: (script) => electrum.listUnspent(script), broadcast: (hex) => electrum.broadcast(hex) }, readPaths(wallet.paths));
  if (coins.length === 0) throw new Error('The wallet holds no coins.');
  const fee = BigInt(10 + coins.length * 141 + 34 + 20);
  const transaction = {
    version: 2,
    locktime: 0,
    inputs: coins.map((coin) => ({ outpointTransactionHash: hexToBin(coin.transactionId), outpointIndex: coin.index, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() })),
    outputs: [{ lockingBytecode: destination.bytecode, valueSatoshis: balance - fee }],
  };
  const signed = wallet.sign({
    transaction: {
      transaction: binToHex(encodeTransactionBch(transaction)),
      sourceOutputs: coins.map((coin) => ({ lockingBytecode: binToHex(coin.lockingBytecode), valueSatoshis: `<bigint: ${coin.valueSatoshis}n>` })),
    },
    inputPaths: coins.map((coin, index) => [index, coin.path, coin.addressIndex]),
  });
  const sent = await electrum.broadcast(signed);
  console.log(sent.accepted ? `Sent ${balance - fee} sat (${sent.transactionId})` : `Refused: ${sent.reason}`);
  await electrum.disconnect();
  process.exit(sent.accepted ? 0 : 1);
}

if (uri === undefined) process.exit(0);

const seconds = (): number => Math.floor(Date.now() / 1000);
let client: RelayClient | undefined;
let listening = false;
let dappDiscovered = false;

const ready = async (): Promise<void> => {
  await client?.relay({
    action: RelayMsgAction.WalletReady,
    supported_protocols: [PROTOCOL_NAME],
    wallet_name: 'Ordinary wallet',
    wallet_icon: '',
    time: seconds(),
    dapp_discovered: dappDiscovered,
    session: { [PROTOCOL_NAME]: { paths: wallet.paths } },
    public_key: binToHex(relay.walletPublicKey),
    secret: relay.secret,
    extensions: { chunk: chunkExtensionAdvertisement() },
  } as Parameters<RelayClient['relay']>[0]);
};

const onMessage = (message: { action: string; [field: string]: unknown }): void => {
  if (message.action === RelayMsgAction.DappReady) {
    client?.setPeerCapabilities({ chunk: peerSupportsChunk(message['extensions'] as Record<string, unknown> | undefined) });
    if (message['wallet_discovered'] !== true) {
      void ready();
      return;
    }
    dappDiscovered = true;
    console.log(`Connected to "${String(message['dapp_name'] ?? 'an application')}"`);
  } else if (message.action === RelayMsgAction.SignTransactionRequest) {
    const sequence = message['sequence'] as number;
    try {
      const signedTransaction = wallet.sign(message as unknown as Parameters<typeof wallet.sign>[0]);
      console.log(`Signed: ${wallet.lastPrompt ?? '(no description)'}`);
      void client?.relay({ action: RelayMsgAction.SignTransactionResponse, time: seconds(), sequence, signedTransaction } as Parameters<RelayClient['relay']>[0]);
    } catch (error) {
      console.log(`Refused: ${(error as Error).message}`);
      void client?.relay({ action: RelayMsgAction.SignTransactionResponse, time: seconds(), sequence, signedTransaction: '', error: (error as Error).message } as Parameters<RelayClient['relay']>[0]);
    }
  } else if (message.action === RelayMsgAction.Ping) {
    void client?.relay({ action: RelayMsgAction.Pong, time: seconds() });
  } else if (message.action === RelayMsgAction.Disconnect) {
    console.log('The application disconnected.');
    process.exit(0);
  }
};

const relay = initiateWalletRelay(
  (payload) => {
    client = payload.client;
    if (!listening) {
      listening = true;
      payload.client.on('message', onMessage);
    }
    if (payload.status.status === 'connected') {
      dappDiscovered = false;
      void ready();
    }
  },
  { uri, walletPrivateKey: crypto.getRandomValues(new Uint8Array(32)) },
);
