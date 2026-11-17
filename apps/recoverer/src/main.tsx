import '@grandmas-wallet/ui/styles.css';

import { Card, Frame, Loading, type NavItem, plainError, useRoute, useToast } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { Desk } from './Desk.js';
import { Incoming } from './Incoming.js';
import { Requests } from './Requests.js';
import { type Session, boot, kept, openWalletPage, wallets } from './session.js';
import { Wallets } from './Wallets.js';
import { YourLink } from './YourLink.js';

export const BRAND = 'Recoverer';
const ROUTES = ['wallets', 'requests', 'link'] as const;
export type Route = (typeof ROUTES)[number];

const Root = () => {
  const [session, setSession] = useState<Session | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [route, navigate] = useRoute(ROUTES, 'wallets');
  const [version, setVersion] = useState(0);
  const [toastElement, toast] = useToast();
  useEffect(() => {
    boot().then(setSession, (error: unknown) => setProblem(plainError(error)));
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
  const current = kept('current');
  const looked = current === undefined ? undefined : wallets()[current];
  const waiting = (kept('inbox') ?? []).filter((entry) => entry.assignedTo === undefined).length;
  const nav: NavItem<Route>[] = [
    { route: 'wallets', label: 'Wallets', icon: 'wallets' },
    { route: 'requests', label: waiting > 0 ? `Requests (${waiting})` : 'Requests', icon: 'inbox', flag: waiting > 0 },
    { route: 'link', label: 'Your link', icon: 'key' },
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
      <Incoming session={session} onChanged={changed} toast={toast} onShowRequests={() => (looked === undefined ? navigate('requests') : openWalletPage(undefined, '/requests'))} />
      {looked !== undefined && current !== undefined ? (
        <Desk session={session} identity={current} looked={looked} toast={toast} />
      ) : route === 'requests' ? (
        <Requests session={session} onChanged={changed} toast={toast} />
      ) : route === 'link' ? (
        <YourLink session={session} />
      ) : (
        <Wallets session={session} onShowLink={() => navigate('link')} />
      )}
      {toastElement}
    </Frame>
  );
};

render(<Root />, document.getElementById('app') as HTMLElement);
