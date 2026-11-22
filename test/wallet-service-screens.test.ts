import { type ApplicationAction, type RecordedPosition, type ServiceStatus, type TemplateAction, InputsSpentError, ServiceAnswerRefusedError, ServiceDeclinedError, ServiceUnreachableError } from '@grandmas-wallet/app';
import { describe, expect, it } from 'vitest';

import { SERVICE_ANSWER_REFUSED, SPENT_FIRST, refusalOf } from '../apps/wallet/src/review-gate.js';
import { actionsShown, checkedLine, notAsked, requestFor, saysLine, serviceHost, serviceShown, typedWords, unavailable, usableService } from '../apps/wallet/src/template-actions.js';

/**
 * What the wallet's screens show about a template's service (docs/xo-service.md): its state in a few words, which of the
 * template's actions get a button, the tokens it made that wait elsewhere, the words of a failure, and the request an
 * action screen works out. Every name comes from the template; the words here are invented.
 */

const time = (seconds: number): string => `at ${seconds}`;
const URL_ = 'https://service.example/xo';
const status = (more: Partial<ServiceStatus>): ServiceStatus => ({ description: 'The test service', url: URL_, state: 'never asked', ...more });
const action = (name: string, more: Partial<TemplateAction> = {}): TemplateAction => ({ action: name, role: 'user', name: `The ${name}`, description: `What ${name} does.`, ...more });

describe('the service of a template, as its card shows it', () => {
  it('names it by its host, and says where it stands in a few words with the button that fits', () => {
    expect(serviceHost(URL_)).toBe('service.example');
    expect(serviceHost('not an address')).toBeUndefined();
    expect(serviceShown(status({}), time)).toEqual({ name: 'service.example', state: 'Not asked yet', button: 'Connect' });
    expect(serviceShown(status({ state: 'reached', reachedAt: 5, checkedAt: 7 }), time)).toEqual({ name: 'service.example', state: 'Connected', when: 'Checked at 7', button: 'Check again' });
    expect(serviceShown(status({ state: 'not reached', failure: { at: 9, kind: 'unreachable', message: 'The service can\'t be reached. Nothing was sent.' } }), time)).toEqual({
      name: 'service.example',
      state: 'Not reached',
      when: 'Tried at 9',
      failure: 'The service can\'t be reached. Nothing was sent.',
      button: 'Connect',
    });
    // An address that cannot be used: the template's words for it, why behind a "?", and nothing to press.
    expect(serviceShown({ description: 'The test service', state: 'not usable', problem: 'The address is not https.' }, time)).toEqual({ name: 'The test service', state: 'Address not usable', problem: 'The address is not https.' });
  });

  it('offers Connect in place of an action under a token only where the service can be used and has not answered', () => {
    expect(usableService(undefined)).toBe(false);
    expect(usableService(status({ state: 'not usable' }))).toBe(false);
    expect(usableService(status({ state: 'reached' }))).toBe(true);
    expect(notAsked(status({}))).toBe(true);
    expect(notAsked(status({ state: 'not reached' }))).toBe(true);
    expect(notAsked(status({ state: 'reached' }))).toBe(false);
    expect(notAsked(undefined)).toBe(false);
  });
});

