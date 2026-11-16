import '@grandmas-wallet/ui/styles.css';

import { Card, Page, Spinner, reloadOnLink } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { App } from './App.js';
import { type Session, boot } from './session.js';

const Root = () => {
  const [session, setSession] = useState<Session | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => {
    boot().then(setSession, (error: Error) => setProblem(error.message));
  }, []);
  return (
    <Page title="Grandma's Wallet" role="Wallet" environment={session?.environment}>
      {problem !== undefined ? (
        <Card tone="danger">
          <h2>The wallet could not start</h2>
          <p>{problem}</p>
        </Card>
      ) : session === undefined ? (
        <Card>
          <p>
            <Spinner /> Opening the wallet…
          </p>
        </Card>
      ) : (
        <App session={session} />
      )}
    </Page>
  );
};

reloadOnLink();
render(<Root />, document.getElementById('app') as HTMLElement);
