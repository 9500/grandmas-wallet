// One XO account, kept open for the whole run so its engine state persists between steps.
// Started by run.ts as a child process; takes one JSON request per line on stdin and answers on stdout.
//
// usage: tsx agent.ts <account name>
import 'fake-indexeddb/auto'; // the engine's SQLite storage is unfinished, so Node needs an IndexedDB

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { binToHex, generateBip39Mnemonic, hash160, hexToBin } from '@bitauth/libauth';
import { grandmasWalletTemplate, savingsJarTemplate } from '@grandmas-wallet/templates';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';

const account = process.argv[2] ?? 'account';
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.xo-demo');
mkdirSync(DATA, { recursive: true });
const mnemonicPath = resolve(DATA, `${account}.mnemonic`);
if (!existsSync(mnemonicPath)) writeFileSync(mnemonicPath, generateBip39Mnemonic(), { mode: 0o600 });
const mnemonic = readFileSync(mnemonicPath, 'utf8').trim();

// The engine reports problems on the console; stdout is reserved for answers.
const engineMessages: string[] = [];
console.error = (...parts: unknown[]) => engineMessages.push(String(parts[0]).slice(0, 200));
console.warn = console.error;

const engine = await Engine.create(mnemonic, { network: XO_SUPPORTED_NETWORKS.chipnet });
const coinsTemplate = (await engine.importTemplate(p2pkhTemplate)).templateIdentifier;
const walletTemplate = (await engine.importTemplate(grandmasWalletTemplate)).templateIdentifier;
const jarTemplate = (await engine.importTemplate(savingsJarTemplate)).templateIdentifier;
const coinPolicies = { change: { templateIdentifier: coinsTemplate }, receive: { templateIdentifier: coinsTemplate }, address: { templateIdentifier: coinsTemplate } };
const policiesOf = (templateIdentifier: string) => ({ change: { templateIdentifier: coinsTemplate }, receive: { templateIdentifier }, address: { templateIdentifier } });
await engine.setDefaultPolicies(coinPolicies);
const coinLockingBytecode = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
const template = grandmasWalletTemplate;

/** Appending takes any subset of an invitation's fields; the engine's declared type asks for all of them. */
const append = (invitationIdentifier: string, fields: object) =>
  engine.appendInvitation(invitationIdentifier, fields as Parameters<typeof engine.appendInvitation>[1]);

type Json = Record<string, unknown>;
type Variables = Record<string, string | number>;
interface InputRequest { transactionId: string; index: number; inputIdentifier?: string }
interface RawOutput { lockingBytecode: string; satoshis: string }

/** Values ending in "n" are whole numbers too large or too exact for JSON. */
const value = (raw: string | number): string | number | bigint => (typeof raw === 'string' && /^\d+n$/.test(raw) ? BigInt(raw.slice(0, -1)) : raw);
const variablesFor = (role: string, variables: Variables = {}) =>
  Object.entries(variables).map(([variableIdentifier, raw]) => ({ variableIdentifier, roleIdentifier: role, value: value(raw) }));
const inputsFor = (inputs: InputRequest[] = []) =>
  inputs.map(({ transactionId, index, inputIdentifier }) => ({
    outpointTransactionHash: hexToBin(transactionId),
    outpointIndex: index,
    ...(inputIdentifier === undefined ? {} : { inputIdentifier }),
  }));
const rawOutputsFor = (outputs: RawOutput[] = []) =>
  outputs.map(({ lockingBytecode, satoshis }) => ({ lockingBytecode: hexToBin(lockingBytecode), valueSatoshis: BigInt(satoshis) }));

const identifierOf = (stored: Awaited<ReturnType<typeof engine.createInvitation>>): string => stored.invitation.invitationIdentifier;
const serialized = async (invitationIdentifier: string): Promise<string> => {
  const stored = await engine.getInvitation(invitationIdentifier);
  if (stored === undefined) throw new Error(`invitation ${invitationIdentifier} is not stored`);
  return serializeInvitation(stored.invitation);
};

/** Hash of the public key of the newest key this account generated for a secret of the wallet template. */
const keyHash = async (secretIdentifier: string): Promise<string> => {
  const secrets = (await engine.listSecretData())
    .filter((secret) => secret.secretIdentifier === secretIdentifier && secret.templateIdentifier === walletTemplate)
    .sort((a, b) => (b.createdAtTimestampMs ?? 0) - (a.createdAtTimestampMs ?? 0));
  const [newest] = secrets;
  if (newest === undefined) throw new Error(`this account has no ${secretIdentifier}`);
  const publicKey = await engine.getSecretPublicKey(newest.secretLookupKey);
  if (publicKey === undefined) throw new Error(`no public key for ${secretIdentifier}`);
  return binToHex(hash160(hexToBin(publicKey)));
};

