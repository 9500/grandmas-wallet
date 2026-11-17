import { binToHex } from '@bitauth/libauth';
import type { RecoveryStatus } from '@grandmas-wallet/archive';
import { type Balance, type OwnerWallet, type Sent, checkRecovery, makeChange } from '@grandmas-wallet/app';
import type { SeedKeys } from '@grandmas-wallet/core';
import { Button, Card, Frame, Loading, type NavItem, Notice, plainError, useEvery, useRoute, useToast } from '@grandmas-wallet/ui';
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

import { Arrival } from './Arrival.js';
import { Details } from './Details.js';
import { Home } from './Home.js';
import { BRAND } from './brand.js';
import { MovedAway, OwnedElsewhere } from './Elsewhere.js';
import { Receive } from './Receive.js';
import { Recovery } from './Recovery.js';
import { Send } from './Send.js';
import { type Session, deviceWords, keep, kept, noteActivity, openWallet, seedOf } from './session.js';
import { type Watch, useWatch } from './watch.js';

const ROUTES = ['home', 'receive', 'send', 'recovery', 'details'] as const;
export type Route = (typeof ROUTES)[number];

/** Where a change announced to the recoverer stands (section 9.7). */
export interface ChangeProgress {
  kind?: 'new seed' | 'new recoverer' | 'waiting period';
  /** Waiting for the recoverer's prepared receipt. */
  waiting?: boolean;
  problem?: string;
}

/** What every screen of the owner's wallet is given. */
export interface Owner {
  session: Session;
  wallet: OwnerWallet;
  seed: SeedKeys;
  balance?: Balance;
  canCancel?: boolean;
  recovery?: RecoveryStatus;
  watch: Watch & { check: () => Promise<void> };
  change: ChangeProgress;
  refresh: () => Promise<void>;
  checkReceipts: () => Promise<void>;
  navigate: (route: Route) => void;
  toast: (text: string) => void;
  /** Record a transaction this phone sent, and read the wallet again. */
  sent: (what: string, sent: Sent, amount?: bigint) => void;
}

export const OwnerApp = ({ session, opened }: { session: Session; opened?: OwnerWallet | undefined }) => {
  const [wallet, setWallet] = useState<OwnerWallet | undefined>(opened);
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => {
    if (wallet === undefined) openWallet(session).then(setWallet, (error: unknown) => setProblem(plainError(error)));
  }, []);
  if (wallet === undefined) {
    return (
      <Frame brand={BRAND} role="Your wallet" environment={session.environment}>
        {problem === undefined ? (
          <Loading>Opening your wallet. The page checks the chain's block headers first; this takes a moment.</Loading>
        ) : (
          <Card title="The wallet could not be opened" tone="bad">
            <p>{problem}</p>
            <div class="actions">
              <button type="button" onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          </Card>
        )}
      </Frame>
    );
  }
  return <OwnerScreens session={session} wallet={wallet} />;
};

