import { describe, expect, it } from 'vitest';

import {
  Archive,
  MemoryStore,
  RecordError,
  assessArchive,
  generateArchiveId,
  generateContentKey,
  peekRecordEntry,
  positionEntry,
  readArchive,
  readRecord,
  signMessage,
  signRecord,
} from '../src/index.js';
import { WORDS_B, credential, seedOf, setup } from './setup.js';

/**
 * The position record (proposal section 10.2): what it holds, the one form it is written in, what a reader
 * refuses, and how an archive's reader sorts it by who signed it.
 */

const TEMPLATE = 'e1'.repeat(32);
const CATEGORY = 'c7'.repeat(32);
const RECORD = {
  token: { category: CATEGORY, commitment: '0776006b', capability: 'none' as const },
  templateIdentifier: TEMPLATE,
  lockingScriptIdentifier: 'boxLockingScript',
  roleIdentifier: 'holder',
  variables: { boxKey: CATEGORY, unlockTime: '1795192327' },
  values: { unlockTimeBytes: '0776006b', amount: '200000' },
  applicationPage: 'https://example.org/app/',
};

describe('the position record', () => {
  it('holds the token, the script under the engine\'s names, the other values apart, and the page; it is read back as written', () => {
    const { identity, seedA } = setup();
    const entry = positionEntry(RECORD);
    expect(entry).toEqual({ kind: 'position', ...RECORD });
    const signed = signRecord(entry, { network: 'testnet', identity }, seedA.controllerKey);
    // One encoding: keys in order, nothing else.
    expect(signed.message).toBe(
      `{"entry":{"applicationPage":"https://example.org/app/","kind":"position","lockingScriptIdentifier":"boxLockingScript","roleIdentifier":"holder","templateIdentifier":"${TEMPLATE}","token":{"capability":"none","category":"${CATEGORY}","commitment":"0776006b"},"values":{"amount":"200000","unlockTimeBytes":"0776006b"},"variables":{"boxKey":"${CATEGORY}","unlockTime":"1795192327"}},"format":"grandmas-wallet/record","identity":"${identity}","network":"testnet","version":1}`,
    );
    expect(readRecord(signed, 'testnet').entry).toEqual(entry);
    expect(peekRecordEntry(signed)).toEqual(entry);
  });

  it('may name no script, for a token of an application whose scripts the wallet does not follow, and no token, for a position made without one', () => {
    const tokenOnly = positionEntry({ token: RECORD.token, templateIdentifier: TEMPLATE, values: { amount: '5' } });
    expect(tokenOnly).toEqual({ kind: 'position', token: RECORD.token, templateIdentifier: TEMPLATE, values: { amount: '5' } });
    const { token: _token, ...scriptOnly } = RECORD;
    expect(positionEntry(scriptOnly)).not.toHaveProperty('token');
    // Absent fields are left out, so that the record has one form.
    expect(positionEntry({ ...tokenOnly, lockingScriptIdentifier: undefined, applicationPage: undefined })).toEqual(tokenOnly);
  });

  it('is refused when it is not one: part of a script, neither token nor script, a value given twice, a page that is not one, a field not known', () => {
    const refused = (fields: object, why: string) => expect(() => positionEntry(fields as Parameters<typeof positionEntry>[0])).toThrow(why);
    refused({ ...RECORD, roleIdentifier: undefined }, 'names part of a script');
    refused({ templateIdentifier: TEMPLATE, values: {} }, 'names neither a token nor a script');
    refused({ ...RECORD, values: { boxKey: CATEGORY } }, 'both as one of the script\'s and as another');
    refused({ ...RECORD, applicationPage: 'javascript:alert(1)' }, 'not the address of a web page');
    refused({ ...RECORD, applicationPage: 'not an address' }, 'is not an address');
    refused({ ...RECORD, token: { ...RECORD.token, commitment: '0' } }, 'has no commitment');
    refused({ ...RECORD, token: { ...RECORD.token, capability: 'all' } }, 'has no capability');
    refused({ ...RECORD, templateIdentifier: 'savings' }, 'names no template');
    refused({ ...RECORD, variables: { 'not a name': 'x' } }, 'a name the template cannot have');
    refused({ ...RECORD, values: { amount: 200000 } }, 'is not a text');
    refused({ ...RECORD, lockingBytecode: 'aa' }, 'a field "lockingBytecode" this version does not know');
    expect(() => positionEntry({ ...RECORD, roleIdentifier: undefined })).toThrow(RecordError);
  });

  it('a record that is not in its one form, or whose entry is changed after signing, is refused by the reader', () => {
    const { identity, seedA } = setup();
    const signed = signRecord(positionEntry(RECORD), { network: 'testnet', identity }, seedA.controllerKey);
    const spaced = signMessage('grandmas-wallet/record/v1', signed.message.replace('{"entry":', '{ "entry":'), seedA.controllerKey);
    expect(() => readRecord(spaced, 'testnet')).toThrow('not in its canonical form');
    expect(() => readRecord({ ...signed, message: signed.message.replace('200000', '300000') }, 'testnet')).toThrow('signature is not valid');
  });

  it('an archive\'s reader lists position records with whose they are: the current owner\'s, or an earlier owner\'s', async () => {
    const { identity, seedA, wallet, history } = setup();
    const archiveId = generateArchiveId();
    const contentKey = generateContentKey();
    const store = new MemoryStore('store');
    const archive = new Archive(archiveId, contentKey, [store]);
    await archive.write({ type: 'record', signed: signRecord(positionEntry(RECORD), { network: 'testnet', identity }, seedA.controllerKey) });
    const seedB = seedOf(WORDS_B);
    wallet.recover(credential.recoveryKey, seedB.controllerKey);
    await archive.write({ type: 'record', signed: signRecord(positionEntry({ ...RECORD, values: {} }), { network: 'testnet', identity }, seedB.controllerKey) });
    const assessed = assessArchive(await readArchive(archiveId, contentKey, [store]), { network: 'testnet', history: await history() });
    expect(assessed.positions.map(({ entry, standing }) => [entry.values, standing])).toEqual([
      [RECORD.values, 'earlier owner'],
      [{}, 'current owner'],
    ]);
  });
});
