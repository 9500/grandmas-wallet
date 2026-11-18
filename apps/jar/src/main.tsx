import '@grandmas-wallet/ui/styles.css';
import './jar.css';

import { DappRequests } from '@grandmas-wallet/connect';
import { type DappCredentials, type DappLink, type LinkStatus, openDappLink } from '@grandmas-wallet/connect/wizard';
import { type ChainConnection, type Environment, Card, Frame, Loading, Vault, connectChain, formatBch, formatTime, loadEnvironment, plainError, useEvery } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type JarView, networkTime } from './jar.js';
import type { PlainChain } from './plain.js';
import { type JarSource, type Kind, type Listing, type Progress, kindOf, plainSource, stageProgress, xoSource } from './source.js';
import { type ActionState, type LinkWords, ConnectCard, ConnectedCard, HowItWorks, Intro, JarList, OnItsWay, OpenJarForm, depositName, openName, withdrawName } from './view.js';
import { type PendingRequest, type PendingStore } from './xo.js';

/**
 * The Savings Jar page. One connection address for every wallet; what the wallet offers when it connects
 * decides how the page works with it.
 */

const BRAND = 'Savings Jar';
const ROLE = 'An application for Bitcoin Cash wallets';
const vault = new Vault('jar');

/** Requests to a wallet that speaks `xo_v1`, kept until they have an outcome. */
const pendingStore: PendingStore = {
  get: () => vault.get<PendingRequest[]>('pending') ?? [],
  set: (requests) => (requests.length === 0 ? vault.remove('pending') : vault.set('pending', requests)),
};

const chainOf = (connection: ChainConnection): PlainChain => ({
  getTransaction: (transactionId) => connection.chain.getTransaction(transactionId),
  getHistory: (lockingBytecode) => connection.chain.getHistory(lockingBytecode),
  listUnspent: (lockingBytecode) => connection.chain.listUnspent(lockingBytecode),
  broadcast: (transactionHex) => connection.broadcast(transactionHex),
});

const now = (): number => Math.floor(Date.now() / 1000);

const RESUMED_TITLE: Record<PendingRequest['action'], string> = {
  open: 'Opening a jar, asked of your wallet before this page was loaded again.',
  deposit: 'A payment into a jar, asked of your wallet before this page was loaded again.',
  withdraw: 'Emptying a jar, asked of your wallet before this page was loaded again.',
};

/** The page once a wallet is connected: its jars, and what can be done with them. */
const Jars = ({ environment, source, peerName, chain, onDisconnect }: { environment: Environment; source: JarSource; peerName: string; chain: ChainConnection | undefined; onDisconnect: () => void }) => {
  const [listing, setListing] = useState<Listing | undefined>();
  const [listProblem, setListProblem] = useState<string | undefined>();
  const [state, setState] = useState<ActionState>({});
  const [clock, setClock] = useState<{ height: number; medianTime: number } | undefined>();
  const [time, setTime] = useState(now);
  const running = useRef(false);

  const refresh = async (): Promise<void> => {
    try {
      setListing(await source.list());
      setListProblem(undefined);
    } catch (error) {
      setListProblem(plainError(error));
    }
  };

  /** Run one action at a time, with its progress on the page and its outcome where it was started. */
  const act = async (name: string, title: string, work: (progress: (step: Progress) => void) => Promise<{ transactionId?: string }>, doneText: string, after?: () => void): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setState({ running: { name, title } });
    let ended: ActionState;
    try {
      const outcome = await work((progress) => setState({ running: { name, title, progress } }));
      ended = { done: { name, text: doneText, ...(outcome.transactionId === undefined ? {} : { transactionId: outcome.transactionId }) } };
      after?.();
    } catch (error) {
      ended = { error: { name, message: plainError(error) } };
    }
    // The jars are read again before the outcome is shown, so that the list beside it already agrees with it:
    // otherwise a jar just emptied is shown for a moment with its old amount and its button.
    await refresh();
    running.current = false;
    setState(ended);
    // A server may list a transaction a moment after it took it.
    setTimeout(() => void refresh(), 4_000);
  };

  useEffect(() => {
    void refresh();
    // Requests sent before the page was loaded again are sent once more, under the same identifiers.
    if ('jars' in source) {
      const xo = (source as ReturnType<typeof xoSource>).jars;
      void (async () => {
        for (const kept of xo.pending()) {
          await act(
            `resume:${kept.id}`,
            RESUMED_TITLE[kept.action],
            (progress) => xo.resume(kept, (stage) => progress(stageProgress(stage))),
            kept.action === 'open' ? 'The jar is open. Its key is in your wallet.' : kept.action === 'deposit' ? 'Paid in.' : 'The jar is emptied. The savings and the key are in your wallet.',
          );
        }
      })();
    }
    return () => source.close?.();
  }, [source]);
  useEvery(30_000, async () => {
    if (!running.current) await refresh();
  }, [source]);
  useEvery(15_000, () => setTime(now()));
  useEvery(30_000, async () => {
    if (chain !== undefined) setClock(await networkTime(chain.chain));
  }, [chain]);

  const facts = { network: environment.network, explorer: environment.explorer, now: time, clock };
  const dated = (jar: JarView) => formatTime(jar.unlockTime);
  const stopWaiting =
    state.running?.name.startsWith('resume:') === true
      ? () => {
          (source as ReturnType<typeof xoSource>).jars.abandon(state.running?.name.slice('resume:'.length) ?? '');
          window.location.reload();
        }
      : undefined;
  return (
    <div class="stack">
      <ConnectedCard peerName={peerName} kind={source.kind} balance={listing?.balance} onDisconnect={onDisconnect} />
      <div class="columns">
        <div class="stack">
          {state.running !== undefined && <OnItsWay title={state.running.title} progress={state.running.progress} onStopWaiting={stopWaiting} />}
          {state.error !== undefined && state.error.name.startsWith('resume:') && (
            <Card title="A request from before" tone="warn">
              <p>{state.error.message}</p>
            </Card>
          )}
          <JarList
            jars={listing?.jars}
            trusted={listing?.trusted ?? true}
            onOffer={source.offerTemplate}
            onTrusted={() => void refresh()}
            problem={listProblem}
            facts={facts}
            state={state}
            onDeposit={(jar, satoshis) =>
              void act(depositName(jar), `Paying ${formatBch(satoshis)} BCH into the jar that opens on ${dated(jar)}.`, (progress) => source.deposit(jar, satoshis, progress), 'Paid in. Anyone can pay in again, at any time.')
            }
            onWithdraw={(jar) =>
              void act(withdrawName(jar), `Emptying the jar of ${formatBch(jar.satoshis)} BCH.`, (progress) => source.withdraw(jar, progress), 'The jar is emptied. The savings and the key are in your wallet.')
            }
          />
        </div>
        <OpenJarForm
          kind={source.kind}
          facts={facts}
          state={state}
          onOpen={(satoshis, unlockTime) =>
            void act(openName, `Opening a jar of ${formatBch(satoshis)} BCH until ${formatTime(unlockTime)}.`, (progress) => source.open(satoshis, unlockTime, progress), 'The jar is open. Its key is in your wallet.')
          }
        />
      </div>
    </div>
  );
};

