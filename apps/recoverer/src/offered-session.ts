import { binToHex } from '@bitauth/libauth';
import { linkOfSealed } from '@grandmas-wallet/app/hand-off';
import { type ReceivedSealed, type SealedStatus, SealedDesk } from '@grandmas-wallet/connect/recoverer';
import { type DeskSession, openDeskSession } from '@grandmas-wallet/connect/recoverer-session';
import type { LinkStatus } from '@grandmas-wallet/connect/wizard';
import { useEffect, useState } from 'preact/hooks';

import { type Session, keep, kept } from './session.js';

/**
 * The session this page offers in its QR code while it is open (`gw_recoverer_v1`), so that the wallet that
 * scans the code can send the kit straight back. What arrives is put back into the link it would have come in
 * and taken in from there, exactly as if that link had been opened: the same screen, the same checks. One
 * wallet per session; once its kit is kept or refused, the next time the code is shown it offers a new one.
 */

export interface DeskState {
  /** The session's address, for the QR code. */
  uri: string;
  status: LinkStatus;
  /** What arrived over the session, and what this page answered. */
  arrived?: { kind: ReceivedSealed['kind']; answered: SealedStatus };
}

let offered: { session: DeskSession; desk: SealedDesk; state: DeskState; pending?: string | undefined } | undefined;
const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach((listener) => listener());

const update = (next: Partial<DeskState>): void => {
  if (offered === undefined) return;
  offered.state = { ...offered.state, ...next };
  changed();
};

/** The session the page offers, made the first time the code is shown, and again after a wallet was served. */
const offer = (session: Session): DeskState => {
  if (offered !== undefined && (offered.state.arrived === undefined || offered.state.arrived.answered === 'received')) return offered.state;
  offered?.session.close();
  const particulars = () => ({ name: kept('name') ?? '', page: session.environment.recovererUrl, publicKey: binToHex(session.publicKey) });
  const desk = new SealedDesk({
    particulars,
    onSealed: (received) => {
      if (offered === undefined) return;
      void linkOfSealed(received.kind, session.environment.recovererUrl, received.sealed).then((text) => {
        if (offered === undefined) return;
        // As if the link had been opened: the page's own screen for it takes it from here.
        keep('incoming', { kind: received.kind, text });
        offered.pending = received.id;
        void desk.answer(received.id, 'received');
        update({ arrived: { kind: received.kind, answered: 'received' } });
      });
    },
  });
  const opened = openDeskSession({
    name: kept('name') || 'Recoverer',
    relays: session.environment.relays,
    onStatus: (status) => {
      // A wallet that connects is told who this recoverer is, as its link says.
      if (status.state === 'connected') void desk.introduce();
      update({ status });
    },
  });
  desk.attach(opened.channel);
  offered = { session: opened, desk, state: { uri: opened.uri, status: { state: 'connecting' } } };
  return offered.state;
};

/**
 * Tell the wallet what became of what it sent over the session: kept, or refused with the reason. A link that
 * was opened in the ordinary way has nobody to tell, and nothing happens.
 */
export const answerIncoming = (status: 'kept' | 'refused', reason?: string): void => {
  if (offered?.pending === undefined) return;
  const id = offered.pending;
  offered.pending = undefined;
  void offered.desk.answer(id, status, reason);
  update({ arrived: { kind: offered.state.arrived?.kind ?? 'enroll', answered: status } });
};

/** The session offered with the code, for as long as the screen shows it; the session itself lasts as long as the page. */
export const useDesk = (session: Session): DeskState => {
  const [state, setState] = useState<DeskState>(() => offer(session));
  useEffect(() => {
    let renewing: ReturnType<typeof setTimeout> | undefined;
    const listener = () => {
      if (offered === undefined) return;
      setState(offered.state);
      // A wallet was served: a moment later the code offers a new session, for the next phone.
      if (offered.state.arrived !== undefined && offered.state.arrived.answered !== 'received' && renewing === undefined) {
        renewing = setTimeout(() => {
          renewing = undefined;
          setState(offer(session));
        }, 5_000);
      }
    };
    listeners.add(listener);
    listener();
    return () => {
      clearTimeout(renewing);
      listeners.delete(listener);
    };
  }, []);
  return state;
};

/** Changes whenever something arrives over the session, so that the page shows it as an opened link. */
export const useArrivals = (): number => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let last = offered?.state.arrived;
    const listener = () => {
      if (offered?.state.arrived !== last && offered?.state.arrived?.answered === 'received') setCount((known) => known + 1);
      last = offered?.state.arrived;
    };
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return count;
};
