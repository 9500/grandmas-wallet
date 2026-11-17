import { binToHex, decodeHdPublicKey, flattenBinArray, hash160, hash256, sha256 } from '@bitauth/libauth';
import {
  type BuiltTransaction,
  type TemplateNumbers,
  type WalletAddress,
  ADDRESS_KIND,
  buildTransaction,
  controllerInput,
  controllerSuccessor,
  deriveSeedKeys,
  p2pkhLockingBytecode,
  recoverableInput,
  sweptInput,
  vaultInput,
  walletAddress,
} from '@grandmas-wallet/core';
import { SimulatedChain, TestWallet, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * Acceptance tests PV01 and PV02 of the proposal: what the chain shows of a wallet, before and after a sweep.
 */

const numbers: TemplateNumbers = { controller: 11, givenOut: 22, change: 33, standardWallet: 44 };
const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const { givenOut, change, vault } = ADDRESS_KIND;
const payee = testKey(0x44);
const hex = binToHex;

const setup = () => {
  const chain = new SimulatedChain();
  const seed = deriveSeedKeys(WORDS, 'testnet', numbers);
  const wallet = TestWallet.create(chain, { owner: seed.controllerKey, recovererKeyHash: testKey(0x33).keyHash });
  const addresses: WalletAddress[] = [
    ...[0, 1, 2, 3, 4, 5].map((number) => walletAddress(wallet.identity, seed.viewingKey, givenOut, number)),
    ...[0, 1, 2].map((number) => walletAddress(wallet.identity, seed.viewingKey, change, number)),
    ...[0, 1].map((number) => walletAddress(wallet.identity, seed.viewingKey, vault, number)),
  ];
  for (const address of addresses) chain.fund(address.lockingBytecode, 10_000n);
  const coinAt = (address: WalletAddress) => {
    const [coin] = chain.outputsAt(address.lockingBytecode);
    if (coin === undefined) throw new Error('coin missing');
    return coin;
  };
  /** A payment from one address by its key: what everyday use puts on chain. */
  const spendByKey = (address: WalletAddress): BuiltTransaction => {
    if (address.kind === vault) throw new Error('a vault address has no key');
    const built = buildTransaction({
      inputs: [recoverableInput(coinAt(address), address.script, seed.addressKey(address.kind, address.number))],
      outputs: [{ lockingBytecode: p2pkhLockingBytecode(payee.keyHash), valueSatoshis: 0n }],
      remainderOutputIndex: 0,
    });
    wallet.send(built);
    return built;
  };
  /** What must never appear on chain while nothing has been swept. */
  const secrets = (): Record<string, Uint8Array> => {
    const node = (text: string) => {
      const decoded = decodeHdPublicKey(text);
      if (typeof decoded === 'string') throw new Error(decoded);
      return decoded.node;
    };
    return {
      'the identity': wallet.identity,
      'the identity as scripts see it': wallet.identity.slice().reverse(),
      'the blinding seed': seed.viewingKey.blindingSeed,
      'the chain code of the addresses given out': node(seed.viewingKey.addressNodes.givenOut).chainCode,
      'the public key of the node of addresses given out': node(seed.viewingKey.addressNodes.givenOut).publicKey.slice(1),
      'the chain code of the change addresses': node(seed.viewingKey.addressNodes.change).chainCode,
      'the controller public key': seed.controllerKey.publicKey.slice(1),
      'the controller key hash': seed.controllerKey.keyHash,
    };
  };
  return { chain, seed, wallet, addresses, coinAt, spendByKey, secrets };
};

const contains = (haystack: Uint8Array, needle: Uint8Array): boolean => hex(haystack).includes(hex(needle));

describe('a wallet that has not been swept', () => {
  it('PV01: no value is shared between its addresses, or between an address and the identity', () => {
    const { addresses, secrets, seed } = setup();
    // What a payer and the chain see of each address: its script hash.
    const scriptHashes = addresses.map((address) => hex(address.lockingBytecode));
    expect(new Set(scriptHashes).size).toBe(addresses.length);
    // What a spend by key later publishes: the tag and the key hash inside the script, and the public key.
    const tags = addresses.map((address) => hex(address.tag));
    expect(new Set(tags).size).toBe(addresses.length);
    const keyed = addresses.filter((address) => address.kind !== vault);
    const keyHashes = keyed.map((address) => hex(address.keyHash));
    expect(new Set(keyHashes).size).toBe(keyed.length);
    for (const address of addresses) {
      for (const [name, value] of Object.entries(secrets())) {
        expect(contains(address.script.redeemBytecode, value), `${name} in the script of address ${address.kind}/${address.number}`).toBe(false);
        expect(contains(address.lockingBytecode, value), name).toBe(false);
      }
      // An address's own secret is not in its script either: only the hash of identity and secret is.
      expect(contains(address.script.redeemBytecode, address.secret)).toBe(false);
    }
    // No address key is the controller key.
    expect(keyHashes).not.toContain(hex(seed.controllerKey.keyHash));
  });

  it('PV01: a spend by key shows the kind of address and nothing of the wallet', () => {
    const { addresses, spendByKey, secrets, wallet, chain } = setup();
    const [first, second] = addresses;
    const changeAddress = addresses.find((address) => address.kind === change);
    if (first === undefined || second === undefined || changeAddress === undefined) throw new Error('addresses missing');
    const spends = [first, second, changeAddress].map((address) => ({ address, built: spendByKey(address) }));

    for (const { address, built } of spends) {
      for (const [name, value] of Object.entries(secrets())) {
        expect(contains(built.encoded, value), `${name} in the spend of address ${address.kind}/${address.number}`).toBe(false);
      }
      expect(contains(built.encoded, address.secret)).toBe(false);
      // The script is published: the same rules for every recoverable address, which is what shows the kind.
      expect(contains(built.encoded, address.script.redeemBytecode)).toBe(true);
    }
    const rules = (address: WalletAddress): string => hex(address.script.redeemBytecode.slice(-96));
    expect(rules(first)).toBe(rules(second));
    expect(rules(first)).toBe(rules(changeAddress));
    // Apart from the rules, two spends share no value: not a tag, a key hash, a public key or a signature.
    const published = spends.map(({ address, built }) => {
      const input = built.transaction.inputs[0];
      if (input === undefined || address.kind === vault) throw new Error('input missing');
      return [hex(address.tag), hex(address.keyHash), hex(input.unlockingBytecode.slice(1, 66)), hex(input.unlockingBytecode.slice(67, 100))];
    });
    const all = published.flat();
    expect(new Set(all).size).toBe(all.length);
    // A given-out address and a change address cannot be told apart by their scripts.
    expect(first.script.redeemBytecode.length).toBe(changeAddress.script.redeemBytecode.length);
    // The controller was not touched by any of this.
    expect(wallet.controller().state.status).toBe('active');
    expect(chain.balanceOf(p2pkhLockingBytecode(payee.keyHash))).toBeGreaterThan(28_000n);
  });
});

describe('after a sweep of some addresses', () => {
  it('PV02: the secrets of the others cannot be computed from what was shown', () => {
    const { addresses, coinAt, wallet, seed } = setup();
    const swept = [addresses[0], addresses[1], addresses.find((address) => address.kind === vault)].filter((address): address is WalletAddress => address !== undefined);
    const others = addresses.filter((address) => !swept.includes(address));
    const { utxo, state } = wallet.controller();
    const action = { kind: 'ownerAuthorize' as const };
    const built = buildTransaction({
      inputs: [
        controllerInput(utxo, state, action, seed.controllerKey),
        ...swept.map((address) =>
          address.kind === vault ? vaultInput(coinAt(address), address.script, wallet.identity, address.secret) : sweptInput(coinAt(address), address.script, wallet.identity, address.secret),
        ),
      ],
      outputs: [controllerSuccessor(utxo, state, action), { lockingBytecode: p2pkhLockingBytecode(payee.keyHash), valueSatoshis: 0n }],
      remainderOutputIndex: 1,
    });
    wallet.send(built);

    // The sweep shows the identity and the secret of each address it empties, as the design says.
    expect(contains(built.encoded, wallet.identity.slice().reverse())).toBe(true);
    for (const address of swept) expect(contains(built.encoded, address.secret)).toBe(true);
    // It does not show the blinding seed, or the secret or tag of any other address.
    expect(contains(built.encoded, seed.viewingKey.blindingSeed)).toBe(false);
    for (const address of others) {
      expect(contains(built.encoded, address.secret)).toBe(false);
      expect(contains(built.encoded, address.tag)).toBe(false);
    }
    // A secret is a hash over the blinding seed, so the shown secrets say nothing about the others. Whatever
    // is put together from what the sweep showed, it gives no other address's secret or tag.
    const shown = [wallet.identity, wallet.identity.slice().reverse(), ...swept.map((address) => address.secret), ...swept.map((address) => address.tag)];
    const derived = new Set<string>();
    for (const a of shown) {
      for (const digest of [hash256, sha256.hash, hash160]) derived.add(hex(digest(a)));
      for (const b of shown) {
        derived.add(hex(hash256(flattenBinArray([a, b]))));
        for (const kind of [0, 1, 2]) for (const number of [0, 1, 2, 3, 4, 5]) derived.add(hex(hash256(flattenBinArray([a, Uint8Array.of(kind), Uint8Array.of(number, 0, 0, 0)]))));
      }
    }
    for (const address of others) {
      expect(derived.has(hex(address.secret))).toBe(false);
      expect(derived.has(hex(address.tag))).toBe(false);
    }
    // The swept addresses are now tied to the identity; the tags of the others still are not.
    for (const address of swept) expect(derived.has(hex(address.tag))).toBe(true);
  });
});
