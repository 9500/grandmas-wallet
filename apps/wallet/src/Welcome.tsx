import { Notice } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { type Mode, type Session, type StoredRecipient, kept, readRecipientLink } from './session.js';

/** The first screen of a device that keeps no wallet: four ways to begin. */
export const Welcome = ({ session, onChoose }: { session: Session; onChoose: (mode: Mode | 'restore') => void }) => {
  const [from, setFrom] = useState<StoredRecipient | undefined>();
  const incoming = kept('incoming');
  useEffect(() => {
    if (incoming?.kind === 'recoverer') void readRecipientLink(incoming.text).then(setFrom, () => undefined);
  }, []);
  const test = session.environment.network !== 'mainnet';
  return (
    <div class="stack">
      <div class="hero">
        <h1>A wallet someone you trust can help you get back</h1>
        <p>If you lose this phone, a person you choose can move the wallet to a new one. They have to wait, in public, before it happens, and while they wait this phone can say no. They can never spend your coins.</p>
      </div>
      {from !== undefined && (
        <Notice tone="wait">
          You opened the link of <strong>{from.name || 'a recoverer'}</strong>. Make a new wallet with them as your recoverer, or take over a wallet they look after.
        </Notice>
      )}
      {incoming !== undefined && incoming.kind !== 'recoverer' && (
        <Notice tone="warn">You opened a link that belongs to a step this phone has not started. Choose below what you are doing, and the link is used when it fits.</Notice>
      )}
      <div class="choices">
        <button type="button" class="choice-card primary" onClick={() => onChoose('create')}>
          Make a new wallet
          <small>You choose a recoverer and a waiting period, then add the first coins.</small>
        </button>
        <button type="button" class="choice-card" onClick={() => onChoose('takeover')}>
          Take over my wallet on this phone
          <small>Your old phone is lost or broken. Your recoverer moves the wallet here after the waiting period.</small>
        </button>
        <button type="button" class="choice-card" onClick={() => onChoose('move')}>
          Move from my other phone
          <small>Your old phone still works. It hands the wallet over at once, with no waiting.</small>
        </button>
        <button type="button" class="choice-card" onClick={() => onChoose('restore')}>
          Restore from my own backup
          <small>The twelve words and the wallet's identity that you wrote down.</small>
        </button>
      </div>
      {test && <p class="small muted">This page runs on a test network ({session.environment.network}). Its coins have no value; do not send real Bitcoin Cash here.</p>}
    </div>
  );
};
