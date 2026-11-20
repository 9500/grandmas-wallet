import '@grandmas-wallet/ui/styles.css';
import './loan.css';

import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import { DappRequests, type RequestStage } from '@grandmas-wallet/connect';
import { type DappCredentials, type DappLink, type LinkStatus, openDappLink } from '@grandmas-wallet/connect/wizard';
import { type Environment, Button, Card, Frame, Loading, Vault, formatBch, loadEnvironment, plainError, useEvery } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type LoanView, type Market, formatPusd } from './loan.js';
import { type MadeKey, type PageChain, generalProtocolsOracle, readMarket } from './market.js';
import { type ActionState, type LinkWords, type Progress, ConnectCard, ConnectedCard, HowItWorks, Independent, Intro, LoanList, NewLoanCard, OnItsWay, PricesCard, borrowName, closeName, keyName, manageName, moveName, repayName } from './view.js';
import { type KeptKey, type Outcome, type PendingRequest, STAGE_WORDS, XoLoans, xoProblem } from './xo.js';

/**
 * The loan page: an independent demonstration on chipnet with Paryon's public contracts, for a wallet that
 * carries out the actions of a template itself. The page reads the chain and the oracle; the wallet builds,
 * shows and signs every transaction.
 */

const BRAND = 'Loan desk';
const ROLE = 'Independent, not affiliated with Paryon';
const vault = new Vault('loan');

const pendingStore = {
  get: () => vault.get<PendingRequest[]>('pending') ?? [],
  set: (requests: PendingRequest[]) => (requests.length === 0 ? vault.remove('pending') : vault.set('pending', requests)),
};
const keyStore = {
  get: () => vault.get<KeptKey[]>('keys') ?? [],
  set: (keys: KeptKey[]) => (keys.length === 0 ? vault.remove('keys') : vault.set('keys', keys)),
};

/** The first of the configured servers that answers, as the page reads it. */
const connectServer = async (endpoints: string[]): Promise<PageChain> => {
  for (const endpoint of endpoints) {
    const server = await Electrum.connect(endpoint).catch(() => undefined);
    if (server === undefined) continue;
    return {
      getTransaction: (transactionId) => server.getTransaction(transactionId),
      listUnspent: (lockingBytecode) => server.listUnspent(lockingBytecode, 'include'),
      tip: () => server.tip(),
    };
  }
  throw new Error('None of the network\'s servers could be reached. Check the connection and reload.');
};

const RESUMED_TITLE: Record<PendingRequest['action'], string> = {
  createKey: 'Making a loan key, asked of your wallet before this page was loaded again.',
  movePeriod: 'Bringing Paryon\'s contracts up to date, asked of your wallet before this page was loaded again.',
  borrow: 'Borrowing, asked of your wallet before this page was loaded again.',
  manage: 'Changing a loan\'s collateral, asked of your wallet before this page was loaded again.',
  repay: 'Repaying part of a loan, asked of your wallet before this page was loaded again.',
  close: 'Closing a loan, asked of your wallet before this page was loaded again.',
};
const RESUMED_DONE: Record<PendingRequest['action'], string> = {
  createKey: 'The loan key is made.',
  movePeriod: 'Paryon\'s contracts are up to date.',
  borrow: 'The loan is open. The PUSD and the key are in your wallet.',
  manage: 'The collateral is changed.',
  repay: 'Repaid.',
  close: 'The loan is closed. The collateral is back in your wallet.',
};

const follow = (progress: (step: Progress) => void) => (stage: RequestStage) => progress({ text: STAGE_WORDS[stage], stage });

/**
 * The address this page is served from, for the wallet's record of each loan key: where the user can open the
 * page again. A page is replaceable; whoever serves a copy has its own address here.
 */
const pageAddress = (): string | undefined => {
  const { protocol, origin, pathname } = window.location;
  return protocol === 'https:' || protocol === 'http:' ? `${origin}${pathname}` : undefined;
};

