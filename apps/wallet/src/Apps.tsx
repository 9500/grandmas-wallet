import { binToHex } from '@bitauth/libauth';
import { type ActionOutcome, type ActionPreview, type ApplicationAction, type HeldToken, type TemplateSummary, type TokenAction, NotStoredError, WALLET_TEMPLATES, actionOf } from '@grandmas-wallet/app';
import { readLink } from '@grandmas-wallet/app/links';
import type { LedgerEntry, Offer, Proposal } from '@grandmas-wallet/connect';
import { Amount, Button, Card, Field, Info, KeyValues, Loading, Notice, PageHead, Pill, Spinner, TaskStatus, TextInput, Value, formatTime, lockingBytecodeOfAddress, useTask } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

import { ActionReview, Hex, Part, TemplateView, TypedValue, plainRefusal, refusalOf } from './ActionReview.js';
import { type ApplicationsPart, type PositionsAsk, relayOf } from './connections.js';
import type { Owner } from './OwnerApp.js';
import { CONNECTION_ADDRESS } from './scan.js';
import { CameraIcon, ScanDialog } from './Scanner.js';
import { chooseToken } from './token-choice.js';
import { type Connection, keep, kept } from './session.js';
import { NameSource, TokenAmount, TokenNamesContext } from './token-words.js';
import './apps.css';

/**
 * Applications (proposal sections 12 to 14): connecting to an application, deciding what it asks, and the
 * tokens the wallet holds with what they control. Nothing on this screen names an application: what it
 * shows about one comes from the application's template, and its name for itself is marked as unverified.
 */

type View = { at: 'main' } | { at: 'act'; token: HeldToken; action: TokenAction } | { at: 'trust'; identifier: string } | { at: 'template'; identifier: string };

/** Requests the user decided while the page has been open: their outcome stays on the screen until dismissed. */
const followed = new Set<string>();
const keyOf = (entry: Pick<LedgerEntry, 'application' | 'id'>): string => `${entry.application}/${entry.id}`;

/** What an earlier owner left in the backup is read once per page load. */
let backupRead = false;

export const Apps = ({ owner }: { owner: Owner }) => {
  const [view, setView] = useState<View>({ at: 'main' });
  const { apps } = owner;
  useEffect(() => {
    if (backupRead) return;
    backupRead = true;
    // A backup that cannot be read now is no reason for alarm here: the tokens are listed all the same, and it is
    // read again the next time this screen is opened.
    apps.applications.readBackup().then(apps.changed, (error: unknown) => {
      backupRead = false;
      console.warn(error);
    });
  }, []);
  const back = () => {
    setView({ at: 'main' });
    window.scrollTo(0, 0);
  };
  // What the templates the user trusts call the tokens, for every figure on this screen.
  const names = useMemo(() => apps.applications.names(), [apps.version]);
  return (
    <TokenNamesContext.Provider value={names}>
      {view.at === 'act' ? (
        <ActOnToken owner={owner} token={view.token} action={view.action} onBack={back} />
      ) : view.at === 'trust' ? (
        <TrustSuggested owner={owner} identifier={view.identifier} onBack={back} />
      ) : view.at === 'template' ? (
        <TemplatePage owner={owner} identifier={view.identifier} onBack={back} />
      ) : (
        <Main owner={owner} onView={(next) => { setView(next); window.scrollTo(0, 0); }} />
      )}
    </TokenNamesContext.Provider>
  );
};

const Main = ({ owner, onView }: { owner: Owner; onView: (view: View) => void }) => {
  const { apps } = owner;
  const [, setDismissed] = useState(0);
  // The open requests, and those decided here whose outcome has not been dismissed, oldest first.
  const shown = apps.connector.ledger.filter((entry) => entry.status === 'asked' || followed.has(keyOf(entry))).sort((a, b) => a.receivedAt - b.receivedAt);
  const proposalOf = (entry: LedgerEntry): Proposal | undefined => apps.proposals.find((proposal) => proposal.entry === entry || keyOf(proposal.entry) === keyOf(entry));
  return (
    <div class="stack">
      <PageHead title="Applications" />
      <div class="grid two apps-layout">
        <div class="stack">
          {shown.map((entry) => (
            <RequestCard
              key={keyOf(entry)}
              owner={owner}
              entry={entry}
              proposal={proposalOf(entry)}
              onDismiss={() => {
                followed.delete(keyOf(entry));
                setDismissed((count) => count + 1);
              }}
            />
          ))}
          {apps.asks.map((ask) => (
            <AskCard key={`${ask.application}/${ask.template.identifier}`} owner={owner} ask={ask} />
          ))}
          {apps.offers.map((offer) => (
            <OfferCard key={`${offer.application}/${offer.template.identifier}/${offer.template.contentHash}`} owner={owner} offer={offer} />
          ))}
          <Tokens owner={owner} onView={onView} />
        </div>
        <div class="stack">
          <Connect owner={owner} />
          <Connected owner={owner} />
          <Templates owner={owner} onView={onView} />
          <EarlierRequests owner={owner} />
        </div>
      </div>
    </div>
  );
};

/** A card's title with its explanation behind a "?", and what goes on the other side. */
const TitleInfo = ({ title, label, info, aside }: { title: string; label: string; info: ComponentChildren; aside?: ComponentChildren }) => (
  <div class="card-head">
    <h2 class="title-info">
      {title}
      <Info label={label}>{info}</Info>
    </h2>
    {aside}
  </div>
);

// ------------------------------------------------------------------ connecting

const STATES: Record<string, { label: string; tone?: 'good' | 'warn' | 'accent' }> = {
  connecting: { label: 'Connecting' },
  waiting: { label: 'Waiting for the application', tone: 'accent' },
  connected: { label: 'Connected', tone: 'good' },
  disconnected: { label: 'Not connected', tone: 'warn' },
};

/** The application's own name for itself, as far as the wallet knows it. */
export const nameOf = (apps: ApplicationsPart, pairing: string): string | undefined => apps.statuses[pairing]?.peerName ?? apps.connections.find((connection) => connection.pairing === pairing)?.name;

