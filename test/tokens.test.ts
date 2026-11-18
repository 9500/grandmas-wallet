import { type Output, binToHex, cashAddressToLockingBytecode, decodeTransactionBch, encodeLockingBytecodeP2sh32, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type HeldToken, DeclarationError, TokenNames, TokenSendError, checkTemplate, formatUnits, parseUnits, readDeclaration, sendableTokens } from '@grandmas-wallet/app';
import { ADDRESS_KIND, InsufficientFundsError, buildTransaction, p2pkhInput, p2pkhLockingBytecode, readTemplate, smallestOutputValue, walletAddress } from '@grandmas-wallet/core';
import { strongboxDeclaration, strongboxTemplate, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { PlainAddressError, readAddress, tokenDestination } from '../packages/ui/src/address.js';
import { type Device, deviceWith, presentation, request, seedOf, strongbox } from './support/applications.js';

/**
 * Acceptance tests TK01 to TK10 of the proposal: receiving and sending tokens, and their names (sections 8 and
 * 13.3). On the simulated chain, with the tests' own templates; no application is named.
 */

const hex = binToHex;
const payee = p2pkhLockingBytecode(testKey(0x44).keyHash);
const minter = testKey(0xa7);

/** Make a new category, as any token is made, and put its tokens at the given scripts. Returns the category. */
const mint = (device: Device, outputs: { to: Uint8Array; amount?: bigint; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string }; value?: bigint }[]): string => {
  const locking = p2pkhLockingBytecode(minter.keyHash);
  const category = device.chain.fund(locking, 200_000n);
  const [coin] = device.chain.outputsAt(locking).filter((candidate) => hex(candidate.transactionHash) === category);
  if (coin === undefined) throw new Error('minting coin missing');
  const built = buildTransaction({
    inputs: [p2pkhInput(coin, minter)],
    outputs: outputs.map(({ to, amount, nft, value }) => ({
      lockingBytecode: to,
      valueSatoshis: value ?? 1_000n,
      token: { amount: amount ?? 0n, category: hexToBin(category), ...(nft === undefined ? {} : { nft: { capability: nft.capability, commitment: hexToBin(nft.commitment) } }) },
    })),
    changeLockingBytecode: locking,
  });
  expect(device.chain.submit(hex(built.encoded)).accepted).toBe(true);
  return category;
};

const fresh = async (device: Device): Promise<Uint8Array> => (await device.wallet.receiveAddress()).address.lockingBytecode;
const outputsOf = async (device: Device, transactionId: string): Promise<Output[]> => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) as string));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction.outputs;
};
const inputsOf = async (device: Device, transactionId: string): Promise<string[]> => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) as string));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction.inputs.map((input) => `${hex(input.outpointTransactionHash)}:${input.outpointIndex}`);
};
const amountsOf = async (device: Device, category: string): Promise<bigint[]> =>
  (await device.wallet.balance()).tokens.filter((coin) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === category).map((coin) => coin.utxo.output.token?.amount ?? 0n).sort((a, b) => (a < b ? -1 : 1));
const smallest = (output: Output): bigint => smallestOutputValue(output);

