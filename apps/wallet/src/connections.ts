import { hexToBin } from '@bitauth/libauth';
import { type ActionConsent, type ActionOutcome, type ApplicationAction, type OwnerWallet, type ShownRegistry, Applications, TokenRegistries, applicationArchive, applicationConnector, httpRegistryFetch, shownRegistry, walletAnnouncement } from '@grandmas-wallet/app';
import type { Offer, Proposal, WalletConnector } from '@grandmas-wallet/connect';
import { type LinkStatus, type WalletLink, newLinkKey, openWalletLink, pairingOf } from '@grandmas-wallet/connect/wizard';
import type { SeedKeys } from '@grandmas-wallet/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { BRAND } from './brand.js';
import { type Connection, type Session, keep, kept } from './session.js';

/**
 * The wallet's side of applications while the page is open: the templates the user trusts and the tokens
 * they explain, the connections to applications, and the requests that arrive on them. It lives as long as
 * the page, not the screen, so that a request is noticed on any screen.
 */

export type ActionStage = 'recorded' | 'sent';

/** The wallet's handling of applications, with a way for the page to follow an action as it is carried out. */
export class PageApplications extends Applications {
  private readonly listeners = new Set<(stage: ActionStage) => void>();
  /** Called after every action that was sent, whoever asked for it. */
  onAction: ((request: ApplicationAction, outcome: ActionOutcome) => void) | undefined;

  /** Follow the stages of the actions carried out from now on. */
  watch(listener: (stage: ActionStage) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Why the last action that was tried failed, as it was thrown: the page tells a missing backup store from other reasons. */
  lastError: unknown;

  override async carryOut(request: ApplicationAction, onStage: (stage: ActionStage) => void = () => undefined, consent: ActionConsent = {}): Promise<ActionOutcome> {
    this.lastError = undefined;
    let outcome: ActionOutcome;
    try {
      outcome = await super.carryOut(
        request,
        (stage) => {
          onStage(stage);
          for (const listener of [...this.listeners]) listener(stage);
        },
        consent,
      );
    } catch (error) {
      this.lastError = error;
      throw error;
    }
    this.onAction?.(request, outcome);
    return outcome;
  }

  /** The action's and the template's names, for the list of what this phone sent. */
  describeAction(request: ApplicationAction): string | undefined {
    try {
      const summary = this.describe(request.template, request.presented);
      const action = summary.actions.find((candidate) => candidate.action === request.action);
      return `${action?.name ?? request.action} · ${summary.name}`;
    } catch {
      return undefined;
    }
  }
}

/**
 * An address an application shows, in one form: the QR form (capitals, `%3F`) and the ordinary one name the
 * same connection and so the same pairing.
 */
export const normalAddress = (text: string): string => {
  const lower = text.trim().toLowerCase();
  return lower.includes('%3f') && !lower.includes('?') ? lower.replace('%3f', '?').replace(/%3d/g, '=').replace(/%26/g, '&') : lower;
};

/** The relay a connection goes through, as the address names it. */
export const relayOf = (uri: string): string => {
  try {
    return new URL(uri).host || 'relay.riften.net';
  } catch {
    return 'an unknown relay';
  }
};

/** An application that asked about the tokens of a template the user trusts, but not in a session with it. */
export interface PositionsAsk {
  application: string;
  template: { identifier: string; name: string };
  /** Unix seconds, when it first asked while the page was open. */
  askedAt: number;
}

export interface ApplicationsPart {
  applications: PageApplications;
  connector: WalletConnector;
  connections: Connection[];
  statuses: Record<string, LinkStatus>;
  /** Requests waiting for the user's decision. */
  proposals: Proposal[];
  /** Applications that asked to see the tokens of a template the user trusts without them, waiting for the user's word. */
  asks: PositionsAsk[];
  /** Let the application see the template's tokens, or not for as long as the page is open. */
  answerAsk(ask: PositionsAsk, allow: boolean): void;
  /** Templates that applications present without an action, waiting for the user's word. */
  offers: Offer[];
  /**
   * Stop trusting a template. Requests of it that wait for a decision are declined.
   * @returns whether the backup has been told
   */
  stopTrusting(identifier: string): Promise<{ name: string; backupTold: boolean }>;
  /** Connect to the application whose address this is. @throws if the address cannot be used */
  connect(uri: string, name?: string): Connection;
  /** Close a connection and forget it. Requests it made, and their outcomes, are kept. */
  end(pairing: string): void;
  /** Close a connection and open it again with the same key. */
  retry(pairing: string): void;
  /** Token names, symbols and decimals from registries checked against the chain; the screens only write them. */
  registries: TokenRegistries;
  /** What the screens write for a category, as kept now; never waits. */
  names: (category: string, commitment?: string) => ShownRegistry | undefined;
  /** Changes whenever the templates, the tokens or the ledger may have changed. */
  version: number;
  changed(): void;
}

export const useApplications = ({ session, wallet, seed, onSent }: { session: Session; wallet: OwnerWallet; seed: SeedKeys; onSent: (what: string, outcome: ActionOutcome) => void }): ApplicationsPart => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [asks, setAsks] = useState<PositionsAsk[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const open_ = useRef<Proposal[]>([]);
  /** Asks the user answered with "not now": the application asks again and again, and the user is not asked again while the page is open. */
  const notNow = useRef(new Set<string>());
  const [connections, setConnections] = useState<Connection[]>(() => kept('connections') ?? []);
  const [statuses, setStatuses] = useState<Record<string, LinkStatus>>({});
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((count) => count + 1), []);
  const sent = useRef(onSent);
  sent.current = onSent;

