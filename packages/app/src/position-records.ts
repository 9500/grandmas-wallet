import { type Output, binToHex } from '@bitauth/libauth';
import { type PositionRecordEntry, type PositionToken, positionEntry } from '@grandmas-wallet/archive';
import { type ReadTemplate, type TemplateValues, TemplateError, readTemplate, templateKeys, templateLockingBytecode, typedValues, variableType } from '@grandmas-wallet/core';

import type { TokenCoin, WalletParts } from './owner-wallet.js';
import type { ActionSent, WhetherSent } from './recovery-flow.js';

/**
 * Position records (proposal section 10.2): which records an action leaves, made from the template and the
 * transaction the wallet worked out, before anything is signed; whether the action of a record was ever sent;
 * and where the check of a record against the chain (section 10.4) plugs in.
 *
 * Nothing here reads a recovery declaration or knows an application. What the record holds comes from the
 * template and the transaction alone, so that what the wallet later finds is what it made, not what a
 * request said (section 13.3).
 */

const hex = binToHex;

/** Types of values that never go into a record: a locking script of the wallet's, a key, a signature. */
const NEVER_RECORDED = new Set(['locking_script', 'private_key', 'signature']);

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
 * the wallet worked it out. One is due for each script of the template that an output of the transaction pays
 * and that the wallet follows in its role; and one for an NFT the action delivers to the wallet that is new to
 * it and belongs to none of those scripts, which then names no script. An action that leaves nothing outside
 * the wallet's own addresses, and gives the wallet no new NFT, leaves none.
 *
 * - **Which token.** For a script, the NFT whose category is one of the script's values: one the transaction
 *   delivers to the wallet, or else one of the wallet's the request names. None when no such NFT is there.
 * - **Two sets of values.** The script's values, and the action's other values, kept apart.
 * - **No address, no key.** A value of the type `locking_script`, a private key, a signature and a secret of
 *   the template are left out of both.
 *
 * @throws Error if a record would not name the script the transaction pays
 */
export const recordsDue = (action: WorkedOutAction): PositionRecordEntry[] => {
  const { definition, identifier: templateIdentifier } = action.template;
  const secret = new Set(templateKeys(definition));
  const recordable = (name: string): boolean => definition.variables?.[name] !== undefined && !secret.has(name) && !NEVER_RECORDED.has(variableType(definition, name) ?? '');
  const valuesOf = (names: string[]): Record<string, string> =>
    Object.fromEntries(names.flatMap((name) => (recordable(name) && action.values[name] !== undefined ? [[name, asText(action.values[name] as TemplateValues[string])]] : [])));
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
    const variables = valuesOf(scriptVariableNames(definition, lockingScript));
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
    if (token !== undefined) used.push(token);
    const others = Object.keys(action.values).filter((name) => !(name in variables));
    records.push(
      positionEntry({
        ...(token === undefined ? {} : { token }),
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
  reason: string;
}

/**
 * The check of a position record against the chain (section 10.4): whether the record counts. A record of an
 * earlier seed is written again as the new owner's own only when it does (section 10.6).
 */
export type PositionRecordCheck = (record: PositionRecordEntry, wallet: Pick<WalletParts, 'chain' | 'tokenCoins'>, template: ReadTemplate | undefined) => Promise<PositionRecordVerdict>;

/**
 * Where the check of section 10.4 plugs in. It is built in stage 13 of the plan; until then no record counts,
 * so no record of an earlier seed becomes the new owner's own.
 */
export const checkPositionRecord: PositionRecordCheck = async () => ({ counts: false, reason: 'The check of a position record against the chain is not built yet: the record stays a suggestion.' });
