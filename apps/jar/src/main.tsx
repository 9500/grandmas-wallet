import '@grandmas-wallet/ui/styles.css';

import { type JsonValue, templateContentHash } from '@grandmas-wallet/archive';
import type { XoAdvertisement } from '@grandmas-wallet/connect';
import { type DappCredentials, type DappLink, type LinkStatus, type WalletOffer, openDappLink } from '@grandmas-wallet/connect/wizard';
import { savingsJarTemplate, savingsJarTemplateIdentifier } from '@grandmas-wallet/templates';
import { type Environment, Button, Card, CopyBox, Page, QrCode, Spinner, Vault, loadEnvironment } from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { PlainJars } from './PlainJars.js';
import { type WalletPaths, readPaths } from './plain.js';
import { XoJars } from './XoJars.js';

/**
 * A small application that uses whatever wallet connects to it.
 *
 * With an ordinary wallet it builds the transactions itself and asks the
 * wallet to sign them. With a wallet that speaks XO requests it asks for
 * actions of its template and leaves the transactions to the wallet.
 */

const vault = new Vault('jar');
const TEMPLATE_HASH = templateContentHash(savingsJarTemplate as unknown as JsonValue);

/** Whether a wallet's XO offer covers this application's template, byte for byte. */
const xoProblem = (offered: XoAdvertisement, network: string): string | undefined => {
  if (offered.network !== network) return `The wallet is on ${offered.network}; this application is on ${network}.`;
  const template = offered.templates.find((item) => item.identifier === savingsJarTemplateIdentifier);
  if (template === undefined) return 'The wallet has not reviewed the Savings Jar template.';
  if (template.contentHash !== TEMPLATE_HASH) return 'The wallet knows a different version of the Savings Jar template.';
  if (!['open', 'empty', 'list'].every((operation) => template.operations.includes(operation))) return 'The wallet does not offer everything this application needs.';
  return undefined;
};

type Mode = { kind: 'xo' } | { kind: 'plain'; paths: WalletPaths } | { kind: 'unusable'; reason: string };

/** How this application will work with the wallet that connected. XO requests are used where the wallet offers them. */
const modeFor = (offer: WalletOffer, network: string): Mode => {
  const xo = offer.xo === undefined ? (offer.xoProblem ?? 'none offered') : xoProblem(offer.xo, network);
  if (xo === undefined) return { kind: 'xo' };
  try {
    return { kind: 'plain', paths: readPaths(offer.paths) };
  } catch (error) {
    return { kind: 'unusable', reason: offer.xo === undefined && offer.xoProblem === undefined ? (error as Error).message : xo };
  }
};

const App = ({ environment }: { environment: Environment }) => {
  const link = useRef<DappLink | undefined>(undefined);
  const [status, setStatus] = useState<LinkStatus>({ state: 'connecting' });
  const [mode, setMode] = useState<Mode | undefined>();
  const [address, setAddress] = useState<{ uri: string; qrUri: string } | undefined>();

  const start = (credentials?: DappCredentials) => {
    link.current?.close();
    setMode(undefined);
    setAddress(undefined);
    const opened = openDappLink({
      name: 'Savings Jar',
      icon: `${window.location.origin}/icon.svg`,
      relays: environment.relays,
      ...(credentials === undefined ? {} : { credentials }),
      onCredentials: (current) => vault.set('credentials', current),
      onStatus: (next, offered) => {
        setStatus(next);
        if (next.state === 'connected' && offered !== undefined) setMode(modeFor(offered, environment.network));
        if (next.state === 'disconnected' && next.reason !== undefined) setMode(undefined);
      },
    });
    link.current = opened;
    setAddress({ uri: opened.uri, qrUri: opened.qrUri });
  };

  useEffect(() => {
    const saved = vault.get<DappCredentials>('credentials');
    // A session with a wallet is resumed; without one, a fresh address is shown.
    start(saved?.walletPublicKey === undefined ? undefined : saved);
    return () => link.current?.close();
  }, []);

  const disconnect = () => {
    vault.remove('credentials');
    start();
    setStatus({ state: 'connecting' });
  };

  const peerName = status.peerName ?? 'your wallet';
  if (status.state === 'connected' && link.current !== undefined && mode?.kind === 'xo') {
    return <XoJars environment={environment} link={link.current} peerName={peerName} onDisconnect={disconnect} />;
  }
  if (status.state === 'connected' && link.current !== undefined && mode?.kind === 'plain') {
    return <PlainJars environment={environment} link={link.current} paths={mode.paths} peerName={peerName} onDisconnect={disconnect} />;
  }

  const resuming = vault.get<DappCredentials>('credentials')?.walletPublicKey !== undefined;
  return (
    <>
      <Card>
        <h2>Put money aside until a date you choose</h2>
        <p>A savings jar holds part of your wallet's money until the date you set. It stays yours: only your wallet can empty it, and only after that date.</p>
      </Card>
      <Card tone={mode?.kind === 'unusable' ? 'warn' : undefined}>
        <h2>Connect your wallet</h2>
        {mode?.kind === 'unusable' && <p class="notice error">{mode.reason}</p>}
        {resuming ? (
          <p>
            <Spinner /> Reaching the wallet connected earlier. Open it if it is closed.
          </p>
        ) : address === undefined ? (
          <p>
            <Spinner /> Preparing…
          </p>
        ) : (
          <>
            <p>Works with any wallet that supports WizardConnect. Scan this code with the wallet, or copy the address into it.</p>
            <QrCode text={address.qrUri} />
            <CopyBox text={address.uri} />
          </>
        )}
        <p class="small muted">
          {status.state === 'waiting' ? 'Waiting for your wallet to connect.' : status.state === 'connecting' ? 'Reaching the relay…' : `Status: ${status.state}.`} The connection is
          encrypted between this page and your wallet.
        </p>
        {resuming && (
          <Button kind="quiet" onClick={disconnect}>
            Forget the earlier connection
          </Button>
        )}
      </Card>
    </>
  );
};

const Root = () => {
  const [environment, setEnvironment] = useState<Environment | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => {
    loadEnvironment().then(setEnvironment, (error: Error) => setProblem(error.message));
  }, []);
  return (
    <Page title="Savings Jar" role="Application" environment={environment}>
      {problem !== undefined ? (
        <Card tone="danger">
          <p>{problem}</p>
        </Card>
      ) : environment === undefined ? (
        <Card>
          <p>
            <Spinner /> Starting…
          </p>
        </Card>
      ) : (
        <App environment={environment} />
      )}
    </Page>
  );
};

render(<Root />, document.getElementById('app') as HTMLElement);
