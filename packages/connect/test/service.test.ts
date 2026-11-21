import { describe, expect, it } from 'vitest';

import {
  type ServiceFetch,
  type ServiceHandlers,
  type ServiceItem,
  type ServiceNetworks,
  type ServiceRequest,
  type ServiceToken,
  type TemplateName,
  SERVICE_CORS_HEADERS,
  SERVICE_ERROR_CODES,
  SERVICE_HELLO,
  SERVICE_HELLO_ANSWER,
  SERVICE_IDENTIFIERS,
  SERVICE_LIMITS,
  ServiceProtocolError,
  XO_SERVICE,
  XO_SERVICE_VERSION,
  answerServiceRequest,
  buildServiceHello,
  buildServiceHelloAnswer,
  buildServiceJoinRequest,
  buildServiceJoinResult,
  buildServicePossible,
  buildServicePossibleRequest,
  checkJoinedInvitation,
  decodeServiceBody,
  encodeServiceBody,
  findServiceResource,
  parseServiceAnswer,
  parseServiceHello,
  parseServiceHelloAnswer,
  parseServiceJoinRequest,
  parseServiceJoinResult,
  parseServicePossible,
  parseServicePossibleRequest,
  parseServiceRequest,
  readInvitationOutline,
  serviceCarriageFailure,
  serviceExchange,
} from '../src/index.js';

/**
 * The messages between a wallet and an application's service (`xo_service_v1`, docs/xo-service.md): what each side
 * sends, what it refuses, where a template names its service, and the carriage in both directions, in memory.
 */
const hash = (seed: string): string => seed.repeat(32);
const TEMPLATE: TemplateName = { identifier: hash('a1'), contentHash: hash('aa') };
const CHIPNET = { network: 'chipnet' };
const TIME = 1_790_000_000;
const TOKEN: ServiceToken = { category: hash('c1'), commitment: '01ab', capability: 'none', outpoint: `${hash('d1')}:0` };
const ITEM: ServiceItem = {
  ref: 'loan-7',
  category: hash('c1'),
  action: 'repay',
  lockingScript: 'aa20' + hash('e1') + '87',
  coin: `${hash('f1')}:1`,
  about: { category: hash('c1'), spent: true },
  bindings: { payout: 'receive' },
  says: [
    { variable: 'debt', value: '1250' },
    { variable: 'rate', value: 3 },
  ],
};

const commit = (identifier: string, entity: string, more: Record<string, unknown> = {}) => ({
  commitIdentifier: identifier,
  entityIdentifier: entity,
  createdAtTimestamp: '<bigint: 1790000000n>',
  data: { variables: [{ variableIdentifier: 'amount', value: '<bigint: 5000n>' }], inputs: [], outputs: [] },
  signature: '<uint8array: 3045>',
  expiresAtTimestamp: '<bigint: 1790003600n>',
  ...more,
});
const invitationOf = (commits: unknown[], more: Record<string, unknown> = {}): string =>
  JSON.stringify({ invitationIdentifier: 'invitation-1', createdAtTimestamp: '<bigint: 1790000000n>', templateIdentifier: TEMPLATE.identifier, actionIdentifier: 'repay', commits, ...more });
const STARTED = invitationOf([commit('c-wallet', 'e-wallet')]);
const JOINED = invitationOf([commit('c-wallet', 'e-wallet'), commit('c-service', 'e-service')]);

const envelope = (more: Record<string, unknown> = {}) => ({ network: 'chipnet', id: 'm-1', time: TIME, ...more });

const hello = () => buildServiceHello({ ...envelope(), template: TEMPLATE, role: 'borrower' });
const possibleRequest = () => buildServicePossibleRequest({ ...envelope(), template: TEMPLATE, role: 'borrower', tokens: [TOKEN], made: [{ category: hash('c2'), transactionId: hash('d2') }] });
const joinRequest = () => buildServiceJoinRequest({ ...envelope(), ref: 'loan-7', invitation: STARTED });

/** The message as it arrives on the other side: through its body. */
const carried = (message: Parameters<typeof encodeServiceBody>[0]): Record<string, unknown> => decodeServiceBody(encodeServiceBody(message)) as Record<string, unknown>;

const refusal = (read: () => unknown, words: string | RegExp, code?: string) => {
  let caught: unknown;
  try {
    read();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ServiceProtocolError);
  expect((caught as Error).message).toMatch(words);
  expect((caught as ServiceProtocolError).code).toBe(code);
};

describe('the constants', () => {
  it('name the protocol, its version, the identifiers known and the limits', () => {
    expect(XO_SERVICE).toBe('xo_service_v1');
    expect(XO_SERVICE_VERSION).toBe(1);
    expect(SERVICE_IDENTIFIERS).toEqual(['xo_service_v1']);
    expect(SERVICE_LIMITS).toMatchObject({ requestBytes: 65_536, answerBytes: 131_072, timeoutMs: 10_000, joinTimeoutMs: 25_000, entries: 32, ref: 128, error: 200 });
    expect(SERVICE_ERROR_CODES).toEqual(['inputs-spent', 'not-possible', 'unknown-template', 'wrong-network', 'version', 'bad-invitation', 'too-large', 'too-many']);
  });
});

