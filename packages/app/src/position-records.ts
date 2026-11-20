import { type Input, type Output, type TransactionCommon, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type PositionRecordEntry, type PositionToken, positionEntry } from '@grandmas-wallet/archive';
import { type ChainReader, type ReadTemplate, type TemplateValues, TemplateError, readTemplate, templateExpression, templateKeys, templateLockingBytecode, typedValues, variableType } from '@grandmas-wallet/core';

import type { TokenCoin, WalletParts } from './owner-wallet.js';
import type { ActionSent, WhetherSent } from './recovery-flow.js';

/**
 * Position records (proposal section 10.2): which records an action leaves, made from the template and the
 * transaction the wallet worked out, before anything is signed; whether the action of a record was ever sent;
 * and the check of a record against the chain (section 10.4), from chain data alone.
 *
 * Nothing here reads a recovery declaration or knows an application. What the record holds comes from the
 * template and the transaction alone, so that what the wallet later finds is what it made, not what a
 * request said (section 13.3).
 */

const hex = binToHex;

/** Types of values that never go into a record: a key, a signature. */
const NEVER_RECORDED = new Set(['private_key', 'signature']);
/**
 * Types of values that go into a record only as one of the script's own values: an address. One that the script
 * holds stays, since the script cannot be made again without it; among the action's other values an address is
 * one the position was made with, which after a recovery belongs to the earlier seed (section 10.2).
 */
const ONLY_IN_SCRIPT = new Set(['locking_script']);

/** The output of a worked-out transaction, as far as the records need it. */
export interface WorkedOutput {
  output: Output;
  /** The template's output it was made from; absent for what the wallet adds, such as what is left over. */
  identifier?: string;
  /** Set when the output is at an address of the wallet's. */
  wallet?: unknown;
}

/** An action as the wallet worked it out, before anything is signed. */
export interface WorkedOutAction {
  template: ReadTemplate;
  role: string;
  /** Every value of the action, as the transaction was made with them. */
  values: TemplateValues;
  outputs: WorkedOutput[];
  /** The outputs the wallet's own inputs spend: its coins, and the tokens on them. */
  spent: Output[];
  /** The NFTs of the wallet's that the request says the action is about. */
  about?: PositionToken[];
  /** The address of the application's page, where the request came from one. */
  page?: string;
}

const tokenOf = (output: Output): PositionToken | undefined =>
  output.token?.nft === undefined ? undefined : { category: hex(output.token.category), commitment: hex(output.token.nft.commitment), capability: output.token.nft.capability };

export const sameNft = (a: PositionToken | undefined, b: PositionToken | undefined): boolean =>
  a !== undefined && b !== undefined && a.category === b.category && a.commitment === b.commitment && a.capability === b.capability;

/** A value as the engine keeps it: text, whole numbers in decimal, bytes as hex. */
const asText = (value: TemplateValues[string]): string => (typeof value === 'string' ? value : String(value));

/**
 * Whether the wallet follows a script of the template in its role, by the engine's own rule: it does, unless
 * the output or the locking script says `relevant: false` for the role. A rule given as an expression, which
 * the engine does not evaluate yet, is taken as followed here; what the wallet does about such a template is
 * the finding of section 12.3.
 */
const followed = (definition: ReadTemplate['definition'], lockingScript: string, output: string, role: string): boolean => {
  const fromOutput = (definition.outputs?.[output] as { roles?: Record<string, { relevant?: unknown }> } | undefined)?.roles?.[role]?.relevant;
  const fromScript = (definition.lockingScripts?.[lockingScript] as { roles?: Record<string, { relevant?: unknown }> } | undefined)?.roles?.[role]?.relevant;
  return fromOutput !== false && fromScript !== false;
};

