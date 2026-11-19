import '@grandmas-wallet/ui/styles.css';
import './set-up.css';

import type { OwnerWallet, OwnerWalletState } from '@grandmas-wallet/app';
import { Card, Frame, Loading, Notice, plainError } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { BRAND } from './brand.js';
import { MoveIn } from './MoveIn.js';
import { OwnerApp } from './OwnerApp.js';
import { Restore } from './Restore.js';
import { type Mode, type Session, boot, keep, kept } from './session.js';
import { SetUp } from './SetUp.js';
import { Takeover } from './Takeover.js';
import { type Beginning, Welcome } from './Welcome.js';

/**
 * What a phone kept is where it stands. A phone that began making a wallet itself, before the recoverer created
 * wallets, opens its wallet if it was made; otherwise it begins again at the first screen.
 */
const storedMode = (): Mode | 'restore' | undefined => {
  const mode = kept('mode');
  if (mode !== 'create') return mode;
  const state = kept('state') as OwnerWalletState | undefined;
  return state?.identity !== undefined && state.creation.createSeen === true ? 'owner' : undefined;
};

/** Which screen the device is at follows from what it keeps. */
const Root = () => {
  const [session, setSession] = useState<Session | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [mode, setMode] = useState<Mode | 'restore' | undefined>(storedMode);
  const [wallet, setWallet] = useState<OwnerWallet | undefined>();

  useEffect(() => {
    boot().then(
      (booted) => {
        // The old phone's link for a move this phone prepared goes on with the move, also after the user went back to the first screen.
        if (storedMode() === undefined && kept('incoming')?.kind === 'move' && kept('preparation') !== undefined) {
          keep('mode', 'move');
          setMode('move');
        }
        setSession(booted);
      },
      (error: unknown) => setProblem(plainError(error)),
    );
    // A link opened in a tab that already shows the page changes only the part after `#`: start again from it.
    const onHash = () => window.location.reload();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const choose = (next: Mode | 'restore' | undefined) => {
    if (next === 'restore' || next === undefined) keep('mode', undefined);
    else keep('mode', next);
    setMode(next);
    window.scrollTo(0, 0);
  };
  const begin = (beginning: Beginning) => {
    if (beginning === 'bank' || beginning === 'friend') {
      keep('setUp', { kind: beginning });
      choose('setup');
    } else choose(beginning);
  };
  const becomeOwner = (opened?: OwnerWallet) => {
    keep('mode', 'owner');
    keep('setUp', undefined);
    setWallet(opened);
    setMode('owner');
    window.scrollTo(0, 0);
  };

  if (problem !== undefined || session === undefined) {
    return (
      <Frame brand={BRAND} role="Your wallet">
        {problem === undefined ? (
          <Loading>Connecting to the network…</Loading>
        ) : (
          <Card title="The wallet could not start" tone="bad">
            <p>{problem}</p>
            <div class="actions">
              <button type="button" onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          </Card>
        )}
      </Frame>
    );
  }

  const frame = (children: preact.ComponentChildren) => (
    <Frame brand={BRAND} role="Your wallet" environment={session.environment}>
      {children}
    </Frame>
  );
  switch (mode) {
    case undefined:
      return frame(<Welcome session={session} onChoose={begin} />);
    case 'setup':
      return frame(<SetUp session={session} kind={kept('setUp')?.kind ?? 'friend'} onBack={() => choose(undefined)} onDone={becomeOwner} />);
    case 'takeover':
      return frame(<Takeover session={session} onBack={() => choose(undefined)} onDone={becomeOwner} />);
    case 'move':
      return frame(<MoveIn session={session} onBack={() => choose(undefined)} onDone={becomeOwner} />);
    case 'restore':
      return frame(<Restore session={session} onBack={() => choose(undefined)} onDone={becomeOwner} />);
    case 'owner':
      return <OwnerApp session={session} opened={wallet} onLost={() => choose(undefined)} />;
    default:
      return frame(<Notice tone="bad">This device keeps something this page does not know. Erase the device under details to start again.</Notice>);
  }
};

render(<Root />, document.getElementById('app') as HTMLElement);
