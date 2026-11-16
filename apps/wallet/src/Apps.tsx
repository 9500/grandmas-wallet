import { type ActionPreview, type ApplicationAction, type OwnerWallet, type WalletView, NotYetValidError, inspectTemplate, readLink } from '@grandmas-wallet/app';
import { type LedgerEntry, type Proposal, WalletConnector, XO_EXTENSION_VERSION } from '@grandmas-wallet/connect';
import { type LinkStatus, type WalletLink, newLinkKey, openWalletLink } from '@grandmas-wallet/connect/wizard';
import { Button, Card, Field, Spinner, TaskStatus, TextArea, formatTime, useTask } from '@grandmas-wallet/ui';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { ActionView, TemplateCard } from './ActionView.js';
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

/** A request as the wallet's own action: the template's action, the values, and what the wallet is to fill in. */
const actionOf = (entry: LedgerEntry): ApplicationAction => {
  const bindings: Record<string, 'identity'> = {};
  for (const [name, source] of Object.entries(entry.bindings ?? {})) {
    if (source !== 'identity') throw new Error(`The application asks this wallet to fill in "${source}", which it does not have.`);
    bindings[name] = 'identity';
  }
  return {
    template: entry.template.identifier,
    action: entry.templateAction,
    role: entry.role,
    variables: entry.variables,
    bindings,
    ...(entry.position === undefined ? {} : { positionId: entry.position }),
    ...(entry.label === undefined ? {} : { label: entry.label }),
  };
};

/**
 * One request waiting for the user. A template the wallet has not seen is shown first, for the user to
 * trust and remember or not; then the action, in the template's words and the wallet's own figures.
 */
const Request = ({ proposal, wallet, view, from, onChanged }: { proposal: Proposal; wallet: OwnerWallet; view: WalletView; from: string; onChanged: () => void }) => {
  const task = useTask();
  const { entry } = proposal;
  const [trusted, setTrusted] = useState(wallet.trustedTemplates.some((template) => template.identifier === entry.template.identifier));
  const [preview, setPreview] = useState<ActionPreview | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const summary = useMemo(() => {
    try {
      return entry.definition === undefined ? undefined : inspectTemplate(entry.definition);
    } catch {
      return undefined;
    }
  }, [entry.id]);

  useEffect(() => {
    if (!trusted) return;
    setProblem(undefined);
    wallet.previewAction(actionOf(entry)).then(setPreview, (error: Error) => setProblem(error.message));
  }, [trusted, entry.id]);

  const trust = () =>
    task.run('trust', async (progress) => {
      progress('Saving the template to the backup');
      await wallet.trustTemplate(entry.definition);
      setTrusted(true);
      onChanged();
    });
  const decide = (agree: boolean) =>
    task.run(agree ? 'approve' : 'decline', async (progress) => {
      progress(agree ? 'Carrying it out' : 'Declining');
      await (agree ? proposal.approve() : proposal.decline());
    });

  return (
    <Card tone="warn">
      <h2>{from} asks for your approval</h2>
      {!trusted ? (
        <>
          <p>It uses a template this wallet has not seen before:</p>
          {summary === undefined ? <p class="notice error">The template cannot be read. It is safest to decline.</p> : <TemplateCard summary={summary} />}
          <div class="row">
            <Button task={task} name="trust" onClick={() => void trust()} disabled={summary === undefined}>
              Trust and remember this template
            </Button>
            <Button task={task} name="decline" kind="secondary" onClick={() => void decide(false)}>
              Decline
            </Button>
          </div>
        </>
      ) : (
        <>
          {problem !== undefined ? (
            <p class="notice error">This cannot be carried out: {problem}</p>
          ) : preview === undefined ? (
            <p>
              <Spinner /> Working out what this would do…
            </p>
          ) : (
            <ActionView preview={preview} identity={view.identity} />
          )}
          <div class="row">
            <Button task={task} name="approve" onClick={() => void decide(true)} disabled={preview === undefined}>
              Approve
            </Button>
            <Button task={task} name="decline" kind="secondary" onClick={() => void decide(false)}>
              Decline
            </Button>
          </div>
        </>
      )}
      <p class="small muted">Asked {formatTime(entry.receivedAt)}. Nothing happens unless you approve.</p>
      <TaskStatus task={task} />
    </Card>
  );
};

/** Applications connected to the wallet, and what they ask for. */
export const Apps = ({ session, wallet, view, onChanged }: { session: Session; wallet: OwnerWallet; view: WalletView; onChanged: () => Promise<void> }) => {
  const task = useTask();
  const [connections, setConnections] = useState<Connection[]>(session.vault.get<Connection[]>('connections') ?? []);
  const [statuses, setStatuses] = useState<Record<string, LinkStatus>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [code, setCode] = useState(session.incoming?.kind === 'connect' ? session.incoming.text : '');
  const [offer, setOffer] = useState<ConnectOffer | undefined>();
  const links = useRef(new Map<string, { link: WalletLink; detach: () => void }>());
  const [, setTrustChanged] = useState(0);
  const trustedNames = () => wallet.trustedTemplates.map(({ identifier, contentHash }) => ({ identifier, contentHash }));

  const connector = useMemo(
    () =>
      new WalletConnector({
        trusted: trustedNames,
        identify: (definition) => {
          const { identifier, contentHash } = inspectTemplate(definition);
          return { identifier, contentHash };
        },
        storage: {
          load: () => session.vault.get<LedgerEntry[]>('requests') ?? [],
          save: (entries) => session.vault.set('requests', entries),
        },
        onProposals: setProposals,
        // An application is told of the positions made with its own template, and of no others.
        positions: async (template) =>
          (await wallet.refresh()).positions
            .filter((item) => item.position.template?.identifier === template && item.status !== 'closed' && item.held > 0n)
            .map((item) => ({
              position: item.position.positionId,
              label: item.position.label ?? '',
              output: item.position.origin?.output ?? '',
              variables: item.position.parameters,
              satoshis: item.held.toString(),
            })),
        execute: async (entry, stage) => {
          if (!wallet.trustedTemplates.some((template) => template.identifier === entry.template.identifier)) throw new Error('The template was not trusted.');
          try {
            const sent = await wallet.runAction(actionOf(entry), () => stage('recorded'));
            stage('sent');
            await onChanged();
            return { transactionId: sent.transactionId, positions: sent.positions };
          } catch (error) {
            if (error instanceof NotYetValidError) throw new Error('The network does not accept this yet: its clock runs some minutes behind. Please try again shortly.', { cause: error });
            throw error;
          }
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
      offered: { version: XO_EXTENSION_VERSION, network: wallet.record.network, interfaceVersion: 2, bindings: ['identity'], templates: trustedNames() },
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

  const fromOf = (proposal: Proposal): string => {
    const connection = connections.find((item) => connector.cameFrom(proposal.entry.id) === item.id);
    return connection === undefined ? 'A connected application' : (statuses[connection.id]?.peerName ?? connection.name);
  };

  return (
    <>
      {proposals.map((proposal) => (
        <Request key={proposal.entry.id} proposal={proposal} wallet={wallet} view={view} from={fromOf(proposal)} onChanged={() => setTrustChanged((count) => count + 1)} />
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
              Connect to <strong>{offer.name}</strong>? It will be able to ask this wallet to carry out actions of its own template, and to see what this wallet holds under that template. You approve each request.
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
