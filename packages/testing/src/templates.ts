/**
 * Application templates made for the tests. They stand for applications the wallet has never seen: nothing in the
 * wallet's code knows them, and none comes with anything beside it (proposal section 13.3).
 *
 * - **Strongbox**: coins held at a script that opens for whoever spends the box's key token in the same
 *   transaction. The box's address follows from the key alone.
 * - **Bond**: coins that can only go back to an address fixed when the bond was posted. The bond's
 *   address does not follow from its key; a companion coin beside it carries the key's category and the address.
 * - **Club**: a door every member shares, a contract that hands out the club's fungible credits; joining
 *   makes a member card and a locker with a deposit. Using the locker burns credits. It has what a shared
 *   contract brings: an input a page names, values read from it, places in the transaction fixed by the template,
 *   fungible tokens the wallet pays with, and tokens sent to a data output.
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

/**
 * The club's door: it must be put back at its own place, with its token, and gives out no more than 50,000
 * credits at a time. The argument is dropped.
 */
const DOOR = [
  'OP_DROP',
  'OP_INPUTINDEX OP_OUTPUTBYTECODE OP_INPUTINDEX OP_UTXOBYTECODE OP_EQUALVERIFY',
  'OP_INPUTINDEX OP_OUTPUTTOKENCATEGORY OP_INPUTINDEX OP_UTXOTOKENCATEGORY OP_EQUALVERIFY',
  'OP_INPUTINDEX OP_OUTPUTTOKENCOMMITMENT OP_INPUTINDEX OP_UTXOTOKENCOMMITMENT OP_EQUALVERIFY',
  'OP_INPUTINDEX OP_OUTPUTTOKENAMOUNT <50000> OP_ADD OP_INPUTINDEX OP_UTXOTOKENAMOUNT OP_GREATERTHANOREQUAL',
].join(' ');

