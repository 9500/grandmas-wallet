import { describeDelay, leastStartingBalance } from '@grandmas-wallet/app';
import type { ChallengeDelay } from '@grandmas-wallet/core';
import { Button, Card, Choice, Field, PageHead, Segmented, TextInput, formatSatoshis } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { MODES } from './Start.js';
import { type Mode, keep, kept, modeOf, settingsOf } from './session.js';

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
export const Settings = ({ onSaved }: { onSaved: () => void }) => {
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
    </div>
  );
};