describe('receiving tokens', () => {
  it('TK01: every address of the wallet has a token-aware form that decodes to the same locking bytecode', () => {
    const seed = seedOf(0);
    const identity = new Uint8Array(32).fill(0x5a);
    for (const kind of [ADDRESS_KIND.givenOut, ADDRESS_KIND.change, ADDRESS_KIND.vault] as const) {
      const address = walletAddress(identity, seed.viewingKey, kind, 3);
      const plain = cashAddressToLockingBytecode(address.address);
      const tokens = cashAddressToLockingBytecode(address.tokenAddress);
      if (typeof plain === 'string' || typeof tokens === 'string') throw new Error('not an address');
      expect(address.tokenAddress).not.toBe(address.address);
      expect([plain.tokenSupport, tokens.tokenSupport]).toEqual([false, true]);
      expect(hex(tokens.bytecode)).toBe(hex(address.lockingBytecode));
      expect(hex(plain.bytecode)).toBe(hex(address.lockingBytecode));
      // Written as a person would, without the prefix: the same.
      expect(hex(readAddress(address.tokenAddress.split(':')[1] as string, 'testnet').lockingBytecode)).toBe(hex(address.lockingBytecode));
    }
  });

  it('TK02: a token is sent only to an address in the token-aware form, of either type; a plain one is refused before anything is built', () => {
    const script = encodeLockingBytecodeP2sh32(new Uint8Array(32).fill(0x31));
    for (const bytecode of [payee, script]) {
      const plain = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode });
      const tokens = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode, tokenSupport: true });
      if (typeof plain === 'string' || typeof tokens === 'string') throw new Error('not an address');
      expect(hex(tokenDestination(tokens.address, 'testnet'))).toBe(hex(bytecode));
      expect(hex(tokenDestination(tokens.address.toUpperCase(), 'testnet'))).toBe(hex(bytecode));
      expect(() => tokenDestination(plain.address, 'testnet')).toThrow(PlainAddressError);
      expect(() => tokenDestination(plain.address, 'testnet')).toThrow(/can destroy them\. Ask the receiver for their token address/);
      expect(readAddress(plain.address, 'testnet').tokenAware).toBe(false);
    }
    expect(() => tokenDestination('bitcoincash:zz', 'testnet')).toThrow('not a Bitcoin Cash address');
    const mainnet = lockingBytecodeToCashAddress({ prefix: 'bitcoincash', bytecode: payee, tokenSupport: true }) as { address: string };
    expect(() => tokenDestination(mainnet.address, 'testnet')).toThrow('for the main network');
  });
});