describe('every message, there and back', () => {
  it('a hello and its answers', () => {
    const sent = hello();
    expect(sent).toEqual({ action: SERVICE_HELLO, version: 1, network: 'chipnet', id: 'm-1', time: TIME, template: TEMPLATE, role: 'borrower' });
    expect(parseServiceHello(carried(sent), CHIPNET)).toEqual(sent);
    const answer = buildServiceHelloAnswer(envelope(), { ok: true, serves: [{ template: TEMPLATE, role: 'lender' }] });
    expect(answer).toEqual({ action: SERVICE_HELLO_ANSWER, version: 1, network: 'chipnet', id: 'm-1', time: TIME, ok: true, serves: [{ template: TEMPLATE, role: 'lender' }], limits: { requestBytes: 65_536, entries: 32 } });
    expect(parseServiceHelloAnswer(carried(answer), CHIPNET)).toEqual(answer);
    const lower = buildServiceHelloAnswer(envelope(), { ok: true, serves: [], limits: { requestBytes: 8_000, entries: 4 } });
    expect(parseServiceAnswer(carried(lower), CHIPNET)).toEqual(lower);
    const refused = buildServiceHelloAnswer(envelope(), { ok: false, error: 'This service does not serve that template.', code: 'unknown-template' });
    expect(parseServiceHelloAnswer(carried(refused), CHIPNET)).toEqual(refused);
  });

  it('a possible request and its answers', () => {
    const sent = possibleRequest();
    expect(parseServicePossibleRequest(carried(sent), CHIPNET)).toEqual(sent);
    expect(parseServiceRequest(carried(sent), CHIPNET)).toEqual(sent);
    const answer = buildServicePossible(envelope(), { ok: true, height: 280_000, start: [{ action: 'borrow', available: true }, { action: 'open', available: false, reason: 'No loans are offered now.' }], items: [ITEM, { ref: 'r', category: hash('c3'), action: 'deposit' }] });
    expect(parseServicePossible(carried(answer), CHIPNET)).toEqual(answer);
    const refused = buildServicePossible(envelope(), { ok: false, error: 'The chain cannot be read just now.' });
    expect(parseServicePossible(carried(refused), CHIPNET)).toEqual(refused);
  });

  it('a join request, with and without a ref, and its answers', () => {
    const sent = joinRequest();
    expect(parseServiceJoinRequest(carried(sent), CHIPNET)).toEqual(sent);
    const starting = buildServiceJoinRequest({ ...envelope(), invitation: STARTED });
    expect(starting).not.toHaveProperty('ref');
    expect(parseServiceRequest(carried(starting), CHIPNET)).toEqual(starting);
    const answer = buildServiceJoinResult(envelope(), { ok: true, invitation: JOINED });
    expect(parseServiceJoinResult(carried(answer), CHIPNET)).toEqual(answer);
    const refused = buildServiceJoinResult(envelope(), { ok: false, error: 'The shared coin was spent.', code: 'inputs-spent' });
    expect(parseServiceJoinResult(carried(refused), CHIPNET)).toEqual(refused);
  });

  it('a builder shortens a long refusal and fills an empty one, and refuses what does not make a message', () => {
    const long = buildServiceJoinResult(envelope(), { ok: false, error: 'x'.repeat(500) });
    expect(long.ok === false && long.error.length).toBe(200);
    const empty = buildServiceJoinResult(envelope(), { ok: false, error: '' });
    expect(empty.ok === false && empty.error).toBe('The service refused.');
    refusal(() => buildServiceHello({ ...envelope(), template: { identifier: 'nope', contentHash: hash('aa') }, role: 'borrower' }), /template/);
    refusal(() => buildServiceJoinRequest({ ...envelope(), invitation: 'not json' }), /not JSON/, 'bad-invitation');
  });
});

