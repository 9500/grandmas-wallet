import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { type LinkField, linkKind } from '@grandmas-wallet/app/links';

/**
 * What the QR code scanner decides without a camera: which cameras it goes round, what a camera's label says
 * about its lens, and which codes a field accepts. The scanner itself is in `Scanner.tsx`.
 */

/** A camera as the browser lists it. Labels are empty until the page may use the camera. */
export interface CameraInfo {
  id: string;
  label: string;
}

export type Facing = 'rear' | 'front' | 'unknown';

// Labels as phones give them: Android's "camera2 0, facing back", iOS's "Back Ultra Wide Camera", and the same in
// the languages iOS translates them into.
const REAR = /\b(back|rear|environment)\b|rück|rück|arri[eè]re|trasera|posteriore|traseira|achter|tylna|bakre|takakamera|задн|背面|后置|後置|후면/i;
const FRONT = /\b(front|selfie)|\buser\b|facetime|vorder|avant|frontal|anteriore|voorzijde|przednia|främre|etukamera|передн|前面|前置|전면/i;

/** Which way a camera faces, as far as its label says. */
export const facingOf = (label: string): Facing => (FRONT.test(label) ? 'front' : REAR.test(label) ? 'rear' : 'unknown');

const LENSES: [RegExp, string][] = [
  [/ultra[\s-]?wide|ultraweit|ultra grand|ultra gran angular/i, 'Ultra wide'],
  [/\btele/i, 'Telephoto'],
  [/macro|makro/i, 'Macro'],
  [/dual[\s-]?wide/i, 'Dual wide'],
  [/triple/i, 'Triple'],
  [/dual/i, 'Dual'],
  [/\bwide\b/i, 'Wide'],
];

/** The lens a camera's label names, if it names one. */
export const lensOf = (label: string): string | undefined => LENSES.find(([pattern]) => pattern.test(label))?.[1];

/**
 * The order the cameras are offered in: the main lens first, a telephoto lens last, since it cannot focus on a
 * code held close. Within a kind, the browser's own order.
 */
const RANK: Record<string, number> = { Wide: 0, 'Dual wide': 1, Triple: 1, Dual: 1, 'Ultra wide': 2, Macro: 3, Telephoto: 4 };
const rankOf = (camera: CameraInfo): number => RANK[lensOf(camera.label) ?? 'Wide'] ?? 0;

/**
 * The cameras a tap on the picture goes round: the rear ones, best first. Front cameras are left out. Only when
 * no camera can be told to face the rear (a computer, or labels that say nothing) are all of them offered.
 */
export const cameraRound = (cameras: CameraInfo[]): CameraInfo[] => {
  const rear = cameras.filter((camera) => facingOf(camera.label) === 'rear');
  const offered = rear.length > 0 ? rear : cameras;
  return offered
    .map((camera, index) => ({ camera, index }))
    .sort((a, b) => rankOf(a.camera) - rankOf(b.camera) || a.index - b.index)
    .map(({ camera }) => camera);
};

/** The camera after the one in use, going round. A camera not in the round is followed by the first. */
export const nextCamera = (round: CameraInfo[], current: string | undefined): CameraInfo | undefined => {
  if (round.length === 0) return undefined;
  const at = round.findIndex((camera) => camera.id === current);
  return round[(at + 1) % round.length];
};

/** "Camera 2 of 3 · Ultra wide", or only the lens when the camera is not in the round. */
export const describeCamera = (round: CameraInfo[], current: string | undefined): string | undefined => {
  const at = round.findIndex((camera) => camera.id === current);
  const lens = at === -1 ? undefined : lensOf(round[at]?.label ?? '');
  if (round.length < 2) return lens;
  if (at === -1) return undefined;
  return `Camera ${at + 1} of ${round.length}${lens === undefined ? '' : ` · ${lens}`}`;
};

// ------------------------------------------------------------------ what a field accepts

/** Which codes a field takes, and what it says about one it does not. */
export interface ScanFilter {
  /** What the field takes, in a few words, shown above the camera's picture. */
  wants: string;
  /** Said when a code of another kind is read. The scanner stays open. */
  wrong: string;
  /** The text to put into the field, or `undefined` if the code is not of this kind. */
  accept(text: string): string | undefined;
}

const linkOf = (field: LinkField, wants: string, wrong: string): ScanFilter => ({
  wants,
  wrong,
  accept: (text) => (linkKind(text.trim()) === field ? text.trim() : undefined),
});

/** A recoverer's link, which its page shows under "Your link". */
export const RECOVERER_LINK = linkOf('recoverer', 'Your recoverer\'s link', 'This code is not a recoverer\'s link. Scan the code your recoverer\'s page shows under "Your link".');

/** The hand-over a recoverer sends after the waiting period. */
export const HANDOVER_LINK = linkOf('handover', 'The link from your recoverer', 'This code is not the link your recoverer sends after the waiting period.');

/** The old phone's link for a move to a new phone. */
export const MOVE_LINK = linkOf('move', 'The link from your old phone', 'This code is not the link your old phone shows for this phone.');

/** The new phone's link for a move to a new phone. */
export const PREPARE_LINK = linkOf('prepare', 'The new phone\'s link', 'This code is not the link the new phone shows.');

/** An application's connection address. Its QR form is in capitals. */
export const CONNECTION_ADDRESS: ScanFilter = {
  wants: 'An application\'s connection address',
  wrong: 'This code is not an application\'s connection address. Such an address starts with wiz://.',
  accept: (text) => (/^wiz:\/\//i.test(text.trim()) ? text.trim() : undefined),
};

/**
 * A Bitcoin Cash address for the page's network, with or without its prefix. A payment request
 * (`bitcoincash:…?amount=…`) gives its address; the amount is left for the user to enter.
 */
export const paymentAddress = (network: 'mainnet' | 'testnet'): ScanFilter => {
  // As the send screen reads an address: a test network takes `bchtest` and `bchreg`, and the prefix may be left out.
  const prefixes = network === 'mainnet' ? ['bitcoincash'] : ['bchtest', 'bchreg'];
  const isAddress = (text: string): boolean =>
    (text.includes(':') ? [text.toLowerCase()] : prefixes.map((prefix) => `${prefix}:${text.toLowerCase()}`)).some((candidate) => {
      const decoded = cashAddressToLockingBytecode(candidate);
      return typeof decoded !== 'string' && prefixes.includes(decoded.prefix);
    });
  return {
    wants: 'A Bitcoin Cash address',
    wrong: network === 'mainnet' ? 'This code is not a Bitcoin Cash address.' : 'This code is not a Bitcoin Cash address for the test network.',
    accept: (text) => {
      const address = text.trim().split('?')[0] ?? '';
      return address !== '' && isAddress(address) ? address : undefined;
    },
  };
};