describe('a template\'s actions, as its page lists them', () => {
  it('gives the starting actions a button and names the others once each, done from their token', () => {
    const summary = { actions: [{ action: 'open', name: 'The open', description: '' }, { action: 'act', name: 'The act', description: 'Act.' }, { action: 'act', name: 'The act', description: 'Act.' }] };
    const shown = actionsShown(summary, { starting: [action('open', { service: {} })], waiting: [] });
    expect(shown.starting.map(({ action: name }) => name)).toEqual(['open']);
    expect(shown.others).toEqual([{ action: 'act', name: 'The act', description: 'Act.' }]);
    expect(shown.waiting).toEqual([]);
  });

  it('names the role beside each starting action only where they are under more than one role', () => {
    const summary = { actions: [{ action: 'open', name: 'The open', description: '' }, { action: 'join', name: 'The join', description: '' }] };
    const two = actionsShown(summary, { starting: [action('open', { role: 'host' }), action('join', { role: 'guest' }), action('open', { role: 'guest' })], roleNames: { host: 'The host', guest: 'The guest' }, waiting: [] });
    expect(two.starting.map(({ action: name, role }) => [name, role])).toEqual([['open', 'host'], ['join', 'guest'], ['open', 'guest']]);
    expect(two.roles).toEqual(['The host', 'The guest', 'The guest']);
    expect(two.others).toEqual([]);
    const one = actionsShown(summary, { starting: [action('open', { role: 'host' })], waiting: [] });
    expect(one).not.toHaveProperty('roles');
  });

  it('lists each token that waits elsewhere once, under the template\'s name for where it waits, with its actions', () => {
    const waiting = [
      action('act', { waiting: { category: 'aa'.repeat(32), at: 'Shared script' } }),
      action('close', { waiting: { category: 'aa'.repeat(32), at: 'Shared script' } }),
      action('act', { waiting: { category: 'bb'.repeat(32), at: 'Shared script' } }),
    ];
    const shown = actionsShown({ actions: [] }, { starting: [], waiting });
    expect(shown.waiting.map(({ category, at, actions }) => [category.slice(0, 2), at, actions.map(({ action: name }) => name)])).toEqual([
      ['aa', 'Shared script', ['act', 'close']],
      ['bb', 'Shared script', ['act']],
    ]);
  });

  it('says what the service said: why a starting action is not offered now, the values it states, and when it was asked', () => {
    expect(unavailable(action('open', { service: { available: false, reason: 'Nothing can be opened now.', checkedAt: 3 } }))).toBe('The service says: Nothing can be opened now.');
    // Never asked, or available: offered, and checked when the user acts.
    expect(unavailable(action('open', { service: {} }))).toBeUndefined();
    expect(unavailable(action('open', { service: { available: true } }))).toBeUndefined();
    expect(saysLine(action('act', { service: { says: [{ variable: 'price', name: 'Price', value: '7' }, { variable: 'due', name: 'Due', value: '12' }] } }))).toBe('From the service: Price 7 · Due 12');
    expect(saysLine(action('act'))).toBeUndefined();
    // By the template's types, as the action's form asks for them: a run with real values showed bare digits, such as "Collateral 119789172".
    expect(saysLine(action('act', { service: { says: [{ variable: 'held', name: 'Collateral', value: '119789172', type: 'satoshis' }, { variable: 'owed', name: 'Debt', value: '20000', type: 'token_amount' }, { variable: 'rate', name: 'Rate', value: '12345', type: 'integer' }, { variable: 'state', name: 'State', value: '22000000', type: 'bytes' }] } }))).toBe('From the service: Collateral 119,789,172 sat · Debt 20,000 units · Rate 12,345 · State 22000000');
    expect(typedWords('satoshis', 'not a number')).toBe('not a number');
    expect(typedWords(undefined, '1000000')).toBe('1000000');
    expect(checkedLine([action('a', { service: { checkedAt: 3 } }), action('b'), action('c', { service: { checkedAt: 8 } })], time)).toBe('Checked with its service at 8');
    expect(checkedLine([action('a')], time)).toBeUndefined();
  });
});

describe('an action screen', () => {
  it('asks the wallet for the request of what it acts on: a token it holds, a starting action, or a token that waits elsewhere', () => {
    const asked: unknown[][] = [];
    const made = (kind: string) => (...args: unknown[]): ApplicationAction => {
      asked.push([kind, ...args]);
      return { template: { identifier: 'cc'.repeat(32), contentHash: 'dd'.repeat(32) }, action: String(args.at(-2)), role: 'user', variables: {} };
    };
    const applications = { actionOn: made('on'), startAction: made('start'), waitingAction: made('waiting') };
    const template = { identifier: 'cc'.repeat(32), name: 'Test' };
    const position = { template } as unknown as RecordedPosition;
    requestFor(applications, { kind: 'token', position }, 'act', { amount: '5' });
    requestFor(applications, { kind: 'start', template, role: 'user' }, 'open', {});
    requestFor(applications, { kind: 'waiting', template, category: 'aa'.repeat(32), at: 'Shared script' }, 'act', { amount: '6' });
    expect(asked).toEqual([
      ['on', position, 'act', { amount: '5' }],
      // A starting action goes with the role its offer named.
      ['start', template.identifier, 'open', {}, 'user'],
      ['waiting', template.identifier, 'aa'.repeat(32), 'act', { amount: '6' }],
    ]);
  });
});

describe('the words of a failure of an action carried out with a service', () => {
  it('the service cannot be reached: in the client\'s words, to be tried again', () => {
    expect(refusalOf(new ServiceUnreachableError('The service can\'t be reached. Nothing was sent.', 'unreachable'), 'otherwise')).toEqual({ kind: 'service', title: 'Not carried out', words: 'The service can\'t be reached. Nothing was sent.', again: 'try' });
  });

  it('the service declined: its own words, quoted as its words', () => {
    expect(refusalOf(new ServiceDeclinedError('The service declined: Not today.', 'not-possible'), 'otherwise')).toEqual({ kind: 'declined', title: 'The service declined', words: '“Not today.”' });
  });

  it('the wallet refused what the service added: said plainly, nothing signed, the full reason behind a "?"', () => {
    const refusal = refusalOf(new ServiceAnswerRefusedError('The service stated "Holder", which is the wallet\'s to state.', 'wallet-variable'), 'otherwise');
    expect(refusal).toMatchObject({ kind: 'service', title: 'Not carried out', words: SERVICE_ANSWER_REFUSED });
    expect(refusal.detail).toMatch(/stated "Holder", which is the wallet's to state\. Nothing was signed\.$/);
    expect(refusal.again).toBeUndefined();
  });

  it('a coin was spent first: asked again, for a fresh review and a new approval', () => {
    expect(refusalOf(new InputsSpentError('The service declined: The shared coin was spent. Ask again.'), 'otherwise')).toEqual({ kind: 'spent first', title: 'Not carried out', words: SPENT_FIRST, detail: 'The service declined: The shared coin was spent. Ask again.', again: 'ask' });
  });
});