/** The page once a wallet is connected. */
const Loans = ({ environment, loans, chain, peerName, onDisconnect }: { environment: Environment; loans: XoLoans; chain: PageChain; peerName: string; onDisconnect: () => void }) => {
  const [market, setMarket] = useState<(Market & { oracleProblem?: string }) | undefined>();
  const [marketProblem, setMarketProblem] = useState<string | undefined>();
  const [listing, setListing] = useState<{ trusted: boolean; loans: LoanView[] } | undefined>();
  const [listProblem, setListProblem] = useState<string | undefined>();
  const [keys, setKeys] = useState<MadeKey[] | undefined>();
  const [state, setState] = useState<ActionState>({});
  const running = useRef(false);

  const readPrices = async (): Promise<void> => {
    try {
      setMarket(await readMarket(chain, environment.network, generalProtocolsOracle));
      setMarketProblem(undefined);
    } catch (error) {
      setMarketProblem(plainError(error));
    }
  };
  const refresh = async (): Promise<void> => {
    try {
      setListing(await loans.list());
      setListProblem(undefined);
    } catch (error) {
      setListProblem(plainError(error));
    }
    setKeys(await loans.waitingKeys().catch(() => keys ?? []));
  };

  /** Run one action at a time, with its progress on the page and its outcome where it was started. */
  const act = async (name: string, title: string, work: (progress: (step: Progress) => void) => Promise<Outcome>, doneText: string): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setState({ running: { name, title } });
    let ended: ActionState;
    try {
      const outcome = await work((progress) => setState({ running: { name, title, progress } }));
      ended = { done: { name, text: doneText, ...(outcome.transactionId === undefined ? {} : { transactionId: outcome.transactionId }) } };
    } catch (error) {
      ended = { error: { name, message: plainError(error) } };
    }
    // The lists are read again before the outcome is shown, so that they already agree with it.
    await Promise.all([refresh(), readPrices()]);
    running.current = false;
    setState(ended);
    // A server may list a transaction a moment after it took it.
    setTimeout(() => void refresh(), 4_000);
  };

  useEffect(() => {
    void readPrices();
    void refresh();
    // Requests sent before the page was loaded again are sent once more, under the same identifiers.
    void (async () => {
      for (const kept of loans.pending()) {
        await act(`resume:${kept.id}`, RESUMED_TITLE[kept.action], (progress) => loans.resume(kept, follow(progress)), RESUMED_DONE[kept.action]);
      }
    })();
  }, [loans]);
  useEvery(30_000, async () => {
    if (!running.current) await refresh();
  }, [loans]);
  useEvery(60_000, async () => {
    if (!running.current) await readPrices();
  }, [loans]);

  const facts = { network: environment.network, explorer: environment.explorer };
  const stopWaiting =
    state.running?.name.startsWith('resume:') === true
      ? () => {
          loans.abandon(state.running?.name.slice('resume:'.length) ?? '');
          window.location.reload();
        }
      : undefined;
  return (
    <div class="stack">
      <Independent />
      <ConnectedCard peerName={peerName} onDisconnect={onDisconnect} />
      <div class="columns">
        <div class="stack">
          {state.running !== undefined && <OnItsWay title={state.running.title} progress={state.running.progress} onStopWaiting={stopWaiting} />}
          {state.error !== undefined && state.error.name.startsWith('resume:') && (
            <Card title="A request from before" tone="warn">
              <p>{state.error.message}</p>
            </Card>
          )}
          <LoanList
            loans={listing?.loans}
            trusted={listing?.trusted ?? true}
            onOffer={() => loans.offerTemplate()}
            onTrusted={() => void refresh()}
            problem={listProblem}
            market={market}
            facts={facts}
            state={state}
            onManage={(loan, collateral) => {
              const now = loan.found?.loan.output.valueSatoshis ?? 0n;
              const change = collateral > now ? `Adding ${formatBch(collateral - now)} BCH of collateral` : `Taking ${formatBch(now - collateral)} BCH of collateral out`;
              void act(manageName(loan), `${change}; the loan then holds ${formatBch(collateral)} BCH.`, (progress) => loans.manage(loan.category, collateral, follow(progress)), 'The collateral is changed. The key is back where it was in your wallet.');
            }}
            onRepay={(loan, repay) => void act(repayName(loan), `Repaying ${formatPusd(repay)} PUSD of the loan.`, (progress) => loans.repay(loan, repay, follow(progress)), 'Repaid. The PUSD repaid are destroyed; the loan stays open.')}
            onClose={(loan) => void act(closeName(loan), `Repaying ${formatPusd(loan.debt ?? 0n)} PUSD and closing the loan.`, (progress) => loans.close(loan.category, follow(progress)), 'The loan is closed. The collateral is back in your wallet, and so is the key.')}
          />
        </div>
        <div class="stack">
        <NewLoanCard
          market={market}
          keys={keys}
          facts={facts}
          state={state}
          onMakeKey={() => void act(keyName, 'Making a loan key.', (progress) => loans.createKey(follow(progress)), 'The loan key is made. It waits in Paryon\'s contracts until you borrow.')}
          onMove={(need) => void act(moveName, 'Bringing Paryon\'s contracts up to date.', (progress) => loans.movePeriod(need.thread, market?.lockHeight ?? 0, follow(progress)), 'Paryon\'s contracts are up to date.')}
          onBorrow={(key, plan, need) =>
            void act(borrowName, `Borrowing ${formatPusd(plan.debt)} PUSD against ${formatBch(plan.collateral)} BCH.`, (progress) => (market === undefined ? Promise.reject(new Error('The prices are not read yet.')) : loans.borrow(key, need.thread, market, plan, follow(progress))), 'The loan is open. The PUSD and the loan key are in your wallet.')
          }
        />
        <PricesCard market={market} problem={marketProblem} />
        </div>
      </div>
    </div>
  );
};

