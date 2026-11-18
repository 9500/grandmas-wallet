import { describeDelay, leastStartingBalance } from '@grandmas-wallet/app';
import type { ChallengeDelay } from '@grandmas-wallet/core';
import { Amount, Button, Card, Choice, Field, Notice, PageHead, Segmented, TextInput, download, eraseDevice, formatSatoshis, useTask } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { useBalance, useFunds } from './Funds.js';
import { MODES } from './Start.js';
import { type Mode, type Session, balanceWords, closeAccount, keep, kept, modeOf, settingsOf, wallets } from './session.js';

/** Waiting periods to choose from, counted by the chain's clock in steps of 512 seconds. */
export const DELAYS: { delay: ChallengeDelay; hint: string }[] = [
  { delay: { unit: 'time512', value: 1 }, hint: 'For trying the wallet out. Too short to rely on.' },
  { delay: { unit: 'time512', value: 7 }, hint: 'Enough if the owner\'s phone is nearly always on and online.' },
  { delay: { unit: 'time512', value: 169 }, hint: 'A day for the owner\'s phone to notice a request and refuse it.' },
  { delay: { unit: 'time512', value: 1182 }, hint: 'A week. Safer, and a lost phone takes a week to replace.' },
];
const same = (a: ChallengeDelay, b: ChallengeDelay): boolean => a.unit === b.unit && a.value === b.value;

/**
 * How this page works, the name phones show, and what a new wallet gets: its starting balance and its waiting period.
 * The owner of a wallet is shown the waiting period as a fact; a change here applies to wallets set up afterwards.
 */
export const Settings = ({ session, onSaved }: { session: Session; onSaved: () => void }) => {
  const settings = settingsOf();
  const [mode, setMode] = useState<Mode>(() => modeOf() ?? 'friend');
  const [name, setName] = useState(() => kept('name') ?? '');
  const [starting, setStarting] = useState(settings.startingSatoshis);
  const [delay, setDelay] = useState<ChallengeDelay>(settings.challengeDelay);
  const least = leastStartingBalance();
  const amount = /^\d{1,15}$/.test(starting.trim()) ? BigInt(starting.trim()) : undefined;
  const error = amount === undefined ? 'A whole number of satoshis.' : amount < least ? `At least ${formatSatoshis(least)} satoshis, so that the new wallet can refuse a request at once.` : undefined;
  return (
    <div class="stack">
      <PageHead title="Settings" />
      <div class="grid two">
        <Card title="How you use this page">
          <div class="stack">
            <Segmented label="How you use this page" value={mode} onChange={setMode} options={MODES.map((entry) => ({ value: entry.mode, label: entry.title }))} />
            <p class="small muted">{MODES.find((entry) => entry.mode === mode)?.detail}</p>
            <Field label={MODES.find((entry) => entry.mode === mode)?.name ?? 'Your name'} id="name">
              <TextInput id="name" value={name} onInput={setName} />
            </Field>
          </div>
        </Card>
        <Card title="New wallets">
          <div class="stack">
            <Field label="Starting balance, in satoshis" id="starting" error={error} hint="Paid from your balance into each wallet you set up.">
              <TextInput id="starting" value={starting} onInput={setStarting} invalid={error !== undefined} />
            </Field>
            <div role="radiogroup" aria-label="Waiting period">
              <p class="field-label">Waiting period</p>
              {DELAYS.map((entry) => (
                <Choice type="radio" name="delay" checked={same(entry.delay, delay)} onChange={() => setDelay(entry.delay)} title={describeDelay(entry.delay)}>
                  {entry.hint}
                </Choice>
              ))}
              <p class="small muted">When you ask the network to move a wallet to a new phone, its owner's old phone has this long to refuse. Nobody can shorten it.</p>
            </div>
          </div>
        </Card>
      </div>
      <div class="actions">
        <Button
          disabled={error !== undefined || name.trim() === ''}
          onClick={() => {
            keep('mode', mode);
            keep('name', name.trim());
            keep('settings', { startingSatoshis: (amount as bigint).toString(), challengeDelay: delay });
            onSaved();
          }}
        >
          Save
        </Button>
      </div>
      <StartAfresh session={session} />
    </div>
  );
};

/**
 * Erase what this page keeps in this browser and begin again: the kits of the wallets looked after, the key for
 * each, the balance's words and the settings. What it costs is said first: the owners lose this recoverer, and
 * coins left in the balance can no longer be reached from here. The balance's words can be saved beforehand.
 */
const StartAfresh = ({ session }: { session: Session }) => {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const { funds } = useFunds(session);
  const balance = useBalance(funds);
  const task = useTask();
  const looked = Object.keys(wallets()).length;
  const words = balanceWords();
  if (!open) {
    return (
      <Card flat>
        <div class="row spread">
          <span class="small muted">Erase everything this page keeps in this browser and begin again.</span>
          <Button kind="quiet" onClick={() => setOpen(true)}>
            Start afresh
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Start afresh" tone="warn">
      <div class="stack">
        <p>Removes everything this page keeps in this browser: {looked === 0 ? 'your settings' : `the ${looked === 1 ? 'wallet' : `${looked} wallets`} you look after, with your key for ${looked === 1 ? 'it' : 'each'}, your settings`} and the words of your balance. It cannot be undone.</p>
        {looked > 0 && <Notice tone="warn">{looked === 1 ? 'The owner of that wallet loses' : 'The owners of those wallets lose'} you as their recoverer: you can no longer move a wallet to a new phone. Their coins stay theirs, and each can choose a recoverer again from their wallet while their phone works.</Notice>}
        {balance === undefined ? (
          <Notice tone="warn">Your balance has not been read, so the page cannot say whether it holds coins. Coins in it stay on the chain, and this page can no longer reach them afterwards.</Notice>
        ) : balance > 0n ? (
          <Notice tone="warn">
            Your balance holds <Amount satoshis={balance} exact />. Send it elsewhere first, with "Send all": afterwards this page can no longer reach it.
          </Notice>
        ) : (
          <p class="small muted">Your balance holds nothing.</p>
        )}
        {words !== undefined && (
          <div class="row spread">
            <span class="small muted">The twelve words of your balance, as a file. Whoever has them has its coins. They are of use with this project's own tools only.</span>
            <Button small kind="secondary" onClick={() => download('recoverer-balance-words.txt', `Grandma's Wallet, recoverer's balance (${session.environment.network})\nwords: ${words}\n`)}>
              Save the words
            </Button>
          </div>
        )}
        <Choice type="checkbox" checked={sure} onChange={setSure} title="I understand. Nothing I still need is kept on this page only." />
        <div class="actions">
          <Button
            kind="danger"
            disabled={!sure}
            task={task}
            name="erase"
            onClick={() =>
              void task.run('erase', async () => {
                await closeAccount();
                await eraseDevice();
                window.location.replace('/');
              })
            }
          >
            Erase and start afresh
          </Button>
          <Button kind="quiet" onClick={() => { setSure(false); setOpen(false); }}>
            Keep everything
          </Button>
        </div>
      </div>
    </Card>
  );
};
