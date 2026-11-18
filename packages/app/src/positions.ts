import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type ChainReader, type TemplateValues, type Utxo, TemplateError, templateLockingBytecode, valueFromBytes } from '@grandmas-wallet/core';
import type { XOTemplate } from '@xo-cash/types';

import { type AuthorityEntry, type ValueSource, isCompanionPosition } from './declaration.js';

/**
 * Finding the position a token controls, from the token, a template's recovery declaration and the chain
 * (proposal sections 12.1, rule 3, and 13.3). No application server, no private note and no secret of a
 * lost device takes part.
 *
 * "Not found" is an ordinary answer: a position can change without the wallet, and a token can be one this
 * template never made.
 */

const hex = binToHex;

/** An authority token as it sits on chain. */
export interface TokenOnChain {
  category: Uint8Array;
  commitment: Uint8Array;
  capability: 'none' | 'mutable' | 'minting';
}

/**
 * - `open`: the position is there.
 * - `closed`: it was there and is no longer; for a position at an address of its own, the address holds nothing now.
 * - `not found`: the chain shows no trace of a position for this token under this entry.
 * - `incomplete`: the position cannot be worked out, with the reason.
 * - `ambiguous`: more than one candidate passes the declaration's checks; none is picked.
 */
export type PositionStatus = 'open' | 'closed' | 'not found' | 'incomplete' | 'ambiguous';

export interface FoundPosition {
  status: PositionStatus;
  /** What the user is told when the status is not `open`. */
  note?: string;
  /** The template's locking script the position is at, and the values it was made with. */
  lockingScript?: string;
  variables: TemplateValues;
  lockingBytecode?: Uint8Array;
  /** The position's coins. */
  coins: Utxo[];
  /** The companion coin the position was found through. */
  companion?: Utxo;
}

const outputsOf = async (chain: ChainReader, transactionId: string): Promise<Output[]> => {
  const raw = await chain.getTransaction(transactionId);
  if (raw === undefined) throw new Error(`The servers do not have transaction ${transactionId}.`);
  const transaction = decodeTransactionBch(hexToBin(raw));
  if (typeof transaction === 'string') throw new Error(`Transaction ${transactionId} cannot be read: ${transaction}`);
  return transaction.outputs;
};

/** The unspent coins at a script, whole. */
export const coinsAt = async (chain: ChainReader, lockingBytecode: Uint8Array): Promise<Utxo[]> => {
  const coins: Utxo[] = [];
  const outputs = new Map<string, Output[]>();
  for (const entry of await chain.listUnspent(lockingBytecode)) {
    const known = outputs.get(entry.transactionId) ?? (await outputsOf(chain, entry.transactionId));
    outputs.set(entry.transactionId, known);
    const output = known[entry.index];
    if (output !== undefined) coins.push({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output });
  }
  return coins;
};

interface Sources {
  token: TokenOnChain;
  companion?: Output;
  position?: Output;
  positionSatoshis?: bigint;
  tokenInputIndex?: number;
}

/**
 * The values a declaration takes from the token and the chain.
 * @throws TemplateError when a source is not available here: the chain does not hold what the declaration asks for
 */
