import { type RecoveryTicket, type TakeoverRecord, joinRecovery, readLink } from '@grandmas-wallet/app';
import { Button, Card, Field, TaskStatus, TextArea, shorten, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { type Session, ensureAccount, takeIncoming } from './session.js';

/** A device that holds nothing yet: start a new wallet, or take over one that was on a device now lost. */
export const Welcome = ({ session, onCreate, onTakeover }: { session: Session; onCreate: () => void; onTakeover: (takeover: TakeoverRecord) => void }) => {
  const task = useTask();
  const arrived = session.incoming?.kind === 'restore' ? session.incoming.text : '';
  const [link, setLink] = useState(arrived);
  const [restoring, setRestoring] = useState(arrived !== '');

  const create = () =>
    task.run('create', async () => {
      await ensureAccount(session);
      session.vault.set('intent', 'create');
      onCreate();
    });

  const takeOver = () =>
    task.run('takeover', async (progress) => {
      const ticket = await readLink<RecoveryTicket>(link, 'restore');
      if (ticket === undefined) throw new Error('That is not a link from a recoverer for moving a wallet. Ask your recoverer for a new one.');
      if (ticket.network !== session.environment.network) throw new Error(`That wallet is on ${ticket.network}; this site is for ${session.environment.network}.`);
      progress('Making this device\'s key');
      const account = await ensureAccount(session);
      const takeover = await joinRecovery(account, ticket);
      session.vault.set('takeover', takeover);
      takeIncoming(session);
      onTakeover(takeover);
    });

  return (
    <>
      {!restoring && (
        <Card>
          <h2>Start a new wallet</h2>
          <p>
            Your money stays under a key that only this device holds. Someone you trust, your <strong>recoverer</strong>, can move the wallet to a new device
            if this one is lost, but only after a waiting period during which you can say no.
          </p>
          <div class="row">
            <Button task={task} name="create" onClick={() => void create()}>
              Create a new wallet
            </Button>
            <Button kind="secondary" onClick={() => setRestoring(true)}>
              I lost my device
            </Button>
          </div>
        </Card>
      )}
      {restoring && (
        <Card>
          <h2>Move your wallet to this device</h2>
          <p>
            Your recoverer starts this. Ask them to move your wallet to a new device; they will give you a link. Open it here, or paste it below.
          </p>
          <Field label="Link from your recoverer">
            <TextArea value={link} onInput={setLink} placeholder="https://…#restore=…" />
          </Field>
          {arrived !== '' && <p class="small muted">A link was opened on this page: {shorten(arrived, 40, 12)}</p>}
          <div class="row">
            <Button task={task} name="takeover" onClick={() => void takeOver()} disabled={link.trim() === ''}>
              Set up this device
            </Button>
            <Button kind="secondary" onClick={() => setRestoring(false)}>
              Back
            </Button>
          </div>
          <p class="small muted">
            This makes a new key on this device. Nothing changes for the wallet until your recoverer has sent the request and the waiting period has passed.
          </p>
        </Card>
      )}
      <TaskStatus task={task} />
    </>
  );
};