describe('what the parsers refuse', () => {
  const asHello = () => carried(hello());

  it('a message of another kind, version or network', () => {
    refusal(() => parseServiceHello('hello', CHIPNET), /^Not hello/);
    refusal(() => parseServiceHello({ ...asHello(), action: 'xo_service_join_request' }, CHIPNET), /^Not hello/);
    refusal(() => parseServiceRequest({ ...asHello(), action: 'xo_action_request' }, CHIPNET), /Not a message/);
    refusal(() => parseServiceAnswer(asHello(), CHIPNET), /Not an answer/);
    refusal(() => parseServiceHello({ ...asHello(), version: undefined }, CHIPNET), /version/, 'version');
    refusal(() => parseServiceHello({ ...asHello(), version: 2, other: true }, CHIPNET), /version 2 .* version 1/, 'version');
    refusal(() => parseServiceHello(asHello(), { network: 'mainnet' }), /about chipnet, not mainnet/, 'wrong-network');
    refusal(() => parseServiceHello({ ...asHello(), network: undefined }, CHIPNET), /network/);
  });

  it('an unknown field, anywhere', () => {
    refusal(() => parseServiceHello({ ...asHello(), wallet: 'name' }, CHIPNET), /does not know: "wallet"/);
    refusal(() => parseServiceHello({ ...asHello(), template: { ...TEMPLATE, url: 'x' } }, CHIPNET), /does not know: "url"/);
    refusal(() => parseServicePossibleRequest({ ...carried(possibleRequest()), tokens: [{ ...TOKEN, amount: '1' }] }, CHIPNET), /does not know: "amount"/);
    refusal(() => parseServicePossible({ ...carried(buildServicePossible(envelope(), { ok: true, height: 1, start: [], items: [] })), items: [{ ...ITEM, secret: 'x' }] }, CHIPNET), /does not know: "secret"/);
    refusal(() => parseServicePossible({ ...carried(buildServicePossible(envelope(), { ok: true, height: 1, start: [], items: [] })), items: [{ ...ITEM, about: { ...ITEM.about, more: 1 } }] }, CHIPNET), /position/);
    refusal(() => parseServiceHelloAnswer({ ...carried(buildServiceHelloAnswer(envelope(), { ok: true, serves: [] })), entity: 'e-service' }, CHIPNET), /does not know: "entity"/);
    refusal(() => parseServiceHelloAnswer({ ...carried(buildServiceHelloAnswer(envelope(), { ok: true, serves: [] })), limits: { requestBytes: 10, entries: 1, time: 1 } }, CHIPNET), /does not know: "time"/);
    // A refusal carries only its words and its code.
    refusal(() => parseServiceJoinResult({ ...carried(buildServiceJoinResult(envelope(), { ok: false, error: 'No.' })), invitation: JOINED }, CHIPNET), /does not know: "invitation"/);
  });

  it('a field of the wrong kind', () => {
    refusal(() => parseServiceHello({ ...asHello(), id: 'x'.repeat(81) }, CHIPNET), /wrong kind/);
    refusal(() => parseServiceHello({ ...asHello(), time: 1.5 }, CHIPNET), /wrong kind/);
    refusal(() => parseServiceHello({ ...asHello(), template: TEMPLATE.identifier }, CHIPNET), /identifier and content hash/);
    refusal(() => parseServiceHello({ ...asHello(), role: '' }, CHIPNET), /role/);
    refusal(() => parseServicePossibleRequest({ ...carried(possibleRequest()), tokens: [{ ...TOKEN, capability: 'all' }] }, CHIPNET), /token/);
    refusal(() => parseServicePossibleRequest({ ...carried(possibleRequest()), tokens: [{ ...TOKEN, commitment: '0' }] }, CHIPNET), /token/);
    refusal(() => parseServicePossibleRequest({ ...carried(possibleRequest()), tokens: [{ ...TOKEN, outpoint: hash('d1') }] }, CHIPNET), /token/);
    refusal(() => parseServicePossibleRequest({ ...carried(possibleRequest()), made: 'all' }, CHIPNET), /not a list/);
    refusal(() => parseServicePossibleRequest({ ...carried(possibleRequest()), made: [{ category: hash('c2') }] }, CHIPNET), /category/);
  });

  it('too many entries, and texts too long', () => {
    refusal(() => parseServicePossibleRequest({ ...carried(possibleRequest()), tokens: Array.from({ length: 33 }, () => TOKEN) }, CHIPNET), /more tokens than the 32/, 'too-many');
    const answer = carried(buildServicePossible(envelope(), { ok: true, height: 1, start: [], items: [] }));
    refusal(() => parseServicePossible({ ...answer, items: Array.from({ length: 33 }, () => ITEM) }, CHIPNET), /more items/, 'too-many');
    refusal(() => parseServicePossible({ ...answer, items: [{ ...ITEM, says: Array.from({ length: 33 }, () => ({ variable: 'a', value: 1 })) }] }, CHIPNET), /more statements/, 'too-many');
    refusal(() => parseServicePossible({ ...answer, items: [{ ...ITEM, ref: 'r'.repeat(129) }] }, CHIPNET), /ref is longer than 128/, 'too-large');
    refusal(() => parseServiceJoinRequest({ ...carried(joinRequest()), ref: 'r'.repeat(129) }, CHIPNET), /ref is longer than 128/, 'too-large');
    refusal(() => parseServiceJoinRequest({ ...carried(joinRequest()), invitation: 'x'.repeat(SERVICE_LIMITS.requestBytes + 1) }, CHIPNET), /larger/, 'too-large');
    refusal(() => parseServiceJoinResult({ ...carried(buildServiceJoinResult(envelope(), { ok: false, error: 'No.' })), error: 'x'.repeat(201) }, CHIPNET), /200 characters/);
  });

  it('what an answer may not say', () => {
    const helloAnswer = carried(buildServiceHelloAnswer(envelope(), { ok: true, serves: [] }));
    refusal(() => parseServiceHelloAnswer({ ...helloAnswer, ok: 'yes' }, CHIPNET), /whether it is a success/);
    const { serves: _serves, limits: _limits, ...bare } = helloAnswer;
    refusal(() => parseServiceHelloAnswer({ ...bare, ok: false }, CHIPNET), /without saying why/);
    refusal(() => parseServiceHelloAnswer({ ...helloAnswer, limits: { requestBytes: 100_000, entries: 32 } }, CHIPNET), /beyond/);
    refusal(() => parseServiceHelloAnswer({ ...helloAnswer, serves: [{ template: TEMPLATE }] }, CHIPNET), /no name/);
    const failed = carried(buildServiceHelloAnswer(envelope(), { ok: false, error: 'No.' }));
    refusal(() => parseServiceHelloAnswer({ ...failed, code: 'busy' }, CHIPNET), /code this version does not know/);
    const possible = carried(buildServicePossible(envelope(), { ok: true, height: 1, start: [], items: [] }));
    refusal(() => parseServicePossible({ ...possible, height: -1 }, CHIPNET), /height/);
    refusal(() => parseServicePossible({ ...possible, start: [{ action: 'open', available: false, reason: '' }] }, CHIPNET), /reason/);
    refusal(() => parseServicePossible({ ...possible, start: [{ action: 'open' }] }, CHIPNET), /availability/);
    refusal(() => parseServicePossible({ ...possible, items: [{ ...ITEM, lockingScript: 'abc' }] }, CHIPNET), /locking script/);
    refusal(() => parseServicePossible({ ...possible, items: [{ ...ITEM, coin: 'here' }] }, CHIPNET), /coin/);
    refusal(() => parseServicePossible({ ...possible, items: [{ ...ITEM, about: { category: 'x', spent: true } }] }, CHIPNET), /position/);
    refusal(() => parseServicePossible({ ...possible, items: [{ ...ITEM, bindings: { payout: 1 } }] }, CHIPNET), /bindings are not names/);
    refusal(() => parseServicePossible({ ...possible, items: [{ ...ITEM, says: [{ variable: 'a', value: { x: 1 } }] }] }, CHIPNET), /statement/);
    refusal(() => parseServicePossible({ ...possible, items: [{ ...ITEM, action: undefined }] }, CHIPNET), /ref, category or action/);
  });

  it('an invitation that cannot be one', () => {
    const join = carried(joinRequest());
    refusal(() => parseServiceJoinRequest({ ...join, invitation: undefined }, CHIPNET), /no invitation/, 'bad-invitation');
    refusal(() => parseServiceJoinRequest({ ...join, invitation: '[1]' }, CHIPNET), /not an object/, 'bad-invitation');
    refusal(() => parseServiceJoinRequest({ ...join, invitation: JSON.stringify({ invitationIdentifier: 'i' }) }, CHIPNET), /identifiers and commits/, 'bad-invitation');
    refusal(() => parseServiceJoinRequest({ ...join, invitation: invitationOf([]) }, CHIPNET), /fewer commits/, 'bad-invitation');
    refusal(() => parseServiceJoinRequest({ ...join, invitation: invitationOf([{ commitIdentifier: 'c' }]) }, CHIPNET), /no identifier or entity/, 'bad-invitation');
    // The service's invitation holds the wallet's commit and its own.
    refusal(() => parseServiceJoinResult({ ...carried(buildServiceJoinResult(envelope(), { ok: true, invitation: JOINED })), invitation: STARTED }, CHIPNET), /fewer commits/, 'bad-invitation');
  });

  it('a body that does not hold one message under the identifier', () => {
    refusal(() => decodeServiceBody('{'), /not JSON/);
    refusal(() => decodeServiceBody('[]'), /one message/);
    refusal(() => decodeServiceBody(JSON.stringify({ xo_service_v2: hello() })), /one message/);
    refusal(() => decodeServiceBody(JSON.stringify({ [XO_SERVICE]: hello(), more: 1 })), /one message/);
    refusal(() => decodeServiceBody(JSON.stringify({ [XO_SERVICE]: 'hello' })), /one message/);
  });
});

