import { hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import type { RequestStage } from '@grandmas-wallet/connect';
import {
  Amount,
  Button,
  Card,
  Field,
  HandOff,
  More,
  Notice,
  Pill,
  QrCode,
  Segmented,
  Spinner, TemplateOffer,
  Status,
  Steps,
  type Step,
  Value,
  formatBch,
  formatDuration,
  formatSatoshis,
  formatTime,
  parseBch,
  shorten,
} from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import { type JarView, type Readiness, EARLIEST_TIME, SMALLEST_JAR, ahead, amountProblem, dateProblem, fromLocalInput, localInput, readiness } from './jar.js';
import type { Progress } from './source.js';

/*
 * What the page shows, from what it is given. The wording is the page's own: plain, factual sentences.
 */

/** What the page is doing, what it did last, and what went wrong, each under the name of what started it. */
export interface ActionState {
  running?: { name: string; title: string; progress?: Progress };
  error?: { name: string; message: string };
  done?: { name: string; text: string; transactionId?: string };
}

export interface PageFacts {
  network: string;
  /** Address of a block explorer page for a transaction, to which its identifier is appended. Empty for none. */
  explorer: string;
  /** Unix seconds by this device's clock. */
  now: number;
  /** The network's clock, if it could be read. */
  clock?: { height: number; medianTime: number } | undefined;
}

export const openName = 'open';
export const depositName = (jar: JarView): string => `deposit:${jar.category}`;
export const withdrawName = (jar: JarView): string => `withdraw:${jar.category}`;

const prefixOf = (network: string): 'bitcoincash' | 'bchtest' | 'bchreg' => (network === 'mainnet' ? 'bitcoincash' : network === 'regtest' ? 'bchreg' : 'bchtest');

/** The jar's address, for paying in from any wallet. */
export const jarAddress = (jar: JarView, network: string): string => {
  const encoded = lockingBytecodeToCashAddress({ prefix: prefixOf(network), bytecode: hexToBin(jar.lockingBytecode) });
  return typeof encoded === 'string' ? jar.lockingBytecode : encoded.address;
};

const Bch = ({ satoshis }: { satoshis: bigint }) => (
  <>
    {formatBch(satoshis)}
    <span class="unit">BCH</span>
  </>
);

const TransactionLine = ({ transactionId, explorer }: { transactionId: string | undefined; explorer: string }) =>
  transactionId === undefined ? null : explorer === '' ? (
    <span class="small mono"> {shorten(transactionId, 8, 8)}</span>
  ) : (
    <>
      {' '}
      <a href={`${explorer}${transactionId}`} target="_blank" rel="noopener">
        See the transaction
      </a>
    </>
  );

// ------------------------------------------------------------------ before a wallet is connected

export const Intro = () => (
  <div class="page-head intro">
    <h1>Savings Jar</h1>
    <p class="lead">Put money aside until a date you choose. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it.</p>
  </div>
);

export const HowItWorks = () => (
  <Card title="How a jar works">
    <ol class="how">
      <li>
        <strong>You open a jar with a first amount and a date.</strong>
        <span>Your wallet receives the jar's key, a token. The jar's address follows from the key.</span>
      </li>
      <li>
        <strong>Anyone can pay in.</strong>
        <span>From this page, or with any wallet, as an ordinary payment to the jar's address.</span>
      </li>
      <li>
        <strong>From the date on, the key empties the jar.</strong>
        <span>The savings come to your wallet and the key stays there, so the jar can be used again.</span>
      </li>
    </ol>
  </Card>
);

export type LinkWords = 'preparing' | 'connecting' | 'waiting' | 'resuming';

export const ConnectCard = ({ uri, qrUri, state, problem, onForget }: { uri: string | undefined; qrUri: string | undefined; state: LinkWords; problem?: string | undefined; onForget?: (() => void) | undefined }) => (
  <Card title="Connect your wallet" tone={problem === undefined ? undefined : 'warn'}>
    {problem !== undefined && (
      <div class="stack-s">
        <Notice tone="warn">{problem}</Notice>
        <div />
      </div>
    )}
    {state === 'resuming' ? (
      <p>Reaching the wallet that was connected before. Open it if it is closed.</p>
    ) : uri === undefined || qrUri === undefined ? (
      <p class="muted">
        <Spinner /> Preparing a connection address…
      </p>
    ) : (
      <HandOff text={uri} qrLabel="QR code of the connection address" copyLabel="Copy address">
        <p>Scan the code with your wallet, or copy the address into it. The connection is encrypted between this page and your wallet.</p>
      </HandOff>
    )}
    <div class="link-state" role="status">
      {state !== 'waiting' && <Spinner />}
      {state === 'waiting' ? 'Waiting for your wallet.' : state === 'connecting' || state === 'preparing' ? 'Reaching the relay…' : 'Waiting for the wallet connected before.'}
    </div>
    <dl class="kinds">
      <div>
        <dt>A wallet that carries out actions itself</dt>
        <dd>Grandma's Wallet does this. It is sent the jar's template and builds each transaction itself; this page sees no key and builds nothing.</dd>
      </div>
      <div>
        <dt>An ordinary wallet, such as Cashonize</dt>
        <dd>It shares the public keys of its addresses. This page builds each transaction, and the wallet signs it after showing it to you.</dd>
      </div>
    </dl>
    {onForget !== undefined && (
      <div class="actions">
        <Button kind="quiet" onClick={onForget}>
          Connect another wallet
        </Button>
      </div>
    )}
  </Card>
);

// ------------------------------------------------------------------ the wallet that is connected

export const ConnectedCard = ({ peerName, kind, balance, onDisconnect }: { peerName: string; kind: 'xo' | 'plain'; balance?: bigint | undefined; onDisconnect: () => void }) => (
  <Card>
    <div class="connected">
      <Status tone="good" title={`Connected to ${peerName}`}>
        {kind === 'xo' ? (
          <p>Your wallet carries out each action itself from this page's template, and shows you what it does before you approve.</p>
        ) : (
          <p>
            An ordinary wallet. This page builds each transaction and your wallet signs it.
            {balance !== undefined && (
              <>
                {' '}
                Coins this page can use: <Amount satoshis={balance} />.
              </>
            )}
          </p>
        )}
      </Status>
      <Button kind="quiet" small onClick={onDisconnect}>
        Disconnect
      </Button>
    </div>
  </Card>
);

// ------------------------------------------------------------------ what is on its way

const XO_STEPS: { title: string; reached: RequestStage[] }[] = [
  { title: 'Sent to your wallet', reached: ['sent', 'accepted', 'approved', 'recorded', 'on-network'] },
  { title: 'Approved in your wallet', reached: ['approved', 'recorded', 'on-network'] },
  { title: 'On the network', reached: ['on-network'] },
];

export const OnItsWay = ({ title, progress, onStopWaiting }: { title: string; progress: Progress | undefined; onStopWaiting?: (() => void) | undefined }) => {
  const stage = progress?.stage;
  const steps: Step[] | undefined =
    stage === undefined
      ? undefined
      : XO_STEPS.map((step, index): Step => {
          const done = step.reached.includes(stage);
          const current = !done && (index === 0 || XO_STEPS[index - 1]?.reached.includes(stage) === true);
          return { title: step.title, state: done ? 'done' : current ? 'current' : 'later', ...(current && progress !== undefined ? { detail: progress.text } : {}) };
        });
  return (
    <Card cls="on-way" title="On its way" aside={<Spinner />}>
      <p>{title}</p>
      {steps !== undefined ? <Steps steps={steps} /> : progress !== undefined && <Notice tone="wait">{progress.text}</Notice>}
      {onStopWaiting !== undefined && (
        <div class="actions">
          <Button kind="quiet" small onClick={onStopWaiting}>
            Stop waiting
          </Button>
        </div>
      )}
    </Card>
  );
};

/** The failure or the outcome of what was started here. */
const Outcome = ({ state, name, explorer }: { state: ActionState; name: string; explorer: string }) => (
  <>
    {state.error?.name === name && <Notice tone="bad">{state.error.message}</Notice>}
    {state.done?.name === name && state.running === undefined && (
      <Notice tone="good">
        {state.done.text}
        <TransactionLine transactionId={state.done.transactionId} explorer={explorer} />
      </Notice>
    )}
  </>
);

// ------------------------------------------------------------------ the jars

const describeTime = (jar: JarView, ready: Readiness, facts: PageFacts): { when: ComponentChildren; note?: ComponentChildren } => {
  if (jar.unlockTime < EARLIEST_TIME) return { when: `Opens at block ${formatSatoshis(BigInt(jar.unlockTime))}` };
  const date = formatTime(jar.unlockTime);
  if (ready.kind === 'locked') return { when: <>Opens on {date}</>, note: ready.secondsLeft === undefined ? undefined : `In ${formatDuration(ready.secondsLeft)}.` };
  if (ready.kind === 'network') {
    return {
      when: <>Its date was {date}</>,
      note: `The network takes a withdrawal once the median time of recent blocks has passed the date${ready.secondsLeft === undefined ? '' : `, in about ${formatDuration(ready.secondsLeft)}`}.`,
    };
  }
  return { when: jar.status === 'empty' ? <>Opened on {date}</> : <>Open since {date}</>, note: facts.clock === undefined && facts.now - jar.unlockTime < 3_600 ? 'The network may take a few minutes more to accept a withdrawal.' : undefined };
};

const JarPill = ({ jar, ready }: { jar: JarView; ready: Readiness }) => {
  if (jar.status === 'unknown') return <Pill tone="warn">Not known</Pill>;
  if (jar.status === 'empty') return <Pill>Empty</Pill>;
  if (ready.kind === 'locked') return <Pill>Locked</Pill>;
  if (ready.kind === 'network') return <Pill tone="warn">Opening</Pill>;
  return <Pill tone="good">Ready to empty</Pill>;
};

const PayIn = ({ jar, facts, state, onDeposit, onClose }: { jar: JarView; facts: PageFacts; state: ActionState; onDeposit: (satoshis: bigint) => void; onClose: () => void }) => {
  const [amount, setAmount] = useState('');
  const [tried, setTried] = useState(false);
  const parsed = parseBch(amount);
  const problem = typeof parsed === 'string' ? parsed : parsed < 1_000n ? 'Pay in at least 0.00001 BCH (1,000 satoshis).' : undefined;
  const busy = state.running !== undefined;
  const address = jarAddress(jar, facts.network);
  return (
    <div class="panel">
      <Field label="Amount to pay in" id={`pay-${jar.category}`} error={tried ? problem : undefined}>
        <div class="inline-form">
          <div class="input-unit">
            <input
              id={`pay-${jar.category}`}
              type="text"
              inputMode="decimal"
              autocomplete="off"
              placeholder="0.0001"
              value={amount}
              aria-invalid={tried && problem !== undefined}
              onInput={(event) => setAmount((event.currentTarget as HTMLInputElement).value)}
            />
            <span>BCH</span>
          </div>
          <Button
            disabled={busy}
            onClick={() => {
              setTried(true);
              if (problem === undefined && typeof parsed === 'bigint') onDeposit(parsed);
            }}
          >
            Pay in
          </Button>
        </div>
      </Field>
      <More summary="Pay in from any wallet">
        <p class="small muted">An ordinary payment to this address goes into the jar. Anyone can make it.</p>
        <div class="qr-small">
          <QrCode text={address} label="QR code of the jar's address" />
        </div>
        <Value text={address} copyLabel="Copy address" />
      </More>
      <div class="row end">
        <Button kind="link" small onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
};

export const JarItem = ({
  jar,
  facts,
  state,
  onDeposit,
  onWithdraw,
}: {
  jar: JarView;
  facts: PageFacts;
  state: ActionState;
  onDeposit: (jar: JarView, satoshis: bigint) => void;
  onWithdraw: (jar: JarView) => void;
}) => {
  const [paying, setPaying] = useState(false);
  const ready = readiness(jar.unlockTime, facts.now, facts.clock);
  const { when, note } = describeTime(jar, ready, facts);
  const busy = state.running !== undefined;
  const canEmpty = jar.status === 'open' && ready.kind === 'ready';
  return (
    <li class="jar" data-testid="jar">
      <div class="jar-top">
        <div class={`jar-amount${jar.satoshis === 0n ? ' nothing' : ''}`}>
          <Bch satoshis={jar.satoshis} />
        </div>
        <JarPill jar={jar} ready={ready} />
      </div>
      <div class="jar-when">{when}</div>
      {jar.status === 'empty' ? (
        <div class="jar-note">Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too.</div>
      ) : jar.status === 'unknown' ? (
        <div class="jar-note">Your wallet holds the key but could not work out where the jar stands.</div>
      ) : (
        note !== undefined && <div class="jar-note">{note}</div>
      )}
      <div class="jar-actions">
        {jar.status !== 'empty' && ready.kind !== 'locked' && (
          <Button {...(canEmpty ? {} : { kind: 'secondary' as const })} small disabled={busy || !canEmpty} onClick={() => onWithdraw(jar)}>
            {state.running?.name === withdrawName(jar) && <Spinner />}
            Empty the jar
          </Button>
        )}
        <Button kind={jar.status === 'empty' || !canEmpty ? 'secondary' : 'quiet'} small disabled={busy && state.running?.name !== depositName(jar)} onClick={() => setPaying(!paying)}>
          {state.running?.name === depositName(jar) && <Spinner />}
          Pay in
        </Button>
      </div>
      {paying && <PayIn jar={jar} facts={facts} state={state} onDeposit={(satoshis) => onDeposit(jar, satoshis)} onClose={() => setPaying(false)} />}
      <Outcome state={state} name={withdrawName(jar)} explorer={facts.explorer} />
      <Outcome state={state} name={depositName(jar)} explorer={facts.explorer} />
    </li>
  );
};

export const JarList = ({
  jars,
  trusted,
  onOffer,
  onTrusted,
  problem,
  facts,
  state,
  onDeposit,
  onWithdraw,
}: {
  jars: JarView[] | undefined;
  trusted: boolean;
  /** Offer the wallet this page's template, and what to do once it trusts it. */
  onOffer?: (() => Promise<boolean>) | undefined;
  onTrusted?: (() => void) | undefined;
  /** Why the list could not be brought up to date. What was listed before stays. */
  problem?: string | undefined;
  facts: PageFacts;
  state: ActionState;
  onDeposit: (jar: JarView, satoshis: bigint) => void;
  onWithdraw: (jar: JarView) => void;
}) => {
  const total = (jars ?? []).reduce((sum, jar) => sum + jar.satoshis, 0n);
  return (
    <Card title="Your jars" aside={jars !== undefined && jars.length > 1 ? <span class="muted small">{formatBch(total)} BCH in all</span> : undefined}>
      {jars === undefined ? (
        <p class="muted">
          <Spinner /> Looking for your jars…
        </p>
      ) : jars.length === 0 ? (
        trusted ? (
          <p class="muted">No jars yet. A jar you open here is listed here, and in any other browser your wallet connects to.</p>
        ) : (
          <div class="stack-s">
            <p class="muted">No jars to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds.</p>
            {onOffer !== undefined && <TemplateOffer label="Show the jars my wallet holds" offer={onOffer} onTrusted={onTrusted ?? (() => undefined)} />}
          </div>
        )
      ) : (
        <ul class="jars">
          {jars.map((jar) => (
            <JarItem key={jar.category} jar={jar} facts={facts} state={state} onDeposit={onDeposit} onWithdraw={onWithdraw} />
          ))}
        </ul>
      )}
      {problem !== undefined && <Notice tone="warn">The list could not be brought up to date: {problem}</Notice>}
    </Card>
  );
};

// ------------------------------------------------------------------ opening a jar

type Preset = '10m' | '1d' | '30d' | '1y';
const PRESETS: { value: Preset; label: string; seconds: number }[] = [
  { value: '10m', label: '10 minutes', seconds: 600 },
  { value: '1d', label: '1 day', seconds: 86_400 },
  { value: '30d', label: '30 days', seconds: 30 * 86_400 },
  { value: '1y', label: '1 year', seconds: 365 * 86_400 },
];

const timeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'your time zone';
  }
};

