import '@grandmas-wallet/ui/styles.css';

import type { OwnerWallet } from '@grandmas-wallet/app';
import { Card, Frame, Loading, Notice, plainError } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { BRAND } from './brand.js';
import { Create } from './Create.js';
import { MoveIn } from './MoveIn.js';
import { OwnerApp } from './OwnerApp.js';
import { Restore } from './Restore.js';
import { type Mode, type Session, boot, keep, kept } from './session.js';
import { Takeover } from './Takeover.js';
import { Welcome } from './Welcome.js';


/** Which screen the device is at follows from what it keeps. */
const Root = () => {
  const [session, setSession] = useState<Session | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [mode, setMode] = useState<Mode | 'restore' | undefined>(() => kept('mode'));
  const [wallet, setWallet] = useState<OwnerWallet | undefined>();

  useEffect(() => {
    boot().then(setSession, (error: unknown) => setProblem(plainError(error)));
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
  const becomeOwner = (opened?: OwnerWallet) => {
    keep('mode', 'owner');
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
      return frame(<Welcome session={session} onChoose={choose} />);
    case 'create':
      return frame(<Create session={session} onBack={() => choose(undefined)} onCreated={becomeOwner} />);
    case 'takeover':
      return frame(<Takeover session={session} onBack={() => choose(undefined)} onDone={becomeOwner} />);
    case 'move':
      return frame(<MoveIn session={session} onBack={() => choose(undefined)} onDone={becomeOwner} />);
    case 'restore':
      return frame(<Restore session={session} onBack={() => choose(undefined)} onDone={becomeOwner} />);
    case 'owner':
      return <OwnerApp session={session} opened={wallet} onLost={() => choose('create')} />;
    default:
      return frame(<Notice tone="bad">This device keeps something this page does not know. Erase the device under details to start again.</Notice>);
  }
};

render(<Root />, document.getElementById('app') as HTMLElement);