export const clubTemplate = {
  $schema: SCHEMA,
  ...view('Club', 'Join the club: a member card, a locker with a deposit, and the club\'s credits.'),
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { member: view('Member', 'Holds a member card.') },
  start: [{ action: 'join', role: 'member' }],
  actions: {
    join: action('Join the club', 'Get a member card and credits, and put a deposit in a locker.', 'member', ['memberKey', 'credits', 'deposit', 'doorCredits', 'doorState', 'doorNumber', 'holder', 'creditsHolder'], 'joinTransaction'),
    use: action('Use the locker', 'Spend credits; the deposit comes back and the card stays with you.', 'member', ['memberKey', 'burned', 'doorCredits', 'doorState', 'holder', 'keyInput'], 'useTransaction'),
  },
  transactions: {
    joinTransaction: {
      ...view('Joined', 'Joined at door $(<doorNumber>) with $(<credits>) credits.'),
      // Input 0 is the wallet's coin that defines the card's category; output 0 is what the wallet keeps of it.
      inputs: [{ input: 'doorInput', inputIndex: 1 }],
      outputs: [
        { output: 'doorOutput', outputIndex: 1 },
        { output: 'cardOutput', outputIndex: 2 },
        { output: 'creditsOutput', outputIndex: 3 },
        { output: 'lockerOutput', outputIndex: 4 },
      ],
      version: 2,
      locktime: 0,
    },
    useTransaction: {
      ...view('Locker used', '$(<burned>) credits were spent.'),
      inputs: [{ input: 'doorInput' }, { input: 'lockerInput' }],
      outputs: [{ output: 'doorBackOutput' }, { output: 'burnOutput' }, { output: 'cardOutput' }],
      version: 2,
      locktime: 0,
    },
  },
  inputs: {
    doorInput: { ...view('The club\'s door', 'Shared by every member. It is put back.'), unlockingScript: 'unlockDoor' },
    lockerInput: { ...view('Locker', 'The deposit. The card in the same transaction opens it.'), unlockingScript: 'unlockLocker' },
  },
  outputs: {
    doorOutput: {
      ...view('The club\'s door', 'Put back, with the credits it still holds.'),
      lockingScript: 'doorLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<clubCategory>)', amount: '$(<doorCredits> <credits> OP_SUB)', nft: { capability: 'minting', commitment: '$(<doorState>)' } },
    },
    doorBackOutput: {
      ...view('The club\'s door', 'Put back as it was.'),
      lockingScript: 'doorLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<clubCategory>)', amount: '$(<doorCredits>)', nft: { capability: 'minting', commitment: '$(<doorState>)' } },
    },
    cardOutput: { ...view('Member card', 'The token of a member. Keep it in the wallet.'), lockingScript: '$(<holder>)', valueSatoshis: '1000', token: { category: '$(<memberKey>)', amount: null, nft: { capability: 'none', commitment: '01' } } },
    creditsOutput: { ...view('Credits', '$(<credits>) credits.'), lockingScript: '$(<creditsHolder>)', valueSatoshis: '1000', token: { category: '$(<clubCategory>)', amount: '$(<credits>)', nft: null } },
    lockerOutput: { ...view('Locker', 'A deposit of $(<deposit>) satoshis.'), lockingScript: 'lockerLockingScript', valueSatoshis: '$(<deposit>)' },
    burnOutput: { ...view('Credits spent', '$(<burned>) credits, destroyed.'), lockingScript: '$(<dataOutput>)', valueSatoshis: '0', token: { category: '$(<clubCategory>)', amount: '$(<burned>)', nft: null } },
  },
  lockingScripts: {
    doorLockingScript: { ...view('The club\'s door'), lockingType: 'p2sh', lockingBytecode: 'doorBytecode', selectable: false, roles: { member: { selectable: false } } },
    lockerLockingScript: {
      ...view('Locker', 'Opens for whoever spends the member card in the same transaction.'),
      lockingType: 'p2sh',
      lockingBytecode: 'lockerBytecode',
      state: { variables: ['memberKey'] },
      roles: { member: { selectable: false } },
    },
  },
  scripts: { doorBytecode: DOOR, unlockDoor: '<1>', lockerBytecode: HELD_BY_TOKEN('memberKey'), unlockLocker: '<keyInput>' },
  constants: {
    clubCategory: { ...view('Club credits', 'The token category of the club\'s credits and of its door.'), type: 'token_category', value: 'c1'.repeat(32) },
    dataOutput: { ...view('Destroyed', 'A data output.'), type: 'locking_script', value: '6a' },
  },
  variables: {
    memberKey: { ...view('Member card', 'The token category of the member card.'), type: 'token_category' },
    credits: { ...view('Credits', 'Credits to take at the door.'), type: 'token_amount' },
    deposit: { ...view('Deposit', 'Satoshis for the locker.'), type: 'satoshis' },
    doorCredits: { ...view('Credits at the door', 'What the door holds.'), type: 'token_amount' },
    doorState: { ...view('Door state', 'The door\'s commitment.'), type: 'bytes' },
    doorNumber: { ...view('Door number', 'The first two bytes of the door\'s commitment.'), type: 'integer' },
    burned: { ...view('Credits to spend', 'Credits the locker takes.'), type: 'token_amount' },
    holder: { ...view('Card holder', 'Where the card goes.'), type: 'locking_script' },
    creditsHolder: { ...view('Credits holder', 'Where the credits go.'), type: 'locking_script' },
    keyInput: { ...view('Card input', 'The number of the input that spends the card.'), type: 'integer' },
  },
} as const;

/*
 * Variants of the templates above.
 *
 * - The Strongbox as it is: the key is not an input of its own, and the take names the input that spends the key by
 *   a number (`keyInput`) that the request gives.
 * - **Keyed strongbox**: the Strongbox with its key as an input of its own, at index 0, and that index in the
 *   box's unlocking as a constant, as the Savings Jar of the trial of stage 11 has it.
 * - **Club with lockers**: the Club, with each of its scripts naming its unlocking and the locker offering its
 *   action to the member. The card is not an input of its own; the door is a coin every member shares, which a
 *   request names.
 * - **Cloakroom**: every guest's coat hangs at one script, a rack the wallet need not follow; a coat goes to whoever
 *   spends a ticket of its category in the same transaction. The ticket is an input of its own; leaving a coat
 *   makes the ticket from the wallet's coin and puts a token of its category on the rack.
 */