/**
 * Connecting: the application's code scanned, or its link pasted. A page opened from an application's connection
 * link shows the link, and connects only when the user says so.
 */
const Connect = ({ owner }: { owner: Owner }) => {
  const { apps } = owner;
  const incoming = kept('incoming');
  const fromLink = incoming?.kind === 'connect';
  const [text, setText] = useState(fromLink ? incoming.text : '');
  const [linked, setLinked] = useState(fromLink);
  const [pasting, setPasting] = useState(fromLink);
  const [scanning, setScanning] = useState(false);
  const task = useTask();

  const connect = (value: string) =>
    task.run('connect', async () => {
      const trimmed = value.trim();
      let offer: { uri: string; name?: string } | undefined;
      if (/^wiz:/i.test(trimmed)) offer = { uri: trimmed };
      else {
        const read = await readLink<{ uri?: unknown; name?: unknown }>(trimmed, 'connect').catch(() => undefined);
        if (typeof read?.uri === 'string' && /^wiz:/i.test(read.uri)) offer = { uri: read.uri, ...(typeof read.name === 'string' ? { name: read.name } : {}) };
      }
      if (offer === undefined) throw new Error('This is not an application\'s connection link. It begins with "wiz://".');
      try {
        apps.connect(offer.uri, offer.name);
      } catch (error) {
        throw new Error(`The link cannot be used: ${(error as Error).message}`, { cause: error });
      }
      if (fromLink) keep('incoming', undefined);
      setLinked(false);
      setPasting(false);
      setText('');
      owner.toast('Connecting to the application.');
    });

  // A scanned code connects at once; if it cannot be used, it stays in the field with the reason.
  const scanned = (value: string) => {
    setText(value);
    setPasting(true);
    void connect(value);
  };

  return (
    <Card cls="connect-card">
      <TitleInfo
        title="Connect an app"
        label="About connecting an app"
        info={
          <>
            <span>The app shows a code, or a link starting with wiz://, when you choose to connect a wallet. Scan the code, paste the link, or open the app's link on this phone.</span>
            <span>A connected app can ask this wallet to carry out actions of its template. Each one waits for your approval here. It learns the addresses in its own transactions and nothing else about the wallet.</span>
          </>
        }
      />
      {linked && (
        <Notice tone="wait">
          You opened an application's connection link. Connect only if you meant to; nothing is asked or sent until you connect.
        </Notice>
      )}
      {pasting ? (
        <>
          <Field label="Connection link" id="connect-address" error={task.error?.message}>
            <TextInput id="connect-address" value={text} onInput={setText} placeholder="wiz://…" invalid={task.error !== undefined} />
          </Field>
          <div class="actions">
            <Button task={task} name="connect" disabled={text.trim() === ''} onClick={() => void connect(text)}>
              Connect
            </Button>
            {linked ? (
              <Button
                kind="quiet"
                onClick={() => {
                  keep('incoming', undefined);
                  setLinked(false);
                  setPasting(false);
                  setText('');
                }}
              >
                Not now
              </Button>
            ) : (
              <Button kind="quiet" onClick={() => setPasting(false)}>
                Scan instead
              </Button>
            )}
          </div>
        </>
      ) : (
        <div class="connect-ways">
          <Button block onClick={() => setScanning(true)}>
            <CameraIcon /> Scan the app's code
          </Button>
          <Button kind="link" onClick={() => setPasting(true)}>
            Paste a link instead
          </Button>
        </div>
      )}
      {scanning && <ScanDialog filter={CONNECTION_ADDRESS} onScan={scanned} onClose={() => setScanning(false)} />}
    </Card>
  );
};

/** The applications this wallet is connected to; nothing while there are none. */
const Connected = ({ owner }: { owner: Owner }) => {
  const { apps } = owner;
  if (apps.connections.length === 0) return null;
  return (
    <Card title="Connected apps" cls="connected-card">
      <ul class="list connections">
        {apps.connections.map((connection) => (
          <ConnectionRow owner={owner} connection={connection} />
        ))}
      </ul>
    </Card>
  );
};

const ConnectionRow = ({ owner, connection }: { owner: Owner; connection: Connection }) => {
  const { apps } = owner;
  const status = apps.statuses[connection.pairing];
  const state = STATES[status?.state ?? 'connecting'] ?? { label: status?.state ?? '' };
  const name = nameOf(apps, connection.pairing);
  return (
    <li>
      <div class="list-item connection">
        <div>
          <div class="connection-name">{name ?? 'An application'}</div>
          <div class="small muted">
            {name !== undefined && 'Its own name, not verified · '}
            through {relayOf(connection.uri)} · since {formatTime(connection.addedAt)}
          </div>
        </div>
        <Pill {...(state.tone === undefined ? {} : { tone: state.tone })}>
          {status?.state === 'connecting' || status === undefined ? <Spinner /> : null}
          {state.label}
        </Pill>
      </div>
      {status?.reason !== undefined && <p class="small muted connection-reason">{status.reason}</p>}
      <div class="row connection-actions">
        {status?.state === 'disconnected' && (
          <Button small kind="secondary" onClick={() => apps.retry(connection.pairing)}>
            Connect again
          </Button>
        )}
        <Button small kind="quiet" onClick={() => apps.end(connection.pairing)}>
          End the connection
        </Button>
      </div>
    </li>
  );
};

// ------------------------------------------------------------------ a request

/** The transaction an action sent, with the explorer link the other screens use. */
const Transaction = ({ id, explorer }: { id: string; explorer: string }) => (
  <div class="stack-s">
    <span class="small muted">Transaction</span>
    <Value text={id} copyLabel="Copy" testId="action-transaction" />
    {explorer !== '' && (
      <a class="small" href={`${explorer}${id}`} target="_blank" rel="noopener noreferrer">
        See it in a block explorer
      </a>
    )}
  </div>
);