/** The template's variables a script reads, as `<name>`. */
const readsVariables = (definition: ReadTemplate['definition'], lockingScript: string): string[] => {
  const text = definition.scripts?.[definition.lockingScripts?.[lockingScript]?.lockingBytecode ?? ''] ?? '';
  return [...new Set([...text.matchAll(/<\$?\(?<?([A-Za-z_][A-Za-z0-9_]*)>?/g)].map((match) => match[1] as string))].filter((name) => definition.variables?.[name] !== undefined);
};

/**
 * The script's values: those the template lists as the locking script's state, or, where it lists none, the
 * variables the script reads.
 */
const scriptVariableNames = (definition: ReadTemplate['definition'], lockingScript: string): string[] => {
  const state = (definition.lockingScripts?.[lockingScript] as { state?: { variables?: string[] } } | undefined)?.state?.variables;
  return state !== undefined && state.length > 0 ? state : readsVariables(definition, lockingScript);
};

/**
 * The records an action leaves (sections 10.2 and 12.3), worked out from the template and the transaction as
 * the wallet worked it out. A record is due only where a token of the wallet's takes part: one for each script
 * of the template that an output of the transaction pays, that the wallet follows in its role, and that holds
 * the category of an NFT the transaction delivers to the wallet or of one of the wallet's that the action is
 * about; and one for an NFT the action delivers to the wallet that belongs to none of those scripts, which then
 * names no script. An output at a followed script with no such NFT is a payment as far as the wallet can tell,
 * into someone else's position for one, and leaves no record. An action that leaves nothing outside the
 * wallet's own addresses, and gives the wallet no new NFT, leaves none.
 *
 * - **Which token.** For a script, the NFT whose category is one of the script's values: one the transaction
 *   delivers to the wallet, or else one of the wallet's the request names.
 * - **Two sets of values.** The script's values, and the action's other values, kept apart.
 * - **No address outside the script, no key.** A value of the type `locking_script` is kept only as one of the
 *   script's own values, which the script cannot be made without. A private key, a signature and a secret of the
 *   template are left out of both.
 *
 * @throws Error if a record would not name the script the transaction pays
 */
export const recordsDue = (action: WorkedOutAction): PositionRecordEntry[] => {
  const { definition, identifier: templateIdentifier } = action.template;
  const secret = new Set(templateKeys(definition));
  const recordable = (name: string, ofScript: boolean): boolean => {
    const type = variableType(definition, name) ?? '';
    return definition.variables?.[name] !== undefined && !secret.has(name) && !NEVER_RECORDED.has(type) && (ofScript || !ONLY_IN_SCRIPT.has(type));
  };
  const valuesOf = (names: string[], ofScript = false): Record<string, string> =>
    Object.fromEntries(names.flatMap((name) => (recordable(name, ofScript) && action.values[name] !== undefined ? [[name, asText(action.values[name] as TemplateValues[string])]] : [])));
  const spentTokens = action.spent.flatMap((output) => tokenOf(output) ?? []);
  // An NFT the wallet holds after the action and did not before: made, handed out by a contract, or changed.
  const delivered: PositionToken[] = [];
  for (const { output, wallet } of action.outputs) {
    const token = wallet === undefined ? undefined : tokenOf(output);
    if (token !== undefined && !spentTokens.some((spent) => sameNft(spent, token)) && !delivered.some((known) => sameNft(known, token))) delivered.push(token);
  }

  // The scripts of the template the transaction pays and the wallet follows, each once.
  const scripts = new Map<string, { lockingScript: string; variables: Record<string, string>; lockingBytecode: Uint8Array }>();
  for (const { output, identifier, wallet } of action.outputs) {
    if (wallet !== undefined || identifier === undefined) continue;
    const lockingScript = definition.outputs?.[identifier]?.lockingScript;
    if (typeof lockingScript !== 'string' || definition.lockingScripts?.[lockingScript] === undefined) continue;
    if (!followed(definition, lockingScript, identifier, action.role)) continue;
    const variables = valuesOf(scriptVariableNames(definition, lockingScript), true);
    const key = `${lockingScript}\u0000${JSON.stringify(Object.entries(variables).sort(([a], [b]) => (a < b ? -1 : 1)))}`;
    if (!scripts.has(key)) scripts.set(key, { lockingScript, variables, lockingBytecode: output.lockingBytecode });
  }

  const used: PositionToken[] = [];
  const records: PositionRecordEntry[] = [];
  const page = action.page === undefined ? {} : { applicationPage: action.page };
  for (const { lockingScript, variables, lockingBytecode } of scripts.values()) {
    // The record has to name the very script the transaction pays. Where a value the script needs is one a
    // record never holds, the script cannot be made from the record, and the record says what it can.
    try {
      const made = templateLockingBytecode(definition, lockingScript, typedValues(definition, variables));
      if (hex(made) !== hex(lockingBytecode)) throw new Error(`The record of the position at "${lockingScript}" would not name the script the transaction pays. Nothing was signed.`);
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
    }
    const categories = new Set(Object.entries(variables).flatMap(([name, value]) => (variableType(definition, name) === 'token_category' ? [value] : [])));
    const token = delivered.find((candidate) => categories.has(candidate.category)) ?? (action.about ?? []).find((candidate) => categories.has(candidate.category));
    // No token of the wallet's takes part: a payment, as far as the wallet can tell.
    if (token === undefined) continue;
    used.push(token);
    const others = Object.keys(action.values).filter((name) => !(name in variables));
    records.push(
      positionEntry({
        token,
        templateIdentifier,
        lockingScriptIdentifier: lockingScript,
        roleIdentifier: action.role,
        variables,
        values: valuesOf(others),
        ...page,
      }),
    );
  }
  for (const token of delivered) {
    if (used.some((known) => sameNft(known, token))) continue;
    records.push(positionEntry({ token, templateIdentifier, values: valuesOf(Object.keys(action.values)), ...page }));
  }
  return records;
};

const sameValues = (a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/**
 * Whether two records name the same position: the same template, script, role and script values, and the same
 * token. Their other values may differ: a later action that pays into a position has values of its own, and
 * the record that made the position already holds what acting on it takes.
 */
export const samePosition = (a: PositionRecordEntry, b: PositionRecordEntry): boolean =>
  a.templateIdentifier === b.templateIdentifier &&
  a.lockingScriptIdentifier === b.lockingScriptIdentifier &&
  a.roleIdentifier === b.roleIdentifier &&
  sameValues(a.variables, b.variables) &&
  (a.token === undefined ? b.token === undefined : sameNft(a.token, b.token));

/** Whether two records say the same, field for field. */
export const sameRecord = (a: PositionRecordEntry, b: PositionRecordEntry): boolean => samePosition(a, b) && sameValues(a.values, b.values) && a.applicationPage === b.applicationPage;

/**
 * Whether the action of a position record was sent (section 10.2: a record of an action that was never sent
 * names a script the chain does not know, or a token the wallet never received).
 *
 * - A record that names a script: sent when the chain knows the script, never sent when it does not. Where the
 *   script cannot be made, for want of the template or of a value a record does not hold, it cannot tell.
 * - A record that names only a token: sent when the wallet holds that NFT, wherever, at an earlier seed's
 *   address too. When it does not, the record is of an action never sent, or of a token that has left the
 *   wallet; either way it names nothing the wallet could act on. That is known only once the wallet has
 *   finished looking for its coins.
 */
export const actionSent =
  (wallet: Pick<WalletParts, 'chain' | 'tokenCoins' | 'fullySearched'>): WhetherSent =>
  async (entry, templateText): Promise<ActionSent> => {
    if (entry.lockingScriptIdentifier !== undefined) {
      const text = templateText(entry.templateIdentifier);
      if (text === undefined) return 'cannot tell';
      let lockingBytecode: Uint8Array;
      try {
        const template = readTemplate(text);
        if (template.identifier !== entry.templateIdentifier) return 'cannot tell';
        lockingBytecode = templateLockingBytecode(template.definition, entry.lockingScriptIdentifier, typedValues(template.definition, entry.variables ?? {}));
      } catch (error) {
        if (!(error instanceof TemplateError)) throw error;
        return 'cannot tell';
      }
      return (await wallet.chain.getHistory(lockingBytecode)).length > 0 ? 'sent' : 'never sent';
    }
    const held = (await wallet.tokenCoins()).some(({ coin }: TokenCoin) => sameNft(tokenOf(coin.utxo.output), entry.token));
    if (held) return 'sent';
    return wallet.fullySearched?.() === true ? 'never sent' : 'not yet known';
  };

/** What the check of a position record against the chain found. */
export interface PositionRecordVerdict {
  counts: boolean;
  /** Why, in words a person can read. */
  reason: string;
  /** The script the record names, made from the template, the record's locking script and its values. */
  lockingBytecode?: Uint8Array;
  /** The wallet's coin that holds the record's NFT, as `<transaction id>:<output index>`, where the check got that far. */
  heldAt?: string;
  /** The transaction of point 2: it carried the NFT and paid the record's script. */
  carriedIn?: string;
}

/**
 * The check of a position record against the chain (section 10.4): whether the record counts. A record of an
 * earlier seed is written again as the new owner's own only when it does (section 10.6).
 *
 * @param template - the record's template, where the user trusts it on this device; `undefined` where not
 * @throws when a server cannot be asked or does not have a transaction: not being able to look is not an answer
 */
export type PositionRecordCheck = (record: PositionRecordEntry, wallet: Pick<WalletParts, 'chain' | 'tokenCoins'>, template: ReadTemplate | undefined) => Promise<PositionRecordVerdict>;

/** The most transactions the wallet goes back through to tie a token that can be copied to the record. */
export const MOST_STEPS_BACK = 100;

const outpointText = (transactionHash: Uint8Array, index: number): string => `${hex(transactionHash)}:${index}`;
const COINBASE = '00'.repeat(32);

/** Transactions read from a server once each for the length of one check. */
class TransactionsRead {
  private readonly read = new Map<string, TransactionCommon>();
  constructor(private readonly chain: ChainReader) {}

  async transaction(transactionId: string): Promise<TransactionCommon> {
    const known = this.read.get(transactionId);
    if (known !== undefined) return known;
    const raw = await this.chain.getTransaction(transactionId);
    if (raw === undefined) throw new Error(`The servers do not have transaction ${transactionId}. The record cannot be checked now.`);
    const transaction = decodeTransactionBch(hexToBin(raw));
    if (typeof transaction === 'string') throw new Error(`Transaction ${transactionId} cannot be read: ${transaction}`);
    this.read.set(transactionId, transaction);
    return transaction;
  }

  /** The output an input spends; `undefined` for a block reward's input. */
  async spent(input: Input): Promise<Output | undefined> {
    const transactionId = hex(input.outpointTransactionHash);
    if (transactionId === COINBASE) return undefined;
    const output = (await this.transaction(transactionId)).outputs[input.outpointIndex];
    if (output === undefined) throw new Error(`Transaction ${transactionId} has no output ${input.outpointIndex}.`);
    return output;
  }
}

/** Whether the token `from` can stand for `to` after a transaction: be it, or make it because it can mint or its commitment can change. */
const canBecome = (from: PositionToken, to: PositionToken): boolean =>
  from.category === to.category && (sameNft(from, to) || from.capability === 'minting' || (from.capability === 'mutable' && to.capability !== 'minting'));

/** The variables an expression of a template names. */
const namedIn = (expression: string): string[] => [...expression.matchAll(/<([A-Za-z_][A-Za-z0-9_]*)>/g)].map((match) => match[1] as string);

/**
 * Point 4 of the check: where the template names the position's token as an input of an action at the record's
 * script (an input that names a token and has no unlocking script), the values that the input's token fields
 * use are the token's own. Only the values the record holds are compared; a field that needs one it does not
 * hold is the action's to fill.
 *
 * @returns what disagrees, or `undefined`
 */
const tokenInputDisagrees = (template: ReadTemplate, record: PositionRecordEntry & { token: PositionToken; lockingScriptIdentifier: string }): string | undefined => {
  const { definition } = template;
  const lockingScript = definition.lockingScripts?.[record.lockingScriptIdentifier] as { unlockingBytecode?: string; roles?: Record<string, { actions?: { action: string }[] }> } | undefined;
  const offered = new Set((lockingScript?.roles?.[record.roleIdentifier ?? '']?.actions ?? []).map(({ action }) => action));
  const values: TemplateValues = { ...record.values, ...record.variables };
  for (const [action, described] of Object.entries(definition.actions ?? {})) {
    const inputs = (definition.transactions?.[described.transaction ?? ''] as { inputs?: { input: string }[] } | undefined)?.inputs ?? [];
    const unlocking = inputs.map(({ input }) => definition.inputs?.[input]?.unlockingScript);
    // An action at the record's script: one it offers there, or one that spends a coin there.
    if (!offered.has(action) && (lockingScript?.unlockingBytecode === undefined || !unlocking.includes(lockingScript.unlockingBytecode))) continue;
    for (const { input } of inputs) {
      const described = definition.inputs?.[input] as { unlockingScript?: string; name?: string; token?: { category?: unknown; nft?: { commitment?: unknown } | null } | null } | undefined;
      if (described?.token === undefined || described.token === null || described.unlockingScript !== undefined) continue;
      const fields: [string, unknown, string][] = [
        ['category', described.token.category, record.token.category],
        ['commitment', described.token.nft?.commitment, record.token.commitment],
      ];
      for (const [field, expression, own] of fields) {
        if (typeof expression !== 'string' || !namedIn(expression).some((name) => values[name] !== undefined)) continue;
        let worked: string | undefined;
        try {
          worked = templateExpression(definition, expression, typedValues(definition, values));
        } catch (error) {
          if (!(error instanceof TemplateError)) throw error;
          continue;
        }
        if (worked !== undefined && worked !== own) {
          return `The template names the position's token as the input "${described.name ?? input}" of the action "${described.name === undefined ? action : (definition.actions?.[action]?.name ?? action)}", and the record's values give that input another token's ${field} than the record's own.`;
        }
      }
    }
  }
  return undefined;
};

/**
 * Follow a token that can be copied or changed from the wallet's coin back, input by input, to one of the given
 * transactions. At each transaction on the way exactly one coin it spends can have made the token, and no other
 * of its outputs could stand for it.
 */
const followBack = async (read: TransactionsRead, start: string, record: PositionToken, carriers: Set<string>): Promise<{ carriedIn: string } | { reason: string }> => {
  let [transactionId = '', index = '0'] = start.split(':');
  for (let step = 0; step < MOST_STEPS_BACK; step++) {
    const transaction = await read.transaction(transactionId);
    const here = tokenOf(transaction.outputs[Number(index)] ?? { lockingBytecode: new Uint8Array(), valueSatoshis: 0n });
    if (here === undefined) return { reason: `Output ${index} of transaction ${transactionId} carries no NFT.` };
    const copy = transaction.outputs.findIndex((output, other) => {
      const token = tokenOf(output);
      return other !== Number(index) && token !== undefined && canBecome(token, here);
    });
    if (copy >= 0) return { reason: `Transaction ${transactionId} made another NFT that can stand for it, at output ${copy}.` };
    if (carriers.has(transactionId) && sameNft(here, record)) return { carriedIn: transactionId };
    const sources: { transactionId: string; index: number; token: PositionToken }[] = [];
    let made = false;
    for (const input of transaction.inputs) {
      if (hex(input.outpointTransactionHash) === record.category && input.outpointIndex === 0) made = true;
      const spent = await read.spent(input);
      const token = spent === undefined ? undefined : tokenOf(spent);
      if (token !== undefined && canBecome(token, here)) sources.push({ transactionId: hex(input.outpointTransactionHash), index: input.outpointIndex, token });
    }
    if (made) return { reason: `It goes back to transaction ${transactionId}, where its category was made, without passing a transaction that paid the record's script.` };
    if (sources.length !== 1) return { reason: sources.length === 0 ? `No coin that transaction ${transactionId} spends could have made it.` : `Transaction ${transactionId} spends ${sources.length} coins that could have made it.` };
    const [source] = sources as [{ transactionId: string; index: number; token: PositionToken }];
    // The transaction of point 2 carried the record's NFT among the coins it spent, and changed it on the way out.
    if (carriers.has(transactionId) && sameNft(source.token, record)) return { carriedIn: transactionId };
    transactionId = source.transactionId;
    index = String(source.index);
  }
  return { reason: `It was not reached within ${MOST_STEPS_BACK} transactions.` };
};

/**
 * The check of section 10.4, from chain data alone.
 *
 * 1. The wallet holds the record's NFT, compared whole, and the user trusts the record's template. Where the
 *    record's NFT can mint or its commitment can change, an NFT of the wallet's that it could have become is
 *    taken as a candidate, for point 3 to decide.
 * 2. A transaction in the history of the record's script paid that script and carried the record's NFT, among
 *    its outputs or, where no such transaction carries it among its outputs, among the coins it spent.
 * 3. The NFT is the wallet's: no such transaction carried two NFTs that cannot be told apart; and where the
 *    token could have been copied, because it can mint or its commitment can change, it is followed from the
 *    wallet's coin back to such a transaction, input by input, with exactly one way back at each step and no
 *    other output on the way that could stand for it.
 * 4. Where the template names the token as an input of an action at the script, the record's values for the
 *    input's token fields are the token's own.
 *
 * A record that names no script counts once point 1 holds. What it costs from a server: one history of the
 * record's script, and each transaction in it once; the coins spent by the transactions that paid the script
 * only where none of them carries the NFT among its outputs; and, for a token that can be copied or changed,
 * each transaction on the way back and those its inputs spend. Nothing is read from a server for a record that
 * fails point 1 or 4; point 1 reads the wallet's own coins.
 */
export const checkPositionRecord: PositionRecordCheck = async (record, wallet, template) => {
  const no = (reason: string, more: Partial<PositionRecordVerdict> = {}): PositionRecordVerdict => ({ counts: false, reason, ...more });
  const { token } = record;
  if (token === undefined) return no('The record names no token. A record of a position is tied to the NFT the position belongs to; one without is never relied on.');
  if (template === undefined || template.identifier !== record.templateIdentifier) return no('The record\'s template is not trusted on this device.');

  // 1. The wallet holds the record's NFT.
  const ofCategory = (await wallet.tokenCoins()).flatMap(({ coin }) => {
    const held = tokenOf(coin.utxo.output);
    return held === undefined || held.category !== token.category ? [] : [{ held, at: outpointText(coin.utxo.transactionHash, coin.utxo.index) }];
  });
  const copiable = token.capability !== 'none';
  const candidates = ofCategory.filter(({ held }) => (copiable ? canBecome(token, held) : sameNft(token, held)));
  if (candidates.length === 0) {
    return no(ofCategory.length === 0 ? 'The wallet holds no NFT of the record\'s category.' : 'The wallet\'s NFT of the record\'s category differs from the record\'s in its commitment or its capability.');
  }
  if (!copiable && candidates.length > 1) return no('The wallet holds more than one NFT like the record\'s; they cannot be told apart.');
  if (record.lockingScriptIdentifier === undefined) {
    return { counts: true, reason: 'The record names no script: it ties the token to its template, and the application says where the position stands.', ...(copiable ? {} : { heldAt: candidates[0]?.at as string }) };
  }

  // 4. The template's token input agrees with the record. Nothing needs to be read for it.
  const disagrees = tokenInputDisagrees(template, { ...record, token, lockingScriptIdentifier: record.lockingScriptIdentifier });
  if (disagrees !== undefined) return no(disagrees);

  // 2. A transaction carried the NFT and paid the record's script.
  let lockingBytecode: Uint8Array;
  try {
    lockingBytecode = templateLockingBytecode(template.definition, record.lockingScriptIdentifier, typedValues(template.definition, record.variables ?? {}));
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    return no(`The record's script cannot be made from its template and values: ${error.message}`);
  }
  const script = hex(lockingBytecode);
  const read = new TransactionsRead(wallet.chain);
  // Those that paid the script, and which of them carried the NFT among their outputs. Only where none did are
  // the coins they spent read: a token that a transaction spends and does not give back.
  const payers: [string, TransactionCommon][] = [];
  for (const { transactionId } of await wallet.chain.getHistory(lockingBytecode)) {
    const transaction = await read.transaction(transactionId);
    if (transaction.outputs.some((output) => hex(output.lockingBytecode) === script)) payers.push([transactionId, transaction]);
  }
  const carriers = new Map<string, number>();
  for (const [transactionId, transaction] of payers) {
    const alike = transaction.outputs.filter((output) => sameNft(tokenOf(output), token)).length;
    if (alike > 0) carriers.set(transactionId, alike);
  }
  if (carriers.size === 0) {
    for (const [transactionId, transaction] of payers) {
      let alike = 0;
      for (const input of transaction.inputs) if (sameNft(tokenOf((await read.spent(input)) ?? { lockingBytecode: new Uint8Array(), valueSatoshis: 0n }), token)) alike += 1;
      if (alike > 0) carriers.set(transactionId, alike);
    }
  }
  if (carriers.size === 0) return no('No transaction that paid the record\'s script carried its NFT.', { lockingBytecode });

  // 3. The NFT is the one the wallet holds.
  const [twice] = [...carriers].find(([, alike]) => alike > 1) ?? [];
  if (twice !== undefined) return no(`Transaction ${twice} carried more than one NFT like the record's: they cannot be told apart.`, { lockingBytecode });
  if (!copiable) return { counts: true, reason: 'A transaction that paid the record\'s script carried its NFT, which the wallet holds.', lockingBytecode, heldAt: candidates[0]?.at as string, carriedIn: carriers.keys().next().value as string };

  const reasons: string[] = [];
  const reached: { at: string; carriedIn: string }[] = [];
  for (const { at } of candidates) {
    const back = await followBack(read, at, token, new Set(carriers.keys()));
    if ('carriedIn' in back) reached.push({ at, carriedIn: back.carriedIn });
    else reasons.push(back.reason);
  }
  if (reached.length === 1) {
    const [only] = reached as [{ at: string; carriedIn: string }];
    return { counts: true, reason: 'The NFT, which can be copied or changed, was followed back from the wallet\'s coin to a transaction that paid the record\'s script, with one way at every step.', lockingBytecode, heldAt: only.at, carriedIn: only.carriedIn };
  }
  return no(reached.length > 1 ? 'More than one NFT of the wallet\'s leads back to the record: they cannot be told apart.' : `The NFT can be copied or changed, and the way back from the wallet's coin is not unambiguous: ${reasons.join(' ')}`, { lockingBytecode });
};
