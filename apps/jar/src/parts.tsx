import { type Environment, type Task, Amount, Button, Card, Field, TaskStatus, TextInput, TransactionLink, formatTime } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/** A jar as the page shows it, whichever kind of wallet holds it. */
export interface JarRow {
  id: string;
  label: string;
  unlockTime: number;
  satoshis: bigint;
}

export const LOCKS = [
  { label: '10 minutes (for trying it out)', seconds: 600 },
  { label: '1 hour', seconds: 3_600 },
  { label: '1 day', seconds: 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
  { label: '1 year', seconds: 365 * 86_400 },
];

export const JarList = ({
  jars,
  task,
  peerName,
  note,
  onEmpty,
  children,
}: {
  jars: JarRow[] | undefined;
  task: Task;
  peerName: string;
  /** How the jars are held, in a few words. */
  note: string;
  onEmpty: (jar: JarRow) => void;
  children?: ComponentChildren;
}) => {
  const now = Math.floor(Date.now() / 1000);
  return (
    <Card>
      <div class="row spread">
        <h2>Your savings jars</h2>
        <span class="pill ok">connected to {peerName}</span>
      </div>
      <p class="small muted">{note}</p>
      {jars === undefined ? (
        <p class="muted">Looking for your jars…</p>
      ) : jars.length === 0 ? (
        <p class="muted">No jars yet.</p>
      ) : (
        <ul class="list">
          {jars.map((jar) => {
            const unlocked = now >= jar.unlockTime;
            return (
              <li>
                <div class="row spread">
                  <div>
                    <strong>{jar.label}</strong> · <Amount satoshis={jar.satoshis} />
                    <div class="small muted">{unlocked ? `Open since ${formatTime(jar.unlockTime)}` : `Locked until ${formatTime(jar.unlockTime)}`}</div>
                  </div>
                  {jar.satoshis > 0n && (
                    <Button task={task} name={`empty-${jar.id}`} kind="secondary" disabled={!unlocked} onClick={() => onEmpty(jar)}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {children}
    </Card>
  );
};

export const JarForm = ({
  task,
  environment,
  smallest,
  last,
  footnote,
  onOpen,
}: {
  task: Task;
  environment: Environment;
  smallest: bigint;
  /** The transaction of the last thing done, to link to. */
  last: string | undefined;
  footnote: string;
  onOpen: (satoshis: bigint, unlockTime: number, label: string, progress: (step: string) => void) => Promise<unknown>;
}) => {
  const [amount, setAmount] = useState('');
  const [lock, setLock] = useState(0);
  const [label, setLabel] = useState('');
  const open = async () => {
    const satoshis = amount.replaceAll(/[,\s]/g, '');
    const done = await task.run('open', async (progress) => {
      if (!/^\d{1,15}$/.test(satoshis)) throw new Error('Enter the amount as a whole number of satoshis.');
      await onOpen(BigInt(satoshis), Math.floor(Date.now() / 1000) + (LOCKS[lock]?.seconds ?? 600), label.trim() === '' ? 'Savings jar' : label.trim().slice(0, 40), progress);
      return true;
    });
    if (done === true) {
      setAmount('');
      setLabel('');
    }
  };
  return (
    <Card>
      <h2>Open a savings jar</h2>
      <Field label="Amount in satoshis" hint={`At least ${smallest.toLocaleString('en-US')}.`}>
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
        Open a savings jar
      </Button>
      <TaskStatus task={task} />
      {last !== undefined && last !== '' && task.busy === undefined && task.error === undefined && (
        <p class="notice ok">
          Done. <TransactionLink environment={environment} transactionId={last} />
        </p>
      )}
      <p class="small muted">{footnote}</p>
    </Card>
  );
};