/** The intent a role acts on: the template's start entry, or a follow-up offered by the controller script. */
const intentFor = (action: string, role: string, generate?: string[]) => {
  const start = template.start.find((entry) => entry.action === action && entry.role === role);
  if (start !== undefined) return start;
  const followUp = template.lockingScripts['controllerLockingScript']?.roles?.[role]?.actions?.find((entry) => entry.action === action);
  const intent = followUp ?? { action, role };
  return generate === undefined ? intent : { ...intent, generate };
};

/** Sign this account's inputs and build the transaction, without sending it. */
const complete = async (invitationIdentifier: string) => {
  const own = await engine.listOwnInputIndexes(invitationIdentifier);
  for (const index of own) await engine.signInvitation(invitationIdentifier, index);
  const missing = await engine.listMissingRequirements(invitationIdentifier);
  const { builtTransaction } = await engine.executeAction(invitationIdentifier, { broadcastTransaction: false });
  return {
    invitationIdentifier,
    ownInputIndexes: own,
    missing,
    transactionId: builtTransaction.transactionHash,
    transactionHex: builtTransaction.serializedTransaction,
    invitation: await serialized(invitationIdentifier),
  };
};

const operations: Record<string, (request: Json) => Promise<unknown>> = {
  describe: async () => ({ account, coinLockingBytecode, walletTemplate }),

  coins: async () =>
    (await engine.listSpendableUnspentOutputs({ templateIdentifier: coinsTemplate })).map((coin) => ({
      transactionId: coin.outpointTransactionHash,
      index: coin.outpointIndex,
      satoshis: String(coin.valueSatoshis),
    })),

  unspent: async () =>
    (await engine.listUnspentOutputs()).map((output) => ({
      transactionId: output.outpointTransactionHash,
      index: output.outpointIndex,
      satoshis: String(output.valueSatoshis),
      template: output.templateIdentifier === walletTemplate ? 'wallet' : output.templateIdentifier === jarTemplate ? 'jar' : 'coins',
      commitment: output.tokenNftCommitment,
    })),

  keyHash: async ({ secret }) => keyHash(secret as string),

  messages: async () => engineMessages.splice(0),

  /**
   * Start an action and take it as far as a built transaction.
   * `derive` names variables to fill with the hash of a key this invitation generated.
   */
  start: async (request) => {
    const { action, role, generate, variables, inputs, outputs, rawOutputs, derive, locktime } = request as {
      action: string; role: string; generate?: string[]; variables?: Variables; inputs?: InputRequest[];
      outputs?: string[]; rawOutputs?: RawOutput[]; derive?: Record<string, string>; locktime?: number;
    };
    const stored = await engine.createInvitation({
      templateIdentifier: walletTemplate,
      actionIdentifier: action,
      intent: intentFor(action, role, generate),
      variables: variablesFor(role, variables),
      inputs: inputsFor(inputs),
      ...(locktime === undefined ? {} : { transactionLocktime: locktime }),
    });
    const invitationIdentifier = identifierOf(stored);
    for (const [variableIdentifier, secret] of Object.entries(derive ?? {})) {
      await append(invitationIdentifier, { variables: variablesFor(role, { [variableIdentifier]: await keyHash(secret) }) });
    }
    if (outputs !== undefined || rawOutputs !== undefined) {
      await append(invitationIdentifier, {
        outputs: [...(outputs ?? []).map((outputIdentifier) => ({ outputIdentifier })), ...rawOutputsFor(rawOutputs)],
      });
      return complete(invitationIdentifier);
    }
    return { invitationIdentifier, invitation: await serialized(invitationIdentifier) };
  },

  /** Join an invitation another account started, generating the keys the role needs. */
  join: async (request) => {
    const { invitation, role, generate, variables, derive } = request as {
      invitation: string; role: string; generate?: string[]; variables?: Variables; derive?: Record<string, string>;
    };
    const incoming = deserializeInvitation(invitation);
    const stored = await engine.acceptInvitation(incoming, {
      roleIdentifier: role,
      // Keys the role does not generate by itself are created only when asked for, on first use.
      ...(generate === undefined ? {} : { intent: { action: incoming.actionIdentifier, role, generate } }),
    });
    const invitationIdentifier = identifierOf(stored);
    const all: Variables = { ...variables };
    for (const [variableIdentifier, secret] of Object.entries(derive ?? {})) all[variableIdentifier] = await keyHash(secret);
    if (Object.keys(all).length > 0) await append(invitationIdentifier, { variables: variablesFor(role, all) });
    return { invitationIdentifier, invitation: await serialized(invitationIdentifier), derived: all };
  },

  /** Take in a newer copy of an invitation; optionally add outputs and build the transaction. */
  continue: async (request) => {
    const { invitation, outputs, rawOutputs, build } = request as {
      invitation: string; outputs?: string[]; rawOutputs?: RawOutput[]; build?: boolean;
    };
    const stored = await engine.updateInvitation(deserializeInvitation(invitation));
    const invitationIdentifier = identifierOf(stored);
    if (outputs !== undefined || rawOutputs !== undefined) {
      await append(invitationIdentifier, {
        outputs: [...(outputs ?? []).map((outputIdentifier) => ({ outputIdentifier })), ...rawOutputsFor(rawOutputs)],
      });
    }
    if (build === true) return complete(invitationIdentifier);
    return { invitationIdentifier, invitation: await serialized(invitationIdentifier) };
  },

  /** Send the transaction built for an invitation. */
  broadcast: async ({ invitationIdentifier }) => {
    const id = invitationIdentifier as string;
    try {
      const { builtTransaction } = await engine.executeAction(id, { broadcastTransaction: true });
      return { transactionId: builtTransaction.transactionHash, invitation: await serialized(id) };
    } catch (error) {
      // The engine can fail while clearing reservations after the transaction has gone out.
      if ((error as Error).name !== 'UnspentOutputNotFoundInStoreError') throw error;
      return { transactionId: undefined, invitation: await serialized(id), note: 'engine raised UnspentOutputNotFoundInStoreError after broadcasting' };
    }
  },

  /**
   * Make an address known to this account, so that it follows the outputs there and can spend them:
   * the wallet's own address, or a savings jar for a given unlock time.
   */
  track: async ({ what, variables }) => {
    const [templateIdentifier, policy] = what === 'jar' ? [jarTemplate, 'address' as const] : [walletTemplate, 'address' as const];
    await engine.setDefaultPolicies(policiesOf(templateIdentifier));
    try {
      const values = Object.fromEntries(Object.entries((variables ?? {}) as Variables).map(([name, raw]) => [name, value(raw)]));
      return await engine.generateLockingBytecodeFromDefaultPolicy(policy, values);
    } finally {
      await engine.setDefaultPolicies(coinPolicies);
    }
  },

  /** An ordinary payment from this account's coins. */
  pay: async ({ lockingBytecode, satoshis }) => {
    const coins = await engine.listSpendableUnspentOutputs({ templateIdentifier: coinsTemplate });
    const intent = p2pkhTemplate.lockingScripts['receivingLockingScript']?.roles?.['receiver']?.actions?.find((entry) => entry.action === 'sendSatoshis');
    const stored = await engine.createInvitation({
      templateIdentifier: coinsTemplate,
      actionIdentifier: 'sendSatoshis',
      ...(intent === undefined ? {} : { intent }),
      variables: variablesFor('sender', { transferredSatoshis: satoshis as string, recipientLockingscript: lockingBytecode as string }),
      inputs: coins.map((coin) => ({ outpointTransactionHash: hexToBin(coin.outpointTransactionHash), outpointIndex: coin.outpointIndex })),
    });
    const invitationIdentifier = identifierOf(stored);
    await append(invitationIdentifier, { outputs: [{ outputIdentifier: 'transferSatoshisOutput' }] });
    // Anything left over beyond the fee returns to this account.
    const change = await engine.calculateChange(invitationIdentifier);
    if (BigInt(change.valueSatoshis) > 1_000n) await engine.addChangeToInvitation(invitationIdentifier);
    return complete(invitationIdentifier);
  },

  stop: async () => {
    setTimeout(() => process.exit(0), 50);
    return 'stopping';
  },
};

const answer = (message: Json): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, operation, ...request } = JSON.parse(line) as { id: number; operation: string } & Json;
  const run = operations[operation];
  if (run === undefined) {
    answer({ id, error: `unknown operation ${operation}` });
    return;
  }
  run(request).then(
    (result) => answer({ id, result }),
    (error: Error) => answer({ id, error: `${error.name}: ${error.message}`.slice(0, 600) }),
  );
});

answer({ id: 0, result: 'ready' });
