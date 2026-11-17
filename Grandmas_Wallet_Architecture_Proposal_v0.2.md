# Grandma's Wallet

**Architecture proposal v0.2 — BCH Blaze 2026**  
**Date:** 17 November 2026  
**Status:** Design proposal for implementation and review. It replaces proposal v0.1. Some of what is described here exists as tested code: the recovery controller (which has also run on chipnet), reading and checking a controller's history, watching for requests, sealing and backup stores, and the connection messages. The addresses, the keys and the viewing key, the recovery kit as described here, the sweep, and everything that concerns applications are proposed and not yet implemented. Section 20 lists the status of each part. Nothing has been audited.

This document is the reference for implementation. [docs/design.html](docs/design.html) is an illustrated overview of the same design; where the two differ in detail, this document is the more specific one. The order of work and the exit criteria of each stage are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

"Required" and "must" describe a property the implementation has to achieve; they do not say the property has been demonstrated. Names of fields, messages, profiles and derivation paths are proposals until a formal schema is agreed; section 22 lists the ones that still need a decision.

## 1. Purpose and central design

Grandma's Wallet is a Bitcoin Cash wallet that can recover access after the user loses their phone, without the user making or keeping a backup. A trusted **recoverer**, which can be a business, a family member or a friend, can replace the wallet's owner. To do so it must publish a request on chain and wait through a waiting period, during which the existing wallet can cancel the request.

The central idea:

> Every address of the wallet can be spent in two ways. Its own key spends it directly, like any single-key address. The wallet's controller can also release it, and the controller obeys whoever owns the wallet's identity today.

Recovery changes the owner of the identity. The new owner then moves every coin and token to addresses of its own keys. This move is called the **sweep**.

Four consequences follow and shape everything else:

1. **Day to day, the controller is not involved.** A payment is signed by the keys of the coins it spends. Nothing on chain connects it to the controller or to the wallet's other coins.
2. **Applications do not need to know about recovery.** They deal with coins and tokens at the wallet's addresses. An application position is recoverable when its authority is a token that the wallet holds, because the sweep moves the token.
3. **The wallet looks like an HD wallet.** One seed gives a key and an address for every coin. A **viewing key**, held by the recoverer, lets a new device find the addresses again.
4. **A key change does not take effect on a coin until the coin is swept.** Until then the coin still obeys its earlier key as well. This is the price of the first three points and is treated throughout as a cost, not hidden.

The intended experience is unchanged:

> Set up recovery once, use the wallet normally, and ask the trusted recoverer for help if the phone is lost.

The recovery promise is:

> Given an available recoverer who holds the recovery kit, and a functioning blockchain, a new device can take over the wallet's identity after the waiting period and move to its own keys every coin, fungible token and NFT that sat at the wallet's addresses, including the tokens that carry authority over application positions.

The promise does not cover positions whose authority is a key written into a contract, state that exists only on an application's server, or coins that the holder of the earlier seed moves away before they are swept.

The recoverer is trusted to name the right new owner **once the waiting period has passed without a cancellation**. The blockchain cannot establish that a phone is lost. A working wallet must notice a request and get a cancellation confirmed in time.

## 2. Requirements and decisions

| Area | Requirement or decision |
| --- | --- |
| User custody | The seed is generated on the phone and never leaves it. Spending does not need the recoverer. |
| Recovery authority | The recoverer cannot spend, at any time. It can only request and, after the waiting period, complete a change of owner. |
| Loss detection | The absence of a cancellation is the observable condition. Actual loss cannot be proven. |
| Destination | The new owner key is named when recovery is requested, not at setup. |
| User backups | None required. A local backup is possible as an addition (section 18). |
| Everyday transactions | Signed by address keys only. The controller appears in a transaction only for setup, recovery, sweeps, vault spending and changes of settings. |
| Addresses | One per coin. Script addresses (P2SH32). Not linkable to each other or to the identity until a sweep. |
| Finding coins | From the identity and the viewing key alone, by deriving addresses in order and looking them up. No list of addresses is kept anywhere. |
| Viewing key | Held by the phone and the recoverer, with a sealed copy on backup stores. It shows every address and balance and gives no power to spend. |
| Asset support | BCH, fungible CashTokens and NFTs, at the same addresses. |
| Application positions | Recoverable when they follow three rules (section 12): authority is a token, the wallet's inputs and outputs are the wallet's business, and the token leads to the position. |
| Wallet and applications | The wallet knows no application. It builds each transaction itself from the application's XO template. The same application must also work with an ordinary wallet. |
| Application connections | WizardConnect with an extension, `xo_v1`. |
| Waiting period | Counted in time (units of 512 seconds), enforced by the network. |
| Networks | Chipnet for now. No rule or code may depend on chipnet. |
| Openness to privacy improvements | Applications never see the identity or the controller, so what a recovery reveals can be reduced later without changing applications. |
| Not required | P2PKH addresses; restoration in an unmodified standard wallet; recovery of the original seed. |

## 3. Participants and trust

**Owner's device.** Holds the seed, signs payments, watches the controller, cancels unwanted requests. Whoever can use the device can spend at once; recovery is no protection against that.

**Recoverer.** Holds the recovery kit: its key for this wallet, the identity and the viewing key. It can request and complete a recovery, and it can see every address and balance of the wallet. It cannot spend, cannot shorten the wait and cannot complete with a key other than the one it requested. After a wait that nobody cancelled, it can install a key of its own choosing; preventing that is outside the trust model.

**New device.** Makes a new seed. Before the request it has no power. After completion it is the owner: it sweeps and spends.

**Holder of an earlier seed.** After a recovery, whoever holds the earlier seed (the lost phone, if someone finds and unlocks it) can still spend coins that sit at that seed's addresses and have not been swept. They cannot spend from addresses of the new seed, from vault addresses, or act on the controller.

**Backup stores.** Keep sealed records: a copy of the viewing key, the templates the user trusted, labels. They cannot read them and they authorize nothing. They can withhold or delete.

**Applications.** Supply templates and action requests. They never hold a key and are never told the identity. They learn the addresses that appear in their own transactions.

**Network services.** Provide transactions, history and broadcast. The wallet checks each transaction against its identifier, reads a controller's history from several servers, and does not let a server define what a valid controller transition is.

## 4. Architecture

| Component | Responsibility |
| --- | --- |
| Recovery controller | One coin holding the identity NFT. Its state names the owner's controller key, the recoverer's key, the waiting period and any pending request. |
| Owner-approval rule | A shared script function. A coin released through the controller requires the controller to continue unchanged in the same transaction. |
| Recoverable address | The wallet's ordinary address. Two ways to spend: its own key, or the controller. |
| Vault address | An address with no key. Only the controller releases it. It stays valid through every change of owner. |
| Keys and viewing key | Derivation of every key and address from the seed; the part of it that is shared for finding coins. |
| Recoverer and recovery kit | What the recoverer is given, how it is delivered, and the two transactions the recoverer can make. |
| Backup stores | Sealed copies of what is convenient to keep: viewing keys, templates, labels. |
| XO engine and templates | Build and check transactions from templates, the wallet's own and each application's. |
| Connection (`xo_v1`) | Carries an application's request to the wallet and the result back. |
| Owner interface and monitor | Show effects, obtain approval, watch for requests, cancel. |
| Recoverer interface | Open a kit, request, follow the wait, complete, hand over viewing keys. |

### 4.1 Identity and controller

The wallet's **identity** is the token category of one NFT. The coin that holds this NFT is the **controller**. The NFT's commitment is the controller's state. The controller's script accepts four actions and always sends the NFT back to its own address with the next state.

The identity is fixed when the controller is created and never changes. The owner key, the recoverer and the waiting period are fields of the state and can change. The identity is public, but it is not written in any address.

The controller's address is specific to the wallet: the script takes the identity as a parameter. A wallet's controller can therefore be found and watched by address, and a notification for that address concerns that wallet only.

The controller carries 1,000 satoshis. A wallet's coins are separate outputs at separate addresses.

### 4.2 Two ways into every coin

A Bitcoin Cash script checks only the transaction that spends it. It cannot look up the current state of a controller elsewhere on chain. A coin whose spending rule depends on the controller's state must therefore be spent together with the controller.

If that were the only way to spend, every payment would carry the controller. All of a wallet's activity would be linked through one coin, only one action could be in flight at a time, two such wallets could not share a transaction, and every application would have to leave room for the controller at a fixed position.

This design gives each address a key of its own for everyday use and keeps the controller path for the cases where the key is gone or must not be relied on:

| Path | Needs | Used for |
| --- | --- | --- |
| Key | A signature by the address's own key | Every payment and every application action |
| Controller | The controller as input 0, approved by the current owner, plus the address's secret | The sweep after a change of owner; spending from a vault address |

Receiving never involves the controller.

### 4.3 What is where

