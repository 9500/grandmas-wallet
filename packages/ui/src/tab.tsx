import { Button, Card } from './components.js';
import { tabWork } from './tab-work.js';

export { tabWork } from './tab-work.js';

/*
 * One tab at a time. A page keeps its keys, its engine's databases and its sessions in the browser, and two tabs
 * of the same page would each run an engine on them: they build transactions from the same coins, answer the same
 * session twice, and one can wait for ever for a database the other holds. So the newest tab of a page wins: it
 * asks the tab before it to stop, and that tab loads again into a screen that says where the page went, with a
 * button that brings it back. Each network has its own turn, as each keeps its own data.
 *
 * The tab that is in use holds a lock of the browser (Web Locks). A new tab says that it is there and waits for the
 * lock; the tab that holds it finishes what it is in the middle of, marks itself and loads again, which gives the
 * lock up. A tab that does not answer in time, as one the browser has put to sleep does not, has the lock taken
 * from it, and stops when it notices.
 */

/** The mark a tab that gave way keeps for as long as it is open, across the reload that stops it. */
export const TAB_ELSEWHERE_KEY = 'grandmas-wallet:tab-elsewhere';

/** How long a tab that is asked to stop may finish what it is doing, and how long the new tab waits before it takes the lock. */
const FINISH_WITHIN_MS = 5_000;
const TAKE_AFTER_MS = 8_000;

type Marks = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Channel {
  post(message: unknown): void;
  listen(heard: (message: unknown) => void): void;
}
export interface TabParts {
  locks: Pick<LockManager, 'request'> | undefined;
  channel: (name: string) => Channel | undefined;
  marks: Marks | undefined;
  reload: () => void;
  wait: (milliseconds: number) => Promise<void>;
  id: string;
}

const browserParts = (): TabParts => ({
  locks: typeof navigator === 'undefined' ? undefined : navigator.locks,
  channel: (name) => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const made = new BroadcastChannel(name);
    return { post: (message) => made.postMessage(message), listen: (heard) => made.addEventListener('message', (event) => heard(event.data)) };
  },
  marks: typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
  reload: () => window.location.reload(),
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  id: Math.random().toString(36).slice(2),
});

const safely = <Result,>(read: () => Result, otherwise: Result): Result => {
  try {
    return read();
  } catch {
    return otherwise;
  }
};

/** Whether this tab gave way to a newer one, and shows where the page went instead of starting. */
export const tabElsewhere = (marks: Marks | undefined = safely(() => sessionStorage, undefined)): boolean => safely(() => marks?.getItem(TAB_ELSEWHERE_KEY) ?? null, null) !== null;

/** Bring the page back to this tab: it loads again and takes its turn, and the tab that had it gives way. */
export const bringTabHere = (marks: Marks | undefined = safely(() => sessionStorage, undefined), reload: () => void = () => window.location.reload()): void => {
  safely(() => marks?.removeItem(TAB_ELSEWHERE_KEY), undefined);
  reload();
};

/**
 * Take this page's turn for a network, before anything of the page opens a database or a session. Resolves once
 * this tab has it: at once when no other tab has the page open, otherwise when that tab has stopped. From then on
 * this tab gives way to a newer one in the same manner. A browser without the lock is not guarded.
 *
 * @param name - the page's turn: one for each network, since each network keeps its own data
 */
export const claimTab = async (name: string, parts: TabParts = browserParts()): Promise<void> => {
  const { locks } = parts;
  if (locks === undefined) return;
  let stopping = false;
  const giveWay = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // What is being signed or sent is finished first, within a limit.
    for (let waited = 0; tabWork.busy() && waited < FINISH_WITHIN_MS; waited += 100) await parts.wait(100);
    safely(() => parts.marks?.setItem(TAB_ELSEWHERE_KEY, new Date().toISOString()), undefined);
    parts.reload();
  };
  const channel = safely(() => parts.channel(`grandmas-wallet-tab:${name}`), undefined);
  if (channel !== undefined) {
    channel.listen((heard) => {
      const message = heard as { claim?: unknown } | null;
      if (typeof message?.claim === 'string' && message.claim !== parts.id) void giveWay();
    });
    channel.post({ claim: parts.id });
  }
  await new Promise<void>((resolve) => {
    let held = false;
    const waiting = new AbortController();
    const hold = (): Promise<void> => {
      held = true;
      resolve();
      // Kept until the tab is closed or loads again.
      return new Promise<void>(() => undefined);
    };
    // A lock taken from this tab ends its request with an error: a newer tab has the page.
    const lost = (): void => {
      if (held) void giveWay();
    };
    locks.request(`grandmas-wallet-tab:${name}`, { signal: waiting.signal }, hold).catch(lost);
    void parts.wait(TAKE_AFTER_MS).then(() => {
      if (held) return;
      waiting.abort();
      locks.request(`grandmas-wallet-tab:${name}`, { steal: true }, hold).catch(lost);
    });
  });
};

/** What a tab that gave way shows in place of the page. */
export const TabElsewhere = ({ what }: { what: string }) => (
  <Card title="Open in another tab">
    <div class="stack-s" data-testid="tab-elsewhere">
      <p>You opened {what} in a newer tab of this browser, so this tab stopped. Only one tab can use it at a time.</p>
      <div class="actions">
        <Button onClick={() => bringTabHere()}>Use it here</Button>
      </div>
    </div>
  </Card>
);
