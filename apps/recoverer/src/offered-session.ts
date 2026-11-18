import { binToHex } from '@bitauth/libauth';
import { type SetUpOffer, type SetUpRecord, SetUpDesk, setUpForRequest } from '@grandmas-wallet/app';
import { linkOfSealed } from '@grandmas-wallet/app/hand-off';
import { type Particulars, type ReceivedSealed, type SealedStatus, SealedDesk } from '@grandmas-wallet/connect/recoverer';
import { type DeskSession, openDeskSession } from '@grandmas-wallet/connect/recoverer-session';
import type { LinkStatus } from '@grandmas-wallet/connect/wizard';
import { useEffect, useState } from 'preact/hooks';

import { type Session, fundsOf, keep, kept, modeOf, saveWallet, settingsOf, wallets } from './session.js';

/**
 * The session this page offers in its QR code while it is open (`gw_recoverer_v1`). A phone that scans the code
 * joins it and asks over it: to have its wallet set up, which the page carries out from the recoverer's own coins,
 * or, on a lost phone's code, to take a wallet over. A kit for a new recoverer that arrives over it is put back into
 * the link it would have come in, and taken in from there.
 *
 * What opens the session is kept in the browser, so that the page offers the same session after a reload and the
 * phone that joined it is answered there. Once a phone has been served, the code offers a new session.
 */

/** What the code is for: setting wallets up, or one wallet whose owner lost their phone. */
export type Purpose = { kind: 'set up' } | { kind: 'lost phone'; identity: string };

export interface DeskState {
  /** The session's address, for the QR code. */
  uri: string;
  status: LinkStatus;
  purpose: Purpose;
  /** A kit or a takeover request that arrived over the session, and what this page answered. */
  arrived?: { kind: ReceivedSealed['kind']; answered: SealedStatus };
  /** The set-up request that arrived over this session, by its identifier. */
  setUp?: string;
}

let offered: { session: DeskSession; desk: SealedDesk; state: DeskState; pending?: string | undefined } | undefined;
const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach((listener) => listener());

const update = (next: Partial<DeskState>): void => {
  if (offered === undefined) return;
  offered.state = { ...offered.state, ...next };
  changed();
};

/** What a phone is told a new wallet gets. */
export const offerNow = (): SetUpOffer => {
  const settings = settingsOf();
  return { challengeDelay: settings.challengeDelay, startingSatoshis: BigInt(settings.startingSatoshis) };
};

/** Who this recoverer is, as its code says, and what it offers a phone. */
export const particularsOf = (session: Session): Particulars => {
  const offer = offerNow();
  return { name: kept('name') ?? '', page: session.environment.recovererUrl, publicKey: binToHex(session.publicKey), offer: { challengeDelay: offer.challengeDelay, startingSatoshis: offer.startingSatoshis.toString() } };
};

// ------------------------------------------------------------------ setting wallets up

/** The name the next wallet that is set up is given, as the recoverer typed it before showing the code. */
let nextLabel = '';
export const setNextLabel = (label: string): void => {
  nextLabel = label.trim();
};

let setUps: SetUpDesk | undefined;

/** The page's records of set-up requests, kept in the browser. */
const records = {
  get: (id: string): SetUpRecord | undefined => kept('setUps')?.[id],
  set: (record: SetUpRecord): void => keep('setUps', { ...(kept('setUps') ?? {}), [record.requestId]: record }),
  all: (): SetUpRecord[] => Object.values(kept('setUps') ?? {}),
};
export const setUpRecords = records;

/**
 * Answering phones that ask to have their wallet set up: a bank's page creates without asking, a friend's page
 * when they say yes. The wallet is created from the recoverer's own coins and its kit kept with the other wallets.
 */
export const setUpDesk = (session: Session): SetUpDesk => {
  setUps ??= new SetUpDesk({
    records,
    network: session.network,
    privateKey: session.privateKey,
    reply: async (id, reply) => offered?.desk.answerEnroll(id, reply),
    create: async (read, record, save) => {
      const funds = await fundsOf(session);
      const made = await setUpForRequest({
        read,
        funds,
        chain: session.chain,
        storeAt: session.storeAt,
        offer: offerNow(),
        record: record.creation,
        save,
        reserved: (setUps as SetUpDesk).reserved(record.requestId),
        label: record.label,
        madeAt: Math.floor(Date.now() / 1000),
        // The kit is kept with the other wallets before the receipt is left: a receipt says that the kit is held.
        keepKit: (kept) => {
          const before = wallets()[kept.kit.identity];
          saveWallet(kept.kit.identity, { ...(before ?? {}), kept, label: record.label || before?.label || '', addedAt: before?.addedAt ?? Math.floor(Date.now() / 1000) });
        },
      });
      return made.answer;
    },
    automatic: () => modeOf() === 'bank',
    name: () => kept('name') ?? '',
    label: () => nextLabel,
    onChange: changed,
  });
  return setUps;
};

// ------------------------------------------------------------------ a lost phone

/** What the page does with a takeover request that arrives on a lost phone's code: it is saved for that wallet. */
let onTakeover: ((sealed: Uint8Array) => Promise<void>) | undefined;
export const handleTakeovers = (handler: ((sealed: Uint8Array) => Promise<void>) | undefined): void => {
  onTakeover = handler;
};

/** Hand the new phone what the recoverer made after the recovery, over the session, if a phone is there. */
export const handOverNow = async (id: string, sealed: Uint8Array): Promise<boolean> => {
  if (offered === undefined || offered.state.status.state !== 'connected') return false;
  return offered.desk.handOver(id, sealed, { timeoutMs: 30_000 });
};

// ------------------------------------------------------------------ the session

