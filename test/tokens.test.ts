import { type Output, binToHex, cashAddressToLockingBytecode, decodeTransactionBch, encodeLockingBytecodeP2sh32, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type HeldToken, type RecordedPosition, TokenSendError, formatUnits, parseUnits, sendableTokens } from '@grandmas-wallet/app';
import { ADDRESS_KIND, InsufficientFundsError, buildTransaction, p2pkhInput, p2pkhLockingBytecode, smallestOutputValue, walletAddress } from '@grandmas-wallet/core';
import { testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { PlainAddressError, readAddress, tokenDestination } from '../packages/ui/src/address.js';
import { type Device, deviceWith, keyedBox, request, seedOf, strongbox } from './support/applications.js';

/**
 * Acceptance tests TK01 to TK08 of the proposal: receiving and sending tokens, and what the wallet calls them
 * (sections 8 and 13.3). On the simulated chain, with the tests' own templates; no application is named.
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

  it('TK07: after a token that controls a position is sent, the wallet no longer lists it, reports no position for it, and refuses its actions', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const [key] = await device.applications.tokens();
    expect(key).toMatchObject({ meaning: 'position', tokenName: 'Strongbox key' });
    const [position] = await device.applications.recordedPositions();
    expect(position).toMatchObject({ status: 'open', token: { category: key?.category } });
    expect(device.applications.offeredActions(position as RecordedPosition).map(({ action }) => action)).toEqual(['take', 'add']);
    expect((await device.applications.positionsFromRecords(keyedBox.names.identifier))?.length).toBe(1);
    await device.wallet.sendTokens({ kind: 'nft', outpoint: key?.outpoint ?? '', to: payee });
    expect(await device.applications.tokens()).toEqual([]);
    expect(await device.applications.recordedPositions()).toEqual([]);
    expect(await device.applications.positionsFromRecords(keyedBox.names.identifier)).toEqual([]);
    await expect(device.applications.preview(device.applications.actionOn(position as RecordedPosition, 'take'))).rejects.toThrow('holds no such token');
    await expect(device.applications.preview(device.applications.actionOn(position as RecordedPosition, 'add', { amount: 1_000 }))).rejects.toThrow('holds no such token');
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

// ------------------------------------------------------------------ what the wallet calls a token

describe('what the wallet calls a token (section 13.3)', () => {
  it('an NFT a record ties to a template the user trusts by the template\'s name for its output; any other token by its category, in raw units', async () => {
    const device = await deviceWith([100_000n]);
    const credits = mint(device, [{ to: await fresh(device), amount: 12_345n }]);
    const art = mint(device, [{ to: await fresh(device), nft: { capability: 'none', commitment: '0102' } }]);
    await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const listed = await device.applications.tokens();
    const key = listed.find((token) => token.meaning === 'position') as HeldToken;
    expect(key).toMatchObject({ tokenName: 'Strongbox key', template: { identifier: strongbox.names.identifier, name: 'Strongbox' } });
    expect(listed.find((token) => token.category === credits)).toEqual({ category: credits, commitment: '', amount: 12_345n, place: 'address', outpoint: expect.any(String) as string, satoshis: 1_000n, meaning: 'unknown' });
    expect(listed.find((token) => token.category === art)).toMatchObject({ meaning: 'unknown', capability: 'none', commitment: '0102' });
    expect(listed.find((token) => token.category === art)).not.toHaveProperty('tokenName');
    // A fungible balance to send carries no name and no decimals.
    expect(sendableTokens(listed).find((token) => token.kind === 'fungible')).toEqual({ kind: 'fungible', key: `fungible:${credits}`, category: credits, amount: 12_345n, coins: 1, vault: 0n, earlier: 0n, withNfts: 0n });
    // The name is the template's claim, shown only while the user trusts the template.
    await device.applications.forget(strongbox.names.identifier);
    const after = (await device.applications.tokens()).find((token) => token.category === key.category);
    expect(after).toMatchObject({ meaning: 'incomplete', template: { name: 'Strongbox' } });
    expect(after).not.toHaveProperty('tokenName');
    expect(after?.reason).toMatch(/You stopped trusting that template/);
  });

  it('an amount a person types is read in raw units and never rounded', () => {
    expect(parseUnits('12', 0)).toBe(12n);
    expect(parseUnits('1,234', 0)).toBe(1_234n);
    expect(parseUnits('12.5', 0)).toMatch('no decimals');
    expect(parseUnits('12.0', 0)).toBe(12n);
    expect(parseUnits('0', 0)).toMatch('above zero');
    expect(parseUnits('', 0)).toMatch('Enter an amount');
    expect(parseUnits('1e3', 0)).toMatch('whole number');
    expect(parseUnits('-1', 0)).toMatch('whole number');
    expect(parseUnits('9223372036854775807', 0)).toBe(9_223_372_036_854_775_807n);
    expect(parseUnits('9223372036854775808', 0)).toMatch('more than any token output');
    expect(formatUnits(1_234_567n, 0)).toBe('1,234,567');
    // With decimals, should a registry give them later (section 22).
    expect(parseUnits('2.505', 2)).toMatch('2 decimals; the amount has more. Nothing is rounded');
    expect(formatUnits(10_000n, 2)).toBe('100.00');
  });
});
