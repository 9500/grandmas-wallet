import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { SimulatedChain, ordinaryWallet } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import {
  type WalletPaths,
  SMALLEST_JAR,
  TooEarlyError,
  addressScriptAt,
  checkAndSend,
  findUnlockTimes,
  jarKey,
  jarScript,
  loadJar,
  networkOf,
  prepareDeposit,
  prepareWithdrawal,
  readPaths,
  scanWallet,
} from '../src/plain.js';

const setUp = (coins: bigint[] = [50_000n]) => {
  const chain = new SimulatedChain();
  const wallet = ordinaryWallet(new Uint8Array(32).fill(7));
  const paths: WalletPaths = readPaths(wallet.paths);
  coins.forEach((value, index) => chain.fund(addressScriptAt(paths.receive, index), value));
  const unlockTime = Math.floor(chain.nowMs / 1000) + 3_600;
  return { chain, wallet, paths, unlockTime };
};

/** JSON and back, as a request travels. */
const overTheWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('savings jars with an ordinary wallet', () => {
  it('finds the wallet\'s coins from its public keys', async () => {
    const { chain, paths } = setUp([10_000n, 20_000n, 5_000n]);
    chain.fund(addressScriptAt(paths.change, 4), 1_000n);
    const scan = await scanWallet(chain, paths);
    expect(scan.balance).toBe(36_000n);
    expect(scan.coins).toHaveLength(4);
    expect(scan.next).toEqual({ receive: 3, change: 5 });
    expect(networkOf(paths)).toBe('testnet');
  });

  it('opens a jar: the wallet signs a payment it could have been asked for by anyone', async () => {
    const { chain, wallet, paths, unlockTime } = setUp();
    const deposit = prepareDeposit(paths, await scanWallet(chain, paths), 20_000n, unlockTime, 'Holiday');
    const transactionId = await checkAndSend(chain, deposit, wallet.sign(overTheWire(deposit.request)));
    expect(wallet.lastPrompt).toContain('Holiday');

    const jar = await loadJar(chain, paths, unlockTime);
    expect(jar.held).toBe(20_000n);
    expect(jar.outputs[0]?.transactionId).toBe(transactionId);
    // What was not put aside came back to the wallet's change addresses, less the fee.
    const after = await scanWallet(chain, paths);
    expect(after.balance).toBe(50_000n - 20_000n - deposit.fee);
    expect(deposit.fee).toBeLessThan(400n);
    expect(after.next.change).toBe(1);
  });

  it('spends several coins when one is not enough, and none it does not need', async () => {
    const { chain, wallet, paths, unlockTime } = setUp([3_000n, 9_000n, 4_000n, 2_500n]);
    const deposit = prepareDeposit(paths, await scanWallet(chain, paths), 12_000n, unlockTime);
    expect(deposit.transaction.inputs).toHaveLength(2);
    await checkAndSend(chain, deposit, wallet.sign(overTheWire(deposit.request)));
    expect((await scanWallet(chain, paths)).balance).toBe(18_500n - 12_000n - deposit.fee);
  });

  it('leaves no output too small to spend', async () => {
    const { chain, wallet, paths, unlockTime } = setUp([10_400n]);
    const deposit = prepareDeposit(paths, await scanWallet(chain, paths), 10_000n, unlockTime);
    expect(deposit.transaction.outputs).toHaveLength(2);
    await checkAndSend(chain, deposit, wallet.sign(overTheWire(deposit.request)));
  });

  it('refuses a jar the coins cannot pay for, or one too small to empty', async () => {
    const { chain, paths, unlockTime } = setUp([10_000n]);
    const scan = await scanWallet(chain, paths);
    expect(() => prepareDeposit(paths, scan, 9_950n, unlockTime)).toThrow(/do not cover/);
    expect(() => prepareDeposit(paths, scan, SMALLEST_JAR - 1n, unlockTime)).toThrow(/at least/);
  });

  it('empties a jar only after its time, with the wallet\'s signature', async () => {
    const { chain, wallet, paths, unlockTime } = setUp();
    const deposit = prepareDeposit(paths, await scanWallet(chain, paths), 20_000n, unlockTime);
    await checkAndSend(chain, deposit, wallet.sign(overTheWire(deposit.request)));
    const scan = await scanWallet(chain, paths);

    const early = prepareWithdrawal(paths, scan, await loadJar(chain, paths, unlockTime));
    const signedEarly = wallet.sign(overTheWire(early.request));
    await expect(checkAndSend(chain, early, signedEarly)).rejects.toBeInstanceOf(TooEarlyError);
    expect((await loadJar(chain, paths, unlockTime)).held).toBe(20_000n);

    chain.nowMs += 3_700_000;
    await checkAndSend(chain, early, signedEarly);
    expect((await loadJar(chain, paths, unlockTime)).held).toBe(0n);
    expect((await scanWallet(chain, paths)).balance).toBe(50_000n - deposit.fee - early.fee);
  });

  it('a transaction with an earlier lock time does not empty the jar', async () => {
    const { chain, wallet, paths, unlockTime } = setUp();
    const deposit = prepareDeposit(paths, await scanWallet(chain, paths), 20_000n, unlockTime);
    await checkAndSend(chain, deposit, wallet.sign(overTheWire(deposit.request)));
    const jar = await loadJar(chain, paths, unlockTime);
    // The same jar, claimed to unlock an hour earlier: the signature is the wallet's, the script refuses.
    const forged = prepareWithdrawal(paths, await scanWallet(chain, paths), { ...jar, unlockTime: unlockTime - 3_600 });
    expect(chain.submit(wallet.sign(overTheWire(forged.request))).accepted).toBe(false);
  });

  it('another wallet\'s signature does not empty the jar', async () => {
    const { chain, wallet, paths, unlockTime } = setUp();
    const deposit = prepareDeposit(paths, await scanWallet(chain, paths), 20_000n, unlockTime);
    await checkAndSend(chain, deposit, wallet.sign(overTheWire(deposit.request)));
    chain.nowMs += 3_700_000;
    const withdrawal = prepareWithdrawal(paths, await scanWallet(chain, paths), await loadJar(chain, paths, unlockTime));
    const stranger = ordinaryWallet(new Uint8Array(32).fill(9));
    await expect(checkAndSend(chain, withdrawal, stranger.sign(overTheWire(withdrawal.request)))).rejects.toThrow(/does not pass/);
  });

  it('sends nothing if the wallet returns a different transaction', async () => {
    const { chain, wallet, paths, unlockTime } = setUp();
    const scan = await scanWallet(chain, paths);
    const deposit = prepareDeposit(paths, scan, 20_000n, unlockTime);
    const other = prepareDeposit(paths, scan, 21_000n, unlockTime);
    await expect(checkAndSend(chain, deposit, wallet.sign(overTheWire(other.request)))).rejects.toThrow(/different transaction/);
    expect(chain.broadcasts).toBe(0);
  });

  it('finds jars again from the wallet\'s history alone', async () => {
    const { chain, wallet, paths, unlockTime } = setUp([30_000n, 30_000n]);
    for (const [satoshis, time] of [[5_000n, unlockTime], [6_000n, unlockTime + 86_400]] as const) {
      const deposit = prepareDeposit(paths, await scanWallet(chain, paths), satoshis, time);
      await checkAndSend(chain, deposit, wallet.sign(overTheWire(deposit.request)));
    }
    const scan = await scanWallet(chain, paths);
    expect(await findUnlockTimes(chain, paths, scan.history)).toEqual([unlockTime, unlockTime + 86_400]);
  });

  it('a note without a payment to its jar is not taken for a jar', async () => {
    const { chain, wallet, paths, unlockTime } = setUp();
    const deposit = prepareDeposit(paths, await scanWallet(chain, paths), 5_000n, unlockTime);
    const signed = decodeTransactionBch(hexToBin(wallet.sign(overTheWire(deposit.request))));
    if (typeof signed === 'string') throw new Error(signed);
    // The note of this deposit names its own jar; a jar of another key at the same time is a different script.
    const otherKey = jarKey(readPaths(ordinaryWallet(new Uint8Array(32).fill(9)).paths));
    expect(binToHex(jarScript(otherKey, unlockTime).lockingBytecode)).not.toBe(binToHex(signed.outputs[0]?.lockingBytecode ?? new Uint8Array()));
    expect(await findUnlockTimes(chain, paths, (await scanWallet(chain, paths)).history)).toEqual([]);
  });
});
