import type { EverythingQuote, HeldToken, PaymentQuote, RecordedPosition, SendableToken, SentEverything, TokenSendQuote, TokenSendRequest } from '@grandmas-wallet/app';
import { TokenSendError, parseUnits, sendableTokens } from '@grandmas-wallet/app';
import { encodeLockingBytecodeP2sh32 } from '@bitauth/libauth';
import { InsufficientFundsError } from '@grandmas-wallet/core';
import {
  Amount,
  Button,
  Card,
  Choice,
  Field,
  Info,
  InfoLabel,
  KeyValues,
  Loading,
  Notice,
  PageHead,
  PlainAddressError,
  Sat,
  Segmented,
  TaskStatus,
  TextInput,
  Value,
  formatBch,
  formatSatoshis,
  lockingBytecodeOfAddress,
  parseBch,
  shorten,
  tokenDestination,
  useTask,
} from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

import { Hex } from './ActionReview.js';
import type { Owner } from './OwnerApp.js';
import { paymentAddress, tokenAddress } from './scan.js';
import { WithScan } from './Scanner.js';
import { takeChosenToken } from './token-choice.js';
import { CAPABILITY_WORDS, stakeHeadline, tokenStake } from './token-stake.js';
import { TokenAmount, rawUnits } from './token-words.js';
import './send.css';

type Stage =
  | { at: 'form' }
  | { at: 'review'; to: string; locking: Uint8Array; pay: { amount: bigint; quote: PaymentQuote } }
  | { at: 'review'; to: string; locking: Uint8Array; everything: EverythingQuote }
  | { at: 'cannot'; total: bigint; fee: bigint; smallest: bigint }
  | { at: 'sent'; transactionIds: string[]; fee: bigint; bytes: number; amount: bigint; remainder: bigint };

/**
 * Paying (proposal section 8): the fee of the transaction is shown before approval, with any remainder too
 * small to return; "Max" sends everything, and the review shows what will arrive, or, when it cannot be done, the
 * three figures. A wallet that holds tokens chooses first between Bitcoin Cash and a token. Explanations are behind
 * a "?" where they belong; what guards against losing coins or tokens is always in view.
 */
export const Send = ({ owner }: { owner: Owner }) => {
  const [chosen] = useState(takeChosenToken);
  const [what, setWhat] = useState<'coins' | 'token'>(chosen === undefined ? 'coins' : 'token');
  const holdsTokens = (owner.balance?.tokens.length ?? 0) > 0;
  return (
    <div class="stack focus-page send-page">
      <PageHead title="Send" />
      {holdsTokens && (
        <div class="send-what">
          <Segmented
            label="What you send"
            value={what}
            onChange={setWhat}
            options={[
              { value: 'coins', label: 'Bitcoin Cash' },
              { value: 'token', label: 'A token' },
            ]}
          />
        </div>
      )}
      {holdsTokens && what === 'token' ? <TokenSend owner={owner} {...(chosen === undefined ? {} : { chosen })} /> : <CoinSend owner={owner} />}
    </div>
  );
};

/**
 * Where "Max" works out what would arrive before an address is entered: a script hash, the longest ordinary
 * destination, so that the estimate is never above what arrives. The review works it out again for the address.
 */
const ESTIMATE_DESTINATION = encodeLockingBytecodeP2sh32(new Uint8Array(32));

/** An amount of satoshis as the amount field takes it. */
const bchText = (satoshis: bigint): string => formatBch(satoshis).replace(/,/g, '');

