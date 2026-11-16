import '@grandmas-wallet/ui/styles.css';

import { Card, Page, Spinner, reloadOnLink } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { Desk } from './Desk.js';
import { Home } from './Home.js';
import { type Session, boot } from './session.js';

const Root = () => {
  const [session, setSession] = useState<Session | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => {
    boot().then(setSession, (error: Error) => setProblem(error.message));
  }, []);
  return (
    <Page title="Grandma's Wallet" role="Recoverer" environment={session?.environment}>
      {problem !== undefined ? (
        <Card tone="danger">
          <h2>The page could not start</h2>
          <p>{problem}</p>
        </Card>
      ) : session === undefined ? (
        <Card>
          <p>
            <Spinner /> Starting…
          </p>
        </Card>
      ) : session.openIdentity !== undefined ? (
        <Desk session={session} identity={session.openIdentity} />
      ) : (
        <Home session={session} />
      )}
    </Page>
  );
};

reloadOnLink();
render(<Root />, document.getElementById('app') as HTMLElement);