describe('sending fungible tokens', () => {
  it('TK03: part of an amount: the wallet gathers what it needs and the rest comes back to a fresh change address; each token output at its smallest value', async () => {
    const device = await deviceWith([20_000n]);
    const category = mint(device, [{ to: await fresh(device), amount: 10_000n }]);
    const quote = await device.wallet.quoteTokens({ kind: 'fungible', category, amount: 2_550n, to: payee });
    const sent = await device.wallet.sendTokens({ kind: 'fungible', category, amount: 2_550n, to: payee });
    expect(sent.quote).toEqual(quote);
    const outputs = await outputsOf(device, sent.transactionId);
    expect(outputs[0]?.token?.amount).toBe(2_550n);
    expect(hex(outputs[0]?.lockingBytecode ?? new Uint8Array())).toBe(hex(payee));
    expect(outputs[0]?.valueSatoshis).toBe(smallest(outputs[0] as Output));
    // The rest of the tokens at a change address of the wallet, then the change in Bitcoin Cash at another.
    expect(outputs[1]?.token?.amount).toBe(7_450n);
    expect(outputs[1]?.valueSatoshis).toBe(smallest(outputs[1] as Output));
    const changes = [device.wallet.address(ADDRESS_KIND.change, 0), device.wallet.address(ADDRESS_KIND.change, 1), device.wallet.address(ADDRESS_KIND.change, 2)].map((address) => hex(address.lockingBytecode));
    expect(changes).toContain(hex(outputs[1]?.lockingBytecode ?? new Uint8Array()));
    expect(changes).toContain(hex(outputs[2]?.lockingBytecode ?? new Uint8Array()));
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).not.toBe(hex(outputs[2]?.lockingBytecode ?? new Uint8Array()));
    expect(outputs[2]?.token).toBeUndefined();
    expect(quote).toMatchObject({ sends: { category, amount: 2_550n }, tokenChange: { category, amount: 7_450n }, tokenCoins: 1, payingCoins: 1, remainderSatoshis: 0n });
    expect(sent.feeSatoshis).toBe(BigInt(sent.bytes));
    expect(await amountsOf(device, category)).toEqual([7_450n]);
  });

  it('TK03: several coins are gathered, the largest first, and "all" sends every unit with no token change', async () => {
    const device = await deviceWith([20_000n]);
    const category = mint(device, [
      { to: await fresh(device), amount: 300n },
      { to: await fresh(device), amount: 500n },
      { to: await fresh(device), amount: 200n },
    ]);
    const [sendable] = sendableTokens(await device.applications.tokens());
    expect(sendable).toMatchObject({ kind: 'fungible', category, amount: 1_000n, coins: 3 });
    const some = await device.wallet.sendTokens({ kind: 'fungible', category, amount: 700n, to: payee });
    expect(some.quote).toMatchObject({ tokenCoins: 2, tokenChange: { amount: 100n } });
    expect(await amountsOf(device, category)).toEqual([100n, 200n]);
    // All of it: whatever is left, in one output.
    const all = await device.wallet.sendTokens({ kind: 'fungible', category, amount: 300n, to: payee });
    expect(all.quote.tokenChange).toBeUndefined();
    expect(all.quote.tokenCoins).toBe(2);
    const outputs = await outputsOf(device, all.transactionId);
    expect(outputs.filter((output) => output.token !== undefined).map((output) => output.token?.amount)).toEqual([300n]);
    expect(await amountsOf(device, category)).toEqual([]);
    await expect(device.wallet.quoteTokens({ kind: 'fungible', category, amount: 1n, to: payee })).rejects.toThrow(TokenSendError);
  });

  it('TK04: the fee never comes from a coin that carries a token; with too little Bitcoin Cash the wallet says so', async () => {
    const device = await deviceWith([]);
    // Token coins that hold far more than the fee: none of it pays.
    const category = mint(device, [
      { to: await fresh(device), amount: 100n, value: 9_000n },
      { to: await fresh(device), amount: 100n, value: 9_000n },
    ]);
    const other = mint(device, [{ to: await fresh(device), amount: 5n, value: 9_000n }]);
    expect((await device.wallet.balance()).recoverable).toBe(0n);
    const refused = device.wallet.quoteTokens({ kind: 'fungible', category, amount: 150n, to: payee });
    await expect(refused).rejects.toThrow(InsufficientFundsError);
    await expect(refused).rejects.toThrow(/does not cover the fee of sending the tokens\. The fee never comes from a coin that carries a token/);
    const error = (await refused.catch((caught: unknown) => caught)) as InsufficientFundsError;
    expect(error.totalSatoshis).toBe(0n);
    expect(error.neededSatoshis).toBeGreaterThan(0n);
    // Bitcoin Cash arrives: it pays the whole fee; what the token coins held beyond their outputs comes back as change.
    const coin = device.chain.fund(await fresh(device), 3_000n);
    const sent = await device.wallet.sendTokens({ kind: 'fungible', category, amount: 150n, to: payee });
    const inputs = await inputsOf(device, sent.transactionId);
    expect(inputs).toContain(`${coin}:0`);
    expect(inputs).toHaveLength(3);
    const outputs = await outputsOf(device, sent.transactionId);
    const tokenOutputs = outputs.filter((output) => output.token !== undefined);
    expect(tokenOutputs.every((output) => output.valueSatoshis === smallest(output))).toBe(true);
    const change = outputs.find((output) => output.token === undefined) as Output;
    // In: 9,000 + 9,000 + 3,000. Out: the two token outputs, the fee, and the rest as change.
    expect(change.valueSatoshis).toBe(21_000n - tokenOutputs.reduce((total, output) => total + output.valueSatoshis, 0n) - sent.feeSatoshis);
    expect(sent.feeSatoshis).toBe(BigInt(sent.bytes));
    expect(sent.quote.payingCoins).toBe(1);
    // The other category was not touched.
    expect(await amountsOf(device, other)).toEqual([5n]);
  });
});

