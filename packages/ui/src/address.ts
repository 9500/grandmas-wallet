import { cashAddressToLockingBytecode } from '@bitauth/libauth';

/**
 * Read an address typed or pasted by a person, for the network the page is on. A test network takes the
 * `bchtest` and `bchreg` prefixes; the prefix may be left out.
 *
 * @throws with a reason in plain words
 */
export const lockingBytecodeOfAddress = (text: string, network: 'mainnet' | 'testnet'): Uint8Array => {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('Enter an address.');
  const prefixes = network === 'mainnet' ? ['bitcoincash'] : ['bchtest', 'bchreg'];
  const candidates = trimmed.includes(':') ? [trimmed.toLowerCase()] : prefixes.map((prefix) => `${prefix}:${trimmed.toLowerCase()}`);
  for (const candidate of candidates) {
    const decoded = cashAddressToLockingBytecode(candidate);
    if (typeof decoded === 'string') continue;
    if (!prefixes.includes(decoded.prefix)) throw new Error(network === 'mainnet' ? 'That address is for a test network.' : 'That address is for the main network; this page uses test coins.');
    return decoded.bytecode;
  }
  throw new Error('That is not a Bitcoin Cash address. Check it and try again.');
};
