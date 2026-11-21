import { addressOf, creationCost } from '@grandmas-wallet/app';
import { Amount, Button, Card, Field, HandOff, Notice, PageHead, Status, Steps, TextInput } from '@grandmas-wallet/ui';
import { useEffect, useState } from 'preact/hooks';

import { Opening, useBalanceRead, useFunds } from './Funds.js';
import { type Mode, type Session, keep, kept, modeOf, settingsOf, wallets } from './session.js';

/** The two ways of working, in the recoverer's own words. Shown on the first run and in the settings. */
export const MODES: { mode: Mode; title: string; detail: string; name: string; placeholder: string }[] = [
  {
    mode: 'bank',
    title: 'I\'m a bank',
    detail: 'Each new wallet is created from your own coins as soon as the customer\'s phone scans your code. You don\'t approve each one. You look after many wallets.',
    name: 'Your bank\'s name, as customers\' wallets show it',
    placeholder: 'For example: Example Bank',
  },
  {
    mode: 'friend',
    title: 'I\'m helping someone I know',
    detail: 'You set up a wallet for a person you know, from your own coins. When their phone scans your code, this page asks you to approve before the wallet is created. If they lose their phone, you move the wallet to their new one.',
    name: 'Your name, as their wallet shows it',
    placeholder: 'For example: Anna',
  },
];

/**
 * Whether the first run is behind this page: it has said how it works and its balance has once covered a new
 * wallet. A page that looked after wallets before the first run had this step has it behind it.
 */
export const started = (): boolean => modeOf() !== undefined && (kept('started') === true || Object.keys(wallets()).length > 0);

/**
 * The first run, in two steps: how this page is used and the name phones show, then coins for the page's balance.
 * Nothing else is offered until the balance covers one new wallet, since everything this page does is a
 * transaction it pays for. The way of working and the name can be changed later in the settings.
 */
export const Start = ({ session, onDone }: { session: Session; onDone: () => void }) => {
  const [step, setStep] = useState<'choose' | 'fund'>(() => (modeOf() === undefined ? 'choose' : 'fund'));
  return (
    <div class="stack">
      <PageHead title="Welcome">{step === 'choose' ? 'How will you use this page? You can change it later in the settings.' : 'One thing is left before you can set up a wallet: this page needs coins of its own.'}</PageHead>
      <Card flat cls="start-steps">
        <Steps
          steps={[
            { title: 'Say how you use this page', state: step === 'choose' ? 'current' : 'done', ...(step === 'fund' ? { detail: `${modeOf() === 'bank' ? 'As a bank' : 'Helping someone you know'}, as ${kept('name') ?? ''}` } : {}) },
            { title: 'Add coins to your balance', state: step === 'fund' ? 'current' : 'later', detail: 'This page creates wallets and moves them to new phones with transactions on chain, and pays for them itself.' },
            { title: modeOf() === 'bank' ? 'Set up wallets for customers' : 'Set up a wallet for someone', state: 'later' },
          ]}
        />
      </Card>
      {step === 'choose' ? <Choose onChosen={() => setStep('fund')} /> : <Fund session={session} onBack={() => setStep('choose')} onDone={onDone} />}
    </div>
  );
};

const Choose = ({ onChosen }: { onChosen: () => void }) => {
  const [mode, setMode] = useState<Mode | undefined>(() => kept('mode'));
  const [name, setName] = useState(() => kept('name') ?? '');
  const chosen = MODES.find((entry) => entry.mode === mode);
  return (
    <>
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
                onChosen();
              }}
            >
              Continue
            </Button>
          </div>
        </Card>
      )}
    </>
  );
};

/** The balance's address, what a new wallet takes, and what has arrived. "Continue" opens once a wallet is covered. */
const Fund = ({ session, onBack, onDone }: { session: Session; onBack: () => void; onDone: () => void }) => {
  const { funds, problem } = useFunds(session);
  const { balance, problem: unread } = useBalanceRead(funds);
  const [address, setAddress] = useState<string | undefined>();
  useEffect(() => {
    if (funds !== undefined) void funds.address().then((locking) => setAddress(addressOf(locking, session.environment.network === 'mainnet' ? 'mainnet' : 'chipnet')));
  }, [funds]);
  const bank = modeOf() === 'bank';
  const test = session.environment.network !== 'mainnet';
  const starting = BigInt(settingsOf().startingSatoshis);
  const each = creationCost(starting);
  const covered = balance !== undefined && balance >= each;
  return (
    <Card title="Add coins to your balance" cls="funds">
      <div class="stack">
        <p>
          Every wallet you set up is created from your balance, and so is every request to move a wallet to a new phone. Until the balance holds coins, this page cannot do either, so nothing else is offered yet.
        </p>
        <p>
          A new wallet takes about <strong><Amount satoshis={each} exact /></strong>: the <Amount satoshis={starting} exact /> {bank ? 'your customer' : 'its owner'} starts with, and the network's fees. Send at least that, and more if you will set up several wallets. The starting balance can be changed in the settings afterwards.
        </p>
        {problem !== undefined ? (
          <Notice tone="bad">{problem}</Notice>
        ) : funds === undefined || address === undefined ? (
          <Opening />
        ) : (
          <HandOff text={address} qrLabel="QR code of the address of your balance" copyLabel="Copy address" testId="funds-address">
            <p class="small muted">{test ? 'Send test coins to this address, from a faucet or any wallet of this test network.' : 'Send Bitcoin Cash to this address, from any wallet.'}</p>
          </HandOff>
        )}
        {balance === undefined ? (
          unread !== undefined && <Notice tone="bad">Your balance could not be read: {unread}</Notice>
        ) : covered ? (
          <Status tone="good" title={<>Your balance holds <span data-testid="funds-balance" data-value={balance.toString()}><Amount satoshis={balance} exact /></span></>}>
            That covers {balance / each === 1n ? 'one new wallet' : `${(balance / each).toLocaleString('en-US')} new wallets`}. You can add more at any time: the address stays the same.
          </Status>
        ) : (
          <Status tone="wait" title={balance === 0n ? 'Waiting for coins' : 'Waiting for more coins'}>
            Your balance holds <span data-testid="funds-balance" data-value={balance.toString()}><Amount satoshis={balance} exact /></span>. This page sees a payment within a few seconds of its being sent; it does not wait for a block.
          </Status>
        )}
        <div class="actions">
          <Button
            disabled={!covered}
            onClick={() => {
              keep('started', true);
              onDone();
            }}
          >
            Continue
          </Button>
          <Button kind="quiet" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    </Card>
  );
};