describe('the invitation a service gives back', () => {
  it('is read in outline without the engine', () => {
    expect(readInvitationOutline(JOINED)).toEqual({
      invitationIdentifier: 'invitation-1',
      templateIdentifier: TEMPLATE.identifier,
      actionIdentifier: 'repay',
      commits: [
        { commitIdentifier: 'c-wallet', entityIdentifier: 'e-wallet' },
        { commitIdentifier: 'c-service', entityIdentifier: 'e-service' },
      ],
    });
  });

  it('is the invitation sent with exactly one commit appended, naming no other action', () => {
    expect(checkJoinedInvitation(STARTED, JOINED)).toEqual({ ok: true, added: { commitIdentifier: 'c-service', entityIdentifier: 'e-service' } });
    // The order of the fields does not matter; their values do.
    const reordered = JSON.stringify({ commits: JSON.parse(JOINED).commits, actionIdentifier: 'repay', templateIdentifier: TEMPLATE.identifier, createdAtTimestamp: '<bigint: 1790000000n>', invitationIdentifier: 'invitation-1' });
    expect(checkJoinedInvitation(STARTED, reordered).ok).toBe(true);
    const same = invitationOf([commit('c-wallet', 'e-wallet'), commit('c-service', 'e-service', { actionReference: { templateIdentifier: TEMPLATE.identifier, actionIdentifier: 'repay' } })]);
    expect(checkJoinedInvitation(STARTED, same).ok).toBe(true);

    const refused = (received: string, words: RegExp) => {
      const check = checkJoinedInvitation(STARTED, received);
      expect(check.ok).toBe(false);
      expect(check.ok === false && check.reason).toMatch(words);
    };
    refused(STARTED, /0 new commits/);
    refused(invitationOf([commit('c-wallet', 'e-wallet'), commit('c-1', 'e-service'), commit('c-2', 'e-service')]), /2 new commits/);
    refused(invitationOf([commit('c-wallet', 'e-wallet', { data: { variables: [] } }), commit('c-service', 'e-service')]), /changed the invitation/);
    refused(invitationOf([commit('c-wallet', 'e-wallet'), commit('c-service', 'e-service')], { actionIdentifier: 'close' }), /changed the invitation/);
    refused(invitationOf([commit('c-wallet', 'e-wallet'), commit('c-service', 'e-service')], { result: {} }), /changed the invitation/);
    refused(invitationOf([commit('c-wallet', 'e-wallet'), commit('c-service', 'e-service', { actionReference: { templateIdentifier: TEMPLATE.identifier, actionIdentifier: 'close' } })]), /another template or action/);
    refused('nonsense', /not JSON/);
  });
});

