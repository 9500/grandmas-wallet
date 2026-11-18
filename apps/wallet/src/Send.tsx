import { binToHex } from '@bitauth/libauth';
import type { EverythingQuote, PaymentQuote, SentEverything } from '@grandmas-wallet/app';
import { type AccountCoin, InsufficientFundsError } from '@grandmas-wallet/core';
import { Amount, Button, Card, Field, KeyValues, Notice, PageHead, Sat, TaskStatus, TextInput, Value, formatSatoshis, parseBch, lockingBytecodeOfAddress, shorten, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import type { Owner } from './OwnerApp.js';
import { paymentAddress } from './scan.js';
import { WithScan } from './Scanner.js';

type Stage =
  | { at: 'form' }
  | { at: 'review'; to: string; locking: Uint8Array; amount: bigint; quote: PaymentQuote }
  | { at: 'review-everything'; to: string; locking: Uint8Array; quote: EverythingQuote }
  | { at: 'cannot'; total: bigint; fee: bigint; smallest: bigint }
  | { at: 'sent'; transactionIds: string[]; fee: bigint; bytes: number; amount: bigint; remainder: bigint };

/**
 * Paying (proposal section 8): the fee of the transaction is shown before approval, with any remainder too
 * small to return; "send everything" shows what will arrive, or, when it cannot be done, the three figures.
 */
export const Send = ({ owner }: { owner: Owner }) => {
  const [stage, setStage] = useState<Stage>({ at: 'form' });
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<{ to?: string; amount?: string }>({});
  const task = useTask();
  const network = owner.session.network;

  const review = (everything: boolean) =>
    task.run(everything ? 'everything' : 'review', async () => {
      const found: { to?: string; amount?: string } = {};
      let locking: Uint8Array | undefined;
      try {
        locking = lockingBytecodeOfAddress(to, network);
      } catch (error) {
        found.to = (error as Error).message;
      }
      const satoshis = everything ? 0n : parseBch(amount);
      if (typeof satoshis === 'string') found.amount = satoshis;
      setErrors(found);
      if (locking === undefined || typeof satoshis === 'string') return;
      if (everything) {
        try {
          setStage({ at: 'review-everything', to: to.trim(), locking, quote: await owner.wallet.quoteSendEverything(locking) });
        } catch (error) {
          if (!(error instanceof InsufficientFundsError)) throw error;
          setStage({ at: 'cannot', total: error.totalSatoshis, fee: error.feeSatoshis, smallest: error.neededSatoshis - error.feeSatoshis });
        }
        return;
      }
      try {
        setStage({ at: 'review', to: to.trim(), locking, amount: satoshis, quote: await owner.wallet.quotePay([{ lockingBytecode: locking, valueSatoshis: satoshis }]) });
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
      if (stage.at === 'review') {
        progress('Signing and sending');
        const sent = await owner.wallet.pay([{ lockingBytecode: stage.locking, valueSatoshis: stage.amount }]);
        owner.sent(`Sent ${formatSatoshis(stage.amount)} sat to ${shorten(stage.to.replace(/^[a-z]+:/, ''), 10, 6)}`, sent, stage.amount);
        setStage({ at: 'sent', transactionIds: [sent.transactionId], fee: sent.feeSatoshis, bytes: sent.bytes, amount: stage.amount, remainder: sent.remainderSatoshis });
      } else if (stage.at === 'review-everything') {
        progress('Signing and sending everything');
        const sent: SentEverything = await owner.wallet.sendEverything(stage.locking);
        for (const transaction of sent.transactions) owner.sent(`Sent everything to ${shorten(stage.to.replace(/^[a-z]+:/, ''), 10, 6)}`, transaction);
        setStage({ at: 'sent', transactionIds: sent.transactions.map((entry) => entry.transactionId), fee: sent.feeSatoshis, bytes: sent.transactions.reduce((sum, entry) => sum + entry.bytes, 0), amount: sent.sentSatoshis, remainder: 0n });
      }
    });

  const back = () => setStage({ at: 'form' });

  return (
    <div class="stack">
      <PageHead title="Send" />
      <div class="grid two">
        <div class="stack">
          {stage.at === 'form' && (
            <Card>
              <Field label="To" id="to" hint="A Bitcoin Cash address." error={errors.to}>
                <WithScan filter={paymentAddress(network)} onScan={setTo}>
                  <TextInput id="to" value={to} onInput={setTo} placeholder={network === 'mainnet' ? 'bitcoincash:…' : 'bchtest:…'} invalid={errors.to !== undefined} />
                </WithScan>
              </Field>
              <Field label="Amount" id="amount" error={errors.amount} hint={amountHint(amount)}>
                <div class="input-unit">
                  <TextInput id="amount" numeric value={amount} onInput={setAmount} placeholder="0.00" invalid={errors.amount !== undefined} />
                  <span>BCH</span>
                </div>
              </Field>
              <TaskStatus task={task} />
              <div class="actions">
                <Button task={task} name="review" onClick={() => void review(false)}>
                  Review
                </Button>
                <Button kind="quiet" task={task} name="everything" onClick={() => void review(true)}>
                  Send everything instead
                </Button>
              </div>
            </Card>
          )}
          {stage.at === 'review' && (
            <Card title="Check and send">
              <KeyValues
                entries={[
                  ['To', <span class="mono">{shorten(stage.to, 16, 8)}</span>],
                  ['Amount', <Amount satoshis={stage.amount} exact />],
                  [<>Network fee<small>{stage.quote.bytes} bytes at one satoshi per byte</small></>, <Sat satoshis={stage.quote.feeSatoshis} />],
                  [<strong>Leaves the wallet</strong>, <strong><Amount satoshis={stage.amount + stage.quote.feeSatoshis} exact /></strong>],
                ]}
              />
              {stage.quote.remainderSatoshis > 0n && (
                <Notice>
                  The fee includes <Sat satoshis={stage.quote.remainderSatoshis} /> that is too little to come back as change.
                </Notice>
              )}
              <TaskStatus task={task} name="send" />
              <div class="actions">
                <Button task={task} name="send" onClick={() => void send()}>
                  Send
                </Button>
                <Button kind="quiet" onClick={back}>
                  Change
                </Button>
              </div>
            </Card>
          )}
          {stage.at === 'review-everything' && (
            <Card title="Send everything">
              <KeyValues
                entries={[
                  ['To', <span class="mono">{shorten(stage.to, 16, 8)}</span>],
                  [<strong>Arrives</strong>, <strong><Amount satoshis={stage.quote.sentSatoshis} exact /></strong>],
                  [<>Network fee<small>{stage.quote.transactions === 1 ? 'one transaction' : `${stage.quote.transactions} transactions`}</small></>, <Sat satoshis={stage.quote.feeSatoshis} />],
                ]}
              />
              <Notice tone="warn">
                The coin kept for cancelling goes too. Until the wallet holds a coin again, this phone cannot refuse a recovery request. Tokens stay where they are.
              </Notice>
              {stage.quote.leftOut > 0 && <Notice>{stage.quote.leftOut} coin(s) hold less than it costs to send them and stay in the wallet.</Notice>}
              <TaskStatus task={task} name="send" />
              <div class="actions">
                <Button task={task} name="send" onClick={() => void send()}>
                  Send everything
                </Button>
                <Button kind="quiet" onClick={back}>
                  Back
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
        <div class="stack">
          <Card flat>
            <div class="stack-s">
              <h3>Available</h3>
              {owner.balance === undefined ? <p class="muted">…</p> : <p><Amount satoshis={owner.balance.recoverable} exact /></p>}
              <p class="small muted">The coin kept for cancelling is not used for payments. The fee is one satoshi per byte of the transaction, which is what the network asks.</p>
            </div>
          </Card>
          <Tokens owner={owner} />
        </div>
      </div>
    </div>
  );
};

const amountHint = (text: string): string => {
  if (text.trim() === '') return 'In BCH. One BCH is 100,000,000 satoshis.';
  const parsed = parseBch(text);
  return typeof parsed === 'string' ? 'In BCH.' : `${formatSatoshis(parsed)} satoshis`;
};

/** Coins that carry tokens: sent on unchanged, one at a time. */
const Tokens = ({ owner }: { owner: Owner }) => {
  const tokens = owner.balance?.tokens ?? [];
  const [open, setOpen] = useState<AccountCoin | undefined>();
  const [to, setTo] = useState('');
  const task = useTask();
  if (tokens.length === 0) return null;
  return (
    <Card title="Tokens">
      <p class="small muted">The wallet does not know what these stand for. It sends them on unchanged; the fee never comes from a token's coin.</p>
      <ul class="list">
        {tokens.map((coin) => {
          const category = binToHex(coin.utxo.output.token?.category ?? new Uint8Array());
          return (
            <li>
              <div class="list-item">
                <div>
                  <div class="mono">{shorten(category, 8, 6)}</div>
                  <div class="small muted">
                    {coin.utxo.output.token?.nft === undefined ? `${coin.utxo.output.token?.amount ?? 0n} units` : 'One NFT'} · <Sat satoshis={coin.utxo.output.valueSatoshis} />
                  </div>
                </div>
                <Button small kind="secondary" onClick={() => setOpen(open === coin ? undefined : coin)}>
                  Send
                </Button>
              </div>
              {open === coin && (
                <div class="stack-s">
                  <Field label="To" id="token-to">
                    <WithScan filter={paymentAddress(owner.session.network)} onScan={setTo}>
                      <TextInput id="token-to" value={to} onInput={setTo} />
                    </WithScan>
                  </Field>
                  <TaskStatus task={task} name="token" />
                  <Button
                    task={task}
                    name="token"
                    onClick={() =>
                      void task.run('token', async () => {
                        const sent = await owner.wallet.sendToken(coin, lockingBytecodeOfAddress(to, owner.session.network));
                        owner.sent(`Sent a token to ${shorten(to, 14, 6)}`, sent);
                        setOpen(undefined);
                      })
                    }
                  >
                    Send the token
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
