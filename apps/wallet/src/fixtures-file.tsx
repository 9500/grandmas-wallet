import { type ApplicationsState, type DeletionHolds, type HeldToken, type KeptTemplate, type WalletParts, Applications } from '@grandmas-wallet/app';
import { readTemplate } from '@grandmas-wallet/core';
import { useState } from 'preact/hooks';

import { Apps } from './Apps.js';
import type { Owner } from './OwnerApp.js';

/*
 * The Applications screen with templates added from a file and deleted, fed from fixed data through the wallet's own
 * handling of templates (`fixtures.html?show=apps&file=`): `none` (no template yet: the way to add one, and its checks
 * and review when a file is chosen), `trusted` (the example template, added from a file, is trusted: its screen, and
 * stopping and deleting it) or `withdrawn` (the user stopped trusting it: the backup's suggestion, which can be
 * deleted). With `&holds`, the wallet holds a token of it, so deleting it warns and asks for the tick. The template, its
 * words and its service are invented examples; nothing is stored and nothing is sent: the service cannot be reached.
 */

const params = new URLSearchParams(window.location.search);
const mode = params.get('file') ?? 'none';

const view = (name: string, description: string = name) => ({ name, description });

/** An invented template, of the shape a page would offer: a box of coins its key token opens, with a service. */
const EXAMPLE = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Example money box (test network)', 'Coins kept in a box. Whoever holds the box\'s key token can take them out.'),
  version: '1',
  supported: ['BCH_2026_05'],
  resources: [{ name: 'xo_service_v1', description: 'The money box service', url: 'https://box.example.org/xo' }],
  roles: { holder: view('Holder', 'Holds the key of a money box.') },
  start: [{ action: 'open', role: 'holder' }],
  actions: {
    open: { ...view('Open a money box', 'Make a new box and its key, and put coins in.'), roles: { holder: { requirements: { variables: ['boxKey', 'amount', 'holder'] } } }, requirements: { participants: [{ role: 'holder', slots: { min: 1, max: 1 } }] }, transaction: 'openTransaction' },
    take: { ...view('Take everything out', 'Take every coin out of a box. The key stays with you.'), roles: { holder: { requirements: { variables: ['boxKey', 'holder', 'keyInput'] } } }, requirements: { participants: [{ role: 'holder', slots: { min: 1, max: 1 } }] }, transaction: 'takeTransaction' },
  },
  transactions: {
    openTransaction: { ...view('Box opened', 'A box was opened with $(<amount>) satoshis.'), inputs: [], outputs: [{ output: 'boxOutput' }, { output: 'keyOutput' }], version: 2, locktime: 0 },
    takeTransaction: { ...view('Box emptied', 'Everything was taken out of a box.'), inputs: [{ input: 'boxInput' }], outputs: [{ output: 'keyOutput' }], version: 2, locktime: 0 },
  },
  inputs: { boxInput: { ...view('Money box', 'Coins in the box. The key token in the same transaction opens it.'), unlockingScript: 'unlockBox' } },
  outputs: {
    boxOutput: { ...view('Money box', '$(<amount>) satoshis in the box.'), lockingScript: 'boxLockingScript', valueSatoshis: '$(<amount>)' },
    keyOutput: { ...view('Box key', 'The token that opens the box.'), lockingScript: '$(<holder>)', valueSatoshis: '1000', token: { category: '$(<boxKey>)', amount: null, nft: { capability: 'none', commitment: '' } } },
  },
  lockingScripts: {
    boxLockingScript: {
      ...view('Money box', 'Opens for whoever spends the box\'s key token in the same transaction.'),
      lockingType: 'p2sh',
      lockingBytecode: 'boxBytecode',
      unlockingBytecode: 'unlockBox',
      state: { variables: ['boxKey'] },
      roles: { holder: { balance: { satoshis: true }, selectable: false, actions: [{ action: 'take', role: 'holder' }] } },
    },
  },
  scripts: { boxBytecode: 'OP_UTXOTOKENCATEGORY <$(<boxKey> OP_REVERSEBYTES)> OP_EQUAL', unlockBox: '<keyInput>' },
  variables: {
    boxKey: { ...view('Box key', 'The token category of the box\'s key.'), type: 'token_category' },
    amount: { ...view('Amount', 'Satoshis to put in.'), type: 'satoshis' },
    holder: { ...view('Key holder', 'Where the key token goes: an address of the wallet.'), type: 'locking_script' },
    keyInput: { ...view('Key input', 'The number of the input that spends the key.'), type: 'integer' },
  },
};

/** The example template as a file would hold it; on the page too, for a check to choose as a file. */
export const EXAMPLE_TEXT = JSON.stringify(EXAMPLE, null, 2);
(window as unknown as { exampleTemplate: string }).exampleTemplate = EXAMPLE_TEXT;
const read = readTemplate(EXAMPLE_TEXT);
const names = { identifier: read.identifier, contentHash: read.contentHash };
const AT = 1_795_000_000;

const kept: KeptTemplate = { ...names, text: EXAMPLE_TEXT, name: EXAMPLE.name, trustedAt: AT, applications: [], stored: true, from: 'file' };
let state: ApplicationsState = {
  templates: mode === 'trusted' ? [kept] : [],
  notes: [],
  suggested: mode === 'withdrawn' ? [{ ...names, name: EXAMPLE.name, texts: { template: EXAMPLE_TEXT }, withdrawn: { renewal: 0, stored: true } }] : [],
};

/** The wallet's handling of templates on a wallet with no coins, no backup store, and a service that cannot be reached. */
const applications = new Applications(
  {
    kept: () => state,
    store: (next: ApplicationsState) => void (state = next),
    tokenCoins: async () => [],
    chain: { listUnspent: async () => [] },
  } as unknown as WalletParts,
  { now: () => AT, service: { network: 'regtest', kind: 'public', fetch: () => Promise.reject(new TypeError('fetch failed')) } },
);

/** With `&holds`: a token of the template the wallet holds, with its position open. */
const keyToken: HeldToken = { category: '8b3d5f7a9c1e2b4d6f8a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a7c9e0b2d', commitment: '', capability: 'none', amount: 0n, place: 'address', outpoint: `${'4c'.repeat(32)}:1`, satoshis: 1_000n, meaning: 'position', tokenName: 'Box key', template: { identifier: names.identifier, name: EXAMPLE.name } };
const holds = params.has('holds');
const deletionHolds = async (identifier: string): Promise<DeletionHolds> =>
  holds && identifier === names.identifier ? { tokens: [keyToken], open: [], waiting: [] } : applications.deletionHolds(identifier);

/** The Applications screen with this handling of templates; what changes is shown again, as on the page. */
export const FileApps = ({ base }: { base: Owner }) => {
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((count) => count + 1);
  const shown = Object.assign(Object.create(applications) as Applications, {
    deletionHolds,
    readBackup: async () => ({ suggested: 0, notes: 0 }),
    tokens: async () => (holds ? [keyToken] : []),
    watch: () => () => undefined,
  });
  const owner = {
    ...base,
    apps: {
      ...base.apps,
      version,
      changed,
      applications: shown,
      registries: { refresh: async () => undefined },
      stopTrusting: async (identifier: string) => {
        try {
          return await applications.forget(identifier);
        } finally {
          changed();
        }
      },
      deleteTemplate: async (identifier: string, confirmed: boolean) => {
        try {
          return await applications.deleteTemplate(identifier, { confirmed });
        } finally {
          changed();
        }
      },
    },
  } as unknown as Owner;
  return <Apps owner={owner} />;
};
