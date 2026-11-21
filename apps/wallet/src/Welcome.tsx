import { Info, NetworkQuestion, Notice, networkUnchosen } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { type Session, kept } from './session.js';

/** Where a phone that keeps no wallet can begin. */
export type Beginning = 'bank' | 'friend' | 'takeover' | 'move' | 'restore';

/**
 * The first screen of a phone that keeps no wallet, in two groups the user can tell apart by their own situation: a new
 * wallet set up by the user's bank or by someone they trust; and, quieter, the ways back to a wallet the user had.
 */
export const Welcome = ({ session, onChoose }: { session: Session; onChoose: (beginning: Beginning) => void }) => {
  const lost = kept('lostSetUp');
  const test = session.environment.network !== 'mainnet';
  // A first visit to a site that offers more than one network begins with where to try the wallet.
  const [asking, setAsking] = useState(() => lost === undefined && networkUnchosen(session.environment));
  if (asking) {
    return (
      <div class="stack set-up welcome">
        <div class="set-up-head">
          <h1>Welcome</h1>
          <p class="muted">Where do you want to try the wallet? You can change it later with the network label at the top.</p>
        </div>
        <NetworkQuestion environment={session.environment} onStay={() => setAsking(false)} />
      </div>
    );
  }
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
      <section class="welcome-group" aria-labelledby="welcome-new">
        <h2 id="welcome-new">New wallet</h2>
        <div class="choices">
          <button type="button" class="choice-card primary" onClick={() => onChoose('bank')} data-testid="begin-bank">
            I have a code from my bank
          </button>
          <button type="button" class="choice-card primary" onClick={() => onChoose('friend')} data-testid="begin-friend">
            Someone I trust is setting it up
          </button>
        </div>
      </section>
      <section class="welcome-group" aria-labelledby="welcome-back">
        <h2 id="welcome-back">I had a wallet before</h2>
        <div class="welcome-list">
          <button type="button" onClick={() => onChoose('takeover')} data-testid="begin-takeover">
            I lost my phone
          </button>
          <button type="button" onClick={() => onChoose('move')}>
            I still have my old phone
          </button>
          <button type="button" onClick={() => onChoose('restore')}>
            I have my own backup
          </button>
        </div>
      </section>
      {test && <p class="small muted center">{session.environment.network === 'mockup' ? 'Mockup: a chain of this site\'s own. Its coins are free and have no value.' : `Test network (${session.environment.network}). Its coins have no value.`}</p>}
    </div>
  );
};
