import { type OwnerWallet, readLink } from '@grandmas-wallet/app';
import { type LedgerEntry, type Proposal, WalletConnector, XO_EXTENSION_VERSION } from '@grandmas-wallet/connect';
import { type LinkStatus, type WalletLink, newLinkKey, openWalletLink } from '@grandmas-wallet/connect/wizard';
import { Button, Card, Field, TaskStatus, TextArea, formatSatoshis, formatTime, useTask } from '@grandmas-wallet/ui';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type Session, takeIncoming } from './session.js';

/** A connection to an application, as the wallet keeps it. */
interface Connection {
  id: string;
  uri: string;
  /** This wallet's key for this connection alone. */
  privateKey: string;
  name: string;
  addedAt: number;
}

/** What an application's connection link carries. */
interface ConnectOffer {
  uri: string;
  name: string;
}

const digits = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) throw new Error('The amount is not a whole number of satoshis.');
  return BigInt(value);
};

/** What a request means, in the words the user is asked to agree to. */
const describe = (entry: LedgerEntry, wallet: OwnerWallet): string => {
  const { operation, parameters } = entry;
  try {
    if (operation === 'open') {
      const unlockTime = parameters['unlockTime'];
      if (typeof unlockTime !== 'number') throw new Error();
      const label = typeof parameters['label'] === 'string' ? ` named "${parameters['label'].slice(0, 40)}"` : '';
      return `Put ${formatSatoshis(digits(parameters['satoshis']))} sat from your wallet into a savings jar${label}. It cannot be spent before ${formatTime(unlockTime)}.`;
    }
    if (operation === 'empty') {
      const jar = wallet.current.positions.find((item) => item.position.positionId === parameters['positionId']);
      if (jar === undefined) throw new Error();
      return `Empty the savings jar "${jar.position.label ?? 'Savings jar'}" (${formatSatoshis(jar.held)} sat) into your wallet.`;
    }
  } catch {
    // Described as unreadable below.
  }
  return 'Something this wallet cannot describe. It is safest to decline.';
};