describe('where a template names its service', () => {
  const resource = (name: string, url = 'https://service.example/xo', more: Record<string, unknown> = {}) => ({ name, description: 'The loan service', url, ...more });
  const DOCS = resource('Documentation', 'https://example.org/docs');
  const chipnet = { network: 'chipnet', kind: 'public' } as const;
  const mainnet = { network: 'mainnet', kind: 'public' } as const;

  it('by a resource of exactly the name xo_service_v1, the service for every network', () => {
    const template = { resources: [DOCS, resource('xo_service_v1')] };
    expect(findServiceResource(template, chipnet)).toEqual({ identifier: 'xo_service_v1', name: 'xo_service_v1', usable: true, url: 'https://service.example/xo', description: 'The loan service' });
    expect(findServiceResource(template, mainnet)).toMatchObject({ usable: true, url: 'https://service.example/xo' });
    // The resources alone do as well.
    expect(findServiceResource(template.resources, chipnet)).toMatchObject({ usable: true });
  });

  it('ignores every other resource', () => {
    expect(findServiceResource({ resources: [DOCS] }, chipnet)).toBeUndefined();
    expect(findServiceResource({ resources: [resource('xo_service_v9'), resource('XO_SERVICE_V1'), resource('Xo_service_v1'), resource(' xo_service_v1'), resource('xo_service')] }, chipnet)).toBeUndefined();
    expect(findServiceResource({}, chipnet)).toBeUndefined();
    expect(findServiceResource({ resources: 'xo_service_v1' }, chipnet)).toBeUndefined();
    expect(findServiceResource(undefined, chipnet)).toBeUndefined();
    expect(findServiceResource({ resources: [null, 'xo_service_v1', { name: 1 }] }, chipnet)).toBeUndefined();
  });

  it('by a name with a network, for that network only', () => {
    const template = { resources: [resource('xo_service_v1:chipnet', 'https://chipnet.service.example/xo')] };
    expect(findServiceResource(template, chipnet)).toMatchObject({ name: 'xo_service_v1:chipnet', usable: true, url: 'https://chipnet.service.example/xo' });
    expect(findServiceResource(template, mainnet)).toBeUndefined();
  });

  it('takes the one for the wallet\'s network over the one for every network', () => {
    const template = { resources: [resource('xo_service_v1', 'https://every.example/xo'), resource('xo_service_v1:mainnet', 'https://main.example/xo')] };
    expect(findServiceResource(template, mainnet)).toMatchObject({ name: 'xo_service_v1:mainnet', url: 'https://main.example/xo' });
    expect(findServiceResource(template, chipnet)).toMatchObject({ name: 'xo_service_v1', url: 'https://every.example/xo' });
    // The one for the network stands even if its address is not usable.
    expect(findServiceResource({ resources: [resource('xo_service_v1'), resource('xo_service_v1:mainnet', 'http://main.example/xo')] }, mainnet)).toMatchObject({ name: 'xo_service_v1:mainnet', usable: false, problem: 'address' });
  });

  it('ignores a name with an unknown or malformed network', () => {
    for (const name of ['xo_service_v1:testnet9', 'xo_service_v1:', 'xo_service_v1:chipnet:x', 'xo_service_v1:Chipnet', 'XO_SERVICE_V1:chipnet', 'xo_service_v1: chipnet']) {
      expect(findServiceResource({ resources: [resource(name)] }, chipnet)).toBeUndefined();
    }
    // A wallet on a network outside the list finds only the service for every network.
    expect(findServiceResource({ resources: [resource('xo_service_v1:other'), resource('xo_service_v1')] }, { network: 'other', kind: 'public' })).toMatchObject({ name: 'xo_service_v1' });
  });

  it('reports an address that cannot be used', () => {
    const problem = (url: unknown, kind: 'public' | 'local' = 'public') => findServiceResource({ resources: [resource('xo_service_v1', url as string)] }, { network: 'regtest', kind });
    expect(problem('http://service.example/xo')).toMatchObject({ usable: false, problem: 'address', reason: 'The address is not https.' });
    expect(problem('http://localhost:8080/xo', 'local')).toMatchObject({ usable: true, url: 'http://localhost:8080/xo' });
    expect(problem('https://user:secret@service.example/xo')).toMatchObject({ usable: false, reason: /user name or password/ });
    expect(problem('https://user@service.example/xo')).toMatchObject({ usable: false, reason: /user name/ });
    expect(problem('https://service.example/xo?key=1')).toMatchObject({ usable: false, reason: /query/ });
    expect(problem('https://service.example/xo?')).toMatchObject({ usable: false, reason: /query/ });
    expect(problem('https://service.example/xo#here')).toMatchObject({ usable: false, reason: /fragment/ });
    expect(problem('ftp://service.example/xo', 'local')).toMatchObject({ usable: false, reason: /neither https nor http/ });
    expect(problem('javascript:alert(1)')).toMatchObject({ usable: false });
    expect(problem('not an address')).toMatchObject({ usable: false, reason: /spaces/ });
    expect(problem(' https://service.example/xo')).toMatchObject({ usable: false });
    expect(problem('/relative')).toMatchObject({ usable: false, reason: /cannot be read/ });
    expect(problem(42)).toMatchObject({ usable: false, problem: 'address' });
    expect(problem(`https://service.example/${'x'.repeat(2_100)}`)).toMatchObject({ usable: false });
  });

  it('uses no service where two resources have the same name', () => {
    const twice = { resources: [resource('xo_service_v1', 'https://a.example/xo'), resource('xo_service_v1', 'https://b.example/xo')] };
    expect(findServiceResource(twice, chipnet)).toMatchObject({ usable: false, problem: 'twice' });
    const twiceForNetwork = { resources: [resource('xo_service_v1'), resource('xo_service_v1:chipnet', 'https://a.example/xo'), resource('xo_service_v1:chipnet', 'https://b.example/xo')] };
    expect(findServiceResource(twiceForNetwork, chipnet)).toMatchObject({ name: 'xo_service_v1:chipnet', usable: false, problem: 'twice' });
    expect(findServiceResource(twiceForNetwork, mainnet)).toMatchObject({ name: 'xo_service_v1', usable: true });
  });
});

