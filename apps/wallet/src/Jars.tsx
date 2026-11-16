import { type OwnerWallet, type WalletView, NotYetValidError } from '@grandmas-wallet/app';
import { Amount, Button, Card, Field, TaskStatus, TextInput, TransactionLink, formatTime, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import type { Session } from './session.js';

const LOCKS = [
  { label: '10 minutes (for trying it out)', seconds: 600 },
  { label: '1 hour', seconds: 3_600 },
  { label: '1 day', seconds: 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
  { label: '1 year', seconds: 365 * 86_400 },
];

/** Savings jars: money set aside until a date. They stay with the wallet when it moves to a new device. */
export const Jars = ({ session, wallet, view, onChanged }: { session: Session; wallet: OwnerWallet; view: WalletView; onChanged: () => Promise<void> }) => {
  const task = useTask();
  const [amount, setAmount] = useState('');
  const [lock, setLock] = useState(0);
  const [label, setLabel] = useState('');
  const now = Math.floor(Date.now() / 1000);
  const jars = view.positions.filter((jar) => jar.status !== 'closed' && (jar.status === 'open' || jar.held > 0n));

  const open = () =>
    task.run('open', async (progress) => {
      const satoshis = BigInt(amount.replaceAll(/[,\s]/g, '') || '0');
      progress('Saving the jar\'s record to the backup, then signing');
      await wallet.openJar(satoshis, now + (LOCKS[lock]?.seconds ?? 600), label.trim() === '' ? 'Savings jar' : label.trim());
      setAmount('');
      setLabel('');
      await onChanged();
    });

  const empty = (positionId: string) =>
    task.run(`empty-${positionId}`, async (progress) => {
      progress('Emptying the jar');
      try {
        await wallet.emptyJar(positionId);
      } catch (error) {
        if (error instanceof NotYetValidError) throw new Error('The network\'s clock runs a few minutes behind. Please try again in a little while.', { cause: error });
        throw error;
      }
      await onChanged();
    });

  return (
    <Card>
      <h2>Savings jars</h2>
      {jars.length === 0 ? (
        <p class="muted">Put money aside until a date you choose. It cannot be spent before then, not even by you.</p>
      ) : (
        <ul class="list">
          {jars.map((jar) => {
            const unlocked = jar.unlockTime !== undefined && now >= jar.unlockTime;
            return (
              <li>
                <div class="row spread">
                  <div>
                    <strong>{jar.position.label ?? 'Savings jar'}</strong> · <Amount satoshis={jar.held} />
                    <div class="small muted">
                      {jar.unlockTime === undefined ? '' : unlocked ? `Open since ${formatTime(jar.unlockTime)}` : `Locked until ${formatTime(jar.unlockTime)}`}
                      {jar.transactionId !== undefined && (
                        <>
                          {' · '}
                          <TransactionLink environment={session.environment} transactionId={jar.transactionId} />
                        </>
                      )}
                    </div>
                  </div>
                  {jar.held > 0n && (
                    <Button task={task} name={`empty-${jar.position.positionId}`} kind="secondary" disabled={!unlocked} onClick={() => void empty(jar.position.positionId)}>
                      Empty into wallet
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <h3>New jar</h3>
      <Field label="Amount in satoshis" hint="At least 1,720, so that the jar can pay the fee for emptying it later.">
        <TextInput value={amount} onInput={setAmount} numeric placeholder="0" />
      </Field>
      <Field label="Locked for">
        <select value={String(lock)} onChange={(event) => setLock(Number((event.currentTarget as HTMLSelectElement).value))}>
          {LOCKS.map((option, index) => (
            <option value={String(index)}>{option.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Name (optional)">
        <TextInput value={label} onInput={setLabel} placeholder="Holiday" />
      </Field>
      <Button task={task} name="open" onClick={() => void open()} disabled={amount.trim() === ''}>
        Put it in a jar
      </Button>
      <TaskStatus task={task} />
    </Card>
  );
};