/** The Strongbox with its key as an input of its own, at index 0. */
export const keyedStrongboxTemplate = {
  ...strongboxTemplate,
  ...view('Keyed strongbox', 'Coins kept in a box. Whoever holds the box\'s key token can take them out. The key is spent first.'),
  actions: { ...strongboxTemplate.actions, take: action('Take everything out', 'Take every coin out of a strongbox. The key stays with you.', 'holder', ['boxKey', 'holder', 'label'], 'takeTransaction') },
  transactions: { ...strongboxTemplate.transactions, takeTransaction: { ...strongboxTemplate.transactions.takeTransaction, inputs: [{ input: 'boxKeyInput', inputIndex: 0 }, { input: 'boxInput' }] } },
  inputs: { ...strongboxTemplate.inputs, boxKeyInput: { ...view('Strongbox key', 'The box\'s key, spent and given back.'), token: { category: '$(<boxKey>)', nft: { capability: 'none', commitment: '$(<label>)' } } } },
  // The box offers its holder both actions: taking everything out, and putting more in.
  lockingScripts: {
    boxLockingScript: {
      ...strongboxTemplate.lockingScripts.boxLockingScript,
      roles: {
        holder: {
          ...strongboxTemplate.lockingScripts.boxLockingScript.roles.holder,
          actions: [
            { action: 'take', role: 'holder' },
            { action: 'add', role: 'holder' },
          ],
        },
      },
    },
  },
  scripts: { ...strongboxTemplate.scripts, unlockBox: '<0>' },
  variables: (({ keyInput: _keyInput, ...rest }) => rest)(strongboxTemplate.variables),
} as const;

/** The Club with each script naming its unlocking, and the locker offering its action to the member. */
export const lockerClubTemplate = {
  ...clubTemplate,
  ...view('Club with lockers', 'Join the club: a member card, a locker with a deposit, and the club\'s credits.'),
  lockingScripts: {
    doorLockingScript: { ...clubTemplate.lockingScripts.doorLockingScript, unlockingBytecode: 'unlockDoor' },
    lockerLockingScript: { ...clubTemplate.lockingScripts.lockerLockingScript, unlockingBytecode: 'unlockLocker', roles: { member: { selectable: false, actions: [{ action: 'use', role: 'member' }] } } },
  },
} as const;

/**
 * The rack: a coat goes to whoever spends, at the input whose number the unlocking gives, a token of the coat's
 * category. That input may not be the coat itself.
 */
const RACK = 'OP_DUP OP_INPUTINDEX OP_NUMNOTEQUAL OP_VERIFY OP_UTXOTOKENCATEGORY OP_INPUTINDEX OP_UTXOTOKENCATEGORY OP_EQUAL';

