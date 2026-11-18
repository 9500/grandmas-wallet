import { binToHex, hexToBin } from '@bitauth/libauth';
import { MemoryStore } from '@grandmas-wallet/archive';
import {
  type ApplicationAction,
  type OwnerWalletState,
  type PresentedTexts,
  type RecoveryArrangement,
  type TemplateNames,
  Applications,
  OwnerWallet,
  RECOVERY_PROFILE,
  RECOVERY_PROFILE_VERSION,
  applicationArchive,
  copyEarlierArchives,
  kitTemplates,
  newArchive,
  walletTemplateNumbers,
} from '@grandmas-wallet/app';
import { deriveSeedKeys, p2pkhLockingBytecode, readTemplate, textHash } from '@grandmas-wallet/core';
import { credentialKeys } from '@grandmas-wallet/enrollment';
import { KeyBackend, SimulatedChain, bondDeclaration, bondTemplate, strongboxDeclaration, strongboxTemplate, templateText } from '@grandmas-wallet/testing';
import { recovererOf } from './recoverer.js';

/**
 * What the tests of applications share: a wallet on the simulated chain with a backup archive on stores in
 * memory, and the two templates made for the tests as an application would present them.
 */

export const WORDS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
];
export const CREDENTIAL_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
export const STORES = ['https://store1.example', 'https://store2.example'];
const numbers = walletTemplateNumbers();
export const seedOf = (index: number) => deriveSeedKeys(WORDS[index] as string, 'testnet', numbers);
export const hex = binToHex;

/** A template with its declaration, as an application presents it: the texts, and the names a request gives them. */
export const presentation = (template: unknown, declaration?: object): { names: TemplateNames; texts: PresentedTexts } => {
  const text = templateText(template);
  const read = readTemplate(text);
  const declarationText =
    declaration === undefined ? undefined : JSON.stringify({ profile: RECOVERY_PROFILE, version: RECOVERY_PROFILE_VERSION, template: { identifier: read.identifier, contentHash: read.contentHash }, ...declaration });
  return {
    names: { identifier: read.identifier, contentHash: read.contentHash, ...(declarationText === undefined ? {} : { declaration: textHash(declarationText) }) },
    texts: { template: text, ...(declarationText === undefined ? {} : { declaration: declarationText }) },
  };
};

export const strongbox = presentation(strongboxTemplate, strongboxDeclaration);
export const bond = presentation(bondTemplate, bondDeclaration);

/** A request as an application would make it. */
export const request = (presented: { names: TemplateNames; texts: PresentedTexts }, action: string, role: string, variables: Record<string, string | number> = {}, more: Partial<ApplicationAction> = {}): ApplicationAction => ({
  template: presented.names,
  presented: presented.texts,
  action,
  role,
  variables,
  ...more,
});

export interface Device {
  chain: SimulatedChain;
  wallet: OwnerWallet;
  applications: Applications;
  backend: KeyBackend;
  stores: Map<string, MemoryStore>;
  arrangement: RecoveryArrangement;
  state: () => OwnerWalletState;
  identity: Uint8Array;
  /** Put coins at fresh addresses of the wallet. */
  receive: (...values: bigint[]) => Promise<void>;
  /** The recoverer requests the wallet for the second seed, waits and completes. No coin moves. */
  recover: () => Promise<void>;
  /**
   * The device of the second seed takes the wallet over: a new archive of its own, with the earlier
   * archive's records copied into it, and the first seed's viewing key.
   */
  takeOver: () => Promise<Device>;
}

const credential = () => credentialKeys(CREDENTIAL_WORDS, 'testnet', kitTemplates());

const assemble = (chain: SimulatedChain, wallet: OwnerWallet, backend: KeyBackend, seedIndex: number, stores: Map<string, MemoryStore>, arrangement: RecoveryArrangement, state: () => OwnerWalletState, options: { withoutArchive?: boolean; outputIndex?: number }): Device => {
  const identity = hexToBin(wallet.stored.identity as string);
  const storeAt = (address: string): MemoryStore => stores.get(address) as MemoryStore;
  const applications = new Applications(wallet.parts, {
    ...(options.withoutArchive === true ? {} : { archive: applicationArchive({ arrangement: () => arrangement, storeAt, seed: seedOf(seedIndex), identity, chain }) }),
    now: () => 1_795_000_000,
  });
  const receive = async (...more: bigint[]): Promise<void> => {
    for (const value of more) chain.fund((await wallet.receiveAddress()).address.lockingBytecode, value, options.outputIndex ?? 0);
  };
  const recover = async (): Promise<void> => {
    const keys = credential();
    // The recoverer pays from a balance of its own.
    const recoverer = await recovererOf(chain, identity, keys.recoveryKey);
    await recoverer.request(seedOf(seedIndex + 1).controllerKey.keyHash);
    chain.nowMs += 2 * 512 * 1000;
    await recoverer.complete();
  };
  const takeOver = async (): Promise<Device> => {
    const seed = seedOf(seedIndex + 1);
    const next = new KeyBackend(chain, seed);
    let kept: OwnerWalletState | undefined;
    const taken = await OwnerWallet.takeOver({ backend: next, chain, seed, identity, earlierViewingKeys: [seedOf(seedIndex).viewingKey], save: (stored) => (kept = stored) });
    // The new device starts an archive of its own and copies the earlier one's records into it (section 10.6).
    const copied = await copyEarlierArchives({ arrangement: { archive: newArchive(STORES), earlierArchives: [arrangement.archive], earlierViewingKeyRecords: [] }, storeAt });
    return assemble(chain, taken, next, seedIndex + 1, stores, copied.arrangement, () => kept as OwnerWalletState, options);
  };
  return { chain, wallet, applications, backend, stores, arrangement, state, identity, receive, recover, takeOver };
};

/**
 * A created wallet of the first seed with a backup archive, and coins of the given values at addresses it
 * gave out. Coins put there by the simulated chain are output 0 of their transactions unless `outputIndex` says otherwise.
 */
export const deviceWith = async (values: bigint[], options: { stores?: Map<string, MemoryStore>; withoutArchive?: boolean; outputIndex?: number } = {}): Promise<Device> => {
  const chain = new SimulatedChain();
  const seed = seedOf(0);
  const keys = credential();
  const backend = new KeyBackend(chain, seed);
  let kept: OwnerWalletState | undefined;
  const wallet = await OwnerWallet.open({ backend, chain, seed, save: (state) => (kept = state) });
  chain.fund(p2pkhLockingBytecode(seed.fundingKey.keyHash), 100_000n);
  await wallet.create({ recovererKeyHash: keys.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
  // What is left of the funding coin is moved out of the way, so that the tests' figures start from the coins they name.
  const rest = (await wallet.balance()).recoverable;
  if (rest > 0n) await wallet.sendEverything(p2pkhLockingBytecode(new Uint8Array(20).fill(0x77)));
  const stores = options.stores ?? new Map(STORES.map((address) => [address, new MemoryStore(address)]));
  const device = assemble(chain, wallet, backend, 0, stores, { archive: newArchive(STORES), earlierArchives: [], earlierViewingKeyRecords: [] }, () => kept as OwnerWalletState, options);
  await device.receive(...values);
  return device;
};

/** The hash a request names a text by. */
export const presentationHash = textHash;
