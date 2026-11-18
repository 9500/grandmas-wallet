import { type FeeView, type RecovererView, feeReserve, feeView, viewAsRecoverer } from '@grandmas-wallet/app';
import { keyFingerprint } from '@grandmas-wallet/enrollment';
import { Button, Card, PageHead, Pill, TaskStatus, lockingBytecodeOfAddress, shorten, useEvery, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { FundsCard, useFunds } from './Funds.js';
import { type Session, modeOf, openWalletPage, wallets } from './session.js';

/**
 * Why a wallet cannot be read. A wallet whose creation the network no longer has is said so in plain words: the
 * set-up did not hold, and is done again when its owner's phone asks again.
 */
export const describeProblem = (error: unknown): string => {
  const message = (error as Error).message;
  return /No transaction creating this identity|created by a different transaction/.test(message)
    ? 'The network no longer has the transaction that made this wallet: the set-up did not hold. Set it up again when its owner\'s phone asks; this one can no longer be used.'
    : message;
};

/**
 * The wallets this recoverer looks after, each with where it stands on chain, and the recoverer's balance, from
 * which it sets new wallets up. A wallet whose fee address runs short is topped up from the balance.
 */
export const Wallets = ({ session, onNew }: { session: Session; onNew: () => void }) => {
  const bank = modeOf() === 'bank';
  const all = Object.entries(wallets()).sort(([, a], [, b]) => b.addedAt - a.addedAt);
  const [views, setViews] = useState<Record<string, { view?: RecovererView; fees?: FeeView | undefined; problem?: string }>>({});
  const { funds, problem } = useFunds(session);
  const topUp = useTask();
  useEvery(20_000, async () => {
    const next: typeof views = {};
    for (const [identity, looked] of all) {
      try {
        next[identity] = { view: await viewAsRecoverer(session.chain, looked.kept), fees: await feeView(session.chain, looked.kept) };
      } catch (error) {
        next[identity] = { problem: describeProblem(error) };
      }
    }
    setViews(next);
  }, [all.length, topUp.busy]);
  const short = all.filter(([identity]) => {
    const entry = views[identity];
    return entry?.fees !== undefined && entry.fees.missing > 0n && entry.view?.standing.kind !== 'not named' && entry.view?.standing.kind !== 'closed';
  });
  return (
    <div class="stack">
      <PageHead title={bank ? 'Customers' : 'People you help'}>
        <button type="button" onClick={onNew} data-testid="new-wallet">
          {bank ? 'New customer' : 'Help someone set up'}
        </button>
      </PageHead>
      <div class="grid two">
        <div class="stack">
          {all.length === 0 ? (
            <Card>
              <div class="empty stack-s">
                <p>No wallets yet.</p>
                <p class="small">{bank ? 'When a customer opens an account, show them the code under "New customer".' : 'When someone you know wants a wallet, choose "Help someone set up" and let their phone scan the code.'}</p>
              </div>
            </Card>
          ) : (
        <Card>
          <ul class="list">
            {all.map(([identity, looked]) => {
              const entry = views[identity];
              return (
                <li>
                  <button type="button" class="linkrow" onClick={() => openWalletPage(identity)} data-testid="open-wallet">
                    <span class="linkrow-text">
                      {looked.label || 'Unnamed wallet'} <span class="muted small mono">{shorten(identity, 6, 4)}</span>
                      <small>
                        {entry === undefined ? (
                          'Reading the chain…'
                        ) : entry.problem !== undefined ? (
                          entry.problem
                        ) : (
                          <WalletLine view={entry.view as RecovererView} fees={entry.fees} asNew={looked.asNewRecoverer === true} pending={looked.kept.pending !== undefined} />
                        )}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
          )}
          {short.length > 0 && (
            <Card title="Fee coins running short" tone="warn">
              <p class="small muted">A request and its completion are paid from each wallet's own fee address. Top these up from your balance.</p>
              <ul class="list">
                {short.map(([identity, looked]) => (
                  <li class="list-item">
                    <span>
                      {looked.label || shorten(identity, 6, 4)} <span class="small muted">· {views[identity]?.fees?.missing.toLocaleString('en-US')} sat missing</span>
                    </span>
                    <Button
                      small
                      kind="secondary"
                      task={topUp}
                      name={identity}
                      disabled={funds === undefined}
                      onClick={() =>
                        void topUp.run(identity, async () => {
                          const fees = views[identity]?.fees;
                          if (funds === undefined || fees === undefined) return;
                          await funds.pay(lockingBytecodeOfAddress(fees.address, session.network), feeReserve());
                        })
                      }
                    >
                      Top up
                    </Button>
                  </li>
                ))}
              </ul>
              <TaskStatus task={topUp} />
            </Card>
          )}
        </div>
        <FundsCard session={session} funds={funds} problem={problem} />
      </div>
    </div>
  );
};

const WalletLine = ({ view, fees, asNew, pending }: { view: RecovererView; fees?: FeeView | undefined; asNew: boolean; pending: boolean }) => {
  const { standing } = view;
  const parts = [];
  if (standing.kind === 'quiet') parts.push(<Pill tone="good">Quiet</Pill>);
  if (standing.kind === 'requested') parts.push(<Pill tone="warn">Request waiting · {keyFingerprint(standing.proposedKeyHash)}</Pill>);
  if (standing.kind === 'closed') parts.push(<Pill>Closed</Pill>);
  if (standing.kind === 'not named') parts.push(<Pill>{asNew ? 'Waiting for the owner to name you' : 'No longer names you'}</Pill>);
  if (pending && standing.kind === 'quiet') parts.push(<Pill tone="accent">Takeover request saved</Pill>);
  if (fees !== undefined && standing.kind !== 'not named' && standing.kind !== 'closed') parts.push(fees.missing === 0n ? <span>fee coins: enough</span> : <span>fee coins: {fees.missing.toLocaleString('en-US')} sat missing</span>);
  return <span class="row">{parts}</span>;
};
