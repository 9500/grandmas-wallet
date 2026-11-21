import { type RecovererFunds, addressOf } from '@grandmas-wallet/app';
import { InsufficientFundsError } from '@grandmas-wallet/core';
import { Amount, Button, Card, Field, HandOff, KeyValues, Loading, Notice, Sat, TaskStatus, TextInput, Value, lockingBytecodeOfAddress, plainError, recheckChain, shorten, useEvery, useTask } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { heldForSetUps } from './offered-session.js';
import { type Session, fundsOf, openingProgress } from './session.js';

/** The recoverer's own coins, once the page's account is open. */
export const useFunds = (session: Session): { funds?: RecovererFunds; problem?: string } => {
  const [state, setState] = useState<{ funds?: RecovererFunds; problem?: string }>({});
  useEffect(() => {
    fundsOf(session).then(
      (funds) => setState({ funds }),
      (error: unknown) => setState({ problem: plainError(error) }),
    );
  }, []);
  return state;
};

/**
 * What the recoverer's balance holds now, read again every few seconds and whenever `again` changes, and why it
 * could not be read when that is so.
 */
export const useBalanceRead = (funds: RecovererFunds | undefined, again?: unknown): { balance?: bigint; problem?: string } => {
  const [read, setRead] = useState<{ balance?: bigint; problem?: string }>({});
  useEvery(
    8_000,
    async () => {
      if (funds === undefined) return;
      try {
        setRead({ balance: await funds.balance() });
      } catch (error) {
        // The last figure stays; the page says that it could not be read again.
        setRead((before) => ({ ...before, problem: plainError(error) }));
      }
    },
    [funds, again],
  );
  return read;
};

/** What the recoverer's balance holds now. */
export const useBalance = (funds: RecovererFunds | undefined, again?: unknown): bigint | undefined => useBalanceRead(funds, again).balance;

/**
 * While the account opens: how far the check of block headers has come, and, when it takes long, a way to make
 * that check afresh. Nothing of the recoverer's is in what is made afresh.
 */