export const cloakroomTemplate = {
  $schema: SCHEMA,
  ...view('Cloakroom', 'Leave coins on a rack every guest shares, and take them back with the ticket.'),
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { guest: view('Guest', 'Holds a ticket.') },
  start: [{ action: 'leave', role: 'guest' }],
  actions: {
    leave: action('Leave a coat', 'Put coins on the rack and get a ticket for them.', 'guest', ['ticket', 'amount', 'holder'], 'leaveTransaction'),
    collect: action('Collect the coat', 'Take the coins back from the rack. The ticket stays with you.', 'guest', ['ticket', 'holder'], 'collectTransaction'),
  },
  transactions: {
    leaveTransaction: { ...view('Coat left', 'A coat of $(<amount>) satoshis was left on the rack.'), inputs: [], outputs: [{ output: 'coatOutput' }, { output: 'ticketOutput' }], version: 2, locktime: 0 },
    collectTransaction: { ...view('Coat collected', 'A coat was taken back from the rack.'), inputs: [{ input: 'ticketInput', inputIndex: 0 }, { input: 'rackInput' }], outputs: [{ output: 'ticketOutput' }], version: 2, locktime: 0 },
  },
  inputs: {
    ticketInput: { ...view('Ticket', 'The ticket, spent and given back.'), token: { category: '$(<ticket>)' } },
    rackInput: { ...view('Coat', 'A coat on the rack. A ticket of its category in the same transaction takes it.'), unlockingScript: 'unlockRack' },
  },
  outputs: {
    coatOutput: {
      ...view('Coat', '$(<amount>) satoshis on the rack, with a token of the ticket\'s category.'),
      lockingScript: 'rackLockingScript',
      valueSatoshis: '$(<amount>)',
      token: { category: '$(<ticket>)', amount: null, nft: { capability: 'none', commitment: '00' } },
    },
    ticketOutput: { ...view('Ticket', 'The token that takes the coat back. Keep it in the wallet.'), lockingScript: '$(<holder>)', valueSatoshis: '1000', token: { category: '$(<ticket>)', amount: null, nft: { capability: 'none', commitment: '01' } } },
  },
  lockingScripts: {
    rackLockingScript: {
      ...view('Rack', 'Every guest\'s coat hangs here.'),
      lockingType: 'p2sh',
      lockingBytecode: 'rackBytecode',
      unlockingBytecode: 'unlockRack',
      roles: { guest: { relevant: false, selectable: false, actions: [{ action: 'collect', role: 'guest' }] } },
    },
  },
  scripts: { rackBytecode: RACK, unlockRack: '<0>' },
  variables: {
    ticket: { ...view('Ticket', 'The token category of the ticket.'), type: 'token_category' },
    amount: { ...view('Amount', 'Satoshis to leave.'), type: 'satoshis' },
    holder: { ...view('Ticket holder', 'Where the ticket goes: an address of the wallet.'), type: 'locking_script' },
  },
} as const;

/*
 * Templates for the findings of section 12.3 (stage 15):
 *
 * - **Keyed pool**: a pool opened by a key the engine makes for the wallet under the template, as a liquidity pool that
 *   is opened by a key hash is. Opening one puts coins at a script that takes a key of the device; trading with it pays
 *   someone and leaves nothing behind.
 * - **Box with a rule**: the keyed strongbox, whose box the wallet follows by a rule the template gives as an
 *   expression, which the engine does not evaluate yet. Putting coins in puts them where the wallet cannot tell
 *   whether it would follow them; taking everything out leaves nothing behind.
 */

/** A pool that a key of the device opens: what is in it can be spent with that key alone. */
export const keyedPoolTemplate = {
  $schema: SCHEMA,
  ...view('Keyed pool', 'Coins in a pool that the key of the device that opened it unlocks. Anyone can trade with it.'),
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { provider: view('Provider', 'Opens a pool, and trades.') },
  start: [
    { action: 'open', role: 'provider', generate: ['poolKey'] },
    { action: 'trade', role: 'provider' },
  ],
  actions: {
    open: {
      ...view('Open a pool', 'Put coins in a pool that this device\'s key unlocks.'),
      roles: { provider: { generate: ['poolKey'], requirements: { variables: ['amount'], secrets: ['poolKey'] } } },
      requirements: { participants: [one('provider')] },
      transaction: 'openTransaction',
    },
    trade: action('Trade', 'Pay for a trade. Nothing stays in a pool.', 'provider', ['amount', 'payee'], 'tradeTransaction'),
  },
  transactions: {
    openTransaction: { ...view('Pool opened', 'A pool was opened with $(<amount>) satoshis.'), inputs: [], outputs: [{ output: 'poolOutput' }], version: 2, locktime: 0 },
    tradeTransaction: { ...view('Traded', '$(<amount>) satoshis were paid for a trade.'), inputs: [], outputs: [{ output: 'paymentOutput' }], version: 2, locktime: 0 },
  },
  inputs: {},
  outputs: {
    poolOutput: { ...view('Pool', '$(<amount>) satoshis in the pool.'), lockingScript: 'poolLockingScript', valueSatoshis: '$(<amount>)' },
    paymentOutput: { ...view('Payment', '$(<amount>) satoshis for the trade.'), lockingScript: '$(<payee>)', valueSatoshis: '$(<amount>)' },
  },
  lockingScripts: {
    poolLockingScript: {
      ...view('Pool', 'Unlocked by the key of the device that opened it.'),
      lockingType: 'p2sh',
      lockingBytecode: 'poolBytecode',
      unlockingBytecode: 'unlockPool',
      roles: { provider: { state: { secrets: ['poolKey'] }, balance: { satoshis: true }, selectable: false, actions: [] } },
    },
  },
  scripts: {
    poolBytecode: 'OP_DUP OP_HASH160 <$(<poolKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG',
    unlockPool: '<poolKey.schnorr_signature.all_outputs> <poolKey.public_key>',
  },
  variables: {
    poolKey: { ...view('Pool key', 'The key that unlocks the pool.'), type: 'private_key' },
    amount: { ...view('Amount', 'Satoshis.'), type: 'satoshis' },
    payee: { ...view('Payee', 'Who is paid for a trade.'), type: 'locking_script' },
  },
} as const;

