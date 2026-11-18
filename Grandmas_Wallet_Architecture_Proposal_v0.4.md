# Grandma's Wallet

**Architecture proposal v0.4 — BCH Blaze 2026**
**Date:** 17 November 2026
**Status:** Design proposal for implementation and review. Some of what is described here exists as tested code: the recovery controller (which has also run on chipnet), reading and checking a controller's history, watching for requests, sealing and backup stores, and the connection messages. The addresses, the keys and the viewing key, the recovery kit as described here, the sweep, and everything that concerns applications are proposed and not yet implemented. Section 20 lists the status of each part. Nothing has been audited.

This document is the reference for implementation. [docs/design_v0.4.html](docs/design_v0.4.html) is an illustrated overview of the same design; where the two differ in detail, this document is the more specific one. The order of work and the exit criteria of each stage are in [IMPLEMENTATION_PLAN_v0.4.md](IMPLEMENTATION_PLAN_v0.4.md). The three documents carry the same version number and are changed together.

"Required" and "must" describe a property the implementation has to achieve; they do not say the property has been demonstrated. Names of fields, messages, profiles and derivation paths are proposals until a formal schema is agreed; section 22 lists the ones that still need a decision.

## 1. Purpose and central design

Grandma's Wallet is a Bitcoin Cash wallet that can recover access after the user loses their phone, without the user making or keeping a backup. A trusted **recoverer**, which can be a business, a family member or a friend, can replace the wallet's owner. To do so it must publish a request on chain and wait through a waiting period, during which the existing wallet can cancel the request.

The central idea:

> Every ordinary address of the wallet can be spent in two ways. Its own key spends it directly, like any single-key address. The wallet's controller can also release it, and the controller obeys whoever owns the wallet's identity today.

Recovery changes the owner of the identity. The new owner then moves every coin and token to addresses of its own keys. This move is called the **sweep**. A second kind of address, the vault address, has no key of its own and is opened by the controller only (section 7.5).

Four consequences follow and shape everything else:

1. **Day to day, the controller is not involved.** A payment is signed by the keys of the coins it spends. The controller is not in the transaction, and no address shows the identity. The ordinary links between coins that are spent together remain, as with any wallet (section 16).
2. **Applications do not need to know about recovery.** They deal with coins and tokens at the wallet's addresses. An application position is recoverable when its authority is a token that the wallet holds, because the sweep moves the token.
3. **The wallet looks like an HD wallet.** One seed gives a key and an address for every coin. A **viewing key**, held by the recoverer, lets a new device find the addresses again.
4. **A key change does not take effect on a coin until the coin is swept.** Until then the coin still obeys its earlier key as well. This is the price of the first three points and is treated throughout as a cost, not hidden.

The intended experience is unchanged:

> Set up recovery once, use the wallet normally, and ask the trusted recoverer for help if the phone is lost.

The recovery promise is:

> Given an available recoverer who holds the recovery kit with the viewing key of every seed the wallet has had, a functioning blockchain, and a coin for fees, a new device can take over the wallet's identity after the waiting period and move to its own keys every coin, fungible token and NFT that sits at the wallet's addresses, including the tokens that carry authority over application positions. Operating such a position afterwards also takes the application's template and whatever the application itself still depends on.

The promise does not cover positions whose authority is a key written into a contract, state that exists only on an application's server, or coins that the holder of the earlier seed moves away before they are swept.

The recoverer is trusted to name the right new owner **once the waiting period has passed without a cancellation**. The blockchain cannot establish that a phone is lost. A working wallet must notice a request and get a cancellation confirmed in time.

## 2. Requirements and decisions

| Area | Requirement or decision |
| --- | --- |
| User custody | The seed is generated on the phone and is never given to the recoverer or to an application. It leaves the phone only if the user chooses to make a local backup (section 18). Spending does not need the recoverer. |
| Recovery authority | The recoverer's key cannot spend a coin of the wallet and cannot shorten the wait. It can only request and, after the waiting period, complete a change of owner. A recoverer who installs a key of its own after a wait that nobody cancelled is then the owner. The recoverer pays the fees of its own transactions; coins the owner gives it for that purpose (section 9.6) are the recoverer's own. |
| Loss detection | The absence of a cancellation is the observable condition. Actual loss cannot be proven. |
| Destination | The new owner key is named when recovery is requested, not at setup. |
| User backups | None required. A local backup is possible as an addition (section 18). |
| Everyday transactions | Signed by address keys only. The controller appears in a transaction only for setup, recovery, sweeps, vault spending and changes of settings. |
| Addresses | A fresh one for each payment, within the limits of section 7.7. Script addresses (P2SH32). No address shows the identity or another address of the wallet; a sweep shows both. |
| Finding coins | From the identity and the viewing keys alone, by deriving addresses in order and looking them up. A complete search covers fixed ranges that belong to the address scheme. No list of addresses is kept anywhere. |
| Viewing key | One for each seed. Held by the phone and the recoverer, with a sealed copy on backup stores. It shows every address and balance of its seed and gives no power to spend. Earlier ones are kept. |
| Asset support | BCH, fungible CashTokens and NFTs, at the same addresses. |
| Fees | The lowest fee that nodes relay, worked out exactly from the signed transaction (section 8). |
| Emptying | Every satoshi that is not under a token can be sent out in one action, as far as the network's smallest output allows (section 8). The owner can also close the controller and take its value; the action is in the script and is not offered in the wallet's ordinary interface (section 5.8). |
| Application positions | Recoverable when they follow three rules (section 12): authority is a token, the wallet's inputs and outputs are the wallet's business, and the token leads to the position. |
| Wallet and applications | The wallet knows no application. It builds each transaction itself from the application's XO template. The same application must also work with an ordinary wallet. |
| Application connections | WizardConnect with an extension, `xo_v1`. |
| Waiting period | Counted in time (units of 512 seconds), enforced by the network. |
| Networks | Chipnet for now. No rule or code may depend on chipnet. |
| Openness to privacy improvements | Applications are never sent the identity or the controller, so what a recovery reveals can be reduced by a later version of the wallet's scripts without changing applications. Coins stay under the rules of the address they are at. |
| Not required | P2PKH addresses; restoration in an unmodified standard wallet; recovery of the original seed. |

## 3. Participants and trust

**Owner's device.** Holds the seed, signs payments, watches the controller, cancels unwanted requests. Whoever can use the device can spend at once; recovery is no protection against that.

**Recoverer.** Holds the recovery kit: its key for this wallet, the identity and the viewing key of every seed. It can request and complete a recovery, and it can see every address and balance of the wallet. Its key cannot spend a coin of the wallet, cannot shorten the wait and cannot complete with a key other than the one it requested. It pays the fees of its two transactions from coins of its own (section 9.6). After a wait that nobody cancelled, it can install a key of its own choosing and is then the owner; preventing that is outside the trust model.

**New device.** Makes a new seed. Before the request it has no power. After completion it is the owner: it sweeps and spends.

**Holder of an earlier seed.** After a recovery, whoever holds the earlier seed (the lost phone, if someone finds and unlocks it) can still spend coins that sit at that seed's addresses and have not been swept. They cannot spend from addresses of the new seed, from vault addresses, or act on the controller.

**Backup stores.** Keep sealed records: copies of the viewing keys, the templates the user trusted, the recoverer's receipts, labels. They cannot read them and they authorize nothing. They can withhold, delete, or hand back an older set.

**Applications.** Supply templates and action requests. They never hold a key and are never sent the identity. They learn the addresses that appear in their own transactions, and like anyone they can study the public chain.

**Network services.** Provide transactions, history and broadcast. The wallet checks each transaction against its identifier, reads a controller's history from several servers, and does not let a server define what a valid controller transition is. What a server says about confirmations is taken on trust unless the device checks block headers itself (section 17).

## 4. Architecture

| Component | Responsibility |
| --- | --- |
| Recovery controller | One coin holding the identity NFT. Its state names the owner's controller key, the recoverer's key, the waiting period and any pending request. |
| Owner-approval rule | A shared script function. A coin released through the controller requires the controller to continue unchanged in the same transaction. |
| Recoverable address | The wallet's ordinary address. Two ways to spend: its own key, or the controller. |
| Vault address | An address with no key. Only the controller releases it. It stays valid through every change of owner. |
| Keys and viewing key | Derivation of every key and address from the seed; the part of it that is shared for finding coins. |
| Recoverer and recovery kit | What the recoverer is given, how it is delivered, and the two transactions the recoverer can make. |
| Backup stores | Sealed copies of viewing keys, templates, receipts and labels. For viewing keys the recoverer's kit is the reference, not a store. |
| XO engine and templates | Build and check transactions from templates, the wallet's own and each application's. |
| Connection (`xo_v1`) | Carries an application's request to the wallet and the result back. |
| Owner interface and monitor | Show effects, obtain approval, watch for requests, cancel. |
| Recoverer interface | Open a kit, request, follow the wait, complete, hand over viewing keys. |

### 4.1 Identity and controller

The wallet's **identity** is the token category of one NFT. The coin that holds this NFT is the **controller**. The NFT's commitment is the controller's state. The controller's script accepts five actions. Four of them send the NFT back to its own address with the next state. The fifth, which only the owner can sign, closes the wallet and destroys the NFT (section 5.8).

The identity is fixed when the controller is created and never changes. The owner key, the recoverer and the waiting period are fields of the state and can change. The identity is public, but it is not written in any address.

The controller's address is specific to the wallet: the script takes the identity as a parameter. A wallet's controller can therefore be found and watched by address, and a notification for that address concerns that wallet only.

The controller carries 1,000 satoshis; nodes relay no such output below 888. A wallet's coins are separate outputs at separate addresses.

### 4.2 Two ways into every coin

A Bitcoin Cash script checks only the transaction that spends it. It cannot look up the current state of a controller elsewhere on chain. A coin whose spending rule depends on the controller's state must therefore be spent together with the controller.

If that were the only way to spend, every payment would carry the controller. All of a wallet's activity would be linked through one coin, only one action could be in flight at a time, two such wallets could not share a transaction, and every application would have to leave room for the controller at a fixed position. (The last two follow from this design's rule that the controller is input 0. A controller found by an index would relax them and would leave the first two as they are.)

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
| `ownerClose` | Owner's controller key | Active or Pending | No controller: the NFT is destroyed and the identity ends | Emptying a wallet for good (section 5.8) |

A rule that holds for every action:

- The signature must cover every input and every output. Two signing types are accepted: `0x41` (all inputs and outputs) and `0x61` (the same, plus the amount and script of every spent output). The current XO engine cannot produce a valid `0x61` signature for a transaction with more than one input (decision D8), so `0x41` has to be accepted.

Rules that hold for the four actions that continue the controller:

- The controller is input 0 and its successor is output 0. The transaction version is 2.
- The successor has the same locking script, the same token category and capability (mutable), the same fungible amount, and at least the same value in satoshis.
- Anyone may attach further inputs and outputs. The signer's signature covers all of them.

The contract is `contracts/controller.cash`: 457 bytes compiled, plus the 33-byte push of the identity. Without `ownerClose` it was 412 bytes.

### 5.3 Requesting recovery

The recoverer may request without proving that the phone is lost. The waiting period starts with the new controller output. Protection comes from the wait and the owner's chance to cancel, not from any claim about the phone.

The request keeps the owner, the recoverer and the waiting period, names the proposed owner, and gives no power over any coin. While a request is pending the recoverer cannot change the proposed owner or make a second request, including one naming the same key. A different destination requires the first request to be cancelled or completed, which gives a fresh wait.

### 5.4 Waiting period

The wait is a relative lock on the **pending controller output**. It does not depend on the age of any coin of the wallet, on a time supplied by the recoverer, or on a device's clock.

Time-based periods are compared by nodes against the median time of the last eleven blocks, which trails the clock. Observed on chipnet with one-minute blocks: with one 512-second unit, completion was accepted about 11 minutes after the request was sent, and completion right after the request was refused (decision D13). A period counted in blocks depends on what a network makes of a block, so the wallet offers time only.

**The wait counts from the block that holds the request.** This is the one wait for a block that the recovery itself cannot do without. A BIP68 relative lock measures the age of the output it locks, and an output that is not in a block has no age yet. The waiting period is the owner's whole protection against a recoverer acting unasked, so it has to be measured by the chain, which no party can bend, and not by a clock that someone claims. A different design would need a different lock. Nothing else about a request waits: the owner's wallet shows a request as soon as the network has it, says that it is not in a block yet, and can refuse it at once (section 17).

The length of the waiting period for real use is an open product decision.

### 5.5 Cancelling and completing

The owner cancels with `ownerAuthorize`. Spending the pending controller makes a completion that refers to that output invalid.

**An ordinary payment does not cancel a request.** Payments are signed by address keys and do not touch the controller. The owner's device has to notice the request and send a cancellation, which is a transaction of its own (section 17).

The owner has no priority at the deadline. Once the wait is over, a cancellation and a completion race until one is confirmed. The aim is a confirmed cancellation well before that point.

Completion installs exactly the key named by the request, clears the request and raises the epoch. **No coin moves.** Coins move in the sweep, which the new owner makes afterwards with `ownerAuthorize` (section 11).

### 5.6 Changing settings

`ownerUpdate` replaces the owner key, the recoverer or the waiting period in one step, with the owner's signature alone and without waiting. The new waiting period is checked on chain (only the BIP68 value and type flag, value not zero); zero key hashes are refused. Any pending request is cleared.

It serves three purposes. Each is one transaction on chain with a procedure around it:

- **Moving to a new seed while the old device still works** (section 9.7). The recoverer must hold the new seed's viewing key before the key changes; otherwise the wallet would be without a recovery path from that moment.
- **Replacing the recoverer** (section 9.7).
- **Changing the waiting period.** Nothing else changes. The recoverer is told, so that its copy of the settings matches the chain.

The contract cannot require any of the preparation. An owner can change keys without telling the recoverer. The wallet then shows recovery as off until the recoverer has confirmed the new state, and it does not present such a change as protected.

### 5.7 Creation, and what a client must check

A token category is the identifier of the transaction whose output 0 the creating transaction spends. Creating an identity therefore needs a coin of the wallet that is output 0 of its transaction; the wallet makes one by paying itself if it has none (section 7.9).

The controller's script does not check its own first state. Before trusting an identity, a client must check the creating transaction: exactly one output carries a token of the category; it is an NFT with mutable capability and no fungible amount; its commitment is a valid Active state with epoch 0; and it is locked by the controller script for that identity. No minting capability may exist. With a mutable token and a fixed fungible amount, the network's own rules then prevent a second token of the category from ever being created. From there the client follows each spend of the controller to the current state, checking every transition (`packages/core/src/genesis.ts`, `history.ts`).

### 5.8 Closing

`ownerClose` ends an identity. It is signed by the owner's controller key, from Active or Pending. The transaction must have exactly one output, and that output carries no token. The identity NFT therefore has no successor and is destroyed, and the controller's 1,000 satoshis become part of that one output.

