import { Button, Card, Field, PageHead, TextInput } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import { type Mode, keep, kept } from './session.js';

/** The two ways of working, in the recoverer's own words. Shown on the first run and in the settings. */
export const MODES: { mode: Mode; title: string; detail: string; name: string; placeholder: string }[] = [
  {
    mode: 'bank',
    title: 'I\'m a bank',
    detail: 'A new customer\'s wallet is set up the moment their phone scans your code, from your own coins, with nobody saying yes on this page. You look after many wallets.',
    name: 'Your bank\'s name, as customers\' wallets show it',
    placeholder: 'For example: Example Bank',
  },
  {
    mode: 'friend',
    title: 'I\'m helping someone I know',
    detail: 'You set up a wallet for a person you know, from your own coins, and say yes on this page when their phone asks. If they lose their phone, you move the wallet to their new one.',
    name: 'Your name, as their wallet shows it',
    placeholder: 'For example: Anna',
  },
];

/** The first run: how this page is used, and the name phones show. Both can be changed later in the settings. */
export const Start = ({ onDone }: { onDone: () => void }) => {
  const [mode, setMode] = useState<Mode | undefined>();
  const [name, setName] = useState(() => kept('name') ?? '');
  const chosen = MODES.find((entry) => entry.mode === mode);
  return (
    <div class="stack">
      <PageHead title="Welcome">How will you use this page? You can change it later in the settings.</PageHead>
      <div class="choices" role="radiogroup">
        {MODES.map((entry) => (
          <button type="button" role="radio" aria-checked={mode === entry.mode} class={`choice-card${mode === entry.mode ? ' primary' : ''}`} onClick={() => setMode(entry.mode)} data-testid={`mode-${entry.mode}`}>
            {entry.title}
            <small>{entry.detail}</small>
          </button>
        ))}
      </div>
      {chosen !== undefined && (
        <Card>
          <Field label={chosen.name} id="name">
            <TextInput id="name" value={name} onInput={setName} placeholder={chosen.placeholder} />
          </Field>
          <div class="actions">
            <Button
              disabled={name.trim() === ''}
              onClick={() => {
                keep('name', name.trim());
                keep('mode', chosen.mode);
                onDone();
              }}
            >
              Continue
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};