const App = ({ environment }: { environment: Environment }) => {
  const link = useRef<DappLink | undefined>(undefined);
  const [status, setStatus] = useState<LinkStatus>({ state: 'connecting' });
  const [problem, setProblem] = useState<string | undefined>();
  const [usable, setUsable] = useState(false);
  const [address, setAddress] = useState<string | undefined>();
  const [resuming, setResuming] = useState(false);
  const [chain, setChain] = useState<PageChain | undefined>();
  const [chainProblem, setChainProblem] = useState<string | undefined>();

  const start = (credentials?: DappCredentials) => {
    link.current?.close();
    setUsable(false);
    setProblem(undefined);
    setAddress(undefined);
    setResuming(credentials?.walletPublicKey !== undefined);
    const opened = openDappLink({
      name: BRAND,
      icon: `${window.location.origin}/icon.svg`,
      relays: environment.relays,
      ...(credentials === undefined ? {} : { credentials }),
      onCredentials: (current) => vault.set('credentials', current),
      onStatus: (next, offered) => {
        setStatus(next);
        if (next.state === 'connected' && offered !== undefined) {
          const reason = offered.xo === undefined ? (offered.xoProblem ?? xoProblem(undefined, environment.network)) : xoProblem(offered.xo, environment.network);
          setUsable(reason === undefined);
          setProblem(reason);
          setResuming(false);
        }
        if (next.state === 'disconnected' && next.reason !== undefined) {
          setUsable(false);
          setProblem(next.reason);
        }
      },
    });
    link.current = opened;
    setAddress(opened.uri);
  };

  const reachChain = () => {
    setChainProblem(undefined);
    connectServer(environment.chain).then(setChain, (error: unknown) => setChainProblem(plainError(error)));
  };

  useEffect(() => {
    if (environment.network !== 'chipnet') return;
    const saved = vault.get<DappCredentials>('credentials');
    // A session with a wallet is resumed; without one, a fresh address is shown.
    start(saved?.walletPublicKey === undefined ? undefined : saved);
    reachChain();
    return () => link.current?.close();
  }, []);

  const forget = () => {
    vault.remove('credentials');
    vault.remove('pending');
    start();
  };

  const loans = useMemo((): XoLoans | undefined => {
    const current = link.current;
    if (current === undefined || !usable || status.state !== 'connected' || chain === undefined) return undefined;
    const requests = new DappRequests();
    requests.attach(current.channel);
    return new XoLoans(requests, chain, pendingStore, keyStore, pageAddress());
  }, [usable, chain, status.state === 'connected']);

  if (environment.network !== 'chipnet') {
    return (
      <div class="stack">
        <Independent />
        <Card title="Chipnet only" tone="warn">
          <p>This demonstration uses Paryon's deployment on chipnet, and this page is configured for {environment.network}. Open it with the chipnet configuration.</p>
        </Card>
      </div>
    );
  }
  if (status.state === 'connected' && usable) {
    if (loans !== undefined && chain !== undefined) return <Loans environment={environment} loans={loans} chain={chain} peerName={status.peerName ?? 'your wallet'} onDisconnect={forget} />;
    if (chainProblem !== undefined) {
      return (
        <Card title="The network cannot be reached" tone="bad">
          <p>{chainProblem}</p>
          <div class="actions">
            <Button onClick={reachChain}>Try again</Button>
            <Button kind="quiet" onClick={forget}>
              Disconnect
            </Button>
          </div>
        </Card>
      );
    }
    return <Loading>Connecting to the network…</Loading>;
  }

  const words: LinkWords = resuming ? 'resuming' : status.state === 'waiting' ? 'waiting' : address === undefined ? 'preparing' : 'connecting';
  return (
    <div class="stack">
      <Intro />
      <Independent />
      <div class="columns">
        <ConnectCard uri={address} state={words} problem={problem} onForget={resuming || problem !== undefined || vault.get<DappCredentials>('credentials')?.walletPublicKey !== undefined ? forget : undefined} />
        <HowItWorks />
      </div>
    </div>
  );
};

const Root = () => {
  const [environment, setEnvironment] = useState<Environment | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => {
    loadEnvironment().then(setEnvironment, (error: unknown) => setProblem(plainError(error)));
  }, []);
  return (
    <Frame brand={BRAND} role={ROLE} environment={environment}>
      {problem !== undefined ? (
        <Card title="The page could not start" tone="bad">
          <p>{problem}</p>
        </Card>
      ) : environment === undefined ? (
        <Loading>Starting…</Loading>
      ) : (
        <App environment={environment} />
      )}
    </Frame>
  );
};

render(<Root />, document.getElementById('app') as HTMLElement);
