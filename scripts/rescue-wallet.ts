// Returns everything a test wallet holds, and its unlocked savings jars, to an ordinary address, using this
// project's own transaction builder and the owner key kept in a browser profile. For a wallet whose page
// cannot operate it any more, for example after a failed trial.
//
// usage: node --import tsx scripts/rescue-wallet.ts --profile <browser profile directory> --to <address>
//          [--wallet-url https://wallet.9500.cash/] [--server wss://chipnet.imaginary.cash:50004]
import { cashAddressToLockingBytecode, hexToBin } from '@bitauth/libauth';
import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import {
  type Utxo,
  assetScript,
  buildTransaction,
  controllerInput,
  controllerSuccessor,
  deriveXoTemplateKey,
  protectedInput,
  readControllerHistory,
  verifyTransaction,
} from '@grandmas-wallet/core';
import { savingsJarScript } from '@grandmas-wallet/savings-jar';
import { grandmasWalletTemplateIdentifier } from '@grandmas-wallet/templates';
import { chromium } from 'playwright';

const argument = (name: string, fallback?: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? fallback : process.argv[index + 1];
  if (value === undefined) throw new Error(`--${name} is needed`);
  return value;
};
const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

// The wallet's key and record, from the page's own storage.
const context = await chromium.launchPersistentContext(argument('profile'), {});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(argument('wallet-url', 'https://wallet.9500.cash/'));
const stored = await page.evaluate(() => ({ mnemonic: localStorage.getItem('wallet:mnemonic'), wallet: localStorage.getItem('wallet:wallet') }));
await context.close();
if (stored.mnemonic === null || stored.wallet === null) throw new Error('This profile holds no wallet.');
const mnemonic = JSON.parse(stored.mnemonic) as string;
const record = JSON.parse(stored.wallet) as {
  identity: string;
  genesisTransactionId: string;
  positions: { status: string; position: { label?: string; lockingBytecode: string; parameters: Record<string, string | number> } }[];
};

const destination = cashAddressToLockingBytecode(argument('to'));
if (typeof destination === 'string') throw new Error(destination);
const electrum = await Electrum.connect(argument('server', 'wss://chipnet.imaginary.cash:50004'));
try {
  const identity = hexToBin(record.identity);
  const history = await readControllerHistory(electrum, identity, record.genesisTransactionId);
  const { state, utxo: controller } = history.current;
  const key = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => deriveXoTemplateKey(mnemonic, grandmasWalletTemplateIdentifier, index, 'testnet')).find((candidate) => hex(candidate.keyHash) === hex(state.ownerKeyHash));
  if (key === undefined) throw new Error('This profile does not hold the wallet\'s owner key.');

  const at = async (lockingBytecode: Uint8Array): Promise<Utxo[]> =>
    (await electrum.listUnspent(lockingBytecode)).filter((entry) => !entry.hasToken).map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode, valueSatoshis: entry.valueSatoshis } }));
  const funds = assetScript(identity);
  const inputs = (await at(funds.lockingBytecode)).map((utxo) => protectedInput(utxo, funds));
  let locktime = 0;
  for (const { status, position } of record.positions) {
    const unlockTime = Number(position.parameters['unlockTime']);
    if (status === 'closed' || !Number.isInteger(unlockTime)) continue;
    const jar = savingsJarScript(identity, unlockTime);
    if (hex(jar.lockingBytecode) !== position.lockingBytecode) continue;
    const held = await at(jar.lockingBytecode);
    if (held.length === 0) continue;
    // The network's clock runs behind; leave a jar that has only just unlocked for a later attempt.
    if (Date.now() / 1000 < unlockTime + 1_200) {
      console.log(`"${position.label ?? 'jar'}" is still locked or only just unlocked; left in place.`);
      continue;
    }
    inputs.push(...held.map((utxo) => protectedInput(utxo, jar)));
    locktime = Math.max(locktime, unlockTime);
  }
  if (inputs.length === 0) throw new Error('The wallet holds nothing that can be returned now.');

  const action = { kind: 'ownerAuthorize' } as const;
  const built = buildTransaction({
    inputs: [controllerInput(controller, state, action, key), ...inputs],
    outputs: [controllerSuccessor(controller, state, action)],
    changeLockingBytecode: destination.bytecode,
    ...(locktime === 0 ? {} : { locktime }),
  });
  const check = verifyTransaction(built);
  if (check !== true) throw new Error(`The transaction fails the local check: ${check}`);
  const result = await electrum.broadcast(hex(built.encoded));
  if (!result.accepted) throw new Error(`Refused by the network: ${result.reason}`);
  console.log(`Returned ${built.transaction.outputs[1]?.valueSatoshis} sat from ${inputs.length} output(s) (${built.transactionId}).`);
} finally {
  await electrum.disconnect();
}
