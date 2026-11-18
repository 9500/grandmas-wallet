import { binToHex, hexToBin } from '@bitauth/libauth';
import { enrollmentLink, envelopeFromLink } from '@grandmas-wallet/enrollment';

import { makeLink, readLink } from './links.js';

/**
 * A sealed message from a wallet to its recoverer travels in a link, or over a session between the two pages
 * (`gw_recoverer_v1`). Over a session the bytes are sent as they are; the recoverer's page puts them back into
 * the link they would have come in, and takes that link in as if it had been opened, through the same checks.
 */

/** What a sealed message is: a recovery kit, for a first recoverer or a new one, or a new phone's takeover request. */
export type SealedKind = 'enroll' | 'takeover';

/** The link a sealed message travels in, to the recoverer's page at `page`. */
export const linkOfSealed = async (kind: SealedKind, page: string, sealed: Uint8Array): Promise<string> =>
  kind === 'enroll' ? enrollmentLink(page, sealed) : makeLink(page, 'takeover', { sealed: binToHex(sealed) });

/**
 * The sealed bytes a link carries.
 * @throws if the link is not of that kind or is damaged
 */
export const sealedOfLink = async (kind: SealedKind, link: string): Promise<Uint8Array> => {
  if (kind === 'enroll') return envelopeFromLink(link);
  const read = await readLink<{ sealed?: unknown }>(link, 'takeover');
  if (read === undefined || typeof read.sealed !== 'string' || !/^([0-9a-f]{2})+$/.test(read.sealed)) throw new Error('The link is incomplete.');
  return hexToBin(read.sealed);
};