export const valuesFrom = (template: XOTemplate, wanted: Record<string, ValueSource>, sources: Sources): TemplateValues => {
  const values: TemplateValues = {};
  const missing = (variable: string, source: string): never => {
    throw new TemplateError(`"${variable}" is taken from ${source}, which is not at hand.`);
  };
  for (const [variable, source] of Object.entries(wanted)) {
    switch (source) {
      case 'token.category':
        values[variable] = hex(sources.token.category);
        break;
      case 'token.commitment':
        values[variable] = valueFromBytes(template, variable, sources.token.commitment);
        break;
      case 'token.inputIndex':
        values[variable] = sources.tokenInputIndex === undefined ? missing(variable, 'the place of the token among the inputs') : BigInt(sources.tokenInputIndex);
        break;
      case 'companion.commitment':
        values[variable] = sources.companion?.token?.nft === undefined ? missing(variable, 'the companion coin') : valueFromBytes(template, variable, sources.companion.token.nft.commitment);
        break;
      case 'position.commitment':
        values[variable] = sources.position?.token?.nft === undefined ? missing(variable, 'the position\'s own token') : valueFromBytes(template, variable, sources.position.token.nft.commitment);
        break;
      case 'position.valueSatoshis':
        values[variable] = sources.positionSatoshis ?? sources.position?.valueSatoshis ?? missing(variable, 'the position');
        break;
    }
  }
  return values;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Find the position a token controls under one authority entry of a declaration.
 *
 * A problem with a server is thrown, not answered: not being able to look is not the same as finding nothing.
 */
export const findPosition = async (chain: ChainReader, template: XOTemplate, entry: AuthorityEntry, token: TokenOnChain): Promise<FoundPosition> => {
  const place = entry.position;
  if (!isCompanionPosition(place)) {
    let variables: TemplateValues;
    let lockingBytecode: Uint8Array;
    try {
      variables = valuesFrom(template, place.variables, { token });
      lockingBytecode = templateLockingBytecode(template, place.lockingScript, variables);
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return { status: 'incomplete', note: `The position cannot be worked out from the token: ${describe(error)}`, variables: {}, coins: [] };
    }
    const coins = await coinsAt(chain, lockingBytecode);
    const found = { lockingScript: place.lockingScript, variables, lockingBytecode, coins };
    if (coins.length > 0) return { status: 'open', ...found };
    // The address must exist on chain as the template says (section 10.4): a token of another template leads nowhere.
    const used = (await chain.getHistory(lockingBytecode)).length > 0;
    return used ? { status: 'closed', note: 'It holds nothing now.', ...found } : { status: 'not found', note: 'The chain shows nothing at the address this token would lead to.', ...found };
  }

  let companionAt: Uint8Array;
  try {
    companionAt = templateLockingBytecode(template, place.companion.lockingScript, valuesFrom(template, place.companion.variables ?? {}, { token }));
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    return { status: 'incomplete', note: `The companion coin cannot be worked out from the token: ${describe(error)}`, variables: {}, coins: [] };
  }
  const category = hex(token.category);
  const companions = (await coinsAt(chain, companionAt)).filter((coin) => coin.output.token !== undefined && hex(coin.output.token.category) === category);
  if (companions.length === 0) {
    const used = (await chain.getHistory(companionAt)).length > 0;
    return { status: used ? 'closed' : 'not found', note: used ? 'Its companion coin is no longer there.' : 'The chain shows no companion coin for this token.', variables: {}, coins: [] };
  }
  // Each candidate is checked: the category and the distance alone would let a look-alike pass.
  const genuine: { companion: Utxo; position: Utxo; variables: TemplateValues }[] = [];
  const reasons: string[] = [];
  let unchecked = 0;
  for (const companion of companions) {
    const index = companion.index + place.relative;
    const output = (await outputsOf(chain, hex(companion.transactionHash)))[index];
    if (index < 0 || output === undefined) {
      reasons.push('the transaction that made it has no output where the position would be');
      continue;
    }
    let variables: TemplateValues;
    let expected: Uint8Array;
    try {
      variables = valuesFrom(template, place.genuine.variables, { token, companion: companion.output, position: output });
      expected = templateLockingBytecode(template, place.genuine.lockingScript, variables);
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      unchecked += 1;
      reasons.push(describe(error));
      continue;
    }
    if (hex(expected) !== hex(output.lockingBytecode)) {
      reasons.push('what it points at is not at the script the template gives a position');
      continue;
    }
    const wanted = place.genuine.tokenCategory === undefined ? undefined : place.genuine.tokenCategory === 'token.category' ? category : place.genuine.tokenCategory;
    if (wanted !== undefined && (output.token === undefined || hex(output.token.category) !== wanted)) {
      reasons.push('what it points at does not carry the token the template gives a position');
      continue;
    }
    genuine.push({ companion, position: { transactionHash: companion.transactionHash, index, output }, variables });
  }
  if (genuine.length > 1) {
    return { status: 'ambiguous', note: `${genuine.length} coins pass as this token's companion. The wallet picks none.`, variables: {}, coins: [] };
  }
  const [only] = genuine;
  if (only === undefined) {
    if (unchecked > 0) return { status: 'incomplete', note: `The position cannot be checked: ${reasons.join('; ')}.`, variables: {}, coins: [] };
    return { status: 'not found', note: `A coin that looks like this token's companion is not taken for it: ${reasons.join('; ')}.`, variables: {}, coins: [] };
  }
  const unspent = (await chain.listUnspent(only.position.output.lockingBytecode)).some((coin) => coin.transactionId === hex(only.position.transactionHash) && coin.index === only.position.index);
  const found = { lockingScript: place.genuine.lockingScript, variables: only.variables, lockingBytecode: only.position.output.lockingBytecode, companion: only.companion };
  return unspent ? { status: 'open', ...found, coins: [only.position] } : { status: 'closed', note: 'The position has been spent.', ...found, coins: [] };
};
