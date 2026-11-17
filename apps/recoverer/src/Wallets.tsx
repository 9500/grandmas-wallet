import { type FeeView, type RecovererView, feeView, viewAsRecoverer } from '@grandmas-wallet/app';
import { keyFingerprint } from '@grandmas-wallet/enrollment';
import { Card, PageHead, Pill, shorten, useEvery } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { type Session, openWalletPage, wallets } from './session.js';

/** The wallets this recoverer holds a kit for, each with where it stands on chain. */
export const Wallets = ({ session, onShowLink }: { session: Session; onShowLink: () => void }) => {
  const all = Object.entries(wallets()).sort(([, a], [, b]) => b.addedAt - a.addedAt);
  const [views, setViews] = useState<Record<string, { view?: RecovererView; fees?: FeeView | undefined; problem?: string }>>({});
  useEvery(20_000, async () => {
    const next: typeof views = {};
    for (const [identity, looked] of all) {
      try {
        next[identity] = { view: await viewAsRecoverer(session.chain, looked.kept), fees: await feeView(session.chain, looked.kept) };
      } catch (error) {
        next[identity] = { problem: (error as Error).message };
      }
    }
    setViews(next);
  }, [all.length]);
  return (
    <div class="stack">
      <PageHead title="Wallets you look after">Open one to see its fee coins, or to act on a request.</PageHead>
      {all.length === 0 ? (
        <Card>
          <div class="empty stack-s">
            <p>No wallets yet.</p>
            <p class="small">Give your link to the person whose wallet you will look after. Their wallet then sends you a recovery kit as a link; open it on this page.</p>
            <div>
              <button type="button" onClick={onShowLink}>
                Show your link
              </button>
            </div>
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
