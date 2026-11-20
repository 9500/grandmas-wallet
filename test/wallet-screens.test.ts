import { binToHex } from '@bitauth/libauth';
import { type ActionFinding, type HeldToken, type RecordedPosition, FindingRefusalError, NeedsApplicationError, NotStoredError, applicationConnector } from '@grandmas-wallet/app';
import { type ActionDetails, type Channel, type Proposal, DappRequests } from '@grandmas-wallet/connect';
import { p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { keyedStrongboxTemplate, strongboxTemplate, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { approval, consentOf, leavingLine, leavingWords, refusalOf, tokenList } from '../apps/wallet/src/review-gate.js';
import { type Device, deviceWith, presentation, request } from './support/applications.js';

/**
 * What the wallet's screens for applications rest on (stage 16 of the plan): when the approving button is offered and
 * when it works, the tick and what it is passed on as, the words of a refusal, the list of tokens and positions, and
 * the actions offered at a position that is not confirmed.
 */

const hex = binToHex;
const plainBox = presentation(strongboxTemplate);
const keyedBox = presentation(keyedStrongboxTemplate);
const elsewhere = p2pkhLockingBytecode(testKey(0x41).keyHash);
const leavingKey = { token: { category: 'ab'.repeat(32), commitment: '01', capability: 'none' as const }, how: 'leaves' as const, to: 'Strongbox key' };
const preview = (more: object = {}) => ({ firstUse: false, ...more });

describe('the approving button of a review', () => {
  it('works only once the tick is given, where tokens leave the wallet', () => {
    const asked = preview({ tokensLeaving: [leavingKey] });
    expect(approval({ preview: asked, refused: false, backup: 'answers', ticked: false })).toEqual({ shown: true, enabled: false, tick: true, blocked: 'tick' });
    expect(approval({ preview: asked, refused: false, backup: 'answers', ticked: true })).toEqual({ shown: true, enabled: true, tick: true });
    expect(consentOf({ tick: true }, true)).toEqual({ tokensLeave: true });
    expect(consentOf({ tick: true }, false)).toEqual({});
    // Nothing leaves: no tick asked for, and none passed on.
    expect(approval({ preview: preview(), refused: false, backup: 'answers', ticked: false })).toEqual({ shown: true, enabled: true, tick: false });
    expect(consentOf({ tick: false }, true)).toEqual({});
  });

  it('is not there where the wallet refuses, or while the action is worked out', () => {
    expect(approval({ refused: true, backup: 'answers', ticked: true })).toMatchObject({ shown: false, enabled: false, blocked: 'refused' });
    expect(approval({ preview: preview({ tokensLeaving: [leavingKey] }), refused: true, backup: 'answers', ticked: true })).toMatchObject({ shown: false, tick: false });
    expect(approval({ refused: false, backup: 'checking', ticked: false })).toMatchObject({ shown: false, blocked: 'working out' });
  });

  it('is not offered where no backup store answers for an action that has to be stored first', () => {
    const stored = preview({ recordsPosition: true });
    expect(approval({ preview: stored, refused: false, backup: 'unreachable', ticked: false })).toMatchObject({ shown: false, blocked: 'backup unreachable' });
    expect(approval({ preview: stored, refused: false, backup: 'none', ticked: false })).toMatchObject({ shown: false, blocked: 'no backup' });
    expect(approval({ preview: stored, refused: false, backup: 'checking', ticked: false })).toMatchObject({ shown: true, enabled: false, blocked: 'checking backup' });
    expect(approval({ preview: preview({ firstUse: true }), refused: false, backup: 'unreachable', ticked: false })).toMatchObject({ shown: false });
    // An action that leaves nothing behind does not wait for a store.
    expect(approval({ preview: preview(), refused: false, backup: 'unreachable', ticked: false })).toMatchObject({ shown: true, enabled: true });
  });
});

describe('the words of a refusal and of the tick', () => {
  const finding = (kind: ActionFinding['finding']): ActionFinding => ({ action: 'open', role: 'provider', name: 'Open a pool', finding: kind, outputs: [{ output: 'poolOutput', name: 'Pool', lockingScript: 'pool', scriptName: 'Pool', keys: kind === 'cannot tell' ? [] : ['poolKey'], ...(kind === 'cannot tell' ? { expression: true as const } : {}) }] });

  it('says plainly what the wallet found, with its full reason behind a "?"', () => {
    const tied = refusalOf(new FindingRefusalError(finding('does not come back')), 'otherwise');
    expect(tied).toMatchObject({ kind: 'ties to phone', title: 'This wallet won\'t do this', words: 'This would tie money to this phone alone. If the phone is lost, nobody can get it back.' });
    expect(tied.detail).toMatch(/"Pool" would be at "Pool", a script that takes a key of this device/);
    expect(refusalOf(new FindingRefusalError(finding('cannot tell')), 'otherwise')).toMatchObject({ kind: 'cannot tell', words: 'It can\'t tell whether this money would come back if the phone is lost.' });
    expect(refusalOf(new NeedsApplicationError('It spends a coin of the application\'s.', 'https://page.example/'), 'otherwise')).toEqual({ kind: 'application', title: 'Open the application to do this', words: 'This wallet can\'t do it by itself. Its page:', detail: 'It spends a coin of the application\'s.', page: 'https://page.example/' });
    expect(refusalOf(new NotStoredError('No backup store confirmed the record of what the action leaves: x. Nothing was signed. Try again when a store can be reached.'), 'otherwise')).toMatchObject({ kind: 'backup', words: 'Your backup can\'t be reached. Try again in a moment.' });
    expect(refusalOf(new Error('Something else.'), 'Something else, in plain words.')).toEqual({ kind: 'other', title: 'This wallet would not carry it out', words: 'Something else, in plain words.' });
  });

  it('says what becomes of each token that does not come back as it is', () => {
    expect(leavingLine(leavingKey)).toBe('It goes to "Strongbox key" and leaves this wallet.');
    expect(leavingLine({ ...leavingKey, how: 'changes' })).toBe('It comes back changed.');
    expect(leavingLine({ ...leavingKey, how: 'ends' })).toBe('It is destroyed. Nobody can use it again.');
    expect(leavingLine({ ...leavingKey, made: true, to: 'Coat' })).toBe('Made now from your coin, it goes to "Coat", not to this wallet.');
    expect(leavingWords([leavingKey])).toEqual({ title: 'Your token leaves this wallet', tick: 'I understand that whoever gets this token gets what it controls' });
    expect(leavingWords([{ ...leavingKey, how: 'changes' }])).toEqual({ title: 'Your token comes back changed', tick: 'I understand what happens to this token' });
    expect(leavingWords([leavingKey, { ...leavingKey, made: true }]).title).toBe('2 tokens don\'t come back as they are');
  });
});

/** A connection to the wallet's connector, as an application has it: a pair of queues in memory. */
const connectTo = (device: Device) => {
  let proposals: Proposal[] = [];
  const connector = applicationConnector(device.applications, { onProposals: (open) => (proposals = open) });
  const toWallet: ((message: unknown) => void)[] = [];
  const toDapp: ((message: unknown) => void)[] = [];
  let sequence = 0;
  const end = (out: ((message: unknown) => void)[], incoming: ((message: unknown) => void)[]): Channel => ({
    send: async (message) => {
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      incoming.push(handler);
      return () => void incoming.splice(incoming.indexOf(handler), 1);
    },
    nextSequence: () => (sequence += 2),
  });
  connector.attach('an application', end(toDapp, toWallet));
  const dapp = new DappRequests();
  dapp.attach(end(toWallet, toDapp));
  /** Ask for an action, and approve it as the user would, with or without the tick. */
  const ask = async (details: ActionDetails, ticked: boolean): Promise<Record<string, unknown>> => {
    const result = dapp.request(details, plainBox.texts);
    for (let turn = 0; turn < 40 && proposals.length === 0; turn++) await new Promise((done) => setTimeout(done, 0));
    await proposals[0]?.approve(ticked ? { tokensLeave: true } : undefined);
    return result;
  };
  return { ask, connector };
};

describe('the wallet\'s screens on the wallet', () => {
  it('a request whose token leaves the wallet is carried out with the tick the user gave, and refused without it', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const { ask, connector } = connectTo(device);
    const opened = (await ask({ template: plainBox.names, templateAction: 'open', role: 'holder', variables: { amount: 30_000, label: '01' } }, false)) as { tokens: { category: string }[] };
    const key = opened.tokens[0]?.category as string;
    const away: ActionDetails = { template: plainBox.names, templateAction: 'take', role: 'holder', variables: { keyInput: 1, holder: hex(elsewhere) }, about: { category: key, spent: true } };
    const before = device.chain.broadcasts;
    await expect(ask(away, false)).rejects.toThrow(/It is carried out only when you tick/);
    expect(device.chain.broadcasts).toBe(before);
    await ask(away, true);
    expect(device.chain.broadcasts).toBe(before + 1);
    expect(device.chain.outputsAt(elsewhere).map(({ output }) => hex(output.token?.category ?? new Uint8Array()))).toEqual([key]);
    expect(connector.ledger.map(({ status }) => status)).toEqual(['done', 'failed', 'done']);
  }, 60_000);

  it('a position that is not confirmed offers taking out and no paying in; the backup is asked whether it answers', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const [box] = await device.applications.recordedPositions();
    expect(box).toMatchObject({ status: 'open', tokenName: 'Strongbox key', template: { name: 'Keyed strongbox' } });
    const actions = (position: Pick<RecordedPosition, 'template' | 'record' | 'status'>) => device.applications.offeredActions(position).map(({ action }) => action);
    expect(actions(box as RecordedPosition)).toEqual(['take', 'add']);
    expect(actions({ ...(box as RecordedPosition), status: 'unconfirmed' })).toEqual(['take']);

    expect(await device.applications.backupAnswers()).toBe(true);
    for (const store of device.stores.values()) store.unreachable = true;
    expect(await device.applications.backupAnswers()).toBe(false);
  }, 60_000);

  it('lists positions from records, those not confirmed apart, and every other token as a token', () => {
    const token = (outpoint: string): HeldToken => ({ category: 'cd'.repeat(32), commitment: '', amount: 0n, place: 'address', outpoint, satoshis: 1_000n, meaning: 'unknown' });
    const position = (outpoint: string, status: RecordedPosition['status'], template = 'bare'): RecordedPosition =>
      ({ token: { ...token(outpoint), capability: 'none' }, template: { identifier: template }, status, record: { kind: 'position', templateIdentifier: template, values: {} }, standing: 'own' }) as RecordedPosition;
    const list = tokenList([position('a:0', 'open'), position('b:0', 'closed'), position('c:0', 'held'), position('d:0', 'unconfirmed'), position('e:0', 'open', 'other')], ['a:0', 'b:0', 'c:0', 'd:0', 'e:0', 'f:0', 'g:0'].map(token));
    // Every recorded position is listed from its record, whatever its template.
    expect(list.positions.map(({ token: { outpoint } }) => outpoint)).toEqual(['a:0', 'b:0', 'e:0']);
    expect(list.held.map(({ token: { outpoint } }) => outpoint)).toEqual(['c:0']);
    expect(list.unconfirmed.map(({ token: { outpoint } }) => outpoint)).toEqual(['d:0']);
    // A token that no record lists as a position is listed as a token, and only it.
    expect(list.tokens.map(({ outpoint }) => outpoint)).toEqual(['f:0', 'g:0']);
  });
});
