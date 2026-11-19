// One small transaction on chipnet through the XO engine, to have its invitation as a file: for trying a saved
// invitation in XO's debug tool before the full runs.
//
// An account of the engine with the wallet's templates is paid 3,000 satoshis from this project's funding key
// and sends everything back to it, as a `pay` action of the wallet's actions template. The account's words are
// on disk (.chipnet/test-invitation.json) before anything is paid to them, and the same command continues a
// run that stopped. The invitation goes to docs/runs/invitations/test-chipnet/.
//
// usage (from packages/app): npx tsx ../../scripts/test-invitation.ts
import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateBip39Mnemonic, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { keyPairFromPrivateKey, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork } from '@xo-cash/engine';

import { Account, RecovererFunds } from '../packages/app/src/index.js';
import { Electrum } from '../packages/chipnet/src/electrum.js';
import { clearInvitationFiles, invitationDirectory, invitationFiles, writeInvitationFiles } from './invitation-files.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const stateFile = `${root}.chipnet/test-invitation.json`;
const state: { words: string; funded?: boolean } = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as { words: string; funded?: boolean }) : { words: generateBip39Mnemonic() };
const keep = (): void => writeFileSync(stateFile, JSON.stringify(state, null, 1), { mode: 0o600 });
keep();

const funder = keyPairFromPrivateKey(hexToBin((JSON.parse(readFileSync(`${root}.chipnet/funder-design-2.json`, 'utf8')) as { privateKey: string }).privateKey));
const funderLocking = p2pkhLockingBytecode(funder.keyHash);
const invitations = invitationDirectory('test-chipnet', false);
if (state.funded !== true) clearInvitationFiles(invitations);

const [first] = resolveElectrumServersForNetwork(XO_SUPPORTED_NETWORKS.chipnet);
if (first === undefined) throw new Error('the engine names no chipnet server');
const electrumServers = [{ host: 'chipnet.9500.cash', version: first.version, transports: { wss: 443 }, blockchain: first.blockchain }];
const account = await Account.open(await Engine.create(state.words, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers }), { onSent: writeInvitationFiles(invitations, 'test account') });
const server = await Electrum.connect('wss://chipnet.9500.cash:443');
const funds = await RecovererFunds.open({
  backend: account,
  chain: {
    getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
    getTransaction: (transactionId) => server.getTransaction(transactionId),
    listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
  },
});

const made = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: await funds.address() });
if (typeof made === 'string') throw new Error(made);
if (state.funded !== true) {
  console.log(execFileSync('npx', ['tsx', `${root}scripts/chipnet-pay.ts`, made.address, '3000'], { encoding: 'utf8' }).trim());
  state.funded = true;
  keep();
}
for (let attempt = 0; (await funds.balance()) === 0n; attempt += 1) {
  if (attempt > 120) throw new Error('The engine does not list the coin it was paid. The same command continues.');
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.log(`the account holds ${await funds.balance()} satoshis`);
const sent = await funds.sendEverything(funderLocking);
for (const transaction of sent.transactions) console.log(`sent back in ${transaction.transactionId}, ${transaction.bytes} bytes, fee ${transaction.feeSatoshis}`);
for (const entry of invitationFiles(invitations)) console.log(`invitation: ${invitations.slice(root.length)}${entry.file}`);
await account.close().catch(() => undefined);
process.exit(0);
