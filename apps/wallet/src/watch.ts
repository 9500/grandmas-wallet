import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  type OwnerWallet,
  type Protection,
  type RequestTiming,
  type WatchStatus,
  Monitor,
  assessProtection,
  delaySeconds,
  emptyWatchLog,
  noteWatching,
  requestTiming,
} from '@grandmas-wallet/app';
import { type ControllerHistory, readControllerHistory } from '@grandmas-wallet/core';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type Session, keep, kept } from './session.js';

/**
 * Watching the wallet's controller while the page is open (proposal section 17): the monitor reads the
 * whole history from every server at each check; this device notes when it was watching, so that it can
 * say when it was not; and what the wallet may say about its protection follows from both.
 */

export interface Watch {
  status?: WatchStatus;
  history?: ControllerHistory;
  timing?: RequestTiming;
  protection?: Protection;
  /** When the last check succeeded, Unix seconds. */
  checkedAt?: number;
  problem?: string;
}

const now = (): number => Math.floor(Date.now() / 1000);

export const useWatch = (session: Session, wallet: OwnerWallet, ownerKeyHash: Uint8Array): Watch & { check: () => Promise<void> } => {
  const [watch, setWatch] = useState<Watch>({});
  const monitor = useRef<Monitor | undefined>(undefined);
  const identity = wallet.stored.identity as string;

  const assessNow = async (status: WatchStatus, history: ControllerHistory): Promise<Partial<Watch>> => {
    const log = noteWatching(kept('watchLog') ?? emptyWatchLog(), now());
    keep('watchLog', log);
    let timing: RequestTiming | undefined;
    let wait: { from: number; until: number } | undefined;
    if (status.kind === 'recovery-requested' || status.kind === 'own-request') {
      timing = await requestTiming(session.chain, hexToBin(identity), history, session.environment.secondsPerBlock).catch(() => undefined);
      const total = delaySeconds(history.current.state.challengeDelay);
      const left = timing?.secondsLeft ?? total;
      wait = { from: now() - Math.max(0, total - left), until: now() + left };
    }
    const protection = assessProtection({
      recovery: wallet.recovery,
      watch: status,
      ...(wait === undefined ? {} : { wait }),
      log,
      now: now(),
      chainVerified: session.servers.length >= 2,
    });
    return { status, history, protection, checkedAt: now(), ...(timing === undefined ? {} : { timing }) };
  };

  const runRef = useRef<() => Promise<void>>(async () => undefined);
  const check = (): Promise<void> => runRef.current();

  useEffect(() => {
    let stopped = false;
    const start = async () => {
      // A wallet opened right after its creation: the servers give the creation out at once and list it a moment
      // later. The history is read again until they do, and the watching starts then.
      let history: ControllerHistory | undefined;
      while (history === undefined && !stopped) {
        history = await readControllerHistory(session.chain, hexToBin(identity)).catch((error: unknown) => {
          setWatch((before) => ({ ...before, problem: (error as Error).message }));
          return undefined;
        });
        if (history === undefined) await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      if (history === undefined) return;
      const genesis = history.transactions[0]?.transactionId;
      if (genesis === undefined || stopped) return;
      const watcher = new Monitor({
        servers: session.servers,
        identity,
        genesisTransactionId: genesis,
        ownKeyHashes: [binToHex(ownerKeyHash)],
        intervalMs: 15_000,
        onStatus: () => undefined,
        onError: (error) => setWatch((before) => ({ ...before, problem: error.message })),
        ...(kept('autoCancel') === true ? { autoCancel: () => wallet.cancel() } : {}),
      });
      monitor.current = watcher;
      // Every check, changed or not, notes that the device was watching and works the protection out again.
      const run = async () => {
        if (stopped) return;
        const status = await watcher.check();
        if (status === undefined) return;
        const read = await readControllerHistory(session.chain, hexToBin(identity)).catch(() => undefined);
        if (read !== undefined && !stopped) {
          const { problem: _gone, ...rest } = await assessNow(status, read);
          setWatch(rest);
        }
      };
      runRef.current = run;
      await run();
      const timer = setInterval(() => void run(), 15_000);
      cleanup = () => clearInterval(timer);
    };
    let cleanup: () => void = () => undefined;
    start().catch((error: Error) => setWatch((before) => ({ ...before, problem: error.message })));
    return () => {
      stopped = true;
      cleanup();
      monitor.current?.stop();
    };
  }, [identity]);

  return { ...watch, check };
};
