import '@grandmas-wallet/ui/styles.css';
import './loan.css';

import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import { DappRequests, type RequestStage } from '@grandmas-wallet/connect';
import { type DappCredentials, type DappLink, type LinkStatus, openDappLink } from '@grandmas-wallet/connect/wizard';
import { type Environment, Button, Card, Frame, Loading, Vault, chooseNetwork, followWallet, formatBch, loadEnvironment, networkWords, plainError, returnToStartingNetwork, TabElsewhere, tabElsewhere, useEvery } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type Desk, type LoanView, type Market, deskFor, formatPusd } from './loan.js';
import { type MadeKey, type PageChain, generalProtocolsOracle, readMarket } from './market.js';
import { type ActionState, type LinkWords, type Progress, ConnectCard, ConnectedCard, HowItWorks, Independent, Intro, LoanList, LoanNeeds, NewLoanCard, OnItsWay, PricesCard, borrowName, closeName, keyName, manageName, moveName, repayName } from './view.js';
import { type KeptKey, type Outcome, type PendingRequest, STAGE_WORDS, XoLoans, xoProblem } from './xo.js';

/**
 * The loan page: an independent demonstration with Paryon's public contracts, for a wallet that carries out the
 * actions of a template itself. It works with Paryon's deployments on mainnet and on chipnet, or with one its
 * configuration names, as on a chain of one's own. The page reads the chain, and for Paryon's own deployment the oracle; the wallet
 * builds, shows and signs every transaction.
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
 * The steps of an action that the page may ask for again, when someone else used one of Paryon's coins first: the
 * line that says so stays above the steps of the new try.
 */
const followTries = (progress: (step: Progress) => void): [(stage: RequestStage) => void, (words: string) => void] => {
  let again: string | undefined;
  return [
    (stage) => progress({ text: STAGE_WORDS[stage], stage, ...(again === undefined ? {} : { again }) }),
    (words) => {
      again = words;
      progress({ text: STAGE_WORDS.sent, stage: 'sent', again });
    },
  ];
};

/**
 * The address this page is served from, for the wallet's record of each loan key: where the user can open the
 * page again. A page is replaceable; whoever serves a copy has its own address here.
 */
const pageAddress = (): string | undefined => {
  const { protocol, origin, pathname } = window.location;
  return protocol === 'https:' || protocol === 'http:' ? `${origin}${pathname}` : undefined;
};