const OwnerScreens = ({ session, wallet }: { session: Session; wallet: OwnerWallet }) => {
  const seed = useMemo(() => seedOf(session, deviceWords()), []);
  const [route, navigate] = useRoute(ROUTES, 'home');
  const [balance, setBalance] = useState<Balance | undefined>();
  const [canCancel, setCanCancel] = useState<boolean | undefined>();
  const [recovery, setRecovery] = useState<RecoveryStatus | undefined>();
  const [change, setChange] = useState<ChangeProgress>({});
  const [arrival, setArrival] = useState(() => kept('arrival'));
  const [toastElement, toast] = useToast();
  const [dismissed, setDismissed] = useState(false);
  const watch = useWatch(session, wallet, seed.controllerKey.keyHash, canCancel ?? true);

  const refresh = async () => {
    setBalance(await wallet.balance());
    setCanCancel(await wallet.canCancel());
  };
  useEvery(8_000, refresh);

  /** Whether recovery is on: the recoverer's receipt on the stores, against what this phone sent and the chain. */
  const checkReceipts = async () => {
    const checked = await checkRecovery({ wallet, chain: session.chain, arrangement: kept('arrangement'), storeAt: session.storeAt, network: session.network });
    // Only the receipt's hash is taken over: a change may have been announced meanwhile.
    const current = kept('arrangement');
    if (current !== undefined && checked.arrangement !== undefined) {
      const { latestReceiptHash: _earlier, ...rest } = current;
      const latest = checked.arrangement.latestReceiptHash;
      keep('arrangement', latest === undefined ? rest : { ...rest, latestReceiptHash: latest });
    }
    setRecovery(checked.status);
    if (checked.status.on) {
      // The credential's words are with the recoverer now; this phone forgets them.
      const setup = kept('setup');
      if (setup?.credentialWords !== undefined) {
        const { credentialWords: _forgotten, ...rest } = setup;
        keep('setup', rest);
      }
      keep('kitLink', undefined);
      if (kept('arrangement')?.change === undefined) keep('newRecoverer', undefined);
    }
  };
  useEvery(recovery?.on === true ? 120_000 : 20_000, checkReceipts, [recovery?.on]);

  // A change announced to the recoverer is made as soon as its prepared receipt is on the stores.
  useEvery(15_000, async () => {
    const arrangement = kept('arrangement');
    if (arrangement?.change === undefined || arrangement.movedTo !== undefined) {
      setChange({});
      return;
    }
    const { kind } = arrangement.change;
    try {
      const made = await makeChange({ wallet, chain: session.chain, arrangement, storeAt: session.storeAt, network: session.network });
      keep('arrangement', made.arrangement);
      if (made.sent !== undefined) noteActivity({ what: kind === 'new seed' ? 'Handed the wallet to the new phone' : kind === 'new recoverer' ? 'Changed the recoverer' : 'Changed the waiting period', transactionId: made.sent.transactionId, bytes: made.sent.bytes, fee: String(made.sent.feeSatoshis) });
      if (kind === 'new recoverer') {
        const next = kept('newRecoverer');
        if (next !== undefined) {
          keep('recipient', next.recipient);
          const setup = kept('setup');
          if (setup !== undefined) keep('setup', { ...setup, recipient: next.recipient });
        }
      }
      if (kind === 'waiting period') keep('newDelay', undefined);
      setChange({});
      toast(kind === 'new seed' ? 'The wallet now belongs to your new phone.' : 'The change is made.');
      await checkReceipts();
      await watch.check();
    } catch (error) {
      const message = (error as Error).message;
      setChange(/prepared receipt/.test(message) ? { kind, waiting: true } : { kind, problem: plainError(error) });
    }
  });

  const owner: Owner = {
    session,
    wallet,
    seed,
    ...(balance === undefined ? {} : { balance }),
    ...(canCancel === undefined ? {} : { canCancel }),
    ...(recovery === undefined ? {} : { recovery }),
    watch,
    change,
    refresh,
    checkReceipts,
    navigate,
    toast,
    sent: (what, sent, amount) => {
      noteActivity({ what, transactionId: sent.transactionId, bytes: sent.bytes, fee: String(sent.feeSatoshis), remainder: String(sent.remainderSatoshis), ...(amount === undefined ? {} : { amount: String(amount) }) });
      void refresh();
    },
  };

  const moved = kept('arrangement')?.movedTo;
  const elsewhere = watch.status?.kind === 'owned-elsewhere';
  useEffect(() => {
    if (elsewhere) void wallet.checkOwnership(session.servers.length >= 2).catch(() => undefined);
  }, [elsewhere]);

  const alarm = watch.status?.kind === 'recovery-requested';
  const nav: NavItem<Route>[] = [
    { route: 'home', label: 'Home', icon: 'home' },
    { route: 'receive', label: 'Receive', icon: 'receive' },
    { route: 'send', label: 'Send', icon: 'send' },
    { route: 'recovery', label: 'Recovery', icon: 'shield', flag: alarm || (watch.protection !== undefined && watch.protection.gaps.some((gap) => !isChainGap(gap))) },
    { route: 'details', label: 'Details', icon: 'details', sideOnly: true },
  ];

  let screen: JSX.Element;
  if (moved !== undefined) screen = <MovedAway owner={owner} />;
  else if (elsewhere) screen = <OwnedElsewhere owner={owner} />;
  else if (arrival !== undefined && arrival.swept !== true) screen = <Arrival owner={owner} onDone={() => setArrival(kept('arrival'))} />;
  else {
    const screens: Record<Route, () => JSX.Element> = {
      home: () => <Home owner={owner} />,
      receive: () => <Receive owner={owner} />,
      send: () => <Send owner={owner} />,
      recovery: () => <Recovery owner={owner} />,
      details: () => <Details owner={owner} />,
    };
    screen = screens[route]();
  }
  const incoming = kept('incoming');
  const offer =
    dismissed || plain_(moved, elsewhere, arrival) || incoming === undefined || route === 'recovery' ? null : incoming.kind === 'recoverer' || incoming.kind === 'prepare' ? (
      <div class="incoming">
        <Notice tone="wait">
          <div class="row spread">
            <span>{incoming.kind === 'recoverer' ? 'You opened a recoverer\'s link. Make them your recoverer?' : 'You opened a link from a new phone. Move this wallet to it?'}</span>
            <span class="row">
              <Button small onClick={() => navigate('recovery')}>
                {incoming.kind === 'recoverer' ? 'Change recoverer' : 'Move to the new phone'}
              </Button>
              <Button small kind="quiet" onClick={() => { keep('incoming', undefined); setDismissed(true); }}>
                Not now
              </Button>
            </span>
          </div>
        </Notice>
      </div>
    ) : null;
  const plain = moved !== undefined || elsewhere || (arrival !== undefined && arrival.swept !== true);
  return (
    <Frame brand={BRAND} role="Your wallet" environment={session.environment} {...(plain ? {} : { nav, current: route, onNavigate: navigate })}>
      {offer}
      {screen}
      {toastElement}
    </Frame>
  );
};

const plain_ = (moved: string | undefined, elsewhere: boolean, arrival: { swept?: boolean } | undefined): boolean => moved !== undefined || elsewhere || (arrival !== undefined && arrival.swept !== true);

/** The gap that is about the servers rather than about this wallet. */
export const isChainGap = (gap: string): boolean => /servers say/.test(gap);

export const ownerKeyHex = (owner: Owner): string => binToHex(owner.seed.controllerKey.keyHash);
