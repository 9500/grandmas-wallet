/**
 * Two application templates made for the tests, with their recovery declarations. They stand for
 * applications the wallet has never seen: nothing in the wallet's code knows them.
 *
 * - **Strongbox**: coins held at a script that opens for whoever spends the box's key token in the same
 *   transaction. The box's address follows from the key alone.
 * - **Bond**: coins that can only go back to an address fixed when the bond was posted. The bond's
 *   address does not follow from its key; it is found through a companion coin.
 *
 * Their scripts are written here in CashAssembly, so the tests need no compiler.
 */

const SCHEMA = 'https://libauth.org/schemas/wallet-template-v0.schema.json';
const view = (name: string, description: string = name) => ({ name, description });
const one = (role: string) => ({ role, slots: { min: 1, max: 1 } });
const action = (name: string, description: string, role: string, variables: string[], transaction: string) => ({
  ...view(name, description),
  roles: { [role]: { requirements: { variables } } },
  requirements: { participants: [one(role)] },
  transaction,
});

/** The script both templates use to tie a coin to a token: the input whose number is given must carry the category. */
const HELD_BY_TOKEN = (category: string) => `OP_UTXOTOKENCATEGORY <$(<${category}> OP_REVERSEBYTES)> OP_EQUAL`;

export const strongboxTemplate = {
  $schema: SCHEMA,
  ...view('Strongbox', 'Coins kept in a box. Whoever holds the box\'s key token can take them out.'),
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { holder: view('Holder', 'Holds the key of a strongbox.') },
  start: [
    { action: 'open', role: 'holder' },
    { action: 'add', role: 'holder' },
  ],
  actions: {
    open: action('Open a strongbox', 'Make a new strongbox and its key, and put coins in.', 'holder', ['boxKey', 'amount', 'holder', 'label'], 'openTransaction'),
    add: action('Put coins in', 'Put more coins into a strongbox.', 'holder', ['boxKey', 'amount'], 'addTransaction'),
    take: action('Take everything out', 'Take every coin out of a strongbox. The key stays with you.', 'holder', ['boxKey', 'holder', 'label', 'keyInput'], 'takeTransaction'),
  },
  transactions: {
    openTransaction: { ...view('Strongbox opened', 'A strongbox was opened with $(<amount>) satoshis.'), inputs: [], outputs: [{ output: 'boxOutput' }, { output: 'keyOutput' }], version: 2, locktime: 0 },
    addTransaction: { ...view('Coins put in', '$(<amount>) satoshis were put into a strongbox.'), inputs: [], outputs: [{ output: 'boxOutput' }], version: 2, locktime: 0 },
    takeTransaction: { ...view('Strongbox emptied', 'Everything was taken out of a strongbox.'), inputs: [{ input: 'boxInput' }], outputs: [{ output: 'keyOutput' }], version: 2, locktime: 0 },
  },
  inputs: { boxInput: { ...view('Strongbox', 'Coins in the box. They need no signature: the key token in the same transaction opens it.'), unlockingScript: 'unlockBox' } },
  outputs: {
    boxOutput: { ...view('Strongbox', '$(<amount>) satoshis in the box.'), lockingScript: 'boxLockingScript', valueSatoshis: '$(<amount>)' },
    keyOutput: {
      ...view('Strongbox key', 'The token that opens the box. Keep it in the wallet.'),
      lockingScript: '$(<holder>)',
      valueSatoshis: '1000',
      token: { category: '$(<boxKey>)', amount: null, nft: { capability: 'none', commitment: '$(<label>)' } },
    },
  },
  lockingScripts: {
    boxLockingScript: {
      ...view('Strongbox', 'Opens for whoever spends the box\'s key token in the same transaction.'),
      lockingType: 'p2sh',
      lockingBytecode: 'boxBytecode',
      unlockingBytecode: 'unlockBox',
      state: { variables: ['boxKey'] },
      roles: { holder: { balance: { satoshis: true }, selectable: false, actions: [{ action: 'take', role: 'holder' }] } },
    },
  },
  scripts: { boxBytecode: HELD_BY_TOKEN('boxKey'), unlockBox: '<keyInput>' },
  variables: {
    boxKey: { ...view('Box key', 'The token category of the box\'s key.'), type: 'token_category' },
    amount: { ...view('Amount', 'Satoshis to put in.'), type: 'satoshis' },
    holder: { ...view('Key holder', 'Where the key token goes: an address of the wallet.'), type: 'locking_script' },
    label: { ...view('Label', 'A few bytes written on the key.'), type: 'bytes' },
    keyInput: { ...view('Key input', 'The number of the input that spends the key.'), type: 'integer' },
  },
} as const;

/** The declaration of the Strongbox template, as an object; `declarationText` binds it to the template's text. */
export const strongboxDeclaration = {
  authority: {
    boxKey: {
      token: 'keyOutput',
      position: { lockingScript: 'boxLockingScript', variables: { boxKey: 'token.category' } },
      actions: ['add', 'take'],
    },
  },
  actions: {
    open: { creates: 'boxKey', outputs: { holder: 'receive' } },
    add: { variables: { boxKey: 'token.category' } },
    take: { spends: 'boxKey', position: 'boxInput', outputs: { holder: 'receive' }, variables: { boxKey: 'token.category', label: 'token.commitment', keyInput: 'token.inputIndex' } },
  },
} as const;