const CoinSend = ({ owner }: { owner: Owner }) => {
  const [stage, setStage] = useState<Stage>({ at: 'form' });
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  // "Max": the field holds what would arrive, and the review sends everything, so that nothing is left behind as dust.
  const [max, setMax] = useState(false);
  const [errors, setErrors] = useState<{ to?: string; amount?: string }>({});
  const task = useTask();
  const network = owner.session.network;

  const cannot = (error: InsufficientFundsError): void => setStage({ at: 'cannot', total: error.totalSatoshis, fee: error.feeSatoshis, smallest: error.neededSatoshis - error.feeSatoshis });

  const fillMax = () =>
    task.run('max', async () => {
      let locking = ESTIMATE_DESTINATION;
      try {
        locking = lockingBytecodeOfAddress(to, network);
      } catch {
        // No address yet, or not one that reads: an estimate now, the exact figures in the review.
      }
      try {
        const quote = await owner.wallet.quoteSendEverything(locking);
        setAmount(bchText(quote.sentSatoshis));
        setMax(true);
        setErrors({ ...(errors.to === undefined ? {} : { to: errors.to }) });
      } catch (error) {
        if (!(error instanceof InsufficientFundsError)) throw error;
        cannot(error);
      }
    });

  const review = () =>
    task.run('review', async () => {
      const found: { to?: string; amount?: string } = {};
      let locking: Uint8Array | undefined;
      try {
        locking = lockingBytecodeOfAddress(to, network);
      } catch (error) {
        found.to = (error as Error).message;
      }
      const satoshis = max ? 0n : parseBch(amount);
      if (typeof satoshis === 'string') found.amount = satoshis;
      setErrors(found);
      if (locking === undefined || typeof satoshis === 'string') return;
      if (max) {
        try {
          setStage({ at: 'review', to: to.trim(), locking, everything: await owner.wallet.quoteSendEverything(locking) });
        } catch (error) {
          if (!(error instanceof InsufficientFundsError)) throw error;
          cannot(error);
        }
        return;
      }
      try {
        setStage({ at: 'review', to: to.trim(), locking, pay: { amount: satoshis, quote: await owner.wallet.quotePay([{ lockingBytecode: locking, valueSatoshis: satoshis }]) } });
      } catch (error) {
        if (error instanceof InsufficientFundsError) {
          setErrors({ amount: `The wallet can spend ${formatSatoshis(error.totalSatoshis)} satoshis; this payment and its fee need ${formatSatoshis(error.neededSatoshis)}.` });
          return;
        }
        if (/smallest amount/.test((error as Error).message)) {
          setErrors({ amount: (error as Error).message });
          return;
        }
        throw error;
      }
    });

  const send = () =>
    task.run('send', async (progress) => {
      if (stage.at !== 'review') return;
      const where = shorten(stage.to.replace(/^[a-z]+:/, ''), 10, 6);
      if ('pay' in stage) {
        const { amount: paid } = stage.pay;
        progress('Signing and sending');
        const sent = await owner.wallet.pay([{ lockingBytecode: stage.locking, valueSatoshis: paid }]);
        owner.sent(`Sent ${formatSatoshis(paid)} sat to ${where}`, sent, paid);
        setStage({ at: 'sent', transactionIds: [sent.transactionId], fee: sent.feeSatoshis, bytes: sent.bytes, amount: paid, remainder: sent.remainderSatoshis });
      } else {
        progress('Signing and sending everything');
        const sent: SentEverything = await owner.wallet.sendEverything(stage.locking);
        for (const transaction of sent.transactions) owner.sent(`Sent everything to ${where}`, transaction);
        setStage({ at: 'sent', transactionIds: sent.transactions.map((entry) => entry.transactionId), fee: sent.feeSatoshis, bytes: sent.transactions.reduce((sum, entry) => sum + entry.bytes, 0), amount: sent.sentSatoshis, remainder: 0n });
      }
    });

  const back = () => setStage({ at: 'form' });

  const hint = max ? 'Everything the wallet can send' : amountHint(amount);
  return (
    <div class="stack">
        {stage.at === 'form' && (
          <Card cls="send-card">
            <Field label="To" id="to" error={errors.to}>
              <WithScan filter={paymentAddress(network)} onScan={setTo}>
                <TextInput id="to" value={to} onInput={setTo} placeholder={network === 'mainnet' ? 'bitcoincash:…' : 'bchtest:…'} invalid={errors.to !== undefined} />
              </WithScan>
            </Field>
            {/* The names of the "?" buttons and of "Max" here hold neither "to" nor "amount": the scripted courses find the fields by those labels. */}
            <div class="field">
              <div class="field-head">
                <InfoLabel htmlFor="amount" label="About BCH units" info="In BCH. One BCH is 100,000,000 satoshis.">
                  Amount
                </InfoLabel>
                <Available info="What the wallet can spend now. The network fee comes out of it: one satoshi per byte of the transaction, which is what the network asks. The next step shows the fee exactly, before anything is sent.">
                  {owner.balance === undefined ? '…' : <Amount satoshis={owner.balance.recoverable} />}
                </Available>
              </div>
              <div class="amount-row">
                <div class="input-unit">
                  <TextInput
                    id="amount"
                    numeric
                    value={amount}
                    onInput={(value) => {
                      setAmount(value);
                      setMax(false);
                    }}
                    placeholder="0.00"
                    invalid={errors.amount !== undefined}
                  />
                  <span>BCH</span>
                </div>
                <Button kind="quiet" small task={task} name="max" onClick={() => void fillMax()}>
                  Max
                </Button>
              </div>
              {errors.amount !== undefined ? <div class="field-error">{errors.amount}</div> : hint !== undefined && <div class="hint">{hint}</div>}
            </div>
            <TaskStatus task={task} />
            <div class="actions">
              <Button task={task} name="review" onClick={() => void review()}>
                Review
              </Button>
            </div>
          </Card>
        )}
        {stage.at === 'review' && (
          <Card title="Check and send" cls="send-review">
            {'pay' in stage ? (
              <>
                <Hero label="You send" to={stage.to}>
                  {formatBch(stage.pay.amount)}
                </Hero>
                <KeyValues
                  entries={[
                    ['To', <span class="mono">{shorten(stage.to, 16, 8)}</span>],
                    ['Amount', <Amount satoshis={stage.pay.amount} exact />],
                    [<FeeName detail={`${stage.pay.quote.bytes} bytes at one satoshi per byte, which is what the network asks.`} />, <Sat satoshis={stage.pay.quote.feeSatoshis} />],
                    [<strong>Leaves the wallet</strong>, <strong><Amount satoshis={stage.pay.amount + stage.pay.quote.feeSatoshis} exact /></strong>],
                  ]}
                />
                {stage.pay.quote.remainderSatoshis > 0n && (
                  <Notice>
                    The fee includes <Sat satoshis={stage.pay.quote.remainderSatoshis} /> that is too little to come back as change.
                  </Notice>
                )}
              </>
            ) : (
              <>
                <Hero label="You send everything" to={stage.to}>
                  {formatBch(stage.everything.sentSatoshis)}
                </Hero>
                <KeyValues
                  entries={[
                    ['To', <span class="mono">{shorten(stage.to, 16, 8)}</span>],
                    [<strong>Arrives</strong>, <strong><Amount satoshis={stage.everything.sentSatoshis} exact /></strong>],
                    [<FeeName detail={`${stage.everything.transactions === 1 ? 'One transaction' : `${stage.everything.transactions} transactions`}, at one satoshi per byte, which is what the network asks.`} />, <Sat satoshis={stage.everything.feeSatoshis} />],
                  ]}
                />
                {(owner.balance?.tokens.length ?? 0) > 0 && <Notice>Tokens stay where they are.</Notice>}
                {stage.everything.leftOut > 0 && <Notice>{stage.everything.leftOut} coin(s) hold less than it costs to send them and stay in the wallet.</Notice>}
              </>
            )}
            <TaskStatus task={task} name="send" />
            <div class="actions">
              <Button task={task} name="send" onClick={() => void send()}>
                Send
              </Button>
              <Button kind="quiet" disabled={task.busy !== undefined} onClick={back}>
                Change
              </Button>
            </div>
          </Card>
        )}
        {stage.at === 'cannot' && (
          <Card title="Too little to send" tone="warn">
            <p>What the wallet holds does not cover the fee and the smallest amount an address can receive. Nothing was sent.</p>
            <KeyValues
              entries={[
                ['The wallet holds', <Sat satoshis={stage.total} />],
                ['The fee would be', <Sat satoshis={stage.fee} />],
                ['The smallest amount that can arrive', <Sat satoshis={stage.smallest} />],
              ]}
            />
            <div class="actions">
              <Button kind="quiet" onClick={back}>
                Back
              </Button>
            </div>
          </Card>
        )}
        {stage.at === 'sent' && (
          <Card title="Sent" tone="good">
            <KeyValues
              entries={[
                ['Amount', <Amount satoshis={stage.amount} exact />],
                [<>Network fee<small>{stage.bytes} bytes</small></>, <Sat satoshis={stage.fee} />],
              ]}
            />
            {stage.remainder > 0n && <p class="small muted">The fee includes {formatSatoshis(stage.remainder)} satoshis too little to return as change.</p>}
            <div class="stack-s">
              <span class="small muted">Transaction</span>
              {stage.transactionIds.map((id) => (
                <Value text={id} copyLabel="Copy" testId="sent-transaction" />
              ))}
            </div>
            <div class="actions">
              <Button
                kind="secondary"
                onClick={() => {
                  setTo('');
                  setAmount('');
                  setMax(false);
                  back();
                }}
              >
                Send another payment
              </Button>
              <Button kind="quiet" onClick={() => owner.navigate('home')}>
                Home
              </Button>
            </div>
          </Card>
        )}
    </div>
  );
};

