import { TAB_ELSEWHERE_KEY, type TabParts, bringTabHere, claimTab, tabElsewhere, tabWork } from '@grandmas-wallet/ui';
import { describe, expect, it } from 'vitest';

/**
 * One tab of a page at a time, the newest winning: a new tab asks the one before it to stop and waits for its
 * turn; the older tab finishes what it is doing, marks itself and loads again. The browser's lock and the channel
 * between tabs are stood in for here.
 */

/** A browser's locks for one name, as far as the turn-taking uses them: a queue, a signal that leaves it, and stealing. */
const browser = () => {
  let holder: { release: () => void; lose: () => void } | undefined;
  const queue: { grant: () => void; gone: boolean }[] = [];
  const next = (): void => {
    if (holder !== undefined) return;
    const waiting = queue.shift();
    if (waiting !== undefined && !waiting.gone) waiting.grant();
    else if (waiting !== undefined) next();
  };
  const listeners: { id: string; heard: (message: unknown) => void }[] = [];
  const tab = (id: string) => {
    const marks = new Map<string, string>();
    const state = { reloads: 0, unloaded: false };
    let mine: { release: () => void; lose: () => void } | undefined;
    const waits: { until: number; done: () => void }[] = [];
    let clock = 0;
    const parts: TabParts = {
      id,
      marks: { getItem: (key) => marks.get(key) ?? null, setItem: (key, value) => void marks.set(key, value), removeItem: (key) => void marks.delete(key) },
      reload: () => {
        state.reloads += 1;
        state.unloaded = true;
        // A tab that loads again gives its lock up and hears nothing more.
        if (mine !== undefined && holder === mine) {
          holder = undefined;
          next();
        }
        mine = undefined;
      },
      wait: (milliseconds) => new Promise((done) => waits.push({ until: clock + milliseconds, done })),
      channel: () => ({
        post: (message) => listeners.filter((entry) => entry.id !== id).forEach((entry) => queueMicrotask(() => entry.heard(message))),
        listen: (heard) => void listeners.push({ id, heard: (message) => (state.unloaded ? undefined : heard(message)) }),
      }),
      locks: {
        request: ((_name: string, options: { signal?: AbortSignal; steal?: boolean }, held: () => Promise<void>) =>
          new Promise<void>((_resolve, reject) => {
            const take = (): void => {
              mine = { release: () => undefined, lose: () => reject(new DOMException('taken', 'AbortError')) };
              holder = mine;
              void held();
            };
            if (options.steal === true) {
              const before = holder;
              holder = undefined;
              take();
              before?.lose();
              return;
            }
            const waiting = { grant: take, gone: false };
            options.signal?.addEventListener('abort', () => {
              waiting.gone = true;
              reject(new DOMException('left', 'AbortError'));
            });
            queue.push(waiting);
            next();
          })) as unknown as LockManager['request'],
      },
    };
    /** Let this tab's clock move on, with what waited for it. */
    const pass = async (milliseconds: number): Promise<void> => {
      clock += milliseconds;
      for (const waiting of waits.splice(0)) {
        if (waiting.until <= clock) waiting.done();
        else waits.push(waiting);
      }
      await new Promise((done) => setTimeout(done, 0));
    };
    return { parts, state, marks, pass };
  };
  return { tab };
};
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe('one tab of a page at a time, the newest winning', () => {
  it('a tab alone has the page at once', async () => {
    const { tab } = browser();
    const first = tab('first');
    await claimTab('test', first.parts);
    expect(first.state.reloads).toBe(0);
    expect(tabElsewhere(first.parts.marks)).toBe(false);
  });

  it('a newer tab takes the page; the older one marks itself and loads again', async () => {
    const { tab } = browser();
    const first = tab('first');
    await claimTab('test', first.parts);
    const second = tab('second');
    let has = false;
    void claimTab('test', second.parts).then(() => (has = true));
    await settle();
    await settle();
    expect(first.state.reloads).toBe(1);
    expect(tabElsewhere(first.parts.marks)).toBe(true);
    expect(has).toBe(true);
    expect(second.state.reloads).toBe(0);
  });

  it('the older tab finishes what it is in the middle of first', async () => {
    const { tab } = browser();
    const first = tab('first');
    await claimTab('test', first.parts);
    tabWork.begin();
    const second = tab('second');
    let has = false;
    void claimTab('test', second.parts).then(() => (has = true));
    await settle();
    await first.pass(100);
    expect(first.state.reloads).toBe(0);
    expect(has).toBe(false);
    tabWork.end();
    await first.pass(100);
    await settle();
    expect(first.state.reloads).toBe(1);
    expect(has).toBe(true);
  });

  it('a tab that does not answer has the page taken from it, and stops when it notices', async () => {
    const { tab } = browser();
    const first = tab('first');
    await claimTab('test', first.parts);
    // It hears nothing, as a tab the browser put to sleep.
    first.state.unloaded = true;
    const second = tab('second');
    let has = false;
    void claimTab('test', second.parts).then(() => (has = true));
    await settle();
    expect(has).toBe(false);
    await second.pass(8_000);
    await settle();
    expect(has).toBe(true);
    first.state.unloaded = false;
    await settle();
    expect(first.state.reloads).toBe(1);
    expect(tabElsewhere(first.parts.marks)).toBe(true);
  });

  it('"Use it here" brings the page back: the mark goes and the tab loads again', () => {
    const marks = new Map<string, string>([[TAB_ELSEWHERE_KEY, 'then']]);
    let reloads = 0;
    bringTabHere({ getItem: (key) => marks.get(key) ?? null, setItem: (key, value) => void marks.set(key, value), removeItem: (key) => void marks.delete(key) }, () => (reloads += 1));
    expect(marks.has(TAB_ELSEWHERE_KEY)).toBe(false);
    expect(reloads).toBe(1);
  });

  it('a browser without the lock is not guarded', async () => {
    const { tab } = browser();
    const first = tab('first');
    await claimTab('test', { ...first.parts, locks: undefined });
    expect(first.state.reloads).toBe(0);
  });
});
