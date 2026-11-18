import { describe, expect, it } from 'vitest';

import { HEADER_RESET_MARK, clearHeaderResetMark, markHeadersForReset, resetMarkedHeaders } from '../src/engine-headers.js';

/**
 * A page whose engine's header check is stuck on a block that a reorganization of the chain took away loads
 * again with the engine's header store deleted, once in a row (seen on chipnet in the browser courses of
 * 18 November: the recoverer's page stayed at "Opening this wallet's account" for the rest of the run).
 */

const marks = () => {
  const items = new Map<string, string>();
  return { getItem: (name: string) => items.get(name) ?? null, setItem: (name: string, value: string) => void items.set(name, value), removeItem: (name: string) => void items.delete(name), items };
};

const databases = (names: string[], outcome: 'success' | 'blocked' | 'error' = 'success') => {
  const deleted: string[] = [];
  return {
    deleted,
    databases: async () => names.map((name) => ({ name, version: 1 })),
    deleteDatabase: (name: string) => {
      const request = {} as IDBOpenDBRequest;
      setTimeout(() => {
        if (outcome === 'error') request.onerror?.call(request, new Event('error'));
        else {
          deleted.push(name);
          if (outcome === 'blocked') request.onblocked?.call(request, new Event('blocked') as IDBVersionChangeEvent);
          else request.onsuccess?.call(request, new Event('success'));
        }
      }, 0);
      return request;
    },
  };
};

describe('the engine\'s header store, made afresh when the header check is stuck', () => {
  it('is marked once, deleted at the next load before the engine opens it, and only the header stores go', async () => {
    const kept = marks();
    const stores = databases(['Electrum-chipnet-4302fd_00000000560', 'XO', 'other']);
    expect(markHeadersForReset(kept)).toBe(true);
    expect(kept.items.get(HEADER_RESET_MARK)).toBe('pending');
    expect(await resetMarkedHeaders(kept, stores)).toEqual(['Electrum-chipnet-4302fd_00000000560']);
    expect(stores.deleted).toEqual(['Electrum-chipnet-4302fd_00000000560']);
    // The engine's own state, with the keys, is not touched.
    expect(stores.deleted).not.toContain('XO');
  });

  it('is not dealt with in a loop: stuck again right after a reset, the page says so instead of loading again', async () => {
    const kept = marks();
    expect(markHeadersForReset(kept)).toBe(true);
    await resetMarkedHeaders(kept, databases(['Electrum-x']));
    expect(kept.items.get(HEADER_RESET_MARK)).toBe('done');
    expect(markHeadersForReset(kept)).toBe(false);
    // Once an account opened, a later stuck check may be dealt with again.
    clearHeaderResetMark(kept);
    expect(markHeadersForReset(kept)).toBe(true);
  });

  it('deletes nothing when no load marked it', async () => {
    const stores = databases(['Electrum-x']);
    expect(await resetMarkedHeaders(marks(), stores)).toEqual([]);
    expect(stores.deleted).toEqual([]);
  });

  it('goes on when another tab still has the store open, and says when it cannot be deleted', async () => {
    const kept = marks();
    markHeadersForReset(kept);
    await expect(resetMarkedHeaders(kept, databases(['Electrum-x'], 'blocked'))).resolves.toEqual(['Electrum-x']);
    const again = marks();
    markHeadersForReset(again);
    await expect(resetMarkedHeaders(again, databases(['Electrum-x'], 'error'))).rejects.toThrow(/could not be deleted/);
  });
});