/** Applications connected to the wallet, and what they ask for. */
export const Apps = ({ session, wallet, onChanged }: { session: Session; wallet: OwnerWallet; onChanged: () => Promise<void> }) => {
  const task = useTask();
  const [connections, setConnections] = useState<Connection[]>(session.vault.get<Connection[]>('connections') ?? []);
  const [statuses, setStatuses] = useState<Record<string, LinkStatus>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [code, setCode] = useState(session.incoming?.kind === 'connect' ? session.incoming.text : '');
  const [offer, setOffer] = useState<ConnectOffer | undefined>();
  const links = useRef(new Map<string, { link: WalletLink; detach: () => void }>());
  const jar = wallet.record.templates.jar;

  const connector = useMemo(
    () =>
      new WalletConnector({
        templates: [{ identifier: jar.identifier, contentHash: jar.contentHash, operations: ['open', 'empty', 'list'] }],
        readOnly: ['list'],
        storage: {
          load: () => session.vault.get<LedgerEntry[]>('requests') ?? [],
          save: (entries) => session.vault.set('requests', entries),
        },
        onProposals: setProposals,
        execute: async (entry, stage) => {
          const { operation, parameters } = entry;
          if (operation === 'list') {
            const view = await wallet.refresh();
            return {
              positions: view.positions
                .filter((item) => item.status !== 'closed')
                .map((item) => ({
                  positionId: item.position.positionId,
                  label: item.position.label ?? 'Savings jar',
                  unlockTime: item.unlockTime ?? 0,
                  satoshis: item.held.toString(),
                  status: item.status,
                })),
            };
          }
          if (operation === 'open') {
            const unlockTime = parameters['unlockTime'];
            if (typeof unlockTime !== 'number' || !Number.isInteger(unlockTime) || unlockTime <= Date.now() / 1000) throw new Error('The unlock time is not in the future.');
            const label = typeof parameters['label'] === 'string' && parameters['label'].trim() !== '' ? parameters['label'].trim().slice(0, 40) : 'Savings jar';
            const sent = await wallet.openJar(digits(parameters['satoshis']), unlockTime, label, () => stage('recorded'));
            stage('sent');
            await onChanged();
            const opened = wallet.current.positions.find((item) => item.transactionId === sent.transactionId);
            return { transactionId: sent.transactionId, positionId: opened?.position.positionId ?? '', unlockTime, label };
          }
          if (operation === 'empty') {
            const sent = await wallet.emptyJar(String(parameters['positionId']));
            stage('sent');
            await onChanged();
            return { transactionId: sent.transactionId };
          }
          throw new Error('This wallet does not know that operation.');
        },
      }),
    [],
  );

  const open = (connection: Connection) => {
    if (links.current.has(connection.id)) return;
    const link = openWalletLink({
      uri: connection.uri,
      privateKey: connection.privateKey,
      name: 'Grandma\'s Wallet',
      offered: {
        version: XO_EXTENSION_VERSION,
        network: wallet.record.network,
        interfaceVersion: 2,
        templates: [{ identifier: jar.identifier, contentHash: jar.contentHash, operations: ['open', 'empty', 'list'] }],
      },
      onStatus: (status) => setStatuses((known) => ({ ...known, [connection.id]: status })),
    });
    links.current.set(connection.id, { link, detach: connector.attach(connection.id, link.channel) });
  };

  useEffect(() => {
    connections.forEach(open);
    return () => {
      for (const { link, detach } of links.current.values()) {
        detach();
        link.close();
      }
      links.current.clear();
    };
  }, []);

  const save = (next: Connection[]) => {
    session.vault.set('connections', next);
    setConnections(next);
  };

  const read = (text: string) =>
    task.run('read', async () => {
      const trimmed = text.trim();
      const found = trimmed.toLowerCase().startsWith('wiz://') ? { uri: trimmed, name: 'An application' } : await readLink<ConnectOffer>(trimmed, 'connect');
      if (found === undefined || typeof found.uri !== 'string' || !found.uri.toLowerCase().startsWith('wiz://')) {
        throw new Error('That is not a connection link from an application.');
      }
      setOffer({ uri: found.uri, name: String(found.name ?? 'An application').slice(0, 60) });
    });
  useEffect(() => {
    if (code !== '') void read(code);
  }, []);

  const connect = () => {
    if (offer === undefined) return;
    const connection: Connection = { id: newLinkKey().slice(0, 16), uri: offer.uri, privateKey: newLinkKey(), name: offer.name, addedAt: Math.floor(Date.now() / 1000) };
    save([...connections.filter((known) => known.uri !== offer.uri), connection]);
    open(connection);
    setOffer(undefined);
    setCode('');
    takeIncoming(session);
  };

  const disconnect = (connection: Connection) => {
    const known = links.current.get(connection.id);
    known?.detach();
    known?.link.close();
    links.current.delete(connection.id);
    save(connections.filter((item) => item.id !== connection.id));
  };

  const decide = (proposal: Proposal, agree: boolean) =>
    task.run(`decide-${proposal.entry.id}`, async (progress) => {
      progress(agree ? 'Carrying it out' : 'Declining');
      await (agree ? proposal.approve() : proposal.decline());
    });

  return (
    <>
      {proposals.map((proposal) => (
        <Card tone="warn">
          <h2>A connected application asks for your approval</h2>
          <p>
            <strong>{describe(proposal.entry, wallet)}</strong>
          </p>
          <p class="small muted">Asked {formatTime(proposal.entry.receivedAt)}. Nothing happens unless you approve.</p>
          <div class="row">
            <Button task={task} name={`decide-${proposal.entry.id}`} onClick={() => void decide(proposal, true)}>
              Approve
            </Button>
            <Button task={task} kind="secondary" onClick={() => void decide(proposal, false)}>
              Decline
            </Button>
          </div>
        </Card>
      ))}
      <Card>
        <h2>Connected applications</h2>
        {connections.length === 0 ? (
          <p class="muted">None. An application can ask this wallet to do things; you approve each one here.</p>
        ) : (
          <ul class="list">
            {connections.map((connection) => {
              const status = statuses[connection.id];
              return (
                <li>
                  <div class="row spread">
                    <div>
                      <strong>{status?.peerName ?? connection.name}</strong>{' '}
                      <span class={`pill ${status?.state === 'connected' ? 'ok' : ''}`}>{status?.state === 'connected' ? 'connected' : status?.state === 'waiting' ? 'waiting for the application' : (status?.state ?? 'connecting')}</span>
                      <div class="small muted">Connected {formatTime(connection.addedAt)}</div>
                    </div>
                    <Button kind="quiet" onClick={() => disconnect(connection)}>
                      Disconnect
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {offer === undefined ? (
          <>
            <Field label="Connection link from an application">
              <TextArea value={code} onInput={setCode} placeholder="https://…#connect=…  or  wiz://…" />
            </Field>
            <Button task={task} name="read" kind="secondary" onClick={() => void read(code)} disabled={code.trim() === ''}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <p class="notice">
              Connect to <strong>{offer.name}</strong>? It will be able to see your savings jars and ask this wallet to open or empty one. You approve each request.
            </p>
            <div class="row">
              <Button onClick={connect}>Connect</Button>
              <Button
                kind="secondary"
                onClick={() => {
                  setOffer(undefined);
                  takeIncoming(session);
                }}
              >
                Not now
              </Button>
            </div>
          </>
        )}
        <TaskStatus task={task} />
      </Card>
    </>
  );
};