/** The keyed strongbox, whose box the wallet follows by a rule given as an expression. */
export const ruledBoxTemplate = {
  ...keyedStrongboxTemplate,
  ...view('Box with a rule', 'Coins kept in a box. Whoever holds the box\'s key token can take them out. Whether a wallet follows a box depends on what it holds.'),
  lockingScripts: {
    boxLockingScript: {
      ...keyedStrongboxTemplate.lockingScripts.boxLockingScript,
      roles: { holder: { ...keyedStrongboxTemplate.lockingScripts.boxLockingScript.roles.holder, relevant: '$(<amount> 10000 OP_GREATERTHAN)' } },
    },
  },
} as const;

/*
 * Templates for the findings of stage 21:
 *
 * - **Pool with a rule**: the keyed pool, whose pool the wallet follows by a rule given as an expression. The pool takes
 *   a key of the device, so the wallet cannot tell whether what it puts there comes back.
 * - **Envelope**: coins left for someone else. One party, the giver, puts coins at a script that the keeper's key
 *   unlocks; the template says at the script that the keeper keeps that key. Given in the giver's role, nothing of the
 *   giver's is tied to its device; in the keeper's role, the coins are tied to the keeper's key.
 * - **Envelope without owners**: the envelope, with no role named at its script as keeping the key.
 * - **Joint envelope**: the envelope opened by a key of each party together, each kept by its own role.
 */

/** The keyed pool, whose pool the wallet follows by a rule given as an expression. */
export const ruledPoolTemplate = {
  ...keyedPoolTemplate,
  ...view('Pool with a rule', 'Coins in a pool that the key of the device that opened it unlocks. Whether a wallet follows a pool depends on what it holds.'),
  lockingScripts: {
    poolLockingScript: {
      ...keyedPoolTemplate.lockingScripts.poolLockingScript,
      roles: { provider: { ...keyedPoolTemplate.lockingScripts.poolLockingScript.roles.provider, relevant: '$(<amount> 10000 OP_GREATERTHAN)' } },
    },
  },
} as const;

const twoRoles = (name: string, description: string, variables: string[], transaction: string) => ({
  ...view(name, description),
  roles: { giver: { requirements: { variables } }, keeper: { requirements: { variables } } },
  requirements: { participants: [{ role: 'giver', slots: { min: 0, max: 1 } }, { role: 'keeper', slots: { min: 0, max: 1 } }] },
  transaction,
});

