import type { RequestStage } from '@grandmas-wallet/connect';
import { collateralRatio } from '@grandmas-wallet/paryon';
import { Amount, Button, Card, Field, HandOff, KeyValues, More, Notice, Pill, Segmented, Spinner, Status, Steps, type Step, formatBch, formatSatoshis, formatTime, parseBch, shorten } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import {
  type BorrowPlan,
  type LoanView,
  type Market,
  type PeriodNeed,
  DEFAULT_PERCENT,
  DEPLOYMENT,
  SAFE_PERCENT,
  borrowPlan,
  collateralProblem,
  formatPrice,
  formatPusd,
  parsePercent,
  parsePusd,
  partRepayment,
  periodNeed,
  ratioOf,
  repaymentProblem,
} from './loan.js';
import type { MadeKey } from './market.js';

/*
 * What the page shows, from what it is given. The wording is the page's own: plain, factual sentences.
 */

/** How far an action has come, for the person waiting. */
export interface Progress {
  text: string;
  stage?: RequestStage;
}

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
}

export const keyName = 'key';
export const moveName = 'move';
export const borrowName = 'borrow';
export const manageName = (loan: Pick<LoanView, 'category'>): string => `manage:${loan.category}`;
export const repayName = (loan: Pick<LoanView, 'category'>): string => `repay:${loan.category}`;
export const closeName = (loan: Pick<LoanView, 'category'>): string => `close:${loan.category}`;

