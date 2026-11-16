/**
 * Links that carry something from one of the applications to another.
 *
 * The content travels in the part of the address after `#`, which a browser
 * does not send to the server. It is compressed and written in the URL-safe
 * base64 alphabet.
 */

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('The link is damaged.');
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const pipe = async (bytes: Uint8Array, through: CompressionStream | DecompressionStream): Promise<Uint8Array> => {
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(through);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** The field names used in links, one per kind of content. */
export type LinkField =
  /** Recoverer to wallet: the recoverer's encryption key and name. */
  | 'recoverer'
  /** Recoverer to a new device: the wallet to take over and the recovery request to join. */
  | 'restore'
  /** New device to recoverer: the request with the new owner key named. */
  | 'join'
  /** Recoverer to new device: the request as sent. */
  | 'requested'
  /** Application to wallet: a connection offer. */
  | 'connect';

export const makeLink = async (page: string, field: LinkField, content: unknown): Promise<string> => {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(content)), new CompressionStream('deflate-raw'));
  return `${page.replace(/#.*$/, '')}#${field}=${toBase64Url(packed)}`;
};

/**
 * Read a link, or the bare code after `#`, of the given kind.
 * @returns `undefined` if the text is not a link of that kind
 * @throws if it is one but cannot be read
 */
export const readLink = async <T>(text: string, field: LinkField): Promise<T | undefined> => {
  const fragment = text.includes('#') ? text.slice(text.indexOf('#') + 1) : text.trim();
  const value = new URLSearchParams(fragment).get(field);
  if (value === null) return undefined;
  try {
    const unpacked = await pipe(fromBase64Url(value), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(unpacked)) as T;
  } catch {
    throw new Error('The link is damaged or incomplete.');
  }
};

/** Which kind of content a link or code carries, if any this project knows. */
export const linkKind = (text: string): LinkField | 'enroll' | undefined => {
  const fragment = text.includes('#') ? text.slice(text.indexOf('#') + 1) : text.trim();
  const parameters = new URLSearchParams(fragment);
  return (['recoverer', 'restore', 'join', 'requested', 'connect', 'enroll'] as const).find((field) => parameters.has(field));
};