/** Under the amount, once it reads: the satoshis it comes to. */
const amountHint = (text: string): string | undefined => {
  if (text.trim() === '') return undefined;
  const parsed = parseBch(text);
  return typeof parsed === 'string' ? undefined : `${formatSatoshis(parsed)} satoshis`;
};

/** What the wallet can spend, beside the label of an amount. */
const Available = ({ children, info }: { children: ComponentChildren; info?: ComponentChildren }) => (
  <span class="available">
    <span class="muted">Available</span>
    <span class="available-figure">{children}</span>
    {info !== undefined && <Info label="About what is available">{info}</Info>}
  </span>
);

/** At the foot of the form for a token: the Bitcoin Cash its fee is paid from, with how behind a "?". */
const FeeLine = ({ owner }: { owner: Owner }) => (
  <div class="fee-line">
    <span class="muted">Bitcoin Cash for fees</span>
    <span class="available-figure">{owner.balance === undefined ? '…' : <Amount satoshis={owner.balance.recoverable} />}</span>
    <Info label="About the network fee">
      <span>The network fee is paid in Bitcoin Cash from the wallet's ordinary coins, never from a token's coin.</span>
      <span>With the token goes the smallest amount of Bitcoin Cash an output with a token may hold.</span>
    </Info>
  </div>
);

