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

/**
 * The name of the mockup network: a chain of the deployment's own, run like a local regtest chain, with play coins
 * anyone can ask for and a clock that can be moved on. See docs/mockup.md.
 */
export const MOCKUP = 'mockup';

/** Whether a network is a chain of one's own, with regtest's rules: the local node, or the deployment's mockup. */
export const isOwnChain = (network: string): boolean => network === 'regtest' || network === MOCKUP;

/** The kinds of names: mainnet's, the mockup's, and those of every test network, which are the names of before. */
export type StorageNetwork = 'mainnet' | 'mockup' | 'test';

export const storageNetworkOf = (network: string): StorageNetwork => (network === 'mainnet' ? 'mainnet' : network === MOCKUP ? 'mockup' : 'test');

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

/** A name kept in the browser, for a network: as before on chipnet, with `-mainnet` on mainnet and `-mockup` on the mockup. */
export const networkName = (base: string, network: StorageNetwork = storageNetwork()): string => (network === 'test' ? base : `${base}-${network}`);

/** Whether a name kept in the browser belongs to mainnet's side. */
export const isMainnetName = (name: string): boolean => /mainnet/.test(name);

/**
 * The engine names its databases for the network it is made for, and it is made for chipnet on a chain of one's
 * own. So that the mockup's engine and chipnet's never open each other's databases on the same page address,
 * every database a page on the mockup opens has this in front of its name.
 */
export const DATABASE_SPACE = 'mockup:';

/**
 * On a page that runs on the mockup: give every database it opens or deletes a name of the mockup's own. Called
 * once, before anything opens a database. A name that has the mark already is left as it is, so a name read
 * from the browser's list can be handed back.
 */
export const keepDatabasesApart = (factory: { prototype: Pick<IDBFactory, 'open' | 'deleteDatabase'> } | undefined = (globalThis as { IDBFactory?: { prototype: IDBFactory } }).IDBFactory): void => {
  if (factory === undefined) return;
  const spaced = (name: string): string => (name.startsWith(DATABASE_SPACE) ? name : `${DATABASE_SPACE}${name}`);
  const { open, deleteDatabase } = factory.prototype;
  factory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
    return version === undefined ? open.call(this, spaced(name)) : open.call(this, spaced(name), version);
  };
  factory.prototype.deleteDatabase = function (this: IDBFactory, name: string) {
    return deleteDatabase.call(this, spaced(name));
  };
};

/** The side a name kept in the browser belongs to. */
export const sideOfName = (name: string): StorageNetwork => (/mainnet/.test(name) ? 'mainnet' : /mockup/.test(name) ? 'mockup' : 'test');

/**
 * Keep the network a page resolved to, and make sure the names it uses are that network's. Returns false when the
 * page has to load again for that (it then does).
 */
export const settleStorageNetwork = (network: string, marks: Marks | undefined = browserMarks(), reload: () => void = () => window.location.reload()): boolean => {
  const wanted = storageNetworkOf(network);
  if (rememberedNetwork(marks) !== network && (rememberedNetwork(marks) !== undefined || wanted !== 'test')) {
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

/** Keep a network as this browser's choice for the page's address, without loading again: for the network the page is on. */
export const keepNetworkChoice = (network: string, marks: Marks | undefined = browserMarks()): void => {
  try {
    marks?.setItem(NETWORK_CHOICE_KEY, network);
  } catch {
    // a browser that keeps nothing is asked again
  }
};

/** Forget the choice: the page starts on the deployment's network again. */
export const forgetNetwork = (marks: Marks | undefined = browserMarks()): void => {
  try {
    marks?.removeItem(NETWORK_CHOICE_KEY);
  } catch {
    // nothing kept
  }
};