/** Coins left at a script that the keeper's key unlocks; the template says at the script that the keeper keeps it. */
export const envelopeTemplate = {
  $schema: SCHEMA,
  ...view('Envelope', 'Coins left for someone. Only the keeper\'s key opens the envelope.'),
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { giver: view('Giver', 'Leaves coins in an envelope.'), keeper: view('Keeper', 'Holds the key that opens the envelope.') },
  start: [
    { action: 'give', role: 'giver' },
    { action: 'give', role: 'keeper' },
  ],
  actions: {
    give: twoRoles('Leave an envelope', 'Put coins in an envelope that the keeper\'s key opens.', ['amount', 'keeperKeyHash'], 'giveTransaction'),
    collect: {
      ...view('Open the envelope', 'Take the coins out with the keeper\'s key.'),
      roles: { keeper: { requirements: { variables: ['holder'], secrets: ['keeperKey'] } } },
      requirements: { participants: [one('keeper')] },
      transaction: 'collectTransaction',
    },
  },
  transactions: {
    giveTransaction: { ...view('Envelope left', 'An envelope of $(<amount>) satoshis was left.'), inputs: [], outputs: [{ output: 'envelopeOutput' }], version: 2, locktime: 0 },
    collectTransaction: { ...view('Envelope opened', 'An envelope was opened.'), inputs: [{ input: 'envelopeInput' }], outputs: [{ output: 'collectedOutput' }], version: 2, locktime: 0 },
  },
  inputs: { envelopeInput: { ...view('Envelope', 'Opened with the keeper\'s key.'), unlockingScript: 'unlockEnvelope' } },
  outputs: {
    envelopeOutput: { ...view('Envelope', '$(<amount>) satoshis in an envelope.'), lockingScript: 'envelopeLockingScript', valueSatoshis: '$(<amount>)' },
    collectedOutput: { ...view('Collected', 'What the envelope held.'), lockingScript: '$(<holder>)' },
  },
  lockingScripts: {
    envelopeLockingScript: {
      ...view('Envelope', 'Opened by the keeper\'s key.'),
      lockingType: 'p2sh',
      lockingBytecode: 'envelopeBytecode',
      unlockingBytecode: 'unlockEnvelope',
      roles: {
        giver: { selectable: false, actions: [] },
        keeper: { state: { secrets: ['keeperKey'] }, balance: { satoshis: true }, selectable: false, actions: [{ action: 'collect', role: 'keeper' }] },
      },
    },
  },
  scripts: {
    envelopeBytecode: 'OP_DUP OP_HASH160 <keeperKeyHash> OP_EQUALVERIFY OP_CHECKSIG',
    unlockEnvelope: '<keeperKey.schnorr_signature.all_outputs> <keeperKey.public_key>',
  },
  variables: {
    keeperKey: { ...view('Keeper\'s key', 'The key that opens the envelope.'), type: 'private_key' },
    keeperKeyHash: { ...view('Keeper', 'The hash of the keeper\'s public key.'), type: 'bytes' },
    amount: { ...view('Amount', 'Satoshis.'), type: 'satoshis' },
    holder: { ...view('Holder', 'Where the coins go.'), type: 'locking_script' },
  },
} as const;

/** The envelope with no role named at its script as keeping the key. */
export const unownedEnvelopeTemplate = {
  ...envelopeTemplate,
  ...view('Envelope without owners', 'Coins left for someone. A key opens the envelope; the template does not say whose.'),
  lockingScripts: {
    envelopeLockingScript: {
      ...envelopeTemplate.lockingScripts.envelopeLockingScript,
      roles: { giver: envelopeTemplate.lockingScripts.envelopeLockingScript.roles.giver, keeper: { ...envelopeTemplate.lockingScripts.envelopeLockingScript.roles.keeper, state: {} } },
    },
  },
} as const;

/** The envelope opened by the giver's key and the keeper's together, each kept by its own role. */
export const jointEnvelopeTemplate = {
  ...envelopeTemplate,
  ...view('Joint envelope', 'Coins left for two. The giver\'s key and the keeper\'s key open the envelope together.'),
  lockingScripts: {
    envelopeLockingScript: {
      ...envelopeTemplate.lockingScripts.envelopeLockingScript,
      roles: { ...envelopeTemplate.lockingScripts.envelopeLockingScript.roles, giver: { state: { secrets: ['giverKey'] }, selectable: false, actions: [] } },
    },
  },
  scripts: {
    envelopeBytecode: '<giverKey.public_key> OP_CHECKSIGVERIFY <keeperKey.public_key> OP_CHECKSIG',
    unlockEnvelope: '<keeperKey.schnorr_signature.all_outputs> <giverKey.schnorr_signature.all_outputs>',
  },
  variables: { ...envelopeTemplate.variables, giverKey: { ...view('Giver\'s key', 'The giver\'s half of the envelope\'s lock.'), type: 'private_key' } },
} as const;

/** A template as an application would send it: its text. */
export const templateText = (template: unknown): string => JSON.stringify(template);
