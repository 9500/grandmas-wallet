/**
 * The engine's store of block headers, made afresh when its header check is stuck.
 *
 * The engine checks every block header against the last one it stored. When a reorganization of the chain
 * takes away a block it had stored as its last, every later check fails and the engine stays where it was: the
 * page never gets past opening its account (docs/xo-feedback-notes.md, 18 November). That store is a cache of
 * what the servers give (headers, proofs, histories); the keys and everything else the page keeps are elsewhere.
 * So a page whose header check did not move at all while it waited marks the store for deletion and loads
 * again; the next load deletes it before the engine opens it, and the engine checks the headers again from its
 * own starting point. It is done once in a row: if the check is stuck again right after, the page says so.
 */

/** The names of the engine's header stores: those of the Electrum layer, one per chain. */
export const isEngineHeaderStore = (name: string): boolean => name.startsWith('Electrum');

/** The mark in the tab's session storage, kept across the reload. */
export const HEADER_RESET_MARK = 'gw2-engine-headers';

type Marks = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Databases = Pick<IDBFactory, 'databases' | 'deleteDatabase'>;

/**
 * Whether a stuck header check may be dealt with by loading again: not if the last load did that already.
 * If it may, the store is marked for deletion at the next load.
 */
export const markHeadersForReset = (marks: Marks): boolean => {
  if (marks.getItem(HEADER_RESET_MARK) !== null) return false;
  marks.setItem(HEADER_RESET_MARK, 'pending');
  return true;
};

/**
 * Before the engine opens: if the last load marked the header store, delete it. Returns the names deleted.
 * The mark stays (as done) until an account opens, so that a check stuck again is not dealt with in a loop.
 */
export const resetMarkedHeaders = async (marks: Marks, databases: Databases): Promise<string[]> => {
  if (marks.getItem(HEADER_RESET_MARK) !== 'pending') return [];
  marks.setItem(HEADER_RESET_MARK, 'done');
  const names = (await databases.databases()).map((entry) => entry.name ?? '').filter(isEngineHeaderStore);
  for (const name of names) {
    await new Promise<void>((resolve, reject) => {
      const request = databases.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`The engine's store ${name} could not be deleted.`));
      // Nothing of this page has it open yet; a second tab of the same page may. The deletion goes on once it closes.
      request.onblocked = () => resolve();
    });
  }
  return names;
};

/** An account opened: a later stuck check may be dealt with again. */
export const clearHeaderResetMark = (marks: Marks): void => marks.removeItem(HEADER_RESET_MARK);