/** The figure a review is about, large, and where it goes. */
const Hero = ({ label, to, unit, children }: { label: string; to: string; unit?: ComponentChildren; children: ComponentChildren }) => (
  <div class="send-hero">
    <span class="send-hero-label">{label}</span>
    <span class="send-hero-figure">
      {children}
      <span class="unit">{unit ?? 'BCH'}</span>
    </span>
    <span class="send-hero-to">
      to <span class="mono">{shorten(to.replace(/^[a-z]+:/, ''), 12, 8)}</span>
    </span>
  </div>
);

/** A row's name with what it means behind a "?". */
const Named = ({ name, label, detail }: { name: ComponentChildren; label: string; detail: ComponentChildren }) => (
  <InfoLabel label={label} info={detail}>
    {name}
  </InfoLabel>
);

const FeeName = ({ detail }: { detail: string }) => <Named name="Network fee" label="About the network fee" detail={detail} />;

// ------------------------------------------------------------------ tokens

type TokenStage =
  | { at: 'form' }
  | { at: 'review'; token: SendableToken; request: TokenSendRequest; to: string; quote: TokenSendQuote }
  | { at: 'sent'; token: SendableToken; to: string; quote: TokenSendQuote; transactionId: string; fee: bigint; bytes: number };

/**
 * What a token is called on this screen: an NFT that a record ties to a template the user trusts, by the template's
 * name for it and the template's name; otherwise what the wallet can say. Fungible tokens are shown by their category.
 */
export const tokenLabel = (token: SendableToken): string => {
  if (token.kind === 'fungible') return 'Fungible tokens';
  const held = token.token;
  if (held.meaning === 'position' && held.tokenName !== undefined && held.template !== undefined) return `${held.tokenName} · ${held.template.name}`;
  if (held.meaning !== 'unknown' && held.template !== undefined) return `A token of "${held.template.name}"`;
  return 'An NFT of unknown meaning';
};

/** A line under a token's label: how much there is, or what the NFT is, and what its position holds. */
const TokenDetail = ({ token, position }: { token: SendableToken; position: RecordedPosition | undefined }) => {
  if (token.kind === 'fungible') {
    return (
      <>
        <TokenAmount amount={token.amount} />
        {token.coins > 1 && ` in ${token.coins} coins`} · <Hex value={token.category} head={6} tail={4} />
      </>
    );
  }
  const held = token.token;
  return (
    <>
      {held.capability === 'none' ? 'NFT' : `NFT, ${held.capability ?? ''}`} · <Hex value={held.category} head={6} tail={4} />
      {held.commitment !== '' && (
        <>
          {' '}
          · <Hex value={held.commitment} head={4} tail={4} />
        </>
      )}
      {held.amount > 0n && (
        <>
          {' '}
          · with <TokenAmount amount={held.amount} />
        </>
      )}
      {position?.status === 'open' && position.satoshis !== undefined && (
        <>
          {' '}
          · controls <Amount satoshis={position.satoshis} />
        </>
      )}
    </>
  );
};

/** Whether sending this token gives away more than the token: a position a record ties it to, or a capability to make or change tokens. */
const controls = (token: SendableToken): boolean => token.kind === 'nft' && (token.token.meaning !== 'unknown' || token.token.capability === 'minting' || token.token.capability === 'mutable');

