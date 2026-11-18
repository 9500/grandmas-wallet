import type { SealedKind } from '@grandmas-wallet/app/hand-off';
import { More, Notice } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';

import { type Handing, type HandingSlot, useHanding } from './hand-to-recoverer.js';

/** A message still "sending" after this long was cut off by a reload: the link is the way. */
const STALE_SECONDS = 60;

const WORDS: Record<SealedKind, { what: string; received: (name: string) => string; kept: (name: string) => string }> = {
  enroll: {
    what: 'the kit',
    received: (name) => `${capital(name)}'s page has the kit. It is now for ${name} to check it and keep it there.`,
    kept: (name) => `${capital(name)} has kept the kit. Recovery is on as soon as this phone finds their receipt on the backup stores.`,
  },
  takeover: {
    what: 'your request',
    received: (name) => `${capital(name)}'s page has your request.`,
    kept: (name) => `${capital(name)}'s page has your request among its requests.`,
  },
};

/** A name at the start of a sentence: "your recoverer" becomes "Your recoverer". */
const capital = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

const current = (handing: Handing | undefined): Handing | undefined =>
  handing?.status === 'sending' && handing.at < Math.floor(Date.now() / 1000) - STALE_SECONDS ? { ...handing, status: 'unreached' } : handing;

/**
 * A sealed message for the recoverer: sent to their page over its session when their code offered one, with the
 * link (`children`) as the second way; otherwise the link, as before. A page that does not answer leaves the
 * link in view, with nothing said about it: a session needs both pages open at once, and the link works at any
 * time.
 */
export const SealedHandOff = ({ kind, slot, name, children }: { kind: SealedKind; slot?: HandingSlot; name: string; children: ComponentChildren }) => {
  const handing = current(useHanding(slot ?? kind));
  const words = WORDS[kind];
  if (handing === undefined || handing.status === 'unreached') return <>{children}</>;
  if (handing.status === 'refused') {
    return (
      <div class="stack-s">
        <Notice tone="warn">
          {capital(name)}'s page did not keep {words.what}. {handing.reason ?? ''} Send it as a link instead.
        </Notice>
        {children}
      </div>
    );
  }
  return (
    <div class="stack-s" data-testid={`handed-${kind}`}>
      {handing.status === 'sending' ? (
        <Notice tone="wait" busy>
          Sending {words.what} to {name}'s page…
        </Notice>
      ) : (
        <Notice tone="good">{handing.status === 'received' ? words.received(name) : words.kept(name)}</Notice>
      )}
      <More summary="Send it as a link instead">
        <p class="small muted">If {name}'s page was closed, or they use another device, send them the link. It works at any time.</p>
        {children}
      </More>
    </div>
  );
};
