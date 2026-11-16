import '@grandmas-wallet/ui/styles.css';

import { makeLink } from '@grandmas-wallet/app/links';
import { type JsonValue, templateContentHash } from '@grandmas-wallet/archive';
import { type RequestStage, type XoAdvertisement, DappRequests } from '@grandmas-wallet/connect';
import { type DappCredentials, type DappLink, type LinkStatus, openDappLink } from '@grandmas-wallet/connect/wizard';
import { savingsJarTemplate, savingsJarTemplateIdentifier } from '@grandmas-wallet/templates';
import {
  type Environment,
  Amount,
  Button,
  Card,
  CopyBox,
  Field,
  Page,
  Spinner,
  TaskStatus,
  TextInput,
  TransactionLink,
  Vault,
  formatTime,
  loadEnvironment,
  useTask,
} from '@grandmas-wallet/ui';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

/**
 * A small application that uses the wallet: it offers savings jars and asks
 * the connected wallet to open or empty them. It holds no keys and builds no
 * transactions; it only says what the user chose.
 */

interface Jar {
  positionId: string;
  label: string;
  unlockTime: number;
  satoshis: string;
  status: string;
}

const LOCKS = [
  { label: '10 minutes (for trying it out)', seconds: 600 },
  { label: '1 hour', seconds: 3_600 },
  { label: '1 day', seconds: 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
  { label: '1 year', seconds: 365 * 86_400 },
];

const STAGES: Record<RequestStage, string> = {
  sent: 'Asking your wallet',
  accepted: 'Waiting for you to approve in your wallet',
  approved: 'Approved; your wallet is saving the jar\'s record',
  recorded: 'Your wallet is signing',
  'on-network': 'Sent to the network',
};

const vault = new Vault('jar');
const TEMPLATE_HASH = templateContentHash(savingsJarTemplate as unknown as JsonValue);

/** Whether the wallet offers this application's template, byte for byte. */
const usable = (offered: XoAdvertisement, network: string): string | undefined => {
  if (offered.network !== network) return `The wallet is on ${offered.network}; this application is on ${network}.`;
  const template = offered.templates.find((item) => item.identifier === savingsJarTemplateIdentifier);
  if (template === undefined) return 'The wallet has not reviewed the Savings Jar template.';
  if (template.contentHash !== TEMPLATE_HASH) return 'The wallet knows a different version of the Savings Jar template.';
  if (!['open', 'empty', 'list'].every((operation) => template.operations.includes(operation))) return 'The wallet does not offer everything this application needs.';
  return undefined;
};

const App = ({ environment }: { environment: Environment }) => {
  const task = useTask();
  const requests = useMemo(() => new DappRequests(), []);
  const link = useRef<DappLink | undefined>(undefined);
  const [status, setStatus] = useState<LinkStatus>({ state: 'connecting' });
  const [problem, setProblem] = useState<string | undefined>();
  const [connectLink, setConnectLink] = useState('');
  const [jars, setJars] = useState<Jar[] | undefined>();
  const [amount, setAmount] = useState('');
  const [lock, setLock] = useState(0);
  const [label, setLabel] = useState('');
  const [last, setLast] = useState<string | undefined>();
  const now = Math.floor(Date.now() / 1000);

  const list = async () => {
    const result = await requests.request(savingsJarTemplateIdentifier, 'list', {});
    setJars(Array.isArray(result['positions']) ? (result['positions'] as Jar[]) : []);
  };

  const start = (credentials?: DappCredentials) => {
    link.current?.close();
    setJars(undefined);
    setProblem(undefined);
    const opened = openDappLink({
      name: 'Savings Jar',
      relays: environment.relays,
      ...(credentials === undefined ? {} : { credentials }),
      onCredentials: (current) => vault.set('credentials', current),
      onStatus: (next, offered) => {
        setStatus(next);
        if (next.state === 'incompatible') setProblem(next.reason);
        if (next.state !== 'connected' || offered === undefined) return;
        const reason = usable(offered, environment.network);
        setProblem(reason);
        if (reason !== undefined) return;
        requests.attach(opened.channel);
        void list().catch(() => undefined);
      },
    });
    link.current = opened;
    void makeLink(environment.walletUrl, 'connect', { uri: opened.uri, name: 'Savings Jar' }).then(setConnectLink);
  };

  useEffect(() => {
    const saved = vault.get<DappCredentials>('credentials');
    // A session with a wallet is resumed; without one, a fresh address is shown.
    start(saved?.walletPublicKey === undefined ? undefined : saved);
    return () => link.current?.close();
  }, []);

  const disconnect = () => {
    vault.remove('credentials');
    requests.detach();
    start();
    setStatus({ state: 'connecting' });
  };

  const open = () =>
    task.run('open', async (progress) => {
      const satoshis = amount.replaceAll(/[,\s]/g, '');
      if (!/^\d+$/.test(satoshis)) throw new Error('Enter the amount as a whole number of satoshis.');
      const result = await requests.request(
        savingsJarTemplateIdentifier,
        'open',
        { satoshis, unlockTime: now + (LOCKS[lock]?.seconds ?? 600), ...(label.trim() === '' ? {} : { label: label.trim() }) },
        (stage) => progress(STAGES[stage]),
      );
      setLast(String(result['transactionId'] ?? ''));
      setAmount('');
      setLabel('');
      await list();
    });

  const empty = (jar: Jar) =>
    task.run(`empty-${jar.positionId}`, async (progress) => {
      const result = await requests.request(savingsJarTemplateIdentifier, 'empty', { positionId: jar.positionId }, (stage) => progress(STAGES[stage]));
      setLast(String(result['transactionId'] ?? ''));
      await list();
    });

  const connected = status.state === 'connected' && problem === undefined;
  if (!connected) {
    return (
      <>
        <Card>
          <h2>Put money aside until a date you choose</h2>
          <p>
            A savings jar holds part of your wallet's money until the date you set. It stays yours: the jar belongs to your wallet, and moves with it if you
            ever change devices.
          </p>
        </Card>
        <Card tone={problem === undefined ? undefined : 'warn'}>
          <h2>Connect your wallet</h2>
          {problem !== undefined && <p class="notice error">{problem}</p>}
          <p>Open this link on the device that has your wallet, or copy it into the wallet under "Connected applications".</p>
          {connectLink === '' ? (
            <p>
              <Spinner /> Preparing…
            </p>
          ) : (
            <CopyBox text={connectLink} open openLabel="Open my wallet" />
          )}
          <p class="small muted">
            {status.state === 'waiting' ? 'Waiting for your wallet to connect.' : status.state === 'connecting' ? 'Reaching the relay…' : `Status: ${status.state}.`} The
            connection is encrypted between this page and your wallet.
          </p>
          {vault.get<DappCredentials>('credentials')?.walletPublicKey !== undefined && (
            <Button kind="quiet" onClick={disconnect}>
              Forget the earlier connection
            </Button>
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      <Card>
        <div class="row spread">
          <h2>Your savings jars</h2>
          <span class="pill ok">connected to {status.peerName ?? 'your wallet'}</span>
        </div>
        {jars === undefined ? (
          <p class="muted">
            <Spinner /> Asking your wallet…
          </p>
        ) : jars.length === 0 ? (
          <p class="muted">No jars yet.</p>
        ) : (
          <ul class="list">
            {jars.map((jar) => {
              const unlocked = now >= jar.unlockTime;
              return (
                <li>
                  <div class="row spread">
                    <div>
                      <strong>{jar.label}</strong> · <Amount satoshis={BigInt(jar.satoshis)} />
                      <div class="small muted">{unlocked ? `Open since ${formatTime(jar.unlockTime)}` : `Locked until ${formatTime(jar.unlockTime)}`}</div>
                    </div>
                    {BigInt(jar.satoshis) > 0n && (
                      <Button task={task} name={`empty-${jar.positionId}`} kind="secondary" disabled={!unlocked} onClick={() => void empty(jar)}>
                        Withdraw
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p>
          <Button kind="quiet" onClick={() => void list()}>
            Refresh
          </Button>{' '}
          <Button kind="quiet" onClick={disconnect}>
            Disconnect
          </Button>
        </p>
      </Card>
      <Card>
        <h2>Open a savings jar</h2>
        <Field label="Amount in satoshis" hint="At least 1,720.">
          <TextInput value={amount} onInput={setAmount} numeric placeholder="0" />
        </Field>
        <Field label="Locked for">
          <select value={String(lock)} onChange={(event) => setLock(Number((event.currentTarget as HTMLSelectElement).value))}>
            {LOCKS.map((option, index) => (
              <option value={String(index)}>{option.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Name (optional)">
          <TextInput value={label} onInput={setLabel} placeholder="Holiday" />
        </Field>
        <Button task={task} name="open" onClick={() => void open()} disabled={amount.trim() === ''}>
          Open a savings jar
        </Button>
        <TaskStatus task={task} />
        {last !== undefined && last !== '' && task.busy === undefined && task.error === undefined && (
          <p class="notice ok">
            Done. <TransactionLink environment={environment} transactionId={last} />
          </p>
        )}
        <p class="small muted">Your wallet shows what will happen and asks you to approve before anything is signed.</p>
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