const TokenSend = ({ owner, chosen }: { owner: Owner; chosen?: string }) => {
  const [held, setHeld] = useState<HeldToken[] | undefined>();
  // Where the positions of the wallet's records stand, for what an NFT controls. Without the chain, nothing is said of it.
  const [positions, setPositions] = useState<RecordedPosition[] | undefined>();
  const reading = useTask();
  useEffect(() => {
    void reading.run('read', async () => setHeld(await owner.apps.applications.tokens()));
    owner.apps.applications.recordedPositions().then(setPositions, () => setPositions(undefined));
  }, [owner.balance?.tokens.length, owner.apps.version]);
  const positionOf = (token: SendableToken): RecordedPosition | undefined => (token.kind === 'nft' ? positions?.find((position) => position.token.outpoint === token.token.outpoint && position.status !== 'unconfirmed') : undefined);
  const sendable = useMemo(() => (held === undefined ? undefined : sendableTokens(held)), [held]);
  const [key, setKey] = useState<string | undefined>(chosen);
  const token = sendable?.find((entry) => entry.key === key) ?? sendable?.[0];
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<{ to?: string; amount?: string }>({});
  const [plain, setPlain] = useState(false);
  const [problem, setProblem] = useState<ComponentChildren | undefined>();
  const [stage, setStage] = useState<TokenStage>({ at: 'form' });
  const [understood, setUnderstood] = useState(false);
  const task = useTask();
  const network = owner.session.network;

  const pick = (next: string) => {
    setKey(next);
    setAmount('');
    setErrors({});
    setProblem(undefined);
  };

  const review = () =>
    task.run('review', async () => {
      if (token === undefined) return;
      setPlain(false);
      setProblem(undefined);
      const found: { to?: string; amount?: string } = {};
      let locking: Uint8Array | undefined;
      try {
        locking = tokenDestination(to, network);
      } catch (error) {
        if (error instanceof PlainAddressError) setPlain(true);
        else found.to = (error as Error).message;
      }
      // Raw units: no template gives tokens decimals.
      const units = token.kind === 'fungible' ? parseUnits(amount, 0) : 0n;
      if (typeof units === 'string') found.amount = units;
      else if (token.kind === 'fungible' && units > token.amount) found.amount = `The wallet can send ${rawUnits(token.amount)} of these tokens now.`;
      setErrors(found);
      if (locking === undefined || typeof units === 'string' || found.amount !== undefined) return;
      const request: TokenSendRequest = token.kind === 'fungible' ? { kind: 'fungible', category: token.category, amount: units, to: locking } : { kind: 'nft', outpoint: token.token.outpoint, to: locking };
      try {
        setUnderstood(false);
        setStage({ at: 'review', token, request, to: to.trim(), quote: await owner.wallet.quoteTokens(request) });
        window.scrollTo(0, 0);
      } catch (error) {
        if (error instanceof InsufficientFundsError) {
          setProblem(
            <div class="stack-s">
              <strong>Too little Bitcoin Cash for the fee</strong>
              <span>
                Sending a token takes a network fee in Bitcoin Cash, about {formatSatoshis(error.feeSatoshis)} satoshis here, and it is paid from the wallet's ordinary coins, never from a token's coin. They hold {formatSatoshis(error.totalSatoshis)} satoshis and {formatSatoshis(error.neededSatoshis)} are needed. Receive a little Bitcoin Cash first.
              </span>
              <div>
                <Button small kind="secondary" onClick={() => owner.navigate('receive')}>
                  Receive
                </Button>
              </div>
            </div>,
          );
          return;
        }
        if (error instanceof TokenSendError) {
          setProblem(error.message);
          return;
        }
        throw error;
      }
    });

  const send = () =>
    task.run('send', async (progress) => {
      if (stage.at !== 'review') return;
      progress('Signing and sending');
      const sent = await owner.wallet.sendTokens(stage.request);
      const what = stage.token.kind === 'fungible' ? rawUnits(stage.quote.sends.amount) : tokenLabel(stage.token);
      owner.sent(`Sent ${what} to ${shorten(stage.to.replace(/^[a-z]+:/, ''), 10, 6)}`, sent);
      setStage({ at: 'sent', token: stage.token, to: stage.to, quote: sent.quote, transactionId: sent.transactionId, fee: sent.feeSatoshis, bytes: sent.bytes });
    });

  const move = (where: 'vault' | 'earlier') =>
    task.run('move', async (progress) => {
      progress(where === 'vault' ? 'Moving it to an ordinary address' : 'Moving it to this phone');
      const moved = where === 'vault' ? await owner.wallet.moveVaultTokens() : await owner.wallet.sweepEarlier();
      for (const sent of moved.transactions) owner.sent(where === 'vault' ? `Moved ${moved.coins === 1 ? 'a token' : `${moved.coins} tokens`} from vault addresses` : `Moved ${moved.coins} ${moved.coins === 1 ? 'coin' : 'coins'} from earlier addresses`, sent);
      owner.toast(where === 'vault' ? 'Moved to an ordinary address of the wallet.' : 'Moved to this phone\'s addresses.');
    });

  if (sendable === undefined) {
    return <Card>{reading.error === undefined ? <Loading>Reading the tokens and the chain…</Loading> : <TaskStatus task={reading} name="read" />}</Card>;
  }
  if (token === undefined) {
    return (
      <Card>
        <p class="muted">This wallet holds no token it can send.</p>
      </Card>
    );
  }
  const place = token.kind === 'nft' ? token.token.place : token.amount > 0n ? 'address' : token.vault > 0n ? 'vault' : 'earlier';

  return (
    <div class="stack">
        {stage.at === 'form' && (
          <Card cls="token-form-card send-card">
            <div class="field">
              <span class="field-label">Token</span>
              <div class="token-picker" role="radiogroup" aria-label="Token">
                {sendable.map((entry) => (
                  <Choice type="radio" name="token" checked={entry.key === token.key} onChange={() => pick(entry.key)} title={tokenLabel(entry)}>
                    <TokenDetail token={entry} position={positionOf(entry)} />
                  </Choice>
                ))}
              </div>
            </div>
            {place === 'vault' && (
              <Notice>
                <div class="stack-s">
                  <span>
                    This token is at a vault address. It is moved to an ordinary address of the wallet first.{' '}
                    <Info label="Why it is moved first">That goes through the wallet's controller and costs a fee.</Info>
                  </span>
                  <div>
                    <Button small kind="secondary" task={task} name="move" onClick={() => void move('vault')}>
                      Move it to an ordinary address
                    </Button>
                  </div>
                </div>
              </Notice>
            )}
            {place === 'earlier' && (
              <Notice tone="warn">
                <div class="stack-s">
                  <span>This token is at an address of an earlier phone, where that phone's words could still move it. It is moved to this phone's addresses first, with the other coins there.</span>
                  <div>
                    <Button small kind="secondary" task={task} name="move" onClick={() => void move('earlier')}>
                      Move it to this phone
                    </Button>
                  </div>
                </div>
              </Notice>
            )}
            {place === 'address' && (
              <>
                {token.kind === 'fungible' && (
                  <div class="field">
                    <div class="field-head">
                      <InfoLabel htmlFor="token-amount" label="About this token's units" info={<TokenAmountInfo token={token} />}>
                        Amount
                      </InfoLabel>
                      <Available>{rawUnits(token.amount)}</Available>
                    </div>
                    <div class="amount-row">
                      <div class="input-unit token-unit">
                        <TextInput id="token-amount" numeric value={amount} onInput={setAmount} placeholder="0" invalid={errors.amount !== undefined} />
                        <span>units</span>
                      </div>
                      <Button kind="quiet" small onClick={() => setAmount(token.amount.toString())}>
                        Max
                      </Button>
                    </div>
                    {errors.amount !== undefined && <div class="field-error">{errors.amount}</div>}
                  </div>
                )}
                <div class="field">
                  <div class="field-head">
                    <InfoLabel
                      htmlFor="token-to"
                      label="About token addresses"
                      info={
                        <>
                          <span>The receiver's token address. A plain Bitcoin Cash address is not taken for a token.</span>
                          <span>A token goes only to an address written for tokens. Such an address pays the same as the plain one; its form is the receiver's word that their wallet knows tokens.</span>
                        </>
                      }
                    >
                      To
                    </InfoLabel>
                  </div>
                  <WithScan filter={tokenAddress(network)} onScan={setTo}>
                    <TextInput id="token-to" value={to} onInput={(value) => { setTo(value); setPlain(false); }} placeholder={network === 'mainnet' ? 'bitcoincash:z…' : 'bchtest:z…'} invalid={errors.to !== undefined || plain} />
                  </WithScan>
                  {errors.to !== undefined && errors.to !== '' && <div class="field-error">{errors.to}</div>}
                </div>
                {plain && (
                  <Notice tone="bad">
                    <div class="stack-s plain-refusal">
                      <strong>Not a token address</strong>
                      <span>This address is written in the plain form, which does not say that the receiving wallet knows tokens. A wallet that does not know tokens can destroy them. Nothing was built or sent.</span>
                      <span>Ask the receiver for their token address. A wallet that takes tokens shows it when receiving tokens; after the prefix it starts with "z" or "r".</span>
                    </div>
                  </Notice>
                )}
                {problem !== undefined && <Notice tone="warn">{problem}</Notice>}
                <FeeLine owner={owner} />
                <TaskStatus task={task} />
                <div class="actions">
                  <Button task={task} name="review" onClick={() => void review()}>
                    Review
                  </Button>
                </div>
              </>
            )}
            {place !== 'address' && <TaskStatus task={task} name="move" />}
          </Card>
        )}
        {stage.at === 'review' && (
          <Card title="Check and send" cls="token-review send-review">
            <TokenReview stage={stage} />
            {controls(stage.token) && stage.token.kind === 'nft' && <Controlled token={stage.token.token} positions={positions} understood={understood} onUnderstood={setUnderstood} />}
            <TaskStatus task={task} name="send" />
            <div class="actions">
              <Button task={task} name="send" disabled={controls(stage.token) && !understood} onClick={() => void send()}>
                Send
              </Button>
              <Button kind="quiet" disabled={task.busy !== undefined} onClick={() => setStage({ at: 'form' })}>
                Change
              </Button>
            </div>
          </Card>
        )}
        {stage.at === 'sent' && (
          <Card title="Sent" tone="good">
            <KeyValues
              entries={[
                ['Sent', <SentTokens token={stage.token} quote={stage.quote} />],
                [<>Network fee<small>{stage.bytes} bytes</small></>, <Sat satoshis={stage.fee} />],
              ]}
            />
            <div class="stack-s">
              <span class="small muted">Transaction</span>
              <Value text={stage.transactionId} copyLabel="Copy" testId="sent-transaction" />
            </div>
            <div class="actions">
              <Button
                kind="secondary"
                onClick={() => {
                  setTo('');
                  setAmount('');
                  setStage({ at: 'form' });
                }}
              >
                Send another
              </Button>
              <Button kind="quiet" onClick={() => owner.navigate('home')}>
                Home
              </Button>
            </div>
          </Card>
        )}
    </div>
  );
};

