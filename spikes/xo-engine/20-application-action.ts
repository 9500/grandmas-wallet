// Experiment 20: can the engine work out what an action of an application's template would do,
// without the wallet knowing the template? A throwaway invitation on the application's template is
// built into an unsigned transaction, and its outputs, lock time and sequence numbers are read back.
// run from the repository root: npx tsx spikes/xo-engine/20-application-action.ts
import { binToHex, decodeTransactionBch, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { savingsJarScript } from '../../packages/core/src/index.js';
import { savingsJarTemplate } from '../../packages/templates/src/index.js';

const template = {
  ...savingsJarTemplate,
  actions: {
    ...savingsJarTemplate.actions,
    withdraw: {
      name: 'Empty a savings jar',
      description: 'Release the jar\'s funds after its unlock time.',
      icon: 'savings',
      roles: { saver: { requirements: { variables: ['identity', 'unlockTime'] } } },
      requirements: { participants: [{ role: 'saver', slots: { min: 1, max: 1 } }] },
      transaction: 'withdrawTransaction',
    },
  },
  transactions: {
    ...savingsJarTemplate.transactions,
    withdrawTransaction: {
      name: 'Emptied a savings jar',
      description: 'The jar\'s funds were released.',
      icon: 'savings',
      inputs: [{ input: 'savingsJarInput' }],
      outputs: [],
      version: 2,
      locktime: '$(<unlockTime>)',
    },
  },
  inputs: {
    savingsJarInput: { name: 'Savings jar', description: 'The jar being emptied.', icon: 'savings', unlockingScript: 'unlockSavingsJar' },
  },
};

const identity = 'c29c930243a9cc8117eac382bcdf757f4996557b91ce6aabf156bc2f3a4b04d6';
const unlockTime = 1_800_000_000;
const expected = binToHex(savingsJarScript(hexToBin(identity), unlockTime).lockingBytecode);

const engine = await Engine.create(generateBip39Mnemonic(), { network: XO_SUPPORTED_NETWORKS.chipnet });
const { templateIdentifier } = await engine.importTemplate(template as never);
console.log('template', templateIdentifier);

const attempt = async (label: string, work: () => Promise<unknown>) => {
  try {
    console.log(label, '→', await work());
  } catch (error) {
    console.log(label, '✗', (error as Error).name, (error as Error).message.slice(0, 300));
  }
};

const variables = (values: Record<string, string | number | bigint>) =>
  Object.entries(values).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'saver', value }));

// 1. A deposit: what would it pay, and where?
const deposit = await engine.createInvitation({
  templateIdentifier,
  actionIdentifier: 'deposit',
  intent: { action: 'deposit', role: 'saver' },
  variables: variables({ identity, unlockTime, savedSatoshis: 5000 }),
  inputs: [],
} as never);
const depositId = deposit.invitation.invitationIdentifier;
await attempt('resolve output without adding it', async () => (await engine.resolveInvitationOutputLockingBytecode(depositId, 'savingsJarOutput', 'saver')) === expected);
await attempt('scripts followed before adding', async () => (await engine.listScriptHashes()).length);
await attempt('append output', async () => void (await engine.appendInvitation(depositId, { outputs: [{ outputIdentifier: 'savingsJarOutput' }] } as never)));
await attempt('build deposit', async () => {
  const built = await engine.buildInvitationTransactionFromMergedCommit(depositId);
  const transaction = decodeTransactionBch(hexToBin(built.serializedTransaction));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction.outputs.map((output) => ({ script: binToHex(output.lockingBytecode) === expected ? 'the jar' : binToHex(output.lockingBytecode), satoshis: output.valueSatoshis }));
});
await attempt('scripts followed after adding', async () => (await engine.listScriptHashes()).map((entry) => JSON.stringify(entry, (_key, value) => (typeof value === 'bigint' ? String(value) : value)).slice(0, 400)));
await engine.archiveInvitation(depositId);
await attempt('scripts followed after archiving', async () => (await engine.listScriptHashes()).length);

// 2. A withdrawal: what lock time and sequence number does the template ask for?
await attempt('withdraw', async () => {
  const withdraw = await engine.createInvitation({
    templateIdentifier,
    actionIdentifier: 'withdraw',
    intent: { action: 'withdraw', role: 'saver' },
    variables: variables({ identity, unlockTime }),
    inputs: [{ outpointTransactionHash: hexToBin('11'.repeat(32)), outpointIndex: 0, inputIdentifier: 'savingsJarInput' }],
  } as never);
  const id = withdraw.invitation.invitationIdentifier;
  const built = await engine.buildInvitationTransactionFromMergedCommit(id);
  const transaction = decodeTransactionBch(hexToBin(built.serializedTransaction));
  if (typeof transaction === 'string') throw new Error(transaction);
  await engine.archiveInvitation(id);
  return { locktime: transaction.locktime, sequences: transaction.inputs.map((input) => input.sequenceNumber), outputs: transaction.outputs.length };
});
await engine.stop?.();
process.exit(0);
