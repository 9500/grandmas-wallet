import { binToHex, sha256 } from '@bitauth/libauth';
import type { SealedKind } from '@grandmas-wallet/app/hand-off';
import { type Particulars, type SealedAnswer, OtherRecovererError, SealedCourier, SealedRefusedError } from '@grandmas-wallet/connect/recoverer';
import { type JoinedDesk, joinDeskSession } from '@grandmas-wallet/connect/recoverer-session';
import { newLinkKey } from '@grandmas-wallet/connect/wizard';
import { useEffect, useState } from 'preact/hooks';

import { BRAND } from './brand.js';
import { type StoredRecipient, keep, kept } from './session.js';

/**
 * Handing something sealed to the recoverer's page over the session its QR code offered (`gw_recoverer_v1`):
 * the kit after the wallet is made, the kit for a new recoverer, a new phone's takeover request. This is a
 * second way, beside the link: when the recoverer's link names no session, when its page does not answer in a
 * short time, or when it refuses, the page shows the link as before. Nothing here waits for a block, and the
 * sessions with applications are not touched.
 */

/** Where handing one kind of message stands. */
export interface Handing {
  status: 'sending' | 'received' | 'kept' | 'refused' | 'unreached';
  reason?: string;
  /** Unix seconds. */
  at: number;
  /** The hash of what was sent: a later message of the same kind replaces this one. */
  sent: string;
}

/** How long the recoverer's page has to answer before the link is shown instead. */
const ANSWER_WITHIN_MS = 20_000;

const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach((listener) => listener());

/** Where handing is followed: by the kind of message, or by a name of the screen's own when two screens send the same kind. */
export type HandingSlot = SealedKind | 'new recoverer';

const note = (slot: HandingSlot, handing: Handing): void => {
  keep('handing', { ...(kept('handing') ?? {}), [slot]: handing });
  changed();
};

const particularsOf = (recipient: StoredRecipient): Particulars => ({ name: recipient.name, page: recipient.page, publicKey: recipient.publicKey });

/** The session this page has joined, by its address. One at a time: a recoverer's page offers one per wallet. */
let joined: { uri: string; desk: JoinedDesk; courier: SealedCourier } | undefined;

/**
 * Join the session a recoverer's link names, as soon as the link is read: the recoverer's page then shows that
 * a phone is connected. The key is kept, so that the page can join the same session again after a reload.
 */
export const joinRecoverer = (recipient: StoredRecipient): SealedCourier | undefined => {
  const uri = recipient.session;
  if (uri === undefined) return undefined;
  if (joined?.uri === uri) return joined.courier;
  leaveRecoverer();
  const known = kept('recovererSession');
  const privateKey = known?.uri === uri ? known.privateKey : newLinkKey();
  keep('recovererSession', { uri, privateKey });
  try {
    const desk = joinDeskSession({ uri, privateKey, name: BRAND, onStatus: () => undefined });
    joined = { uri, desk, courier: new SealedCourier(desk.channel) };
    return joined.courier;
  } catch {
    // An address that cannot be read: the link is the way.
    return undefined;
  }
};

/** Leave the recoverer's session (only the one at this address, if one is named), for example when another link is used instead. */
export const leaveRecoverer = (uri?: string): void => {
  if (uri !== undefined && joined?.uri !== uri) return;
  joined?.courier.close();
  joined?.desk.close();
  joined = undefined;
};

/**
 * Send a sealed message to the recoverer's page over its session, if its link named one. Returns at once; what
 * becomes of it is followed with `useHanding`. The same message sent again (after a reload) is the same message
 * to the recoverer's page, which answers it as before.
 */
export const handToRecoverer = (recipient: StoredRecipient, kind: SealedKind, sealed: Uint8Array, slot: HandingSlot = kind): void => {
  const sent = binToHex(sha256.hash(sealed)).slice(0, 32);
  const courier = joinRecoverer(recipient);
  if (courier === undefined) {
    note(slot, { status: 'unreached', at: Math.floor(Date.now() / 1000), sent });
    return;
  }
  const at = Math.floor(Date.now() / 1000);
  note(slot, { status: 'sending', at, sent });
  // Later answers ("kept", or a refusal after the recoverer looked at it) are followed while the page is open.
  const stop = courier.onAnswer((answer: SealedAnswer) => {
    if (answer.id !== sent || kept('handing')?.[slot]?.sent !== sent) return;
    note(slot, { status: answer.status, ...(answer.reason === undefined ? {} : { reason: answer.reason }), at: answer.time, sent });
    if (answer.status !== 'received') {
      stop();
      // Done with this recoverer: the session is left a moment later, once the answer is acknowledged.
      setTimeout(() => leaveRecoverer(recipient.session), 2_000);
    }
  });
  courier.send({ expected: particularsOf(recipient), kind, sealed, id: sent, timeoutMs: ANSWER_WITHIN_MS }).then(
    (answer) => {
      if (kept('handing')?.[slot]?.status === 'sending') note(slot, { status: answer.status, at: answer.time, sent });
    },
    (error: unknown) => {
      stop();
      if (kept('handing')?.[slot]?.sent !== sent) return;
      if (error instanceof SealedRefusedError) note(slot, { status: 'refused', reason: error.message, at, sent });
      // A page that is gone, or one that is not the recoverer the link names: the link is shown, as before.
      else note(slot, { status: 'unreached', ...(error instanceof OtherRecovererError ? { reason: error.message } : {}), at, sent });
      leaveRecoverer(recipient.session);
    },
  );
};

/** Where handing a message stands, for as long as a screen shows it. */
export const useHanding = (slot: HandingSlot): Handing | undefined => {
  const [handing, setHanding] = useState(() => kept('handing')?.[slot]);
  useEffect(() => {
    const listener = () => setHanding(kept('handing')?.[slot]);
    listeners.add(listener);
    // An answer that came between the first rendering and now (the recoverer's page answers within a moment,
    // while the screen is still being put together) is read here: no later change would bring it.
    listener();
    return () => void listeners.delete(listener);
  }, [slot]);
  return handing;
};
