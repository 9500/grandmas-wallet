import { cashAddressToLockingBytecode } from '@bitauth/libauth';

/** An address as a person typed or pasted it, read. */
export interface ReadAddress {
  lockingBytecode: Uint8Array;
  /**
   * Whether it is written in the form that says the receiving wallet takes tokens. Both forms of an address
   * pay the same script; the form is the receiver's word that its wallet knows tokens.
   */
  tokenAware: boolean;
}

/**
 * Read an address typed or pasted by a person, for the network the page is on. A test network takes the
 * `bchtest` and `bchreg` prefixes; the prefix may be left out.
 *
 * @throws with a reason in plain words
 */
export const readAddress = (text: string, network: 'mainnet' | 'testnet'): ReadAddress => {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('Enter an address.');
  const prefixes = network === 'mainnet' ? ['bitcoincash'] : ['bchtest', 'bchreg'];
  const candidates = trimmed.includes(':') ? [trimmed.toLowerCase()] : prefixes.map((prefix) => `${prefix}:${trimmed.toLowerCase()}`);
  for (const candidate of candidates) {
    const decoded = cashAddressToLockingBytecode(candidate);
    if (typeof decoded === 'string') continue;
    if (!prefixes.includes(decoded.prefix)) throw new Error(network === 'mainnet' ? 'That address is for a test network.' : 'That address is for the main network; this page uses test coins.');
    return { lockingBytecode: decoded.bytecode, tokenAware: decoded.tokenSupport };
  }
  throw new Error('That is not a Bitcoin Cash address. Check it and try again.');
};

/** Read an address typed or pasted by a person, as `readAddress` does, in either form. */
export const lockingBytecodeOfAddress = (text: string, network: 'mainnet' | 'testnet'): Uint8Array => readAddress(text, network).lockingBytecode;

/** An address in the plain form, given where a token is to be sent. Nothing is built for it. */
export class PlainAddressError extends Error {
  constructor() {
    super('This address is written in the plain form, which does not say that the receiving wallet knows tokens. A wallet that does not know tokens can destroy them. Ask the receiver for their token address: a wallet that takes tokens shows it when receiving tokens, and after the prefix it starts with "z" or "r".');
    this.name = 'PlainAddressError';
  }
}

/**
 * Read the address a token is to be sent to. Only the token-aware form is taken.
 *
 * @throws PlainAddressError for an address in the plain form; an Error with a reason for anything else
 */
export const tokenDestination = (text: string, network: 'mainnet' | 'testnet'): Uint8Array => {
  const read = readAddress(text, network);
  if (!read.tokenAware) throw new PlainAddressError();
  return read.lockingBytecode;
};