type Fungible = Extract<SendableToken, { kind: 'fungible' }>;

/** Behind the amount's "?": the token's units, and what is not yet available. */
const TokenAmountInfo = ({ token }: { token: Fungible }) => {
  const elsewhere = token.vault + token.earlier;
  return (
    <>
      <span>In whole units, up to {rawUnits(token.amount)}.</span>
      {elsewhere > 0n && <span>{rawUnits(elsewhere)} more {token.vault > 0n ? 'at vault addresses' : 'at addresses of an earlier phone'} {token.vault > 0n && token.earlier > 0n ? 'and elsewhere ' : ''}are moved to an ordinary address before they can be sent.</span>}
      {token.withNfts > 0n && <span>{rawUnits(token.withNfts)} more are on coins with an NFT, and move only with it.</span>}
    </>
  );
};

/** What goes, in words. */
const SentTokens = ({ token, quote }: { token: SendableToken; quote: TokenSendQuote }) => {
  if (token.kind === 'fungible') return <TokenAmount amount={quote.sends.amount} />;
  return (
    <span class="token-sent">
      {tokenLabel(token)}
      {quote.sends.amount > 0n && (
        <>
          {', with '}
          <TokenAmount amount={quote.sends.amount} />
        </>
      )}
    </span>
  );
};

