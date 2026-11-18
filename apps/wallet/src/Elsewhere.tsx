import { keyFingerprint } from '@grandmas-wallet/enrollment';
import { Amount, Button, Card, Field, KeyValues, Notice, PageHead, TaskStatus, TextInput, Value, lockingBytecodeOfAddress, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { Erase } from './Details.js';
import type { Owner } from './OwnerApp.js';
import { paymentAddress } from './scan.js';
import { WithScan } from './Scanner.js';

/**
 * The chain names another key as the owner, and this phone did not hand the wallet over (proposal section
 * 17): it gives out no address, and offers to move out what its keys can still spend, at once.
 */
export const OwnedElsewhere = ({ owner }: { owner: Owner }) => {
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<string[] | undefined>();
  const task = useTask();
  const { status, history } = owner.watch;
  const since = history?.owners.at(-1)?.sinceTransactionId;
  const inBlock = history?.transactions.find((entry) => entry.transactionId === since)?.confirmed === true;
  const { balance } = owner;
  const spendable = (balance?.recoverable ?? 0n) + (balance?.cancelling ?? 0n);
  const moveOut = () =>
    task.run('out', async (progress) => {
      let locking: Uint8Array;
      try {
        locking = lockingBytecodeOfAddress(to, owner.session.network);
        setError(undefined);
      } catch (problem) {
        setError((problem as Error).message);
        return;
      }
      progress('Sending');
      const sent = await owner.wallet.moveOut(locking);
      for (const transaction of sent.transactions) owner.sent('Moved coins out after the wallet went to another key', transaction);
      setDone(sent.transactions.map((transaction) => transaction.transactionId));
    });
  return (
    <div class="stack">
      <PageHead title="This wallet now belongs to another key" />
      <Card tone="bad">
        <p>The network shows that the wallet has been moved to a key this phone does not hold. This phone gives out no addresses and takes on nothing for the wallet.</p>
        {!inBlock && <p class="small muted">The change is not in a block yet. If it does not stay, for example because this wallet refused the request in time, this phone carries on by itself.</p>}
        <KeyValues
          wide
          entries={[
            ['The new owner\'s key', status?.kind === 'owned-elsewhere' ? <span class="mono">{keyFingerprint(status.ownerKeyHash)}</span> : '…'],
            ['Checked on', `${owner.session.servers.length} server${owner.session.servers.length === 1 ? '' : 's'}`],
          ]}
        />
        <p class="small muted">If you asked your recoverer to move the wallet to a new phone, this is what you expected: there is nothing to do here, and you can erase this phone.</p>
      </Card>
      {spendable > 0n && done === undefined && (
        <Card title="If you did not want this">
          <p>
            This phone's keys can still spend <Amount satoshis={spendable} exact /> that the new owner has not moved yet. Send it to an address of another wallet, one that does not share this wallet's recoverer, now: the new owner may move it first.
          </p>
          <Field label="Send to" id="out" error={error}>
            <WithScan filter={paymentAddress(owner.session.network)} onScan={setTo}>
              <TextInput id="out" value={to} onInput={setTo} invalid={error !== undefined} />
            </WithScan>
          </Field>
          <TaskStatus task={task} name="out" />
          <div class="actions">
            <Button kind="danger" task={task} name="out" disabled={to.trim() === ''} onClick={() => void moveOut()}>
              Move the coins out
            </Button>
          </div>
          {(balance?.vault ?? 0n) > 0n && <Notice tone="warn">Coins at vault addresses cannot be moved this way: only the wallet's controller releases them.</Notice>}
        </Card>
      )}
      {done !== undefined && (
        <Card title="Moved out" tone="good">
          {done.map((id) => (
            <Value text={id} />
          ))}
        </Card>
      )}
      <Erase />
    </div>
  );
};

/** This phone handed the wallet to a new phone (section 9.7). */
export const MovedAway = ({ owner }: { owner: Owner }) => (
  <div class="stack">
    <PageHead title="Your wallet is on your new phone now" />
    <Card tone="good">
      <p>This phone handed the wallet over. The new phone moves the coins to its own addresses and gives out new ones. This phone no longer owns the wallet and gives out no addresses.</p>
      <p class="small muted">Its words can still spend what is at its own addresses until the new phone has moved it. Once the new phone shows everything, erase this one.</p>
      {owner.watch.status?.kind === 'owned-elsewhere' && <p class="small muted">The network shows the new owner: {keyFingerprint(owner.watch.status.ownerKeyHash)}.</p>}
    </Card>
    <Erase />
  </div>
);
