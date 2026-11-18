import { type TransactionCommon, binToHex, decodeTransactionBch, hashTransactionUiOrder, hexToBin } from '@bitauth/libauth';
import { type OwnerWalletState, type Sent, OwnerWallet, RecovererWallet, walletTemplateNumbers } from '@grandmas-wallet/app';
import { ADDRESS_KIND, deriveCredentialKeys, deriveSeedKeys, p2pkhLockingBytecode, walletAddress } from '@grandmas-wallet/core';
import { KeyBackend, SimulatedChain, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * Acceptance test PV03 of the proposal: what ties a coin to the wallet's identity, in public (section 16.3).
 * The wallet's own code makes the transactions on the simulated chain; the test then reads them as anyone
 * could: a transaction shows the identity when the identity's bytes are in it, and a link spreads to
 * whatever a tied coin is later spent together with.
 */

const numbers = walletTemplateNumbers();
const WORDS = ['abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'];
const CREDENTIAL_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const hex = binToHex;
const payee = p2pkhLockingBytecode(testKey(0x44).keyHash);

/** A chain that keeps every transaction it accepted, in order. */
class RecordingChain extends SimulatedChain {
  readonly accepted: string[] = [];

  override submit(transactionHex: string) {
    const result = super.submit(transactionHex);
    if (result.accepted) this.accepted.push(transactionHex);
    return result;
  }
}

/** What an observer works out: which transactions show the identity, and every coin tied to it by being spent or created together with one that is. */
const observe = (chain: RecordingChain, identity: Uint8Array) => {
  const shown = [hex(identity), hex(identity.slice().reverse())];
  const tied = new Set<string>();
  const showing = new Set<string>();
  const byId = new Map<string, TransactionCommon>();
  for (const encoded of chain.accepted) {
    const transaction = decodeTransactionBch(hexToBin(encoded));
    if (typeof transaction === 'string') throw new Error(transaction);
    const transactionId = hex(hashTransactionUiOrder(hexToBin(encoded)));
    byId.set(transactionId, transaction);
    const inputs = transaction.inputs.map((input) => `${hex(input.outpointTransactionHash)}:${input.outpointIndex}`);
    const shows = shown.some((bytes) => encoded.includes(bytes));
    if (shows) showing.add(transactionId);
    if (!shows && !inputs.some((outpoint) => tied.has(outpoint))) continue;
    for (const outpoint of inputs) tied.add(outpoint);
    transaction.outputs.forEach((_, index) => tied.add(`${transactionId}:${index}`));
  }
  /** Whether a coin that is or was at this script is tied to the identity. */
  const tiedAt = (lockingBytecode: Uint8Array): boolean => {
    for (const [transactionId, transaction] of byId) {
      if (transaction.outputs.some((output, index) => hex(output.lockingBytecode) === hex(lockingBytecode) && tied.has(`${transactionId}:${index}`))) return true;
    }
    return funded.some((coin) => hex(coin.lockingBytecode) === hex(lockingBytecode) && tied.has(coin.outpoint));
  };
  const transaction = (sent: Sent): TransactionCommon => byId.get(sent.transactionId) as TransactionCommon;
  return { tied, showing, tiedAt, transaction, spends: (sent: Sent) => transaction(sent).inputs.map((input) => `${hex(input.outpointTransactionHash)}:${input.outpointIndex}`) };
};
/** Coins that came from outside the wallet, by the script they were paid to. */
const funded: { lockingBytecode: Uint8Array; outpoint: string }[] = [];
const fund = (chain: RecordingChain, lockingBytecode: Uint8Array, valueSatoshis: bigint): string => {
  const outpoint = `${chain.fund(lockingBytecode, valueSatoshis)}:0`;
  funded.push({ lockingBytecode, outpoint });
  return outpoint;
};

describe('what ties a coin to the identity', () => {
  it('PV03: creating, an everyday payment, a cancellation, a sweep, and a later payment that spends swept and new coins together', async () => {
    const chain = new RecordingChain();
    const first = deriveSeedKeys(WORDS[0] as string, 'testnet', numbers);
    const next = deriveSeedKeys(WORDS[1] as string, 'testnet', numbers);
    const credential = deriveCredentialKeys(CREDENTIAL_WORDS, 'testnet', numbers);
    const feeAddress = p2pkhLockingBytecode(credential.feeKey.keyHash);
    const fundingAddress = p2pkhLockingBytecode(first.fundingKey.keyHash);
    const owner = await OwnerWallet.open({ backend: new KeyBackend(chain, first), chain, seed: first });

    // --- Creating the wallet: the coins it was funded with, and the first addresses they move to.
    const fundingCoin = fund(chain, fundingAddress, 100_000n);
    await owner.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
    // The recoverer's fee coins are its own, from elsewhere.
    fund(chain, feeAddress, 20_000n);
    const identity = hexToBin(owner.stored.identity as string);
    const changeAt = (number: number) => walletAddress(identity, first.viewingKey, ADDRESS_KIND.change, number).lockingBytecode;
    let seen = observe(chain, identity);
    expect(seen.showing.size).toBe(1);
    expect(seen.tied.has(fundingCoin)).toBe(true);
    expect(seen.tiedAt(changeAt(owner.stored.firstCoinNumber as number))).toBe(true);
    // Nothing leads from the creation to the recoverer's fee address.
    expect(seen.tiedAt(feeAddress)).toBe(false);

    // --- An everyday payment from an address that was given out: nothing of the wallet is shown, nothing is tied.
    const given = (await owner.receiveAddress()).address;
    const received = fund(chain, given.lockingBytecode, 10_000n);
    const everyday = await owner.pay([{ lockingBytecode: payee, valueSatoshis: 10_000n - 340n }]);
    seen = observe(chain, identity);
    expect(seen.spends(everyday)).toEqual([received]);
    expect(seen.showing.has(everyday.transactionId)).toBe(false);
    expect(seen.tied.has(received)).toBe(false);
    expect(seen.tied.has(`${everyday.transactionId}:0`)).toBe(false);

    // --- A request and its cancellation: the recoverer's fee coin, and the wallet coin that pays the cancellation's fee, with its change.
    const recovererBackend = () => new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey });
    const requested = await (await RecovererWallet.open({ backend: recovererBackend(), chain, identity })).request(next.controllerKey.keyHash);
    const cancelled = await owner.cancel();
    seen = observe(chain, identity);
    expect(seen.showing.has(requested.transactionId)).toBe(true);
    expect(seen.showing.has(cancelled.transactionId)).toBe(true);
    for (const outpoint of [...seen.spends(requested), ...seen.spends(cancelled)]) expect(seen.tied.has(outpoint)).toBe(true);
    seen.transaction(cancelled).outputs.forEach((_, index) => expect(seen.tied.has(`${cancelled.transactionId}:${index}`)).toBe(true));

    // --- Two more addresses are paid and never spent by the first device. Nothing ties them to the identity.
    const quiet = [(await owner.receiveAddress()).address, (await owner.receiveAddress()).address];
    const quietCoins = quiet.map((address, index) => fund(chain, address.lockingBytecode, 8_000n + BigInt(index)));
    const vault = (await owner.vaultAddress()).address;
    const vaultCoin = fund(chain, vault.lockingBytecode, 6_000n);
    seen = observe(chain, identity);
    for (const outpoint of [...quietCoins, vaultCoin]) expect(seen.tied.has(outpoint)).toBe(false);

    // --- A recovery and a sweep: every address swept, and the new addresses the coins go to.
    const recoverer = await RecovererWallet.open({ backend: recovererBackend(), chain, identity });
    await recoverer.request(next.controllerKey.keyHash);
    chain.nowMs += 2 * 512 * 1000;
    await recoverer.complete();
    let state: OwnerWalletState | undefined;
    const device = await OwnerWallet.takeOver({ backend: new KeyBackend(chain, next), chain, seed: next, identity, earlierViewingKeys: [first.viewingKey], save: (stored) => (state = stored) });
    await device.search({ passes: ['quick'] });
    const swept = await device.sweepEarlier();
    expect(swept.transactions).toHaveLength(1);
    const sweep = swept.transactions[0] as Sent;
    seen = observe(chain, identity);
    expect(seen.showing.has(sweep.transactionId)).toBe(true);
    for (const outpoint of [...quietCoins, vaultCoin]) expect(seen.tied.has(outpoint)).toBe(true);
    for (const address of [...quiet, vault]) expect(seen.tiedAt(address.lockingBytecode)).toBe(true);
    seen.transaction(sweep).outputs.forEach((_, index) => expect(seen.tied.has(`${sweep.transactionId}:${index}`)).toBe(true));

    // --- New coins at the new seed's addresses are not tied, and one spent alone stays so.
    const fresh = [(await device.receiveAddress()).address, (await device.receiveAddress()).address];
    const alone = fund(chain, fresh[0]?.lockingBytecode as Uint8Array, 10_000n);
    const apart = await device.pay([{ lockingBytecode: payee, valueSatoshis: 10_000n - 340n }]);
    seen = observe(chain, identity);
    expect(seen.spends(apart)).toEqual([alone]);
    expect(seen.showing.has(apart.transactionId)).toBe(false);
    expect(seen.tied.has(alone)).toBe(false);
    expect(seen.tied.has(`${apart.transactionId}:0`)).toBe(false);

    // --- A later payment that spends swept and new coins together: the transaction does not show the
    // identity, and the new coin is tied all the same, because a swept coin is. The link spreads in the ordinary way.
    const together = fund(chain, fresh[1]?.lockingBytecode as Uint8Array, 12_000n);
    const balance = await device.balance();
    const mixed = await device.pay([{ lockingBytecode: payee, valueSatoshis: balance.recoverable - 2_000n }]);
    seen = observe(chain, identity);
    expect(seen.spends(mixed)).toContain(together);
    expect(seen.spends(mixed).length).toBeGreaterThan(1);
    expect(seen.showing.has(mixed.transactionId)).toBe(false);
    expect(seen.tied.has(together)).toBe(true);
    expect(seen.tied.has(`${mixed.transactionId}:0`)).toBe(true);

    // In all, these showed the identity: the creation, two requests, the cancellation, the completion and the sweep. Nothing else did.
    expect(seen.showing.size).toBe(6);
    expect(state?.identity).toBe(owner.stored.identity);
  });
});