const TokenReview = ({ stage }: { stage: Extract<TokenStage, { at: 'review' }> }) => {
  const { quote, token } = stage;
  const rows: [ComponentChildren, ComponentChildren][] = [
    [
      <>
        Sends
        <small>
          {token.kind === 'fungible' ? (
            <>
              Of token <Hex value={token.category} head={6} tail={4} />
            </>
          ) : token.token.capability === 'none' ? (
            'An NFT, unchanged'
          ) : (
            `An NFT with ${token.token.capability} capability, unchanged`
          )}
        </small>
      </>,
      <strong>
        <SentTokens token={token} quote={quote} />
      </strong>,
    ],
    ['To', <span class="mono">{shorten(stage.to, 16, 8)}</span>],
  ];
  if (quote.tokenChange !== undefined) {
    rows.push([
      <Named name="Comes back as token change" label="Where the rest goes" detail="To a new change address of this wallet." />,
      <TokenAmount amount={quote.tokenChange.amount} />,
    ]);
  }
  rows.push([<Named name="Bitcoin Cash with the token" label="About the Bitcoin Cash with the token" detail="The least an output with a token may hold; it goes to the receiver." />, <Sat satoshis={quote.sends.satoshis} />]);
  rows.push([<FeeName detail={`${quote.bytes} bytes at one satoshi per byte, paid from the wallet's ordinary coins.`} />, <Sat satoshis={quote.feeSatoshis} />]);
  rows.push([<Named name={<strong>Leaves the wallet</strong>} label="About what leaves the wallet" detail="In Bitcoin Cash: the fee and what goes with the token." />, <strong><Amount satoshis={quote.leavesSatoshis} exact /></strong>]);
  return (
    <div class="stack-s">
      <Hero label="You send" to={stage.to} unit={token.kind === 'fungible' ? (quote.sends.amount === 1n ? 'unit' : 'units') : ''}>
        {token.kind === 'fungible' ? quote.sends.amount.toLocaleString('en-US') : tokenLabel(token)}
      </Hero>
      <KeyValues entries={rows} />
      {token.kind === 'nft' && token.token.meaning === 'unknown' && token.token.capability === 'none' && <p class="small muted">Nothing here says what this token stands for. It goes whole, as it is.</p>}
      {quote.remainderSatoshis > 0n && (
        <Notice>
          The fee includes <Sat satoshis={quote.remainderSatoshis} /> that is too little to come back as change.
        </Notice>
      )}
    </div>
  );
};

