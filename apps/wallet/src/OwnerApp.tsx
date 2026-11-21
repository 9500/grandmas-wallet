import { binToHex } from '@bitauth/libauth';
import type { RecoveryStatus } from '@grandmas-wallet/archive';
import { type Balance, type OwnerWallet, type Sent, actionSent, checkRecovery, copyEarlierArchives, makeChange } from '@grandmas-wallet/app';
import type { SeedKeys } from '@grandmas-wallet/core';
import { Button, Card, Frame, Info, Loading, More, type NavItem, Notice, plainError, recheckChain, useEvery, useRoute, useToast } from '@grandmas-wallet/ui';
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

import { Apps } from './Apps.js';
import { Arrival } from './Arrival.js';
import { type ApplicationsPart, useApplications } from './connections.js';
import { TokenNames } from './token-words.js';
import { Details, Erase } from './Details.js';
import { Home } from './Home.js';
import { BRAND } from './brand.js';
import { MovedAway, OwnedElsewhere } from './Elsewhere.js';
import { Receive } from './Receive.js';
import { Recovery } from './Recovery.js';
import { Send } from './Send.js';
import { type Session, deviceWords, keep, kept, noteActivity, openWallet, openingProgress, seedOf, setUpAgain } from './session.js';
import { type Watch, useWatch } from './watch.js';

const ROUTES = ['home', 'receive', 'send', 'apps', 'recovery', 'details'] as const;
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
  /** Whether the wallet's coins pay the fee of refusing a request. */
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
  /** Applications: connections, requests, and the tokens with what they control. */
  apps: ApplicationsPart;
}

export const OwnerApp = ({ session, opened, onLost }: { session: Session; opened?: OwnerWallet | undefined; onLost: () => void }) => {
  const [wallet, setWallet] = useState<OwnerWallet | undefined>(opened);
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => {
    if (wallet === undefined) openWallet(session).then(setWallet, (error: unknown) => setProblem(plainError(error)));
  }, []);
  if (wallet === undefined) {
    return (
      <Frame brand={BRAND} role="Your wallet" environment={session.environment} networkChoice>
        {problem === undefined ? (
          <Opening />
        ) : (
          <Card title="The wallet could not be opened" tone="bad">
            <p>{problem}</p>
            <div class="actions">
              <button type="button" onClick={() => window.location.reload()}>
                Try again
              </button>
              <Button kind="quiet" onClick={recheckChain}>
                Check the chain again
              </Button>
            </div>
            <More summary="If nothing helps">
              <Erase />
            </More>
          </Card>
        )}
      </Frame>
    );
  }
  return <OwnerScreens session={session} wallet={wallet} onLost={onLost} />;
};

/** How long the wallet opens before the page offers to check the chain again. */
const SLOW_OPENING_MS = 15_000;

/**
 * While the wallet opens: how far the check of block headers has come, and, when it takes long, a way to make
 * that check afresh. A block the page's engine kept can be replaced on the chain; its check then stands still
 * until the copy of the headers is made afresh (see engine-headers.ts in the ui package).
 */
const Opening = () => {
  const [started] = useState(() => Date.now());
  const [, setTick] = useState(0);
  useEvery(1_000, () => setTick((count) => count + 1), []);
  const checked = openingProgress();
  return (
    <div class="stack">
      <Loading>
        Opening your wallet. The page checks the chain's block headers first; this takes a moment.
        {checked !== undefined && checked.verifiedHeight < checked.currentHeight && (
          <span class="small opening-progress" data-testid="opening-progress">
            {' '}
            {checked.verifiedHeight.toLocaleString('en-US')} of {checked.currentHeight.toLocaleString('en-US')} checked.
          </span>
        )}
      </Loading>
      {Date.now() - started >= SLOW_OPENING_MS && (
        <Notice tone="warn">
          <div class="stack-s">
            <span>
              This is taking longer than it should.{' '}
              <Info label="Why the wallet does not open">
                The page keeps a copy of the chain's block headers. When the chain replaces a block the copy holds, the copy no longer matches and the wallet waits. Checking again makes the copy afresh. Your keys and coins are not touched.
              </Info>
            </span>
            <div>
              <Button small kind="secondary" onClick={recheckChain}>
                Check the chain again
              </Button>
            </div>
          </div>
        </Notice>
      )}
    </div>
  );
};