const samePurpose = (a: Purpose, b: Purpose): boolean => a.kind === b.kind && (a.kind !== 'lost phone' || (b.kind === 'lost phone' && a.identity === b.identity));
const purposeKey = (purpose: Purpose): string => (purpose.kind === 'set up' ? 'set up' : purpose.identity);

/** Whether the phone on the session has been served: its wallet set up or refused, its kit or request answered. */
const served = (state: DeskState): boolean => {
  if (state.arrived !== undefined && state.arrived.answered !== 'received') return true;
  const record = state.setUp === undefined ? undefined : records.get(state.setUp);
  return record?.answer !== undefined || record?.refused !== undefined;
};

/** The session the page offers for a purpose: the one it offered before a reload, if a phone had joined it; otherwise a new one. */
const offer = (session: Session, purpose: Purpose, fresh = false): DeskState => {
  if (offered !== undefined && samePurpose(offered.state.purpose, purpose) && !fresh && !served(offered.state)) return offered.state;
  offered?.session.close();
  const stored = kept('deskSession');
  const resume = !fresh && offered === undefined && stored?.walletPublicKey !== undefined && stored.for === purposeKey(purpose) ? { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey } : undefined;
  const desk: SealedDesk = new SealedDesk({
    particulars: () => particularsOf(session),
    onSealed: (received) => {
      if (offered === undefined) return;
      if (received.kind === 'takeover' && onTakeover !== undefined) {
        offered.pending = received.id;
        void desk.answer(received.id, 'received');
        update({ arrived: { kind: received.kind, answered: 'received' } });
        void onTakeover(received.sealed).then(
          () => answerIncoming('kept'),
          (error: unknown) => answerIncoming('refused', (error as Error).message),
        );
        return;
      }
      void linkOfSealed(received.kind, session.environment.recovererUrl, received.sealed).then((text) => {
        if (offered === undefined) return;
        // As if the link had been opened: the page's own screen for it takes it from here.
        keep('incoming', { kind: received.kind, text });
        offered.pending = received.id;
        void desk.answer(received.id, 'received');
        update({ arrived: { kind: received.kind, answered: 'received' } });
      });
    },
    onEnroll: ({ id, sealed }) => {
      if (offered?.state.setUp !== id) update({ setUp: id });
      if (purpose.kind !== 'set up') {
        void desk.answerEnroll(id, { status: 'refused', reason: 'This code is for a lost phone. Ask for the code that sets a wallet up.' });
        return;
      }
      void setUpDesk(session).received(id, sealed);
    },
  });
  const opened = openDeskSession({
    name: kept('name') || 'Recoverer',
    relays: session.environment.relays,
    ...(resume === undefined ? {} : { resume }),
    onPaired: (credentials) => keep('deskSession', { ...credentials, for: purposeKey(purpose) }),
    onStatus: (status) => {
      // A phone that connects is told who this recoverer is, as its code says.
      if (status.state === 'connected') void desk.introduce();
      update({ status });
    },
  });
  if (resume === undefined) keep('deskSession', { ...opened.credentials, for: purposeKey(purpose) });
  desk.attach(opened.channel);
  offered = { session: opened, desk, state: { uri: opened.uri, status: { state: 'connecting' }, purpose } };
  return offered.state;
};

/**
 * Tell the phone what became of what it sent over the session: kept, or refused with the reason. A link that was
 * opened in the ordinary way has nobody to tell, and nothing happens.
 */
export const answerIncoming = (status: 'kept' | 'refused', reason?: string): void => {
  if (offered?.pending === undefined) return;
  const id = offered.pending;
  offered.pending = undefined;
  void offered.desk.answer(id, status, reason);
  update({ arrived: { kind: offered.state.arrived?.kind ?? 'enroll', answered: status } });
};

/**
 * The session offered with the code, for as long as the screen shows it. Once a phone has been served, a moment later
 * the code offers a new session, for the next phone.
 */
export const useDesk = (session: Session, purpose: Purpose, fresh = false): DeskState & { renew: () => void } => {
  const [state, setState] = useState<DeskState>(() => offer(session, purpose, fresh));
  useEffect(() => {
    let renewing: ReturnType<typeof setTimeout> | undefined;
    const listener = () => {
      if (offered === undefined) return;
      setState(offered.state);
      // A lost phone's session stays open after its request: the hand-over goes the same way.
      if (purpose.kind === 'set up' && served(offered.state) && renewing === undefined) {
        renewing = setTimeout(() => {
          renewing = undefined;
          setState(offer(session, purpose, true));
        }, 6_000);
      }
    };
    listeners.add(listener);
    listener();
    return () => {
      clearTimeout(renewing);
      listeners.delete(listener);
    };
  }, [purposeKey(purpose)]);
  return { ...state, renew: () => setState(offer(session, purpose, true)) };
};

/** Changes whenever a set-up request changes, or anything else the session brings, so that the page shows it. */
export const useChanges = (): number => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const listener = () => setCount((known) => known + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return count;
};

/** Changes whenever a kit or a request arrives over the session to be shown as an opened link. */
export const useArrivals = (): number => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let last = offered?.state.arrived;
    const listener = () => {
      if (offered?.state.arrived !== last && offered?.state.arrived?.answered === 'received' && onTakeover === undefined) setCount((known) => known + 1);
      last = offered?.state.arrived;
    };
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return count;
};

/** After a reload: a session a phone had joined is offered again, and set-ups said yes to are carried on. */
export const resumeDesk = (session: Session, purpose: Purpose): void => {
  const stored = kept('deskSession');
  if (stored?.walletPublicKey !== undefined && stored.for === purposeKey(purpose)) offer(session, purpose);
  if (purpose.kind === 'set up') void setUpDesk(session).resume();
};