describe('sending NFTs', () => {
  it('TK05: an NFT goes whole, commitment and capability unchanged; a coin with an NFT and an amount moves whole, and is not taken for an amount', async () => {
    const device = await deviceWith([20_000n]);
    const category = mint(device, [
      { to: await fresh(device), nft: { capability: 'mutable', commitment: 'c0ffee' } },
      { to: await fresh(device), amount: 40n, nft: { capability: 'none', commitment: '01' } },
    ]);
    const held = await device.applications.tokens();
    const sendable = sendableTokens(held);
    // The amount on the NFT's coin is not offered as an amount to send.
    expect(sendable.filter((entry) => entry.kind === 'fungible')).toEqual([]);
    expect(sendable.filter((entry) => entry.kind === 'nft')).toHaveLength(2);
    await expect(device.wallet.quoteTokens({ kind: 'fungible', category, amount: 10n, to: payee })).rejects.toThrow('holds 0 units');
    const both = held.find((token) => token.amount === 40n) as HeldToken;
    const sent = await device.wallet.sendTokens({ kind: 'nft', outpoint: both.outpoint, to: payee });
    const [moved] = await outputsOf(device, sent.transactionId);
    expect(moved?.token).toEqual({ category: hexToBin(category), amount: 40n, nft: { capability: 'none', commitment: hexToBin('01') } });
    expect(sent.quote.tokenChange).toBeUndefined();
    const mutable = (await device.applications.tokens()).find((token) => token.capability === 'mutable') as HeldToken;
    const second = await device.wallet.sendTokens({ kind: 'nft', outpoint: mutable.outpoint, to: payee });
    expect((await outputsOf(device, second.transactionId))[0]?.token).toEqual({ category: hexToBin(category), amount: 0n, nft: { capability: 'mutable', commitment: hexToBin('c0ffee') } });
    expect(await device.applications.tokens()).toEqual([]);
  });

  it('TK06: a token at a vault address is moved to an ordinary address first; then it can be sent', async () => {
    const device = await deviceWith([30_000n]);
    const vault = (await device.wallet.vaultAddress()).address.lockingBytecode;
    mint(device, [{ to: vault, nft: { capability: 'none', commitment: 'aa' } }]);
    const [atVault] = await device.applications.tokens();
    expect(atVault?.place).toBe('vault');
    await expect(device.wallet.quoteTokens({ kind: 'nft', outpoint: atVault?.outpoint ?? '', to: payee })).rejects.toThrow('moved to an ordinary address of the wallet first');
    const moved = await device.wallet.moveVaultTokens();
    expect(moved.coins).toBe(1);
    const [ordinary] = await device.applications.tokens();
    expect(ordinary?.place).toBe('address');
    await device.wallet.sendTokens({ kind: 'nft', outpoint: ordinary?.outpoint ?? '', to: payee });
    expect(await device.applications.tokens()).toEqual([]);
  });

  it('TK07: after a token that controls a position is sent, the wallet no longer lists it and offers nothing for it', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const [key] = await device.applications.tokens();
    expect(key).toMatchObject({ meaning: 'position', position: { status: 'open' } });
    expect((await device.applications.positions(strongbox.names.identifier))?.length).toBe(1);
    await device.wallet.sendTokens({ kind: 'nft', outpoint: key?.outpoint ?? '', to: payee });
    expect(await device.applications.tokens()).toEqual([]);
    expect(await device.applications.positions(strongbox.names.identifier)).toEqual([]);
    await expect(device.applications.preview(device.applications.actionOn(key as HeldToken, 'take'))).rejects.toThrow('holds no such token');
  });
});

describe('recovery and tokens', () => {
  it('TK08: after a recovery and the sweep, the new device sends a swept fungible amount and a swept NFT', async () => {
    const device = await deviceWith([50_000n]);
    const units = mint(device, [{ to: await fresh(device), amount: 1_000n }]);
    const art = mint(device, [{ to: await fresh(device), nft: { capability: 'none', commitment: '0102' } }]);
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    const swept = await taken.wallet.sweepEarlier();
    expect(swept.tokens.map((token) => token.category).sort()).toEqual([units, art].sort());
    const part = await taken.wallet.sendTokens({ kind: 'fungible', category: units, amount: 400n, to: payee });
    expect((await outputsOf(taken, part.transactionId))[0]?.token?.amount).toBe(400n);
    expect(await amountsOf(taken, units)).toEqual([600n]);
    const nft = (await taken.applications.tokens()).find((token) => token.category === art) as HeldToken;
    const sent = await taken.wallet.sendTokens({ kind: 'nft', outpoint: nft.outpoint, to: payee });
    expect((await outputsOf(taken, sent.transactionId))[0]?.token).toEqual({ category: hexToBin(art), amount: 0n, nft: { capability: 'none', commitment: hexToBin('0102') } });
  }, 60_000);
});

