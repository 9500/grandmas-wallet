import '@grandmas-wallet/ui/styles.css';
import './recoverer.css';

import { Card, Frame, Loading, type NavItem, plainError, useRoute, useToast } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { Desk } from './Desk.js';
import { Incoming } from './Incoming.js';
import { NewWallet } from './NewWallet.js';
import { resumeDesk, useArrivals } from './offered-session.js';
import { Requests } from './Requests.js';
import { type Session, boot, kept, modeOf, openWalletPage, wallets } from './session.js';
import { Settings } from './Settings.js';
import { Start } from './Start.js';
import { Wallets } from './Wallets.js';

export const BRAND = 'Recoverer';
const ROUTES = ['wallets', 'new', 'requests', 'settings'] as const;
export type Route = (typeof ROUTES)[number];

const Root = () => {
  const [session, setSession] = useState<Session | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [route, navigate] = useRoute(ROUTES, 'wallets');
  const [version, setVersion] = useState(0);
  const [toastElement, toast] = useToast();
  // A kit or a request that arrives over the session the page's code offers is shown as a link opened on the page.
  const arrivals = useArrivals();
  useEffect(() => {
    boot().then(
      (booted) => {
        setSession(booted);
        // A phone that was being set up when the page was loaded again is answered on the same session.
        if (kept('current') === undefined && modeOf() !== undefined) resumeDesk(booted, { kind: 'set up' });
      },
      (error: unknown) => setProblem(plainError(error)),
    );
    const onHash = () => window.location.reload();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (problem !== undefined || session === undefined) {
    return (
      <Frame brand={BRAND} role="Grandma's Wallet">
        {problem === undefined ? (
          <Loading>Connecting to the network…</Loading>
        ) : (
          <Card title="The page could not start" tone="bad">
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
  const mode = modeOf();
  if (mode === undefined) {
    return (
      <Frame brand={BRAND} role="Grandma's Wallet" environment={session.environment}>
        <Start onDone={() => setVersion(version + 1)} />
      </Frame>
    );
  }
  const current = kept('current');
  const looked = current === undefined ? undefined : wallets()[current];
  const waiting = (kept('inbox') ?? []).filter((entry) => entry.assignedTo === undefined).length;
  const bank = mode === 'bank';
  const nav: NavItem<Route>[] = [
    { route: 'wallets', label: bank ? 'Customers' : 'People', icon: 'wallets' },
    { route: 'new', label: bank ? 'New customer' : 'Set up', icon: 'key' },
    ...((kept('inbox') ?? []).length > 0 ? [{ route: 'requests' as const, label: waiting > 0 ? `Requests (${waiting})` : 'Requests', icon: 'inbox' as const, flag: waiting > 0 }] : []),
    { route: 'settings', label: 'Settings', icon: 'details' },
  ];
  const changed = () => setVersion(version + 1);
  return (
    <Frame brand={BRAND} role="Grandma's Wallet" environment={session.environment} nav={nav} current={looked === undefined ? route : 'wallets'} onNavigate={(next) => {
      if (looked !== undefined) {
        // Another section closes the open wallet; the page loads again without its account.
        openWalletPage(undefined, next === 'wallets' ? '/' : `/${next}`);
        return;
      }
      navigate(next);
    }}>
      <Incoming key={arrivals} session={session} onChanged={changed} toast={toast} onShowRequests={() => (looked === undefined ? navigate('requests') : openWalletPage(undefined, '/requests'))} />
      {looked !== undefined && current !== undefined ? (
        <Desk session={session} identity={current} looked={looked} toast={toast} />
      ) : route === 'requests' ? (
        <Requests session={session} onChanged={changed} toast={toast} />
      ) : route === 'new' ? (
        <NewWallet session={session} onDone={() => navigate('wallets')} />
      ) : route === 'settings' ? (
        <Settings
          session={session}
          onSaved={() => {
            toast('Saved.');
            changed();
          }}
        />
      ) : (
        <Wallets session={session} onNew={() => navigate('new')} />
      )}
      {toastElement}
    </Frame>
  );
};

render(<Root />, document.getElementById('app') as HTMLElement);