  const registries = useMemo(
    () =>
      new TokenRegistries({
        chain: session.chain,
        fetch: httpRegistryFetch,
        kept: () => kept('registries'),
        store: (state) => keep('registries', state),
        ...(session.environment.registries === undefined ? {} : { config: session.environment.registries }),
      }),
    [],
  );
  useEffect(() => {
    const stop = registries.watch(changed);
    // On opening the wallet: each held category is looked at once.
    void applications.tokens().then((held) => registries.refresh(held.map((token) => token.category)), () => undefined);
    return stop;
  }, []);

  const applications = useMemo(() => {
    const made = new PageApplications(wallet.parts, {
      registry: (category) => registries.known(category),
      // Before a review opens: the registries of its categories not known yet, for a few seconds at most.
      lookUp: (categories) => registries.lookUpWithin(categories),
      archive: applicationArchive({
        arrangement: () => kept('arrangement'),
        storeAt: session.storeAt,
        seed,
        identity: hexToBin(wallet.stored.identity ?? ''),
        chain: session.chain,
      }),
    });
    made.onAction = (request, outcome) => {
      sent.current(made.describeAction(request) ?? 'An action of an application\'s template', outcome);
      changed();
    };
    return made;
  }, []);

  const connector = useMemo(
    () =>
      applicationConnector(applications, {
        storage: { load: () => kept('ledger') ?? [], save: (entries) => keep('ledger', entries) },
        onProposals: (open) => {
          open_.current = open;
          setProposals(open);
          changed();
        },
        onOffers: (open) => {
          setOffers(open);
          changed();
        },
        onPositionsAsked: (identifier, application) => {
          const template = applications.templates.find((kept) => kept.identifier === identifier);
          if (template === undefined || notNow.current.has(`${application}/${identifier}`)) return;
          setAsks((known) => (known.some((ask) => ask.application === application && ask.template.identifier === identifier) ? known : [...known, { application, template: { identifier, name: template.name }, askedAt: Math.floor(Date.now() / 1000) }]));
        },
      }),
    [],
  );

  const links = useRef(new Map<string, { link: WalletLink; detach: () => void }>());

  const save = (next: Connection[]): void => {
    keep('connections', next.length === 0 ? undefined : next);
    setConnections(next);
  };

  /** The application's name for itself is kept as it last gave it, so that it is shown before it connects again. */
  const remember = (pairing: string, name: string): void => {
    const current = kept('connections') ?? [];
    if (!current.some((connection) => connection.pairing === pairing && connection.name !== name)) return;
    save(current.map((connection) => (connection.pairing === pairing ? { ...connection, name } : connection)));
  };

  const open = (connection: Connection): void => {
    if (links.current.has(connection.pairing)) return;
    const link = openWalletLink({
      uri: connection.uri,
      privateKey: connection.privateKey,
      name: BRAND,
      offered: walletAnnouncement(session.environment.network),
      onStatus: (status) => {
        setStatuses((known) => ({ ...known, [connection.pairing]: status }));
        if (status.peerName !== undefined) remember(connection.pairing, status.peerName);
      },
    });
    links.current.set(link.pairing, { link, detach: connector.attach(link.pairing, link.channel) });
  };

  const close = (pairing: string): void => {
    const known = links.current.get(pairing);
    known?.detach();
    known?.link.close();
    links.current.delete(pairing);
  };

  useEffect(() => {
    for (const connection of connections) {
      try {
        open(connection);
      } catch (error) {
        setStatuses((known) => ({ ...known, [connection.pairing]: { state: 'disconnected', reason: (error as Error).message } }));
      }
    }
    return () => {
      for (const pairing of [...links.current.keys()]) close(pairing);
    };
  }, []);

  return {
    applications,
    registries,
    names: (category, commitment) => shownRegistry(registries.known(category), commitment),
    connector,
    connections,
    statuses,
    proposals,
    asks,
    answerAsk: (ask, allow) => {
      if (allow) applications.allow(ask.template.identifier, ask.application);
      else notNow.current.add(`${ask.application}/${ask.template.identifier}`);
      setAsks((known) => known.filter((candidate) => candidate !== ask));
      changed();
    },
    offers,
    stopTrusting: async (identifier) => {
      for (const proposal of open_.current.filter((candidate) => candidate.entry.template.identifier === identifier)) await proposal.decline();
      setAsks((known) => known.filter((ask) => ask.template.identifier !== identifier));
      try {
        return await applications.forget(identifier);
      } finally {
        changed();
      }
    },
    connect: (text, name) => {
      const uri = normalAddress(text);
      const pairing = pairingOf(uri);
      close(pairing);
      const connection: Connection = { uri, privateKey: newLinkKey(), pairing, addedAt: Math.floor(Date.now() / 1000), ...(name === undefined || name === '' ? {} : { name: name.slice(0, 60) }) };
      // An address that cannot be used is refused here, before it is kept.
      setStatuses(({ [pairing]: _earlier, ...rest }) => rest);
      open(connection);
      save([...(kept('connections') ?? []).filter((known) => known.pairing !== pairing), connection]);
      return connection;
    },
    end: (pairing) => {
      close(pairing);
      connector.dropOffers(pairing);
      setAsks((known) => known.filter((ask) => ask.application !== pairing));
      save((kept('connections') ?? []).filter((connection) => connection.pairing !== pairing));
      setStatuses(({ [pairing]: _gone, ...rest }) => rest);
    },
    retry: (pairing) => {
      const connection = (kept('connections') ?? []).find((known) => known.pairing === pairing);
      if (connection === undefined) return;
      close(pairing);
      setStatuses(({ [pairing]: _earlier, ...rest }) => rest);
      open(connection);
    },
    version,
    changed,
  };
};