| Thing | On chain | On the owner's device | With the recoverer | On backup stores |
| --- | --- | --- | --- | --- |
| Seed | — | Yes | — | — |
| Identity | Public (the controller's token category) | Yes | Yes | — |
| Controller state | Public | Read from chain | Read from chain | — |
| Address keys | Only the hash of each, inside a script hash | Derived from the seed | — | — |
| Address secrets | Shown for an address only when it is swept | Derived | Derivable from the viewing key | — |
| Viewing key | — | Derived | Yes, in the recovery kit | Sealed copy |
| Recoverer's key | Its hash, in the controller state | — | Yes | — |
| Application templates | — | Yes, once trusted | — | Sealed copy |

### 4.4 Choices and their alternatives

| Choice | Alternative | Why this way |
| --- | --- | --- |
| The controller stays out of everyday transactions | Every spend passes through the controller, so a key change takes effect at once and nothing has to move | See section 4.2: linkable activity, one action at a time, no shared transactions, and a fixed place for the controller in every application. |
| Authority over a position is a token | The application's contract names the identity and checks the controller itself | The application would have to know this scheme and carry its code. A token is something existing applications already use, and it moves with an ordinary transfer. |
| The wallet builds the transaction | The application builds it from the wallet's public keys and the wallet signs | The application would have to understand the wallet's scripts. With a template the wallet knows what it is signing and the application needs no knowledge of the wallet. |
| One address per coin, identity hidden in a tag | One address for the whole wallet, with the identity in its script | A single address makes the wallet as traceable as an account number. The tag costs one hash and one secret per address. |
| The recoverer keeps the viewing key | The new device finds addresses from public data alone | Addresses that can be found from public data can be found by everyone. The recoverer is already trusted with the wallet's future. |
| Readable controller state | A hashed state | The state is shown whenever the controller is used (section 5.1). |
| A vault address beside the ordinary ones | Only addresses with a key | Some payments arrive long after the address was given out. An address with a key goes stale at a recovery; a vault address does not. |

## 5. Controller state machine

### 5.1 State

The state is 69 bytes in the identity NFT's commitment. Commitments of up to 128 bytes are allowed since the May 2026 upgrade; this was checked in the libauth 2026 virtual machine with standardness on (decision D1).

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 1 | Version of the rules, `0x01` |
| 1 | 1 | Status: `0x00` Active, `0x01` Pending |
| 2 | 4 | Owner epoch, little-endian, 0 to 2^31−1 |
| 6 | 20 | Hash (hash160) of the owner's controller public key |
| 26 | 20 | Hash of the recoverer's public key |
| 46 | 3 | Waiting period as a BIP68 relative lock time, little-endian |
| 49 | 20 | Hash of the proposed owner's controller public key; all zero when Active |

Integers are fixed-width little-endian with the top bit clear. The waiting period keeps only the BIP68 value (low 16 bits) and the type flag (bit 22): 1 to 65,535 blocks, or 1 to 65,535 units of 512 seconds (about 388 days). A reader checks the version first and refuses any other. Zero key hashes are invalid; Active with a proposed owner and Pending without one are invalid.

The state is readable by anyone. A hashed state would not hide it for long: the script needs the state itself in every controller transaction, so it would be published the first time the controller is used. What could link two wallets is the recoverer's key hash, so the recoverer uses a different key for every wallet (section 9.2), and the owner's controller key is used for nothing but the controller.

### 5.2 Actions

| Action | Signed by | From | Result | Used for |
| --- | --- | --- | --- | --- |
| `ownerAuthorize` | Owner's controller key | Active or Pending | Active; owner, recoverer, waiting period and epoch unchanged; any request cleared | Sweeps, spending from a vault address, cancelling a request |
| `requestRecovery` | Recoverer's key | Active only | Pending with the named proposed owner; nothing else changes | First step of recovery |
| `finalizeRecovery` | Recoverer's key, after the waiting period | Pending only | Active; the proposed owner becomes the owner; epoch + 1 | Second step of recovery |
| `ownerUpdate` | Owner's controller key | Active or Pending | Active with the given owner, recoverer and waiting period; epoch + 1 only if the owner changed; any request cleared | Moving to a new seed without the recoverer; changing the recoverer or the waiting period |

Rules that hold for every action:

- The controller is input 0 and its successor is output 0. The transaction version is 2.
- The successor has the same locking script, the same token category and capability (mutable), the same fungible amount, and at least the same value in satoshis.
- The signature must cover every input and every output. Two signing types are accepted: `0x41` (all inputs and outputs) and `0x61` (the same, plus the amount and script of every spent output). The current XO engine cannot produce a valid `0x61` signature for a transaction with more than one input (decision D8), so `0x41` has to be accepted.
- Anyone may attach further inputs and outputs. The signer's signature covers all of them.

The contract is `contracts/controller.cash`: 412 bytes compiled, plus the 33-byte push of the identity.

### 5.3 Requesting recovery

The recoverer may request without proving that the phone is lost. The waiting period starts with the new controller output. Protection comes from the wait and the owner's chance to cancel, not from any claim about the phone.

The request keeps the owner, the recoverer and the waiting period, names the proposed owner, and gives no power over any coin. While a request is pending the recoverer cannot change the proposed owner or make a second request, including one naming the same key. A different destination requires the first request to be cancelled or completed, which gives a fresh wait.

### 5.4 Waiting period

The wait is a relative lock on the **pending controller output**. It does not depend on the age of any coin of the wallet, on a time supplied by the recoverer, or on a device's clock.

Time-based periods are compared by nodes against the median time of the last eleven blocks, which trails the clock. Observed on chipnet with one-minute blocks: with one 512-second unit, completion was accepted about 11 minutes after the request was sent, and completion right after the request was refused (decision D13). A period counted in blocks depends on what a network makes of a block, so the wallet offers time only.

The length of the waiting period for real use is an open product decision.

### 5.5 Cancelling and completing

The owner cancels with `ownerAuthorize`. Spending the pending controller makes a completion that refers to that output invalid.

**An ordinary payment does not cancel a request.** Payments are signed by address keys and do not touch the controller. The owner's device has to notice the request and send a cancellation, which is a transaction of its own (section 17).

The owner has no priority at the deadline. Once the wait is over, a cancellation and a completion race until one is confirmed. The aim is a confirmed cancellation well before that point.

Completion installs exactly the key named by the request, clears the request and raises the epoch. **No coin moves.** Coins move in the sweep, which the new owner makes afterwards with `ownerAuthorize` (section 11).

### 5.6 Changing settings

`ownerUpdate` replaces the owner key, the recoverer or the waiting period in one step. It is how an owner who still has the old device moves to a new seed without the recoverer and without waiting, and how a recoverer is replaced. The new waiting period is checked on chain (only the BIP68 value and type flag, value not zero); zero key hashes are refused.

### 5.7 Creation, and what a client must check

A token category is the identifier of the transaction whose output 0 the creating transaction spends. Creating an identity therefore needs a coin of the wallet that is output 0 of its transaction; the wallet makes one by paying itself if it has none (section 7.9).

The controller's script does not check its own first state. Before trusting an identity, a client must check the creating transaction: exactly one output carries a token of the category; it is an NFT with mutable capability and no fungible amount; its commitment is a valid Active state with epoch 0; and it is locked by the controller script for that identity. No minting capability may exist. With a mutable token and a fixed fungible amount, the network's own rules then prevent a second token of the category from ever being created. From there the client follows each spend of the controller to the current state, checking every transition (`packages/core/src/genesis.ts`, `history.ts`).

## 6. The owner-approval rule

The integration rule is:

> The presence of the controller in a transaction is not approval by the owner.

The recoverer can also spend the controller, to request or to complete. If an address accepted any transaction that carries the controller, the recoverer could attach coins to its request and take them without waiting.

Every script that offers the controller path therefore calls one shared function:

```
function ownerApproves(bytes32 identity) {
    // Input 0 is this identity's controller.
    require(tx.inputs[0].tokenCategory == identity + 0x01);
    bytes state = tx.inputs[0].nftCommitment;
    require(state.length == 69);
    require(state.split(1)[0] == 0x01);
    // It continues as Active with the same owner, epoch, recoverer and waiting period.
    require(tx.outputs[0].tokenCategory == identity + 0x01);
    require(tx.outputs[0].nftCommitment == 0x0100 + state.slice(2, 49) + bytes20(0));
}
```

(`contracts/lib/authorization.cash`. `identity` is in the byte order scripts see, which is the reverse of the order explorers show.)

Properties:

1. **Only the owner can produce that successor.** Of the controller's actions, only `ownerAuthorize`, and an `ownerUpdate` that changes nothing, leave the state as required, and both need the owner's signature. A request leaves a request pending; a completion changes the owner and the epoch. Neither can carry a coin with it.
2. **The owner's signature is checked once, by the controller,** and covers every input and output. The released coin checks no signature of its own.
3. **The rule names a version.** It accepts only state version `0x01`. A later set of controller rules must keep the property that the unchanged successor cannot be reached without the owner's signature, or use another version byte, which existing addresses will then refuse.
4. **The rule checks the token, not the controller's script.** It relies on the identity NFT never leaving the controller script, which the controller enforces from its first state on. This is one reason the creating transaction must be checked (section 5.7).
5. **One approval releases every such input in the transaction.** The wallet that asks for the owner's signature must examine every input and show everything that is being moved.

The rule is written but no contract on the working branch uses it yet, so it has no tests there. Its tests arrive with the address contracts.

## 7. Keys, addresses and the viewing key

### 7.1 The seed

The seed is one random secret, made on the phone, from which every private key of the wallet is computed. It is the standard one: 128 bits of randomness written as twelve words (BIP39), stretched to 64 bytes, and used as the root of a BIP32 key tree. It never leaves the phone and the user is not asked to write it down.

The design uses the HD wallet primitives unchanged: BIP39 for the words, BIP32 for deriving keys. libauth implements both, and the XO engine derives its keys the same way.

### 7.2 What is derived

| Derived value | Proposed place in the tree | Used for |
| --- | --- | --- |
| Controller key | `m / P' / S' / 0' / 0` | The owner entry in the controller. Nothing else. |
| Address node | `m / P' / S' / 1'` | Parent of every address key |
| Address key (*c*, *i*) | address node `/ c / i`, both steps not hardened | The key of one address. *c* = 0 for addresses given out to be paid, 1 for change and for outputs the wallet names in application transactions. *i* counts from 0. |
| Blinding seed | SHA-256 of the private key at `m / P' / S' / 2'` | Source of every address secret |
| Funding key | `m / P' / S' / 3' / 0` | An ordinary P2PKH address used only to create the wallet (section 7.9) |

`P` is XO's purpose number: 2415 on mainnet, 42415 on test networks, so keys differ between networks. `S` is a constant for this scheme, to be fixed (section 22).

Requirements behind the layout, which hold whatever numbers are chosen:

- **Address keys are plain children of one node**, so one extended public key gives every address's public key and no private key.
- **The index is a counter.** A new device finds addresses by trying 0, 1, 2 and so on.
- **The controller key is not on the address chain** and cannot be worked out from the viewing key, even together with address private keys.
- **The blinding seed and the keys are independent.** Neither can be worked out from the other.
- **Everything follows from the twelve words and the network.** Nothing random is added later.

Whether the XO engine can be made to use these keys is not known. The addresses the engine made for ordinary coins could not be reproduced with a counter from 0 (indices 0 to 59 were tried). How the engine chooses the index, and whether the wallet can choose instead, is one of the first trials in the plan. If it cannot, the wallet's coins are handled by this project's own code beside the engine.

### 7.3 Address secrets and tags

Each address has, besides its key, a 32-byte **secret**:

```
secret(kind, n) = hash256( blinding seed ‖ kind ‖ n as 4 bytes, little-endian )
kind: 0x00 addresses given out · 0x01 change and application outputs · 0x02 vault addresses
```

and a **tag** that ties it to the identity without showing it:

```
tag = hash256( identity ‖ secret )        identity in the byte order scripts see
```

`hash256` is SHA-256 applied twice, as `OP_HASH256` computes it. The secrets of different addresses are unrelated to anyone who does not hold the blinding seed: showing one, as a sweep does, says nothing about another.

### 7.4 The recoverable address

```
contract RecoverableAddress(bytes32 tag, bytes20 keyHash) {
    // Everyday path: the key this address was made for.
    function spend(pubkey pk, sig s) {
        require(hash160(pk) == keyHash);
        require(checkSig(s, pk));
    }
    // Recovery path: whoever owns the identity today, through the controller.
    function sweep(bytes32 identity, bytes32 addressSecret) {
        ownerApproves(identity);
        require(hash256(identity + addressSecret) == tag);
    }
}
```

Address (*c*, *i*) is the P2SH32 address of `RecoverableAddress(tag(c, i), hash160(public key(c, i)))`. It holds BCH, fungible tokens and NFTs alike. To a payer or an application it is an ordinary script address; nothing shows that it is recoverable or which wallet it belongs to.

Notes for implementation:

- **`spend` is the P2PKH rule inside a script address.** The wallet signs with a type that covers all inputs and outputs. The script does not restrict the type.
- **`sweep` proves knowledge of the secret and names the identity.** The identity cannot be substituted: `ownerApproves` compares it, with one byte appended, to a 33-byte token category, which fixes its length at 32 bytes, so the 64 hashed bytes cannot be split another way.
- **The sweep path is open to the current owner at any time,** not only after a recovery. It is also how a coin that arrives at an earlier address later is collected.
- **A sweep publishes the identity and the secret of each address it empties.** After that, anyone can see that the address belongs to this identity. Only the owner can still use the path.
- **The tag check comes last** in each function, because the compiler requires a function to end on a check of its own.
- **Sizes.** A trial compilation gives 96 bytes of rules for the recoverable address and 75 for the vault address; with the tag and key hash the scripts are 150 and 108 bytes. From those sizes, an input spent by its key is about 300 bytes and a swept input about 260, against about 140 for P2PKH. These are computed, not measured on transactions, and the scripts are untested. Outputs at a script address also have a higher minimum value than P2PKH outputs.

### 7.5 The vault address

```
contract VaultAddress(bytes32 tag) {
    // No key. Only the identity's current owner, through the controller.
    function spend(bytes32 identity, bytes32 addressSecret) {
        ownerApproves(identity);
        require(hash256(identity + addressSecret) == tag);
    }
}
```

Vault address *j* is the P2SH32 address of `VaultAddress(tag)` with `secret(0x02, j)`. It depends on no key, so it stays valid through every recovery.

It is for an address that must outlive a key change: one printed or published to be paid at any time, or a payout address written into a contract long before the payout arrives. Unlike an ordinary address it is meant to be used more than once.

Consequences:

- **Spending needs the controller at input 0.** An application's transaction has no room for that, so a coin is first moved from the vault to an ordinary address. A plain payment can be made from the vault directly.
- **The first spend links the vault address to the identity in public.** Payments to one vault address are in any case linked to each other, as with any reused address.
- **A vault coin never obeys an earlier seed.** After a recovery it is at once and only the new owner's. This cuts both ways (section 19).

### 7.6 The viewing key

The viewing key is two values, computed on the phone from the seed when the wallet is created:

| Value | Form | Gives |
| --- | --- | --- |
| Extended public key of the address node | Standard BIP32 text, 111 characters, `xpub…` on mainnet and `tpub…` on test networks | The public key of every address |
| Blinding seed | 32 bytes | The secret of every address and vault address |

Together with the identity they give every address of the wallet, and so every balance and the whole history. They give no power to spend: there is no private key in them, and the controller path needs the owner's signature. Either value alone gives no address.

The viewing key is held by the phone, by the recoverer inside the recovery kit, and as a sealed copy on backup stores. **Without it a new owner cannot find the addresses or show their secrets, so it is as necessary for recovery as the recoverer's key.**

Each seed has its own viewing key. After a recovery the wallet has a new seed and a new viewing key, and the earlier ones are kept: they find coins that still arrive at earlier addresses.

One property is inherited from BIP32 and must be respected: an extended public key together with the private key of any one of its children gives the private keys of all of them. The viewing key must stay away from anyone who could also obtain a private key of the wallet.

### 7.7 Finding coins

A device that holds the identity and a viewing key restores the wallet the way an HD wallet is restored:

1. For each kind (given out, change, vault), derive address 0, 1, 2 and so on.
2. Ask the servers for each address's history. An address with any history counts as used.
3. Stop a kind after a run of unused addresses (the gap limit). Proposed: 20 for addresses given out, 5 for change and application outputs, which are used as soon as they are made, and 5 for vault addresses.
4. For every used address, list what is unspent there, with its tokens.

The device then knows, for each coin, the address's secret, which is what the controller path needs. With the seed as well, it knows the key.

The wallet never gives out an address more than the gap limit past the last one that was used. Without this rule a later scan, which keeps no list, could stop before an address that was given out and paid afterwards.

A wallet in use keeps watching the addresses it has used and the gap beyond them, including those of earlier seeds, because a payer may use an old address again. A coin that arrives at an earlier address after a recovery is collected through the controller path like any swept coin (section 11.2). Until it is collected, the earlier seed's key spends it too. This is not what the vault address is for: a vault address has no key at all, so nothing sent to it ever obeys an earlier seed (section 7.5).

### 7.8 How this differs from an HD wallet

| | HD wallet | This wallet |
| --- | --- | --- |
| Address | Hash of a public key (P2PKH) | Hash of a script holding the key hash and a tag (P2SH32) |
| Ways to spend | The key | The key, or the controller |
| What gives the addresses | The seed, or the extended public key | The seed or the viewing key, **and** the identity. The identity exists only once the controller is created on chain and cannot be worked out from the seed. |
| Per-address data | A key | A key and a secret |
| Watch-only key | Extended public key | Extended public key and blinding seed |
| Keys outside the address chain | None | The controller key |
| Losing the seed | Loses the coins | A new seed takes over the identity and the coins are moved to its addresses |

Fresh addresses, change addresses and scanning with a gap limit work the same way in both.

### 7.9 The first coins

An address needs the identity, and the identity is the identifier of a transaction, so the wallet's first coins cannot arrive at a recoverable address. Creation takes three steps:

1. **Fund.** The user sends coins to the wallet's funding address, an ordinary P2PKH address of the funding key.
2. **Prepare.** The wallet pays itself, so that it has a coin that is output 0 of its transaction. The identifier of this transaction is the identity. (If the coin received is already output 0 of its transaction, this step is not needed and that transaction's identifier is the identity.)
3. **Create and move.** A transaction spends that coin and creates the controller. The rest is moved to recoverable addresses, and the recoverer's fee allowance set aside (section 9.6), in the same transaction or the next.

The wallet gives out no address until the transaction that defines the identity is confirmed: if it were replaced, the identity would be another.

Two things follow. The funding address is not recoverable; it is shown only until the wallet exists, and a coin sent to it later can be moved only while the seed is at hand. And the wallet's first coins can be traced to the creation of its identity, through the transaction that prepared both. Coins received later cannot.

## 8. Normal operation

**Receiving.** The wallet shows a fresh address of kind "given out" for each request. Nothing is written on chain and the controller is not involved. For a lasting address it shows a vault address.

**Paying.** The wallet picks coins, signs each input with its address key, and sends change to a fresh change address. Fungible tokens and NFTs move the same way. Several payments can be in flight at once, and the wallet can take part in a transaction with other parties.

**Application actions.** The wallet builds the transaction from the application's template, adds its own inputs and outputs, and signs with address keys (sections 12 to 14). Tokens that carry authority over a position are held at ordinary addresses.

**Controller transactions.** Cancelling a request, changing settings, sweeping and spending from a vault address spend the controller. The fee is paid by a coin of the wallet, signed by its key. That coin, and its change, are visibly in a transaction with the identity. The wallet keeps a small coin for this purpose and does not mix its change with other coins.

**Who can spend what**

| Who | Addresses of the current seed | Addresses of an earlier seed | Vault addresses |
| --- | --- | --- | --- |
| Owner, current seed | Yes, by signature | Yes, through the controller | Yes, through the controller |
| Recoverer | No | No | No |
| Holder of an earlier seed | No | Yes, until the coin is swept | No |
| Application | Never holds a key. It gets what the owner signs for, one transaction at a time. | | |

The third row is the cost of the design. Completing a recovery does not disarm the earlier seed; sweeping does, coin by coin.

## 9. The recoverer and the recovery kit

### 9.1 Separate keys for separate powers

| Material | Power | Held by |
| --- | --- | --- |
| Seed | Spend; act as owner on the controller | Owner's device |
| Recoverer's key for this wallet | Request and complete a recovery | Recoverer |
| Viewing key | See addresses and balances; find coins | Owner's device, recoverer, sealed on backup stores |
| Recoverer's encryption key | Open a recovery kit sent to it | Recoverer |
| Backup content key | Read the backup records | Owner's device, recoverer |
| Connection keys | One session with one application | Wallet and application |

No value in the second to sixth rows can be turned into a signature for a coin.

### 9.2 The recoverer's key

The recoverer's key is an ordinary key pair. On chain it appears only as a 20-byte hash in the controller's state. It is in no address: an address holds only its own key hash and its tag. There is therefore one recoverer key per wallet, not per coin, and the recoverer never signs for a coin. It signs two kinds of transaction, the request and the completion, both of which spend only the controller and a coin for the fee.

**The recoverer uses a different key for every wallet it serves.** Two wallets with the same recoverer then have no value in common on chain.

Who makes the key is a decision still to be taken (section 22). Two ways:

| | The owner's device makes it | The recoverer makes it |
| --- | --- | --- |
| How | The device makes a separate twelve-word credential, puts the hash of its key into the controller, seals the words into the recovery kit, and does not keep them. | The recoverer makes a key for this wallet and gives the device its hash before the wallet is created. |
| Setup | One-way. The recoverer need not be reachable when the wallet is created. | Needs an answer from the recoverer first. |
| A key per wallet | Automatic | Depends on the recoverer |
| Who has known the key | The device, briefly, and the recoverer. A device that kept it could request and, after an uncancelled wait, complete. It could not spend with it, and whoever controls the device is the owner anyway. | The recoverer only |

This proposal takes the first as the default. The credential must be unrelated to the owner's seed: not a key of the owner's tree and not derivable from it.

### 9.3 Delivery

The owner first obtains the recoverer's encryption public key through a channel they trust, and the wallet shows the key's fingerprint for comparison. This is an encryption key, not a wallet key and not an extended public key.

The kit is signed by the owner's controller key and sealed to the recoverer's encryption key with HPKE (RFC 9180) in base mode: X25519, HKDF-SHA256, ChaCha20-Poly1305. It is sent once, in the part of a link after `#`, which browsers do not send to servers, or as a QR code. Sealing adds 49 bytes. Anyone may see the sealed kit in transit; only the holder of the matching private key can open it, and sealing the same kit twice gives unrelated bytes. Who made the kit is settled by the signature inside it and by the chain, not by the encryption. (`packages/enrollment`; decision D14.)

Creating the wallet needs only the owner. The recoverer can open the kit later. The interface must distinguish "kit made" from "the recoverer has confirmed it", and must say that coins received before the confirmation are not yet recoverable.

### 9.4 What the kit contains

| Field group | Purpose |
| --- | --- |
| Format, version, network | Unambiguous reading; no use on another network |
| Identity and the transaction that created it | Find and check the wallet |
| Version of the controller rules; reference to the wallet's template (identifier and content hash) | Choose compatible behaviour |
| Recovery credential, or a statement that the recoverer holds its own key | Authorize the request and the completion |
| Viewing key of the current seed, and those of earlier seeds if any | Hand to a new device after completion |
| Backup stores: addresses, archive identifier, content key | Read the sealed records |
| Policy as the owner saw it: owner key hash, recoverer key hash, waiting period, who the kit is for, time of making | Compare with the chain |

The kit must fit a QR code (2,953 bytes at the largest size and lowest error correction). Templates and other growing data are not in it; they are on the backup stores.

The kit lets the recoverer read the wallet. That has to be explained to the user: secrecy from someone watching the delivery is not secrecy from the recoverer.

### 9.5 Checking and confirming

The recoverer checks a kit against the chain before relying on it:

- it is for this network and its signature is valid;
- the identity's creation is valid (section 5.7) and the controller can be followed to a current state;
- the signer's key hash is the owner in that state;
- the credential's key hash is the recoverer in that state;
- the waiting period is the one the kit states.

It then leaves a confirmation, signed with the recoverer's key, on the backup stores. The wallet finds it there, so no channel from the recoverer back to the owner is needed. A confirmation of another kit, or one not signed by the recoverer's key, does not count.

### 9.6 Fees for the recoverer

A request and a completion each need a coin to pay the fee; a controller transaction is about 1,000 bytes. When the wallet is created it sets aside an allowance for the recoverer at an ordinary address that the recoverer's key controls. The proposed amount covers three requests and one completion, so that requests the owner cancels do not leave the recoverer unable to act. A recoverer can add coins of its own at any time.

The controller's own value cannot be used for fees: the successor must carry at least the same value.

### 9.7 Keeping the kit current

- **After a recovery** the recoverer's key is still the one in the state, so the credential stays valid. The recoverer adds the new seed's viewing key, which it was given before the request (section 11), and the new backup access.
- **When the owner replaces the recoverer** (`ownerUpdate`), the new recoverer gets a new kit with every viewing key. The earlier recoverer keeps what it was given: it can still see the addresses of the seeds whose viewing keys it holds. To end that, the owner also moves to a new seed, by `ownerUpdate` and a sweep, and gives the new viewing key to the new recoverer only.
- **A request the recoverer did not make** means its key is in other hands. The owner cancels and replaces the recoverer.

## 10. Backup data

### 10.1 What recovery depends on

Two separate conditions decide whether something is recovered:

1. **Authority.** The new owner can act on it. For coins and tokens at the wallet's addresses this follows from owning the identity. For an application position it follows from rule 1 (section 12).
2. **Information.** The new owner can find it and knows what it is.

| Information | Needed for | If it is lost |
| --- | --- | --- |
| Identity | Everything | The recoverer cannot act. It is in the kit. |
| Viewing keys | Finding coins and showing their secrets | Coins cannot be found or swept. **Indispensable.** |
| An application's template | Showing what a token means and operating its position | The token is still swept and safe. The template can be had again from the application or from any copy; it is identified by its hash. |
| Which template made which token | Convenience | The wallet can test a token against templates the user trusts (section 10.4). |
| Labels | Convenience | Names are lost. |

No per-payment and no per-address record is needed. This is what keeps the backup small and makes a missed write harmless in most cases.

### 10.2 Records

| Record | Contents | Written |
| --- | --- | --- |
| Viewing key | The viewing key of one seed, with its epoch | When the wallet is created, and by a new device before its request |
| Template | The template, whole and as the text it arrived in; its identifier and content hash; the recovery declaration that came with it (section 13.3) | When the user trusts a template |
| Token note | Token category; identifier of the template; which authority entry of its declaration | When an action creates an authority token |
| Label | A name the user gave | When given |
| Confirmation | "This kit was received", signed with the recoverer's key | By the recoverer |

A template is kept whole because its identifier depends on the order of its fields; a registry or the application's site may not exist later.

### 10.3 Sealing, stores and authenticity

Records are encrypted with XChaCha20-Poly1305 under the content key and stored as blobs named by their hash, on one or more stores. A store sees neither whose the blobs are nor what they hold. The device keeps a full copy, from which a store can be filled or replaced without the old one taking part. (`packages/archive`, `apps/archive-store`.)

The recoverer holds the content key, and so does a lost phone. The content key therefore cannot be what makes a record genuine. Each record is signed by the owner's controller key of its epoch, and a reader accepts it only if the controller's history shows that key as the owner in that epoch. Two exceptions: the confirmation is checked against the recoverer's key in the state, and a record that a new device writes before its request is signed by the proposed key and counts once the controller shows that key as the owner.

Stores can withhold. Using more than one, and keeping the device's copy, reduces that risk and does not remove it.

### 10.4 What a record can and cannot do

A record is a hint, never an authority.

- A token note is checked: the wallet rebuilds the position's address from the token and the template, and the address must exist on chain as the template says.
- Without a note, the wallet can try each template the user trusts: rebuild the position's address from the token and look for that address in the transaction that created the token.
- No record can make the wallet treat an address as its own. Addresses come only from the identity and a viewing key.
- A viewing-key record that does not produce the addresses the chain shows is of no use and does no harm.

### 10.5 Writing before depending

| Before | This must be safely stored |
| --- | --- |
| The wallet says that recovery is on | The recoverer has confirmed the kit |
| The first action of a template | The template, on the configured stores. By default the wallet refuses the action if no store confirms. |
| A recovery request to a new device's key | The new device's viewing key, with the recoverer |

The third row keeps the wallet recoverable at every moment: as soon as the new device becomes the owner, the recoverer already holds what a later recovery will need.

### 10.6 After a recovery

The earlier device knows the earlier backup's content key. The new device therefore starts a new archive, with a new identifier and key, and gives the recoverer access to it together with its viewing key. The earlier archive is read once, for templates, notes and labels, and then left.

## 11. Complete recovery procedure

### 11.1 Steps

0. **Setup, while all is well.** The wallet creates its controller, naming the recoverer's key hash and the waiting period. It sends the recoverer the kit. The recoverer checks it against the chain and confirms.
1. **A new device.** It makes a new seed. It gives the recoverer, sealed to the recoverer's encryption key: the hash of its controller key, its own viewing key, access to a new backup archive, and an encryption key of its own for the answer in step 6. Both sides show a fingerprint of the proposed key.
2. **The recoverer satisfies itself** that the person is the wallet's user and that the proposed key is theirs. How is the recoverer's own process; the design depends on it.
3. **Request.** The recoverer signs `requestRecovery` naming that key hash. The controller is Pending, on chain.
4. **Wait, and the owner's chance to refuse.** Everyone computes the end of the wait from the chain. A wallet that still works and did not ask for this cancels. If the request is cancelled or reorganized away, the recoverer stops.
5. **Complete.** After the waiting period the recoverer signs `finalizeRecovery`. The proposed key is the owner; the epoch has gone up. No coin has moved.
6. **Hand over.** The recoverer gives the new device, sealed to the device's encryption key, the identity, the creating transaction, every earlier viewing key and the earlier backup access. The new device checks the identity's history itself and sees its own key as the owner.
7. **Sweep.** The new device finds every coin and moves it to addresses of its own seed (section 11.2). It starts with what is worth most.
8. **Understand what the tokens are.** A swept NFT is already under the new owner's control. To show it as "a jar with 0.3 BCH that opens in March", the wallet needs the application's template, from the backup or from the application when the user connects again. Recovery does not wait for this.
9. **Resume protection.** The new device watches the controller, keeps watching earlier addresses, and tops up the recoverer's fee allowance.

The recoverer never learns the new device's seed. It does have the agreed power to name another key after an uncancelled wait, so identifying the user correctly stays its responsibility.

### 11.2 The sweep

| | Contents |
| --- | --- |
| Input 0 | The controller, `ownerAuthorize`, signed by the new owner's controller key |
| Inputs 1… | Coins at earlier addresses, each unlocked with `sweep(identity, secret)`; vault coins with `spend(identity, secret)` |
| Output 0 | The controller, state unchanged and Active |
| Outputs 1… | Addresses of the new seed. Fungible tokens and NFTs are carried over with category, amount, capability and commitment unchanged. |
| Fee | Taken from the swept BCH |

Rules for the wallet:

- **Everything is covered by one signature,** the owner's on the controller. Nobody can add to the transaction or change an output.
- **A large wallet is swept in several transactions.** Each spends the controller output of the one before. An interruption between parts loses nothing: what is not yet swept is found again by the same scan.
- **A wallet with tokens and no BCH still needs a fee.** The new device must have a source: a coin received at a new address, or one given by the recoverer.
- **A sweep also cancels a pending request,** since it uses `ownerAuthorize`.
- **Coins that arrive at an earlier address later are swept the same way** when the wallet notices them.
- **Application tokens need no special handling.** An NFT of an application the wallet has never heard of is swept like any coin.

### 11.3 What each party holds and can do

| Party | Holds | Can do | Cannot do |
| --- | --- | --- | --- |
| Owner's device | The seed; the identity; the viewing key | Spend, cancel a request, change the recoverer | |
| Recoverer | Its key for this wallet; the identity; the viewing keys | Request and complete a recovery. See every address and balance. | Spend anything. Shorten the wait. Complete with a key other than the one requested. |
| New device | Its own new seed. After completion: the identity and the earlier viewing keys. | After completion: sweep and spend | Anything before the wait is over |
| Backup stores | Sealed records | Hand the records back | Read them |

### 11.4 What the waiting period protects against

It protects against a recoverer, or a thief of the recoverer's key, who acts without being asked, as long as the owner's device notices in time. A recoverer who names its own key and is not cancelled gets the wallet.

It does not protect against a thief who can use the owner's phone. Such a thief is the owner: they can spend at once, cancel every request, and replace the recoverer.

## 12. Applications

### 12.1 Three rules

An application that follows these rules is recoverable by this wallet, and by any wallet that implements the same scheme, without knowing that recovery exists.

| Rule | Statement | Means |
| --- | --- | --- |
| 1. Authority is a token | Whoever may act on a position is whoever spends its ownership NFT in the same transaction. Payouts go to an address the wallet supplied. | No user key or key hash inside an application contract. A key cannot be replaced; a token can be moved. |
| 2. The wallet's parts are the wallet's business | The application does not assume the wallet's inputs are P2PKH or have a fixed size. Tokens and change go to an address the wallet names. | "Back to the address it came from" is acceptable: after a sweep that is a new address. |
| 3. The token leads to the position | From the NFT alone (its category and commitment) and the template, a wallet can find the position on chain and list the actions it offers. | No application server and no private note is needed to find a position again. |

### 12.2 Why these are enough

- **Recovery never touches an application contract.** The sweep moves the NFT from one wallet address to another. The position stays where it is.
- **The application's transaction layout is its own.** The controller is not in application transactions, so an application may fix its input and output positions as it likes.
- **A wallet can recover what it does not understand.** The meaning of a token can be learned later.
- **Liquidation, vesting, repayment and other conditions of the application are untouched.** Recovery restores the remaining rights, not an earlier state.
- **The rules can be checked** against a contract's source and a template, so a conformance checker is possible.

### 12.3 What the rules exclude, and what they ask of the wallet

Excluded: positions opened by a key written into the contract; positions whose owner is known only to a server, including accounts opened by signing a message; and front ends that insist on building the transaction themselves from the wallet's public keys.

Not solved by the rules: a position that changes without the wallet. A loan that is liquidated or redeemed leaves the wallet holding a key to nothing. The way a template finds a position has to give "not found" as an ordinary answer.

A token that carries authority is a bearer instrument: whoever gets it spent in a transaction of their own shape can exercise it. The wallet therefore spends such a token only in transactions it built itself from a template the user trusts, and shows the user everything the transaction moves, not only the wallet's own coins.

A payout that arrives long after its address was fixed, such as a contract's payout at maturity, must name a vault address. An ordinary address would by then be an earlier address, which the earlier seed can still spend.

### 12.4 Where existing applications stand

Contract findings are from published sources; none was run with this wallet.

| Application | Rule 1 · Authority | Rule 2 · Wallet's parts | What it would take |
| --- | --- | --- | --- |
| ParyonUSD | Met. Loan key NFT; staking receipt NFT. | Contracts: no condition found. Front end: P2PKH wallets only. | An XO template and a front end. No contract change found necessary. |
| Moria | Met. Borrower NFT, named in the loan by its hash. | Front end: P2PKH wallets only. | The same. Its chipnet deployment was not checked. |
| Cauldron | Not met for pools: a pool is opened by a key hash written into it. Trades hold no position. | Met for trades | Trading needs only a template. Recoverable pools need a pool variant whose withdrawal follows a token, a contract change. |
| BCH Bull (AnyHedge) | Partly. The payout goes to any script, so to a vault address. Early exit needs two fixed keys. | Not studied | Payout at maturity survives recovery as it is. Early exit needs authority by token or by address. |

The pattern: applications that already use an ownership NFT need a front end; applications that wrote a key into a contract need a contract variant.

## 13. XO integration

### 13.1 What is established about the engine

From the engine's documentation and this project's trials (`docs/xo-spike.md` and the notes beside it):

- A template is JSON with roles, actions, transactions, inputs, outputs, locking scripts, variables and scripts in CashASM. Compiled contract bytecode has to be carried into the template; CashScript artifacts are not consumed directly.
- Template inputs can set a sequence number, and transactions a version and a lock time, so relative and absolute time locks can be expressed.
- Keys are derived per template from the account's twelve words, under `m/2415'` (mainnet) or `m/42415'` (test networks). A secret in a template is a derivation index, not a key; the engine cannot import a key.
- An account can hold only one role that has a follow-up action. Owner and recoverer are separate accounts.
- The validator rejects properties it does not know, at every level.
- Parties to one invitation must have imported the identical template. An invitation is for one template.
- A template's identifier depends on the order of its fields, so a template is kept as the text it arrived in.
- The engine cannot produce a valid `0x61` signature for a transaction with more than one input.
- A template variable of type `timestamp` is read back as text when unlocking later, so it cannot be used in a script that is unlocked later.
- An output's locking script can be given by a variable that holds locking bytecode; the stock payment template does this for its recipient.
- Block header verification on chipnet fails after the switch to one-minute blocks; the engine still works, with errors logged (`docs/xo-chipnet-header-verification.md`).
- The engine releases the coins an invitation named only when told; an action that is not sent must release them.

### 13.2 The wallet's own template

The wallet is itself described by an XO template:

| Part | Contents |
| --- | --- |
| Roles | Owner; recoverer |
| Scripts | The controller, with its four ways to unlock. The recoverable address, with two (`spend`, `sweep`). The vault address. |
| Owner actions | Create the wallet; pay; cancel a request; change settings; sweep; spend from a vault address |
| Recoverer actions | Request recovery; complete recovery |

The wallet's code computes what a template cannot guarantee: the next controller state, each tag, each secret. The template assembles them into transactions; the contracts enforce that they are right. A test checks that the scripts in the template are the compiled contracts, byte for byte.

Whether the engine can hold many addresses of one script with different tags and keys, and whether one invitation can carry the controller and many swept inputs, are the first trials in the plan.

### 13.3 What an application's template needs to say

**An output the wallet locks.** A template normally names a locking script for every output. For recovery it must be able to leave that to the wallet. Proposed form:

```
"outputs": {
  "jarKeyOutput": {
    "name": "Jar key",
    "description": "The token that opens this jar. Keep it in the wallet.",
    "lockingScript": { "wallet": "receive" },
    "valueSatoshis": 1000,
    "token": { "category": "$(<keyCategory>)",
               "nft": { "capability": "none", "commitment": "$(<unlockTime>)" } }
  }
}
```

| Kind | The wallet supplies |
| --- | --- |
| `receive` | A fresh ordinary address, for a coin or token created now |
| `change` | A fresh ordinary address for what is left over |
| `return` | The address of a named input of the same transaction, for contracts that require a token to go back where it came from |
| `lasting` | A vault address, for an address stored now and paid later |

The same marker on an input says "a coin of the wallet", with no assumption about its script or size.

Because the validator rejects unknown properties, this form needs XO's agreement. Until then the same thing is done with what exists: the template declares a variable that holds locking bytecode, and the request says which kind the wallet is to fill it with (section 14.2).

**What a token means.** A recovery declaration says which outputs create authority tokens, how to find the position each controls, and what its holder can do:

```
"recovery": {
  "profile": "recoverable-app-v1",
  "authority": {
    "jarKey": {
      "token": "jarKeyOutput",
      "position": {
        "lockingScript": "savingsJarLockingScript",
        "variables": { "keyCategory": "token.category",
                       "unlockTime":  "token.commitment" }
      },
      "actions": ["deposit", "withdraw"]
    }
  }
}
```

A wallet that holds an NFT and trusts this template fills the variables from the NFT, builds the position's address, looks it up on chain and offers the listed actions.

**A position found through a companion coin.** Where the position's address does not follow from the token alone:

```
"position": {
  "companion": { "lockingScript": "loanSidecarLockingScript",
                 "tokenCategory": "token.category" },
  "relative": -1
}
```

The wallet finds the unspent coin at the companion script that carries the token's category; the position is the output at the stated distance from it in the same transaction.

Until the declaration is part of XO's schema it travels as a document beside the template, naming the template by identifier and content hash, and is stored with it. Whether it belongs in the schema or stays a companion document is for XO to say. The field names above are proposals and have not been discussed with XO's authors.

### 13.4 What is needed from the engine

- Outputs and inputs bound to the wallet, as above.
- Actions that create a token category, with the wallet supplying the coin that defines it.
- A transaction that combines an application's template with inputs and outputs of the wallet's template.
- Many addresses of one script, with keys chosen by a counter.
- Taking over an existing identity with a new seed.
- Valid `0x61` signatures for transactions with several inputs.

Where the engine cannot do one of these, the wallet does it in its own code and uses the engine for the rest. Every transaction the engine builds passes this project's own script check before it is sent.

### 13.5 Limits

A template can teach a wallet how to build an application's transactions. It cannot supply missing data, sign for a lost key, or give authority that a contract does not grant. Operating a position without the application's site is an aim; it depends on the template, the token and a compatible engine, and does not reproduce the site's interface or its off-chain services.

## 14. Connecting to applications

### 14.1 Two kinds of wallet, one application

WizardConnect gives an application and a wallet an encrypted channel, started from an address the application shows as text or a QR code.

| | Ordinary wallet | This wallet |
| --- | --- | --- |
| Offers | The public keys of its address chains | The `xo_v1` extension |
| Who builds the transaction | The application, from P2PKH addresses it derives | The wallet, from the application's template |
| What the wallet is asked | To sign a transaction | To carry out an action |

The ordinary flow cannot serve this wallet: its addresses are scripts that cannot be derived from public keys alone. The live front ends of Moria and ParyonUSD, read on 16 November 2026, both refuse any wallet address that is not P2PKH, over WalletConnect as well. This wallet offers no key paths in a session.

An application that wants both kinds of user shows one connection address and decides by what the wallet offers. This was done for the Savings Jar and checked with Cashonize.

### 14.2 The `xo_v1` extension

The wallet announces the extension in the session. Nothing in it names an application.

```
{ "xo_v1": { "version": 1, "network": "chipnet",
    "profiles":  ["recoverable-app-v1"],
    "bindings":  ["receive", "change", "return", "lasting"],
    "templates": [{ "identifier": "…", "contentHash": "…" }] } }
```

| Message | Direction | Meaning |
| --- | --- | --- |
| `xo_action_request` | application → wallet | The template (or its identifier if the wallet has it) and its recovery declaration; the action; the role; the variables; which variables the wallet fills and with which kind; which of the wallet's tokens the action spends |
| `xo_action_response` | wallet → application | Taken on, or refused with a reason |
| `xo_invitation_update` | wallet → application | Approved by the user; recorded; sent |
| `xo_action_result` | wallet → application | The transaction and the tokens the wallet received, or an error |
| `xo_positions_request` / `xo_positions` | both | Which tokens of this template does the wallet hold? Answered only for a template the user trusts. |

The messages use only the session's pairing and custom messages. (`packages/connect`; the announcement there still has to be changed to the form above.)

### 14.3 Rules the wallet follows

- **An unknown template is shown to the user** with its name, description and actions, and is trusted only on their word. The wallet checks that the template is the one the request names, by identifier and content hash.
- **The user sees two things before approving:** the action in the template's words, and the wallet's own figures from the transaction it built: what goes where, what the wallet gives and gets, the fee, the earliest time. The application cannot influence the second.
- **A request is carried out at most once.** It is identified by its id; a repeat, or a reconnect, gets the stored outcome.
- **The application is never told the identity.** It learns the addresses that appear in its own transactions and nothing else.
- **A position is a token.** The wallet answers a positions request from the NFTs it holds on chain.
- **The wallet signs with address keys.** The controller is not part of an application's transaction.
- **A template that breaks one of the three rules is recognised where it can be,** and the user is told which rule and what that means for recovery.
- **An action that is not sent releases the coins it named.**
- **A session's lifetime has nothing to do with the waiting period.** A recovery is followed from the chain, not from a connection.

`xo_v1` is this project's own extension; no other wallet speaks it yet. XO has invitations and a sync client but no protocol between a website and a wallet. A standard would best come from XO, or as a WizardConnect extension that both projects agree on.

## 15. Demonstration applications

### 15.1 Savings Jar

A jar holds savings until a date. Anyone can pay in. After the date, whoever holds the jar's key NFT can empty it. The contract knows nothing about wallets, keys or recovery.

```
contract SavingsJar(bytes32 keyCategory, int unlockTime) {
    // Deposits are ordinary payments to the jar's address.
    function withdraw(int keyInput) {
        // Opens for whoever spends the jar's key NFT in this transaction.
        require(tx.inputs[keyInput].tokenCategory == keyCategory);
        require(tx.time >= unlockTime);
    }
}
```

- **The key.** Opening a jar creates one NFT of a fresh category, with no capability and no fungible amount, and sends it to the wallet. Its commitment is the unlock time, encoded as the script number the contract is built with.
- **The jar's address follows from the key alone:** P2SH32 of `SavingsJar(key.category, key.commitment)`. That is rule 3.
- **One contract for every wallet.** An ordinary wallet holds the key NFT at a P2PKH address and the application builds the transaction. This wallet holds it at a recoverable address and builds the transaction itself. The jar cannot tell the difference.

| Transaction | Inputs | Outputs |
| --- | --- | --- |
| Open | A coin of the wallet that is output 0 of its transaction (its transaction's identifier becomes the key's category); further coins as needed | The jar, with the first deposit; the key NFT to the wallet (`receive`); change |
| Deposit | Any coins, from anyone | The jar |
| Withdraw | The jar's coins; the key NFT, signed by its address key | The savings to the wallet (`receive`); the key NFT back to the wallet (`receive`) |

Points for implementation:

- **The category is known before the opening transaction is built,** because it is the identifier of the transaction whose output 0 is spent. The jar's address can therefore be computed first and funded in the same transaction that creates the key. The wallet may first have to pay itself to have such a coin.
- **The jar trusts the category.** Only the opening transaction can create tokens of it, and the wallet builds that transaction from the template with exactly one NFT. A wallet that made two keys for one jar would only have two keys to its own jar.
- **The time lock is a transaction lock time.** The withdrawing transaction sets its lock time to the unlock time or later and uses a non-final sequence number. The network compares against the median time of recent blocks, so a jar opens somewhat after its date (decision D13).
- **The unlock time is a whole number in the template,** not a `timestamp` variable (section 13.1).
- **The jar's inputs carry no signature.** The signature on the key input covers every input and output, so the transaction cannot be altered.
- **After a recovery** the key NFT is swept like any token. The new device rebuilds the jar's address from the key and the template and finds the jar. Withdrawing sends the key to a new address.

The jar must be checked with this wallet and with Cashonize, with the same contract.

### 15.2 ParyonUSD

ParyonUSD lends its dollar token, PUSD, against BCH collateral. Each loan is managed by whoever holds its loan key NFT. That is rule 1 already, on chain, in contracts that need no change. The aim is a front end and an XO template of this project's own for it, and a real loan surviving a recovery on Paryon's chipnet deployment.

**What was read** (npm package `@paryonusd/contracts` 1.1.0: Borrowing, LoanKeyFactory, LoanKeyOriginEnforcer, LoanKeyOriginProof, manage):

| Transaction | Inputs | Outputs |
| --- | --- | --- |
| Create a loan key | 0 a coin that is output 0 of its transaction; that transaction's identifier becomes the loan key's category · 1 loan key factory · 2 fee | 0 a plain coin without a token (`authhead` in the source) · 1 factory · 2 origin enforcer, holding the minting NFT of the new category · 3 origin proof · 4 change (optional) · 5 data (optional). At most 6. |
| Borrow | 0 borrowing contract · 1 price contract · 2 origin enforcer · 3 origin proof · 4 the wallet's collateral | 0 borrowing · 1 price · 2 the loan · 3 the loan's sidecar (category of the loan key) · 4 borrowing fee (0.25%, at least 1,000 sat) · 5 **the loan key**, 1,000 sat, address not checked · 6 **the borrowed PUSD**, address not checked · 7–9 optional. At most 10. |
| Manage | 0 price · 1 loan · 2 sidecar · 3 manage contract · 4 **the loan key** · 5 the wallet's BCH · 6 PUSD to repay (optional) | 0 price · 1 loan · 2 sidecar · 3 manage · 4 **the loan key, to the same address, with the same value** · 5 data (optional) |
| Close | As manage | 0 price · 1 manage · 2 and 3 data |

The minimum loan is 100 PUSD at 110% collateral, about 0.4 BCH at the price seen, plus the fee.

| Rule | Finding |
| --- | --- |
| 1 · Authority | Met. The loan key is a bearer NFT; the borrowing contract checks its category and not where it is sent. |
| 2 · Wallet's parts | Contracts: the five read put no condition on the wallet's script. Managing requires the key to return to the address it left (`return`). The official front end accepts P2PKH wallets only. |
| 3 · Finding the loan | The sidecar carries the loan key's category, so the loan can be found from the key (section 13.3, companion coin). The template that says so is this project's to write. |

**What was checked:** Paryon's test deployment `chipnet-fast-periods-6` answered on 17 November 2026 with four active loans and an oracle price of $274.4.

**What was not:** nothing has been sent, and no loan was opened from a script address. Whether an XO template can express a transaction with four Paryon contract inputs and seven fixed outputs, with the wallet supplying only its own parts, is the main risk, and it is the claim the demonstration is meant to prove. The other 21 contracts (interest, redemption, liquidation, staking) were not read for this purpose. Paryon's transaction-building library is not public; this project's is written from the contracts. Paryon's contracts repository states no licence, so the npm package is used as a dependency and not copied.

**Order of work:** first open, manage and close one loan on chipnet from a recoverable address with a plain script, which settles whether the contracts accept this wallet and needs about 0.5 test BCH. Then the template and the front end. Then the recovery of a live loan.

One consequence for privacy: because managing returns the loan key to the address it left, the key stays at one address for the life of the loan. That address is known to anyone who looks at the loan, and to nobody as part of this wallet.

## 16. Privacy

### 16.1 Who sees what

Before any sweep:

| Viewer | Sees |
| --- | --- |
| Owner's device | Everything |
| Recoverer | Every address, balance and past payment of the seeds whose viewing keys it holds; the controller |
| An application | The addresses in its own transactions. Not the identity, not the controller, not the wallet's other addresses. |
| Anyone watching the chain | Unrelated script addresses. A controller that belongs to nobody in particular. The usual links between the inputs of one transaction, as with any wallet. |

### 16.2 The controller is readable on purpose

Anyone can see that a controller exists and read its state. Two measures keep that from mattering: the recoverer uses a different key for every wallet, and the owner's controller key is used for nothing else and never appears in an address.

### 16.3 What ties a coin to the identity

| Event | What becomes linked, in public |
| --- | --- |
| Creating the wallet | The coins the wallet was funded with, and the first addresses they move to (section 7.9) |
| Any controller transaction that a wallet coin pays for (cancel, change of settings) | That coin and its change |
| The recoverer's request and completion | The recoverer's fee coins, which came from the wallet's first coins |
| A sweep | Every address swept, and the new addresses the coins go to |
| Spending from a vault address | That vault address |

Everything else the wallet does leaves no link to the identity.

### 16.4 What a recovery reveals

A sweep has the controller as its first input and shows the identity in every swept input. Everything the wallet held at that moment is tied together. Coins received afterwards at new addresses are not.

Limiting this would take several controllers, each covering part of the addresses. Hiding it fully would take a zero-knowledge proof checked in script, which Bitcoin Cash cannot practically do today as far as this project knows. Neither is part of this design. Both stay possible, because applications never see the identity or the controller, and because an address shows nothing about how its tag was made.

### 16.5 What the recoverer sees

The recoverer can read the wallet. That is a consequence of asking it to hold what a new device needs. A later option is to seal the viewing key under a phrase the user remembers, so that the recoverer keeps it without being able to read it; this trades the recoverer's view for something the user must not forget, and is not part of this proposal.

## 17. User experience and background operation

**Owner.** "Set up recovery", "Recovery is on" (only after the recoverer confirmed), "Someone asked to move your wallet", "Cancel". **Recoverer.** The enrolled wallet, the proposed new owner with its fingerprint, the state of the request, the end of the wait as the chain gives it, "Complete". Template identifiers, invitations, roles and inputs are not routine user tasks; they stay available for developers and for troubleshooting.

**Watching.** The wallet reads its controller's whole history again from several servers at each check and works the status out from nothing, so a reorganization or a replaced transaction is followed without bookkeeping, and one server leaving a request out does not hide it. (`packages/app/src/monitor.ts`.)

| Status | Meaning | The wallet |
| --- | --- | --- |
| Quiet | Nothing is asked | — |
| Request to a key this device does not hold | Someone wants the wallet | Warns; cancels, by hand or automatically |
| Request to a key this device holds | Its own takeover | Waits |
| Owned by a key this device does not hold | A recovery or a change of owner has happened | Stops giving out addresses and says so |

**Cancelling costs a transaction.** Because ordinary use does not cancel, the device must be able to send one: it keeps a small coin for the fee (section 8). A phone that is switched on is not thereby watching the chain; background scheduling and notifications on phones need their own validation before any claim of protection is made.

**A recovery while the old device still works.** If the user simply has a new phone, the old one moves the wallet with `ownerUpdate` and no waiting. If a request arrives and the old device is watching, it cancels; the software must not switch that off because a message says the recovery is wanted.

**When the wallet finds itself owned elsewhere against the owner's will,** its keys still spend every coin not yet swept. The wallet offers to move them out at once, to a wallet with a new identity. Coins at vault addresses cannot be moved this way.

**Repeated requests** cost the owner a fee each and cannot take anything. The owner replaces the recoverer.

**After a recovery, people who pay the wallet need a new address,** or should have been given a vault address. The wallet keeps watching earlier addresses and sweeps what arrives, but until it does, the earlier seed can spend it too.

## 18. Local backup, being one's own recoverer, versions

### 18.1 A backup the user keeps

The design does not need one and supports one.

- **What to keep:** the twelve words and the wallet's identity (64 hexadecimal characters). A device with both is the same owner. It recomputes every key and address, finds its coins by scanning, and needs no controller transaction and no waiting period.
- **Worth adding:** the network, the transaction that created the identity, and the backup stores with their content key, so that templates and labels come back too. Without them the coins are still restored; templates can be had again from the applications.
- **It is not a standard wallet backup.** The words alone restore nothing in another wallet, and nothing here without the identity.
- **It goes stale at a recovery or a change of owner,** because the wallet then has a new seed. It must be made again.
- **Whoever holds it has the wallet at once.** The waiting period guards against the recoverer, not against someone holding the words.
- **A copy of the viewing key alone** restores nothing. It is useful as a second copy of what the recoverer holds, and as a way to watch the wallet without being able to spend.

### 18.2 Being one's own recoverer

The recoverer's role is a key and the viewing key. Nothing requires a business. A second device of the user's, or a family member's phone, can hold the kit. A wallet has one recoverer at a time; several recoverers or a threshold among them would be a later version of the controller rules.

### 18.3 Versions

| Layer | What changes with it |
| --- | --- |
| Controller rules (state version byte) | Who can start a recovery, the wait, completion |
| Owner-approval rule | How an address recognises the owner's approval |
| Address scripts and derivation | How addresses, secrets and tags are made |
| Recovery kit | Fields, sealing |
| Backup records | Formats |
| Application profile (`recoverable-app-v1`) | The three rules and the recovery declaration |
| Connection (`xo_v1`) | Messages and what the wallet announces |
| XO template | Exact scripts and actions, identified by content |

An unknown version is refused, never guessed at.

An identity is bound to its controller script from its creation, and every address is bound to its identity. New controller rules therefore mean a new identity. A wallet moves to it by ordinary payments from its old addresses to addresses of the new identity; application tokens move the same way.

## 19. Security and operational boundaries

| Scenario | Behaviour or limit |
| --- | --- |
| Recoverer completes right after its request | The network refuses it |
| Recoverer attaches coins to a request or a completion | The address scripts refuse: the controller does not continue unchanged |
| Recoverer names a key of its own and nobody cancels | It becomes the owner and can sweep. Until it does, the earlier owner's keys still spend, so an owner who notices late can still move coins out. Vault coins cannot be saved this way. |
| Owner cancels in time | The pending output is spent; the completion is invalid |
| Owner is offline for the whole wait | The recoverer can complete even though nothing was lost |
| The lost phone is found and unlocked after a recovery | Its keys spend whatever has not been swept, and anything that later arrives at its addresses until that is swept. They do nothing on the controller, at new addresses or at vault addresses. |
| The phone is in a thief's hands and usable before or during the wait | The thief is the owner. Recovery does not help. |
| Recoverer's key is stolen | The thief can request. A watching wallet cancels; the owner replaces the recoverer. |
| Viewing key is exposed | Addresses, balances and history of that seed are readable. Nothing can be spent. |
| Viewing key and one address private key in the same hands | Every address key of that seed. The controller key is not among them. |
| Every copy of a viewing key is lost | Coins at that seed's addresses cannot be found or swept by a new owner. The seed itself, if it still exists, still spends them. |
| Recoverer loses the kit, or refuses to act | No recovery. A local backup or a second holder of the kit is the remedy, and has to exist beforehand. |
| Backup store is compromised or withholds | Nothing readable, nothing spendable. Templates and labels may be missing; coins and tokens are not affected. |
| A record is forged by someone who knows the content key | Refused: it is not signed by the owner of its epoch |
| An application asks for a transaction that takes more than it says | The wallet's own figures show what the transaction moves. The application cannot change them. |
| An application's site disappears | A position that follows the rules stays operable from its token and template |
| An application liquidates or closes a position | The token then leads to nothing. Recovery restores remaining rights only. |
| A server hides a request | Read from several servers; hidden only if all leave it out |
| A token imitates an identity | The category differs, so the rule refuses it. An identity whose creation was not valid is refused by the client. |
| A transaction that prepares or creates the wallet is not confirmed and is replaced | The identity would differ. The wallet waits for confirmation before giving out addresses. |

**Costs of the design, in one place**

1. An earlier seed works until the sweep.
2. A payment to an earlier address can be taken by the earlier seed until it is swept.
3. The recoverer can read the wallet.
4. The viewing key is needed to recover.
5. A recovery is public: the sweep ties together what the wallet held.
6. A request is not cancelled by ordinary use. The device has to notice it and cancel.
7. Transactions are larger than with P2PKH: about twice the bytes per input, by an estimate from the script sizes.
8. The wallet's first coins can be traced to the creation of its identity.
9. Applications have to be reached through a template; front ends that build transactions from the wallet's public keys cannot serve it.

## 20. Implementation approach and status

The implementation uses XO's TypeScript packages, libauth for keys, transactions and script evaluation, and CashScript for writing contracts. Compiled bytecode is carried into XO templates; a test keeps the two equal. The versions pinned are those of the XO web development tool, so that invitations made here load in it (decision D3).

| Item | Status |
| --- | --- |
| Recovery controller | Implemented; tested in the virtual machine; run through request, cancellation, completion and refusals on chipnet |
| Owner-approval rule | Written; without tests on the working branch until an address contract uses it |
| Reading and checking a controller's history; several servers read as one | Implemented and tested |
| Waiting-period calculation; watching for requests | Implemented and tested |
| Sealing to the recoverer; signing; encrypted stores and the store server | Implemented and tested |
| WizardConnect transport and `xo_v1` messages | Implemented and tested with an earlier form of the announcement |
| Recoverable address, vault address | Proposed |
| Derivation, viewing key, scanning | Proposed |
| Recovery kit contents, takeover message, sweep | Proposed |
| Backup records as in section 10 | Proposed |
| Wallet template; application templates with wallet-bound outputs; recovery declaration | Proposed; depends on trials with the engine |
| Savings Jar with a key NFT | Proposed |
| ParyonUSD template and front end | Proposed; contracts read, nothing run |

Licences: the XO engine and utilities declare MIT. The XO web development tool has no licence statement and is used as a tool only. WizardConnect declares LGPL-3.0-or-later. Paryon's contracts repository states no licence.

The stages of work, what each builds, which existing files it starts from and what must hold before it is done are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The bounty also asks for developer feedback written personally; this document is not a substitute.

## 21. Acceptance tests

These are tests an implementation must pass. Except where the status table above says otherwise, they are not results already obtained.

| ID | Test | Expected result |
| --- | --- | --- |
| **Controller** | | |
| CT01 | Owner approves a transaction alone | Accepted; state unchanged |
| CT02 | Recoverer completes right after its request | Refused |
| CT03 | Recoverer alters the sequence number or version to pass the wait | Refused |
| CT04 | Owner cancels a pending request | The completion that referred to it is invalid |
| CT05 | Second request while one is pending, or a changed destination | Refused |
| CT06 | Another category, a wrong commitment, or a successor at another script | Refused |
| CT07 | The wait passes and the recoverer completes | Only the named key is installed; epoch + 1 |
| CT08 | The controller's value is used for the fee | Refused |
| CT09 | A signature that leaves inputs or outputs open | Refused; both accepted types work for every action |
| CT10 | An identity whose creation has a minting token, two tokens or a wrong script | The client refuses the identity |
| **Addresses** | | |
| AD01 | A coin is spent by its key, with no controller in the transaction | Accepted |
| AD02 | The same with another key | Refused |
| AD03 | One coin, several coins, and a vault coin swept in one transaction with the owner's approval | Accepted |
| AD04 | A sweep with the wrong identity or the wrong secret | Refused by the address script |
| AD05 | A sweep attached to a request or to a completion | Refused by the address script, while the controller input alone is satisfied |
| AD06 | The controller not at input 0; another wallet's controller; a successor with a changed owner, recoverer or waiting period | Refused |
| AD07 | After a recovery, a sweep approved by the earlier owner's controller key | Refused |
| AD08 | After a recovery, the earlier seed spends a coin not yet swept | Accepted. This is the stated cost; the test fixes it as known behaviour. After the sweep nothing is left to spend. |
| AD09 | After a recovery, the earlier seed tries a vault coin; the new owner spends it | Refused; accepted |
| AD10 | BCH, fungible tokens and NFTs of each capability, held and moved by both paths | Category, amount, capability and commitment preserved |
| AD11 | Sizes of both scripts and of each kind of input | Measured and recorded |
| **Keys and viewing key** | | |
| KV01 | Scan from identity and viewing key, for a wallet with used addresses, gaps within the limit and a vault coin | Every coin, token and NFT is found, with its secret |
| KV02 | Scan with another wallet's viewing key, or the right one and another identity | Nothing is found |
| KV03 | Sign or sweep with the viewing key alone | Not possible |
| KV04 | Either half of the viewing key without the other | No address can be derived |
| KV05 | Test vectors: words, indices, expected keys, secrets, tags, addresses | Reproduced exactly |
| KV06 | The twelve words and the identity on another device | The same wallet, with no controller transaction |
| KV07 | The controller key from the viewing key and address private keys | Not derivable; the paths are as specified |
| **Recoverer** | | |
| RC01 | Someone records the link or QR code of a kit; a kit is altered in transit | Nothing readable; the altered kit is refused; the kit fits a QR code |
| RC02 | A kit for another network, changed, not signed by the owner, for a wallet not on chain, or not matching the state | Refused by the recoverer |
| RC03 | Every path to spending or sweeping, tried with everything the recoverer holds | All refused |
| RC04 | A kit is made but not confirmed; a confirmation of another kit, or without the recoverer's key | "Recovery is on" is not shown; the confirmation does not count |
| RC05 | Two wallets with the same recoverer | No value in common on chain |
| RC06 | Three requests cancelled, then one completed | The recoverer pays every fee from its allowance |
| RC07 | Order of handing over viewing keys | The new device's reaches the recoverer before the request; earlier ones reach the new device only after completion |
| RC08 | A request to an unknown key, shown by only one of several servers; a request to the device's own key | Alarm; no alarm |
| RC09 | A request or cancellation is reorganized away or replaced | Status is rebuilt from the chain; nothing is reported as final early |
| **Sweep and new device** | | |
| SW01 | The owner's device is erased; a new device takes over, on a simulated chain | The new device holds everything at its own addresses; the earlier seed can move nothing |
| SW02 | The same on chipnet, through the engine | As SW01, recorded with its transactions |
| SW03 | A sweep too large for one transaction, interrupted between parts | Completes; nothing lost or moved twice |
| SW04 | A wallet that holds only tokens | Swept; the fee has a source |
| SW05 | A payment to an earlier address after the recovery | Found and swept |
| SW06 | A sweep while a request is pending | The request is cancelled |
| SW07 | An NFT of an application the wallet has never seen | Swept; reported as a token of unknown meaning |
| SW08 | Records written after a recovery | Not readable with the earlier content key |
| **Backup** | | |
| BK01 | A store, or someone who copies it, reads the records | Not possible |
| BK02 | One store fails or returns damaged data | The other copy works; damaged content is refused |
| BK03 | A record made by a holder of the content key who is not the owner | Refused |
| BK04 | A token whose template is missing | The token is still swept and is reported as incomplete, never left out |
| BK05 | A token note naming the wrong template | Refused by the rebuild check |
| BK06 | No store confirms before the first action of a new template | The action is refused by default |
| **Applications** | | |
| AP01 | An unknown template; a template that is not the one the request names | Shown and trusted only on the user's word; refused |
| AP02 | A template worded to mislead | The wallet's own figures are unaffected |
| AP03 | A request is repeated, or the session reconnects | Carried out once |
| AP04 | An action that creates a token category | Works; the wallet supplies the defining coin |
| AP05 | Everything an application receives in a session | Never the identity; only addresses of its own transactions |
| AP06 | A positions request for a trusted and for an untrusted template | Answered from the chain; refused |
| AP07 | Wallet and recoverer code searched for any application's name | None |
| AP08 | A template that breaks one of the three rules | The user is told which |
| AP09 | An unknown profile or version | Refused explicitly |
| AP10 | The application's site is unavailable | A position stays operable from its token and template |
| **Savings Jar** | | |
| SJ01 | Withdraw with the key before the time; after the time without the key; with both | Refused; refused; accepted |
| SJ02 | Open, pay in, withdraw with this wallet on chipnet | Works |
| SJ03 | The same with Cashonize and the same contract | Works |
| SJ04 | The device is lost with a jar open; recovery; the application's site not consulted | The new device finds the jar from the swept key and empties it |
| SJ05 | A third party tries to empty a jar or alter a withdrawal | Refused |
| **ParyonUSD** | | |
| PY01 | A loan opened, managed and closed from recoverable addresses by plain script | Accepted by Paryon's contracts on chipnet |
| PY02 | The same from an XO template through the wallet and a front end of this project | Works |
| PY03 | The device is lost with a loan open | The new device sweeps the loan key, finds the loan, and repays or closes it |
| **Privacy** | | |
| PV01 | Everything on chain for a wallet that has not been swept | No value shared between its addresses, or between an address and the identity |
| PV02 | After a sweep of some addresses | The secrets of the others cannot be computed from what was shown |

The decisive demonstration:

> Create a wallet and open a savings jar and a loan. Erase the device. On a new device, with the recoverer: request, wait, complete, sweep. Find the jar and the loan from their tokens, with the applications' sites unavailable, and operate both.

A second demonstration must show that during the wait the recoverer can do none of this, and that after the sweep the earlier seed can do none of it either.

## 22. Decisions to resolve

1. **Derivation.** The constant `S`, the exact paths, and whether the XO engine derives these keys or the wallet's own code does.
2. **Address chains.** Two kinds of ordinary address (given out, change) as proposed here, or one; the gap limits.
3. **Who makes the recoverer's key.** Proposed: the owner's device.
4. **The viewing key's written form;** two values, as proposed, or one from which both follow.
5. **Readable controller state.** Proposed: readable, with a recoverer key per wallet.
6. **The waiting period for real use,** the margin for cancelling, and whether cancelling is automatic by default.
7. **The recoverer's fee allowance:** amount, and whether it is set aside at creation.
8. **Messages between new device and recoverer:** the takeover message and the hand-over, and how the recoverer establishes who the user is.
9. **Backup:** record formats; whether refusing an action without a stored template stays the default.
10. **Template extension:** the names and kinds of wallet-bound outputs, the recovery declaration, and whether they enter XO's schema or stay a companion document. For XO to say.
11. **`xo_v1`:** a WizardConnect extension or a protocol of XO's. For XO and WizardConnect to say.
12. **Division of work between the engine and the wallet's own code,** after the trials.
13. **Sweep policy:** order, size of parts, how outputs are grouped.
14. **Local backup:** whether the wallet offers it, and in what form.
15. **Upgrade policy** for controller rules.
16. **Monitoring on phones** before any claim of protection.
17. **ParyonUSD:** telling the team; the missing licence.
18. **When the public demonstration switches** to this design.

Resolving these is part of implementation. The first engineering checkpoint is the two address contracts passing AD01–AD10, because those tests establish that the recoverer never gains spending power and state the cost of the earlier seed exactly.

## 23. References

Sources established existing primitives and interfaces; the architecture, extensions, field groups and tests above are this project's proposal. Package versions and documentation may change.

- **S1 — CashTokens usage examples:** identity tokens and covenant tracking. https://cashtokens.org/docs/spec/examples/
- **S2 — CashScript modular contracts:** cooperation between inputs of one transaction. https://cashscript.org/docs/design/modular
- **S3 — CashScript global variables:** relative and absolute time locks. https://cashscript.org/docs/language/globals
- **S4 — Relative lock time:** https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki and https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki
- **S5 — BIP32, hierarchical deterministic wallets:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
- **S6 — BIP39, mnemonic words:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
- **S7 — RFC 9180, Hybrid Public Key Encryption:** https://www.rfc-editor.org/rfc/rfc9180.html
- **S8 — CHIP-2024-12 P2S:** token commitments of up to 128 bytes. Cited as in decision D1.
- **S9 — XO getting started:** templates, roles, invitations. https://stack.xo.cash/getting-started.html
- **S10 — XO type definitions and state API:** https://stack.xo.cash/api/@xo-cash/types.html and https://stack.xo.cash/api/@xo-cash/state.html
- **S11 — XO utilities and engine packages:** https://www.npmjs.com/package/@xo-cash/utils and https://www.npmjs.com/package/@xo-cash/engine
- **S12 — XO web development tool:** https://blaze.xo.cash/ and https://gitlab.com/GeneralProtocols/xo/xo-web-devtool
- **S13 — WizardConnect:** overview and licence https://docs.riftenlabs.com/wizardconnect/ ; protocol https://docs.riftenlabs.com/wizardconnect/protocol/ ; extensions https://docs.riftenlabs.com/wizardconnect/extensions/
- **S14 — ParyonUSD contracts:** npm package `@paryonusd/contracts` 1.1.0, https://www.npmjs.com/package/@paryonusd/contracts ; test deployment `chipnet-fast-periods-6`; live front end read on 16 November 2026.
- **S15 — Moria:** general documentation https://docs.riftenlabs.com/moria/general/ ; live front end read on 16 November 2026.
- **S16 — Cauldron whitepaper:** pool withdrawal by the creator's key. https://docs.riftenlabs.com/cauldron/whitepaper/
- **S17 — AnyHedge (BCH Bull):** published contract source.
- **S18 — BCH Blaze "Build with XO" bounty:** https://bchblaze.cash/bounties/build-with-xo/
- **This repository:** `docs/decisions.md` (D1–D15), `docs/xo-spike.md`, `docs/xo-engine-signing-bug.md`, `docs/xo-chipnet-header-verification.md`.
