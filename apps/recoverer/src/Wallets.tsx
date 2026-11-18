import { type GivenInput, type RecovererView, creationCost, earlierFeeCoins, viewAsRecoverer } from '@grandmas-wallet/app';
import { keyFingerprint } from '@grandmas-wallet/enrollment';
import { Amount, Button, Card, PageHead, Pill, TaskStatus, shorten, useEvery, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { ChainClock, useChainClock } from './ChainClock.js';
import { FundsCard, useFunds } from './Funds.js';
import { type Session, modeOf, openWalletPage, settingsOf, wallets } from './session.js';

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
 * The wallets this recoverer looks after, each with where it stands on chain, and the recoverer's one balance,
 * from which it sets new wallets up and pays every fee. Coins that an earlier version of this page kept at a
 * wallet's fee address are offered to be brought into the balance.
 */
export const Wallets = ({ session, onNew }: { session: Session; onNew: () => void }) => {
  const bank = modeOf() === 'bank';
  const all = Object.entries(wallets()).sort(([, a], [, b]) => b.addedAt - a.addedAt);
  const [views, setViews] = useState<Record<string, { view?: RecovererView; problem?: string }>>({});
  const [earlier, setEarlier] = useState<GivenInput[]>([]);
  const { funds, problem } = useFunds(session);
  const clock = useChainClock(session);
  const takeIn = useTask();
  useEvery(20_000, async () => {
    const next: typeof views = {};
    const found: GivenInput[] = [];
    for (const [identity, looked] of all) {
      try {
        next[identity] = { view: await viewAsRecoverer(session.chain, looked.kept) };
      } catch (error) {
        next[identity] = { problem: describeProblem(error) };
      }
      found.push(...(await earlierFeeCoins(session.chain, looked.kept).catch(() => [])));
    }
    setViews(next);
    setEarlier(found);
  }, [all.length, takeIn.busy]);
  // What is still at earlier fee addresses, when it is worth its own fee to move.
  const waiting = funds === undefined || takeIn.busy !== undefined ? undefined : funds.takeInQuote(earlier);
  const each = creationCost(BigInt(settingsOf().startingSatoshis));
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
                          <WalletLine view={entry.view as RecovererView} asNew={looked.asNewRecoverer === true} pending={looked.kept.pending !== undefined} />
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
          {(waiting !== undefined || takeIn.error !== undefined) && (
            <Card title="Coins kept with wallets">
              <div class="stack-s">
                <p class="small muted">An earlier version of this page kept coins for fees with each wallet. Every fee is now paid from your balance, so they can come back to it.</p>
                <TaskStatus task={takeIn} />
                {waiting !== undefined && (
                  <div class="row spread">
                    <span>
                      <Amount satoshis={waiting.arrives} exact /> <span class="small muted">after the fee</span>
                    </span>
                    <Button
                      kind="secondary"
                      task={takeIn}
                      name="take-in"
                      onClick={() =>
                        void takeIn.run('take-in', async (progress) => {
                          progress('Moving them to your balance');
                          await funds?.takeIn(earlier);
                          setEarlier([]);
                        })
                      }
                    >
                      Move to your balance
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
        <div class="stack">
          <ChainClock reading={clock} />
          <FundsCard
            session={session}
            funds={funds}
            problem={problem}
            note={
            <>
              Each new wallet takes about <Amount satoshis={each} exact />: its starting balance and the network's fees. What you do for a wallet later is paid from here too.
            </>
          }
            short={(balance) => balance < each && 'Your balance does not cover a new wallet. Add coins to the address below.'}
          />
        </div>
      </div>
    </div>
  );
};

const WalletLine = ({ view, asNew, pending }: { view: RecovererView; asNew: boolean; pending: boolean }) => {
  const { standing } = view;
  const parts = [];
  if (standing.kind === 'quiet') parts.push(<Pill tone="good">Quiet</Pill>);
  if (standing.kind === 'requested') parts.push(<Pill tone="warn">Request waiting · {keyFingerprint(standing.proposedKeyHash)}</Pill>);
  if (standing.kind === 'closed') parts.push(<Pill>Closed</Pill>);
  if (standing.kind === 'not named') parts.push(<Pill>{asNew ? 'Waiting for the owner to name you' : 'No longer names you'}</Pill>);
  if (pending && standing.kind === 'quiet') parts.push(<Pill tone="accent">Takeover request saved</Pill>);
  return <span class="row">{parts}</span>;
};
