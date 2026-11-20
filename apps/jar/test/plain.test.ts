import { binToHex, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { readTemplate, smallestOutputValue, templateLockingBytecode, templateUnlockingBytecode } from '@grandmas-wallet/core';
import { savingsJarScript, savingsJarV4TemplateText, unlockTimeBytes } from '@grandmas-wallet/savings-jar';
import { SimulatedChain, ordinaryWallet } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { KEY_SATOSHIS } from '../src/jar.js';
import {
  type SignRequest,
  NotEnoughError,
  PlainWallet,
  TooEarlyError,
  addressScriptAt,
  checkAndSend,
  checkSigned,
  findJars,
  networkOf,
  prepareDeposit,
  prepareOpen,
  prepareWithdrawal,
  readPaths,
  scanWallet,
} from '../src/plain.js';

/**
 * The Savings Jar page with an ordinary wallet: a wallet written from the WizardConnect description, which
 * shares the public keys of its address chains and signs the inputs it is told to, on the simulated chain.
 * Every request goes through JSON and back, as it travels.
 */

const overTheWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * An ordinary wallet with coins at its first receiving addresses.
 * @param outputIndex - where the chain puts each coin in its transaction; 0 makes coins that can start a key
 */
const setUp = (coins: bigint[] = [50_000n], outputIndex = 0, seedByte = 7) => {
  const chain = new SimulatedChain();
  const wallet = ordinaryWallet(new Uint8Array(32).fill(seedByte));
  const paths = readPaths(wallet.paths);
  coins.forEach((value, index) => chain.fund(addressScriptAt(paths.receive, index), value, outputIndex));
  const requests: SignRequest[] = [];
  const sign = async (request: SignRequest): Promise<string> => {
    requests.push(request);
    return wallet.sign(overTheWire(request));
  };
  const plain = new PlainWallet(chain, paths, sign);
  const now = Math.floor(chain.nowMs / 1000);
  return { chain, wallet, paths, plain, requests, unlockTime: now + 3_600 };
};

const pass = (chain: SimulatedChain, seconds: number): void => {
  chain.nowMs += seconds * 1000;
};

/** The same wallet's keys, read by a page that has never seen it: nothing remembered, only the chain. */
const freshPage = (chain: SimulatedChain, paths: ReturnType<typeof readPaths>) => new PlainWallet(chain, paths, () => Promise.reject(new Error('no signing here')));

describe('savings jars with an ordinary wallet', () => {
  it('finds the wallet\'s coins from its public keys, coins with tokens included', async () => {
    const { chain, paths, plain, unlockTime } = setUp([30_000n, 20_000n, 5_000n]);
    chain.fund(addressScriptAt(paths.change, 4), 1_000n);
    const before = await scanWallet(chain, paths);
    expect(before.balance).toBe(56_000n);
    expect(before.coins).toHaveLength(4);
    expect(before.tokens).toEqual([]);
    expect(before.next).toEqual({ receive: 3, change: 5 });
    expect(networkOf(paths)).toBe('testnet');

    await plain.open(10_000n, unlockTime);
    const after = await scanWallet(chain, paths);
    // The key is a coin of the wallet like any other, at the address after the last one used, with its token read in full.
    expect(after.tokens).toHaveLength(1);
    expect(after.tokens[0]).toMatchObject({ chain: 'receive', addressIndex: 3, output: { valueSatoshis: KEY_SATOSHIS, token: { amount: 0n, nft: { capability: 'none' } } } });
    expect(after.coins.every((coin) => coin.output.token === undefined)).toBe(true);
  });

  it('opens a jar from a coin that is the first output of its transaction: one signature, the key made in the same transaction that funds the jar', async () => {
    const { chain, paths, plain, requests, unlockTime } = setUp([50_000n]);
    const [genesis] = (await scanWallet(chain, paths)).coins;
    const opened = await plain.open(20_000n, unlockTime);
    expect(opened.prepared).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.transaction.userPrompt).toContain('Open a savings jar with 20,000 satoshis');
    // The key's category is the identifier of the transaction whose first output was spent.
    expect(opened.category).toBe(genesis?.transactionId);
    const script = savingsJarScript(hexToBin(opened.category), unlockTime);
    expect(chain.balanceOf(script.lockingBytecode)).toBe(20_000n);

    const transaction = decodeTransactionBch(hexToBin((await chain.getTransaction(opened.transactionId)) as string));
    if (typeof transaction === 'string') throw new Error(transaction);
    expect(binToHex(transaction.inputs[0]?.outpointTransactionHash ?? new Uint8Array())).toBe(opened.category);
    expect(transaction.inputs[0]?.outpointIndex).toBe(0);
    const [jarOutput, keyOutput, change] = transaction.outputs;
    expect(binToHex(jarOutput?.lockingBytecode ?? new Uint8Array())).toBe(binToHex(script.lockingBytecode));
    expect(keyOutput?.token).toMatchObject({ amount: 0n, nft: { capability: 'none' } });
    expect(binToHex(keyOutput?.token?.category ?? new Uint8Array())).toBe(opened.category);
    for (const output of transaction.outputs) expect(output.valueSatoshis).toBeGreaterThanOrEqual(smallestOutputValue(output));
    // What was not put aside came back as change, less a fee of about one satoshi per byte.
    const size = BigInt(encodeTransactionBch(transaction).length);
    const fee = 50_000n - 20_000n - KEY_SATOSHIS - (change?.valueSatoshis ?? 0n);
    expect(fee).toBeGreaterThanOrEqual(size);
    expect(fee).toBeLessThan(size + 20n);
  });

  it('opens a jar when no coin is the first output of its transaction: the wallet is first asked to pay itself, and the page says why', async () => {
    const { chain, paths, plain, requests, unlockTime } = setUp([30_000n, 25_000n], 1);
    const steps: string[] = [];
    const opened = await plain.open(40_000n, unlockTime, (step) => steps.push(step));
    expect(opened.prepared).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.transaction.userPrompt).toContain('to prepare a savings jar');
    expect(steps.some((step) => step.startsWith('Step 1 of 2') && step.includes('first output of its transaction'))).toBe(true);
    expect(steps.some((step) => step.startsWith('Step 2 of 2'))).toBe(true);
    expect(chain.balanceOf(savingsJarScript(hexToBin(opened.category), unlockTime).lockingBytecode)).toBe(40_000n);
    // The payment to itself made a coin that is output 0: the key's category is that transaction's identifier.
    const first = decodeTransactionBch(hexToBin((await chain.getTransaction(opened.category)) as string));
    if (typeof first === 'string') throw new Error(first);
    expect(binToHex(first.outputs[0]?.lockingBytecode ?? new Uint8Array())).toBe(binToHex(addressScriptAt(paths.change, 0)));
    expect((await findJars(chain, await scanWallet(chain, paths))).map((jar) => jar.category)).toEqual([opened.category]);
  });

  it('refuses a jar the wallet\'s coins cannot pay for', async () => {
    const { chain, paths, plain, unlockTime } = setUp([10_000n]);
    const scan = await scanWallet(chain, paths);
    expect(() => prepareOpen(paths, scan, 9_000n, unlockTime)).toThrow(NotEnoughError);
    await expect(plain.open(9_000n, unlockTime)).rejects.toThrow('does not cover');
    expect(chain.broadcasts).toBe(0);
  });

  it('a jar\'s whole course: found again from the wallet\'s keys alone, paid into, not emptied before its date, emptied after it with the key back in the wallet, and the same key empties a later deposit', async () => {
    const { chain, paths, plain, unlockTime } = setUp([60_000n, 20_000n]);
    const opened = await plain.open(25_000n, unlockTime);
    const script = savingsJarScript(hexToBin(opened.category), unlockTime);

    // Another browser that knows nothing but the wallet's public keys finds the jar from the key it holds.
    const elsewhere = freshPage(chain, paths);
    expect(await elsewhere.jars()).toMatchObject([{ category: opened.category, unlockTime, satoshis: 25_000n, status: 'open', lockingBytecode: binToHex(script.lockingBytecode) }]);

    // Paying in: the wallet itself, and someone else with an ordinary payment to the jar's address.
    const [jar] = await plain.jars();
    if (jar === undefined) throw new Error('no jar');
    await plain.deposit(jar, 7_000n);
    chain.fund(script.lockingBytecode, 3_000n);
    expect((await elsewhere.jars())[0]).toMatchObject({ satoshis: 35_000n, coins: [{}, {}, {}] });

    // Before the date the network refuses it, and the jar keeps everything.
    const balanceBefore = (await scanWallet(chain, paths)).balance;
    await expect(plain.withdraw(opened.category)).rejects.toBeInstanceOf(TooEarlyError);
    expect(chain.balanceOf(script.lockingBytecode)).toBe(35_000n);

    // After it, the savings come to the wallet less the fee, and the key comes back to it.
    pass(chain, 3_700);
    const emptied = await plain.withdraw(opened.category);
    expect(chain.balanceOf(script.lockingBytecode)).toBe(0n);
    const after = await scanWallet(chain, paths);
    const transaction = decodeTransactionBch(hexToBin((await chain.getTransaction(emptied)) as string));
    if (typeof transaction === 'string') throw new Error(transaction);
    expect(transaction.locktime).toBe(unlockTime);
    const size = BigInt(encodeTransactionBch(transaction).length);
    const received = after.balance - balanceBefore;
    expect(received).toBeLessThanOrEqual(35_000n - size);
    expect(received).toBeGreaterThan(35_000n - size - 20n);
    expect(after.tokens.map((coin) => binToHex(coin.output.token?.category ?? new Uint8Array()))).toEqual([opened.category]);
    expect(await elsewhere.jars()).toMatchObject([{ category: opened.category, satoshis: 0n, status: 'empty' }]);

    // Someone pays in again; the same key empties it.
    chain.fund(script.lockingBytecode, 9_000n);
    expect((await elsewhere.jars())[0]).toMatchObject({ satoshis: 9_000n, status: 'open' });
    await plain.withdraw(opened.category);
    expect(chain.balanceOf(script.lockingBytecode)).toBe(0n);
    expect((await scanWallet(chain, paths)).tokens).toHaveLength(1);
  });

  it('makes the jar the template of version 4 describes, so that both kinds of wallet use one contract: the jar\'s address and the date on the key as the template gives them, and a withdrawal with the key at input 0 and the jar unlocked as the template unlocks it', async () => {
    const { chain, paths, plain, unlockTime } = setUp([60_000n]);
    const opened = await plain.open(25_000n, unlockTime);
    const { definition } = readTemplate(savingsJarV4TemplateText);
    const values = { keyCategory: opened.category, unlockTime: BigInt(unlockTime) };
    const jarAddress = binToHex(templateLockingBytecode(definition, 'savingsJarLockingScript', values));
    const read = async (transactionId: string) => {
      const transaction = decodeTransactionBch(hexToBin((await chain.getTransaction(transactionId)) as string));
      if (typeof transaction === 'string') throw new Error(transaction);
      return transaction;
    };
    const opening = await read(opened.transactionId);
    expect(binToHex(opening.outputs[0]?.lockingBytecode ?? new Uint8Array())).toBe(jarAddress);
    expect(binToHex(opening.outputs[1]?.token?.nft?.commitment ?? new Uint8Array())).toBe(binToHex(unlockTimeBytes(unlockTime)));

    pass(chain, 3_700);
    const emptied = await read(await plain.withdraw(opened.category));
    // Input 0 spends the key, where the template's own input for it sits; the jar's coin after it, unlocked for a key there.
    const [keyInput, jarInput] = emptied.inputs;
    const spentKey = (await read(binToHex(keyInput?.outpointTransactionHash ?? new Uint8Array()))).outputs[keyInput?.outpointIndex ?? -1];
    expect(binToHex(spentKey?.token?.category ?? new Uint8Array())).toBe(opened.category);
    expect(binToHex(jarInput?.unlockingBytecode ?? new Uint8Array())).toBe(binToHex(templateUnlockingBytecode(definition, 'savingsJarLockingScript', 'savingsJarInput', values)));
    // The simulated chain ran every input in the virtual machine before it took the transaction.
    expect(chain.balanceOf(hexToBin(jarAddress))).toBe(0n);
    expect((await scanWallet(chain, paths)).tokens.map((coin) => binToHex(coin.output.token?.category ?? new Uint8Array()))).toEqual([opened.category]);
  });

  it('sends nothing that the wallet altered on its way back, or that another wallet signed', async () => {
    const { chain, wallet, paths, plain, unlockTime } = setUp([60_000n]);
    const opened = await plain.open(20_000n, unlockTime);
    pass(chain, 3_700);
    const scan = await plain.scan();
    const [jar] = await plain.jars(scan);
    if (jar === undefined) throw new Error('no jar');
    const withdrawal = prepareWithdrawal(paths, scan, jar);
    // Only the wallet's own input is named; the jar's inputs carry their unlocking scripts already and need no signature.
    expect(withdrawal.request.inputPaths).toEqual([[0, 'receive', scan.tokens[0]?.addressIndex ?? -1]]);
    expect(withdrawal.request.transaction.sourceOutputs[0]?.['token']).toMatchObject({ category: opened.category, amount: '<bigint: 0n>', nft: { capability: 'none' } });
    const signed = wallet.sign(overTheWire(withdrawal.request));
    const decoded = decodeTransactionBch(hexToBin(signed));
    if (typeof decoded === 'string') throw new Error(decoded);
    const broadcasts = chain.broadcasts;

    // The payout turned to someone else's address.
    const elsewhere = addressScriptAt(readPaths(ordinaryWallet(new Uint8Array(32).fill(9)).paths).receive, 0);
    const redirected = { ...decoded, outputs: decoded.outputs.map((output, index) => (index === 1 ? { ...output, lockingBytecode: elsewhere } : output)) };
    await expect(checkAndSend(chain, withdrawal, binToHex(encodeTransactionBch(redirected)))).rejects.toThrow('different transaction');
    // The key left out of the outputs.
    const keyless = { ...decoded, outputs: decoded.outputs.slice(1) };
    expect(() => checkSigned(withdrawal, binToHex(encodeTransactionBch(keyless)))).toThrow('different transaction');
    // A jar input's unlocking script changed, though the wallet was not asked to sign it.
    const meddled = { ...decoded, inputs: decoded.inputs.map((input, index) => (index === 1 ? { ...input, unlockingBytecode: jar.script.unlock(1) } : input)) };
    expect(() => checkSigned(withdrawal, binToHex(encodeTransactionBch(meddled)))).toThrow('different transaction');
    // Another lock time.
    expect(() => checkSigned(withdrawal, binToHex(encodeTransactionBch({ ...decoded, locktime: unlockTime + 1 })))).toThrow('different transaction');
    // Signed by a wallet that does not hold the key.
    const stranger = ordinaryWallet(new Uint8Array(32).fill(9));
    await expect(checkAndSend(chain, withdrawal, stranger.sign(overTheWire(withdrawal.request)))).rejects.toThrow('does not pass the network\'s rules');
    // Not a transaction at all.
    expect(() => checkSigned(withdrawal, 'zz')).toThrow('not a transaction');
    expect(chain.broadcasts).toBe(broadcasts);

    // What the wallet did sign goes through.
    await checkAndSend(chain, withdrawal, signed);
    expect(chain.balanceOf(jar.script.lockingBytecode)).toBe(0n);
  });

  it('a deposit leaves no output below its smallest value: a leftover too small for change goes to the fee', async () => {
    const { chain, paths, unlockTime, wallet } = setUp([20_000n]);
    const plain = new PlainWallet(chain, paths, async (request) => wallet.sign(overTheWire(request)));
    const { category } = await plain.open(5_000n, unlockTime);
    const lockingBytecode = binToHex(savingsJarScript(hexToBin(category), unlockTime).lockingBytecode);
    const scan = await plain.scan();
    // Just under everything the wallet has: what would be left is less than a change output may hold.
    const deposit = prepareDeposit(paths, scan, { lockingBytecode, unlockTime }, scan.balance - 600n);
    expect(deposit.transaction.outputs).toHaveLength(1);
    expect(deposit.fee).toBe(600n);
    await checkAndSend(chain, deposit, wallet.sign(overTheWire(deposit.request)));
    expect(chain.balanceOf(hexToBin(lockingBytecode))).toBe(5_000n + scan.balance - 600n);
  });

  it('a token of the wallet that is not a jar\'s key is not taken for one', async () => {
    const { chain, plain, unlockTime } = setUp([40_000n, 30_000n]);
    const { category } = await plain.open(10_000n, unlockTime);
    // A key of a jar that was never paid into: same kind of token, but no jar on chain for it.
    const scan = await plain.scan();
    const [key] = scan.tokens;
    if (key === undefined) throw new Error('no key');
    const notAJar = { ...key, output: { ...key.output, token: { ...(key.output.token as NonNullable<typeof key.output.token>), nft: { capability: 'none' as const, commitment: Uint8Array.of(0x01, 0x02, 0x03, 0x04, 0x05, 0x06) } } } };
    const jars = await findJars(chain, { tokens: [key, notAJar] });
    expect(jars.map((jar) => jar.category)).toEqual([category]);
  });
});