export const OpenJarForm = ({ kind, facts, state, onOpen }: { kind: 'xo' | 'plain'; facts: PageFacts; state: ActionState; onOpen: (satoshis: bigint, unlockTime: number) => void }) => {
  const [amount, setAmount] = useState('0.0001');
  const [preset, setPreset] = useState<Preset | 'custom'>('1d');
  const [date, setDate] = useState(() => localInput(ahead(facts.now, 86_400)));
  const [tried, setTried] = useState(false);
  const parsed = parseBch(amount);
  const amountError = typeof parsed === 'string' ? parsed : amountProblem(parsed, SMALLEST_JAR);
  const unlockTime = fromLocalInput(date);
  const dateError = dateProblem(unlockTime, facts.now);
  const busy = state.running !== undefined;
  const choose = (next: Preset | 'custom') => {
    setPreset(next);
    const seconds = PRESETS.find((option) => option.value === next)?.seconds;
    if (seconds !== undefined) setDate(localInput(ahead(Math.floor(Date.now() / 1000), seconds)));
  };
  return (
    <Card title="Open a jar">
      <Field label="First amount" id="jar-amount" error={tried ? amountError : undefined} hint={`At least ${formatBch(SMALLEST_JAR)} BCH (${formatSatoshis(SMALLEST_JAR)} satoshis). More can be paid in at any time.`}>
        <div class="input-unit">
          <input
            id="jar-amount"
            type="text"
            inputMode="decimal"
            autocomplete="off"
            value={amount}
            aria-invalid={tried && amountError !== undefined}
            onInput={(event) => setAmount((event.currentTarget as HTMLInputElement).value)}
          />
          <span>BCH</span>
        </div>
      </Field>
      <div class="field">
        <label for="jar-date">Opens on</label>
        <Segmented label="Opens in" value={preset} onChange={choose} options={PRESETS.map(({ value, label }) => ({ value, label }))} />
        <input
          id="jar-date"
          type="datetime-local"
          value={date}
          min={localInput(facts.now)}
          aria-invalid={tried && dateError !== undefined}
          onInput={(event) => {
            setDate((event.currentTarget as HTMLInputElement).value);
            setPreset('custom');
          }}
        />
        {tried && dateError !== undefined ? (
          <div class="field-error">{dateError}</div>
        ) : (
          <div class="hint">In your time zone, {timeZone()}. The network accepts a withdrawal a few minutes after this time, once the median time of its recent blocks has passed it.</div>
        )}
      </div>
      {amountError === undefined && dateError === undefined && typeof parsed === 'bigint' && unlockTime !== undefined && (
        <div class="summary">
          <strong>{formatBch(parsed)} BCH</strong> stays in the jar until <strong>{formatTime(unlockTime)}</strong>, {formatDuration(unlockTime - facts.now)} from now.
        </div>
      )}
      <Button
        block
        disabled={busy}
        onClick={() => {
          // Problems are shown once opening was tried and refused here; a request that went ahead leaves none
          // behind, or the date it used would be marked as past once it is.
          const ready = amountError === undefined && dateError === undefined && typeof parsed === 'bigint' && unlockTime !== undefined;
          setTried(!ready);
          if (ready) onOpen(parsed, unlockTime);
        }}
      >
        {state.running?.name === openName && <Spinner />}
        Open the jar
      </Button>
      <div class="stack-s">
        <div />
        <Outcome state={state} name={openName} explorer={facts.explorer} />
      </div>
      <p class="small muted form-foot">
        {kind === 'xo'
          ? 'Your wallet shows what this does, in the words of the jar\'s template and in its own figures, and asks you to approve.'
          : 'Your wallet shows the transaction and asks you to approve. If it has no coin a key can be made from, it is first asked to move some coins to one of its own addresses.'}{' '}
        The key carries {formatSatoshis(1_000n)} satoshis of its own, which stay with it in your wallet.
      </p>
    </Card>
  );
};