describe('the wallet\'s carrier', () => {
  const URL = 'https://service.example/xo';
  const answerBody = (message: Parameters<typeof encodeServiceBody>[0]) => encodeServiceBody(message);
  const helloAnswer = (more: Record<string, unknown> = {}) => buildServiceHelloAnswer({ ...envelope(), ...more } as never, { ok: true, serves: [{ template: TEMPLATE, role: 'lender' }] });

  it('posts the message with no credentials, referrer, redirect or cache, and reads the answer', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetch: ServiceFetch = async (url, init) => {
      seen.push({ url, init });
      return new Response(answerBody(helloAnswer()), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const outcome = await serviceExchange(URL, hello(), { fetch });
    expect(outcome).toEqual({ carried: true, answer: helloAnswer() });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(URL);
    expect(seen[0]?.init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    expect(JSON.parse(seen[0]?.init.body as string)).toEqual({ [XO_SERVICE]: hello() });
  });

  it('gives a refusal of the protocol as an answer', async () => {
    const refused = buildServiceJoinResult(envelope(), { ok: false, error: 'Spent.', code: 'inputs-spent' });
    const outcome = await serviceExchange(URL, joinRequest(), { fetch: async () => new Response(answerBody(refused)) });
    expect(outcome).toEqual({ carried: true, answer: refused });
  });

  it('takes only the answer to this message', async () => {
    const other = await serviceExchange(URL, hello(), { fetch: async () => new Response(answerBody(helloAnswer({ id: 'm-2' }))) });
    expect(other).toMatchObject({ carried: false, failure: 'unreadable', reason: /another message/ });
    const kind = await serviceExchange(URL, possibleRequest(), { fetch: async () => new Response(answerBody(helloAnswer())) });
    expect(kind).toMatchObject({ carried: false, failure: 'unreadable', reason: /xo_service_hello_answer to xo_service_possible_request/ });
    const network = await serviceExchange(URL, hello(), { fetch: async () => new Response(answerBody(helloAnswer({ network: 'mainnet' }))) });
    expect(network).toMatchObject({ carried: false, failure: 'unreadable', code: 'wrong-network' });
    const version = await serviceExchange(URL, hello(), { fetch: async () => new Response(JSON.stringify({ [XO_SERVICE]: { ...helloAnswer(), version: 2 } })) });
    expect(version).toMatchObject({ carried: false, failure: 'unreadable', code: 'version' });
    const garbage = await serviceExchange(URL, hello(), { fetch: async () => new Response('<html>') });
    expect(garbage).toMatchObject({ carried: false, failure: 'unreadable', reason: /not JSON/ });
    const binary = await serviceExchange(URL, hello(), { fetch: async () => new Response(new Uint8Array([0xff, 0xfe])) });
    expect(binary).toMatchObject({ carried: false, failure: 'unreadable', reason: /not text/ });
  });

  it('reports a failure of the carriage with the service\'s words, and when to ask again', async () => {
    const tooLarge = serviceCarriageFailure(413, 'Too large.', { code: 'too-large' });
    const large = await serviceExchange(URL, hello(), { fetch: async () => new Response(tooLarge.body, { status: 413, headers: tooLarge.headers }) });
    expect(large).toEqual({ carried: false, failure: 'status', status: 413, reason: 'Too large.', code: 'too-large' });
    const limited = serviceCarriageFailure(429, 'Slow down.', { retryAfter: 30 });
    expect(limited.headers['retry-after']).toBe('30');
    const busy = await serviceExchange(URL, hello(), { fetch: async () => new Response(limited.body, { status: 429, headers: limited.headers }) });
    expect(busy).toEqual({ carried: false, failure: 'status', status: 429, reason: 'Slow down.', retryAfter: 30 });
    const bare = await serviceExchange(URL, hello(), { fetch: async () => new Response('Bad gateway', { status: 502 }) });
    expect(bare).toEqual({ carried: false, failure: 'status', status: 502, reason: 'The service answered with HTTP 502.' });
  });

  it('follows no redirect', async () => {
    const thrown = await serviceExchange(URL, hello(), {
      fetch: async (_url, init) => {
        // What a browser and Node do with `redirect: 'error'`.
        if (init.redirect === 'error') throw new TypeError('fetch failed: unexpected redirect');
        return new Response(answerBody(helloAnswer()));
      },
    });
    expect(thrown).toMatchObject({ carried: false, failure: 'unreachable', reason: /redirect/ });
    const answered = await serviceExchange(URL, hello(), { fetch: async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }) });
    expect(answered).toMatchObject({ carried: false, failure: 'redirect' });
  });

  it('gives up after its time, waiting for the answer or for its body', async () => {
    const silent = await serviceExchange(URL, hello(), { fetch: () => new Promise<Response>(() => undefined), timeoutMs: 20 });
    expect(silent).toMatchObject({ carried: false, failure: 'timeout' });
    const trickle = new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(new TextEncoder().encode('{')) });
    const slow = await serviceExchange(URL, hello(), { fetch: async () => new Response(trickle), timeoutMs: 20 });
    expect(slow).toMatchObject({ carried: false, failure: 'timeout' });
    const stop = new AbortController();
    const pending = serviceExchange(URL, hello(), { fetch: () => new Promise<Response>(() => undefined), signal: stop.signal });
    stop.abort();
    expect(await pending).toMatchObject({ carried: false, failure: 'cancelled' });
  });

  it('reads no more than its limit of an answer', async () => {
    const huge = await serviceExchange(URL, hello(), { fetch: async () => new Response('x'.repeat(SERVICE_LIMITS.answerBytes + 1)) });
    expect(huge).toMatchObject({ carried: false, failure: 'answer-too-large' });
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1;
        controller.enqueue(new Uint8Array(1_000));
      },
    });
    const stream = await serviceExchange(URL, hello(), { fetch: async () => new Response(endless), maxBytes: 5_000 });
    expect(stream).toMatchObject({ carried: false, failure: 'answer-too-large' });
    expect(pulled).toBeLessThan(10);
    const declared = await serviceExchange(URL, hello(), { fetch: async () => new Response('{}', { headers: { 'content-length': '999999' } }) });
    expect(declared).toMatchObject({ carried: false, failure: 'answer-too-large' });
  });

  it('sends nothing larger than a service takes', async () => {
    let called = false;
    // Its quotes are escaped once in the invitation and again in the body.
    const big = invitationOf([commit('c-wallet', 'e-wallet', { memo: '"'.repeat(SERVICE_LIMITS.requestBytes / 2) })]);
    const message = { ...joinRequest(), invitation: big };
    const outcome = await serviceExchange(URL, message, {
      fetch: async () => {
        called = true;
        return new Response('');
      },
    });
    expect(outcome).toMatchObject({ carried: false, failure: 'request-too-large', code: 'too-large' });
    expect(called).toBe(false);
  });

  it('reports a service that cannot be reached', async () => {
    const outcome = await serviceExchange(URL, hello(), { fetch: async () => Promise.reject(new TypeError('fetch failed')) });
    expect(outcome).toMatchObject({ carried: false, failure: 'unreachable' });
  });
});