/** The page once a wallet is connected. */
const Loans = ({ environment, desk, loans, chain, peerName, onDisconnect }: { environment: Environment; desk: Desk; loans: XoLoans; chain: PageChain; peerName: string; onDisconnect: () => void }) => {
  const [market, setMarket] = useState<(Market & { oracleProblem?: string }) | undefined>();
  const [marketProblem, setMarketProblem] = useState<string | undefined>();
  const [listing, setListing] = useState<{ trusted: boolean; loans: LoanView[] } | undefined>();
  const [listProblem, setListProblem] = useState<string | undefined>();
  const [keys, setKeys] = useState<MadeKey[] | undefined>();
  const [state, setState] = useState<ActionState>({});
  const running = useRef(false);

  const readPrices = async (): Promise<void> => {
    try {
      // The oracle signs the prices of Paryon's own deployments; one on a chain of one's own has a price nobody updates.
      setMarket(await readMarket(chain, environment.network, desk.paryons ? generalProtocolsOracle : undefined, desk));
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
    // A server may list a transaction a moment after it took it: the lists and Paryon's contracts are read again, so
    // that a step just done is not offered again until the next reading.
    setTimeout(() => void Promise.all([refresh(), readPrices()]), 4_000);
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
  // While the wallet tells this page nothing, the user may be deciding in the wallet whether it may: asked again soon,
  // so that the list follows the user's word within seconds.
  useEvery(4_000, async () => {
    if (!running.current && listing?.trusted === false) await refresh();
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
      <Independent desk={desk} />
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
              void act(manageName(loan), `${change}; the loan then holds ${formatBch(collateral)} BCH.`, (progress) => loans.manage(loan.category, collateral, ...followTries(progress)), 'The collateral is changed. The key is back where it was in your wallet.');
            }}
            onRepay={(loan, repay) => void act(repayName(loan), `Repaying ${formatPusd(repay)} PUSD of the loan.`, (progress) => loans.repay(loan, repay, ...followTries(progress)), 'Repaid. The PUSD repaid are destroyed; the loan stays open.')}
            onClose={(loan) => void act(closeName(loan), `Repaying ${formatPusd(loan.debt ?? 0n)} PUSD and closing the loan.`, (progress) => loans.close(loan.category, ...followTries(progress)), 'The loan is closed. The collateral is back in your wallet, and so is the key.')}
          />
        </div>
        <div class="stack">
        <NewLoanCard
          market={market}
          desk={desk}
          keys={keys}
          facts={facts}
          state={state}
          onMakeKey={() => void act(keyName, 'Making a loan key.', (progress) => loans.createKey(...followTries(progress)), 'The loan key is made. It waits in Paryon\'s contracts until you borrow.')}
          onMove={(need) => void act(moveName, 'Bringing Paryon\'s contracts up to date.', (progress) => loans.movePeriod(need.thread, market?.lockHeight ?? 0, follow(progress)), 'Paryon\'s contracts are up to date.')}
          onBorrow={(key, plan, need) =>
            void act(borrowName, `Borrowing ${formatPusd(plan.debt)} PUSD against ${formatBch(plan.collateral)} BCH.`, (progress) => (market === undefined ? Promise.reject(new Error('The prices are not read yet.')) : loans.borrow(key, need.thread, market, plan, follow(progress))), 'The loan is open. The PUSD and the loan key are in your wallet.')
          }
        />
        <PricesCard market={market} problem={marketProblem} desk={desk} />
        </div>
      </div>
    </div>
  );
};

const App = ({ environment }: { environment: Environment }) => {
  const desk = useMemo(() => deskFor(environment), [environment]);
  const link = useRef<DappLink | undefined>(undefined);
  const [status, setStatus] = useState<LinkStatus>({ state: 'connecting' });
  const [problem, setProblem] = useState<string | undefined>();
  const [usable, setUsable] = useState(false);
  const [address, setAddress] = useState<string | undefined>();
  const [resuming, setResuming] = useState(false);
  const [chain, setChain] = useState<PageChain | undefined>();
  const [chainProblem, setChainProblem] = useState<string | undefined>();
  const [moving, setMoving] = useState<string | undefined>();

  /**
   * The page works on the network of the wallet that connected: it changes to it where the deployment offers it,
   * carrying the session over, and otherwise says why not.
   */
  const follow = (walletNetwork: string): string | undefined => {
    const decision = followWallet(environment, walletNetwork);
    if (decision.kind === 'same') return undefined;
    if (decision.kind === 'refuse') return decision.reason;
    setMoving(decision.network);
    void chooseNetwork(environment, decision.network, (side) => {
      const credentials = vault.get<DappCredentials>('credentials');
      if (credentials !== undefined) vault.on(side).set('credentials', credentials);
      vault.remove('credentials');
    }).then((moved) => {
      if (moved) return;
      setMoving(undefined);
      setProblem(`Your wallet is on ${networkWords(decision.network).name}; this page stays on ${networkWords(environment.network).name}.`);
    });
    return undefined;
  };

  // Before a wallet is connected, the page reads Paryon's contracts and the prices once, to show what a loan needs.
  const [glance, setGlance] = useState<Market | undefined>();
  const [glanceProblem, setGlanceProblem] = useState<string | undefined>();

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
          const elsewhere = offered.xo === undefined ? undefined : follow(offered.xo.network);
          const reason = offered.xo === undefined ? (offered.xoProblem ?? xoProblem(undefined, environment.network)) : offered.xo.network !== environment.network ? elsewhere : xoProblem(offered.xo, environment.network);
          setUsable(reason === undefined && offered.xo?.network === environment.network);
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
    if (desk === undefined) return;
    const saved = vault.get<DappCredentials>('credentials');
    // A session with a wallet is resumed; without one, a fresh address is shown.
    start(saved?.walletPublicKey === undefined ? undefined : saved);
    reachChain();
    return () => link.current?.close();
  }, []);

  useEffect(() => {
    if (chain === undefined || desk === undefined) return;
    readMarket(chain, environment.network, desk.paryons ? generalProtocolsOracle : undefined, desk).then(setGlance, (error: unknown) => setGlanceProblem(plainError(error)));
  }, [chain]);

  const forget = () => {
    vault.remove('credentials');
    vault.remove('pending');
    // A page that followed a wallet to another network goes back to the one it starts on.
    if (returnToStartingNetwork(environment)) return;
    start();
  };

  const loans = useMemo((): XoLoans | undefined => {
    const current = link.current;
    if (current === undefined || !usable || status.state !== 'connected' || chain === undefined) return undefined;
    const requests = new DappRequests();
    requests.attach(current.channel);
    return new XoLoans(requests, chain, pendingStore, keyStore, pageAddress(), undefined, desk);
  }, [usable, chain, status.state === 'connected']);

  if (moving !== undefined) return <Loading>Your wallet is on {networkWords(moving).name}. Changing this page to it…</Loading>;

  if (desk === undefined) {
    return (
      <div class="stack">
        <Independent />
        <Card title="No deployment of Paryon's contracts" tone="warn">
          <p>This page works with Paryon's deployments on mainnet and on chipnet, or with a deployment of Paryon's contracts that its configuration names. It is configured for {environment.network} and names none.</p>
        </Card>
      </div>
    );
  }
  if (status.state === 'connected' && usable) {
    if (loans !== undefined && chain !== undefined) return <Loans environment={environment} desk={desk} loans={loans} chain={chain} peerName={status.peerName ?? 'your wallet'} onDisconnect={forget} />;
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
      <Independent desk={desk} />
      <div class="columns">
        <ConnectCard uri={address} state={words} problem={problem} onForget={resuming || problem !== undefined || vault.get<DappCredentials>('credentials')?.walletPublicKey !== undefined ? forget : undefined} />
        <div class="stack">
          <LoanNeeds market={glance} problem={glanceProblem ?? chainProblem} desk={desk} network={environment.network} />
          <HowItWorks />
        </div>
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

// A tab that gave way to a newer one says so and starts nothing.
render(
  tabElsewhere() ? (
    <Frame brand={BRAND} role={ROLE}>
      <TabElsewhere what="this page" />
    </Frame>
  ) : (
    <Root />
  ),
  document.getElementById('app') as HTMLElement,
);