const App = ({ environment }: { environment: Environment }) => {
  const link = useRef<DappLink | undefined>(undefined);
  const [status, setStatus] = useState<LinkStatus>({ state: 'connecting' });
  const [kind, setKind] = useState<Kind | undefined>();
  const [address, setAddress] = useState<{ uri: string; qrUri: string } | undefined>();
  const [resuming, setResuming] = useState(false);
  const [chain, setChain] = useState<ChainConnection | undefined>();
  const [chainProblem, setChainProblem] = useState<string | undefined>();
  const [ended, setEnded] = useState<string | undefined>();

  const start = (credentials?: DappCredentials) => {
    link.current?.close();
    setKind(undefined);
    setAddress(undefined);
    setEnded(undefined);
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
          setKind(kindOf(offered, environment.network));
          setResuming(false);
          setEnded(undefined);
        }
        if (next.state === 'disconnected' && next.reason !== undefined) {
          setKind(undefined);
          setEnded(next.reason);
        }
      },
    });
    link.current = opened;
    setAddress({ uri: opened.uri, qrUri: opened.qrUri });
  };

  useEffect(() => {
    const saved = vault.get<DappCredentials>('credentials');
    // A session with a wallet is resumed; without one, a fresh address is shown.
    start(saved?.walletPublicKey === undefined ? undefined : saved);
    connectChain(environment.chain, environment.secondsPerBlock).then(setChain, (error: unknown) => setChainProblem(plainError(error)));
    return () => link.current?.close();
  }, []);

  const forget = () => {
    vault.remove('credentials');
    vault.remove('pending');
    start();
  };

  const source = useMemo((): JarSource | undefined => {
    const current = link.current;
    if (current === undefined || kind === undefined || status.state !== 'connected') return undefined;
    if (kind.kind === 'xo') {
      const requests = new DappRequests();
      requests.attach(current.channel);
      return xoSource(requests, pendingStore);
    }
    if (kind.kind === 'plain' && chain !== undefined) return plainSource(chainOf(chain), kind.paths, (request) => current.sign(request));
    return undefined;
  }, [kind, chain, status.state === 'connected']);

  if (status.state === 'connected' && kind !== undefined && kind.kind !== 'unusable') {
    if (source !== undefined) return <Jars environment={environment} source={source} peerName={status.peerName ?? 'your wallet'} chain={chain} onDisconnect={forget} />;
    if (chainProblem !== undefined) {
      return (
        <Card title="The network cannot be reached" tone="bad">
          <p>{chainProblem}</p>
          <p class="muted">With an ordinary wallet this page reads the chain itself, to find your coins and your jars.</p>
        </Card>
      );
    }
    return <Loading>Connecting to the network…</Loading>;
  }

  const words: LinkWords = resuming ? 'resuming' : status.state === 'waiting' ? 'waiting' : address === undefined ? 'preparing' : 'connecting';
  const problem = kind?.kind === 'unusable' ? kind.reason : ended;
  return (
    <div class="stack">
      <Intro />
      <div class="columns">
        <ConnectCard uri={address?.uri} qrUri={address?.qrUri} state={words} problem={problem} onForget={resuming || problem !== undefined ? forget : undefined} />
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
