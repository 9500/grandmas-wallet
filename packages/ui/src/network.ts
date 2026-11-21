/**
 * Which network a page runs on, where its deployment offers both, and the names of everything the page keeps in
 * the browser for that network.
 *
 * A deployment that describes chipnet and mainnet (`networks` in `config.json`, with `"mainnetEnabled": true`)
 * lets the person choose. The choice is kept in this browser for the page's address; the page then loads again on
 * the chosen network. Everything a page keeps is named for its network, so that a chipnet wallet and a mainnet
 * wallet in the same browser never see each other's data: chipnet keeps the names pages used before the choice
 * existed, and mainnet adds `-mainnet` to each of them. The engine names its own databases for its network
 * (`XO-<network>-…`, `Electrum-<network>-…`).
 */

/** Where the browser keeps the network chosen on this page's address. The one name not kept apart by network. */
export const NETWORK_CHOICE_KEY = 'grandmas-wallet:network';

/** The two kinds of names: mainnet's, and those of every test network, which are the names of before. */
export type StorageNetwork = 'mainnet' | 'test';

export const storageNetworkOf = (network: string): StorageNetwork => (network === 'mainnet' ? 'mainnet' : 'test');

type Marks = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserMarks = (): Marks | undefined => {
  try {
    return (globalThis as { window?: { localStorage?: Marks } }).window?.localStorage;
  } catch {
    return undefined;
  }
};

/** The network chosen in this browser for this page's address, if one was. */
export const rememberedNetwork = (marks: Marks | undefined = browserMarks()): string | undefined => {
  try {
    return marks?.getItem(NETWORK_CHOICE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

let fixed: StorageNetwork | undefined;

/**
 * The network this page's names are for, fixed at the first use in a load: the remembered choice. A page whose
 * configuration resolves to another network keeps its choice and loads again (`settleStorageNetwork`), so that
 * nothing is read or written under the other network's names.
 */
export const storageNetwork = (): StorageNetwork => (fixed ??= storageNetworkOf(rememberedNetwork() ?? 'chipnet'));

/** For tests: forget the network fixed in this load. */
export const resetStorageNetwork = (network?: StorageNetwork): void => {
  fixed = network;
};

/** A name kept in the browser, for a network: as before on chipnet, with `-mainnet` on mainnet. */
export const networkName = (base: string, network: StorageNetwork = storageNetwork()): string => (network === 'mainnet' ? `${base}-mainnet` : base);

/** Whether a name kept in the browser belongs to mainnet's side. */
export const isMainnetName = (name: string): boolean => /mainnet/.test(name);

/**
 * Keep the network a page resolved to, and make sure the names it uses are that network's. Returns false when the
 * page has to load again for that (it then does).
 */
export const settleStorageNetwork = (network: string, marks: Marks | undefined = browserMarks(), reload: () => void = () => window.location.reload()): boolean => {
  const wanted = storageNetworkOf(network);
  if (rememberedNetwork(marks) !== network && (rememberedNetwork(marks) !== undefined || wanted === 'mainnet')) {
    try {
      marks?.setItem(NETWORK_CHOICE_KEY, network);
    } catch {
      // checked below
    }
  }
  if (storageNetwork() === wanted) return true;
  if (storageNetworkOf(rememberedNetwork(marks) ?? 'chipnet') !== wanted) {
    throw new Error('This browser keeps nothing for this page, which it needs to keep the network\'s data apart. Allow the page to keep data and reload.');
  }
  reload();
  return false;
};

/**
 * Remember a network for this page's address and load the page again on it. `before` runs just before the page
 * loads again, to carry something over to the other network's names.
 */
export const rememberNetwork = (network: string, before?: () => void, marks: Marks | undefined = browserMarks(), reload: () => void = () => window.location.reload()): void => {
  marks?.setItem(NETWORK_CHOICE_KEY, network);
  before?.();
  reload();
};

/** Forget the choice: the page starts on the deployment's network again. */
export const forgetNetwork = (marks: Marks | undefined = browserMarks()): void => {
  try {
    marks?.removeItem(NETWORK_CHOICE_KEY);
  } catch {
    // nothing kept
  }
};