/** Where the application's page is, as a link, by its host and path. */
const PageLink = ({ page }: { page: string }) => (
  <a class="application-page" href={page} target="_blank" rel="noopener noreferrer">
    {page.replace(/^https?:\/\//, '').replace(/\/$/, '')}
  </a>
);

/**
 * A token that gives its holder more than itself: what it controls, from the wallet's own record, the template's name
 * and the chain, and a tick before it can be sent. The line in view says what is at stake; why, behind a "?".
 */
const Controlled = ({ token, positions, understood, onUnderstood }: { token: HeldToken; positions: RecordedPosition[] | undefined; understood: boolean; onUnderstood: (value: boolean) => void }) => {
  const stake = tokenStake(token, positions);
  const { holds } = stake;
  const position = holds.kind !== 'none' && holds.kind !== 'untrusted';
  return (
    <div class="controls stack-s" data-testid="token-stake">
      <Notice tone="warn">
        <div class="stack-s">
          <span class="stake-headline">
            <strong>{stakeHeadline(stake)}</strong>{' '}
            <Info label="About what this token controls">
              {position ? (
                <>
                  A record in this wallet's backup ties this token to a position of the template. Whoever holds the token can take the position's actions; once it is sent, this wallet no longer lists the position or offers them.
                  {holds.kind === 'application' && ' The position sits at a script that many users share. Which coin it is, and what it holds, the application says.'}
                  {holds.kind === 'amount' && holds.places > 1 && ` The figure is what ${holds.places} places of this position hold together.`}
                </>
              ) : holds.kind === 'untrusted' ? (
                'Until the template is trusted on this phone, the wallet does not check the record against the chain, and cannot say what the token controls.'
              ) : (
                'No record of this wallet ties the token to a position.'
              )}
              {stake.capability !== undefined && holds.kind !== 'none' && <> {CAPABILITY_WORDS[stake.capability]}</>}
            </Info>
          </span>
          {holds.kind === 'amount' ? (
            <span class="stake-holds">
              <span>Holds now</span>
              <strong>
                <Amount satoshis={holds.satoshis} exact />
              </strong>
            </span>
          ) : holds.kind === 'nothing' ? (
            <span class="stake-holds">
              <span>Holds now</span>
              <strong>Nothing</strong>
            </span>
          ) : holds.kind === 'application' ? (
            <span class="stake-application">
              The application shows what it holds{holds.page === undefined ? '.' : ':'}
              {holds.page !== undefined && <PageLink page={holds.page} />}
            </span>
          ) : holds.kind === 'not confirmed' ? (
            <span>
              <strong>Not confirmed.</strong> The chain does not bear out this wallet's record of it.
            </span>
          ) : holds.kind === 'not read' ? (
            <span>What it holds can't be read just now.</span>
          ) : holds.kind === 'untrusted' ? (
            <span>What it controls can't be shown here.</span>
          ) : null}
        </div>
      </Notice>
      <Choice type="checkbox" checked={understood} onChange={onUnderstood} title="I understand that whoever receives this token gets what it controls">
        Sending it cannot be undone.
      </Choice>
    </div>
  );
};