describe('the service\'s side, against the wallet\'s', () => {
  const asked: ServiceRequest[] = [];
  const handlersFor = (role: string): ServiceHandlers => ({
    hello: (request) => {
      asked.push(request);
      return request.template.identifier === TEMPLATE.identifier ? { ok: true, serves: [{ template: TEMPLATE, role }] } : { ok: false, error: 'This service does not serve that template.', code: 'unknown-template' };
    },
    possible: (request) => {
      asked.push(request);
      return { ok: true, height: request.network === 'mainnet' ? 900_000 : 280_000, start: [], items: request.tokens.map((token) => ({ ref: token.outpoint, category: token.category, action: 'repay' })) };
    },
    join: (request) => {
      asked.push(request);
      const invitation = JSON.parse(request.invitation) as { commits: unknown[] };
      return { ok: true, invitation: JSON.stringify({ ...invitation, commits: [...invitation.commits, commit('c-service', 'e-service')] }) };
    },
  });
  const lender = handlersFor('lender');
  /** One service at one address that serves two networks. */
  const NETWORKS = { chipnet: lender, mainnet: lender };
  const server =
    (networks: ServiceNetworks = NETWORKS): ServiceFetch =>
    async (_url, init) => {
      const answer = await answerServiceRequest({ method: init.method ?? 'GET', body: init.body as string }, networks, { now: () => TIME });
      return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
    };
  const URL = 'https://service.example/xo';

  it('answers every message, end to end', async () => {
    expect(await serviceExchange(URL, hello(), { fetch: server() })).toEqual({ carried: true, answer: buildServiceHelloAnswer(envelope(), { ok: true, serves: [{ template: TEMPLATE, role: 'lender' }] }) });
    const possible = await serviceExchange(URL, possibleRequest(), { fetch: server() });
    expect(possible).toMatchObject({ carried: true, answer: { ok: true, height: 280_000, items: [{ ref: TOKEN.outpoint, category: TOKEN.category, action: 'repay' }] } });
    const joined = await serviceExchange(URL, joinRequest(), { fetch: server() });
    expect(joined.carried && joined.answer.ok && checkJoinedInvitation(STARTED, joined.answer.invitation)).toEqual({ ok: true, added: { commitIdentifier: 'c-service', entityIdentifier: 'e-service' } });
    const unknown = await serviceExchange(URL, buildServiceHello({ ...envelope(), template: { identifier: hash('b1'), contentHash: hash('bb') }, role: 'borrower' }), { fetch: server() });
    expect(unknown).toMatchObject({ carried: true, answer: { ok: false, code: 'unknown-template' } });
  });

  it('serves each of its networks, at one address, and refuses another', async () => {
    const onMainnet = await serviceExchange(URL, buildServicePossibleRequest({ ...envelope({ network: 'mainnet' }), template: TEMPLATE, role: 'borrower', tokens: [], made: [] }), { fetch: server() });
    expect(onMainnet).toMatchObject({ carried: true, answer: { network: 'mainnet', ok: true, height: 900_000 } });
    const onChipnet = await serviceExchange(URL, possibleRequest(), { fetch: server() });
    expect(onChipnet).toMatchObject({ carried: true, answer: { network: 'chipnet', ok: true, height: 280_000 } });
    const before = asked.length;
    const onTestnet = await serviceExchange(URL, buildServiceHello({ ...envelope({ network: 'testnet4' }), template: TEMPLATE, role: 'borrower' }), { fetch: server() });
    expect(onTestnet).toMatchObject({ carried: true, answer: { network: 'testnet4', ok: false, code: 'wrong-network', error: 'This service does not serve testnet4.' } });
    // The same refusal comes before anything the message holds is looked at, and no handler is asked.
    const badOnTestnet = await answerServiceRequest({ method: 'POST', body: encodeServiceBody({ ...joinRequest(), network: 'testnet4', invitation: 'x' }) }, NETWORKS);
    expect(JSON.parse(badOnTestnet.body)[XO_SERVICE]).toMatchObject({ ok: false, code: 'wrong-network' });
    expect(asked.length).toBe(before);
    // A name that is a property of every object is not a network.
    const proto = await answerServiceRequest({ method: 'POST', body: encodeServiceBody({ ...hello(), network: 'constructor' }) }, NETWORKS);
    expect(JSON.parse(proto.body)[XO_SERVICE]).toMatchObject({ ok: false, code: 'wrong-network' });
  });

  it('refuses another version with HTTP 200, in its own version', async () => {
    const body = JSON.stringify({ [XO_SERVICE]: { ...hello(), version: 2, novelty: true } });
    const answer = await answerServiceRequest({ method: 'POST', body }, NETWORKS, { now: () => TIME });
    expect(answer.status).toBe(200);
    const read = parseServiceAnswer(decodeServiceBody(answer.body), CHIPNET);
    expect(read).toMatchObject({ action: SERVICE_HELLO_ANSWER, version: 1, id: 'm-1', ok: false, code: 'version' });
  });

  it('refuses a message it cannot take with HTTP 200 and the parser\'s reason', async () => {
    const tooMany = { ...possibleRequest(), tokens: Array.from({ length: 33 }, () => TOKEN) };
    const outcome = await serviceExchange(URL, tooMany, { fetch: server() });
    expect(outcome).toMatchObject({ carried: true, answer: { ok: false, code: 'too-many' } });
    const bad = await answerServiceRequest({ method: 'POST', body: encodeServiceBody({ ...joinRequest(), invitation: 'nonsense' }) }, NETWORKS);
    expect(bad.status).toBe(200);
    expect(JSON.parse(bad.body)[XO_SERVICE]).toMatchObject({ action: 'xo_service_join_result', ok: false, code: 'bad-invitation' });
  });

  it('answers the same message twice, keeping nothing', async () => {
    const first = await answerServiceRequest({ method: 'POST', body: encodeServiceBody(joinRequest()) }, NETWORKS, { now: () => TIME });
    const second = await answerServiceRequest({ method: 'POST', body: encodeServiceBody(joinRequest()) }, NETWORKS, { now: () => TIME });
    expect(second).toEqual(first);
  });

  it('answers a preflight, and every answer, with headers any page may read', async () => {
    const preflight = await answerServiceRequest({ method: 'OPTIONS' }, NETWORKS);
    expect(preflight).toEqual({ status: 204, headers: { ...SERVICE_CORS_HEADERS }, body: '' });
    expect(preflight.headers).toMatchObject({ 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' });
    expect(preflight.headers).not.toHaveProperty('access-control-allow-credentials');
    const answer = await answerServiceRequest({ method: 'POST', body: encodeServiceBody(hello()) }, NETWORKS);
    expect(answer.headers).toMatchObject({ ...SERVICE_CORS_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' });
  });

  it('uses HTTP codes for the carriage only, with a body of the same shape', async () => {
    const read = (answer: { body: string }) => JSON.parse(answer.body)[XO_SERVICE];
    const get = await answerServiceRequest({ method: 'GET' }, NETWORKS);
    expect(get.status).toBe(405);
    expect(get.headers['allow']).toBe('POST, OPTIONS');
    expect(read(get)).toMatchObject({ version: 1, ok: false });
    const large = await answerServiceRequest({ method: 'POST', body: 'x'.repeat(SERVICE_LIMITS.requestBytes + 1) }, NETWORKS);
    expect(large.status).toBe(413);
    expect(read(large)).toMatchObject({ ok: false, code: 'too-large' });
    const bytes = await answerServiceRequest({ method: 'POST', body: new Uint8Array(SERVICE_LIMITS.requestBytes + 1) }, NETWORKS);
    expect(bytes.status).toBe(413);
    for (const body of ['{', '{"other":{}}', JSON.stringify({ [XO_SERVICE]: { action: 'xo_service_hello_answer', id: 'm', network: 'chipnet' } }), JSON.stringify({ [XO_SERVICE]: { action: SERVICE_HELLO, network: 'chipnet' } })]) {
      const unreadable = await answerServiceRequest({ method: 'POST', body }, NETWORKS);
      expect(unreadable.status).toBe(400);
      expect(read(unreadable)).toMatchObject({ ok: false });
    }
    const notText = await answerServiceRequest({ method: 'POST', body: new Uint8Array([0xff]) }, NETWORKS);
    expect(notText.status).toBe(400);
    const encoded = await answerServiceRequest({ method: 'POST', body: new TextEncoder().encode(encodeServiceBody(hello())) }, NETWORKS);
    expect(encoded.status).toBe(200);
  });

  it('answers HTTP 500 for a handler that fails or answers outside the protocol', async () => {
    const failing: ServiceHandlers = {
      ...lender,
      hello: () => {
        throw new Error('database down');
      },
      possible: () => ({ ok: true, height: -1, start: [], items: [] }),
    };
    const thrown = await answerServiceRequest({ method: 'POST', body: encodeServiceBody(hello()) }, { chipnet: failing });
    expect(thrown.status).toBe(500);
    expect(thrown.body).not.toContain('database');
    const outside = await serviceExchange(URL, possibleRequest(), { fetch: server({ chipnet: failing }) });
    expect(outside).toMatchObject({ carried: false, failure: 'status', status: 500, reason: /does not allow/ });
  });
});