const Pusd = ({ cents }: { cents: bigint }) => (
  <>
    {formatPusd(cents)}
    <span class="unit">PUSD</span>
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

// ------------------------------------------------------------------ what this page is

export const Intro = () => (
  <div class="page-head intro">
    <h1>Borrow PUSD against BCH</h1>
    <p class="lead">Open a loan of PUSD, a dollar token, with BCH as collateral; add or take out collateral; repay, and get the collateral back. Your wallet holds the loan's key, so the loan moves with the wallet, also through a recovery.</p>
  </div>
);

/** Said on every screen: whose page this is and whose contracts it uses. */
export const Independent = () => (
  <div class="independent" role="note">
    <strong>An independent demonstration on chipnet, Bitcoin Cash's test network.</strong> This page is not Paryon's site and is not made or endorsed by Paryon. It uses Paryon's public contracts unchanged, through their test deployment <span class="mono">{DEPLOYMENT.name}</span>. Only test coins, which have no value, are used.
  </div>
);

export const HowItWorks = () => (
  <Card title="How a loan works here">
    <ol class="how">
      <li>
        <strong>Your wallet makes a loan key.</strong>
        <span>A token whose holder manages the loan. Paryon's contracts make it; it waits there until the loan is opened.</span>
      </li>
      <li>
        <strong>You borrow.</strong>
        <span>The collateral goes into a loan contract; the key and the PUSD come to your wallet. Paryon takes a fee of 0.25%.</span>
      </li>
      <li>
        <strong>You manage the loan with the key.</strong>
        <span>Add collateral or take some out, repay part, or repay all of it and get the collateral back. Your wallet can also close the loan by itself, from its list of tokens, without this page.</span>
      </li>
    </ol>
  </Card>
);

export type LinkWords = 'preparing' | 'connecting' | 'waiting' | 'resuming';

export const ConnectCard = ({ uri, state, problem, onForget }: { uri: string | undefined; state: LinkWords; problem?: string | undefined; onForget?: (() => void) | undefined }) => (
  <Card title="Connect your wallet" tone={problem === undefined ? undefined : 'warn'}>
    {problem !== undefined && (
      <div class="stack-s">
        <Notice tone="warn">{problem}</Notice>
        <div />
      </div>
    )}
    {state === 'resuming' ? (
      <p>Reaching the wallet that was connected before. Open it if it is closed.</p>
    ) : uri === undefined ? (
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
    <p class="small muted form-foot">This page works with a wallet that carries out the actions of a template itself, such as Grandma's Wallet. It is sent the loan's template, builds each transaction itself and shows you what it does before you approve; this page sees no key and builds nothing.</p>
    {onForget !== undefined && (
      <div class="actions">
        <Button kind="quiet" onClick={onForget}>
          Connect another wallet
        </Button>
      </div>
    )}
  </Card>
);

export const ConnectedCard = ({ peerName, onDisconnect }: { peerName: string; onDisconnect: () => void }) => (
  <Card>
    <div class="connected">
      <Status tone="good" title={`Connected to ${peerName}`}>
        <p>Your wallet carries out each action itself from this page's template, and shows you what it does before you approve.</p>
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

// ------------------------------------------------------------------ prices

export const PricesCard = ({ market, problem }: { market: (Market & { oracleProblem?: string }) | undefined; problem?: string | undefined }) => (
  <Card title="Prices">
    {market === undefined ? (
      problem === undefined ? (
        <p class="muted">
          <Spinner /> Reading Paryon's contracts and the oracle…
        </p>
      ) : (
        <Notice tone="bad">{problem}</Notice>
      )
    ) : (
      <>
        <KeyValues
          entries={[
            [<>Stored in Paryon's price contracts<small>What the contracts check a loan against</small></>, market.priceThread.state.price === market.stored ? formatPrice(market.stored) : `${formatPrice(market.stored)} to ${formatPrice(market.priceThread.state.price)}`],
            [
              <>
                The oracle's latest
                <small>{market.oracle === undefined ? 'Could not be read' : `Signed ${formatTime(market.oracle.time)}`}</small>
              </>,
              market.oracle === undefined ? '—' : formatPrice(market.oracle.price),
            ],
            [<strong>This page reckons with</strong>, <strong>{formatPrice(market.lower)}</strong>],
          ]}
        />
        <p class="small muted">
          A stored price can be out of date, and anyone can replace it with the oracle's at any moment. This page therefore makes a loan safe for the lower of the two{market.oracle !== undefined && market.oracle.price < market.stored ? ', which is now the oracle\'s' : ''}.
        </p>
        {market.oracleProblem !== undefined && <Notice tone="warn">{market.oracleProblem} The stored price is used alone until it can.</Notice>}
        {problem !== undefined && <Notice tone="warn">The prices could not be brought up to date: {problem}</Notice>}
      </>
    )}
  </Card>
);

// ------------------------------------------------------------------ loans

const percent = (value: number | undefined): string => (value === undefined ? '—' : `${value.toFixed(2)}%`);

const LoanPill = ({ loan }: { loan: LoanView }) => (loan.status === 'open' ? <Pill tone="good">Open</Pill> : loan.status === 'closed' ? <Pill>Closed</Pill> : <Pill tone="warn">Not known</Pill>);

const CollateralPanel = ({ loan, market, busy, onManage, onClose }: { loan: LoanView; market: Market; busy: boolean; onManage: (collateral: bigint) => void; onClose: () => void }) => {
  const [direction, setDirection] = useState<'add' | 'take'>('add');
  const [amount, setAmount] = useState('');
  const [tried, setTried] = useState(false);
  const now = loan.found?.loan.output.valueSatoshis ?? 0n;
  const parsed = parseBch(amount);
  const target = typeof parsed === 'bigint' ? (direction === 'add' ? now + parsed : now - parsed) : undefined;
  const problem = typeof parsed === 'string' ? parsed : target === undefined || target <= 0n ? 'That is more than the loan holds.' : collateralProblem(loan, target, market);
  const ratio = target === undefined || target <= 0n || loan.debt === undefined || loan.debt === 0n ? undefined : collateralRatio(target, loan.debt, market.lower);
  return (
    <div class="panel">
      <Segmented
        label="Add or take out"
        value={direction}
        onChange={(next) => {
          setDirection(next);
          setTried(false);
        }}
        options={[
          { value: 'add', label: 'Add collateral' },
          { value: 'take', label: 'Take some out' },
        ]}
      />
      <Field label={direction === 'add' ? 'Amount to add' : 'Amount to take out'} id={`collateral-${loan.category}`} error={tried ? problem : undefined}>
        <div class="inline-form">
          <div class="input-unit">
            <input
              id={`collateral-${loan.category}`}
              type="text"
              inputMode="decimal"
              autocomplete="off"
              placeholder="0.001"
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
              if (problem === undefined && target !== undefined) onManage(target);
            }}
          >
            {direction === 'add' ? 'Add' : 'Take out'}
          </Button>
        </div>
      </Field>
      {target !== undefined && problem === undefined && (
        <p class="small">
          The loan then holds <Amount satoshis={target} />, {percent(ratio)} of the debt at {formatPrice(market.lower)}.
        </p>
      )}
      <div class="row end">
        <Button kind="link" small onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
};

const RepayPanel = ({ loan, busy, onRepay, onClose }: { loan: LoanView; busy: boolean; onRepay: (repay: bigint) => void; onClose: () => void }) => {
  const range = partRepayment(loan);
  const [amount, setAmount] = useState(range === undefined ? '' : formatPusd(range.smallest).replace(/,/g, ''));
  const [tried, setTried] = useState(false);
  const parsed = parsePusd(amount);
  const problem = typeof parsed === 'string' ? parsed : repaymentProblem(loan, parsed);
  return (
    <div class="panel">
      <Field label="Amount to repay" id={`repay-${loan.category}`} error={tried ? problem : undefined} hint={range === undefined ? undefined : `Between ${formatPusd(range.smallest)} and ${formatPusd(range.largest)} PUSD. The collateral stays in the loan.`}>
        <div class="inline-form">
          <div class="input-unit">
            <input id={`repay-${loan.category}`} type="text" inputMode="decimal" autocomplete="off" value={amount} aria-invalid={tried && problem !== undefined} onInput={(event) => setAmount((event.currentTarget as HTMLInputElement).value)} />
            <span>PUSD</span>
          </div>
          <Button
            disabled={busy}
            onClick={() => {
              setTried(true);
              if (problem === undefined && typeof parsed === 'bigint') onRepay(parsed);
            }}
          >
            Repay
          </Button>
        </div>
      </Field>
      <div class="row end">
        <Button kind="link" small onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
};

export const LoanItem = ({
  loan,
  market,
  facts,
  state,
  onManage,
  onRepay,
  onClose,
}: {
  loan: LoanView;
  market: Market | undefined;
  facts: PageFacts;
  state: ActionState;
  onManage: (loan: LoanView, collateral: bigint) => void;
  onRepay: (loan: LoanView, repay: bigint) => void;
  onClose: (loan: LoanView) => void;
}) => {
  const [panel, setPanel] = useState<'collateral' | 'repay' | 'close' | undefined>();
  const busy = state.running !== undefined;
  const open = loan.status === 'open' && loan.debt !== undefined && loan.found !== undefined;
  const range = partRepayment(loan);
  const lowerRatio = market === undefined ? undefined : ratioOf(loan, market.lower);
  return (
    <li class="loan" data-testid="loan">
      <div class="loan-top">
        <div class={`loan-amount${open ? '' : ' nothing'}`}>{open ? <Pusd cents={loan.debt ?? 0n} /> : 'Nothing owed'}</div>
        <LoanPill loan={loan} />
      </div>
      {open ? (
        <>
          <KeyValues
            entries={[
              [<>Collateral</>, <Amount satoshis={loan.found?.loan.output.valueSatoshis ?? 0n} exact />],
              [<>Worth, at {market === undefined ? 'the lower price' : formatPrice(market.lower)}<small>The lower of the stored price and the oracle's</small></>, <span class={`ratio${lowerRatio !== undefined && lowerRatio < SAFE_PERCENT ? ' low' : ''}`}>{percent(lowerRatio)} of the debt</span>],
              ...(market === undefined || market.lower === market.priceThread.state.price ? [] : [[<>Worth, at the stored {formatPrice(market.priceThread.state.price)}</>, `${percent(ratioOf(loan, market.priceThread.state.price))} of the debt`] as [ComponentChildren, ComponentChildren]]),
              [<>Interest</>, loan.interestRate === 0 || loan.interestRate === undefined ? 'None' : `${(loan.interestRate / 100_000).toFixed(3)}% a period`],
            ]}
          />
          {lowerRatio !== undefined && lowerRatio < SAFE_PERCENT && <Notice tone="warn">The collateral is worth less than {SAFE_PERCENT}% of the debt at the lower price. Add collateral, or repay, before the price falls further: at 110% the contracts let anyone liquidate the loan.</Notice>}
          <div class="loan-key small muted">
            Loan key <span class="mono">{shorten(loan.category, 8, 6)}</span>, in your wallet
          </div>
          <div class="loan-actions">
            <Button kind="secondary" small disabled={busy || market === undefined} onClick={() => setPanel(panel === 'collateral' ? undefined : 'collateral')}>
              {state.running?.name === manageName(loan) && <Spinner />}
              Change the collateral
            </Button>
            {range !== undefined && (
              <Button kind="secondary" small disabled={busy} onClick={() => setPanel(panel === 'repay' ? undefined : 'repay')}>
                {state.running?.name === repayName(loan) && <Spinner />}
                Repay part
              </Button>
            )}
            <Button kind="secondary" small disabled={busy} onClick={() => setPanel(panel === 'close' ? undefined : 'close')}>
              {state.running?.name === closeName(loan) && <Spinner />}
              Repay and close
            </Button>
          </div>
          {range === undefined && <p class="small muted loan-note">Paryon takes a part repayment of at least 100.00 PUSD that leaves at least 100.00 owing; this loan can only be repaid in full.</p>}
          {panel === 'collateral' && market !== undefined && (
            <CollateralPanel
              loan={loan}
              market={market}
              busy={busy}
              onManage={(collateral) => {
                setPanel(undefined);
                onManage(loan, collateral);
              }}
              onClose={() => setPanel(undefined)}
            />
          )}
          {panel === 'repay' && (
            <RepayPanel
              loan={loan}
              busy={busy}
              onRepay={(repay) => {
                setPanel(undefined);
                onRepay(loan, repay);
              }}
              onClose={() => setPanel(undefined)}
            />
          )}
          {panel === 'close' && (
            <div class="panel">
              <p>
                Your wallet pays the whole debt, <strong>{formatPusd(loan.debt ?? 0n)} PUSD</strong>, which is destroyed, and gets the collateral of <strong>{formatBch(loan.found?.loan.output.valueSatoshis ?? 0n)} BCH</strong> back. The key stays in your wallet.
              </p>
              <div class="row">
                <Button
                  disabled={busy}
                  onClick={() => {
                    setPanel(undefined);
                    onClose(loan);
                  }}
                >
                  Repay and close the loan
                </Button>
                <Button kind="quiet" onClick={() => setPanel(undefined)}>
                  Not now
                </Button>
              </div>
            </div>
          )}
        </>
      ) : loan.status === 'closed' ? (
        <p class="loan-note">Closed and repaid. The key stays in your wallet; it opens nothing now.</p>
      ) : (
        <p class="loan-note">Your wallet holds the key, but where its loan stands could not be read just now.</p>
      )}
      <Outcome state={state} name={manageName(loan)} explorer={facts.explorer} />
      <Outcome state={state} name={repayName(loan)} explorer={facts.explorer} />
      <Outcome state={state} name={closeName(loan)} explorer={facts.explorer} />
    </li>
  );
};

export const LoanList = (props: {
  loans: LoanView[] | undefined;
  trusted: boolean;
  problem?: string | undefined;
  market: Market | undefined;
  facts: PageFacts;
  state: ActionState;
  onManage: (loan: LoanView, collateral: bigint) => void;
  onRepay: (loan: LoanView, repay: bigint) => void;
  onClose: (loan: LoanView) => void;
}) => (
  <Card title="Your loans">
    {props.loans === undefined ? (
      <p class="muted">
        <Spinner /> Asking your wallet about its loan keys…
      </p>
    ) : props.loans.length === 0 ? (
      <p class="muted">{props.trusted ? 'No loans yet. A loan you open here is listed here, and in any other browser your wallet connects to.' : 'No loans to show. Your wallet tells this page about its loan keys once you use this page with it, or once you allow it in the wallet.'}</p>
    ) : (
      <ul class="loans">
        {props.loans.map((loan) => (
          <LoanItem key={loan.category} loan={loan} market={props.market} facts={props.facts} state={props.state} onManage={props.onManage} onRepay={props.onRepay} onClose={props.onClose} />
        ))}
      </ul>
    )}
    {props.problem !== undefined && <Notice tone="warn">The list could not be brought up to date: {props.problem}</Notice>}
  </Card>
);

// ------------------------------------------------------------------ a new loan

const StepHead = ({ number, title, done }: { number: number; title: string; done: boolean }) => (
  <div class={`new-step-head${done ? ' done' : ''}`}>
    <span class="new-step-number" aria-hidden="true">
      {done ? '✓' : number}
    </span>
    <strong>{title}</strong>
  </div>
);

export const NewLoanCard = ({
  market,
  keys,
  facts,
  state,
  onMakeKey,
  onMove,
  onBorrow,
}: {
  market: Market | undefined;
  keys: MadeKey[] | undefined;
  facts: PageFacts;
  state: ActionState;
  onMakeKey: () => void;
  onMove: (need: Extract<PeriodNeed, { needed: true }>) => void;
  onBorrow: (key: MadeKey, plan: BorrowPlan, need: Extract<PeriodNeed, { needed: false }>) => void;
}) => {
  const [amount, setAmount] = useState('100');
  const [ratio, setRatio] = useState(String(DEFAULT_PERCENT));
  const [tried, setTried] = useState(false);
  const busy = state.running !== undefined;
  const debt = parsePusd(amount);
  const chosen = parsePercent(ratio);
  const need = market === undefined || typeof debt === 'string' ? undefined : periodNeed(market, debt);
  const plan = market === undefined || typeof debt === 'string' || typeof chosen === 'string' ? undefined : borrowPlan(debt, chosen, market);
  const [key] = keys ?? [];
  const upToDate = need !== undefined && need.needed === false;
  return (
    <Card title="Open a loan">
      <div class="new-steps">
        <section class="new-step">
          <StepHead number={1} title="A loan key" done={key !== undefined} />
          {keys === undefined ? (
            <p class="muted small">
              <Spinner /> Looking for a key made from this page…
            </p>
          ) : key !== undefined ? (
            <p class="small">
              Your wallet has a new key, <span class="mono">{shorten(key.category, 8, 6)}</span>, waiting in Paryon's contracts for a loan.
            </p>
          ) : (
            <>
              <p class="small muted">Your wallet makes it. About 2,800 satoshis: 2,000 go with the key into Paryon's contracts, 1,000 of which come back with the key when you borrow, and the rest is the network's fee.</p>
              <Button small disabled={busy} onClick={onMakeKey}>
                {state.running?.name === keyName && <Spinner />}
                Make a loan key
              </Button>
            </>
          )}
          <Outcome state={state} name={keyName} explorer={facts.explorer} />
        </section>

        <section class="new-step">
          <StepHead number={2} title="Paryon's contracts up to date" done={upToDate} />
          {need === undefined ? (
            <p class="muted small">{market === undefined ? <><Spinner /> Reading Paryon's contracts…</> : 'Enter an amount to borrow.'}</p>
          ) : need.needed === 'impossible' ? (
            <Notice tone="warn">{need.reason}</Notice>
          ) : need.needed === false ? (
            <p class="small">Up to date. A loan opened now starts in period {formatSatoshis(BigInt(need.thread.period))}, the current one.</p>
          ) : (
            <>
              <p class="small">
                Paryon's contracts count time in periods of about half an hour, and a loan pays interest for each period from the one it starts in. The contract that would lend to you was last moved on {need.behind.toLocaleString('en-US')} periods ago, because Paryon's keepers on this test network have stopped. A loan opened from it now could be charged a fee for each of those periods, up to {formatSatoshis(need.atMost)} satoshis.
              </p>
              <p class="small muted">Bringing it up to the current period first costs only the network's fee, about 1,100 satoshis, and anyone may do it.</p>
              <Button small disabled={busy} onClick={() => onMove(need)}>
                {state.running?.name === moveName && <Spinner />}
                Bring the contracts up to date
              </Button>
            </>
          )}
          <Outcome state={state} name={moveName} explorer={facts.explorer} />
        </section>

        <section class="new-step">
          <StepHead number={3} title="Borrow" done={false} />
          <Field label="Amount to borrow" id="loan-amount" error={tried && typeof debt === 'string' ? debt : undefined} hint="At least 100.00 PUSD.">
            <div class="input-unit">
              <input id="loan-amount" type="text" inputMode="decimal" autocomplete="off" value={amount} aria-invalid={tried && typeof debt === 'string'} onInput={(event) => setAmount((event.currentTarget as HTMLInputElement).value)} />
              <span>PUSD</span>
            </div>
          </Field>
          <Field label="Collateral" id="loan-ratio" error={tried ? (typeof chosen === 'string' ? chosen : plan?.problem) : undefined} hint={`Worth this much of the debt at the lower price. ${DEFAULT_PERCENT}% is proposed; this page takes no less than ${SAFE_PERCENT}%.`}>
            <div class="input-unit">
              <input id="loan-ratio" type="text" inputMode="numeric" autocomplete="off" value={ratio} aria-invalid={tried && (typeof chosen === 'string' || plan?.problem !== undefined)} onInput={(event) => setRatio((event.currentTarget as HTMLInputElement).value)} />
              <span>%</span>
            </div>
          </Field>
          {plan !== undefined && plan.problem === undefined && market !== undefined && (
            <div class="summary">
              <KeyValues
                entries={[
                  [<>Collateral</>, <Amount satoshis={plan.collateral} exact />],
                  [<>Worth, at {formatPrice(market.lower)}</>, `${percent(plan.ratioAtLower)} of the debt`],
                  ...(market.lower === market.priceThread.state.price ? [] : [[<>Worth, at the stored {formatPrice(market.priceThread.state.price)}</>, `${percent(plan.ratioAtStored)} of the debt`] as [ComponentChildren, ComponentChildren]]),
                  [<>Paryon's fee<small>0.25% of the debt at the stored price, at least 1,000 sat</small></>, <Amount satoshis={plan.fee} exact />],
                  [<strong>Leaves your wallet, about</strong>, <strong><Amount satoshis={plan.total} /></strong>],
                ]}
              />
              <p class="small muted">Plus the network's fee. You receive {formatPusd(plan.debt)} PUSD and the loan's key; the 2,000 satoshis that carry them are counted above. No interest is set on the loan.</p>
            </div>
          )}
          <Button
            block
            disabled={busy || key === undefined || !upToDate}
            onClick={() => {
              const ready = plan !== undefined && plan.problem === undefined && key !== undefined && need !== undefined && need.needed === false;
              setTried(!ready);
              if (ready) onBorrow(key, plan, need);
            }}
          >
            {state.running?.name === borrowName && <Spinner />}
            Borrow {typeof debt === 'bigint' ? `${formatPusd(debt)} PUSD` : ''}
          </Button>
          {(key === undefined || !upToDate) && <p class="small muted form-foot">{key === undefined ? 'First your wallet makes a loan key.' : 'First the contracts are brought up to date.'}</p>}
          <Outcome state={state} name={borrowName} explorer={facts.explorer} />
        </section>
      </div>
      <More summary="What your wallet shows you">
        <p class="small muted">For each step your wallet shows the action in the words of this page's template and in its own figures: what leaves the wallet, what goes into Paryon's contracts, the fee, and the tokens it receives. Nothing is signed until you approve it there.</p>
      </More>
    </Card>
  );
};