const OwnerScreens = ({ session, wallet, onLost }: { session: Session; wallet: OwnerWallet; onLost: () => void }) => {
  const seed = useMemo(() => seedOf(session, deviceWords()), []);
  const [route, navigate] = useRoute(ROUTES, 'home');
  const [balance, setBalance] = useState<Balance | undefined>();
  const [canCancel, setCanCancel] = useState<boolean | undefined>();
  const [recovery, setRecovery] = useState<RecoveryStatus | undefined>();
  const [change, setChange] = useState<ChangeProgress>({});
  const [arrival, setArrival] = useState(() => kept('arrival'));
  const [toastElement, toast] = useToast();
  const [dismissed, setDismissed] = useState(false);
  const watch = useWatch(session, wallet, seed.controllerKey.keyHash, (sent) => {
    noteActivity({ what: 'Refused a recovery request without asking', transactionId: sent.transactionId, bytes: sent.bytes, fee: String(sent.feeSatoshis), remainder: String(sent.remainderSatoshis) });
    toast('A request to move this wallet was refused.');
  });
  const apps = useApplications({
    session,
    wallet,
    seed,
    onSent: (what, outcome) => {
      noteActivity({ what, transactionId: outcome.sent.transactionId, bytes: outcome.sent.bytes, fee: String(outcome.sent.feeSatoshis), remainder: String(outcome.sent.remainderSatoshis) });
      void refresh();
    },
  });

  const refresh = async () => {
    setBalance(await wallet.balance());
    setCanCancel(await wallet.canCancel());
  };
  useEvery(8_000, refresh);

  // The wallet is in use as soon as the network has its creation. Until a block holds it, every check looks
  // at it again: if it is gone, the set-up did not hold, and the phone goes back to its first screen to set it
  // up again with the recoverer (proposal section 7.9). Coins at addresses given out before that stay the
  // phone's by key, and are moved to the new wallet's addresses once it exists.
  useEvery(10_000, async () => {
    if (!wallet.stored.creation.confirmed && (await wallet.creationStep()) !== 'created') {
      setUpAgain();
      onLost();
      return;
    }
    if (wallet.voided.length > 0 && wallet.created && wallet.stored.ownedElsewhere !== true && wallet.stored.otherOwnerSeen !== true) {
      const sent = await wallet.collectVoided();
      if (sent !== undefined) {
        noteActivity({ what: 'Moved coins from addresses given out before the wallet was made again', transactionId: sent.transactionId, bytes: sent.bytes, fee: String(sent.feeSatoshis) });
        await refresh();
      }
    }
  });

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
      keep('lostCreation', undefined);
      // A credential a phone made for its recoverer in an earlier version is with the recoverer now; it is forgotten.
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

  // A change announced to the recoverer is made as soon as its prepared receipt is on the stores. It takes
  // effect as soon as the network has it; until a block holds it, it is looked at again here, and made
  // again if it disappeared.
  useEvery(15_000, async () => {
    const arrangement = kept('arrangement');
    if (arrangement?.change === undefined) {
      setChange({});
      return;
    }
    const { kind } = arrangement.change;
    try {
      const made = await makeChange({ wallet, chain: session.chain, arrangement, storeAt: session.storeAt, network: session.network });
      keep('arrangement', made.arrangement);
      // Made earlier and still on its way to a block: nothing more to do here.
      if (made.sent === undefined && made.arrangement.change !== undefined) {
        setChange({});
        return;
      }
      if (made.sent !== undefined) noteActivity({ what: kind === 'new seed' ? 'Handed the wallet to the new phone' : kind === 'new recoverer' ? 'Changed the recoverer' : 'Changed the waiting period', transactionId: made.sent.transactionId, bytes: made.sent.bytes, fee: String(made.sent.feeSatoshis) });
      if (kind === 'new recoverer') {
        const next = kept('newRecoverer');
        if (next !== undefined) {
          keep('recipient', next.recipient);
          const setup = kept('setup');
          if (setup !== undefined) keep('setup', { ...setup, recipient: next.recipient });
        }
      }
      setChange({});
      if (made.sent !== undefined) toast(kind === 'new seed' ? 'The wallet now belongs to your new phone.' : 'The change is made.');
      await checkReceipts();
      await watch.check();
    } catch (error) {
      const message = (error as Error).message;
      setChange(/prepared receipt/.test(message) ? { kind, waiting: true } : { kind, problem: plainError(error) });
    }
  });

  // After a takeover or a move to a new seed, what the earlier archives hold about applications (templates, token
  // notes and position records) is copied into the archive in use, which the earlier phone cannot read (section
  // 10.6), and then read: a template an earlier owner stored is offered, a note is a hint, and a position record is
  // a suggestion until the chain bears it out. A record of an action that was never sent is not copied.
  useEvery(20_000, async () => {
    const arrangement = kept('arrangement');
    if (arrangement === undefined || arrangement.movedTo !== undefined) return;
    const done = new Set(arrangement.copiedArchives ?? []);
    if (arrangement.earlierArchives.every((earlier) => done.has(earlier.archiveId))) return;
    const copied = await copyEarlierArchives({ arrangement, storeAt: session.storeAt, whetherSent: actionSent(wallet.parts) });
    // Only what was copied is taken over: the arrangement may have changed meanwhile.
    const current = kept('arrangement');
    if (current !== undefined) keep('arrangement', { ...current, copiedArchives: [...new Set([...(current.copiedArchives ?? []), ...(copied.arrangement.copiedArchives ?? [])])] });
    if (copied.copied > 0) {
      await apps.applications.readBackup();
      apps.changed();
    }
    // An unfinished copy is continued at the next turn.
    if (copied.unfinished.length > 0) console.warn(copied.unfinished.join(' '));
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
    apps,
  };

  const moved = kept('arrangement')?.movedTo;
  const elsewhere = watch.status?.kind === 'owned-elsewhere';
  // As soon as the network shows another owner, this phone gives out nothing and takes on nothing; if that
  // change disappears before a block holds it, the phone carries on by itself.
  useEffect(() => {
    if (wallet.stored.identity !== undefined && (elsewhere || wallet.stored.otherOwnerSeen === true || wallet.stored.ownedElsewhere === true)) {
      void wallet.checkOwnership(session.servers.length >= 2).catch(() => undefined);
    }
  }, [elsewhere, watch.history?.transactions.length, watch.history?.currentConfirmed]);

  const alarm = watch.status?.kind === 'recovery-requested';
  const nav: NavItem<Route>[] = [
    { route: 'home', label: 'Home', icon: 'home' },
    { route: 'receive', label: 'Receive', icon: 'receive' },
    { route: 'send', label: 'Send', icon: 'send' },
    { route: 'apps', label: 'Apps', icon: 'apps', flag: apps.proposals.length + apps.asks.length > 0 },
    { route: 'recovery', label: 'Recovery', icon: 'shield', flag: alarm || (watch.protection !== undefined && watch.protection.gaps.some((gap) => !isChainGap(gap))) },
    { route: 'details', label: 'Details', icon: 'details', sideOnly: true },
  ];

  let screen: JSX.Element;
  if (moved !== undefined) screen = <MovedAway owner={owner} />;
  else if (elsewhere) screen = <OwnedElsewhere owner={owner} />;
  else if (arrival !== undefined && arrival.swept !== true) screen = <Arrival owner={owner} onDone={() => setArrival(kept('arrival'))} onLater={() => setArrival({ ...arrival, swept: true })} />;
  else {
    const screens: Record<Route, () => JSX.Element> = {
      home: () => <Home owner={owner} />,
      receive: () => <Receive owner={owner} />,
      send: () => <Send owner={owner} />,
      apps: () => <Apps owner={owner} />,
      recovery: () => <Recovery owner={owner} />,
      details: () => <Details owner={owner} />,
    };
    screen = screens[route]();
  }
  const incoming = kept('incoming');
  const asked = apps.proposals.length + apps.asks.length;
  const offer = plain_(moved, elsewhere, arrival) ? null : asked > 0 && route !== 'apps' ? (
    <div class="incoming">
      <Notice tone="wait">
        <div class="row spread">
          <span>{asked === 1 ? 'An application asks for your decision.' : `${asked} requests from applications wait for your decision.`}</span>
          <Button small onClick={() => navigate('apps')}>
            Show
          </Button>
        </div>
      </Notice>
    </div>
  ) : dismissed || incoming === undefined ? null : incoming.kind === 'connect' && route !== 'apps' ? (
    <div class="incoming">
      <Notice tone="wait">
        <div class="row spread">
          <span>You opened an application's connection link. Connect this wallet to it?</span>
          <span class="row">
            <Button small onClick={() => navigate('apps')}>
              Show
            </Button>
            <Button small kind="quiet" onClick={() => { keep('incoming', undefined); setDismissed(true); }}>
              Not now
            </Button>
          </span>
        </div>
      </Notice>
    </div>
  ) : route === 'recovery' ? null : incoming.kind === 'recoverer' || incoming.kind === 'prepare' ? (
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
    <TokenNames.Provider value={apps.names}>
      <Frame brand={BRAND} role="Your wallet" environment={session.environment} networkChoice {...(plain ? {} : { nav, current: route, onNavigate: navigate })}>
        {offer}
        {screen}
        {toastElement}
      </Frame>
    </TokenNames.Provider>
  );
};

const plain_ = (moved: string | undefined, elsewhere: boolean, arrival: { swept?: boolean } | undefined): boolean => moved !== undefined || elsewhere || (arrival !== undefined && arrival.swept !== true);

/** The gap that is about the servers rather than about this wallet. */
export const isChainGap = (gap: string): boolean => /servers say/.test(gap);

export const ownerKeyHex = (owner: Owner): string => binToHex(owner.seed.controllerKey.keyHash);