// ------------------------------------------------------------------ names

const CREDITS = 'c1'.repeat(32);
/** The test template, with an output of credits of a fixed category, so that it deals in a category it names. */
const creditsTemplate = {
  ...strongboxTemplate,
  name: 'Strongbox with credits',
  outputs: { ...strongboxTemplate.outputs, creditsOutput: { name: 'Credits', description: 'Credits.', lockingScript: '$(<holder>)', valueSatoshis: '1000', token: { category: CREDITS, amount: '100', nft: null } } },
};
const named = (tokens: object, template: unknown = creditsTemplate, name?: string) => presentation(name === undefined ? template : { ...(template as object), name }, { ...strongboxDeclaration, tokens });

describe('the template\'s names for its tokens', () => {
  it('TK09: are read from the declaration, and refused when malformed; a declaration without them reads as before', () => {
    const { texts } = named({ credits: { kind: 'fungible', category: CREDITS, name: 'Club credits', symbol: 'CRD', decimals: 2 }, key: { kind: 'nft', authority: 'boxKey', name: 'Box key' } });
    expect(readDeclaration(texts.declaration as string).declaration.tokens).toEqual({
      credits: { kind: 'fungible', category: CREDITS, name: 'Club credits', symbol: 'CRD', decimals: 2 },
      key: { kind: 'nft', authority: 'boxKey', name: 'Box key' },
    });
    expect(readDeclaration(strongbox.texts.declaration as string).declaration.tokens).toBeUndefined();
    const read = (tokens: object) => () => readDeclaration(named(tokens).texts.declaration as string);
    expect(read({ a: { kind: 'fungible', category: CREDITS, name: 'Credits', decimals: 2 } })).toThrow('no symbol');
    expect(read({ a: { kind: 'fungible', category: CREDITS, name: 'Credits', symbol: 'CRD' } })).toThrow('decimals');
    expect(read({ a: { kind: 'fungible', category: CREDITS, name: 'Credits', symbol: 'CRD', decimals: 19 } })).toThrow('decimals');
    expect(read({ a: { kind: 'nft', authority: 'boxKey', name: 'Key', decimals: 0 } })).toThrow('gives decimals to NFTs');
    expect(read({ a: { kind: 'nft', category: CREDITS, authority: 'boxKey', name: 'Key' } })).toThrow('not both');
    expect(read({ a: { kind: 'nft', name: 'Key' } })).toThrow('either a category or an authority entry');
    expect(read({ a: { kind: 'coin', category: CREDITS, name: 'Key' } })).toThrow('neither "fungible" nor "nft"');
    expect(read({ a: { kind: 'nft', category: 'C1'.repeat(32), name: 'Key' } })).toThrow('64 hexadecimal digits');
    expect(read({ a: { kind: 'nft', authority: 'boxKey', name: 'Key‮yek' } })).toThrow('no name a wallet can show');
    expect(read({ a: { kind: 'nft', authority: 'boxKey', name: ' Key' } })).toThrow('no name a wallet can show');
    expect(read({ a: { kind: 'fungible', category: CREDITS, name: 'Credits', symbol: 'C R D', decimals: 2 } })).toThrow('symbol');
    expect(read([])).toThrow(DeclarationError);
  });

  it('TK09: a description that does not match the template is a violation, and such a template is not taken in', async () => {
    const verdict = (tokens: object) => {
      const { texts } = named(tokens);
      return checkTemplate(readTemplate(texts.template), readDeclaration(texts.declaration as string));
    };
    expect(verdict({ credits: { kind: 'fungible', category: CREDITS, name: 'Credits', symbol: 'CRD', decimals: 2 }, key: { kind: 'nft', authority: 'boxKey', name: 'Box key' } }).statement).toBe('not verified');
    const violations = (tokens: object): string[] => {
      const found = verdict(tokens);
      return found.statement === 'violation' ? found.violations.map((violation) => `${violation.rule}: ${violation.what}`) : [];
    };
    // A category the template never deals in: a name for someone else's tokens.
    expect(violations({ other: { kind: 'fungible', category: 'ab'.repeat(32), name: 'Dollars', symbol: 'USD', decimals: 2 } })).toEqual([expect.stringMatching(/^names: .*"Dollars", and the template deals in no token of that category/)]);
    expect(violations({ credits: { kind: 'nft', category: CREDITS, name: 'Credit card' } })).toEqual([expect.stringMatching(/deals in no NFT of that category/)]);
    expect(violations({ key: { kind: 'nft', authority: 'lockerKey', name: 'Key' } })).toEqual([expect.stringMatching(/authority entry "lockerKey", which it does not have/)]);
    expect(violations({ key: { kind: 'fungible', authority: 'boxKey', name: 'Key', symbol: 'K', decimals: 0 } })).toEqual([expect.stringMatching(/an authority token is an NFT/)]);
    expect(violations({ a: { kind: 'nft', authority: 'boxKey', name: 'Key' }, b: { kind: 'nft', authority: 'boxKey', name: 'Other key' } })).toEqual([expect.stringMatching(/describes the same tokens twice; "b"/)]);
    const device = await deviceWith([100_000n]);
    const lying = named({ other: { kind: 'fungible', category: 'ab'.repeat(32), name: 'Dollars', symbol: 'USD', decimals: 2 } });
    await expect(device.applications.trust(lying.names, lying.texts)).rejects.toThrow('the names it gives tokens');
  });

  it('TK10: names come only from templates the user trusts, say which template gives them, and are not used when two trusted templates disagree', async () => {
    const device = await deviceWith([100_000n]);
    const credits = mint(device, [{ to: await fresh(device), amount: 12_345n }]);
    const described = { credits: { kind: 'fungible', category: credits, name: 'Club credits', symbol: 'CRD', decimals: 2 }, key: { kind: 'nft', authority: 'boxKey', name: 'Box key' } };
    const template = { ...creditsTemplate, outputs: { ...creditsTemplate.outputs, creditsOutput: { ...creditsTemplate.outputs.creditsOutput, token: { ...creditsTemplate.outputs.creditsOutput.token, category: credits } } } };
    const first = named(described, template, 'First box');
    // Presented and not trusted: no name.
    device.applications.describe(first.names, first.texts);
    expect((await device.applications.tokens())[0]?.names).toBeUndefined();
    // Trusted: the name, the symbol and the decimals, from that template.
    await device.applications.carryOut(request(first, 'open', 'holder', { amount: 30_000, label: '01' }));
    const listed = await device.applications.tokens();
    const units = listed.find((token) => token.category === credits);
    expect(units?.names?.fungible).toEqual({ named: { name: 'Club credits', symbol: 'CRD', decimals: 2, from: [{ identifier: first.names.identifier, name: 'First box' }] } });
    expect(formatUnits(units?.amount ?? 0n, 2)).toBe('123.45');
    // The key is named through the authority entry it was found to be, whatever its own category.
    const key = listed.find((token) => token.meaning === 'position');
    expect(key?.names?.nft?.named?.name).toBe('Box key');
    expect(key?.names?.fungible).toBeUndefined();
    // A second trusted template that agrees adds itself as a source; one that disagrees makes the name unused.
    const agreeing = named({ credits: described.credits }, template, 'Second box');
    await device.applications.trust(agreeing.names, agreeing.texts);
    expect(device.applications.names().fungible(credits)?.named?.from.map((source) => source.name)).toEqual(['First box', 'Second box']);
    const other = named({ credits: { ...described.credits, name: 'Gold', symbol: 'GLD', decimals: 0 } }, template, 'Third box');
    await device.applications.trust(other.names, other.texts);
    const disputed = (await device.applications.tokens()).find((token) => token.category === credits)?.names?.fungible;
    expect(disputed?.named).toBeUndefined();
    expect(disputed?.disputed?.map((claim) => [claim.name, claim.decimals, claim.from.name])).toEqual([
      ['Club credits', 2, 'First box'],
      ['Club credits', 2, 'Second box'],
      ['Gold', 0, 'Third box'],
    ]);
    // The key's own name is not disputed by the credits.
    expect((await device.applications.tokens()).find((token) => token.meaning === 'position')?.names?.nft?.named?.name).toBe('Box key');
    expect(TokenNames.none.fungible(credits)).toBeUndefined();
  }, 60_000);

  it('TK10: amounts are typed in the token\'s decimals and never rounded', () => {
    expect(parseUnits('100', 2)).toBe(10_000n);
    expect(parseUnits('1,234.5', 2)).toBe(123_450n);
    expect(parseUnits('0.01', 2)).toBe(1n);
    expect(parseUnits('.5', 2)).toBe(50n);
    expect(parseUnits('2.50', 2)).toBe(250n);
    expect(parseUnits('2.500', 2)).toBe(250n);
    expect(parseUnits('2.505', 2)).toMatch('2 decimals; the amount has more. Nothing is rounded');
    expect(parseUnits('0.001', 2)).toMatch('Nothing is rounded');
    expect(parseUnits('12', 0)).toBe(12n);
    expect(parseUnits('12.5', 0)).toMatch('no decimals');
    expect(parseUnits('0', 2)).toMatch('above zero');
    expect(parseUnits('', 2)).toMatch('Enter an amount');
    expect(parseUnits('1e3', 2)).toMatch('as a number');
    expect(parseUnits('-1', 2)).toMatch('as a number');
    expect(parseUnits('9223372036854775808', 0)).toMatch('more than any token output');
    expect(formatUnits(10_000n, 2)).toBe('100.00');
    expect(formatUnits(5n, 2)).toBe('0.05');
    expect(formatUnits(1_234_567n, 0)).toBe('1,234,567');
    expect(formatUnits(1n, 8)).toBe('0.00000001');
  });

  it('TK10: a wallet that trusted a declaration keeps working with it, and takes a new one on the user\'s word when it is presented', async () => {
    const device = await deviceWith([100_000n]);
    const before = presentation(creditsTemplate, strongboxDeclaration);
    await device.applications.carryOut(request(before, 'open', 'holder', { amount: 30_000, label: '01' }));
    const after = named({ key: { kind: 'nft', authority: 'boxKey', name: 'Box key' } });
    expect(after.names.identifier).toBe(before.names.identifier);
    expect(after.names.declaration).not.toBe(before.names.declaration);
    // Asked with the new declaration's name: the wallet asks for the texts.
    expect(device.applications.has(after.names)).toBe(false);
    // With the texts: shown as a template to be trusted again, and nothing is taken in by looking.
    const summary = device.applications.describe(after.names, after.texts);
    expect(summary).toMatchObject({ trusted: false, replacesDeclaration: true });
    const key = (await device.applications.tokens()).find((token) => token.meaning === 'position') as HeldToken;
    expect(key.names).toBeUndefined();
    // The action the wallet offers from its own list goes on with the declaration it has.
    const preview = await device.applications.preview(device.applications.actionOn(key, 'add', { amount: 1_000 }));
    expect(preview.template.declaration).toBe(before.names.declaration);
    // Approved with the new one: it takes the earlier one's place, is stored again first, and names the key.
    const outcome = await device.applications.carryOut(request(after, 'add', 'holder', { amount: 1_000 }, { tokens: [key.category] }));
    expect(outcome.transactionId).toMatch(/^[0-9a-f]{64}$/);
    expect(device.applications.has(after.names)).toBe(true);
    expect(device.applications.templates.find((template) => template.identifier === after.names.identifier)).toMatchObject({ declaration: { contentHash: after.names.declaration }, stored: true });
    expect((await device.applications.tokens()).find((token) => token.meaning === 'position')?.names?.nft?.named?.name).toBe('Box key');
  }, 60_000);
});
