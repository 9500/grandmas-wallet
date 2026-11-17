import { utf8ToBin } from '@bitauth/libauth';
import { testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { MemoryStore, blobIdOf, canonicalJson, generateArchiveId, generateContentKey, keyHashOf, seal, signMessage, unseal, verifyMessage } from '../src/index.js';

const owner = testKey(0x22);

describe('encoding', () => {
  it('encodes a value the same way whatever the order of its fields', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalJson({ a: [true, null, 'x'], b: 1 })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
  });
});

describe('sealing', () => {
  it('cannot be read from a store without the archive key', async () => {
    const store = new MemoryStore('store-one');
    const archiveId = generateArchiveId();
    const contentKey = generateContentKey();
    const plaintext = utf8ToBin('{"kind":"something worth keeping"}');
    const name = await store.put(archiveIdHex(archiveId), seal(contentKey, archiveId, plaintext));
    const sealed = await store.get(archiveIdHex(archiveId), name);
    if (sealed === undefined) throw new Error('nothing stored');

    expect(name).toBe(blobIdOf(sealed));
    expect(unseal(contentKey, archiveId, sealed)).toEqual(plaintext);
    expect(() => unseal(new Uint8Array(32).fill(1), archiveId, sealed)).toThrow('cannot be opened');
    expect(() => unseal(contentKey, generateArchiveId(), sealed)).toThrow('cannot be opened');
    // The stored bytes show nothing of what was sealed.
    expect(new TextDecoder('latin1').decode(sealed)).not.toContain('something worth keeping');
  });
});

describe('signing', () => {
  it('ties a message to its signer and its purpose', () => {
    const signed = signMessage('test/purpose', 'a message', owner);
    expect(verifyMessage('test/purpose', signed)).toBe(true);
    expect(keyHashOf(signed.publicKey)).toEqual(owner.keyHash);
    expect(verifyMessage('test/other-purpose', signed)).toBe(false);
    expect(verifyMessage('test/purpose', { ...signed, message: 'another message' })).toBe(false);
  });
});

const archiveIdHex = (archiveId: Uint8Array): string => Array.from(archiveId, (byte) => byte.toString(16).padStart(2, '0')).join('');