export const Opening = () => {
  const [started] = useState(() => Date.now());
  const [, setTick] = useState(0);
  useEvery(1_000, () => setTick((count) => count + 1), []);
  const checked = openingProgress();
  const seconds = Math.floor((Date.now() - started) / 1000);
  return (
    <div class="stack">
      <Loading>
        Opening your account. The page checks the chain's block headers first.
        {checked !== undefined && checked.verifiedHeight < checked.currentHeight && (
          <span class="small opening-progress" data-testid="opening-progress">
            {' '}
            {checked.verifiedHeight.toLocaleString('en-US')} of {checked.currentHeight.toLocaleString('en-US')} checked.
          </span>
        )}
      </Loading>
      {seconds >= 15 && (
        <Notice tone="warn">
          <div class="stack-s">
            <span>This is taking longer than it should. The page can check the chain again from the start; your balance and the wallets you look after are not touched.</span>
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

/**
 * The recoverer's one balance and the address to fund it at (proposal section 9.6). Every wallet the recoverer
 * sets up is created from it, and every request and completion is paid from it. The whole of it can be sent to
 * another address.
 *
 * @param note - what the balance is for on this screen, under the figure
 * @param short - a warning when the balance does not cover what this screen is about
 */
export const FundsCard = ({ session, funds, problem, note, short }: { session: Session; funds: RecovererFunds | undefined; problem: string | undefined; note?: ComponentChildren; short?: (balance: bigint) => ComponentChildren }) => {
  const [address, setAddress] = useState<string | undefined>();
  const [sent, setSent] = useState(0);
  const { balance, problem: unread } = useBalanceRead(funds, sent);
  useEffect(() => {
    if (funds !== undefined) void funds.address().then((locking) => setAddress(addressOf(locking, session.environment.network === 'mainnet' ? 'mainnet' : 'chipnet')));
  }, [funds]);
  const test = session.environment.network !== 'mainnet';
  const warning = balance === undefined ? undefined : short?.(balance);
  return (
    <Card title="Your balance" cls="funds">
      {problem !== undefined ? (
        <Notice tone="bad">{problem}</Notice>
      ) : funds === undefined || balance === undefined ? (
        unread !== undefined ? (
          <Notice tone="bad">Your balance could not be read: {unread}</Notice>
        ) : (
          <Opening />
        )
      ) : (
        <div class="stack">
          {unread !== undefined && <Notice tone="warn">The balance could not be read again just now: {unread}</Notice>}
          <div class="balance">
            <span class="balance-main" data-testid="funds-balance" data-value={balance.toString()}>
              <Amount satoshis={balance} />
            </span>
            {note !== undefined && <span class="balance-sub">{note}</span>}
          </div>
          {warning !== undefined && warning !== null && warning !== false && <Notice tone="warn">{warning}</Notice>}
          {address !== undefined && (
            <HandOff text={address} qrLabel="QR code of the address of your balance" copyLabel="Copy address" testId="funds-address">
              <p class="small muted">{test ? 'Send test coins to this address.' : 'Send Bitcoin Cash to this address, from any wallet.'}</p>
            </HandOff>
          )}
          <SendAll session={session} funds={funds} balance={balance} onSent={() => setSent(sent + 1)} />
        </div>
      )}
    </Card>
  );
};

type Stage =
  | { at: 'closed' }
  | { at: 'form' }
  | { at: 'review'; to: string; locking: Uint8Array; arrives: bigint; fee: bigint; transactions: number; heldBack: bigint }
  | { at: 'sent'; to: string; arrives: bigint; fee: bigint; transactionIds: string[] };

/**
 * Sending the whole balance to another address: the address, then what will arrive and what it costs, then the
 * sending. Coins a set-up under way is named after stay, and the page says how much that is.
 */
const SendAll = ({ session, funds, balance, onSent }: { session: Session; funds: RecovererFunds; balance: bigint; onSent: () => void }) => {
  const [stage, setStage] = useState<Stage>({ at: 'closed' });
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | undefined>();
  const task = useTask();

  const review = () =>
    task.run('review', async () => {
      let locking: Uint8Array;
      try {
        locking = lockingBytecodeOfAddress(to, session.network);
      } catch (problem) {
        setError((problem as Error).message);
        return;
      }
      setError(undefined);
      try {
        const quote = await funds.quoteSendEverything(locking, { reserved: heldForSetUps() });
        setStage({ at: 'review', to: to.trim(), locking, arrives: quote.sentSatoshis, fee: quote.feeSatoshis, transactions: quote.transactions, heldBack: quote.heldBack });
      } catch (problem) {
        if (!(problem instanceof InsufficientFundsError)) throw problem;
        setError(`Too little to send: the balance that can be sent is ${problem.totalSatoshis.toLocaleString('en-US')} satoshis and the fee would be ${problem.feeSatoshis.toLocaleString('en-US')}.`);
      }
    });

  const send = () =>
    task.run('send', async (progress) => {
      if (stage.at !== 'review') return;
      progress('Signing and sending');
      const sent = await funds.sendEverything(stage.locking, { reserved: heldForSetUps() });
      setStage({ at: 'sent', to: stage.to, arrives: sent.sentSatoshis, fee: sent.feeSatoshis, transactionIds: sent.transactions.map((entry) => entry.transactionId) });
      setTo('');
      onSent();
    });

  if (stage.at === 'closed') {
    return (
      <div class="send-all">
        <Button kind="secondary" disabled={balance === 0n} onClick={() => setStage({ at: 'form' })}>
          Send all
        </Button>
      </div>
    );
  }
  return (
    <div class="send-all stack">
      <h3>Send all</h3>
      {stage.at === 'form' && (
        <>
          <Field label="To" id="send-all-to" hint="Your whole balance goes to this address." error={error}>
            <TextInput id="send-all-to" value={to} onInput={setTo} placeholder={session.network === 'mainnet' ? 'bitcoincash:…' : 'bchtest:…'} invalid={error !== undefined} />
          </Field>
          <TaskStatus task={task} name="review" />
          <div class="actions">
            <Button task={task} name="review" disabled={to.trim() === ''} onClick={() => void review()}>
              Review
            </Button>
            <Button kind="quiet" onClick={() => { setError(undefined); setStage({ at: 'closed' }); }}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {stage.at === 'review' && (
        <>
          <KeyValues
            entries={[
              ['To', <span class="mono">{shorten(stage.to, 16, 8)}</span>],
              [<strong>Arrives</strong>, <strong><Amount satoshis={stage.arrives} exact /></strong>],
              [<>Network fee{stage.transactions > 1 && <small>{stage.transactions} transactions</small>}</>, <Sat satoshis={stage.fee} />],
            ]}
          />
          {stage.heldBack > 0n && (
            <Notice>
              <Sat satoshis={stage.heldBack} /> stay: a wallet is being set up with them.
            </Notice>
          )}
          <p class="small muted">Afterwards the balance is empty. Setting up a wallet, or moving one to a new phone, needs coins in it again.</p>
          <TaskStatus task={task} name="send" />
          <div class="actions">
            <Button task={task} name="send" onClick={() => void send()}>
              Send all
            </Button>
            <Button kind="quiet" disabled={task.busy !== undefined} onClick={() => setStage({ at: 'form' })}>
              Change
            </Button>
          </div>
        </>
      )}
      {stage.at === 'sent' && (
        <>
          <Notice tone="good">
            Sent <Amount satoshis={stage.arrives} exact /> to <span class="mono">{shorten(stage.to.replace(/^[a-z]+:/, ''), 10, 6)}</span>. The fee was <Sat satoshis={stage.fee} />.
          </Notice>
          <div class="stack-s">
            <span class="small muted">{stage.transactionIds.length === 1 ? 'Transaction' : 'Transactions'}</span>
            {stage.transactionIds.map((id) => (
              <Value text={id} copyLabel="Copy" testId="send-all-transaction" />
            ))}
          </div>
          <div>
            <Button kind="quiet" onClick={() => setStage({ at: 'closed' })}>
              Done
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