export const bondTemplate = {
  $schema: SCHEMA,
  ...view('Bond', 'Coins set aside that can only return to an address fixed when the bond was posted.'),
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { poster: view('Poster', 'Posts a bond and later takes it back.') },
  start: [{ action: 'post', role: 'poster' }],
  actions: {
    post: action('Post a bond', 'Set coins aside. They can only come back to the address fixed now.', 'poster', ['bondKey', 'amount', 'refundTo', 'holder', 'serial'], 'postTransaction'),
    redeem: action('Take the bond back', 'Return the bond to the address fixed when it was posted. The key returns to where it was.', 'poster', ['bondKey', 'amount', 'refundTo', 'holder', 'serial', 'keyInput'], 'redeemTransaction'),
  },
  transactions: {
    postTransaction: {
      ...view('Bond posted', 'A bond of $(<amount>) satoshis was posted.'),
      inputs: [],
      outputs: [{ output: 'bondOutput' }, { output: 'companionOutput' }, { output: 'keyOutput' }],
      version: 2,
      locktime: 0,
    },
    redeemTransaction: { ...view('Bond returned', 'A bond of $(<amount>) satoshis was returned.'), inputs: [{ input: 'bondInput' }], outputs: [{ output: 'refundOutput' }, { output: 'keyOutput' }], version: 2, locktime: 0 },
  },
  inputs: { bondInput: { ...view('Bond', 'The bond. It needs no signature: the key token in the same transaction releases it.'), unlockingScript: 'unlockBond' } },
  outputs: {
    bondOutput: { ...view('Bond', '$(<amount>) satoshis set aside.'), lockingScript: 'bondLockingScript', valueSatoshis: '$(<amount>)' },
    // The companion coin carries the key's category, and on it the address the bond returns to.
    companionOutput: {
      ...view('Bond marker', 'Says where the bond is and where it returns to.'),
      lockingScript: 'companionLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<bondKey>)', amount: null, nft: { capability: 'none', commitment: '$(<refundTo>)' } },
    },
    keyOutput: {
      ...view('Bond key', 'The token that releases the bond. Keep it in the wallet.'),
      lockingScript: '$(<holder>)',
      valueSatoshis: '1000',
      token: { category: '$(<bondKey>)', amount: null, nft: { capability: 'none', commitment: '$(<serial>)' } },
    },
    refundOutput: { ...view('Returned bond', 'The bond, back at the address fixed when it was posted.'), lockingScript: '$(<refundTo>)', valueSatoshis: '$(<amount>)' },
  },
  lockingScripts: {
    bondLockingScript: {
      ...view('Bond', 'Released by the key token, and only to the address fixed when it was posted.'),
      lockingType: 'p2sh',
      lockingBytecode: 'bondBytecode',
      unlockingBytecode: 'unlockBond',
      state: { variables: ['bondKey', 'refundTo'] },
      roles: { poster: { balance: { satoshis: true }, selectable: false, actions: [{ action: 'redeem', role: 'poster' }] } },
    },
    companionLockingScript: {
      ...view('Bond marker', 'A coin that marks where a bond is.'),
      lockingType: 'p2sh',
      lockingBytecode: 'companionBytecode',
      unlockingBytecode: 'unlockBond',
      state: { variables: ['bondKey'] },
      roles: { poster: { balance: {}, selectable: false, actions: [] } },
    },
  },
  scripts: {
    // The first output must be the fixed address; then the key must be among the inputs.
    bondBytecode: `<0> OP_OUTPUTBYTECODE <refundTo> OP_EQUALVERIFY ${HELD_BY_TOKEN('bondKey')}`,
    companionBytecode: `<"bond marker"> OP_DROP ${HELD_BY_TOKEN('bondKey')}`,
    unlockBond: '<keyInput>',
  },
  variables: {
    bondKey: { ...view('Bond key', 'The token category of the bond\'s key.'), type: 'token_category' },
    amount: { ...view('Amount', 'Satoshis to set aside.'), type: 'satoshis' },
    refundTo: { ...view('Return address', 'Where the bond returns to. Fixed when the bond is posted.'), type: 'locking_script' },
    holder: { ...view('Key holder', 'Where the key token goes: an address of the wallet.'), type: 'locking_script' },
    serial: { ...view('Serial', 'A few bytes written on the key.'), type: 'bytes' },
    keyInput: { ...view('Key input', 'The number of the input that spends the key.'), type: 'integer' },
  },
} as const;

export const bondDeclaration = {
  authority: {
    bondKey: {
      token: 'keyOutput',
      position: {
        companion: { lockingScript: 'companionLockingScript', variables: { bondKey: 'token.category' }, tokenCategory: 'token.category' },
        relative: -1,
        genuine: { lockingScript: 'bondLockingScript', variables: { bondKey: 'token.category', refundTo: 'companion.commitment' } },
      },
      actions: ['redeem'],
    },
  },
  actions: {
    post: { creates: 'bondKey', outputs: { holder: 'receive', refundTo: 'lasting' } },
    redeem: {
      spends: 'bondKey',
      position: 'bondInput',
      outputs: { holder: 'return' },
      variables: { bondKey: 'token.category', serial: 'token.commitment', keyInput: 'token.inputIndex', refundTo: 'companion.commitment', amount: 'position.valueSatoshis' },
    },
  },
} as const;

/** A template as an application would send it: its text. */
export const templateText = (template: unknown): string => JSON.stringify(template);
