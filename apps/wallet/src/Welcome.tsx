import { Info, Notice } from '@grandmas-wallet/ui';

import { type Session, kept } from './session.js';

/** Where a phone that keeps no wallet can begin. */
export type Beginning = 'bank' | 'friend' | 'takeover' | 'move' | 'restore';

/**
 * The first screen of a phone that keeps no wallet: a wallet set up by the user's bank, or by someone they trust;
 * and, smaller, the ways back to a wallet the user had.
 */
export const Welcome = ({ session, onChoose }: { session: Session; onChoose: (beginning: Beginning) => void }) => {
  const lost = kept('lostSetUp');
  const test = session.environment.network !== 'mainnet';
  return (
    <div class="stack set-up welcome">
      <div class="set-up-head">
        <h1>Welcome</h1>
      </div>
      {lost !== undefined && (
        <Notice tone="warn">
          Your set-up did not hold. Set it up again with {lost.name || 'your recoverer'}.{' '}
          <Info label="Why the set-up did not hold">
            The network no longer has the transaction that created your wallet. Coins sent to your addresses are still yours: this phone keeps their keys and moves them into the wallet once it is set up again.
          </Info>
        </Notice>
      )}
      <div class="choices">
        <button type="button" class="choice-card primary" onClick={() => onChoose('bank')} data-testid="begin-bank">
          I have a code from my bank
        </button>
        <button type="button" class="choice-card primary" onClick={() => onChoose('friend')} data-testid="begin-friend">
          Someone I trust is helping me
        </button>
      </div>
      <div class="welcome-more">
        <button type="button" class="link" onClick={() => onChoose('takeover')} data-testid="begin-takeover">
          I lost my phone
        </button>
        <button type="button" class="link" onClick={() => onChoose('move')}>
          Move from my other phone
        </button>
        <button type="button" class="link" onClick={() => onChoose('restore')}>
          Restore from my own backup
        </button>
      </div>
      {test && <p class="small muted center">Test network ({session.environment.network}). Its coins have no value.</p>}
    </div>
  );
};