Measured on the contract (cashc 0.14.0, one satoshi per byte, checked with the network's relay rules in the virtual machine and on a local node):

| Measured | Result |
| --- | --- |
| Controller input | 637 bytes; 592 without the action |
| Closing with no other input | 1,000 − 681 = 319 satoshis, below the smallest output, so it cannot be sent |
| Closing together with other coins | Adds 1,000 satoshis and 637 bytes: 363 satoshis more arrive |
| Every other controller transaction | 45 bytes larger |

A closing signed by the recoverer, by another key or by an earlier owner is refused, as is one with two outputs or one that keeps the NFT. A closing while a request is pending is accepted (tests CT13 to CT15).

Consequences:

- **Closing is the last step of emptying a wallet** (section 8). The transaction needs at least one other coin, spent by its key.
- **A sweep or a vault spend cannot be part of it.** Both require the controller to continue (section 6). What only the controller can move is moved first.
- **Vault addresses become unspendable for good.** A coin at a vault address when the wallet is closed, or one that arrives there later, is lost. This cannot be designed away: a vault address works only while the identity's token exists, and the controller's value is free only once the token is gone. Moving the token to a plain address instead would keep the vault addresses working and would leave about 860 satoshis under the token.
- **Coins at an earlier seed's addresses obey only that seed afterwards.** Coins at the current seed's addresses stay spendable by their keys, and the twelve words with the identity still find them.
- **There is no recovery afterwards, and no way back.**
- **It gives the holder of the owner's key nothing new to take.** That key can already move every coin and change every setting. The recoverer cannot close, and neither can an earlier owner's key.

The action is part of every controller, so that a wallet can be emptied to the last satoshi and leave nothing on chain; the test runs end this way. The wallet's ordinary interface does not offer it. It is reached through a tool, and whoever holds the owner's key can build the transaction without this software. The tool refuses while a vault coin or a token is held, or before the full pass (section 7.7) has finished for every seed. Whether a released wallet keeps the action, keeps it out of sight or offers it is decision 19.

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

Two cases need tests of their own. A request may name the key that is already the owner: its completion still raises the epoch, so a sweep attached to it must be refused like any other. And at the highest epoch the counter must fail, not start again from zero; by the contract's arithmetic it fails, and no test shows that yet.

## 7. Keys, addresses and the viewing key

### 7.1 The seed

The seed is one random secret, made on the phone, from which every private key of the wallet is computed. It is the standard one: 128 bits of randomness written as twelve words (BIP39), stretched to 64 bytes, and used as the root of a BIP32 key tree. It is given to nobody, and the user is not asked to write it down; a local backup is the user's own choice (section 18).

The design uses the HD wallet primitives unchanged: BIP39 for the words, BIP32 for deriving keys. libauth implements both, and the XO engine derives its keys the same way.

### 7.2 What is derived

| Derived value | Place in the tree | Used for |
| --- | --- | --- |
| Controller key | `m / P' / C' / 0' / 0` | The owner entry in the controller. Nothing else. |
| Address node of kind *c* | `m / P' / A`*c*`' / 0'` | Parent of every address key of that kind. *c* = 0 for addresses given out to be paid, 1 for change and for outputs the wallet names in application transactions. |
| Address key (*c*, *i*) | address node of kind *c* `/ i`, not hardened | The key of one address. *i* counts from 0. |
| Blinding seed | SHA-256 of the private key at `m / P' / A0' / B'` | Source of every address secret |
| Funding key | `m / P' / W' / 0' / 0` | An ordinary P2PKH address used only to create the wallet (section 7.9) |

This is the key tree of the XO engine, which signs with no other key (`docs/xo-engine-stage0-trials.md`). The engine places every key of a template at `m / P' / T' / 0' / n`:

- `P` is XO's purpose number: 2415 on mainnet, 42415 on test networks, so keys differ between networks.
- `T` is the template's number: the first four bytes of the template's identifier, read as a little-endian number of 31 bits. `C` is the number of the controller template, `A0` and `A1` those of the two address templates, `W` that of XO's standard single-key wallet template (section 13.2).
- The third step, `0'`, is the engine's place for signing keys.
- `n` counts up from 0 for the template. The engine hands the numbers out in order, without gaps.
- `B` is 1,651,272,046, the bytes of "blin" read as a number. It is this scheme's own and lies outside the numbers XO uses at the third step.

Requirements behind the layout:

- **Address keys of one kind are plain children of one node**, so one extended public key for each kind gives the public key of every address of that kind and no private key.
- **The index is a counter.** A new device finds addresses by trying 0, 1, 2 and so on.
- **The controller key is not on an address chain** and cannot be worked out from the viewing key, even together with address private keys. It is under a template of its own, a hardened step away.
- **The blinding seed and the keys are independent.** Neither can be worked out from the other. The engine does not know the blinding seed; the wallet's own code derives it.
- **Everything follows from the twelve words, the network and the templates.** Nothing random is added later.
- **The templates that hold keys never change.** A template's number follows from its content, so a changed template gives other keys. The controller template is fixed by the version of the controller rules, and the two address templates, which differ in one word, by the version of the address scheme (section 18.3). XO's standard wallet template is used at a pinned version.

The wallet's own code derives the same public keys as the engine, for the viewing-key record and for the recoverer's credential (section 9.2). This was checked against the engine's keys.

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

Address (*c*, *i*) is the P2SH32 address of `RecoverableAddress(tag(c, i), hash160(public key(c, i)))`. It holds BCH, fungible tokens and NFTs alike. To a payer or an application it is an ordinary script address; nothing shows that it is recoverable or which wallet it belongs to. A spend by key publishes the script, which shows the kind of address and still not the wallet (section 16).

Notes for implementation:

- **`spend` is the P2PKH rule inside a script address.** The wallet signs with a type that covers all inputs and outputs. The script does not restrict the type.
- **`sweep` proves knowledge of the secret and names the identity.** The identity cannot be substituted: `ownerApproves` compares it, with one byte appended, to a 33-byte token category, which fixes its length at 32 bytes, so the 64 hashed bytes cannot be split another way.
- **The sweep path is open to the current owner at any time,** not only after a recovery. It is also how a coin that arrives at an earlier address later is collected.
- **A sweep publishes the identity and the secret of each address it empties.** After that, anyone can see that the address belongs to this identity. Only the owner can still use the path.
- **The tag check comes last** in each function, because the compiler requires a function to end on a check of its own.
- **Sizes.** Compiled with cashc 0.14.0, the rules are 96 bytes for the recoverable address and 75 for the vault address; with the tag and key hash the scripts are 150 and 108 bytes. Measured on signed transactions that pass the network's relay rules, an input spent by its key is 296 bytes, a swept input 260 and a vault input 217, against 141 for P2PKH. A payment by key with one input is 340 bytes without change and 384 with it; a sweep is 1,099 bytes for one coin, 2,139 for five and 6,039 for twenty (`docs/address-contracts-trial.md`). Outputs at a script address also have a higher minimum value than P2PKH outputs.

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

- **Spending needs the controller at input 0.** Application transactions do not carry the controller, and many have a contract of their own at input 0, so a coin is first moved from the vault to an ordinary address. A plain payment can be made from the vault directly.
- **The first spend links the vault address to the identity in public.** Payments to one vault address are in any case linked to each other, as with any reused address.
- **A vault coin never obeys an earlier seed.** After a recovery it is at once and only the new owner's. This cuts both ways (section 19).

### 7.6 The viewing key

The viewing key is the extended public keys of the two address nodes and the blinding seed, computed on the phone from the seed when the wallet is created:

| Value | Form | Gives |
| --- | --- | --- |
| Extended public key of each of the two address nodes | Standard BIP32 text, 111 characters each, `xpub…` on mainnet and `tpub…` on test networks | The public key of every address of its kind |
| Blinding seed | 32 bytes | The secret of every address and vault address |

Together with the identity they give every address of the seed, and so every balance and the whole history. They give no power to spend: there is no private key in them, and the controller path needs the owner's signature. Neither value alone gives an ordinary address. The blinding seed with the identity does give the vault addresses, which have no key.

A viewing key is passed on as a **viewing-key record**: these values, the network, the version of the address scheme (which fixes the scripts, the paths and the ranges of section 7.7), and the controller public key of the same seed. The record is signed with that controller key, which shows that whoever made it holds the key. The hash of the record names it in receipts (section 9.5). Nothing in it depends on the identity, so a new device can make one before it is told which wallet it is taking over.

The viewing key is held by the phone, by the recoverer inside the recovery kit, and as a sealed copy on backup stores. **Without it a new owner cannot find the addresses or show their secrets, so it is as necessary for recovery as the recoverer's key.**

Each seed has its own viewing key. After a recovery, or a move to a new seed, the wallet has a new seed and a new viewing key, and every earlier one is kept without a time limit: earlier viewing keys find coins that still arrive at earlier addresses, and they open the earlier seeds' vault addresses.

One property is inherited from BIP32 and must be respected: an extended public key together with the private key of any one of its children gives the private keys of all of them, which here means every address key of that kind. The viewing key must stay away from anyone who could also obtain a private key of the wallet.

### 7.7 Giving out addresses and finding coins

**Ranges.** The address scheme fixes how many addresses of each kind a seed has: `N0` given out, `N1` change and application outputs, `N2` vault. Valid numbers are 0 to `N` − 1. The three sizes are constants of the scheme version, the same for every wallet and every seed, so nothing about them has to be stored or delivered. The sizes proposed from measurement are `N0` = 10,000, `N1` = 10,000 and `N2` = 1,000 (`docs/address-ranges-trial.md`): nearly three fresh addresses a day for ten years, and a full pass of 21,000 addresses for a seed in a few seconds on the user's own server and an estimated 16 seconds on a distant public one. A later version of the scheme can widen a range and leave every address where it is; it cannot narrow one.

**Giving out.** The wallet keeps a counter for each kind and gives out the next number, within two limits:

- **The window.** No number more than 20 (given out), 5 (change and application outputs) or 5 (vault) past the last used one of its kind. Before any is used, numbers 0 to 19, or 0 to 4, are available. An address counts as used when it has any history, which includes a transaction the wallet itself has sent and that is not yet confirmed.
- **The range.** No number at or above `N`.

When the window is full, the wallet offers an address it has already given out and says so, or waits. When a range is used up, the wallet uses addresses again, or the owner moves to a new seed (section 9.7). Neither stops everyday spending, and neither needs the recoverer to be reachable for it. Two requests at the same moment never get the same number and never pass a limit together. A vault address that is shown again, and a `return` output (section 13.3), take no new number.

**An action that is not carried out.** If an address was made for a transaction that was never shown to anyone and never signed, its number is used again. If the address was shown, or a signature left the wallet, the number stays taken and the address stays watched: a failed send or a time-out does not show that nobody can pay it. The device records a number as taken before it shows the address.

**Finding coins.** A device that holds the identity and a viewing key finds that seed's coins in two passes:

1. **Quick pass.** For each kind, derive address 0, 1, 2 and so on, ask the servers for each one's history, and stop after a run of unused addresses as long as the window. This is how an HD wallet is restored, and in nearly every case it finds everything.
2. **Full pass.** Look up every number of every range. This finds what the quick pass can miss: an address given out past a gap because the transaction that had closed the gap was later dropped or reorganized away, and anything given out by a device whose records were lost.

For every address with history the device lists what is unspent there, with its tokens. It then knows, for each coin, the address's secret, which is what the controller path needs. With the seed as well, it knows the key.

A wallet is reported as fully found only after the full pass has finished for every seed it has had. Until then the device says that the search is still running. If a server does not answer, or servers disagree, or a viewing key is missing, the result is "incomplete" with the reason, never "empty". A pass that is interrupted continues where it stopped.

**Watching.** A wallet in use watches every address that has history and the window beyond the last used one, for the current seed and for every earlier seed, because a payer may use an old address again. It repeats the full pass for every seed once a week, and at once after it takes over a wallet or is restored, after it sees a reorganization or one of its own transactions dropped, and when the user asks. A coin that arrives at an earlier address after a recovery is collected through the controller path like any swept coin (section 11.2). Until it is collected, the earlier seed's key spends it too. This is not what the vault address is for: a vault address has no key at all, so nothing sent to it ever obeys an earlier seed (section 7.5).

**Making addresses known again.** The engine hands out key numbers in order, so a device that restores a seed makes its addresses again from number 0 upward, each with its tag, up to the last used one and the window beyond it. A trial measured 16 ms an address: about three minutes for 10,000. Addresses of an earlier seed and vault addresses hold no key of the device and are made known singly, as they are found.

No record per payment or per address is needed for any of this. What must not be lost is the identity and the viewing key of every seed.

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

Fresh addresses, change addresses and the quick search with a gap limit work the same way in both. The full search over fixed ranges is an addition of this wallet.

### 7.9 The first coins

An address needs the identity, and the identity is the identifier of a transaction, so the wallet's first coins cannot arrive at a recoverable address. Creation takes three steps:

1. **Fund.** The user sends coins to the wallet's funding address, an ordinary P2PKH address of the funding key.
2. **Prepare.** The wallet pays itself, so that it has a coin that is output 0 of its transaction. The identifier of this transaction is the identity. (If the coin received is already output 0 of its transaction, this step is not needed and that transaction's identifier is the identity.)
3. **Create and move.** A transaction spends that coin and creates the controller, naming the recoverer's key hash and the waiting period. The rest is moved to recoverable addresses in the same transaction or the next, apart from a small coin of the owner's that is set aside to pay for a cancellation (section 8) and, if the user chooses to give one, an allowance for the recoverer's fees (section 9.6).

The wallet checks the creating transaction as any client would (section 5.7) before it uses the identity. If the device stops part-way, it continues from the transactions that exist and does not start a second identity. The interface shows the steps separately (funded, prepared, created, kit sent, recovery confirmed by the recoverer). Coins in the wallet do not by themselves mean that recovery is on.

**No step waits for a block.** Each step goes on as soon as the network has the transaction before it, in a block or not: addresses are given out, the recoverer is enrolled, the backup is made and recovery can be shown as on while the creation is still on its way into a block. This is safe because of the two ways into every address (section 4.2). The `spend` path needs only the address's own key and does not involve the identity. If the transaction that defines the identity, or the one that creates the controller, were replaced or its block undone, the coins already paid to the wallet's addresses would still be the wallet's, spent by their keys; what would be lost is their recoverability, until they are moved. And only whoever can spend a transaction's inputs can replace it: once the coins the defining transaction spends are in a block and the wallet's own, or the defining transaction itself is, that is the wallet alone.

**The wallet watches its creation until a block holds it**, at every check, and handles its disappearance (CR02):

- **The transaction that defines the identity is gone** (replaced, or its block undone and a conflicting transaction mined instead): the identity no longer exists, nor does anything built on it, including payments made from the wallet's first coins. The wallet says so plainly. It stops giving out addresses of that identity, but it never forgets the ones it gave out: it keeps watching them, and what arrives there stays visible and counted, as the wallet's own and not recoverable. It makes a new identity from the coins it has, at the funding address and, where those are not enough, at the addresses of the identity that disappeared; it never makes a second identity while the first still exists. The new identity's addresses take numbers after those already given out, so that every number keeps one address. What remains at the earlier addresses, and what arrives there later, is moved to the new identity's addresses by ordinary payments signed with the address keys, tokens unchanged. Recovery is off until the recoverer is set up again: the kit it holds names an identity that does not exist.
- **Only the creating transaction is gone**, and the coin it spent is there again: the controller is made again for the same identity, so the addresses given out stay the wallet's. A kit names the creating transaction, so the recoverer is sent a new one.
- **A transaction that was never seen** may still be on its way, or the device stopped before sending it; it is sent again from the same coins.

The state that records this is stored before each step, so a device that stops at any point continues from there.

**A vault address waits** until nobody but the wallet could undo its creation: until the defining transaction is in a block, or at once when every coin it spent was in a block and the wallet's own. A vault address has no key (section 7.5). Were the identity to disappear, a payment to it could never be spent by anyone, and a vault address is meant to be published and paid for years. This is the only address the creation makes wait; with first coins that are already in a block it does not wait at all.

Two things follow. The funding address is not recoverable; it is shown only until the wallet exists, and a coin sent to it later can be moved only while the seed is at hand. And the wallet's first coins can be traced to the creation of its identity, through the transaction that prepared both. Coins received later at fresh addresses have no such link.

## 8. Normal operation

**Receiving.** The wallet shows a fresh address of kind "given out" for each request, within the limits of section 7.7. Nothing is written on chain and the controller is not involved. For a lasting address it shows a vault address.

**Paying.** The wallet picks coins, signs each input with its address key, and sends change to a fresh change address. Fungible tokens and NFTs move the same way. The wallet never pays a fee with a coin that carries a token, and never drops or alters a token it was not asked to move. Several payments can be in flight at once, and the wallet can take part in a transaction with other parties.

**Application actions.** The wallet builds the transaction from the application's template, adds its own inputs and outputs, and signs with address keys (sections 12 to 14). Tokens that carry authority over a position are held at ordinary addresses.

**Controller transactions.** Cancelling a request, changing settings, sweeping and spending from a vault address spend the controller. The fee is paid by a coin of the wallet, signed by its key. That coin, and its change, are visibly in a transaction with the identity. The wallet keeps a small coin for this purpose and does not mix its change with other coins. A cancellation paid this way is 1,091 bytes without change, which is the least that coin may hold at one satoshi per byte. Ordinary payments leave that coin alone, and the wallet says so when it is missing (section 17).

**Fees.** The wallet pays the lowest fee that nodes relay and works it out from the transaction itself.

- **Rate.** A setting, one satoshi per byte by default, which is what nodes require. The wallet does not raise it by itself. If a server refuses a transaction for its fee, the wallet says so.
- **Exact amount.** The fee is the size of the signed transaction in bytes times the rate, rounded up. The size is known before signing: signatures are Schnorr signatures of 65 bytes, public keys are compressed, and every script is fixed. The wallet measures the encoded transaction; it does not add up estimates.
- **Smallest output.** Nodes relay no output below a value that depends on the output's own size: 546 satoshis for P2PKH, 576 for an address of this wallet without a token, 888 for the controller, and more for an output with a token, according to its token data. The wallet computes this for every output it creates.
- **Choosing coins.** At a constant rate every coin costs its bytes once, whenever it is spent. What can be saved is the change output: 44 bytes now and 296 when it is spent. The wallet therefore prefers a choice of coins that needs no change.
- **A remainder too small to return.** If what is left after the fee is below the smallest change output, the wallet compares leaving it to the fee with adding a coin so that change becomes possible. It takes the cheaper and shows the amount as part of the fee.
- **A check before sending.** The signed transaction is checked once more: its size is the one worked out, its fee is the required one plus at most such a remainder, and no output is below its smallest value. Otherwise it is not sent. There is no limit on the fee in satoshis, which would stand in the way of a transaction with many inputs.

The same rules apply to controller transactions and to the transactions the wallet builds from an application's template.

**Sending everything.** The wallet offers to send all its Bitcoin Cash to one address.

- **What goes.** Every coin without a token, the coin kept for cancelling included. Everything is paid to the one address, there is no change, and the amount is the total less the exact fee.
- **Coins that only the controller can move.** Vault coins, and coins at an earlier seed's addresses that are not yet swept, go in the same transaction, with the controller at input 0 and its successor, which keeps its 1,000 satoshis, at output 0. A wallet with more coins than one transaction holds sends several, each with its exact fee.
- **Tokens.** The satoshis under a token stay with it. They leave when the token is sent, or when the user destroys the token on purpose, which is an action of its own.
- **When it cannot be done.** Only when the total less the fee is below the smallest value of the destination output. A single P2PKH coin of 546 satoshis leaves 361, which cannot be sent. A wallet needs the smallest output plus the fee: 886 satoshis in one coin at an address of this wallet (a payment of 340 bytes and an output of 546 satoshis), and more when the amount is spread over several coins. Below that the wallet shows the total, the fee and the smallest output, and sends nothing. A coin that costs more to spend than it holds is left out and listed; nodes relay no such coin at the default rate.
- **What is left.** The controller with its 1,000 satoshis, coins with tokens, and whatever the recoverer holds. The wallet stays usable and recoverable. It says that it cannot cancel until it holds a coin again.

**Closing.** Sending everything with the controller's `ownerClose` in the last transaction also takes the controller's value and ends the identity (section 5.8). It is not offered in the ordinary interface.

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

No value in the second to sixth rows can be turned into a signature for a coin of the wallet. The recoverer's key signs the two recovery transactions, and a fee key that comes with it spends the recoverer's own coins for fees (section 9.6).

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

This proposal takes the first as the default. The credential must be unrelated to the owner's seed: not a key of the owner's tree and not derivable from it. That a device has erased the credential cannot be shown to anyone, so an old device may still hold a copy (section 9.7).

The credential gives two keys, at the same places in its own tree as the owner's controller key and funding key have in the owner's: the **recovery key** at `m / P' / C' / 0' / 0`, whose hash is in the controller, and a **fee key** at `m / P' / W' / 0' / 0`, whose address holds the coins that pay the recoverer's fees (section 9.6). They differ so that this address cannot be computed from the controller's state. A recoverer that makes its own key gives the device two key hashes instead of one.

### 9.3 Delivery

Two names are used from here on. The **recovery kit** is what the recoverer keeps for a wallet for as long as it serves it; it grows when the wallet gets a new seed. The **enrollment message** is the sealed message that delivers the first kit.

The owner first obtains the recoverer's encryption public key through a channel they trust, and the wallet shows the key's fingerprint for comparison. This is an encryption key, not a wallet key and not an extended public key.

The enrollment message is signed by the owner's controller key and sealed to the recoverer's encryption key with HPKE (RFC 9180) in base mode: X25519, HKDF-SHA256, ChaCha20-Poly1305. It is sent once, in the part of a link after `#`, which browsers do not send to servers, or as a QR code. Sealing adds 49 bytes. Anyone may see the sealed message in transit; only the holder of the matching private key can open it, and sealing the same content twice gives unrelated bytes. Who made the message is settled by the signature inside it and by the chain, not by the encryption. (`packages/enrollment`; decision D14.)

Creating the wallet needs only the owner. The recoverer can open the message later. The interface must distinguish "kit sent" from "the recoverer has confirmed it", and must say that coins received before the confirmation are not yet recoverable.

### 9.4 What the kit contains

| Field group | Purpose |
| --- | --- |
| Format, version, network | Unambiguous reading; no use on another network |
| Identity and the identifier of the transaction that created it | Find and check the wallet. The transaction itself is fetched and checked, not taken from the message. |
| Version of the controller rules; version of the address scheme; references to the wallet's templates (identifier and content hash of each) | Choose compatible behaviour |
| Recovery credential, or a statement that the recoverer holds its own key | Authorize the request and the completion; pay their fees |
| Viewing-key record of the current seed, and those of earlier seeds if any | Hand to a new device after completion |
| Backup stores: addresses, archive identifier, content key; the same for earlier archives | Read the sealed records |
| Policy as the owner saw it: owner key hash, recoverer key hash, waiting period, who the kit is for, time of making | Compare with the chain. The time is a note, not evidence. |

The enrollment message must fit a QR code that a phone camera reads reliably. What is measured is the whole link as text, with the sealing and the encoding included; the 2,953 bytes that the largest code holds as binary data are not the budget. Templates and other growing data are not in the message; they are on the backup stores.

A kit that has grown through several seeds is not sent again as one code. Additions arrive in messages of their own (section 9.7), and a kit given to a new recoverer may refer to sealed records on the stores by their hashes. A reference is not the thing itself: the recoverer confirms only after it has fetched and saved what is referred to.

The first enrollment message is not a backup of later seeds. A recoverer that kept only that message, and not what came later, cannot recover coins at the addresses of a later seed.

The kit lets the recoverer read the wallet. That has to be explained to the user: secrecy from someone watching the delivery is not secrecy from the recoverer.

### 9.5 Checking and confirming

The recoverer checks an enrollment message against the chain before relying on it:

- it is for this network and its signature is valid;
- the identity's creation is valid (section 5.7) and the controller can be followed to a current state;
- the signer's key hash is the owner in that state, and the viewing-key record is signed by the same key;
- the credential's recovery key hash is the recoverer in that state;
- the waiting period is the one the message states.

It then saves the kit where it will not lose it and leaves a **receipt** on the backup stores, signed with the recovery key. The receipt names the network, the identity, the hash of the message it answers, the hash of every viewing-key record the recoverer now holds, and the recovery key hash. The wallet finds the receipt there, so no channel from the recoverer back to the owner is needed. A store's answer that something was uploaded is not a receipt. A receipt for another message, or one not signed by the recovery key, does not count. The wallet says that recovery is on only when a receipt matches what it sent and the controller's state, as the network shows it, matches both. That state counts as soon as the network has it, in a block or not; each check works the status out again from the chain, so a transaction that disappears takes the status with it.

A receipt given before a change takes effect, for a new seed or a new recoverer, is a **prepared receipt**. It also names the controller output it was prepared against and the state the change is to produce, and it counts only once the chain shows exactly that change (section 9.7). A prepared receipt from a recoverer that is not yet in the controller's state is signed with the recovery key that is to be installed.

### 9.6 Fees for the recoverer

A request and a completion each need a coin to pay the fee. Paid by one P2PKH coin with change, a request is 991 bytes and a completion 970, so the two together cost about 2,000 satoshis at one satoshi per byte.

The recoverer pays them from coins of its own. These are kept at an ordinary single-key (P2PKH) address of the recoverer's fee key (section 9.2). The recoverer's software shows that address, what it holds, and what a request and a completion need. Anyone can send coins there from any wallet.

The owner may give the recoverer an **allowance** when the wallet is created, by sending coins to that address. This is offered, not required. Its only purpose is that a recovery does not wait for the recoverer to obtain Bitcoin Cash; it adds no power, and doing without it takes none away. The suggested amount covers four requests and one completion, so that three requests the owner cancels still leave enough for a fourth and its completion: 4,900 satoshis at one satoshi per byte (four requests of 991 bytes, each paid by one coin with its change, and a completion of 936 bytes that takes what is left). An allowance, once given, is the recoverer's: it can spend it at any time, the wallet does not show it as part of the user's balance, and it comes back only if the recoverer sends it back.

A recoverer without coins cannot send a request. Its software says so when the wallet is enrolled and whenever it is opened, not only at the moment of a recovery.

The controller's own value cannot be used for fees: the successor must carry at least the same value.

### 9.7 Keeping the kit current

**A new seed, by recovery.** Before the request, the new device gives the recoverer its viewing-key record and the access to a new backup archive (section 11.1), and the recoverer saves both. The recovery key is still the one in the state, so the credential stays valid. The wallet is therefore recoverable again from the moment the new device becomes the owner.

**A new seed, with the old device still working.** The order matters, because `ownerUpdate` takes effect at once:

1. The new device makes its seed, its viewing-key record and a new backup archive.
2. The old device sends the recoverer an **update message**, signed and sealed like the enrollment message, with the new record and the new archive access. It gives the new device, directly, the identity and every viewing-key record so far.
3. The recoverer saves what it was sent and leaves a prepared receipt.
4. Only then does the old device sign `ownerUpdate`, naming the new controller key.
5. The new device sweeps (section 11.2), starts watching, and gives out addresses.

No address of the new seed is given out before the network has the change of step 4; from then on the new device sweeps and gives out addresses, without waiting for a block. Each step can be repeated after an interruption. A preparation that was never followed by its `ownerUpdate` stays visibly unused and is not taken for a seed of the wallet.

Until a block holds the change, the old device keeps it on record and looks at it at every check. Only a holder of the owner's key can replace it. If it disappears, everything built on it disappears too, the new device's sweep included; the coins are back at the old addresses. The old device then owns the wallet again, shows it as its own, and makes the change again with the same prepared receipt. The new device follows the chain: it sees another key named as the owner, gives out nothing and takes on nothing meanwhile (section 17), keeps what was paid to its own addresses, which its keys spend, and goes on when the change is back.

**A new recoverer.**

1. The owner obtains the new recoverer's encryption key and compares its fingerprint, as at enrollment.
2. The wallet makes a new credential, unrelated to the old one and to the seed, and sends the new recoverer a complete kit: every viewing-key record, the access to every archive, the settings that are to apply.
3. The new recoverer checks what it can (the identity, the owner, the signatures of the viewing-key records), saves the kit and leaves a prepared receipt. It is not yet the recoverer on chain and does not claim to be.
4. The owner signs `ownerUpdate` with the new recovery key hash. This also clears a pending request.
5. As soon as the network shows the change and it matches the receipt, the wallet says that recovery is on again. If the controller moved in between, the receipt is prepared again against the new output. If the change disappears, recovery shows as off and the change is made again, as for a new seed.

The new recoverer pays its fees as the first did (section 9.6), and the owner may give it an allowance. What the old recoverer holds at its fee address is its own. Getting it back takes that recoverer's cooperation and is not counted on.

The earlier recoverer keeps what it was given. Its key no longer works on the controller. It can still see the addresses of the seeds whose viewing keys it holds, including what arrives there later. To end its view of future payments, the owner also moves to a new seed and a new archive and gives those to the new recoverer only. What it has already seen cannot be taken back.

**A change of the waiting period alone.** The owner sends the new settings in an update message, and the recoverer's receipt for them replaces the earlier one.

**A request the recoverer did not make** means that its key is in other hands, possibly as a copy left on a device that once made the credential. The owner cancels and replaces the credential or the recoverer.

## 10. Backup data

### 10.1 What recovery depends on

Two separate conditions decide whether something is recovered:

1. **Authority.** The new owner can act on it. For coins and tokens at the wallet's addresses this follows from owning the identity. For an application position it follows from rule 1 (section 12).
2. **Information.** The new owner can find it and knows what it is.

| Information | Needed for | If it is lost |
| --- | --- | --- |
| Identity | Everything | The recoverer cannot act. It is in the kit. |
| Viewing key of every seed | Finding coins and showing their secrets | Coins at that seed's addresses cannot be found or swept by a new owner. **Indispensable.** The recoverer's kit holds them all. |
| An application's template | Showing what a token means and operating its position | The token is still swept and safe. The template can be had again from the application or from any copy; it is identified by its hash. If no copy exists anywhere, the position cannot be operated from the wallet. |
| Which template made which token | Convenience | The wallet can test a token against templates the user trusts (section 10.4). |
| Labels | Convenience | Names are lost. |

No per-payment and no per-address record is needed. This is what keeps the backup small. A missed write of a label or of a token note is harmless. A viewing-key record that never reached the recoverer is not, and section 10.5 lists what must be stored before the wallet depends on it.

### 10.2 Records

| Record | Contents | Written |
| --- | --- | --- |
| Viewing-key record | As in section 7.6 | When the wallet is created; by a new device before a recovery request or a move to a new seed |
| Template | The template, whole and as the text it arrived in; its identifier and content hash; the recovery declaration that came with it (section 13.3) and anything else it refers to, each named by its content hash | When the user trusts a template, before its first action |
| Token note | Token category; identifier of the template; which authority entry of its declaration | When an action creates an authority token |
| Label | A name the user gave | When given |
| Receipt | The recoverer's signed statement of what it holds (section 9.5) | By the recoverer |

A template is kept whole because its identifier depends on the order of its fields; a registry or the application's site may not exist later. A template that an open position was made with is kept after a newer one replaces it.

### 10.3 Sealing, stores and authenticity

Records are encrypted with XChaCha20-Poly1305 under the content key and stored as blobs named by their hash, on one or more stores. A store sees neither whose the blobs are nor what they hold. The device keeps a full copy, from which a store can be filled or replaced without the old one taking part. (`packages/archive`, `apps/archive-store`.)

The recoverer holds the content key, and so does a lost phone. The content key therefore cannot be what makes a record genuine. Each record is signed by the controller key of the seed that wrote it, and a reader accepts it only if the controller's history shows that key as an owner. Two exceptions: a receipt is checked against the recovery key it names and the controller's state, and a record that a new device writes before it becomes the owner is signed by the proposed key and counts once the controller shows that key as the owner.

A signature shows who signed, not when. Whoever holds an earlier seed can sign new records with it long after that seed stopped being the owner. Three rules follow:

- **The recoverer's kit is the reference for viewing keys.** A viewing-key record counts when a receipt names its hash. A second record for the same seed, signed by the same key, does not replace the first; the reader reports the conflict.
- **Records of an earlier seed never override the current owner's.** A template or a label from an earlier archive is a suggestion from that time. It does not make a template trusted on the new device.
- **Newest does not win by date.** Dates in records are notes. Where two sets disagree, the one that a current receipt names is used, and the rest is reported.

Stores can withhold, and they can hand back an older set that was once genuine. The device and the recoverer each keep the hash of the latest receipt and compare it with what a store returns. If the newest set cannot be established, the device says that the backup may be out of date. Using more than one store, and keeping the device's copy, reduces these risks and does not remove them. Nothing on chain commits to the backup in this version.

### 10.4 What a record can and cannot do

A record is a hint, never an authority.

- A token note is checked: the wallet rebuilds the position's address from the token and the template, and the address must exist on chain as the template says.
- Without a note, the wallet can try each template the user trusts, find a position the way that template's declaration says (section 13.3), and check what it finds in the same way. A position need not be in the transaction that created its token.
- No record can make the wallet treat an address as its own. Addresses come only from the identity and a viewing key.
- A viewing-key record is used only when a receipt names it. A wrong record would find nothing, and finding nothing is not evidence of an empty wallet.

### 10.5 Writing before depending

| Before | This must be safely stored |
| --- | --- |
| The wallet says that recovery is on | The recoverer's receipt for the current kit, matching the controller's state as the network shows it |
| A signature for the first action of a template leaves the wallet | The template with its declaration, on the configured stores. By default the wallet refuses the action if no store confirms. |
| A recovery request to a new device's key | The new device's viewing-key record and archive access, with the recoverer |
| An `ownerUpdate` to a new seed | The same, and the recoverer's prepared receipt |
| An `ownerUpdate` to a new recoverer | The complete kit with the new recoverer, and its prepared receipt |
| An address is shown | Its number, recorded as taken on the device |

The third and fourth rows keep the wallet recoverable at every moment: as soon as a new seed becomes the owner, the recoverer already holds what a later recovery will need.

A store that cannot be reached does not stop ordinary use. Paying, receiving and the actions of templates that are already stored go on. It stops only what would create a new dependency.

### 10.6 After a recovery or a move to a new seed

The earlier device knows the earlier backup's content key. The new device therefore starts a new archive, with a new identifier and key, and gives the recoverer access to it together with its viewing-key record, before the change of owner. The earlier archive is read for templates, notes and labels, which are copied into the new one, and is then left. Nothing is removed from it while the copy is unfinished.

This protects records written from then on. It does not take back what the earlier key could already read.

## 11. Complete recovery procedure

### 11.1 Steps

0. **Setup, while all is well.** The wallet creates its controller, naming the recoverer's key hash and the waiting period. It sends the recoverer the enrollment message. The recoverer checks it against the chain, saves the kit and leaves a receipt.
1. **A new device.** It makes a new seed. It gives the recoverer a **takeover message**, sealed to the recoverer's encryption key: the hash of its controller key, its viewing-key record signed with that key, the access to a new backup archive, and an encryption key of its own for the answer in step 6. Nothing in the message needs the identity, which the new device has not been told. Both sides show a fingerprint of the proposed key. The recoverer saves the message.
2. **The recoverer satisfies itself** that the person is the wallet's user and that the proposed key is theirs. How is the recoverer's own process; the design depends on it.
3. **Request.** The recoverer signs `requestRecovery` naming that key hash. The controller is Pending, on chain.
4. **Wait, and the owner's chance to refuse.** Everyone computes the end of the wait from the chain; it counts from the block that holds the request (section 5.4), and the owner's wallet warns as soon as the request is seen. A wallet that still works and did not ask for this cancels. If the request is cancelled or reorganized away, the recoverer stops.
5. **Complete.** After the waiting period the recoverer signs `finalizeRecovery`. The proposed key is the owner; the epoch has gone up. No coin has moved.
6. **Hand over.** As soon as the network shows the completion, in a block or not, the recoverer gives the new device, sealed to the device's encryption key: the identity, the identifier of the creating transaction, the viewing-key record of every earlier seed, the access to earlier archives, and its receipt for the kit as it now stands. The new device checks the identity's history itself and sees its own key as the owner. If something the recoverer should hold is missing, the device says so; it does not report an empty wallet.
7. **Sweep.** The new device finds the coins and moves them to addresses of its own seed (section 11.2). It starts as soon as the quick pass has found something and goes on until the full pass has finished for every earlier seed. It moves first what is worth most, and it counts a token it does not understand as possibly valuable: such a token may carry authority over a position worth far more than the coin it sits on.
8. **Understand what the tokens are.** A swept NFT is already under the new owner's control. To show it as "a jar with 0.3 BCH that opens in March", the wallet needs the application's template, from the backup or from the application when the user connects again. Recovery does not wait for this.
9. **Resume protection.** The new device watches the controller, keeps watching earlier addresses, and sets aside a coin for cancelling. If the recoverer paid for the recovery out of an allowance, the owner may give another. It says that recovery is on once the recoverer's receipt names its viewing-key record.

The recoverer never learns the new device's seed. It does have the agreed power to name another key after an uncancelled wait, so identifying the user correctly stays its responsibility.

### 11.2 The sweep

| | Contents |
| --- | --- |
| Input 0 | The controller, `ownerAuthorize`, signed by the new owner's controller key |
| Inputs 1… | Coins at earlier addresses, each unlocked with `sweep(identity, secret)`; vault coins with `spend(identity, secret)` |
| Output 0 | The controller, state unchanged and Active |
| Outputs 1… | Addresses of the new seed. Fungible tokens and NFTs are carried over with category, amount, capability and commitment unchanged. When the new device holds no coin for cancelling, one output is that coin. |
| Fee | Taken from the swept BCH |

Rules for the wallet:

- **Everything is covered by one signature,** the owner's on the controller. Nobody can add to the transaction or change an output.
- **A large wallet is swept in several transactions.** Each spends the controller output of the one before. An interruption between parts loses nothing: what is not yet swept is found again by the same search.
- **A wallet with tokens and no BCH still needs a fee.** The new device must have a source: a coin received at a new address, or one given by the recoverer.
- **A sweep also cancels a pending request,** since it uses `ownerAuthorize`.
- **The first sweep puts the coin for cancelling aside** (section 8), as one more output. A device that has just taken the wallet over can then refuse a request without a transaction of its own for that. If what is swept does not pay for it, the coin is put aside later.
- **Coins that arrive at an earlier address later are swept the same way** when the wallet notices them.
- **Application tokens need no special handling.** An NFT of an application the wallet has never heard of is swept like any coin.
- **Tokens are carried over unchanged.** The owner's approval would allow anything to be done with a swept token. The wallet changes nothing about it: the fee never comes from a coin's token, and the amount, capability and commitment stay as they were.

### 11.3 What each party holds and can do

| Party | Holds | Can do | Cannot do |
| --- | --- | --- | --- |
| Owner's device | The seed; the identity; the viewing key | Spend, cancel a request, change the recoverer | |
| Recoverer | Its key for this wallet; the identity; the viewing keys; coins of its own for fees | Request and complete a recovery, and pay their fees. See every address and balance. | Spend a coin of the wallet with its key. Shorten the wait. Complete with a key other than the one requested. |
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
| 3. The token leads to the position | From the NFT (its category and commitment), the template and the chain, a wallet can find the position, work out what its actions need, and list the actions it offers. | No application server, no private note and no secret that existed only on the lost device is needed. What the application itself goes on needing, such as a price oracle, is named in the template. |

### 12.2 Why these are enough

- **Recovery never touches an application contract.** The sweep moves the NFT from one wallet address to another. The position stays where it is.
- **The application's transaction layout is its own.** The controller is not in application transactions, so an application may fix its input and output positions as it likes.
- **A wallet can recover what it does not understand.** The meaning of a token can be learned later.
- **Liquidation, vesting, repayment and other conditions of the application are untouched.** Recovery restores the remaining rights, not an earlier state.
- **Part of this can be checked by a program.** Whether a template leaves the wallet's outputs to the wallet, and whether a declaration is well formed and leads to a position on chain, can be checked mechanically. Whether a contract gives authority to the token and to nothing else takes reading the contract and testing it. A checker therefore gives one of three answers: verified, a violation found, or not verified (section 14.3).

### 12.3 What the rules exclude, and what they ask of the wallet

Excluded: positions opened by a key written into the contract; positions whose owner is known only to a server, including accounts opened by signing a message; and front ends that insist on building the transaction themselves from the wallet's public keys.

Not solved by the rules: a position that changes without the wallet. A loan that is liquidated or redeemed leaves the wallet holding a key to nothing. The way a template finds a position has to give "not found" as an ordinary answer.

A token that carries authority is a bearer instrument: whoever gets it spent in a transaction of their own shape can exercise it. The wallet therefore spends such a token only in transactions it built itself from a template the user trusts, and shows the user everything the transaction moves, not only the wallet's own coins. What it shows is what this transaction does. It cannot show what an unfamiliar contract will allow later; that rests on the user's trust in the template. A token of unknown meaning can always be held and swept without trusting anything.

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
- Keys are derived per template from the account's twelve words, at `m / P' / T' / 0' / n` (section 7.2). A secret in a template is a derivation index, not a key; the engine cannot import a key, and it signs with no other.
- A template's defaults name a locking script, the keys to make and the variables the caller supplies. From them the engine makes one script per call, with a new key and the caller's values, follows it, and keeps the values for the spend. A script can also take a key hash as a variable, for a key the account does not hold.
- Only one engine can be open in a process or a page.
- An account can hold only one role that has a follow-up action. Owner and recoverer are separate accounts.
- The validator rejects properties it does not know, at every level.
- Parties to one invitation must have imported the identical template. An invitation is for one template; it accepts inputs that the account holds under other templates, unlocked as their own scripts say, and outputs to scripts of other templates.
- A template's identifier depends on the order of its fields, so a template is kept as the text it arrived in. The identifier the engine uses is the hash of the template as its parser writes it out, which differs from the hash of the text it was given.
- What the engine hears about a transaction before its header check has reached the tip is dropped and not asked for again. An account waits for the header check before it makes scripts known.
- The engine cannot produce a valid `0x61` signature for a transaction with more than one input.
- A template variable of type `timestamp` is read back as text when unlocking later, so it cannot be used in a script that is unlocked later.
- An output's locking script can be given by a variable that holds locking bytecode; the stock payment template does this for its recipient.
- Block header verification on chipnet fails after the switch to one-minute blocks; the engine still works, with errors logged (`docs/xo-chipnet-header-verification.md`). While it fails, what the engine reports as confirmed rests on the servers alone. A local fix is in `spikes/xo-engine/patches/chipnet-faster-blocks.mjs`.
- The engine releases the coins an invitation named only when told; an action that is not sent must release them.

### 13.2 The wallet's own templates

The wallet is itself described by XO templates. They are separate because the engine derives a template's keys under the template's number (section 7.2): keys that must not share a branch are in different templates, and a template that holds keys can never change.

| Template | Contents | Keys | May change |
| --- | --- | --- | --- |
| Controller | The controller script with its five ways to unlock. Owner actions: create the wallet; approve (the controller continues, with whatever inputs and outputs the transaction also has: cancelling, sweeping, spending from a vault address); change settings; close. Recoverer actions: request recovery; complete recovery. | The owner's controller key; in the recoverer's account, the recovery key | No. Fixed by the version of the controller rules. |
| Addresses given out | The recoverable address, unlocked by its key | Address keys of kind 0 | No. Fixed by the version of the address scheme. |
| Change | The same, differing in one word | Address keys of kind 1 | No. Fixed by the version of the address scheme. |
| Wallet actions | Paying from the wallet's addresses. The recoverable address of an earlier seed, which takes its key hash as a value and can only be swept. The vault address. | None | Yes |
| XO's standard wallet | Ordinary single-key coins: the funding address, the recoverer's fee address | The funding key; the fee key | Pinned version |

Roles are owner and recoverer, in separate accounts.

The wallet's code computes what a template cannot guarantee: the next controller state, each tag, each secret. The templates assemble them into transactions; the contracts enforce that they are right. A test checks that the scripts in the templates are the compiled contracts, byte for byte.

**What the trials of stage 0 showed,** each through the unmodified engine and accepted by a node with the public networks' relay rules (`docs/xo-engine-stage0-trials.md`):

- one script per address, with the wallet's tag and the engine's next key, followed by the engine and equal to what the wallet's own code computes;
- an address of an earlier seed, followed and swept without its key;
- a payment by key; a sweep of several coins in one invitation, each unlocked with its own secret;
- one invitation with inputs and outputs of two templates, which is how an application's transaction takes the wallet's coins;
- a new seed, in an account with no history, taking over an identity that another account created, and sweeping.

**Division of work**

| The engine | The wallet's own code |
| --- | --- |
| Keys and signatures | Secrets, tags and the controller's next state |
| One script per address; following them; listing coins | Finding addresses: the quick and the full pass, over a server connection of its own. What is found is then made known to the engine. |
| Building each transaction from a template, the wallet's and an application's | Choosing coins, the exact fee and the change (section 8) |
| Invitations as the record of what was done | The script check before anything is sent |

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

| Kind | The wallet supplies | Number taken |
| --- | --- | --- |
| `receive` | A fresh ordinary address, for a coin or token created now. Key chain 1, secret kind `0x01`. | The next of chain 1 |
| `change` | A fresh ordinary address for what is left over. The same chain. | The next of chain 1 |
| `return` | The locking script of a named input of the same transaction, which must be a coin of the wallet. For contracts that require a token to go back where it came from. | None |
| `lasting` | A vault address, for an address stored now and paid later. Secret kind `0x02`. | The next vault number, or one already given out if the user chooses |

The same marker on an input says "a coin of the wallet", with no assumption about its script or size.

Chain 0 is only for addresses the user gives to people. The wallet fills each kind itself and never from an address the application supplies. The limits, and the rule for actions that are not carried out, are those of section 7.7. A `return` is refused when the named input is not the wallet's, when the reference is ambiguous, or when the input sits at an address of an earlier seed: such a token is swept first. A token at a vault address is moved to an ordinary address before an application action.

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

The wallet finds the unspent coins at the companion script that carry the token's category; the position is the output at the stated distance in the same transaction. The declaration also has to say what makes a companion genuine: which contract must have created it, and what the position's own script and token must be. The wallet checks that. The category and the distance alone are not enough where the holder of a token could make look-alikes. If more than one candidate passes, or none can be checked, the wallet says so and picks none. The check is carried by a `genuine` entry beside `relative`:

```
"genuine": { "lockingScript": "loanLockingScript",
             "variables": { "loanKey": "token.category", "terms": "companion.commitment" },
             "tokenCategory": "…" }
```

The wallet builds the named script from the stated values and compares it with the script of the output the companion points at; with `tokenCategory`, that output must also carry a token of the category. A declaration with a companion and no `genuine` entry is refused. A companion entry may also state the commitment a companion must carry (`"commitment": "01"`); coins with another are not candidates. Naming the contract that must have created the companion is not part of this version. For ParyonUSD it was not needed: the loan the sidecar points at must carry the deployment's own token, which only Paryon's contracts issue (section 15.2).

**Where values come from.** A declaration takes each value from one of: `token.category`, `token.commitment`, `token.valueSatoshis`, `token.inputIndex` (the number of the input that spends the token), `companion.commitment`, `position.commitment`, `position.valueSatoshis`, and, for an input of the application's that the action describes (below), `input.<name>.category`, `.commitment`, `.tokenAmount` and `.valueSatoshis`. A commitment may be followed by a range of bytes, as in `position.commitment[1..7]`. A whole number is read from bytes as scripts write numbers; from a range it is read as `OP_BIN2NUM` reads it, so padding is allowed. Anything else is a value the chain does not hold, and the position is then reported as incomplete.

**What a position holds.** An authority entry may name values to show beside the token, in the template's words, each with its source:

```
"state": { "debt": "position.commitment[1..7]", "collateral": "position.valueSatoshis" }
```

**The wallet's parts of an action.** For the wallet to operate a position with the application's site unavailable, the declaration also says what each action leaves to the wallet:

```
"actions": {
  "open":     { "creates": "keyCategory", "outputs": { "keyHolder": "receive" } },
  "withdraw": { "spends": "jarKey", "position": "savingsJarInput",
                "outputs": { "keyHolder": "receive" },
                "variables": { "keyCategory": "token.category", "keyInput": "token.inputIndex" } }
}
```

`creates` names the variable that receives a new token category; `spends` the authority entry whose token the action spends; `position` the template input that each coin of the position is spent as; `outputs` the variables that hold a locking script of the wallet's, with the kind of each; `variables` what the wallet fills from the token and the chain. A request may state the same things (section 14.2); where it disagrees with the declaration, the wallet refuses.

**The application's other coins.** Contracts that many users share (a price, a factory, a fee collector) appear in a transaction as inputs that are neither the wallet's nor the position. The declaration describes each, and the coin a position was found through:

```
"manage": { "spends": "loanKey", "position": "loanInput", "companion": "sidecarInput",
            "inputs": { "priceInput": { "lockingScript": "priceContract",
                                        "token": { "category": "…", "capability": "mutable" } } },
            "outputs": { "keyHolder": "return" },
            "variables": { "priceCommitment": "input.priceInput.commitment" },
            "fromApplication": ["loanCommitment"] }
```

- `inputs` gives, for a template input, the locking script its coin sits at and the token it must carry. A request may name the coin by outpoint (section 14.2); the wallet reads it from the chain and checks it against this description. An input the request does not name the wallet finds itself: the first fitting unspent coin, in the order of outpoints. A request that names an input the declaration does not describe is refused.
- `companion` names the template input the companion coin is spent as.
- `fromApplication` lists values that only the application can work out. From its own list of tokens the wallet asks the user for any other missing value; an action that needs one of these is shown as available through the application's page only.

**Order in the transaction.** An item the template gives an index (`inputIndex`, `outputIndex`, XO's own fields) goes there. The coin that defines a new token category is input 0. Everything else takes the lowest free place: first the template's items without an index, in the template's order; then the token spent, the wallet's coins that carry fungible tokens, and its other coins; among outputs, then change in tokens and what is left over, each at a fresh address of chain 1. A place left empty is a refusal.

**Fungible tokens and tokens that end.** Where the outputs need more fungible tokens than the application's coins bring, the wallet pays them from its own and takes back any excess as change in tokens, on a coin of the least value. Tokens on a data output, and tokens of an application's coin that no output carries on, are allowed, and the wallet shows them as destroyed. The wallet's own NFT must still come back to it. An authority token that an action delivers must lead to its position within the same transaction, whether the action created its category or took it from an application's coin.

**The application's inputs are run before the user is asked.** With the transaction worked out, the wallet evaluates each input of the application's in the virtual machine, with bytes of the right length standing in for its own signatures. A value from the application that the contracts would reject is refused at that point, with the contract named. After signing, every input is evaluated again against the outputs read from the chain (section 13.4).

Until the declaration is part of XO's schema it travels as a document beside the template, naming the template by identifier and content hash, and is stored with it. Whether it belongs in the schema or stays a companion document is for XO to say. The field names above are proposals and have not been discussed with XO's authors.

### 13.4 What is needed from the engine

- Outputs and inputs bound to the wallet, as above.
- Actions that create a token category, with the wallet supplying the coin that defines it.
- A transaction that combines an application's template with inputs and outputs of the wallet's templates.
- Many addresses of one script, with keys chosen by a counter.
- Taking over an existing identity with a new seed.
- Valid `0x61` signatures for transactions with several inputs.

Stage 0 showed the third, fourth and fifth, with the wallet's own templates on both sides of the third; an application's template of a third party is tested in stage 7. The first two are the extension proposed above. The last is not available: inputs the engine signs use `0x41`.

Stage 9 added one finding. To unlock a coin by its template the engine follows the coin's script, which means fetching and proving every transaction in that script's history. For a script every user of an application shares this does not end in practice: Paryon's Borrowing script had 76,637 entries on chipnet, and following it held a process at full load for more than ten minutes. A template can mark such a script's role as one a wallet need not track (`relevant: false`, XO's own field). For those, and for any script with more than 50 unspent coins or history entries, the wallet compiles the unlocking from the template itself and hands the coin to the engine with it, as an input of another participant; the engine builds the transaction and signs the wallet's inputs. The wallet also gives every input and output its place in the transaction explicitly, since the engine otherwise puts the template's indexed items first.

Where the engine cannot do one of these, the wallet does it in its own code and uses the engine for the rest. Code of the wallet that fills such a gap works from the template and the kinds of wallet-bound output, and names no application. Every transaction, whoever built it, passes this project's own script check against the outputs it spends before a signature leaves the wallet.

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

The ordinary flow cannot serve this wallet: its addresses are scripts that cannot be derived from public keys alone. The live front ends of Moria and ParyonUSD, read on 16 November 2026, both refuse any wallet address that is not P2PKH, over WalletConnect as well. This wallet offers no key paths in a session, and it answers no standard `sign_transaction_request`: such a request is refused with a reason. (WizardConnect requires those requests to be signed with the flags of `0x61`. That rule concerns a flow this wallet does not offer.)

An application that wants both kinds of user shows one connection address and decides by what the wallet offers. This was done for the Savings Jar and checked with Cashonize.

### 14.2 The `xo_v1` extension

The wallet announces the extension in the session. Nothing in it names an application.

```
{ "xo_v1": { "version": 1, "network": "chipnet",
    "profiles":  ["recoverable-app-v1"],
    "bindings":  ["receive", "change", "return", "lasting"] } }
```

The announcement lists no templates. A list of what the user trusts would tell each application which others the user deals with. The application names its template in the request, and sends it whole when the wallet answers that it does not have it.

| Message | Direction | Meaning |
| --- | --- | --- |
| `xo_action_request` | application → wallet | The template's identifier and content hash, and the content hash of its recovery declaration; the texts themselves when the wallet has answered that it lacks them; the action; the role; the variables; which variables the wallet fills and with which kind; the variable that receives the category of a token the action creates; which of the wallet's tokens the action spends; and, by outpoint, coins of the application's own for inputs the declaration describes |
| `xo_action_response` | wallet → application | Taken on; refused with a reason; or "the template is needed", after which the same request is sent again with the texts |
| `xo_invitation_update` | wallet → application | Approved by the user; sent |
| `xo_action_result` | wallet → application | The transaction and the tokens the wallet received, or an error |
| `xo_positions_request` / `xo_positions` | both | Which tokens of this template does the wallet hold? Answered only for a template the user trusted in a session with this application. A template trusted on the device in another way, from the backup after a recovery for one, is not answered for until the user allows this application; the wallet asks the user then, and only then. |

The messages use only the session's pairing and custom messages. (`packages/connect`; the announcement there still has to be changed to the form above.)

The wallet signs its own inputs with a type that covers every input and output: `0x61` where its signer produces a valid one, otherwise `0x41` (section 5.2).

### 14.3 Rules the wallet follows

- **An unknown template is shown to the user** with its name, description and actions, and is trusted only on their word. The wallet checks that the template is the one the request names, by identifier and content hash. The declaration, and anything else the template refers to, is bound by content hash in the same way; a later download does not replace it.
- **The wallet states what it knows about a template: verified, a violation found, or not verified.** Verified means that the checks the wallet can run have passed, not that the contract was audited. Not verified is the ordinary state of a template the wallet meets for the first time; it is shown as such, and the user decides. A violation is named, with the rule it breaks and what that means for recovery, and the wallet carries out no action of such a template. A template counts as verified once a token made with it has led to its position on chain as the declaration says; until then it is not verified. An unknown profile or version is refused.
- **The user sees two things before approving:** the action in the template's words, and the wallet's own figures from the transaction it built: what goes where, what the wallet gives and gets in coins and in tokens, what goes into the application or comes back from it, which coins of the application are spent, which tokens are destroyed, the fee, the earliest time. The application cannot influence the second.
- **A request is carried out at most once.** It is identified by its id within the session's pairing; a repeat, or a reconnect, gets the stored outcome, and the same id with other content is refused.
- **The application is never sent the identity, a viewing key, or anything about other applications.** It learns the addresses that appear in its own transactions. It can study the chain like anyone.
- **A position is a token.** The wallet answers a positions request from the NFTs it holds on chain. A token whose position is no longer there is reported as closed, and a position that cannot be worked out is reported as incomplete.
- **The wallet signs with address keys.** The controller is not part of an application's transaction.
- **An action that is not sent releases the coins it named,** unless a signature has left the wallet. In that case the wallet first finds out whether the transaction can still be sent by someone else. A time-out is not a withdrawal. Addresses made for the action follow the rule of section 7.7.
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

- **The key.** Opening a jar creates one NFT of a fresh category, with no capability and no fungible amount, and sends it to the wallet. Its commitment is the unlock time, encoded as the script number the contract is built with. A template's token field takes a value as text, so the template has the time twice: as a whole number for the script and the lock time, and as bytes for the commitment. The wallet refuses to open a jar whose key would not lead to it, which is the case when the two disagree.
- **The jar's address follows from the key alone:** P2SH32 of `SavingsJar(key.category, key.commitment)`. That is rule 3.
- **One contract for every wallet.** An ordinary wallet holds the key NFT at a P2PKH address and the application builds the transaction. This wallet holds it at a recoverable address and builds the transaction itself. The jar cannot tell the difference.

| Transaction | Inputs | Outputs |
| --- | --- | --- |
| Open | A coin of the wallet that is output 0 of its transaction (its transaction's identifier becomes the key's category); further coins as needed | The jar, with the first deposit; the key NFT to the wallet (`receive`); change |
| Deposit | Any coins, from anyone | The jar |
| Withdraw | The jar's coins; the key NFT, signed by its address key | The key NFT back to the wallet (`receive`); the savings to the wallet, as what is left over after the fee, at a fresh address of chain 1 |

Points for implementation:

- **The category is known before the opening transaction is built,** because it is the identifier of the transaction whose output 0 is spent. The jar's address can therefore be computed first and funded in the same transaction that creates the key. The wallet may first have to pay itself to have such a coin.
- **The jar trusts the category.** Only the opening transaction can create tokens of it, and the wallet builds that transaction from the template with exactly one NFT. A wallet that made two keys for one jar would only have two keys to its own jar.
- **The time lock is a transaction lock time.** The withdrawing transaction sets its lock time to the unlock time or later and uses a non-final sequence number. The network compares against the median time of recent blocks, so a jar opens somewhat after its date (decision D13).
- **The unlock time is a whole number in the template,** not a `timestamp` variable (section 13.1).
- **The jar's inputs carry no signature.** The signature on the key input covers every input and output, so the transaction cannot be altered.
- **After a recovery** the key NFT is swept like any token. The new device rebuilds the jar's address from the key and the template and finds the jar. Withdrawing sends the key to a new address.
- **The key is kept.** Anyone can pay into the jar again later, and a jar whose key was destroyed could never be emptied. The contract does not require the key to continue. The template's withdrawal sends it back to the wallet, and the wallet checks that output before it signs.

The jar must be checked with this wallet and with Cashonize, with the same contract.

### 15.2 ParyonUSD

ParyonUSD lends its dollar token, PUSD, against BCH collateral. Each loan is managed by whoever holds its loan key NFT. That is rule 1 already, on chain, in contracts that need no change. The aim is a front end and an XO template of this project's own for it, and a real loan surviving a recovery on Paryon's chipnet deployment.

**What was read** (npm package `@paryonusd/contracts` 1.1.0: Borrowing, LoanKeyFactory, LoanKeyOriginEnforcer, LoanKeyOriginProof, manage):

| Transaction | Inputs | Outputs |
| --- | --- | --- |
| Create a loan key | 0 a coin that is output 0 of its transaction; that transaction's identifier becomes the loan key's category · 1 loan key factory · 2 fee | 0 a plain coin without a token (`authhead` in the source) · 1 factory · 2 origin enforcer, holding the minting NFT of the new category · 3 origin proof · 4 change (optional) · 5 data (optional). At most 6. |
| Borrow | 0 borrowing contract · 1 price contract · 2 origin enforcer · 3 origin proof · 4 the wallet's collateral | 0 borrowing · 1 price · 2 the loan · 3 the loan's sidecar (category of the loan key) · 4 borrowing fee (0.25%, at least 1,000 sat) · 5 **the loan key**, 1,000 sat, address not checked · 6 **the borrowed PUSD**, address not checked · 7–9 optional. At most 10. |
| Manage | 0 price · 1 loan · 2 sidecar · 3 manage contract · 4 **the loan key** · 5 the wallet's BCH · 6 PUSD to repay (when repaying) | 0 price · 1 loan · 2 sidecar · 3 manage · 4 **the loan key, to the same script, with the same value** · 5 the repaid PUSD, burned in a data output (when repaying) · then change in tokens and in BCH |
| Close | As manage | 0 price · 1 manage · 2 the repaid PUSD, burned · 3 the loan's own NFT, burned · then change. The loan key is not required to continue. |

The minimum loan is 100 PUSD at 110% collateral, about 0.4 BCH at the price seen, plus the fee.

| Rule | Finding |
| --- | --- |
| 1 · Authority | Met. The loan key is a bearer NFT; the borrowing contract checks its category and not where it is sent. |
| 2 · Wallet's parts | Contracts: the five read put no condition on the wallet's script. Managing requires the key to return to the script it left (`return`). Closing does not; the wallet keeps the key or lets it go only by the user's choice. The official front end accepts P2PKH wallets only. |
| 3 · Finding the loan | The sidecar carries the loan key's category, so the loan can be found from the key (section 13.3, companion coin). The template that says so is this project's to write. |

**What was run** (18 November 2026, `docs/runs/stage-9-loan-chipnet.md`): on Paryon's test deployment `chipnet-fast-periods-6`, a wallet of this project created a loan key, borrowed 100 PUSD against 59,834,798 satoshis, added collateral, and closed the loan, with transactions built by this project's code (`packages/paryon`) from the published contracts, unchanged. The loan key and the borrowed PUSD arrived at recoverable addresses; the collateral came back at the close. Every transaction paid 1 satoshi per byte, and each spent unconfirmed outputs of the one before: no step waited for a block. The whole course cost 102,853 satoshis, 90,915 of them Paryon's borrowing fee. Before each transaction was sent it passed the virtual machine with every input and was tried on a node; right after the borrow the closing transaction was built against the actual outputs and tried, so that the way out was known before anything else was done.

What the run settled, beyond the table above:

- **The contracts accept this wallet.** None of them looks at the wallet's scripts. In managing and closing the loan key must be input 4; in creating a key the wallet's coin must be input 0 and the first output of its transaction.
- **Burning is by data output or by omission.** The repaid PUSD and, on closing, the loan's NFT go to data outputs that carry the tokens. The sidecar's NFT and the proof of the key's origin are burned by leaving them out.
- **The deployment's keepers have stopped.** Its stored price was $274.98 while the oracle signed $208.70, and anyone can bring the stored price up to date. The loan was therefore given collateral of 125% at the oracle's price. Its Borrowing thread was moved to the current period first and the loan started at an interest of zero, so that interest for the periods the deployment had missed could not fall on it.
- **A repayment that leaves the loan open was not sent.** Paryon requires a repayment of at least 100 PUSD with at least 100 PUSD left, so it takes a loan of 200 PUSD, about 1.1 test BCH at that collateral. It passes in the virtual machine against the live outputs (`packages/paryon/test`), and the run's script carries it out when given the coins. The closing is the repayment that was sent.
- **On chipnet a lock time by height is compared with a slower height.** Since chipnet's blocks became faster, the node takes a height lock time as final up to the height the chain would have at ten-minute blocks, which it reports beside the block count. Paryon's periods follow that height.

**The loan key can be copied.** Paryon's loan key is an NFT with the minting capability, and managing and closing check only that an input carries it. Whoever holds the key can make further keys of the same category in any transaction, and each of them controls the loan. A sweep moves the key the wallet holds; it cannot cancel a copy made earlier. For a device that is lost and not in anyone's hands this changes nothing. For a seed that someone else has read, it means that the loan stays within that person's reach if they made a copy before the sweep, and the remedy is to close the loan. This is a property of Paryon's contracts and not of the recovery; rule 1 is met in form, and section 12.1 should be read with it: a token that its holder can multiply gives the new owner the authority without taking it from the earlier one. Whether a key was ever spent in a transaction the wallet did not make can be read from the chain; finding every copy takes an index by token category.

**Through the wallet, from a template** (18 November 2026, `docs/runs/stage-9-template-chipnet.md`): the same course was then run with no code of the wallet's that knows Paryon. A template with a recovery declaration (`packages/paryon`, identifier `aeeaed2e…d8be`) describes six actions: make a loan key, bring Paryon's period up to date, borrow, change the collateral, repay part, repay and close. The requests that a page sends name Paryon's coins and the amounts; the wallet supplied its own coins and addresses, worked each transaction out, had the unmodified engine build the same transaction and sign the wallet's inputs, compared the two, and sent it. A loan of 100 PUSD against 59,857,301 satoshis was opened and given more collateral. Then the device was treated as lost: the recoverer requested, the waiting period of 8 minutes passed, the new device swept the loan key and the PUSD with the other coins, found the loan from the template in the backup and the chain, and closed it from its own list of tokens. Paryon's site and its services were not consulted, and neither was this project's own finder. The collateral came back to addresses of the new seed. The course cost 109,376 satoshis, 90,915 of them Paryon's fee.

What this settled:

- **The declaration of section 13.3 was enough, with the additions described there:** the application's other inputs, the companion's input, values from an input and from part of a commitment, and what a position holds. The loan is found through its sidecar: an unspent coin at the sidecar script with an NFT of the key's category and the commitment `01`, whose transaction has, one output before, a coin at the loan script carrying the deployment's own token.
- **Closing needs nothing from a page.** Every value is on chain: the debt is part of the loan's commitment. Changing the collateral asks the user for one number. A repayment that leaves the loan open is offered through a page only, because the loan's new record has to be computed and a template's expressions cannot do that arithmetic.
- **The sweep and an action of the loan are separate transactions.** The sweep needs the controller as its first input; Paryon's actions need their price contract there.
- **The engine built every transaction** and unlocked Paryon's factory by the template itself. The other shared contracts the wallet unlocked from the template and handed over (section 13.4).
- **A repayment that leaves the loan open is still not on chain,** for the reason given above; it runs on the simulated chain through the same route.

**What was not:** the other 21 contracts (interest, redemption, liquidation, staking) were read only as far as they bear on a loan of this kind. Paryon's transaction-building library is not public; this project's is written from the contracts. The deployment's parameters are published only inside Paryon's web application. Paryon's contracts repository states no licence, so the npm package is used as a dependency and not copied.

One consequence for privacy: because managing returns the loan key to the script it left, the key stays at one address for as long as the wallet does not move it. That address is known to anyone who looks at the loan. A sweep moves the key, and the key's public history then links the loan to the recovery.

## 16. Privacy

### 16.1 Who sees what

Before any sweep:

| Viewer | Sees |
| --- | --- |
| Owner's device | Everything |
| Recoverer | Every address, balance and past payment of the seeds whose viewing keys it holds; the controller |
| An application | The addresses in its own transactions. It is not sent the identity, the controller or the wallet's other addresses. It can study the chain like anyone. |
| Anyone watching the chain | Script addresses that show nothing until they are spent. A spend by key publishes the script, which shows that the address is of this scheme and not which wallet it belongs to. The usual links between the inputs of one transaction, and between a payment and its change, as with any wallet. A controller that belongs to nobody in particular. |

### 16.2 The controller is readable on purpose

Anyone can see that a controller exists and read its state. Two measures keep it from grouping wallets or pointing at coins: the recoverer uses a different key for every wallet, and the owner's controller key is used for nothing else and never appears in an address. They do not hide what the timing and the funding of transactions can show.

### 16.3 What ties a coin to the identity

| Event | What becomes linked, in public |
| --- | --- |
| Creating the wallet | The coins the wallet was funded with, and the first addresses they move to (section 7.9) |
| Any controller transaction that a wallet coin pays for (cancel, change of settings) | That coin and its change |
| The recoverer's request and completion | The recoverer's fee coins. If they came from an allowance, they lead back to the coin of the wallet that paid it. |
| Sending everything, when a coin in it needs the controller | Every coin in that transaction, and the address it pays |
| Closing | Every coin in the closing transaction, and the address it pays |
| A sweep | Every address swept, and the new addresses the coins go to |
| Spending from a vault address | That vault address |

Nothing else the wallet does shows the identity. A link, once made, spreads in the ordinary way: a coin that is tied to the identity ties to it whatever it is later spent together with.

### 16.4 What a recovery reveals

A sweep has the controller as its first input and shows the identity in every swept input. Everything the wallet held at that moment is tied together. Coins received afterwards at new addresses are not, until they are spent together with coins that are. A token whose history is public, such as a loan key, links its position before and after the sweep.

Limiting this would take several controllers, each covering part of the addresses, at the price of enrolling and watching each. Hiding it fully would need a way to prove the link without showing it, which this project has not found for Bitcoin Cash and does not claim. Neither is part of this design. A later version of the wallet's scripts could add either without changing applications, because applications are never sent the identity or the controller and deal only with tokens, and because an address shows nothing about how its tag was made. Coins stay under the rules of the address they are at.

### 16.5 What the recoverer sees

The recoverer can read the wallet. That is a consequence of asking it to hold what a new device needs. A later option is to seal the viewing key under a phrase the user remembers, so that the recoverer keeps it without being able to read it; this trades the recoverer's view for something the user must not forget, and is not part of this proposal.

## 17. User experience and background operation

**Owner.** "Set up recovery", "Recovery is on" (only after the recoverer confirmed), "Someone asked to move your wallet", "Cancel". **Recoverer.** The enrolled wallet, the proposed new owner with its fingerprint, the state of the request, the end of the wait as the chain gives it, "Complete". Template identifiers, invitations, roles and inputs are not routine user tasks; they stay available for developers and for troubleshooting.

**Watching.** The wallet reads its controller's whole history again from several servers at each check and works the status out from nothing, so a reorganization or a replaced transaction is followed without bookkeeping, and one server leaving a request out does not hide it. (`packages/app/src/monitor.ts`.)

**How much the device knows.** A transaction's identifier proves its content. It does not prove that the transaction is confirmed, that its outputs are unspent, or that a server has told everything. A request that is seen, confirmed or not, is reason to warn at once. The end of a waiting period is worked out from confirmed blocks, never from the device's clock or from a countdown that a server supplies. Confirmation itself is taken from the servers the device is set up with, unless the device checks block headers. In this project's deployment those servers include the user's own node. The engine's header check does not work on chipnet at present (section 13.1), and a phone that verifies headers by itself is later work. Until then the wallet does not describe chain state as verified, and it reports disagreement between servers as disagreement.

| Status | Meaning | The wallet |
| --- | --- | --- |
| Quiet | Nothing is asked | — |
| Request to a key this device does not hold | Someone wants the wallet | Warns; cancels, by hand or automatically |
| Request to a key this device holds | Its own takeover | Waits |
| Owned by a key this device does not hold | A recovery or a change of owner has happened | Stops giving out addresses and says so |

**Cancelling costs a transaction.** Because ordinary use does not cancel, the device must be able to send one: it keeps a small coin for the fee (section 8). If that coin is missing, the wallet says that it cannot cancel and asks for the coin to be restored; it does not go on showing full protection. A phone that is switched on is not thereby watching the chain; background scheduling and notifications on phones need their own validation before any claim of protection is made.

**Fees and emptying.** Before approval the wallet shows the fee of every transaction in satoshis, with any remainder that is too small to return. "Send everything" shows the amount that will arrive, and the three figures when it cannot be done (section 8). Closing a wallet is not in the interface.

**A recovery while the old device still works.** If the user simply has a new phone, the old one moves the wallet with `ownerUpdate` and no waiting, in the order of section 9.7. If a request arrives and the old device is watching, it cancels; the software must not switch that off because a message says the recovery is wanted.

**When the wallet finds itself owned elsewhere,** it stops giving out addresses and taking on application actions, as soon as the network shows the change. Until a block holds the change, on more than one server, this is a pause: a completion can still lose to the owner's cancellation, and a change can be replaced by a holder of the owner's key. If it disappears, the wallet carries on by itself. Once a block holds it, the device has stopped for good, and resumes only if the chain names its key again. If the owner did not want the change, the device's keys still spend every coin not yet swept, and the wallet offers to move them out at once, to a wallet with a new identity, on the user's approval. This is a race against the new owner's sweep. Coins at vault addresses, and coins already swept, cannot be moved this way.

**Repeated requests** cost the owner a fee each and cannot take anything. The owner replaces the recoverer.

**What still waits for a block.** Everything that can go on before a block does: creating the wallet and giving out its addresses (section 7.9), enrolling the recoverer and showing recovery as on (section 9.5), a move to a new seed and a new recoverer (section 9.7), the hand-over after a completion and the new device's sweep (section 11.1), the backup of section 18.1. A transaction that disappears later takes with it what was built on it; the wallet follows the chain at every check, and coins at a device's addresses stay that device's by key. What waits, and why:

| What waits | Why it cannot go on before a block |
| --- | --- |
| The count of a recovery's waiting period starts with the block that holds the request | A relative time lock enforced by the network measures the age of an output, and an output not in a block has none. The period is the owner's whole protection, so it is measured by the chain and not by a clock anyone claims (section 5.4). The request itself is shown, and can be refused, at once. |
| A device stops for good only when a block holds another owner | Until then a completion can lose to the owner's cancellation. Retiring the owner's own phone on a transaction that then disappears would lock the owner out of the wallet. The device pauses at once and gives out nothing meanwhile, so nobody waits for this. |
| A vault address is given out once nobody but the wallet could undo its creation | It has no key: if the identity disappeared, a payment to it could never be spent (section 7.9). With first coins already in a block it does not wait. |
| Time locks of applications | They belong to the applications' contracts (section 15), not to the wallet. |

Where the wallet shows whether something is in a block, as for a request it warns about, that is information and decides nothing.

**After a recovery, people who pay the wallet need a new address,** or should have been given a vault address. The wallet keeps watching earlier addresses and sweeps what arrives, but until it does, the earlier seed can spend it too.

## 18. Local backup, being one's own recoverer, versions

### 18.1 A backup the user keeps

The design does not need one and supports one.

- **What to keep for the current seed:** the twelve words and the wallet's identity (64 hexadecimal characters), with the network and the version of the address scheme noted beside them. A device with these is the same owner. It recomputes every key and address of that seed, finds its coins by searching, and needs no controller transaction and no waiting period. Nothing more is needed, because the search ranges belong to the scheme and not to the wallet.
- **What that leaves out:** addresses of earlier seeds. If the wallet has been recovered or moved to a new seed before, payments that still arrive at earlier addresses, and the earlier seeds' vault addresses, are found only with the earlier viewing keys. A complete backup adds the viewing-key record of every earlier seed. A device that is given only the words and the identity says that earlier addresses are not covered.
- **Worth adding:** the transaction that created the identity, and the backup stores with their content key, so that templates and labels come back too. Without them the coins are still restored; templates can be had again from the applications.
- **It is not a standard wallet backup.** The words alone restore nothing in another wallet, and nothing here without the identity.
- **It goes stale at a recovery or a change of owner,** because the wallet then has a new seed, and when a creation that disappeared made the wallet again with a new identity (section 7.9). It must be made again. An old backup cannot undo the change: its keys spend only what is still unswept at its own addresses.
- **Whoever holds it has the wallet at once.** The waiting period guards against the recoverer, not against someone holding the words.
- **A copy of the viewing keys alone** restores nothing. It is useful as a second copy of what the recoverer holds, and as a way to watch the wallet without being able to spend.

### 18.2 Being one's own recoverer

The recoverer's role is a key and the kit. Nothing requires a business. A second device of the user's, or a family member's phone, can hold the kit. A wallet has one recoverer at a time; several recoverers or a threshold among them would be a later version of the controller rules.

### 18.3 Versions

| Layer | What changes with it |
| --- | --- |
| Controller rules (state version byte) | Who can start a recovery, the wait, completion |
| Owner-approval rule | How an address recognises the owner's approval |
| Address scripts and derivation | How addresses, secrets and tags are made |
| Controller template; the two address templates | Every key under them (section 7.2). A change to one is a new version of the controller rules or of the address scheme. |
| Recovery kit | Fields, sealing |
| Backup records | Formats |
| Application profile (`recoverable-app-v1`) | The three rules and the recovery declaration |
| Connection (`xo_v1`) | Messages and what the wallet announces |
| XO template | Exact scripts and actions, identified by content |

An unknown version is refused, never guessed at.

An identity is bound to its controller script from its creation, and every address is bound to its identity. New controller rules therefore mean a new identity, with an enrollment of its own. A wallet moves to it by ordinary payments from its old addresses to addresses of the new identity. Application tokens move the same way, and vault coins are first released by the old controller. The two controllers cannot be in one transaction, since each must be input 0.

The old identity does not end with the move. A vault address that was published, or a payout address stored in a contract, goes on being paid, and only the old controller releases what arrives there. The wallet keeps the old identity's controller, viewing keys, recoverer and watching for as long as something can still arrive, and a change of owner or of recoverer is made on both identities. An identity is not retired because its balance is zero. Closing it (section 5.8) ends it for good and makes its vault addresses unspendable, so an old identity is closed only when nothing can arrive there any more.

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
| Recoverer kept the first enrollment message and not a later seed's viewing key | Coins at the later seed's addresses cannot be found or swept by a new owner |
| The owner changes keys without the recoverer's receipt | Possible on chain. The wallet shows recovery as off until the recoverer confirms. |
| A range of addresses is used up | The wallet uses addresses again, or the owner moves to a new seed. Spending is not affected. |
| The owner's coin for cancelling is gone | The wallet says that it cannot cancel until the coin is restored |
| The recoverer has no coins for fees | It cannot send a request. Its software says so beforehand, and anyone can send coins to its fee address. |
| A wallet holds less than the smallest output plus the fee | It cannot be emptied. The wallet shows the total, the fee and the smallest output. |
| The owner's key closes the wallet | The identity ends. Vault addresses are unspendable for good, coins at an earlier seed's addresses obey only that seed, and there is no recovery. Neither the recoverer's key nor an earlier owner's key can do this. |
| Backup store is compromised or withholds | Nothing readable, nothing spendable. Templates and labels may be missing; coins and tokens are not affected. |
| A record is forged by someone who knows the content key | Refused: it is not signed by an owner's key |
| The holder of an earlier seed signs a new record | Genuine as to who signed it; it says nothing of when. It replaces no viewing-key record that a receipt names and makes no template trusted. |
| A store hands back an older set of records | Noticed where the device or the recoverer holds a newer receipt; otherwise the device says that the backup may be out of date |
| An application asks for a transaction that takes more than it says | The wallet's own figures show what the transaction moves. The application cannot change them. |
| An application's site disappears | A position that follows the rules stays operable from its token and template |
| An application liquidates or closes a position | The token then leads to nothing. Recovery restores remaining rights only. |
| A server hides a request | Read from several servers; hidden only if all leave it out |
| A server reports a confirmation that did not happen | Believed, unless another server disagrees or the device checks headers. The deployment of this project includes the user's own node. |
| A token imitates an identity | The category differs, so the rule refuses it. An identity whose creation was not valid is refused by the client. |
| A transaction that prepares or creates the wallet is replaced, or its block undone, after addresses were given out | No coin is lost: coins at those addresses are spent by their keys. The wallet says so, keeps watching the addresses, makes a new identity, moves the coins over by key, and asks for the recoverer to be set up again. Payments made from the first coins are undone with them. |
| A vault address of an identity that disappears is paid | Lost for good: a vault address has no key. It is why vault addresses are given out only once nobody but the wallet could undo the creation. |
| A change of owner or of recoverer disappears before a block holds it | Only a holder of the owner's key can replace it. What was built on it disappears too; the old device owns the wallet again and makes the change again; the new device pauses and keeps what was paid to its own addresses. |
| A completion loses to the owner's cancellation after the hand-over | The new device has seen the earlier viewing keys, which the recoverer meant it to see, and owns nothing; it pauses. The recoverer puts its kit back as it was and can ask again. |

**Costs of the design, in one place**

1. An earlier seed works until the sweep.
2. A payment to an earlier address can be taken by the earlier seed until it is swept.
3. The recoverer can read the wallet.
4. The viewing key of every seed is needed to recover, and the recoverer has to keep each one.
5. A recovery is public: the sweep ties together what the wallet held.
6. A request is not cancelled by ordinary use. The device has to notice it and cancel.
7. Transactions are larger than with P2PKH: 296 bytes for an input spent by its key against 141.
8. The wallet's first coins can be traced to the creation of its identity.
9. Applications have to be reached through a template; front ends that build transactions from the wallet's public keys cannot serve it.
10. A complete search looks up every address of fixed ranges, for every seed the wallet has had, and a seed has a fixed number of fresh addresses.
11. An address that outlives its controller's rules keeps the old identity in service.
12. The closing action makes every controller transaction 45 bytes larger, and closing turns the identity's vault addresses into addresses nobody can spend from.
13. The templates that hold keys can never change. A change means other keys: a new seed's worth of addresses, or a new identity. A template names the network versions it supports, and one made today cannot name next year's; whether the engine goes on running it then is for XO to say.

## 20. Implementation approach and status

The implementation uses XO's TypeScript packages, libauth for keys, transactions and script evaluation, and CashScript for writing contracts. Compiled bytecode is carried into XO templates; a test keeps the two equal. The versions pinned are those of the XO web development tool, so that invitations made here load in it (decision D3).

| Item | Status |
| --- | --- |
| Recovery controller | Implemented with its five actions; tested in the virtual machine (CT01 to CT15). All five ran on a local node and on chipnet: a request, a cancellation, a completion after the waiting period, and a closing (`docs/runs/`). |
| Fees and sending everything | Implemented: the exact fee, the smallest value of each output, the check before sending, choosing coins, sending everything, and closing by the owner's wallet (FE01 to FE08). |
| Owner-approval rule | Implemented (`contracts/lib/authorization.cash`); both address contracts use it, and it is tested through them (AD01 to AD13) |
| Reading and checking a controller's history; several servers read as one | Implemented and tested |
| Waiting-period calculation; watching for requests | Implemented and tested |
| Sealing to the recoverer; signing; encrypted stores and the store server | Implemented and tested |
| WizardConnect transport and `xo_v1` messages | Implemented in the form of section 14 (`packages/connect`): the announcement without templates, the request that names its template and sends the texts when the wallet asks for them, the per-application record that carries a request out at most once, positions answered only for a template trusted with that application, and a reasoned refusal of a standard signing request (AP04, AP11 to AP14). |
| Recoverable address, vault address | Implemented (`contracts/recoverableAddress.cash`, `contracts/vaultAddress.cash`); tested in the virtual machine (AD01 to AD13), with each refusal shown to come from the script meant to refuse. A wallet's life ran on a local node and on chipnet: receiving, a payment by key, a sweep by a new owner, a spend from the vault, and the refusals of a sweep attached to a request and of a sweep approved by an earlier owner (`docs/runs/stage-1-chipnet.md`). |
| Derivation, viewing key, giving out and finding addresses | Implemented and tested (KV01 to KV05, KV07 to KV12, PV01, PV02), with test vectors in `test/vectors/`. The wallet's own derivation gives the keys the engine makes. The cost of the full pass is recorded for a local node and a chipnet server (KV13, `docs/results/kv13-full-pass.md`). |
| Creating a wallet as in section 7.9 | Implemented (`packages/app/src/owner-wallet.ts`): in steps a device can resume (CR01 to CR04). Since 18 November 2026 no step waits for a block, and a creation that disappears is handled as section 7.9 says: tested on the simulated chain, which now makes blocks on demand and drops transactions; not yet run on the engine, the local node or chipnet. Ran on the XO engine against a local node and on chipnet. |
| Recovery kit, receipts, takeover and update messages, sweep, moving to a new seed, replacing the recoverer | Implemented and tested on the simulated chain (RC01 to RC11, SW01, SW03 to SW08, MG01 to MG08, KV06, FE09, PV03): the kit and the enrollment link, receipts and prepared receipts, the recoverer's fee address, the takeover message and the hand-over, both passes and the sweep, the move to a new seed and the replacement of the recoverer with every step stopped and repeated, and the backup of section 18.1 (`packages/enrollment`, `packages/app/src/recovery-flow.ts`, `packages/app/src/user-backup.ts`). The whole course ran through the XO engine on a local node and on chipnet: a wallet created and used, recovered to a new device after the waiting period, swept with a vault coin and an NFT, used again and closed, with every coin returned (SW02, `docs/runs/stage-5-chipnet.md`). |
| The wallet page and the recoverer page | Implemented (`apps/wallet`, `apps/recoverer`), for a phone and for a desktop: creating a wallet in steps that survive a reload, what the wallet holds and whether it is protected, fresh and vault addresses, the fee before sending and sending everything, the coin for cancelling, the alarm and the refusal, the takeover on a new phone, the move to a new phone, replacing the recoverer, the waiting period, the user's own backup, and the wallet owned elsewhere; on the recoverer's side the link, kits, takeover requests, each wallet's standing and fee coins, the request, the completion and the hand-over. What the wallet says about its protection is tested (OP02). A scripted course drives both pages in real browsers, one profile for each device, and passed on a local node and on chipnet with the public pages (`docs/runs/stage-6-local-node.md`, `docs/runs/stage-6-chipnet.md`). The public sites were switched to this design, and the way back was tried (OP03, `docs/runs/stage-6-switch.md`). A walkthrough to follow by hand, with what the demonstration does not show, is in `docs/walkthrough.md`. The pages watch the wallet only while they are open, and they do not offer closing a wallet. |
| Backup records as in section 10 | Implemented and tested with stores in memory (BK01 to BK03, BK07 to BK09): signed records sealed on several stores, the rules for records of an earlier seed, what a reader says when it cannot rely on what it was given, and the copy into a new archive after a change of seed (`packages/archive`). The records that applications bring are stored and confirmed by a store before the first action of a template; a note of a token is a hint that is checked against the chain, and a template an earlier owner stored is offered and not trusted (BK04 to BK06, BK10). |
| The wallet's templates | Implemented (`packages/app/src/templates.ts`) and accepted by the XO validator. The controller template and the two address templates are final; a test fixes their identifiers. Every action ran through the unmodified engine on a local node, with the engine's keys and addresses equal to the ones this project's code derives and every transaction of the size worked out beforehand (`docs/runs/stage-3-local-node.md`). The same actions ran on chipnet, where the engine needed a local fix for its header check and was given one server (`docs/runs/stage-5-chipnet.md`). Loading the run's invitations in XO's debugging tool is still to be tried. |
| Application templates with wallet-bound outputs; recovery declaration | Implemented (`packages/app/src/applications.ts` and the files beside it) and tested on the simulated chain with two templates made for the tests, one with its position at an address of its own and one found through a companion coin (AP01 to AP09, AP11 to AP15): an action of an application's template is carried out with the wallet's coins and addresses, the wallet works the transaction out itself and shows its own figures, the statement about a template is one of the three of section 14.3, and positions are found from tokens and the chain. No code of the wallet or the recoverer names an application (AP07). Both templates ran through the unmodified engine on a local node (`docs/runs/stage-7-local-node.md`). The wallet page has a screen for connections, requests and tokens. The declaration is a companion document of this project's own form. |
| Savings Jar with a key NFT | Implemented: the contract (`contracts/savingsJar.cash`), the template with its recovery declaration (`packages/savings-jar`), and the application page (`apps/jar`) for this wallet and for ordinary wallets (SJ01 to SJ06, AP10). With this wallet on the XO engine, a jar was opened, the device lost, the wallet recovered, and the jar found from the swept key and the template and emptied, then paid into again and emptied again, on a local node and on chipnet (`docs/runs/stage-8-local-node.md`, `docs/runs/stage-8-chipnet.md`). The same course ran in real browsers with the wallet page, the recoverer page and the jar page, the new phone making no request to the jar page before it emptied the jar (`docs/runs/stage-8-browser-local-node.md`), and on chipnet with the public pages (`docs/runs/stage-8-browser-chipnet.md`; that run was continued twice from its profiles on disk, and its list of requests covers the continued part). The unmodified Cashonize web wallet opened and emptied a jar with the same page and contract on chipnet (`docs/runs/stage-8-cashonize-chipnet.md`). |
| ParyonUSD template and front end | A loan was opened, managed and closed on Paryon's chipnet deployment from recoverable addresses, first with transactions built by this project's code from the published contracts (PY01, PY04; `docs/runs/stage-9-loan-chipnet.md`), then through the wallet from a template, and through the loss of the device: the new device found the loan and closed it (PY02 and PY03 at the level of the library; `packages/paryon`, `docs/runs/stage-9-template-chipnet.md`). A repayment that leaves the loan open is shown in the virtual machine and on the simulated chain only. The page is being built. |

Licences: the XO engine and utilities declare MIT. The XO web development tool has no licence statement and is used as a tool only. WizardConnect declares LGPL-3.0-or-later. Paryon's contracts repository states no licence.

The stages of work, what each builds, which existing files it starts from and which of the tests below close it are in [IMPLEMENTATION_PLAN_v0.4.md](IMPLEMENTATION_PLAN_v0.4.md). The bounty also asks for developer feedback written personally; this document is not a substitute.

## 21. Acceptance tests

These are tests an implementation must pass. Except where the status table above says otherwise, they are not results already obtained. The implementation plan names the stage that closes each one. A test is closed by a recorded result, not by its place in this table.

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
| CT11 | A request names the key that is already the owner; a sweep is attached to the request, then to its completion | Refused both times: the completion raises the epoch even when the key is the same |
| CT12 | The highest epoch; a state of the wrong length; a field out of range | The counter fails and does not start again; malformed states are refused |
| CT13 | The owner closes, from Active and from Pending, in a transaction with one output that carries no token | Accepted; no token of the identity exists afterwards; the controller's value is part of the output |
| CT14 | A closing signed by the recoverer, by another key or by an earlier owner's key; with two outputs; with an output that carries a token | Refused |
| CT15 | A sweep or a vault spend in a closing transaction; after closing, a vault coin, a swept coin and a coin spent by its key | Refused; the first two can no longer be moved; the third is accepted |
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
| AD10 | BCH, fungible tokens and NFTs of each capability, held and moved by both paths | Category, amount, capability and commitment preserved; the wallet's choice of a fee coin never consumes or alters a token |
| AD11 | Sizes of both scripts and of each kind of input | Measured and recorded |
| AD12 | A sweep beside an `ownerUpdate` that changes nothing; beside one that changes the owner, the recoverer or the waiting period | Accepted; refused |
| AD13 | Inputs spent by key, swept inputs and a vault coin in one transaction, with tokens, under both signing types | Accepted; an input or output added afterwards makes it invalid |
| **Creating a wallet** | | |
| CR01 | The funding coin is output 0 of its transaction; it is another output | No self-payment in the first case, one in the second; the identity is the right transaction's identifier in both |
| CR02 | Every step without a block; the preparing or creating transaction is replaced or reorganized away after addresses were given out and paid; the device stops between steps | Addresses are given out and recovery can be on before any block, vault addresses only once nobody but the wallet could undo the creation. After the replacement no coin is lost: the wallet makes a new identity, collects the coins by key, keeps watching the earlier addresses, and says recovery must be set up again. The device continues from the transactions that exist and makes no second identity while the first exists. |
| CR03 | The creating transaction and what follows it | A valid identity (section 5.7); every satoshi accounted for; the owner's coin for cancelling set aside; an allowance at the recoverer's fee address when the user gave one, and none otherwise |
| CR04 | A wallet that the recoverer has not yet confirmed; a later payment to the funding address | Recovery is shown as off; the payment is shown with a warning that it is not recoverable |
| **Keys, viewing key, addresses** | | |
| KV01 | Quick pass from identity and viewing key, for a wallet with used addresses, gaps within the window, emptied addresses and a vault coin | Every coin, token and NFT is found, with its secret |
| KV02 | Search with another wallet's viewing key, or the right one and another identity | Nothing is found |
| KV03 | Sign or sweep with the viewing key alone | Not possible |
| KV04 | Either half of the viewing key without the other | No ordinary address can be derived. The blinding seed with the identity gives the vault addresses. Neither spends. |
| KV05 | Test vectors: words, indices, expected keys, secrets, tags, addresses | Reproduced exactly |
| KV06 | The twelve words and the identity on another device; the same for a wallet that has had earlier seeds | The same wallet, with no controller transaction. In the second case earlier addresses are found when the earlier viewing-key records are supplied, and the device says that they are not covered when they are not. |
| KV07 | An extended public key of the viewing key together with one address private key of its kind | Every address key of that kind follows. The keys of the other kind and the controller key do not; the paths are as specified, and the wallet's own derivation gives the engine's public keys. |
| KV08 | The windows: a 21st unused address to give out, a 6th unused change address, a 6th unused vault address; two requests at once | Not given: an earlier address is offered, or the wallet waits. No number is given twice or past a limit. |
| KV09 | An action abandoned before its address was shown; after it was shown; after a signature left the wallet | The number is used again only in the first case; in the others the address stays watched |
| KV10 | A payment to an address beyond the window, given out after a transaction that was later reorganized away | Missed by the quick pass and found by the full pass; the wallet is not reported as fully found before the full pass ends |
| KV11 | A range is used up; a restore on a device with no record of what was given out | No number at or above the size of the range; using an address again, or a move to a new seed, is offered; spending still works; the restore finds everything |
| KV12 | A viewing key is missing, two records conflict, a pass is interrupted, or a server does not answer | "Incomplete", with the reason, never an empty wallet; the pass continues where it stopped |
| KV13 | The full pass for a wallet with several seeds, at the chosen sizes | Time and load on the servers measured and recorded |
| **Recoverer** | | |
| RC01 | Someone records the link or QR code of an enrollment message; a message is altered in transit | Nothing readable; the altered message is refused; the whole link, as text, fits a QR code that a phone reads |
| RC02 | An enrollment message for another network, changed, not signed by the owner, for a wallet not on chain, or not matching the state | Refused by the recoverer |
| RC03 | Every path to spending or sweeping a coin of the wallet, tried with everything the recoverer holds, before and during a wait | All refused. After an uncancelled wait to a key of the recoverer's own, that key is the owner and can sweep: the stated limit of the trust model. |
| RC04 | A kit is sent and no receipt exists; a receipt for another message, without the recovery key, or not matching the controller's state | "Recovery is on" is not shown; the receipt does not count |
| RC05 | Two wallets with the same recoverer | No key hash in common on chain; neither fee address can be computed from a controller's state |
| RC06 | Three requests cancelled, then a fourth request and its completion: with an allowance, with coins the recoverer added itself, and with an empty fee address | The recoverer pays all five fees from its fee address at the stated rate in the first two cases; in the third its software says what is missing, beforehand, and goes on once coins arrive |
| RC07 | Order of handing over viewing keys in a recovery; a completion that disappears after the hand-over | The new device's record reaches the recoverer before the request, without the device knowing the identity; earlier ones reach the new device only after completion, as soon as the network shows it. If it disappears, the recoverer's kit is put back as it was and the takeover is saved again. |
| RC08 | A request to an unknown key, shown by only one of several servers; a request to the device's own key | Alarm; no alarm |
| RC09 | A request or cancellation is reorganized away or replaced | Status is rebuilt from the chain; a request that is seen unconfirmed warns and is not reported as confirmed |
| RC10 | A prepared receipt for another controller output, other settings, another recipient or another viewing-key record; a matching change that disappears | Does not count; recovery is shown as on as soon as the network shows a matching change, and off again if it disappears |
| RC11 | A kit with the viewing keys of several seeds, given to a new recoverer | Delivered by reference to sealed records; the recoverer confirms only after it has fetched and saved them |
| **A new seed without loss; a new recoverer** | | |
| MG01 | A move to a new seed by `ownerUpdate`, then a sweep; the change disappears before a block holds it | The recoverer's prepared receipt comes first; no waiting period and no block; afterwards the earlier seed can move nothing that was swept. If the change disappears, the old device owns the wallet again and makes the change again, the new device pauses and keeps what was paid to it, and no coin is lost. |
| MG02 | The new device is lost right after a move to a new seed, and right after a recovery completes | The recoverer already holds its viewing key and archive access; another recovery succeeds |
| MG03 | The recoverer is replaced while a request is pending | The request is cleared; the earlier recoverer's key can neither request nor complete |
| MG04 | The recoverer is replaced while it still holds coins for fees | What the old recoverer holds is not counted as available; the new one has a fee address of its own, with an allowance only if the user gives one |
| MG05 | The device sees that another key owns the wallet: not in a block; in a block and on more than one server; a completion that then loses to the owner's cancellation | It stops giving out addresses and taking on actions at once and offers to move unswept coins out; it offers nothing for vault coins. It stops for good only in the second case; in the third it carries on by itself. |
| MG06 | Two recoveries, then first payments to an ordinary and to a vault address of the first seed | Both are found with the first seed's viewing key and swept by the current owner; only the ordinary one could also have been spent by the first seed |
| MG07 | A move to a new identity while a vault address of the old one can still be paid | The old identity stays watched and recoverable; it is not shown as retired |
| MG08 | The device stops at each step of a move to a new seed and of a replacement of the recoverer | It continues from where it stopped; no address is given out of a seed whose viewing key the recoverer lacks; no viewing-key record is lost |
| **Sweep and new device** | | |
| SW01 | The owner's device is erased; a new device takes over, on a simulated chain | After the full pass the new device holds everything at its own addresses; the earlier seed can move nothing that was swept |
| SW02 | The same on chipnet, through the engine | As SW01, recorded with its transactions |
| SW03 | A sweep too large for one transaction, interrupted between parts | Completes; nothing lost or moved twice |
| SW04 | A wallet that holds only tokens | Swept; the fee has a source |
| SW05 | A payment to an earlier address after the recovery | Found and swept |
| SW06 | A sweep while a request is pending | The request is cancelled |
| SW07 | An NFT of an application the wallet has never seen | Swept; reported as a token of unknown meaning |
| SW08 | Records written after a recovery and after a move to a new seed | Not readable with the earlier content key |
| **Backup** | | |
| BK01 | A store, or someone who copies it, reads the records | Not possible |
| BK02 | One store fails or returns damaged data | The other copy works; damaged content is refused |
| BK03 | A record made by a holder of the content key who is not an owner | Refused |
| BK04 | A token whose template is missing | The token is still swept and is reported as incomplete, never left out |
| BK05 | A token note naming the wrong template | Refused by the rebuild check |
| BK06 | No store confirms before the first action of a new template | The action is refused by default |
| BK07 | After a recovery, the holder of an earlier seed signs a second viewing-key record for it, and a template record | The record that the receipt names stays in force and the conflict is reported; the template is not trusted on the new device |
| BK08 | A store hands back an older set that was once genuine | Noticed against the latest receipt, or reported as possibly out of date; never taken as current without notice |
| BK09 | The earlier archive is copied into a new one while a store cannot be reached, or the device stops | Nothing is removed before the copy is complete; the earlier kit stays usable |
| BK10 | A signature for the first action of a new template is asked for before a store has confirmed the template | Refused; a note of the action on the device does not count as a stored template |
| **Applications** | | |
| AP01 | An unknown template; a template, declaration or referred file that is not the one the request names by hash | Shown as not verified and trusted only on the user's word; refused |
| AP02 | A template worded to mislead | The wallet's own figures are unaffected |
| AP03 | A request is repeated, or the session reconnects; the same id with other content | Carried out once; refused |
| AP04 | An action that creates a token category | Works; the wallet supplies the defining coin |
| AP05 | Everything an application receives in a session | Never the identity, a viewing key or a list of the user's templates; only addresses of its own transactions |
| AP06 | A positions request for a template trusted in a session with this application; for one trusted with another application; for an untrusted one | Answered from the chain; refused until the user allows this application; refused, and the user is not asked |
| AP07 | Wallet and recoverer code searched for any application's name | None |
| AP08 | A template that breaks one of the three rules; one that the wallet cannot check | The user is told which rule; shown as not verified, never as verified |
| AP09 | An unknown profile or version | Refused explicitly |
| AP10 | The application's site is unavailable | A position stays operable from its token and template |
| AP11 | Each of the four kinds of wallet-bound output | `receive` and `change` take the next number of chain 1; `return` repeats the input's script and takes none; `lasting` gives a vault address |
| AP12 | A `return` that names an input that is not the wallet's, or one at an address of an earlier seed; an address that the application supplies for a wallet-bound output | Refused; the token is swept first; the supplied address is not used |
| AP13 | A standard `sign_transaction_request` | Refused with a reason |
| AP14 | A look-alike of a companion coin, made by the holder of a token; two candidates; a position that needs data the chain does not hold | Not taken for the position; reported as ambiguous; reported as incomplete |
| AP15 | A transaction of an application's template with inputs and outputs of the wallet, built by the route the trials settled on | Accepted by the network; the same code serves two unrelated templates; what the engine did not build is not called an invitation |
| **Savings Jar** | | |
| SJ01 | Withdraw with the key before the time; after the time without the key; with both | Refused; refused; accepted |
| SJ02 | Open, pay in, withdraw with this wallet on chipnet | Works |
| SJ03 | The same with Cashonize and the same contract | Works |
| SJ04 | The device is lost with a jar open; recovery; the application's site not consulted | The new device finds the jar from the swept key and empties it |
| SJ05 | A third party tries to empty a jar or alter a withdrawal | Refused |
| SJ06 | Withdraw, then someone pays into the jar again | The key is still in the wallet and the new deposit can be withdrawn; the wallet refuses a withdrawal that would not return the key |
| **ParyonUSD** | | |
| PY01 | A loan opened, managed and closed from recoverable addresses by plain script | Accepted by Paryon's contracts on chipnet |
| PY02 | The same from an XO template through the wallet and a front end of this project | Works |
| PY03 | The device is lost with a loan open | The new device sweeps the loan key, finds the loan, and repays or closes it |
| PY04 | Managing with and without a repayment; closing; change outputs | Accepted in the layouts of section 15.2; the repaid PUSD and, on closing, the loan's NFT are burned as the contract requires |
| **Fees and emptying** | | |
| FE01 | A payment by key with and without change, a payment of tokens, and each controller action, built at the stated rate | The fee is the signed size times the rate, exactly; the size worked out before signing is the signed size |
| FE02 | An output of each kind (P2PKH, an address of the wallet, with a fungible token, with an NFT, the controller) at its smallest value and one satoshi below | The smallest value follows from each output's own size; the wallet builds no output below it; the network's relay rules accept the first and refuse the second |
| FE03 | A transaction whose fee is above the required one by more than a remainder too small to return; a transaction with several hundred inputs | The first is not sent; the second is built, and no limit in satoshis stands in its way |
| FE04 | A payment for which some choice of coins needs no change | Made without a change output |
| FE05 | What is left after the fee is below the smallest change output | The wallet takes the cheaper of leaving it to the fee and adding a coin, and shows the amount; nothing goes to the fee unseen |
| FE06 | Sending everything from a wallet with coins at ordinary addresses and at a vault address, coins with tokens, and more coins than one transaction holds | No coin without a token is left besides the controller; what arrives is the total less the exact fees; coins with tokens are untouched; the wallet says that it cannot cancel |
| FE07 | Sending everything when the total less the fee is below the smallest value of the destination output | Nothing is sent; the total, the fee and the smallest output are shown |
| FE08 | Closing after everything else was sent; closing tried while a vault coin or a token is held, or before the full pass has finished | The address paid receives every satoshi, the controller's included, less the exact fee, and nothing of the identity is left on chain; the tool refuses in the other cases |
| FE09 | Sending everything after a recovery, with coins at earlier addresses not yet swept | They are included, through the controller |
| **Privacy** | | |
| PV01 | Everything on chain for a wallet that has not been swept | No value shared between its addresses, or between an address and the identity; a spend by key shows the kind of address and nothing of the wallet |
| PV02 | After a sweep of some addresses | The secrets of the others cannot be computed from what was shown |
| PV03 | The links made by creating a wallet, by a cancellation, by a sweep, and by a later payment that spends swept and new coins together | As section 16.3 lists them; recorded |
| **Operation** | | |
| OP01 | The engine's header check fails; two servers disagree about a confirmation | The wallet does not call chain state verified; the disagreement is reported and nothing is treated as final |
| OP02 | The coin for cancelling is spent or missing; the device was not running for part of a wait | The wallet says that it cannot cancel, or could not watch; it does not show full protection |
| OP03 | The public sites are switched to this design and switched back | Services installed from the intended checkout; the running version, the stores' data and the public walkthrough checked; the way back tried |

The decisive demonstration:

> Create a wallet and open a savings jar and a loan. Erase the device. On a new device, with the recoverer: request, wait, complete, sweep. Find the jar and the loan from their tokens, with the applications' sites unavailable, and operate both.

A second demonstration must show that during the wait the recoverer can do none of this, and that after the sweep the earlier seed can do none of it either.

## 22. Decisions to resolve

Each has a proposed answer, which implementation follows unless the owner says otherwise. The implementation plan gives the stage by which each is needed. The numbers are this section's own; `D1` to `D15` in `docs/decisions.md` are decisions already taken.

| No. | Decision | Proposed |
| --- | --- | --- |
| 1 | **Derivation.** The key tree; the number `B` for the blinding seed; the encoding of the viewing-key record | Settled: the XO engine's tree, with templates that do not change (sections 7.2 and 9.2); `B` as in section 7.2; the record as canonical JSON signed by the controller key, with a one-line text form (`packages/archive/src/viewing-key.ts`). |
| 2 | **Address chains and ranges.** Two kinds of ordinary address and one of vault address; the windows; the sizes `N0`, `N1`, `N2`; how often the full pass is repeated | Windows of 20, 5 and 5; `N0` = 10,000, `N1` = 10,000, `N2` = 1,000; the full pass once a week and after the events of section 7.7 |
| 3 | **Who makes the recoverer's key** | The owner's device |
| 4 | **The viewing key's written form** | The two extended public keys and the blinding seed in one signed record |
| 5 | **Readable controller state** | Settled by the controller that exists: readable, with a recoverer key per wallet. Open again only with new controller rules. |
| 6 | **The waiting period for real use,** the margin for cancelling, and whether cancelling is automatic by default | Time only; the length and the default are open |
| 7 | **Fees.** The rate; the owner's coin for cancelling; whether the owner gives the recoverer an allowance, and how much | One satoshi per byte; one cancellation; an allowance offered and not required, for four requests and one completion; amounts from measured sizes |
| 8 | **Messages with the recoverer:** enrollment, takeover, update, hand-over and receipts, and how the recoverer establishes who the user is | As in sections 9 and 11; the last is the recoverer's own process |
| 9 | **Backup:** record formats; whether refusing an action without a stored template stays the default; no commitment on chain | Refusing stays the default |
| 10 | **Template extension:** the names and kinds of wallet-bound outputs, the recovery declaration with its check of a companion, and whether they enter XO's schema or stay a companion document | The four kinds of section 13.3; the rest is for XO to say |
| 11 | **`xo_v1`:** a WizardConnect extension or a protocol of XO's | This project's extension until XO and WizardConnect say |
| 12 | **Division of work between the engine and the wallet's own code** | Settled: section 13.2 |
| 13 | **Sweep policy:** order, size of parts, how outputs are grouped | Most valuable first, unknown tokens counted as valuable |
| 14 | **Local backup:** whether the wallet offers it, and in what form | Offered as the user's choice, in the form of section 18.1 |
| 15 | **Upgrade policy** for controller rules, and how long an old identity is kept | A new identity; the old one kept while something can still arrive |
| 16 | **Watching and confidence in the chain:** monitoring on phones; checking headers; the user's own node | The user's own node among the servers; no claim of verified chain state or of protection on phones before each is shown |
| 17 | **ParyonUSD:** telling the team; the missing licence | Decided by the owner: the team is not asked. The contracts are public and are used unchanged, as a dependency, in the way they are meant to be used |
| 18 | **When the public demonstration switches** to this design | After the scripted run passes on the public addresses |
| 19 | **Closing a wallet:** whether a released wallet keeps the action in the controller, keeps it out of the interface, or offers it | In every controller; used by the test runs and a tool; not offered in the interface |

The first engineering checkpoint is the two address contracts passing AD01–AD13, because those tests establish that the recoverer's key never gains spending power and state the cost of the earlier seed exactly.

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
- **S19 — BIP44:** address discovery with a gap limit. https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
- **This repository:** `docs/decisions.md` (D1–D15), `docs/xo-spike.md`, `docs/xo-engine-signing-bug.md`, `docs/xo-chipnet-header-verification.md`.
