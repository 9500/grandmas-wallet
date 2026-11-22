import type { RequestStage } from '@grandmas-wallet/connect';
import { MAXIMUM_INTEREST_RATE, MINIMUM_DEBT, borrowingFee, collateralAtRatio, collateralRatio } from '@grandmas-wallet/paryon';
import { Amount, Button, Card, Field, HandOff, KeyValues, More, Notice, Pill, Segmented, Spinner, TemplateOffer, Status, Steps, type Step, formatBch, formatSatoshis, formatTime, parseBch, shorten } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import {
  type BorrowPlan,
  type Desk,
  type LoanView,
  type Market,
  type PeriodNeed,
  CHIPNET_DESK,
  LIQUIDATION_PERCENT,
  borrowPlan,
  collateralPercents,
  collateralProblem,
  formatPrice,
  formatPusd,
  formatYearlyPercent,
  interestEachPeriod,
  interestEachYear,
  liquidationPrice,
  parsePercent,
  parsePusd,
  parseYearlyRate,
  partRepayment,
  periodNeed,
  periodWords,
  periodsPerYear,
  priceBasis,
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
export const interestName = (loan: Pick<LoanView, 'category'>): string => `interest:${loan.category}`;

/** The panels a loan in the list can open, one at a time. */
export type LoanPanel = 'collateral' | 'interest' | 'repay' | 'close';

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
export const Independent = ({ desk = CHIPNET_DESK, off = false }: { desk?: Desk | undefined; off?: boolean }) => (
  <div class="independent" role="note">
    <strong>An independent implementation of a front end for Paryon's contracts, not affiliated with Paryon in any way.</strong> This page is not Paryon's site and is not made, reviewed or endorsed by Paryon.{' '}
    {off ? null : desk.paryons && desk.deployment.network === 'mainnet' ? (
      <>
        It is a demonstration that uses Paryon's public contracts unchanged, through their deployment on mainnet, <span class="mono">{desk.deployment.name}</span>. The collateral is real BCH: a loan can be liquidated or redeemed, and the BCH can be lost.
      </>
    ) : desk.paryons ? (
      <>
        It is a demonstration on chipnet, Bitcoin Cash's test network, and uses Paryon's public contracts unchanged, through their test deployment <span class="mono">{desk.deployment.name}</span>. Only test coins, which have no value, are used.
      </>
    ) : (
      <>It uses Paryon's published contracts, unchanged, deployed on a test chain of its own (<span class="mono">{desk.deployment.name}</span>) with a price that nobody updates. Only test coins, which have no value, are used.</>
    )}
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
        <span>Add collateral or take some out, repay part, or repay all of it and get the collateral back. If your wallet is recovered to a new phone, open this page there and connect: the loan is found from its key.</span>
      </li>
    </ol>
    <p class="small muted form-foot">Your wallet keeps this page's template, so it can also carry out each step by itself, with this page closed. It does so through the loan service the template names, which brings Paryon's shared coins.</p>
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

/**
 * The prices: on Paryon's own deployment the stored one and the oracle's, and the lower of the two that the page
 * reckons with; on a deployment no oracle signs for, the stored price alone.
 */
export const PricesCard = ({ market, problem, desk = CHIPNET_DESK }: { market: (Market & { oracleProblem?: string }) | undefined; problem?: string | undefined; desk?: Desk | undefined }) => (
  <Card title="Prices">
    {market === undefined ? (
      problem === undefined ? (
        <p class="muted">
          <Spinner /> {desk.paryons ? 'Reading Paryon\'s contracts and the oracle…' : 'Reading Paryon\'s contracts…'}
        </p>
      ) : (
        <Notice tone="bad">{problem}</Notice>
      )
    ) : market.withoutOracle === true ? (
      <>
        <KeyValues
          entries={
            market.priceThread.state.price === market.stored
              ? [[<>Stored in Paryon's price contracts<small>What the contracts check a loan against, and what this page reckons with</small></>, <strong>{formatPrice(market.stored)}</strong>]]
              : [
                  [<>Stored in Paryon's price contracts<small>What the contracts check a loan against</small></>, `${formatPrice(market.stored)} to ${formatPrice(market.priceThread.state.price)}`],
                  [<strong>This page reckons with</strong>, <strong>{formatPrice(market.lower)}</strong>],
                ]
          }
        />
        <p class="small muted">No oracle signs prices for this deployment. The price was stored when the contracts were deployed, and nobody updates it.</p>
        {problem !== undefined && <Notice tone="warn">The prices could not be brought up to date: {problem}</Notice>}
      </>
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

/**
 * Said on mainnet beside a new loan. Redemptions there are frequent, and Paryon's contracts take the loans at the lowest
 * interest first; this page opens every loan with no interest, the lowest there is.
 */
export const Redemptions = () => (
  <Notice tone="warn">
    This loan is opened with no interest, the lowest rate there is, and on mainnet redemptions take the loans with the lowest rate first. Anyone holding PUSD may then redeem it against this loan: part or all of the debt is paid off with their PUSD, and BCH worth as much at Paryon's price is taken from the collateral. You keep the PUSD you borrowed, but not that BCH.
  </Notice>
);

/**
 * Before a wallet is connected: the prices, and what the smallest loan Paryon makes needs now, at the line where the
 * contracts liquidate and at what this page proposes.
 */
export const LoanNeeds = ({ market, problem, desk, network }: { market: Market | undefined; problem?: string | undefined; desk: Desk; network: string }) => {
  const { proposed, least } = collateralPercents(network);
  const at = (percent: number) => (market === undefined ? 0n : collateralAtRatio(MINIMUM_DEBT, market.lower, BigInt(percent)));
  const fee = market === undefined ? 0n : borrowingFee(MINIMUM_DEBT, market.priceThread.state.price);
  return (
    <Card title={`What a loan of ${formatPusd(MINIMUM_DEBT)} PUSD needs now`}>
      {market === undefined ? (
        problem === undefined ? (
          <p class="muted">
            <Spinner /> {desk.paryons ? 'Reading Paryon\'s contracts and the oracle…' : 'Reading Paryon\'s contracts…'}
          </p>
        ) : (
          <Notice tone="bad">{problem}</Notice>
        )
      ) : (
        <>
          <p class="small muted">Paryon lends at least {formatPusd(MINIMUM_DEBT)} PUSD. At {formatPrice(market.lower)} a BCH, {priceBasis(market.withoutOracle).short}:</p>
          <KeyValues
            entries={[
              [<>Collateral at {LIQUIDATION_PERCENT}%<small>The contracts' line: at once liquidable</small></>, <Amount satoshis={at(LIQUIDATION_PERCENT)} />],
              [<>Collateral at {least}%<small>The least this page accepts</small></>, <Amount satoshis={at(least)} />],
              [<strong>Collateral at {proposed}%<small>What this page proposes</small></strong>, <strong><Amount satoshis={at(proposed)} /></strong>],
              [<>Paryon's fee<small>0.25% of the debt, at least 1,000 sat</small></>, <Amount satoshis={fee} />],
            ]}
          />
          {network === 'mainnet' && <p class="small muted">The collateral is real BCH. With {proposed}% the loan reaches the contracts' line of {LIQUIDATION_PERCENT}% if BCH falls below {formatPrice(liquidationPrice(at(proposed), MINIMUM_DEBT))}; there anyone may liquidate it and the collateral is lost.</p>}
          {network === 'mainnet' && <Redemptions />}
        </>
      )}
    </Card>
  );
};

// ------------------------------------------------------------------ loans

const percent = (value: number | undefined): string => (value === undefined ? '—' : `${value.toFixed(2)}%`);

const LoanPill = ({ loan }: { loan: LoanView }) => (loan.status === 'open' ? <Pill tone="good">Open</Pill> : loan.status === 'closed' ? <Pill>Closed</Pill> : <Pill tone="warn">Not known</Pill>);

const CollateralPanel = ({ loan, market, least, busy, onManage, onClose }: { loan: LoanView; market: Market; least: number; busy: boolean; onManage: (collateral: bigint) => void; onClose: () => void }) => {
  const [direction, setDirection] = useState<'add' | 'take'>('add');
  const [amount, setAmount] = useState('');
  const [tried, setTried] = useState(false);
  const now = loan.found?.loan.output.valueSatoshis ?? 0n;
  const parsed = parseBch(amount);
  const target = typeof parsed === 'bigint' ? (direction === 'add' ? now + parsed : now - parsed) : undefined;
  const problem = typeof parsed === 'string' ? parsed : target === undefined || target <= 0n ? 'That is more than the loan holds.' : collateralProblem(loan, target, market, least);
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

/** A loan's rate in the list: the yearly percentage, and what it costs this loan a period at the price the page reckons with. */
const rateEntry = (label: ComponentChildren, rate: number | undefined, loan: LoanView, market: Market | undefined, desk: Desk): [ComponentChildren, ComponentChildren] => [
  <>
    {label}
    {rate !== undefined && rate !== 0 && market !== undefined && loan.debt !== undefined && (
      <small>
        {formatSatoshis(interestEachPeriod(rate, loan.debt, market.lower))} sat a period at {formatPrice(market.lower)}
      </small>
    )}
  </>,
  rate === undefined || rate === 0 ? 'None' : `${formatYearlyPercent(rate, desk.deployment)} a year`,
];

const capitalised = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

const InterestPanel = ({ loan, market, desk, busy, onChange, onClose }: { loan: LoanView; market: Market; desk: Desk; busy: boolean; onChange: (rate: number) => void; onClose: () => void }) => {
  const chosen = loan.nextInterestRate ?? loan.interestRate ?? 0;
  const [amount, setAmount] = useState(formatYearlyPercent(chosen, desk.deployment).replace(/[,%]/g, ''));
  const [tried, setTried] = useState(false);
  const parsed = parseYearlyRate(amount, desk.deployment);
  const problem =
    typeof parsed === 'string'
      ? parsed
      : parsed.rate !== chosen
        ? undefined
        : chosen !== loan.interestRate
          ? 'That rate is chosen already; it applies from the next interest payment.'
          : 'That is the loan\'s rate now.';
  const debt = loan.debt ?? 0n;
  const periods = periodsPerYear(desk.deployment);
  return (
    <div class="panel">
      <Field label="New rate, a year" id={`interest-${loan.category}`} error={tried ? problem : undefined} hint={`From 0% to ${formatYearlyPercent(MAXIMUM_INTEREST_RATE, desk.deployment)}, in steps of ${formatYearlyPercent(1, desk.deployment)}.`}>
        <div class="inline-form">
          <div class="input-unit long-unit">
            <input id={`interest-${loan.category}`} type="text" inputMode="decimal" autocomplete="off" value={amount} aria-invalid={tried && problem !== undefined} onInput={(event) => setAmount((event.currentTarget as HTMLInputElement).value)} />
            <span>% a year</span>
          </div>
          <Button
            disabled={busy}
            onClick={() => {
              setTried(true);
              if (problem === undefined && typeof parsed !== 'string') onChange(parsed.rate);
            }}
          >
            Change
          </Button>
        </div>
      </Field>
      {typeof parsed !== 'string' && (
        <div class="summary">
          <KeyValues
            entries={[
              [<>Asked of the contracts<small>Per 10,000,000 of the debt's value, each period</small></>, <strong>{parsed.rate.toLocaleString('en-US')}</strong>],
              [<>Each period<small>{capitalised(periodWords(desk))}, at {formatPrice(market.lower)} a BCH</small></>, <Amount satoshis={interestEachPeriod(parsed.rate, debt, market.lower)} exact />],
              [<>In a year<small>{Number.isInteger(periods) ? periods.toLocaleString('en-US') : `About ${Math.round(periods).toLocaleString('en-US')}`} periods, at the same price</small></>, <Amount satoshis={interestEachYear(parsed.rate, debt, market.lower, desk.deployment)} />],
            ]}
          />
          {parsed.rounded && (
            <p class="small">
              {amount.trim().replace(/%$/, '')}% lies between two of the rates the contracts take; the nearest, {formatYearlyPercent(parsed.rate, desk.deployment)} a year, is asked for.
            </p>
          )}
        </div>
      )}
      <p class="small muted">A lower rate costs less, but a redemption may be moved onto a loan with a lower rate: someone hands in PUSD for the same value in BCH out of that loan's collateral, and its debt falls by as much.</p>
      <p class="small muted">The new rate applies from the loan's next interest payment, which anyone may make once a period has passed. Interest is paid in BCH out of the collateral; the debt in PUSD does not grow.</p>
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
  desk = CHIPNET_DESK,
  opened,
  onManage,
  onRepay,
  onClose,
  onChangeInterest,
}: {
  loan: LoanView;
  market: Market | undefined;
  facts: PageFacts;
  state: ActionState;
  /** The deployment, for what the page says of Paryon's periods. */
  desk?: Desk | undefined;
  /** The panel open at first, as the fixtures show it. */
  opened?: LoanPanel | undefined;
  onManage: (loan: LoanView, collateral: bigint) => void;
  onRepay: (loan: LoanView, repay: bigint) => void;
  onClose: (loan: LoanView) => void;
  onChangeInterest: (loan: LoanView, rate: number) => void;
}) => {
  const [panel, setPanel] = useState<LoanPanel | undefined>(opened);
  const busy = state.running !== undefined;
  const open = loan.status === 'open' && loan.debt !== undefined && loan.found !== undefined;
  const range = partRepayment(loan);
  const lowerRatio = market === undefined ? undefined : ratioOf(loan, market.lower);
  const { least } = collateralPercents(facts.network);
  const newRate = loan.nextInterestRate !== undefined && loan.nextInterestRate !== loan.interestRate;
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
              [market === undefined ? <>Worth</> : <>Worth, at {formatPrice(market.lower)}<small>{priceBasis(market.withoutOracle).explained}</small></>, <span class={`ratio${lowerRatio !== undefined && lowerRatio < least ? ' low' : ''}`}>{percent(lowerRatio)} of the debt</span>],
              ...(market === undefined || market.lower === market.priceThread.state.price ? [] : [[<>Worth, at the stored {formatPrice(market.priceThread.state.price)}</>, `${percent(ratioOf(loan, market.priceThread.state.price))} of the debt`] as [ComponentChildren, ComponentChildren]]),
              rateEntry(newRate ? <>Interest now</> : <>Interest</>, loan.interestRate, loan, market, desk),
              ...(newRate ? [rateEntry(<>New rate, from the next interest payment</>, loan.nextInterestRate, loan, market, desk)] : []),
            ]}
          />
          {lowerRatio !== undefined && lowerRatio < least && <Notice tone="warn">The collateral is worth less than {least}% of the debt at {priceBasis(market?.withoutOracle).short}. Add collateral, or repay, before the price falls further: at 110% the contracts let anyone liquidate the loan.</Notice>}
          <div class="loan-key small muted">
            Loan key <span class="mono">{shorten(loan.category, 8, 6)}</span>, in your wallet
          </div>
          <div class="loan-actions">
            <Button kind="secondary" small disabled={busy || market === undefined} onClick={() => setPanel(panel === 'collateral' ? undefined : 'collateral')}>
              {state.running?.name === manageName(loan) && <Spinner />}
              Change the collateral
            </Button>
            <Button kind="secondary" small disabled={busy || market === undefined} onClick={() => setPanel(panel === 'interest' ? undefined : 'interest')}>
              {state.running?.name === interestName(loan) && <Spinner />}
              Change the interest rate
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
              least={least}
              busy={busy}
              onManage={(collateral) => {
                setPanel(undefined);
                onManage(loan, collateral);
              }}
              onClose={() => setPanel(undefined)}
            />
          )}
          {panel === 'interest' && market !== undefined && (
            <InterestPanel
              loan={loan}
              market={market}
              desk={desk}
              busy={busy}
              onChange={(rate) => {
                setPanel(undefined);
                onChangeInterest(loan, rate);
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
      <Outcome state={state} name={interestName(loan)} explorer={facts.explorer} />
      <Outcome state={state} name={repayName(loan)} explorer={facts.explorer} />
      <Outcome state={state} name={closeName(loan)} explorer={facts.explorer} />
    </li>
  );
};

export const LoanList = (props: {
  loans: LoanView[] | undefined;
  trusted: boolean;
  /** Offer the wallet this page's template, and what to do once it trusts it. */
  onOffer?: (() => Promise<boolean>) | undefined;
  onTrusted?: (() => void) | undefined;
  problem?: string | undefined;
  market: Market | undefined;
  facts: PageFacts;
  state: ActionState;
  desk?: Desk | undefined;
  /** A loan's panel open at first, as the fixtures show it. */
  opened?: { category: string; panel: LoanPanel } | undefined;
  onManage: (loan: LoanView, collateral: bigint) => void;
  onRepay: (loan: LoanView, repay: bigint) => void;
  onClose: (loan: LoanView) => void;
  onChangeInterest: (loan: LoanView, rate: number) => void;
}) => (
  <Card title="Your loans">
    {props.loans === undefined ? (
      <p class="muted">
        <Spinner /> Asking your wallet about its loan keys…
      </p>
    ) : props.loans.length === 0 ? (
      props.trusted ? (
        <p class="muted">No loans yet. A loan you open here is listed here, and in any other browser your wallet connects to.</p>
      ) : (
        <div class="stack-s">
          <p class="muted">No loans to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds. If it holds a loan key, one that was sent to you for example, ask it here.</p>
          {props.onOffer !== undefined && <TemplateOffer label="Show the loans my wallet holds" offer={props.onOffer} onTrusted={props.onTrusted ?? (() => undefined)} />}
        </div>
      )
    ) : (
      <ul class="loans">
        {props.loans.map((loan) => (
          <LoanItem
            key={loan.category}
            loan={loan}
            market={props.market}
            facts={props.facts}
            state={props.state}
            desk={props.desk}
            opened={props.opened?.category === loan.category ? props.opened.panel : undefined}
            onManage={props.onManage}
            onRepay={props.onRepay}
            onClose={props.onClose}
            onChangeInterest={props.onChangeInterest}
          />
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
  desk = CHIPNET_DESK,
  onMakeKey,
  onMove,
  onBorrow,
}: {
  market: Market | undefined;
  /** The deployment, for what the page says of Paryon's periods and of who moves the contracts on. */
  desk?: Desk | undefined;
  keys: MadeKey[] | undefined;
  facts: PageFacts;
  state: ActionState;
  onMakeKey: () => void;
  onMove: (need: Extract<PeriodNeed, { needed: true }>) => void;
  onBorrow: (key: MadeKey, plan: BorrowPlan, need: Extract<PeriodNeed, { needed: false }>) => void;
}) => {
  const percents = collateralPercents(facts.network);
  const [amount, setAmount] = useState('100');
  const [ratio, setRatio] = useState(String(percents.proposed));
  const [tried, setTried] = useState(false);
  const busy = state.running !== undefined;
  const debt = parsePusd(amount);
  const chosen = parsePercent(ratio);
  const need = market === undefined || typeof debt === 'string' ? undefined : periodNeed(market, debt);
  const plan = market === undefined || typeof debt === 'string' || typeof chosen === 'string' ? undefined : borrowPlan(debt, chosen, market, percents.least);
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
              <p class="small muted">Your wallet makes it. About 2,800 satoshis: 2,000 go with the key into Paryon's contracts, 1,000 of which come back with the key when you borrow, and the rest is the network's fee. The key waits in Paryon's contracts until then, so your wallet asks you to tick that it goes there.</p>
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
                {desk.paryons && desk.deployment.network === 'mainnet'
                  ? `Paryon's contracts count time in periods of ${desk.deployment.periodLengthBlocks.toLocaleString('en-US')} blocks, about a day, and a loan pays interest for each period from the one it starts in. The contract that would lend to you was last moved on ${need.behind.toLocaleString('en-US')} periods ago; Paryon's keepers usually move them on at the start of each period.`
                  : desk.paryons
                  ? `Paryon's contracts count time in periods of about half an hour, and a loan pays interest for each period from the one it starts in. The contract that would lend to you was last moved on ${need.behind.toLocaleString('en-US')} periods ago, because Paryon's keepers on this test network have stopped.`
                  : `Paryon's contracts count time in periods of ${desk.deployment.periodLengthBlocks.toLocaleString('en-US')} blocks, and a loan pays interest for each period from the one it starts in. The contract that would lend to you was last moved on ${need.behind.toLocaleString('en-US')} periods ago: on this chain of its own nobody moves Paryon's contracts on.`}{' '}
                A loan opened from it now could be charged a fee for each of those periods, up to {formatSatoshis(need.atMost)} satoshis.
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
          <Field label="Collateral" id="loan-ratio" error={tried ? (typeof chosen === 'string' ? chosen : plan?.problem) : undefined} hint={`Worth this much of the debt at ${priceBasis(market?.withoutOracle).short}. ${percents.proposed}% is proposed; this page takes no less than ${percents.least}%. At ${LIQUIDATION_PERCENT}% the contracts let anyone liquidate the loan.`}>
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
                  [<>Liquidated if BCH falls below<small>Where the collateral is worth {LIQUIDATION_PERCENT}% of the debt</small></>, formatPrice(liquidationPrice(plan.collateral, plan.debt))],
                  [<>Paryon's fee<small>0.25% of the debt at the stored price, at least 1,000 sat</small></>, <Amount satoshis={plan.fee} exact />],
                  [<strong>Leaves your wallet, about</strong>, <strong><Amount satoshis={plan.total} /></strong>],
                ]}
              />
              <p class="small muted">Plus the network's fee. You receive {formatPusd(plan.debt)} PUSD and the loan's key; the 2,000 satoshis that carry them are counted above. No interest is set on the loan.</p>
              {facts.network === 'mainnet' && <Redemptions />}
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
        <p class="small muted">Paryon's coins, and the values read from them, come from the loan service the template names. Your wallet shows them apart from its own figures and runs Paryon's contracts on the whole transaction before you are asked.</p>
      </More>
    </Card>
  );
};