/** Without a backup store, a new template cannot be taken in: the way to set one up. */
const NoBackup = ({ owner, children }: { owner: Owner; children: ComponentChildren }) => (
  <Notice tone="warn">
    <div class="stack-s">
      <div>{children}</div>
      <Button small kind="secondary" onClick={() => owner.navigate('recovery')}>
        Go to Recovery
      </Button>
    </div>
  </Notice>
);

const needsBackup = (preview: ActionPreview | undefined): boolean => preview?.firstUse === true && kept('arrangement') === undefined;

const RequestCard = ({ owner, entry, proposal, onDismiss }: { owner: Owner; entry: LedgerEntry; proposal: Proposal | undefined; onDismiss: () => void }) => {
  const { apps } = owner;
  const { applications } = apps;
  const task = useTask();
  const [summary, unusable] = useMemo((): [TemplateSummary | undefined, string | undefined] => {
    try {
      return [applications.describe(entry.template, entry.definition), undefined];
    } catch (error) {
      return [undefined, refusalOf(error)];
    }
  }, [keyOf(entry)]);
  const [preview, setPreview] = useState<ActionPreview | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>(unusable);
  const [notStored, setNotStored] = useState(false);
  useEffect(() => {
    if (entry.status !== 'asked' || summary === undefined) return;
    applications.preview(actionOf(entry)).then(setPreview, (error: unknown) => setRefusal(refusalOf(error)));
  }, [keyOf(entry)]);

  const name = nameOf(apps, entry.application);
  const asker = (withName: boolean) => (
    <div class="asker">
      {withName && (
        <span>
          From <strong>{name ?? 'a connected application'}</strong>
        </span>
      )}
      {name !== undefined && <Pill>Its own name, not verified</Pill>}
      <span class="small muted">Asked {formatTime(entry.receivedAt)}</span>
    </div>
  );
  const actionName = preview?.words.action.name ?? summary?.actions.find((action) => action.action === entry.templateAction)?.name ?? entry.templateAction;

  const decide = (agree: boolean) =>
    task.run(agree ? 'approve' : 'decline', async (progress) => {
      if (proposal === undefined) return;
      followed.add(keyOf(entry));
      if (!agree) {
        await proposal.decline();
        apps.changed();
        return;
      }
      progress(preview?.firstUse === true ? 'Storing the template in your backup' : 'Checking the action again');
      const stop = applications.watch((stage) => progress(stage === 'recorded' ? 'Signing and sending' : 'Sent. Finishing'));
      try {
        await proposal.approve();
      } finally {
        stop();
      }
      setNotStored(applications.lastError instanceof NotStoredError);
      apps.changed();
    });

  if (entry.status === 'done' || entry.status === 'failed' || entry.status === 'declined') {
    const transactionId = typeof entry.result?.['transactionId'] === 'string' ? entry.result['transactionId'] : undefined;
    return (
      <Card title={`${entry.status === 'done' ? 'Done' : entry.status === 'failed' ? 'Not carried out' : 'Declined'}: ${actionName}`} tone={entry.status === 'done' ? 'good' : entry.status === 'failed' ? 'bad' : undefined} cls="request-card">
        <div class="stack">
          {asker(true)}
          {entry.status === 'done' && (
            <>
              <p>The transaction was sent, and the application was told.</p>
              {transactionId !== undefined && <Transaction id={transactionId} explorer={owner.session.environment.explorer} />}
            </>
          )}
          {entry.status === 'failed' && (
            <>
              <p class="failure">{entry.error === undefined ? 'The wallet did not say why.' : plainRefusal(entry.error)}</p>
              {notStored && <NoBackup owner={owner}>A template is stored in your backup before its first action, and this wallet has no backup store it could reach. Set up recovery, then ask the application again.</NoBackup>}
              <p class="small muted">The application was told. Nothing was signed unless a transaction is named above.</p>
            </>
          )}
          {entry.status === 'declined' && <p>You declined. The application was told; nothing was signed.</p>}
          <div class="actions">
            <Button kind="quiet" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const blocked = summary === undefined || refusal !== undefined || preview === undefined || needsBackup(preview) || (summary.verdict.statement === 'violation' && !summary.trusted);
  return (
    <Card title={`${name ?? 'An application'} asks for your decision`} cls="request-card" id={`request-${entry.id}`}>
      <div class="stack">
        {asker(false)}
        {summary === undefined ? (
          <Notice tone="bad">The template sent with this request cannot be used: {unusable}</Notice>
        ) : preview !== undefined ? (
          <ActionReview preview={preview} summary={summary} />
        ) : (
          <>
            <Part title="Template">
              <TemplateView summary={summary} showActions={!summary.trusted} />
            </Part>
            {refusal === undefined ? <Loading>Working out what this would do…</Loading> : null}
          </>
        )}
        {summary !== undefined && refusal !== undefined && (
          <Notice tone="bad">
            <div class="stack-s">
              <strong>This wallet would not carry it out.</strong>
              <span class="failure">{refusal}</span>
            </div>
          </Notice>
        )}
        {summary?.verdict.statement === 'violation' && !summary.trusted && <Notice tone="bad">This wallet does not take in a template with a violation. You can only decline.</Notice>}
        {needsBackup(preview) && <NoBackup owner={owner}>This wallet has no backup store yet. A template is stored there before its first action, so that a new phone can operate what is made with it. Set up recovery first.</NoBackup>}
        <TaskStatus task={task} />
        <div class="actions decide">
          {!blocked && (
            <Button task={task} name="approve" disabled={entry.status !== 'asked'} onClick={() => void decide(true)}>
              Approve
            </Button>
          )}
          <Button task={task} name="decline" kind={blocked ? 'secondary' : 'quiet'} disabled={entry.status !== 'asked'} onClick={() => void decide(false)}>
            Decline
          </Button>
        </div>
        <p class="small muted">Nothing is signed or sent unless you approve.</p>
      </div>
    </Card>
  );
};

/** An application asks about the tokens of a template the user trusts, but not in a session with it. */
const AskCard = ({ owner, ask }: { owner: Owner; ask: PositionsAsk }) => {
  const { apps } = owner;
  const name = nameOf(apps, ask.application);
  return (
    <Card title={`${name ?? 'An application'} asks to see your tokens`} cls="request-card">
      <div class="stack">
        <div class="asker">
          {name !== undefined && <Pill>Its own name, not verified</Pill>}
          <span class="small muted">Asked {formatTime(ask.askedAt)}</span>
        </div>
        <p>
          It asks which tokens of the template <strong>{ask.template.name}</strong> this wallet holds, and what they control. You trust this template on this phone, but not in a session with this application, so it was told nothing.
        </p>
        <p class="small muted">If you allow it, the application is told this whenever it asks: the tokens of this template and where their positions stand on chain. It learns nothing else about the wallet, and it can ask for actions only with your approval, as before.</p>
        <div class="actions decide">
          <Button onClick={() => apps.answerAsk(ask, true)}>Allow</Button>
          <Button kind="quiet" onClick={() => apps.answerAsk(ask, false)}>
            Not now
          </Button>
        </div>
      </div>
    </Card>
  );
};

/** An application presents its template without asking for an action: the template, and the user's word on it. */
const OfferCard = ({ owner, offer }: { owner: Owner; offer: Offer }) => {
  const { apps } = owner;
  const name = nameOf(apps, offer.application);
  const task = useTask();
  const [summary, unusable] = useMemo((): [TemplateSummary | undefined, string | undefined] => {
    try {
      return [apps.applications.describe(offer.template, offer.definition), undefined];
    } catch (error) {
      return [undefined, refusalOf(error)];
    }
  }, [apps.version]);
  const violation = summary?.verdict.statement === 'violation';
  const trust = () =>
    task.run('trust', async () => {
      await offer.accept();
      apps.changed();
      owner.toast('The template is trusted on this phone.');
    });
  return (
    <Card title={`${name ?? 'An application'} offers its template`} cls="request-card offer-card">
      <div class="stack">
        <div class="asker">
          {name !== undefined && <Pill>Its own name, not verified</Pill>}
          <span class="small muted">Offered {formatTime(offer.receivedAt)}</span>
        </div>
        {summary === undefined ? (
          <Notice tone="bad">The template cannot be used: {unusable}</Notice>
        ) : (
          <Part title="Template" info="If you trust it, this wallet shows what your tokens of this template control, tells this application which of them you hold, and can carry out the template's actions. Each action still waits for your approval.">
            <TemplateView summary={summary} showActions={!summary.trusted} />
          </Part>
        )}
        {violation && <Notice tone="bad">This wallet does not take in a template with a violation. You can only decline.</Notice>}
        <TaskStatus task={task} name="trust" />
        <div class="actions decide">
          {summary !== undefined && !violation && (
            <Button task={task} name="trust" onClick={() => void trust()}>
              {summary.trusted ? 'Allow' : 'Trust this template'}
            </Button>
          )}
          <Button kind="quiet" disabled={task.busy !== undefined} onClick={() => void offer.decline()}>
            Decline
          </Button>
        </div>
      </div>
    </Card>
  );
};

/**
 * The templates this wallet works with: those the user trusts, those the backup holds and this phone does not
 * trust, and the wallet's own.
 */
const Templates = ({ owner, onView }: { owner: Owner; onView: (view: View) => void }) => {
  const { applications } = owner.apps;
  const trusted = applications.templates;
  const others = applications.suggestions;
  const own = Object.values(WALLET_TEMPLATES);
  return (
    <Card cls="templates-card">
      <TitleInfo
        title="Templates"
        label="About templates"
        info="A template tells this wallet what an app's tokens control and how to carry out its actions. You trust one when you approve an app's first action, or when an app offers it to you."
      />
      {trusted.length === 0 && others.length === 0 ? (
        <p class="templates-none">None yet.</p>
      ) : (
        <ul class="list templates">
          {trusted.map((template) => (
            <li>
              <button type="button" class="template-row" data-testid="template-row" onClick={() => onView({ at: 'template', identifier: template.identifier })}>
                <span>
                  <span class="template-row-name">{template.name}</span>
                  <span class="small muted">{template.stored ? 'Trusted · in your backup' : 'Trusted · not in your backup yet'}</span>
                </span>
                <span class="template-row-go" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
          {others.map((template) => (
            <li>
              <button type="button" class="template-row" data-testid="template-row-untrusted" onClick={() => onView({ at: 'trust', identifier: template.identifier })}>
                <span>
                  <span class="template-row-name">{template.name}</span>
                  <span class="small muted">{template.withdrawn !== undefined ? 'Not trusted · you stopped trusting it' : 'Not trusted · from an earlier owner'}</span>
                </span>
                <span class="template-row-go" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <details class="more templates-own">
        <summary>Built into this wallet ({own.length})</summary>
        <ul class="list">
          {own.map((template) => (
            <li>
              <div>{template.name}</div>
              {template.description !== undefined && template.description !== '' && <div class="small muted">{template.description}</div>}
            </li>
          ))}
        </ul>
        <p class="small muted">The wallet's own templates. They cannot be removed.</p>
      </details>
    </Card>
  );
};

/** One trusted template: what it is, what depends on it, who may see its tokens, and the way to stop trusting it. */
const TemplatePage = ({ owner, identifier, onBack }: { owner: Owner; identifier: string; onBack: () => void }) => {
  const { apps } = owner;
  const { applications } = apps;
  const kept = applications.templates.find((template) => template.identifier === identifier);
  const task = useTask();
  const [confirming, setConfirming] = useState(false);
  const [tokens, setTokens] = useState<HeldToken[] | undefined>();
  useEffect(() => {
    applications.tokens().then(
      (held) => setTokens(held.filter((token) => token.template?.identifier === identifier && token.meaning !== 'unknown')),
      () => setTokens([]),
    );
  }, []);
  const summary = useMemo((): TemplateSummary | undefined => {
    if (kept === undefined) return undefined;
    try {
      return applications.describe({ identifier: kept.identifier, contentHash: kept.contentHash, ...(kept.declaration === undefined ? {} : { declaration: kept.declaration.contentHash }) });
    } catch {
      return undefined;
    }
  }, [apps.version]);
  if (kept === undefined) {
    return (
      <div class="stack">
        <PageHead title="Template" />
        <Card>
          <div class="stack">
            <p>This phone does not trust that template.</p>
            <div>
              <Button kind="secondary" onClick={onBack}>
                Back
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }
  const tokenName = (token: HeldToken): string => token.names?.nft?.named?.name ?? token.names?.fungible?.named?.name ?? `Token ${token.category.slice(0, 8)}…`;
  const open = (tokens ?? []).filter((token) => token.position?.status === 'open');
  const stop = () =>
    task.run('stop', async () => {
      const { name, backupTold } = await apps.stopTrusting(identifier);
      owner.toast(backupTold ? `"${name}" is no longer trusted.` : `"${name}" is no longer trusted. Your backup will be told when a store can be reached.`);
      onBack();
    });
  return (
    <div class="stack">
      <PageHead title="Template" />
      <div class="grid two">
        <div class="stack">
          <Card cls="request-card">
            <div class="stack">
              {summary !== undefined && <TemplateView summary={summary} showActions />}
              <KeyValues
                entries={[
                  ['Trusted since', formatTime(kept.trustedAt)],
                  ['Backup', kept.stored ? 'Stored' : <span>Not stored yet<Info label="About the backup">A template is stored in your backup before its first action, so that a new phone can operate what was made with it.</Info></span>],
                  ['Your tokens of it', tokens === undefined ? <Spinner /> : tokens.length === 0 ? 'None' : tokens.map(tokenName).join(', ')],
                ]}
              />
              <div>
                <Button kind="quiet" onClick={onBack}>
                  Back
                </Button>
              </div>
            </div>
          </Card>
        </div>
        <div class="stack">
          <Card>
            <TitleInfo title="Apps that see its tokens" label="About apps that see its tokens" info="These apps are told which tokens of this template you hold and where their positions stand, whenever they ask. They learn nothing else, and every action still waits for your approval." />
            {kept.applications.length === 0 ? (
              <p class="templates-none">None.</p>
            ) : (
              <ul class="list">
                {kept.applications.map((application) => {
                  const connected = apps.connections.some((connection) => connection.pairing === application);
                  return (
                    <li>
                      <div class="list-item">
                        <div>
                          <div>{nameOf(apps, application) ?? 'An application'}</div>
                          <div class="small muted">{connected ? 'Connected' : 'No longer connected'}</div>
                        </div>
                        <Button
                          small
                          kind="quiet"
                          onClick={() => {
                            applications.disallow(identifier, application);
                            apps.changed();
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card title="Stop trusting">
            <div class="stack">
              {!confirming ? (
                <div data-testid="template-stop">
                  <Button kind="secondary" onClick={() => setConfirming(true)}>
                    Stop trusting this template
                  </Button>
                </div>
              ) : (
                <>
                  {open.length > 0 && (
                    <Notice tone="warn">
                      You hold {open.length === 1 ? 'a token' : `${open.length} tokens`} of this template with an open position: {open.map(tokenName).join(', ')}. This wallet will no longer show or operate {open.length === 1 ? 'it' : 'them'} until you trust the template again.
                    </Notice>
                  )}
                  <p class="small muted">Your tokens stay in the wallet and still move in a recovery. Your backup keeps the template, so you can trust it again later.</p>
                  <TaskStatus task={task} name="stop" />
                  <div class="actions" data-testid="template-stop-confirm">
                    <Button kind="danger" task={task} name="stop" onClick={() => void stop()}>
                      Stop trusting
                    </Button>
                    <Button kind="quiet" disabled={task.busy !== undefined} onClick={() => setConfirming(false)}>
                      Keep it
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

/** Requests answered before, most recent first. */
const EarlierRequests = ({ owner }: { owner: Owner }) => {
  const { apps } = owner;
  const entries = apps.connector.ledger
    .filter((entry) => entry.status !== 'asked' && entry.status !== 'working' && !followed.has(keyOf(entry)))
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, 6);
  if (entries.length === 0) return null;
  const label = (entry: LedgerEntry): string => apps.applications.describeAction(actionOf(entry)) ?? `The action "${entry.templateAction}" of a template this phone does not keep`;
  return (
    <Card title="Earlier requests" cls="earlier-card">
      <ul class="list">
        {entries.map((entry) => {
          const transactionId = typeof entry.result?.['transactionId'] === 'string' ? entry.result['transactionId'] : undefined;
          const explorer = owner.session.environment.explorer;
          return (
            <li>
              <div class="list-item">
                <div>
                  <div>{label(entry)}</div>
                  <div class="small muted">
                    {nameOf(apps, entry.application) ?? (apps.connections.some((connection) => connection.pairing === entry.application) ? 'An application' : 'A connection since ended')} · {formatTime(entry.receivedAt)}
                    {transactionId !== undefined && (
                      <>
                        {' · '}
                        {explorer === '' ? <Hex value={transactionId} head={6} tail={4} /> : (
                          <a class="mono" href={`${explorer}${transactionId}`} target="_blank" rel="noopener noreferrer">
                            {transactionId.slice(0, 6)}…{transactionId.slice(-4)}
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <Pill {...(entry.status === 'done' ? { tone: 'good' as const } : entry.status === 'failed' ? { tone: 'bad' as const } : {})}>{entry.status === 'done' ? 'Done' : entry.status === 'failed' ? 'Failed' : 'Declined'}</Pill>
              </div>
              {entry.status === 'failed' && entry.error !== undefined && <p class="small muted earlier-error">{plainRefusal(entry.error)}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

// ------------------------------------------------------------------ tokens and positions

const STATUS: Record<string, { label: string; tone?: 'good' | 'warn' }> = {
  open: { label: 'Open', tone: 'good' },
  closed: { label: 'Closed' },
  ambiguous: { label: 'Unclear', tone: 'warn' },
  incomplete: { label: 'Cannot be worked out', tone: 'warn' },
};

const Tokens = ({ owner, onView }: { owner: Owner; onView: (view: View) => void }) => {
  const { apps } = owner;
  const [tokens, setTokens] = useState<HeldToken[] | undefined>();
  const task = useTask();
  const count = owner.balance?.tokens.length;
  const read = () =>
    task.run('read', async () => {
      setTokens(await apps.applications.tokens());
    });
  useEffect(() => {
    void read();
  }, [apps.version, count]);
  return (
    <Card cls="tokens-card">
      <TitleInfo
        title="Tokens"
        label="About the tokens"
        info="Tokens this wallet holds, with what each controls where a template you trust says so. Every token is kept and moves with the wallet in a recovery, whether or not its meaning is known."
        aside={
          tokens !== undefined && tokens.length > 0 && (
            <Button small kind="quiet" task={task} name="read" onClick={() => void read()}>
              Read again
            </Button>
          )
        }
      />
      {tokens === undefined ? (
        task.error === undefined ? (
          <div class="tokens-loading">
            <Spinner /> Reading the tokens and the chain…
          </div>
        ) : (
          <TaskStatus task={task} name="read" />
        )
      ) : tokens.length === 0 ? (
        <p class="tokens-none">No tokens yet.</p>
      ) : (
        <>
          {task.error !== undefined && <TaskStatus task={task} name="read" />}
          <ul class="list tokens">
            {tokens.map((token) => (
              <TokenRow owner={owner} token={token} onView={onView} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
};

/** What a position holds, read from the chain as the template's declaration says, in the template's words. */
export const PositionState = ({ state }: { state: NonNullable<NonNullable<HeldToken['position']>['state']> }) => (
  <div class="position-state">
    <div class="small muted">In the template's words, read from the chain:</div>
    <KeyValues
      entries={state.map((entry) => [
        <>
          {entry.name}
          {entry.description !== '' && <small>{entry.description}</small>}
        </>,
        <TypedValue type={entry.type} value={entry.value} />,
      ])}
    />
  </div>
);

export const TokenRow = ({ owner, token, onView }: { owner: Owner; token: HeldToken; onView: (view: View) => void }) => {
  const status = token.meaning === 'position' ? token.position?.status : token.meaning;
  const shown = status === undefined ? undefined : STATUS[status];
  const suggestion = token.meaning === 'incomplete' && token.template !== undefined ? owner.apps.applications.suggestions.find((candidate) => candidate.identifier === token.template?.identifier) : undefined;
  const position = token.position;
  const usable = token.place === 'address';
  // A name only where a template the user trusts gives one: the NFT's, else the amount's.
  const naming = token.capability === undefined ? token.names?.fungible : token.names?.nft;
  const name = naming?.named?.name;
  const title = name ?? (token.meaning === 'unknown' ? 'A token of unknown meaning' : (token.template?.name ?? 'A token'));
  return (
    <li class="token">
      <div class="token-head">
        <div>
          <div class="token-title">
            {title}
            {name !== undefined && token.meaning !== 'unknown' && token.template !== undefined && <span class="token-of"> · {token.template.name}</span>}
          </div>
          <div class="small muted token-id">
            {token.capability === undefined ? <TokenAmount amount={token.amount} naming={token.names?.fungible} /> : token.capability === 'none' ? 'NFT' : `NFT, ${token.capability}`} · <Hex value={token.category} />
            {token.commitment !== '' && (
              <>
                {' '}
                · <Hex value={token.commitment} head={6} tail={4} />
              </>
            )}
            {token.capability !== undefined && token.amount > 0n && (
              <>
                {' '}
                · with <TokenAmount amount={token.amount} naming={token.names?.fungible} />
              </>
            )}
          </div>
          {naming !== undefined && <NameSource naming={naming} />}
        </div>
        {shown !== undefined && <Pill {...(shown.tone === undefined ? {} : { tone: shown.tone })}>{shown.label}</Pill>}
      </div>

      {token.meaning === 'position' && position !== undefined && (
        <div class="token-body">
          {position.status === 'open' && (
            <p>
              Holds <Amount satoshis={position.satoshis} exact />
              {position.coins > 1 && <span class="muted"> in {position.coins} coins</span>}
            </p>
          )}
          {position.status === 'closed' && <p>It holds nothing now.</p>}
          {position.status === 'ambiguous' && <p>The wallet cannot tell which coin on the chain this token controls, and picks none.</p>}
          {position.note !== undefined && position.note !== 'It holds nothing now.' && <p class="small muted">{position.note}</p>}
          {position.status === 'open' && (position.state ?? []).length > 0 && <PositionState state={position.state ?? []} />}
          {(token.actions ?? []).length > 0 && (
            <ul class="token-actions">
              {(token.actions ?? []).map((action) => (
                <li class={action.needsApplication === undefined ? undefined : 'through-application'}>
                  <div>
                    {action.needsApplication !== undefined && <div class="token-action-name">{action.name}</div>}
                    <div class="small muted">{action.description !== '' ? action.description : 'An action of the template.'}</div>
                    {action.needsApplication !== undefined && <div class="small needs-application">Only from the application's own page. {action.needsApplication}</div>}
                  </div>
                  {action.needsApplication === undefined && (
                    <Button small kind="secondary" disabled={!usable} onClick={() => onView({ at: 'act', token, action })}>
                      {action.name}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {token.meaning === 'incomplete' && (
        <div class="token-body">
          {token.reason !== undefined && <p class="small">{token.reason}</p>}
          <p class="small muted">The token is safe: it is held and swept like any other.</p>
          {suggestion !== undefined && (
            <div>
              <Button small kind="secondary" onClick={() => onView({ at: 'trust', identifier: suggestion.identifier })}>
                Trust this template
              </Button>
            </div>
          )}
        </div>
      )}

      {token.meaning === 'unknown' && (
        <div class="token-body">
          <p class="small muted">No template this phone trusts says what it stands for. It is safe: the wallet holds it and moves it in a sweep or a recovery like any other coin.</p>
          {token.reason !== undefined && <p class="small muted">{token.reason}</p>}
        </div>
      )}

      {token.noteRefused !== undefined && <p class="small muted">{token.noteRefused}</p>}
      {token.place === 'earlier' && <Notice tone="warn">This token is at an address of an earlier phone, where that phone's words could still move it. It is moved to this phone's addresses first, with the other coins at earlier addresses; until then it cannot be used here.</Notice>}
      {token.place === 'vault' && <Notice>This token is at a vault address. It is moved to an ordinary address of the wallet before it can be used here.</Notice>}
      <div class="token-send">
        <Button
          small
          kind="quiet"
          onClick={() => {
            chooseToken(token.capability === undefined ? `fungible:${token.category}` : `nft:${token.outpoint}`);
            owner.navigate('send');
            window.scrollTo(0, 0);
          }}
        >
          Send
        </Button>
      </div>
    </li>
  );
};

// ------------------------------------------------------------------ acting on a position from the wallet

type Wanted = NonNullable<TokenAction['asks']>[number];

const NUMBERS = new Set(['satoshis', 'integer', 'bigint', 'token_amount']);

const hintOf = (wanted: Wanted): string => {
  const kind =
    wanted.type === 'satoshis'
      ? 'In whole satoshis.'
      : NUMBERS.has(wanted.type)
        ? 'A whole number.'
        : wanted.type === 'locking_script'
          ? 'A Bitcoin Cash address.'
          : wanted.type === 'bytes' || wanted.type === 'token_category'
            ? 'Hexadecimal.'
            : '';
  return [wanted.description, kind].filter((part) => part !== '').join(' ');
};

/** A value as the template takes it, or the reason it cannot be. */
const valueOf = (wanted: Wanted, text: string, network: Owner['session']['network']): string | { problem: string } => {
  const trimmed = text.trim();
  if (trimmed === '') return { problem: 'Enter a value.' };
  if (NUMBERS.has(wanted.type)) return /^\d+$/.test(trimmed.replace(/[,_ ]/g, '')) ? trimmed.replace(/[,_ ]/g, '') : { problem: wanted.type === 'satoshis' ? 'Enter a whole number of satoshis.' : 'Enter a whole number.' };
  if (wanted.type === 'bytes') {
    const bare = trimmed.replace(/^0x/i, '');
    return /^([0-9a-f]{2})*$/i.test(bare) ? bare.toLowerCase() : { problem: 'Enter bytes as hexadecimal, two digits each.' };
  }
  if (wanted.type === 'token_category') return /^[0-9a-f]{64}$/i.test(trimmed) ? trimmed.toLowerCase() : { problem: 'A token category is 64 hexadecimal digits.' };
  if (wanted.type === 'locking_script') {
    try {
      return binToHex(lockingBytecodeOfAddress(trimmed, network));
    } catch (error) {
      return { problem: (error as Error).message };
    }
  }
  return trimmed;
};

type Acting = { at: 'form' } | { at: 'review'; request: ApplicationAction; preview: ActionPreview } | { at: 'refused'; reason: string } | { at: 'done'; outcome: ActionOutcome } | { at: 'failed'; reason: string; notStored: boolean };

const ActOnToken = ({ owner, token, action, onBack }: { owner: Owner; token: HeldToken; action: TokenAction; onBack: () => void }) => {
  const { applications } = owner.apps;
  // What the user gives: the library says which values neither the token nor the chain supplies.
  const wanted: Wanted[] = action.asks ?? [];
  // A value the position holds now, as the template reads it from the chain, is where the user starts from.
  const [prefilled] = useState<Record<string, string>>(() =>
    Object.fromEntries(wanted.flatMap((item) => token.position?.state?.filter((entry) => entry.variable === item.variable).map((entry) => [item.variable, entry.value]) ?? [])),
  );
  const [values, setValues] = useState<Record<string, string>>(prefilled);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<Acting>({ at: 'form' });
  const task = useTask();

  const review = () =>
    task.run('review', async () => {
      const variables: Record<string, string> = {};
      const found: Record<string, string> = {};
      for (const item of wanted) {
        const value = valueOf(item, values[item.variable] ?? '', owner.session.network);
        if (typeof value === 'string') variables[item.variable] = value;
        else found[item.variable] = value.problem;
      }
      setProblems(found);
      if (Object.keys(found).length > 0) return;
      try {
        const request = applications.actionOn(token, action.action, variables);
        setActing({ at: 'review', request, preview: await applications.preview(request) });
      } catch (error) {
        setActing({ at: 'refused', reason: refusalOf(error) });
      }
    });
  useEffect(() => {
    if (wanted.length === 0) void review();
  }, []);

  const carryOut = () =>
    task.run('carry', async (progress) => {
      if (acting.at !== 'review') return;
      progress(acting.preview.firstUse ? 'Storing the template in your backup' : 'Checking the action again');
      try {
        const outcome = await applications.carryOut(acting.request, (stage) => progress(stage === 'recorded' ? 'Signing and sending' : 'Sent. Finishing'));
        setActing({ at: 'done', outcome });
      } catch (error) {
        setActing({ at: 'failed', reason: refusalOf(error), notStored: error instanceof NotStoredError });
      }
    });

  return (
    <div class="stack">
      <PageHead title={action.name}>{action.description !== '' ? action.description : `An action of the template "${token.template?.name ?? ''}".`}</PageHead>
      <div class="grid two">
        <div class="stack">
          {acting.at === 'form' && wanted.length > 0 && (
            <Card title="What the action needs">
              <p class="small muted card-lead">The template asks for these values. Their names and descriptions are the template's.{Object.keys(prefilled).length > 0 && ' Where the position holds a value now, the field starts with it.'}</p>
              {wanted.map((item) => (
                <Field label={item.name} id={`value-${item.variable}`} hint={hintOf(item)} error={problems[item.variable]}>
                  {item.type === 'satoshis' ? (
                    <div class="input-unit">
                      <TextInput id={`value-${item.variable}`} numeric value={values[item.variable] ?? ''} onInput={(value) => setValues({ ...values, [item.variable]: value })} invalid={problems[item.variable] !== undefined} />
                      <span>sat</span>
                    </div>
                  ) : (
                    <TextInput id={`value-${item.variable}`} {...(NUMBERS.has(item.type) ? { numeric: true } : {})} value={values[item.variable] ?? ''} onInput={(value) => setValues({ ...values, [item.variable]: value })} invalid={problems[item.variable] !== undefined} />
                  )}
                </Field>
              ))}
              <TaskStatus task={task} name="review" />
              <div class="actions">
                <Button task={task} name="review" onClick={() => void review()}>
                  Review
                </Button>
                <Button kind="quiet" onClick={onBack}>
                  Back
                </Button>
              </div>
            </Card>
          )}
          {acting.at === 'form' && wanted.length === 0 && (
            <Card>
              <Loading>Working out what this would do…</Loading>
              <TaskStatus task={task} name="review" />
            </Card>
          )}
          {acting.at === 'refused' && (
            <Card title="This wallet would not carry it out" tone="bad">
              <p class="failure">{acting.reason}</p>
              <div class="actions">
                {wanted.length > 0 && (
                  <Button kind="secondary" onClick={() => setActing({ at: 'form' })}>
                    Change the values
                  </Button>
                )}
                <Button kind="quiet" onClick={onBack}>
                  Back
                </Button>
              </div>
            </Card>
          )}
          {acting.at === 'review' && (
            <Card title="Check and carry out" cls="request-card">
              <div class="stack">
                <ActionReview preview={acting.preview} />
                {needsBackup(acting.preview) && <NoBackup owner={owner}>This wallet has no backup store yet. A template is stored there before its first action. Set up recovery first.</NoBackup>}
                <TaskStatus task={task} name="carry" />
                <div class="actions decide">
                  <Button task={task} name="carry" disabled={needsBackup(acting.preview)} onClick={() => void carryOut()}>
                    Carry it out
                  </Button>
                  <Button kind="quiet" disabled={task.busy !== undefined} onClick={wanted.length > 0 ? () => setActing({ at: 'form' }) : onBack}>
                    {wanted.length > 0 ? 'Change the values' : 'Back'}
                  </Button>
                </div>
                <p class="small muted">Nothing is signed or sent until you carry it out.</p>
              </div>
            </Card>
          )}
          {acting.at === 'done' && (
            <Card title="Done" tone="good">
              <div class="stack">
                <p>The transaction was sent.{acting.outcome.tokens.length > 0 && ` The wallet received ${acting.outcome.tokens.length === 1 ? 'a token' : `${acting.outcome.tokens.length} tokens`}.`}</p>
                <Transaction id={acting.outcome.transactionId} explorer={owner.session.environment.explorer} />
                <div class="actions">
                  <Button kind="secondary" onClick={onBack}>
                    Back to the tokens
                  </Button>
                </div>
              </div>
            </Card>
          )}
          {acting.at === 'failed' && (
            <Card title="Not carried out" tone="bad">
              <div class="stack">
                <p class="failure">{acting.reason}</p>
                {acting.notStored && <NoBackup owner={owner}>A template is stored in your backup before its first action, and no backup store confirmed it. Set up recovery, or try again when a store can be reached.</NoBackup>}
                <div class="actions">
                  <Button kind="quiet" onClick={onBack}>
                    Back
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
        <div class="stack">
          <Card flat>
            <div class="stack-s token-aside">
              <h3>The token</h3>
              <p class="small">
                {token.template?.name ?? 'A token'} · <Hex value={token.category} />
              </p>
              {token.position?.status === 'open' && (
                <p class="small">
                  Holds <Amount satoshis={token.position.satoshis} exact />
                </p>
              )}
              {token.position?.status === 'open' && (token.position.state ?? []).length > 0 && <PositionState state={token.position.state ?? []} />}
              <p class="small muted">You act from the wallet itself. Everything comes from the token, the template you trust and the chain; no application is asked.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ a template an earlier owner stored

const TrustSuggested = ({ owner, identifier, onBack }: { owner: Owner; identifier: string; onBack: () => void }) => {
  const { applications } = owner.apps;
  const [suggestion] = useState(() => applications.suggestions.find((candidate) => candidate.identifier === identifier));
  const task = useTask();
  const [summary, problem] = useMemo((): [TemplateSummary | undefined, string | undefined] => {
    if (suggestion === undefined) return [undefined, 'The template is no longer among those found in the backup.'];
    try {
      return [applications.describe(suggestion, suggestion.texts), undefined];
    } catch (error) {
      return [undefined, refusalOf(error)];
    }
  }, []);
  const trust = () =>
    task.run('trust', async () => {
      if (suggestion === undefined) return;
      const { contentHash, declaration } = suggestion;
      const kept = await applications.trust({ identifier, contentHash, ...(declaration === undefined ? {} : { declaration }) }, undefined);
      await applications.storeNow(kept.identifier);
      owner.apps.changed();
      owner.toast('The template is trusted on this phone.');
      onBack();
    });
  return (
    <div class="stack">
      <PageHead title="A template from your backup" />
      <div class="grid two">
        <Card cls="request-card">
          <div class="stack">
            <p>
              {suggestion?.withdrawn !== undefined ? 'You stopped trusting this template. Your backup still holds it.' : 'An earlier owner of this wallet stored this template in the backup. It is not trusted on this phone until you say so.'}
              <Info label="About trusting it">Trusting it lets this wallet show what your tokens of this template control, and carry out the template's actions when you ask.</Info>
            </p>
            {summary === undefined ? <Notice tone="bad">{problem}</Notice> : (
              <Part title="Template">
                <TemplateView summary={summary} showActions />
              </Part>
            )}
            {summary?.verdict.statement === 'violation' && <Notice tone="bad">This wallet does not take in a template with a violation.</Notice>}
            <TaskStatus task={task} />
            <div class="actions decide">
              {summary !== undefined && summary.verdict.statement !== 'violation' && (
                <Button task={task} name="trust" onClick={() => void trust()}>
                  Trust this template
                </Button>
              )}
              <Button kind="quiet" onClick={onBack}>
                Back
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
