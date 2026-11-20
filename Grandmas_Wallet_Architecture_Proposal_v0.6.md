# Grandma's Wallet

**Architecture proposal v0.6 — BCH Blaze 2026**
**Date:** 20 November 2026
**Status:** Design proposal for the third design of the wallet (design 3). It starts from the second design, which is built and has run on chipnet: the controller, the two kinds of address, the keys and the viewing key, the recoverer and its kit, the sweep, the backup stores, the pages, and two applications used from their XO templates. That design is at the tag `design-2`, and section 20 gives the status of each of its parts. What this version changes is proposed and not yet implemented: the recovery declaration is retired, so that an application needs nothing but its XO template; the wallet keeps a record of each application position in its backup; actions are judged by what they leave behind; and the chain decides whether a record counts. Nothing has been audited.

This document is the reference for implementation. It replaces [version 0.4](Grandmas_Wallet_Architecture_Proposal_v0.4.md), which stays in the repository as the proposal of design 2. There was no proposal with the number 0.5: [docs/design_v0.5.html](docs/design_v0.5.html), an illustrated overview, carries it and describes design 2 as built, without the changes of this version. The order of work and the exit criteria of each stage are in [IMPLEMENTATION_PLAN_v0.6.md](IMPLEMENTATION_PLAN_v0.6.md).

"Required" and "must" describe a property the implementation has to achieve; they do not say the property has been demonstrated. Names of fields, messages, profiles and derivation paths are proposals until a formal schema is agreed; section 22 lists the ones that still need a decision.

## What changed since version 0.4

Design 2 works with an application when two things come with it: an XO template, and a second document of this project's own form, the recovery declaration. The declaration tells the wallet how to take part in the template's actions and how to find a position again from the chain. That asks something of other people: of an application's author, to write for this wallet, and of a contract, to keep its values on chain. An application whose author did neither cannot be used.

XO's authors, asked on 20 November 2026 how a position should come back on another device, answered that state has to be carried from one device to the next, and that reading it back from the chain works against what XO is for (section 13.6). This version follows that. Its aim, set by the owner on 20 November 2026:

> The wallet works with an application from its XO template alone, and the user can replace the seed without losing what they hold in that application. Where something will not come back, the wallet knows it beforehand.

| Change | Where |
| --- | --- |
| **Three things carry everything:** the template as its author wrote it for XO, the request from whoever starts an action, and a record the wallet writes for itself. | Section 13.3 |
| **The recovery declaration is retired.** No document is written for this wallet, and none is read. | Sections 13.3 and 22 |
| **Position records.** Before an action is signed, the wallet stores in its backup which token a position belongs to and the values it was made with. A new device reads the records and follows the scripts again. | Sections 10.1 to 10.6, 11.1 |
| **The chain is the check.** A record counts when the chain ties it to a token the wallet holds. One that the chain does not confirm is shown as such, and the wallet pays nothing into what it names. | Section 10.4 |
| **A store has to confirm before signing** every action that leaves a position, since the record is the wallet's only way back to it. | Section 10.5 |
| **Actions are judged one by one,** by what each leaves behind. The wallet works out whether that comes back after a recovery, does not, or cannot be told. | Section 12.3 |
| **What the wallet does about it is left to whoever builds the wallet:** refuse, warn, or a workaround. This wallet refuses. | Section 12.5 |
| **The wallet acts by itself only where nothing is missing.** An action that needs something only the application knows is carried out through the application. | Sections 13.3 and 17 |
| **The applications' pages carry what the declarations did.** The loan page names Paryon's coins and reads their values. A page is replaceable: anyone can serve it. | Section 15.3 |
| **What a recoverer has to do** is written down as three duties, so that another implementation can take the place of this project's page. It needs no knowledge of any application. | Section 9.8 |
| **Nothing is required of XO.** What would help is listed. | Section 13.6 |

The controller, the addresses, the keys, the viewing key, the kit, the sweep and the messages with the recoverer are those of version 0.4. An idea noted on 18 November 2026, a viewing secret of twelve words with a log on chain in place of the kit, a token as the recoverer's authority, and a recoverer who uses an ordinary wallet ([docs/idea-viewing-secret-and-chain-log.md](docs/idea-viewing-secret-and-chain-log.md)), is not part of this version (section 22).

What this version gives up, against version 0.4:

- **Finding a position for a token that came from someone else.** There is no record for it. The token is held and can be sent.
- **Operating a ParyonUSD loan with its page not opened.** The wallet no longer knows how to read Paryon's coins. The Savings Jar can still be emptied by the wallet alone.
- **Names and decimals of fungible tokens from a template's declaration,** until the wallet reads a token registry (section 22).

## 1. Purpose and central design

Grandma's Wallet is a Bitcoin Cash wallet that can recover access after the user loses their phone, without the user making or keeping a backup. A trusted **recoverer**, which can be a business, a family member or a friend, can replace the wallet's owner. To do so it must publish a request on chain and wait through a waiting period, during which the existing wallet can cancel the request.

The central idea:

> Every ordinary address of the wallet can be spent in two ways. Its own key spends it directly, like any single-key address. The wallet's controller can also release it, and the controller obeys whoever owns the wallet's identity today.

Recovery changes the owner of the identity. The new owner then moves every coin and token to addresses of its own keys. This move is called the **sweep**. A second kind of address, the vault address, has no key of its own and is opened by the controller only (section 7.5).

Four consequences follow and shape everything else:

1. **Day to day, the controller is not involved.** A payment is signed by the keys of the coins it spends. The controller is not in the transaction, and no address shows the identity. The ordinary links between coins that are spent together remain, as with any wallet (section 16).
2. **Applications do not need to know about recovery.** They deal with coins and tokens at the wallet's addresses. An application position is recoverable when its authority is a token that the wallet holds, because the sweep moves the token. What the new device needs to know about the position it reads from a record that the wallet stored in its backup when the position was made, and checks against the chain (section 10).
3. **The wallet looks like an HD wallet.** One seed gives a key and an address for every coin. A **viewing key**, held by the recoverer, lets a new device find the addresses again.
4. **A key change does not take effect on a coin until the coin is swept.** Until then the coin still obeys its earlier key as well. This is the price of the first three points and is treated throughout as a cost, not hidden.

The intended experience is unchanged:

> Set up recovery once, use the wallet normally, and ask the trusted recoverer for help if the phone is lost.

The recovery promise is:

> Given an available recoverer who holds the recovery kit with the viewing key of every seed the wallet has had, a functioning blockchain, and a coin for fees, a new device can take over the wallet's identity after the waiting period and move to its own keys every coin, fungible token and NFT that sits at the wallet's addresses, including the tokens that carry authority over application positions. Operating such a position afterwards also takes the application's template, whatever the application itself still depends on, and the wallet's record of the position on a backup store.

The promise does not cover positions whose authority is a key written into a contract, state that exists only on an application's server, or coins that the holder of the earlier seed moves away before they are swept. This wallet does not open a position of the first kind (sections 12.3 and 12.5).

The recoverer is trusted to name the right new owner **once the waiting period has passed without a cancellation**. The blockchain cannot establish that a phone is lost. A working wallet must notice a request and get a cancellation confirmed in time.

## 2. Requirements and decisions

| Area | Requirement or decision |
| --- | --- |
| User custody | The seed is generated on the phone and is never given to the recoverer or to an application. It leaves the phone only if the user chooses to make a local backup (section 18). Spending does not need the recoverer. |
| Recovery authority | The recoverer's key cannot spend a coin of the wallet and cannot shorten the wait. It can only request and, after the waiting period, complete a change of owner. A recoverer who installs a key of its own after a wait that nobody cancelled is then the owner. The recoverer pays the fees of its own transactions, and creates the wallet from its own coins (sections 7.9 and 9.6); the owner gives it nothing. |
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
| Application positions | Recoverable when the application follows two rules (section 12): authority is a token, and the wallet's inputs and outputs are the wallet's business. Finding a position again is the wallet's job: it keeps a record of each (section 10). |
| Application actions | Judged one by one, by what each leaves behind. The wallet works out whether that comes back after a recovery. What it does when it does not is the choice of whoever builds the wallet; this wallet refuses (sections 12.3 and 12.5). |
| What an application has to bring | Its XO template, and nothing written for this wallet (section 13.3). |
| Wallet and applications | The wallet knows no application. It builds each transaction itself from the application's XO template. The same application must also work with an ordinary wallet. |
| Application connections | WizardConnect with an extension, `xo_v1`. |
| Waiting period | Counted in time (units of 512 seconds), enforced by the network. |
| Networks | Chipnet for now. No rule or code may depend on chipnet. |
| Openness to privacy improvements | Applications are never sent the identity or the controller, so what a recovery reveals can be reduced by a later version of the wallet's scripts without changing applications. Coins stay under the rules of the address they are at. |
| Not required | P2PKH addresses; restoration in an unmodified standard wallet; recovery of the original seed. |

## 3. Participants and trust

**Owner's device.** Holds the seed, signs payments, watches the controller, cancels unwanted requests. Whoever can use the device can spend at once; recovery is no protection against that.

**Recoverer.** Holds the recovery kit: its key for this wallet, the identity and the viewing key of every seed. It can request and complete a recovery, and it can see every address and balance of the wallet. Its key cannot spend a coin of the wallet, cannot shorten the wait and cannot complete with a key other than the one it requested. It creates the wallet from coins of its own, with a starting balance for the user, and pays the fees of its two transactions from them (sections 7.9 and 9.6). A bank or a friend or family member can be a recoverer; one page serves both. After a wait that nobody cancelled, it can install a key of its own choosing and is then the owner; preventing that is outside the trust model.

**New device.** Makes a new seed. Before the request it has no power. After completion it is the owner: it sweeps and spends.

**Holder of an earlier seed.** After a recovery, whoever holds the earlier seed (the lost phone, if someone finds and unlocks it) can still spend coins that sit at that seed's addresses and have not been swept. They cannot spend from addresses of the new seed, from vault addresses, or act on the controller.

**Backup stores.** Keep sealed records: copies of the viewing keys, the templates the user trusted, the positions the wallet holds in applications, the recoverer's receipts, labels. They cannot read them and they authorize nothing. They can withhold, delete, or hand back an older set.

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
| Backup stores | Sealed copies of viewing keys, templates, position records, receipts and labels. For viewing keys the recoverer's kit is the reference, not a store. For a position in an application, the record on a store is the only copy besides the device's. |
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
| The values an application position was made with | Where the application puts them there: on its token or its coins | In the XO engine's state | — | Sealed copy, in a position record |

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
| Position values are carried in the backup stores | Written to the chain, in a data output beside each action; or the wallet reads them back from the chain, as the second design did | An application's transaction often has no room for another output, and a separate transaction costs a fee and a link for every action. Reading them back needs the application to keep them on chain and someone to tell the wallet where. The stores exist already, and the new device already gets their key from the recoverer. |
| An application needs only its XO template | A second document beside the template, written for this wallet, that says how the wallet takes part in each action and how to find a position from the chain (the second design's recovery declaration) | Authors would have to write for this wallet, and a template written without it could not be used. What the document said is taken from the template, from the request and from the wallet's own record. The price: the wallet acts without the application only where an action needs nothing that the application alone knows. |
| The chain decides whether a record counts | The recoverer confirms each record with a receipt, as it does for viewing keys | The recoverer would take part in every action of every application. The chain is there without anyone being asked. |

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
- **Changing the waiting period.** Nothing else changes. The recoverer is told, so that its copy of the settings matches the chain. The wallet page does not offer this (decided by the owner on 18 November 2026): a wallet keeps the waiting period it was set up with. The contract and the library still carry such a change out.

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

### 7.9 Creating a wallet: whoever has the coins creates it

An address needs the identity, and the identity is the identifier of a transaction, so a wallet's first coins cannot arrive at a recoverable address before the identity exists. Since 18 November 2026 the wallet does not fund its own creation. **Whoever has the coins creates the wallet:** the recoverer, from its own Bitcoin Cash. A bank gives a new customer a small starting balance as part of its service; a friend or family member gives the person they help their first coins. In both cases the first transaction is trusted (below), and the user sees one scan, "Setting up…" and "Your wallet is ready".

Both pages are open at the same moment, in person or on a call. The recoverer's page shows a code; the phone scans it and joins the session the code offers (section 14.4). Then:

1. **Request.** The phone makes its seed, writes its viewing-key record to a new backup archive of its own, and sends the recoverer an **enrollment request**: the hash of its controller key, its viewing-key record, the access to the archive, the waiting period the recoverer's page told it, and the number of the change address the starting balance is to go to. The request is signed with the controller key and sealed to the recoverer's encryption key, and carries an identifier of its own (`packages/enrollment/src/request.ts`).
2. **Create.** The recoverer creates the wallet from its own coins, in one transaction that spends a coin that is output 0 of its transaction; when it has no such coin of the size needed, it pays itself first, as the wallet did before. The creation has two outputs: the controller, whose first state names the owner's key from the request, the recoverer's own recovery key for this wallet and the waiting period; and the starting balance, at the phone's change address, derived from the request's viewing key and the new identity. Nothing is kept apart for the recoverer's fees: it pays them from its balance when they arise (section 9.6). A bank's page creates without anyone saying yes; a friend's page asks "Set up …'s wallet with …?" and creates on one tap (`packages/app/src/recoverer-funds.ts`, `set-up.ts`).
3. **Keep.** The recoverer assembles the kit itself, from the request and what it created (section 9.4), checks it against the chain as it would any kit, keeps it, and leaves its receipt in the phone's archive, naming the request's hash. Only then does it answer the phone with the identity, the creating transaction and its recovery key hash.
4. **Check and open.** The phone checks the creation as any client does (section 5.7) and more: the state must name this phone's controller key, the recovery key of the recoverer that answered over the session of the code it scanned, and the waiting period it was told. It opens its wallet with its seed and that identity (`OwnerWallet.enrolled`), shows the balance and "Protected by …", and says that recovery is on once it finds the receipt, which is already there.

The recoverer pays everything: the creation and the starting balance, and later the fees of what it does for the wallet. The owner gives the recoverer nothing.

**Requests are carried out once.** The recoverer's page keeps every request by its identifier before it does anything for it, and records each step of the creation before the transaction is sent. The phone keeps its sealed request and sends the same bytes again, every few seconds, until it has its answer. So a reload on either side resumes: a phone loaded again after sending gets the wallet that was created for it; a recoverer's page loaded again after creating and before answering finds its record, carries on and answers with the same wallet; an answer that is lost is given again when the request arrives again. The page also offers the same session after a reload, so the phone that joined it is answered there. No second wallet is made for one request (tests CR08, RC14).

**The first transaction is trusted.** The phone takes the creation from the recoverer, and the recoverer could create a wallet that the phone does not accept, or none. It cannot create one that the phone accepts and that names another owner, another recoverer than the one that answered, or another waiting period: the phone refuses those. It does see the viewing key and the starting balance, as any recoverer does. A recoverer that wanted the wallet for itself would still have to request, wait in public and not be refused, as at any other time.

**No step waits for a block.** The phone goes on as soon as the network has the creation, in a block or not; servers give a transaction out at once and list it a moment later, so the phone checks the creation from the transaction itself, the recoverer reads the history again for up to ten seconds before it takes its creation for gone, and the wallet's watching starts as soon as the history is listed. The starting balance is spendable at once, and the wallet can refuse a request at once: the starting balance is at least what a cancellation costs.

**A creation that disappears.** Until a block holds the creation, the wallet looks at the recoverer's creating transaction at every check; the transaction that defined the identity is its parent, so watching the creation covers both. If it disappears (the coins the recoverer paid with were taken back, or a block was undone), the set-up did not hold. The wallet says so plainly on its first screen and is set up again with the recoverer: the phone sends a new request, and its numbers continue after those the first identity gave out. It never makes an identity of its own. What others paid to the addresses it gave out stays its own, by key, as voided coins; once the new wallet exists, they are moved to its addresses (CR10). When the recoverer's coin comes back and is spent the same way, the new creation may give the same identity again; its addresses are then the wallet's again. The recoverer's kit for a creation that is gone cannot be used; it shows that the set-up did not hold.

**A vault address does not wait either.** It is given out as soon as the wallet is created. If the creation disappeared, a payment to a vault address of it could not be spent by anyone, since a vault address has no key (section 7.5). It takes a payer of the recoverer's coins who takes them back before a block holds the creation, after a vault address was given out; that payer gains nothing by it.

The wallet's library still has the wallet's own creation from a funding address (`OwnerWallet.create`, CR01 to CR04), which the tests and the scripts of earlier runs use. No screen of the wallet offers it any more. A phone that had begun creating a wallet that way before this change opens its wallet if it was made, and otherwise begins again at the first screen.

What a creation shows: the starting balance can be traced to the creation of the identity, and to the recoverer's coins. Coins received later at fresh addresses have no such link.

## 8. Normal operation

**Receiving.** The wallet shows a fresh address of kind "given out" for each request, within the limits of section 7.7. Nothing is written on chain and the controller is not involved. For a lasting address it shows a vault address. Every address of the wallet can hold tokens. CashAddress has two forms of the same address: the plain one, and a token-aware one (`z…` for a key hash, `r…` for a script) by which a receiver says that its wallet knows tokens. Both pay the same locking bytecode. The Receive screen shows the token-aware form first, with its code and copy button, for either kind of address; unticking "Receiving a token?" shows the plain form of the same address, for a payer whose wallet does not take the other.

**Paying.** The wallet picks coins, signs each input with its address key, and sends change to a fresh change address. The wallet never pays a fee with a coin that carries a token, and never drops or alters a token it was not asked to move. Several payments can be in flight at once, and the wallet can take part in a transaction with other parties.

**Sending tokens.** The user chooses between Bitcoin Cash and a token. A fungible token is shown as one balance per category, and any amount of it can be sent: the wallet gathers coins of the category that carry no NFT, at ordinary addresses of the current seed, the largest first, and returns the rest of their tokens to a fresh change address. An NFT is sent whole, with its commitment and capability unchanged; a coin that carries an NFT and a fungible amount moves whole. Each token output holds the smallest value an output may hold. The fee is paid by the wallet's ordinary coins: a coin with a token is spent only because its tokens move, and what it held beyond its new output comes back with the change in Bitcoin Cash. When the ordinary coins do not cover the fee, the wallet says so, with the figures. A token at a vault address is moved to an ordinary address first, through the controller as in a sweep; one at an earlier seed's address is swept first.

- **Only to a token-aware address.** A token goes only to an address written in the token-aware form. A plain address is refused before anything is built, with the reason (a wallet that does not know tokens can destroy them) and what to ask the receiver for. The scanner of that field accepts only token-aware addresses.
- **A review before sending,** as for a payment: what goes, by name and amount where a trusted template names the token (section 13.3), to whom, the token change, the satoshis that go with the token, and the fee.
- **A token that gives more than itself.** For an NFT that controls a position, the review says what it controls, with the figures the Applications screen shows, and that whoever receives it controls that from then on; for an NFT with minting or mutable capability, what that capability lets its holder do. The button to send is enabled only after the user ticks that they understand. Once sent, the token is no longer listed, and nothing offers its actions; a note of which template made it stays as a hint, in case it comes back.

**Application actions.** The wallet builds the transaction from the application's template, adds its own inputs and outputs, and signs with address keys (sections 12 to 14). Tokens that carry authority over a position are held at ordinary addresses.

**Controller transactions.** Cancelling a request, changing settings, sweeping and spending from a vault address spend the controller. The fee is paid from the wallet's ordinary coins, as for a payment, signed by their keys, with change to a fresh change address. No coin is kept apart for it. The coin that pays and its change are visibly in a transaction with the identity, so the wallet takes the smallest coin that pays the fee alone, and several only when no single coin does; little is tied that way. A cancellation is 1,091 bytes without change and 1,135 with it, so the wallet cannot pay for one only when it holds less than about 1,100 satoshis without tokens. Then a coin at a vault address or at an earlier seed's address pays: the controller releases it in the same transaction. A cancellation that the network refuses because a coin it spends was spent a moment before by another payment of the wallet is made once more, from other coins.

**Fees.** The wallet pays the lowest fee that nodes relay and works it out from the transaction itself.

- **Rate.** A setting, one satoshi per byte by default, which is what nodes require. The wallet does not raise it by itself. If a server refuses a transaction for its fee, the wallet says so.
- **Exact amount.** The fee is the size of the signed transaction in bytes times the rate, rounded up. The size is known before signing: signatures are Schnorr signatures of 65 bytes, public keys are compressed, and every script is fixed. The wallet measures the encoded transaction; it does not add up estimates.
- **Smallest output.** Nodes relay no output below a value that depends on the output's own size: 546 satoshis for P2PKH, 576 for an address of this wallet without a token, 888 for the controller, and more for an output with a token, according to its token data. The wallet computes this for every output it creates.
- **Choosing coins.** At a constant rate every coin costs its bytes once, whenever it is spent. What can be saved is the change output: 44 bytes now and 296 when it is spent. The wallet therefore prefers a choice of coins that needs no change.
- **A remainder too small to return.** If what is left after the fee is below the smallest change output, the wallet compares leaving it to the fee with adding a coin so that change becomes possible. It takes the cheaper and shows the amount as part of the fee.
- **A check before sending.** The signed transaction is checked once more: its size is the one worked out, its fee is the required one plus at most such a remainder, and no output is below its smallest value. Otherwise it is not sent. There is no limit on the fee in satoshis, which would stand in the way of a transaction with many inputs.

The same rules apply to controller transactions and to the transactions the wallet builds from an application's template.

**Sending everything.** The wallet offers to send all its Bitcoin Cash to one address.

- **What goes.** Every coin without a token. Everything is paid to the one address, there is no change, and the amount is the total less the exact fee.
- **Coins that only the controller can move.** Vault coins, and coins at an earlier seed's addresses that are not yet swept, go in the same transaction, with the controller at input 0 and its successor, which keeps its 1,000 satoshis, at output 0. A wallet with more coins than one transaction holds sends several, each with its exact fee.
- **Tokens.** The satoshis under a token stay with it. They leave when the token is sent, or when the user destroys the token on purpose, which is an action of its own.
- **When it cannot be done.** Only when the total less the fee is below the smallest value of the destination output. A single P2PKH coin of 546 satoshis leaves 361, which cannot be sent. A wallet needs the smallest output plus the fee: 886 satoshis in one coin at an address of this wallet (a payment of 340 bytes and an output of 546 satoshis), and more when the amount is spread over several coins. Below that the wallet shows the total, the fee and the smallest output, and sends nothing. A coin that costs more to spend than it holds is left out and listed; nodes relay no such coin at the default rate.
- **What is left.** The controller with its 1,000 satoshis, coins with tokens, and whatever the recoverer holds. The wallet stays usable and recoverable. Until it holds Bitcoin Cash again it cannot pay for a cancellation; if a request arrives meanwhile, it says so where the request is refused (section 17).

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

No value in the second to sixth rows can be turned into a signature for a coin of the wallet. The recoverer's key signs the two recovery transactions. Their fees are paid from the recoverer's balance (section 9.6), from which it also creates wallets (section 7.9): a seed of its own that no wallet names.

**Two ways of working.** One recoverer page serves both. Its first run asks "I'm a bank" or "I'm helping someone I know", and the answer can be changed later in its settings, with the name phones show, the starting balance of new wallets and their waiting period. Both show the recoverer's balance and an address to fund it.

| | A bank | Someone helping a person they know |
| --- | --- | --- |
| A new wallet | "New customer" shows an activation code; when a phone scans it and asks, the wallet is created at once, with nobody saying yes | "Help someone set up" shows a code; when the phone asks, the page asks "Set up …'s wallet with …?" and creates it on one tap |
| Its wallets | A list of customers | A list of the people it helps |
| A lost phone | "Customer lost their phone" shows a code for the new phone; its request arrives over the session and the recovery is requested at once | The same, as "… lost their phone" |

The owner of a wallet is shown the waiting period as a fact, not a choice. The recoverer's page may say more than the wallet: it is not part of the wallet's user experience.

### 9.2 The recoverer's key

The recoverer's key is an ordinary key pair. On chain it appears only as a 20-byte hash in the controller's state. It is in no address: an address holds only its own key hash and its tag. There is therefore one recoverer key per wallet, not per coin, and the recoverer never signs for a coin. It signs two kinds of transaction, the request and the completion, both of which spend only the controller and a coin for the fee.

**The recoverer uses a different key for every wallet it serves.** Two wallets with the same recoverer then have no value in common on chain.

Who makes the key was decided on 18 November 2026: **the recoverer makes it** when it creates the wallet, as a twelve-word credential of its own made for that wallet alone, so that the device never knows it. A device that replaces its recoverer (section 9.7) still makes the new recoverer's credential, as before. The two ways, as they were weighed:

| | The owner's device makes it | The recoverer makes it |
| --- | --- | --- |
| How | The device makes a separate twelve-word credential, puts the hash of its key into the controller, seals the words into the recovery kit, and does not keep them. | The recoverer makes a key for this wallet and gives the device its hash before the wallet is created. |
| Setup | One-way. The recoverer need not be reachable when the wallet is created. | Needs an answer from the recoverer first. |
| A key per wallet | Automatic | Depends on the recoverer |
| Who has known the key | The device, briefly, and the recoverer. A device that kept it could request and, after an uncancelled wait, complete. It could not spend with it, and whoever controls the device is the owner anyway. | The recoverer only |

The first was the default until the recoverer created wallets; now the recoverer is reachable when the wallet is created, because it creates it, so the second costs nothing and leaves no copy on a device. The credential must be unrelated to the owner's seed: not a key of the owner's tree and not derivable from it. Where a device made it (a replaced recoverer), that it erased it cannot be shown to anyone, so an old device may still hold a copy (section 9.7).

The credential gives the **recovery key**, at the same place in its own tree as the owner's controller key has in the owner's: `m / P' / C' / 0' / 0`. Its hash is in the controller. Until 18 November 2026 a second key of the credential, the **fee key** at `m / P' / W' / 0' / 0`, had an address where the recoverer kept coins for this wallet's fees; fees are now paid from the recoverer's balance (section 9.6), and the key is derived only to bring back what is still at such an address. A recoverer that makes its own key gives the device its key hash.

### 9.3 Delivery

Two names are used from here on. The **recovery kit** is what the recoverer keeps for a wallet for as long as it serves it; it grows when the wallet gets a new seed. The **enrollment message** is the sealed message that delivers a kit from a device; since the recoverer creates wallets (section 7.9), only a device that replaces its recoverer sends one (section 9.7).

**A first recoverer assembles the kit itself.** The phone's enrollment request (section 7.9) carries what only the phone can give: its controller key's hash, its viewing-key record signed with that key, and the access to its backup archive. The recoverer adds what it made: the identity, the creating transaction and its own credential. The kit is the recoverer's own record, held to the same checks as a kit that arrived in a message (section 9.5), and its receipt answers the request's hash.

The request and the enrollment message are sealed to the recoverer's encryption key with HPKE (RFC 9180) in base mode: X25519, HKDF-SHA256, ChaCha20-Poly1305. Sealing adds 49 bytes: a first byte that says how the content is written, the 32 bytes the recipient needs, and a 16-byte tag. Since 18 November 2026 the content is made smaller with deflate before it is sealed when that helps (first byte 2; 1 for content sealed as it is, which is still opened), so that a sealed message fits a QR code: a hand-over after one recovery went from 2,443 bytes to 1,288, and its link from 3,443 characters to 1,834. A code with many squares is drawn larger, three points to a square where the screen has the room. Anyone may see a sealed message in transit; only the holder of the matching private key can open it, and sealing the same content twice gives unrelated bytes. Who made a message is settled by the signature inside it and by the chain, not by the encryption. (`packages/enrollment`; decision D14.) The encryption key is not a wallet key and not an extended public key.

The recoverer's encryption key reaches the phone in the code its page shows, with its name and the address of its page, and the address of a WizardConnect session the page keeps open while the code is shown (section 14.4). The phone scans it, and everything else goes over the session: the request and the answer when a wallet is set up, the takeover request and the hand-over when a phone was lost. Both pages are open at the same moment, in person or on a call. A code scanned from the bank's page or from a friend's screen is a trusted channel, so these flows show no fingerprint and ask for no comparison. There is no invitation that is answered hours later.

A device that replaces its recoverer, or announces a new seed or a new waiting period, still reaches the recoverer as before: the kit for a new recoverer goes over the session of the new recoverer's code or as a link, and an update message as a link (section 9.7).

### 9.4 What the kit contains

| Field group | Purpose |
| --- | --- |
| Format, version, network | Unambiguous reading; no use on another network |
| Identity and the identifier of the transaction that created it | Find and check the wallet. The transaction itself is fetched and checked, not taken from the message. |
| Version of the controller rules; version of the address scheme; references to the wallet's templates (identifier and content hash of each) | Choose compatible behaviour |
| Recovery credential (made by the recoverer for a wallet it created, by the device for a new recoverer), or a statement that the recoverer holds its own key | Authorize the request and the completion; pay their fees |
| Viewing-key record of the current seed, and those of earlier seeds if any | Hand to a new device after completion |
| Backup stores: addresses, archive identifier, content key; the same for earlier archives | Read the sealed records |
| Policy as the owner saw it: owner key hash, recoverer key hash, waiting period, who the kit is for, time of making | Compare with the chain. The time is a note, not evidence. |

The enrollment message must fit a QR code that a phone camera reads reliably. What is measured is the whole link as text, with the sealing and the encoding included; the 2,953 bytes that the largest code holds as binary data are not the budget. Templates and other growing data are not in the message; they are on the backup stores.

A kit that has grown through several seeds is not sent again as one code. Additions arrive in messages of their own (section 9.7), and a kit given to a new recoverer may refer to sealed records on the stores by their hashes. A reference is not the thing itself: the recoverer confirms only after it has fetched and saved what is referred to.

The first kit is not a backup of later seeds. A recoverer that kept only that kit, and not what came later, cannot recover coins at the addresses of a later seed.

The kit holds no allowance and nothing about one: the recoverer pays its fees from its own balance (section 9.6).

The kit lets the recoverer read the wallet. That has to be explained to the user: secrecy from someone watching the delivery is not secrecy from the recoverer.

### 9.5 Checking and confirming

The recoverer checks a kit against the chain before relying on it, whether it assembled the kit itself after creating the wallet or received it in an enrollment message:

- it is for this network and its signature is valid;
- the identity's creation is valid (section 5.7) and the controller can be followed to a current state;
- the signer's key hash is the owner in that state, and the viewing-key record is signed by the same key;
- the credential's recovery key hash is the recoverer in that state;
- the waiting period is the one the message states.

It then saves the kit where it will not lose it and leaves a **receipt** on the backup stores, signed with the recovery key. The receipt names the network, the identity, the hash of the message it answers, the hash of every viewing-key record the recoverer now holds, and the recovery key hash. The wallet finds the receipt there, so no channel from the recoverer back to the owner is needed. A store's answer that something was uploaded is not a receipt. A receipt for another message, or one not signed by the recovery key, does not count. The wallet says that recovery is on only when a receipt matches what it sent and the controller's state, as the network shows it, matches both. That state counts as soon as the network has it, in a block or not; each check works the status out again from the chain, so a transaction that disappears takes the status with it.

A receipt given before a change takes effect, for a new seed or a new recoverer, is a **prepared receipt**. It also names the controller output it was prepared against and the state the change is to produce, and it counts only once the chain shows exactly that change (section 9.7). A prepared receipt from a recoverer that is not yet in the controller's state is signed with the recovery key that is to be installed.

### 9.6 Fees for the recoverer

A request and a completion each need a coin to pay the fee. Paid by one P2PKH coin with change, a request is 991 bytes and a completion 970, so the two together cost about 2,000 satoshis at one satoshi per byte.

**The recoverer has one balance, and pays every fee from it** (decided by the owner on 18 November 2026). The balance is an ordinary single-key (P2PKH) address of a seed of the recoverer's own, which no wallet names; wallets are created from it (section 7.9). A request, and a completion, is one transaction: its first input is the wallet's controller, unlocked with the recovery key for that wallet; its other inputs are coins of the balance; its outputs are the controller's successor and the change, back to the balance. Nothing is kept apart for a wallet, at its creation or later, and there is no step of funding a wallet before the recoverer can act for it. A recoverer whose balance is empty cannot send a request; its page says so beforehand, with what is missing.

The two inputs have different keys, and the recoverer's page has one XO engine, which holds the balance. The page's own code signs the controller's input with the recovery key, which it derives from the wallet's credential as it already does to sign receipts and hand-overs, and gives the input to the engine with its unlocking, as another participant's input; the engine adds and signs the balance's coins and builds the transaction, and the project's check before sending verifies the whole of it (`packages/app/src/recoverer-funds.ts`, `recoverer-wallet.ts`). A signature commits to every input and every output, so neither can be moved to another transaction. One page therefore serves every wallet without loading an engine for each.

What this shows on chain: every wallet a recoverer creates is created from its balance, and every request and completion it sends is paid from it, so the wallets a recoverer has acted for can be told to have the same recoverer. A wallet it only looks after, and did not create, is tied to it by nothing until it acts.

The recoverer's page can send the whole balance to another address: every coin, no change, the exact fee. A coin that a set-up under way is named after (section 7.9) stays, and the page says how much that is.

**Coins at earlier fee addresses.** Until 18 November 2026 the recoverer put a fee reserve of 4,900 satoshis at an address of the credential's fee key when it created a wallet, and topped it up from its balance. A page that still finds coins at such an address offers to bring them into the balance, in one transaction that the page's code unlocks with the fee keys.

**The owner gives the recoverer nothing.** Until 18 November 2026 the owner could give the recoverer an allowance for its fees when the wallet was created; that is dropped everywhere: from the creation, the kit, the screens and this document. The recoverer's balance and its change are the recoverer's own; the wallet never shows them as part of the user's balance. A recoverer that is replaced has nothing left with the wallet (section 9.7).

A recoverer without coins cannot create a wallet or send a request. Its page shows its balance and what a new wallet takes, and says so before it is needed; a phone that asks a recoverer whose balance is too low is told so, and the recoverer's page says how much to add.

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

The new recoverer pays its fees from its own balance as the first did (section 9.6). The old recoverer kept nothing with the wallet, so nothing of its is left behind.

The earlier recoverer keeps what it was given. Its key no longer works on the controller. It can still see the addresses of the seeds whose viewing keys it holds, including what arrives there later. To end its view of future payments, the owner also moves to a new seed and a new archive and gives those to the new recoverer only. What it has already seen cannot be taken back.

**A change of the waiting period alone.** The owner sends the new settings in an update message, and the recoverer's receipt for them replaces the earlier one. Since 18 November 2026 the wallet page has no screen for it: the waiting period is the one the recoverer set the wallet up with (section 7.9). The message and what the library does with it are unchanged and tested.

**A request the recoverer did not make** means that its key is in other hands, possibly as a copy left on a device that once made the credential. The owner cancels and replaces the credential or the recoverer.

### 9.8 What a recoverer has to do

The recoverer of this project is a page on the XO engine. Nothing in the design requires that. A recoverer is whatever does three things:

| Duty | What it takes | How this project's page does it |
| --- | --- | --- |
| Sign the two recovery transactions | A key whose hash the controller's state names. The controller checks a signature by that key and nothing else about who signs or with what. Each transaction also needs a coin for its fee. | The page's own code signs the controller's input with the recovery key. The XO engine adds and signs the coins of the recoverer's balance (section 9.6). |
| Keep the kit, and hand it to the new device | A place that does not lose it, and a way to give the new device what step 6 of section 11.1 lists | The page's storage in the browser; the hand-over over a session or as a code (section 14.4) |
| Establish who the user is | Its own process (section 11.1, step 2) | Whoever presses "… lost their phone" has done so |

Creating wallets from its own coins (section 7.9) is a fourth thing this project's recoverer does. A wallet can also come to a recoverer that did not create it (section 9.7).

A bank's own system, a signing device, or a program that does not use XO can therefore be a recoverer: it signs two transactions of a published form with a key it holds, keeps a document, and passes that on. The messages of section 14.4 are one way to carry the kit and the hand-over. They are not part of the role.

**A recoverer needs no knowledge of applications.** The records of section 10 reach the new device through the access to the archive, which the kit holds. The recoverer does not check or confirm them, takes part in no application's transaction and holds no application's template. It is able to read them, as it is able to read the rest of the backup (section 16.5).

This version builds no second recoverer. It states the role so that one can be built without changing the wallet.

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
| The record of a position: which token, which template, which script and the values it was made with | Finding and operating a position | The token is still swept and safe. The wallet cannot find the position by itself until a copy of the record is found. |
| Labels | Convenience | Names are lost. |

No per-payment and no per-address record is needed. This is what keeps the backup small. There is one record for each position in an application, and positions are few. A missed write of a label is harmless. A viewing-key record that never reached the recoverer is not, and neither is a missing position record. Section 10.5 lists what must be stored before the wallet depends on it.

### 10.2 Records

| Record | Contents | Written |
| --- | --- | --- |
| Viewing-key record | As in section 7.6 | When the wallet is created; by a new device before a recovery request or a move to a new seed |
| Template | The template, whole and as the text it arrived in; its identifier and content hash. A record of the second design also holds the recovery declaration that came with the template; it is kept and no longer read. | When the user trusts a template, before its first action |
| Template withdrawal | The template's identifier and content hash, and a number | When the user stops trusting a template the backup holds |
| Token note | Token category; identifier of the template; which authority entry of its declaration | By the second design, when an action created an authority token. Still read; a position record takes its place. |
| Position record | The token the position belongs to: its category, and its commitment at that time. The template's identifier. The locking script, the role and the values the script was made with, under the names the XO engine keeps them by: `templateIdentifier`, `lockingScriptIdentifier`, `roleIdentifier`, `variables`. Apart from those, the other values of the action that made the position, without any address. The address of the application's page, where a request came from one. | Before a signature leaves the wallet for an action that leaves a position (section 12.3), or that delivers an NFT of the application's to the wallet |
| Label | A name the user gave | When given |
| Receipt | The recoverer's signed statement of what it holds (section 9.5) | By the recoverer |

A template is kept whole because its identifier depends on the order of its fields; a registry or the application's site may not exist later. A template that an open position was made with is kept after a newer one replaces it.

**Position records.** The XO engine learns of a script when it builds or receives the invitation that made it, and keeps the values the script was made with in the storage of one device (section 13.6). A position record is a copy of that, made by the wallet's own code from the transaction it has worked out, before anything is signed.

- **One for every position.** It is the wallet's only way to find a position by itself. The same records can later travel by XO's own synchronisation.
- **Which token.** The NFT that the transaction delivers to the wallet, wherever it comes from: one the action spends and gives back, one it makes from the wallet's own coin, or one an application's contract hands out, as Paryon's does with a loan's key. For a later action on the same position, it is the token the action is about.
- **Two sets of values, kept apart.** The script's values are what the engine needs to follow the script again. The action's other values are kept because a later action may need one under the same name; the trial of stage 11 needed one, the date in the form the key's commitment takes. The engine itself keeps all of an action's values in one list. The record does not, because the two sets are used under different rules (section 13.3).
- **No address, except inside a script.** Among the action's other values the record holds no locking script: the address a key went to belongs to the seed of that time, and using it again after a recovery would send the key to the earlier seed. A locking script that is one of the script's own values stays, because the script cannot be built again without it. Where an application stores an address of the user's in a script for a later payout, that should be a vault address, which outlives every recovery (section 12.3).
- **When one is due.** When an action leaves an output at a script of the template that the wallet follows, and a token of the wallet's takes part: it reaches the wallet, or the action is about it. Without a token of the wallet's the output is a payment as far as the wallet can tell, into someone else's position for one, and no record is written. A record that an earlier action wrote for the same position covers a later payment into it.
- **The wallet paying itself first.** Where the wallet has no coin that can define a new token, it first pays itself to make one. That payment leaves nothing outside the wallet and is sent before the record can be written, since the token's category is that payment's identifier.

- **No key and no secret.** A record holds values of an application's script. A script that takes a key of the device gets no record that could bring it back (section 12.3).
- **A position that moves gets a new record.** An action that continues a position at another script writes one for that script. Earlier records stay, and the chain says which is current (section 10.4).
- **A position at a script that many users share.** Some applications keep every user's position at one script and tell them apart by a token; a ParyonUSD loan is one. A template marks such a script as one a wallet need not follow. The record then ties the token to the template and names no script of its own. Which coin is the position, and whether it is still there, the application says (section 13.3).
- **A record of an action that was never sent** names a script the chain does not know, or a token the wallet never received. It is harmless, and it is not copied into a new archive.

### 10.3 Sealing, stores and authenticity

Records are encrypted with XChaCha20-Poly1305 under the content key and stored as blobs named by their hash, on one or more stores. A store sees neither whose the blobs are nor what they hold. The device keeps a full copy, from which a store can be filled or replaced without the old one taking part. (`packages/archive`, `apps/archive-store`.)

The recoverer holds the content key, and so does a lost phone. The content key therefore cannot be what makes a record genuine. Each record is signed by the controller key of the seed that wrote it, and a reader accepts it only if the controller's history shows that key as an owner. Two exceptions: a receipt is checked against the recovery key it names and the controller's state, and a record that a new device writes before it becomes the owner is signed by the proposed key and counts once the controller shows that key as the owner.

A signature shows who signed, not when. Whoever holds an earlier seed can sign new records with it long after that seed stopped being the owner. Three rules follow:

- **The recoverer's kit is the reference for viewing keys.** A viewing-key record counts when a receipt names its hash. A second record for the same seed, signed by the same key, does not replace the first; the reader reports the conflict.
- **Records of an earlier seed never override the current owner's.** A template or a label from an earlier archive is a suggestion from that time. It does not make a template trusted on the new device.
- **A position record of an earlier seed is a suggestion too.** After a recovery every position record is one of an earlier seed, whose holder can still sign new ones. What makes a record count is the chain (section 10.4), not its signature.
- **Newest does not win by date.** Dates in records are notes. Where two sets disagree, the one that a current receipt names is used, and the rest is reported.

Stores can withhold, and they can hand back an older set that was once genuine. The device and the recoverer each keep the hash of the latest receipt and compare it with what a store returns. If the newest set cannot be established, the device says that the backup may be out of date. Using more than one store, and keeping the device's copy, reduces these risks and does not remove them. Nothing on chain commits to the backup in this version.

### 10.4 What a record can and cannot do

A record is a hint, never an authority.

- No record can make the wallet treat an address as its own. Addresses come only from the identity and a viewing key.
- A viewing-key record is used only when a receipt names it. A wrong record would find nothing, and finding nothing is not evidence of an empty wallet.
- A token note of the second design says which template made a token. It is read as a hint of which template to show for the token, and nothing else rests on it.
- Without a record the wallet does not search for a position. The second design did, as its declarations told it to.

**When a position record counts.** The wallet checks a position record against the chain before it relies on it. The record counts when all of these hold:

1. The wallet holds the record's NFT, and the user trusts the record's template.
2. A transaction on chain carried that NFT, among its inputs or its outputs, and also paid the script that the template, the record's locking script and the record's values give.
3. The NFT of point 2 is the one the wallet holds, and not another of its category. The wallet compares category, capability and commitment, never the category alone: Paryon's sidecar coin carries an NFT of the key's category with another commitment. Where the token could have been copied, because it can mint or its commitment can change, the wallet follows it from that transaction to its own coin, input by input. If the way back is not unambiguous, the record does not count.
4. Where the template names the token as an input of an action, the values that the input's token fields use are the token's own. A record that gives the script another key's category does not count.

The wallet looks for the transaction of point 2 from the script's side, among the few transactions that paid a script of the position's own. Stage 11 worked the check through for a Savings Jar on the local node and for the jars of two earlier runs on chipnet: only the opening transaction both paid the jar and carried the key, and a later deposit by someone else confirmed nothing and got in the way of nothing.

**A record that names no script,** for a position at a script many users share, has nothing for points 2 and 4 to test. It counts when the wallet holds its NFT and the user trusts its template. It says only "this token belongs to that template", and a made-up one says nothing more than a genuine one. On chipnet, going back from a swept loan key through the transactions that moved it reaches the transaction that last paid the loan's script in one or two steps; the wallet does not need that walk, because the application finds the loan from the key (section 15.3).

The check rests on rule 1 (section 12.1). Whoever acts on a position spends its token in the same transaction, so a transaction that made or moved a genuine position carried the token. Someone who does not hold the token cannot make such a transaction.

| What the check finds | The wallet |
| --- | --- |
| The record counts, and its script holds coins | Shows the position and carries out its actions |
| The record counts, and its script holds nothing | Reports the position as closed |
| Several records count for one token, and one of their scripts holds coins | Ordinary: each action that moved the position wrote one. That record is the current one. |
| Several records count for one token, and more than one of their scripts holds coins | Shows each as not confirmed. One of them may be a trap (below). |
| The record names no script | Shows the token under the template's name, with no word on whether the position is open. That is the application's to say. |
| The record does not count | Shows what it names as **not confirmed**, apart from the confirmed positions. It carries out an action there only when its own figures show that the wallet gives nothing but the fee. Money can be taken out, and none is paid in. |
| A token and no record | Shows the token, which can be sent. It does not look for a position, and it cannot tell an application that the token is one of its template's. |

Four limits:

- **A position that no token of the wallet's opens** has no record, and the wallet takes what was paid into it for a payment. Rule 1 says a position is opened by a token (section 12.1).
- **A token received from someone else** has no record in this wallet. Having the application name the position for it, under the same check, is not part of this version (section 22).
- **Before the sweep, the check protects nothing.** Until the token is swept, the earlier seed's key spends it, and whoever holds that seed can take the position itself (section 19).
- **A trap set before the sweep can outlive it.** Whoever holds the earlier seed can, before the sweep, spend the key in a transaction that pays a script of their own making and gives the key back, and later sign a record for that script. Points 1 to 3 hold for it. Point 4 catches it where the template names the token as an input; where a template does not, only the fourth row of the table stands in the way, and only while the genuine position holds coins.

### 10.5 Writing before depending

| Before | This must be safely stored |
| --- | --- |
| The wallet says that recovery is on | The recoverer's receipt for the current kit, matching the controller's state as the network shows it |
| A signature for the first action of a template leaves the wallet | The template, on the configured stores. By default the wallet refuses the action if no store confirms. |
| A signature leaves the wallet for an action that leaves a position | The position record, on the configured stores. This wallet refuses the action if no store confirms. Another wallet may go on and show the position as not yet backed up (section 12.5). |
| A recovery request to a new device's key | The new device's viewing-key record and archive access, with the recoverer |
| An `ownerUpdate` to a new seed | The same, and the recoverer's prepared receipt |
| An `ownerUpdate` to a new recoverer | The complete kit with the new recoverer, and its prepared receipt |
| An address is shown | Its number, recorded as taken on the device |

The third and fourth rows keep the wallet recoverable at every moment: as soon as a new seed becomes the owner, the recoverer already holds what a later recovery will need.

Version 0.4 could let an action go on with no store in reach, because it found positions again from the chain. Without a declaration the wallet has no such second way, so every action that leaves a position waits for a store.

A store that cannot be reached does not stop ordinary use. Paying, receiving, and actions that leave nothing behind go on. It stops only what would create a new dependency: the first action of a new template, and an action that leaves a position.

### 10.6 After a recovery or a move to a new seed

The earlier device knows the earlier backup's content key. The new device therefore starts a new archive, with a new identifier and key, and gives the recoverer access to it together with its viewing-key record, before the change of owner. The earlier archive is read for templates, position records, notes and labels, which are copied into the new one, and is then left. Nothing is removed from it while the copy is unfinished. A position record is copied as the suggestion it is. Once it has passed the check of section 10.4 on the new device, the device writes it again as its own, with the values of the earlier record: the new device's engine holds only what it was given.

This protects records written from then on. It does not take back what the earlier key could already read.

## 11. Complete recovery procedure

### 11.1 Steps

0. **Setup, while all is well.** The phone scans the recoverer's code and sends its enrollment request; the recoverer creates the wallet from its own coins, naming the phone's key, its own recovery key and the waiting period, keeps the kit, leaves a receipt and answers; the phone checks the creation and opens its wallet (section 7.9).
1. **A new device.** On a new phone the user chooses "I lost my phone" and scans the code the recoverer's page shows for that wallet ("Customer lost their phone" at a bank, "… lost their phone" for a friend). The phone makes a new seed and gives the recoverer a **takeover message** over the session the code offers (section 14.4), sealed to the recoverer's encryption key: the hash of its controller key, its viewing-key record signed with that key, the access to a new backup archive, and an encryption key of its own for the answer in step 6. Nothing in the message needs the identity, which the new device has not been told. The recoverer saves the message for the wallet whose code was scanned. (A takeover message that arrives as a link, or on a code that is not for one wallet, is saved in the page's list of requests and assigned by hand, after comparing a fingerprint of the proposed key, as before.)
2. **The recoverer satisfies itself** that the person is the wallet's user and that the proposed key is theirs, before it shows the code: whoever presses "lost their phone" has done so. How is the recoverer's own process; the design depends on it.
3. **Request.** The recoverer signs `requestRecovery` naming that key hash, as soon as a takeover message arrives on the code of a lost phone. The controller is Pending, on chain.
4. **Wait, and the owner's chance to refuse.** Everyone computes the end of the wait from the chain; it counts from the block that holds the request (section 5.4), and the owner's wallet warns as soon as the request is seen. A wallet that still works and did not ask for this cancels. If the request is cancelled or reorganized away, the recoverer stops.
5. **Complete.** After the waiting period the recoverer signs `finalizeRecovery`. The proposed key is the owner; the epoch has gone up. No coin has moved.
6. **Hand over.** As soon as the network shows the completion, in a block or not, the recoverer gives the new device, sealed to the device's encryption key: the identity, the identifier of the creating transaction, the viewing-key record of every earlier seed, the access to earlier archives, and its receipt for the kit as it now stands. It reaches the new phone over the session of the lost phone's code when both pages are open; otherwise the new phone scans the hand-over's code on the recoverer's screen. The new device checks the identity's history itself and sees its own key as the owner. If something the recoverer should hold is missing, the device says so; it does not report an empty wallet.
7. **Sweep.** The new device finds the coins and moves them to addresses of its own seed (section 11.2). It starts as soon as the quick pass has found something and goes on until the full pass has finished for every earlier seed. It moves first what is worth most, and it counts a token it does not understand as possibly valuable: such a token may carry authority over a position worth far more than the coin it sits on.
8. **Understand what the tokens are.** A swept NFT is already under the new owner's control. To show it as "a jar with 0.3 BCH that opens in March", the wallet needs the application's template, from the backup or from the application when the user connects again, and the position the token controls. It reads the position records of the earlier archive, checks each against the chain (section 10.4), and makes the scripts of those that count known to the XO engine, with their values. A token without a record is listed as a token; the wallet does not search for what it controls. Recovery does not wait for this.
9. **Resume protection.** The new device watches the controller and keeps watching earlier addresses. It says that recovery is on once the recoverer's receipt names its viewing-key record.

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
- **A large wallet is swept in several transactions.** Each spends the controller output of the one before. An interruption between parts loses nothing: what is not yet swept is found again by the same search.
- **A wallet with tokens and no BCH still needs a fee.** The new device must have a source: a coin received at a new address, or one given by the recoverer.
- **A sweep also cancels a pending request,** since it uses `ownerAuthorize`.
- **Nothing is put aside for cancelling.** A device that has just taken the wallet over pays for refusing a request as any device does (section 8). Before the sweep, the coins at earlier addresses can pay: the controller releases them in the same transaction, and the change goes to an address of the new seed.
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

### 12.1 Two rules for an application, and one job for the wallet

An application that follows two rules can be used with this wallet and comes back after a recovery. It does not have to know that recovery exists, and nothing has to be written for this wallet.

| Rule | Statement | Means |
| --- | --- | --- |
| 1. Authority is a token | Whoever may act on a position is whoever spends its ownership NFT in the same transaction. | No user key or key hash inside an application contract. A key cannot be replaced; a token can be moved. |
| 2. The wallet's parts are the wallet's business | The application does not assume the wallet's inputs are P2PKH or have a fixed size. What the user receives goes to a script that the user's role provides, not to a key the template makes for the user. | In an XO template: the output's locking script is a variable that the user's role has to provide. "Back to the address it came from" is acceptable: after a sweep that is a new address. |

Both are properties of the contract and of how its template is written. Neither is an addition for this wallet: a template written for XO in this way serves any wallet whose own scripts are not keys under the application's template.

**The wallet's job: finding the position again.** Version 0.4 made this a third rule for applications: from the token and the chain, a wallet had to be able to find the position. That asked contracts to keep their values on chain and authors to say where. In this version the wallet keeps a record of every position it makes (section 10.2), and the chain confirms the record (section 10.4). An application's contracts keep their values where they like.

### 12.2 Why these are enough

- **Recovery never touches an application contract.** The sweep moves the NFT from one wallet address to another. The position stays where it is.
- **The application's transaction layout is its own.** The controller is not in application transactions, so an application may fix its input and output positions as it likes.
- **A wallet can recover what it does not understand.** The meaning of a token can be learned later.
- **Liquidation, vesting, repayment and other conditions of the application are untouched.** Recovery restores the remaining rights, not an earlier state.
- **Part of this can be checked by a program.** Whether an action leaves something at a script that takes a key of the device, and whether the user's outputs are left to the user's role, the wallet sees from the template and from the transaction it builds. Whether a contract gives authority to the token and to nothing else takes reading the contract and testing it.

### 12.3 What an action leaves behind

The wallet judges actions one by one. Version 0.4 refused a whole template when one of its scripts broke a rule. This version looks at what each action leaves behind: the outputs of its transaction that sit at a script of the application's template and that the wallet would follow in its role. The wallet knows them before the user is asked, because it works the transaction out itself. A script that many users share, which a template marks as one a wallet need not follow, is not among them: what an action leaves there is found again through the token, and the token's record (section 10.2).

For each action the wallet has to reach one of three findings:

| Finding | When | Example |
| --- | --- | --- |
| **It comes back** | The action leaves nothing outside the wallet's own addresses; or what it leaves is at a script that takes no key of the device, and is opened by a token the wallet holds | A trade; a payment into someone else's position; taking everything out of one's own. Opening a Savings Jar; a ParyonUSD loan |
| **It does not come back** | The action leaves something at a script that takes a key of the device | A pool opened by a key hash |
| **The wallet cannot tell** | The template uses something the wallet cannot analyse: for one, a rule for which scripts to follow that is given as an expression, which the engine does not evaluate yet | |

What "comes back" needs besides: the position's record on a store before the signature leaves the wallet (section 10.5).

- **A key of the device** is one the engine makes for the wallet under the application's template. A program can see that a script takes one.
- **What a program cannot see** stays outside all three findings: a key hash that reaches a script as plain bytes, what an application keeps on its own servers, and a position that someone else's transaction changes later. Trusting a template remains the user's decision (section 14.3).
- **The finding concerns what an action would add.** An action that only empties or closes a position leaves nothing behind.

What the wallet does with the second and third findings is not part of this rule. Section 12.5 says what is left open and what this wallet does.

Excluded for good: positions whose owner is known only to a server, including accounts opened by signing a message; and front ends that insist on building the transaction themselves from the wallet's public keys.

Not solved by the rules: a position that changes without the wallet. A loan that is liquidated or redeemed leaves the wallet holding a key to nothing, and a record that names a coin which is gone. "Closed" and "not found" are ordinary answers.

A token that carries authority is a bearer instrument: whoever gets it spent in a transaction of their own shape can exercise it. The wallet therefore spends such a token only in transactions it built itself from a template the user trusts, and shows the user everything the transaction moves, not only the wallet's own coins. What it shows is what this transaction does. It cannot show what an unfamiliar contract will allow later; that rests on the user's trust in the template. A token of unknown meaning can always be held and swept without trusting anything.

A payout that arrives long after its address was fixed, such as a contract's payout at maturity, should name a vault address. An ordinary address would by then be an earlier address, which the earlier seed can still spend. The wallet cannot see from a template that an address is kept for later. The request says so (the kind `lasting`, section 13.3); where it does not, the wallet gives an ordinary address, and what arrives there after a recovery is swept like anything else at an earlier address.

### 12.4 Where existing applications stand

Contract findings are from published sources; none but ParyonUSD was run with this wallet.

| Application | Rule 1 · Authority | Rule 2 · Wallet's parts | What it would take |
| --- | --- | --- | --- |
| ParyonUSD | Met. Loan key NFT; staking receipt NFT. | Contracts: no condition found. Front end: P2PKH wallets only. | An XO template and a front end. No contract change found necessary. |
| Moria | Met. Borrower NFT, named in the loan by its hash. | Front end: P2PKH wallets only. | The same. Its chipnet deployment was not checked. |
| Cauldron | Not met for pools: a pool is opened by a key hash written into it. Trades hold no position. | Met for trades | Trading needs only a template. Recoverable pools need a pool variant whose withdrawal follows a token, a contract change. |
| BCH Bull (AnyHedge) | Partly. The payout goes to any script, so to a vault address. Early exit needs two fixed keys. | Not studied | Payout at maturity survives recovery as it is. Early exit needs authority by token or by address. |

The pattern: applications that already use an ownership NFT need an XO template and a front end that sends requests; applications that wrote a key into a contract need a contract variant.

With actions judged one by one, the last two rows read differently from version 0.4. Trading on Cauldron leaves nothing behind and comes back; opening a pool does not. Entering a BCH Bull contract puts a key of the device into its script, for the early exit, so the finding is that it does not come back, although the payout at maturity would survive a recovery. A program cannot tell the two apart.

### 12.5 What is left to whoever builds the wallet

Sections 10.4 and 12.3 say what a wallet of this kind has to work out, and that it must not present something as coming back when it does not. What it then does is its own choice. The design is meant to be used by more than one wallet: a bank may offer one that refuses, another may let the user choose, a third may take more on itself.

| Situation | Possible answers | This wallet |
| --- | --- | --- |
| An action would leave something that does not come back, or the wallet cannot tell | **Refuse.** **Warn and go on:** the user accepts that this is tied to the device. **A workaround:** for one, the recoverer keeps a copy of the key for that position. The recoverer can then spend that position at any time, without a request and without a wait, which is the one thing the design denies it everywhere else; a wallet that does this has to say so. | Refuses, and treats "cannot tell" like "does not come back" |
| No store confirms a position's record | Wait. Or go on and show the position as not yet backed up, until a store has it. | Waits |
| A position that is not confirmed after a recovery | Show it apart and pay nothing into it. A wallet must not show it as confirmed. | As stated |

Warning and going on, and key keeping by the recoverer, are not built in this version.

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
| XO's standard wallet | Ordinary single-key coins: the recoverer's balance; the funding address of a wallet that creates itself (tests and earlier runs) | The funding key; the key of the recoverer's balance | Pinned version |

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

### 13.3 What the wallet takes from a template, a request and its record

The wallet builds an application's transaction from three things, and none of them is written for this wallet.

| Source | Who makes it | What the wallet takes from it |
| --- | --- | --- |
| The template | The application's author, for XO | The actions and roles; what each role has to provide; the transaction of each action, with its inputs and outputs and their places; which scripts a wallet follows, and which take a key; the actions a script offers to whoever holds it; the names of all of these |
| The request | Whoever starts an action: an application's page today (section 14.2) | The action and the role; the values only the application knows, among them what it read from its own coins; which of the wallet's tokens the action spends; the application's own coins to spend; the kind of an output of the wallet's that is not a plain receipt |
| The position record | The wallet, when the position was made (section 10.2) | Which token belongs to which position; the script and its values; the other values of the action that made it |

**Where a value comes from.** A template says, for each action, which variables the wallet's role has to provide. The wallet fills each from the first of these that applies:

1. **The record,** for the values of the position's own script, in an action that spends, continues or pays into that position. They are what the position is, and neither a request nor the wallet replaces them, an address among them included.
2. **The wallet itself,** for what is its own to give. A token category that the action creates comes from a coin of the wallet's, which becomes input 0; the wallet knows that an action creates a category when an output of the action's transaction names the variable as its token's category and no input does. A locking script that the request does not supply is an address of the wallet's, made for this action.
3. **The request.** A locking script that the request supplies is taken for someone else's: the wallet's figures show that output as leaving the wallet.
4. **The record's other values,** only in an action that spends the position.
5. **The user,** for a value a person can type, such as an amount or a date, when the wallet acts without a request.

A variable that none of these fills stops the action. With a request, the wallet refuses and names the variable. Without one, it says that the action is done through the application.

Two things the record never supplies, both shown by the trial of stage 11, which first filled values in the order version 0.6 gave at that time: an address outside the script's own values, since the one in use when the position was made belongs to the earlier seed; and an amount for an action that only pays in, since the user's own figure would be replaced by the one the position was opened with.

**An output of the wallet's.** The wallet fills such a variable itself, with one of four kinds of address. A plain receipt needs nothing said. The request names the kind where it is another:

| Kind | The wallet supplies | Number taken |
| --- | --- | --- |
| `receive` | A fresh ordinary address, for a coin or token created now. Key chain 1, secret kind `0x01`. This is what the wallet gives when nothing is said. | The next of chain 1 |
| `change` | A fresh ordinary address for what is left over. The same chain. | The next of chain 1 |
| `return` | The locking script of the wallet's coin that holds the token the action spends. For contracts that require a token to go back where it came from. | None |
| `lasting` | A vault address, for an address stored now and paid later. Secret kind `0x02`. | The next vault number, or one already given out if the user chooses |

Chain 0 is only for addresses the user gives to people. The limits, and the rule for actions that are not carried out, are those of section 7.7. A `return` is refused when the token sits at an address of an earlier seed: such a token is swept first. A token at a vault address is moved to an ordinary address before an application action.

Version 0.4 proposed a property in XO's schema for this, and until then a declaration beside the template. Neither is needed: the template already says which variables the role has to provide, and the request already carries the kind.

**The token an action spends.** The request says which position an action is about, by the token's category, and separately whether the action spends the token: paying into a jar is about its key and does not spend it. When the wallet acts by itself, the token is the one of the position's record. A template can give the token a place of its own: an input that names the token's category and has no unlocking script, at a fixed index. XO's validator accepts such an input (tried on 20 November 2026 with the Savings Jar's template), and a contract that needs to know where its key is can then be given the index as a constant. An action whose transaction has such an input spends the token, whatever a request says. The engine built and signed a withdrawal with the wallet's key coin in that place (stage 11). It does not look at what the input says about its token, so the wallet itself makes sure that the coin it puts there is the token. Where the template names no such input, the token takes the lowest free place.

**The application's own coins.** Contracts that many users share (a price, a factory, a fee collector) appear in a transaction as inputs that are neither the wallet's nor the position. The request names each by outpoint, for the template input it is spent as. The wallet reads the coin from the chain and does not take the request's word for what it holds. Which of the template's scripts the coin sits at, the wallet finds by comparing the coin's locking bytecode with the scripts the template gives; a template does not always say which script an input belongs to, and Paryon's does not. It does not look for such coins itself: an action that needs one is done through the application. The same holds for a position at a script that many users share, where the request names the coin that is the position.

**Protection without a declaration.** Version 0.4 checked a request against the declaration. What protects the user now does not depend on the application:

- **The wallet's own figures,** worked out from the transaction it built: what goes where, what the wallet gives and gets, which tokens leave it or end (section 14.3).
- **A token of the wallet's that an action spends comes back to the wallet, and comes back unchanged,** or the review shows it leaving, changed or ending and asks for the user's tick, as it does when a token that controls something is sent (section 8).
- **A token made from the wallet's own coin** that does not come to the wallet is shown as going to the application, and the action is carried out only with the user's tick. Paryon's first step is such an action: it makes a loan's key from the wallet's coin and leaves it in Paryon's contract until the loan is opened, so every new loan asks for the tick once.
- **The application's contracts are run before the user is asked** (below). A coin that the request names and that does not belong with the wallet's token is refused there, by the application's own rules.
- **The record is written from the transaction as built.** What the wallet later finds is what it made, not what a request said.

**Acting without the application.** A template says which actions a script offers to whoever holds it. From its list of positions the wallet offers those actions, and carries one out by itself when every value it needs is in the record, is the wallet's own to give, or can be typed by the user, and the action spends no coin of the application's. Emptying a Savings Jar is such an action. Closing a ParyonUSD loan is not: it spends Paryon's price coin and needs that coin's state. For those the wallet says "Open the application to do this" and shows the address of the application's page from the record. Version 0.4 could do more here, because its declaration told the wallet how to find and read an application's coins.

**Order in the transaction.** An item the template gives an index (`inputIndex`, `outputIndex`, XO's own fields) goes there. The coin that defines a new token category is input 0. Everything else takes the lowest free place: first the template's items without an index, in the template's order; then the token spent, the wallet's coins that carry fungible tokens, and its other coins; among outputs, then change in tokens and what is left over, each at a fresh address of chain 1. A place left empty is a refusal.

**Fungible tokens and tokens that end.** Where the outputs need more fungible tokens than the application's coins bring, the wallet pays them from its own and takes back any excess as change in tokens, on a coin of the least value. Tokens on a data output, and tokens of an application's coin that no output carries on, are allowed, and the wallet shows them as destroyed.

**The application's inputs are run before the user is asked.** With the transaction worked out, the wallet evaluates each input of the application's in the virtual machine, with bytes of the right length standing in for its own signatures. A value from the application that the contracts would reject is refused at that point, with the contract named. After signing, every input is evaluated again against the outputs read from the chain (section 13.4).

**What the wallet calls a token.** In version 0.4 a declaration could give tokens a name, a symbol and decimals. Without it the wallet has less to go on:

- **An NFT that a record ties to a position** is named after the template and the output that made it: "Jar key, Savings Jar". The name is the template's claim, shown only for a template the user trusts.
- **A fungible token** is shown by its category, in raw units. A typed amount is in raw units too.
- Names and decimals are to come from a token registry (BCMR) once the wallet reads one (section 22). What a registry lookup tells a server about the wallet has to be settled then.

**What becomes of the recovery declaration.** It is retired. The wallet of this version reads none, announces no profile for one (section 14.2), and stores none. The second design, with its declarations and the code that reads them, is at the tag `design-2`. [docs/xo-position-recovery.md](docs/xo-position-recovery.md), which proposed the declaration to XO's authors on 20 November 2026, stands as the record of that approach; what it asked of XO is no longer asked (section 13.6).

### 13.4 What is needed from the engine

- Outputs and inputs that are the wallet's own, filled as section 13.3 says.
- Actions that create a token category, with the wallet supplying the coin that defines it.
- A transaction that combines an application's template with inputs and outputs of the wallet's templates.
- Many addresses of one script, with keys chosen by a counter.
- Taking over an existing identity with a new seed.
- Valid `0x61` signatures for transactions with several inputs.
- Following a script again, in an account that did not make it, from its template, its locking script, a role and the values it was made with.

Stage 0 showed the third, fourth and fifth, with the wallet's own templates on both sides of the third; an application's template of a third party is tested in stage 7. The first two the wallet does in its own code, from the template and the request, and has done since stage 7; nothing is asked of the engine for them. The sixth is not available: inputs the engine signs use `0x41`. The last is what a new device does with a position it found from the chain, and has run on chipnet for the Savings Jar and the ParyonUSD loan: the wallet makes an invitation for an action of the template that pays to the script, gives it the values, adds the output and puts the invitation aside, and the engine follows the script from then on. A position record is handed to the engine in the same way. The trial of stage 11 showed that it is enough: an account on a new seed, given the template, the locking script, the role and the script's two values, followed a Savings Jar, listed its coins and emptied it (`docs/stage-11-trial.md`).

Stage 9 added one finding. To unlock a coin by its template the engine follows the coin's script, which means fetching and proving every transaction in that script's history. For a script every user of an application shares this does not end in practice: Paryon's Borrowing script had 76,637 entries on chipnet, and following it held a process at full load for more than ten minutes. A template can mark such a script's role as one a wallet need not track (`relevant: false`, XO's own field). For those, and for any script with more than 50 unspent coins or history entries, the wallet compiles the unlocking from the template itself and hands the coin to the engine with it, as an input of another participant; the engine builds the transaction and signs the wallet's inputs. The wallet also gives every input and output its place in the transaction explicitly, since the engine otherwise puts the template's indexed items first.

Where the engine cannot do one of these, the wallet does it in its own code and uses the engine for the rest. Code of the wallet that fills such a gap works from the template and the kinds of wallet-bound output, and names no application. Every transaction, whoever built it, passes this project's own script check against the outputs it spends before a signature leaves the wallet.

### 13.5 Limits

A template can teach a wallet how to build an application's transactions. It cannot supply missing data, sign for a lost key, or give authority that a contract does not grant. A record can supply data that the wallet itself once had; nothing supplies what only an application's server knew. Operating a position without the application's site is an aim; it depends on the template, the token and a compatible engine, and does not reproduce the site's interface or its off-chain services.

### 13.6 State, and XO's synchronisation

**What the engine keeps.** For every script it follows, the engine stores a record of its own (`ScriptHashData` in `@xo-cash/state` 0.0.5): the script hash and the locking bytecode, the template's identifier, the locking script's identifier, the output and the role, the invitation that made it, the names of the secrets it uses, and the variables it was made with. This is the state a position needs. It is in the storage of one device, under one account, and an account belongs to one seed.

**What XO offers for moving it.** The state package describes synchronisation with remote servers. Its class for that, `RemoteEncryptedStateManager`, takes a list of servers and is marked "Not implemented yet". The engine learns of a script only when it builds or receives the invitation that made it, or when it is asked for an address; it does not search from a seed.

**What XO's authors said** when asked how a position should come back on another device (20 November 2026, in their public chat, in reply to [docs/xo-position-recovery.md](docs/xo-position-recovery.md)):

| Their point | What this design does with it |
| --- | --- |
| Where the token alone predicts the script, a template action can generate it again and have the engine follow it | Not relied on. It works only for applications that keep their values on the token, and something would still have to tell the wallet which value sits where; that was the declaration. The wallet does make a script known to the engine in this way, from a record (section 13.4). |
| If the action that makes a position includes both parties, the recoverer holds state too | Not taken. The recoverer would be a party to every application's template and would have to be reachable for every action (section 9.8). |
| Where both the first state and the current state are needed, state has to be synchronised | Taken, as the position record (section 10.2). The wallet writes one after every action of its own that changes a position. What someone else's transaction changes, the application has to say again. |
| State can travel in an invitation that hands something over, from a party that has it to a party with the same template | The record is that hand-over made ahead of time: the old device is the sender, the store is where it waits, the new device is the receiver. After a loss there is no sender left to make one. |

**The wallet's own store now, XO's later.** The position record keeps the engine's field names, so that the transport can change without the wallet's rules changing. XO's synchronisation could carry the records in place of this project's stores if it offers three things:

1. **A key that can be handed on.** After a recovery the earlier seed is gone. A key for the synchronised state that derives only from the seed is lost with it; the wallet has to be able to give it to the recoverer with the kit.
2. **Reading an earlier account's state under a new seed.** A new seed is a new account. The new device has to read the state of the earlier one and take from it only the scripts of applications, not the earlier seed's own addresses and keys.
3. **A confirmation before signing.** The rule of section 10.5 needs to know that a record is stored before a signature leaves the wallet.

Whether XO plans these is not known. The checks of section 10.4 stay whatever carries the records: a synchronised record is a suggestion until the chain confirms it.

**Where this wallet differs from what XO assumes.** It is not the wallet's script addresses: the engine's default policies let a wallet name any template for its own addresses, and everything here runs on the engine as published. It is that the wallet replaces its seed. XO takes an account to be one seed for good: keys are made for each template from the seed, and the state is kept for each account. A wallet with ordinary single-key addresses that replaced its seed would meet the same three things: keys under an application's template are gone, the engine's state belongs to the earlier account, and a synchronisation tied to the seed cannot be read.

**What is asked of XO.** Nothing is required. This version runs on the engine as published and relies on three things staying as they are: an invitation of one template takes inputs and outputs of other templates; a script can be made known to the engine from its template, locking script, role and values; a template can leave an output's script to a variable and can mark a script as one a wallet need not follow.

| Would help | What it would save |
| --- | --- |
| A supported call that makes the engine follow a script, given a template, a locking script, a role and the values. The engine offers this for the template of a default policy only. | The invitation that the wallet makes and puts aside for it (section 13.4) |
| A synchronisation that offers the three things above | This project's own stores, for position records |
| Word on how an invitation is meant to travel between an application and a wallet | This project's own `xo_v1` messages (section 14.2) |

**What XO plans for the first of these.** Asked about such a call, one of XO's authors answered on 20 November 2026: an action today results in a transaction or in arbitrary data, and XO expects to let an action result in a locking bytecode. An invitation for such an action is started and followed through to its end, and the engine then holds the script, with its follow-up actions where they are expected. That is the supported form of what the wallet does by hand, and no transaction takes part in it. Until it exists, the invitation that is put aside stays. As described, such an action is one the template defines; whether a wallet could then follow a script of a template whose author wrote no such action is not known, and for those the wallet's own way would still be needed.

No longer asked, against version 0.4 and `docs/xo-position-recovery.md`: a place for a recovery declaration in the schema; an engine that finds positions from the chain; a property that marks an output as the wallet's; expressions that read the fields of a coin a transaction spends.

## 14. Connecting to applications

### 14.1 Two kinds of wallet, one application

WizardConnect gives an application and a wallet an encrypted channel, started from an address the application shows as text or a QR code. The wallet page reads such a code with the phone's camera (section 17).

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
{ "xo_v1": { "version": 2, "network": "chipnet",
    "bindings":  ["receive", "change", "return", "lasting"] } }
```

The announcement lists no templates. A list of what the user trusts would tell each application which others the user deals with. The application names its template in the request, and sends it whole when the wallet answers that it does not have it.

| Message | Direction | Meaning |
| --- | --- | --- |
| `xo_action_request` | application → wallet | The template's identifier and content hash, and the text itself when the wallet has answered that it lacks it; the action; the role; the variables, among them what the application read from its own coins; for a variable the wallet fills with an address of its own, the kind, where it is not a plain receipt; the variable that receives the category of a token the action creates; which position the action is about, by its token, and whether it spends that token; and, by outpoint, the application's own coins and, for a position at a script many users share, the coin that is the position |
| `xo_action_response` | wallet → application | Taken on; refused with a reason; or "the template is needed", after which the same request is sent again with the texts |
| `xo_invitation_update` | wallet → application | Approved by the user; sent |
| `xo_action_result` | wallet → application | The transaction and the tokens the wallet received, or an error |
| `xo_template_offer` / `xo_template_answer` | application → wallet, and back | The application presents its template, with the texts, without asking for an action: for a wallet that holds a token of the template and has never used the application, a loan key that was sent to it for one. The wallet shows the template as it does with a first action and answers only when the user has decided: trusted in a session with this application, or declined. Trusted, the template goes to the backup at once where a store answers, since a token may already depend on it. An offer of a template already trusted with this application is answered at once. |
| `xo_positions_request` / `xo_positions` | both | Which tokens of this template does the wallet hold? Answered only for a template the user trusted in a session with this application. A template trusted on the device in another way, from the backup after a recovery for one, is not answered for until the user allows this application; the wallet asks the user then, and only then. The answer is made from the wallet's records: each token that a record ties to the template, with the value of the coin that holds it, which some contracts require an action to repeat. For a position at a script of its own it also carries the script's values and where the position stands: `open`, `closed`, or `unconfirmed` for one that the chain does not confirm (section 10.4). For a position at a script many users share it says only that the wallet holds the token; whether the position is open is the application's to find out. A token without a record is not answered for: the wallet cannot tell which template it belongs to. |

Version 2 of the extension differs from version 1 in three ways: no profile is announced and no declaration is named or sent; a request may name coins and a token without a declaration that describes them; and the answers to a positions request are those above. The messages use only the session's pairing and custom messages. (`packages/connect`; the announcement there still has to be changed to the form above.)

The wallet signs its own inputs with a type that covers every input and output: `0x61` where its signer produces a valid one, otherwise `0x41` (section 5.2).

### 14.3 Rules the wallet follows

- **An unknown template is shown to the user** with its name, description and actions, and is trusted only on their word. The wallet checks that the template is the one the request names, by identifier and content hash; a later download does not replace it. It is stored in the backup before anything is signed.
- **The wallet states what it knows about a template, and no more.** For a template it meets for the first time, that is what a program can see: whether a script of it takes a key of the device, and which actions would put something there (section 12.3). It does not call a template verified. Once a token made with the template has led to its position through a record that the chain confirmed, the wallet says that: this template has come back once. An audit of the contract is neither claimed nor implied.
- **Before the user is asked, the wallet works out what the action leaves behind,** reaches one of the findings of section 12.3, and acts as section 12.5 says for this wallet: it carries the action out once a store has the record, or refuses with the reason. The application cannot influence this any more than it can influence the wallet's figures.
- **The user sees two things before approving:** the action in the template's words, and the wallet's own figures from the transaction it built: what goes where, what the wallet gives and gets in coins and in tokens, what goes into the application or comes back from it, which coins of the application are spent, which tokens are destroyed, the fee, the earliest time. The application cannot influence the second. The review opens with a picture drawn from these figures: the wallet, the application as its template names it, what goes each way in Bitcoin Cash and tokens, and by how much the wallet goes up or down, the fee included. What asks for care stays in view: what the wallet found about the template, a token of the wallet's that leaves it, tokens destroyed, a payment the wallet makes to itself first, the earliest time. The figures in full, every coin in and out, and the template's identifiers are folded under named sections.
- **A request is carried out at most once.** It is identified by its id within the session's pairing; a repeat, or a reconnect, gets the stored outcome, and the same id with other content is refused.
- **The application is never sent the identity, a viewing key, or anything about other applications.** It learns the addresses that appear in its own transactions. It can study the chain like anyone.
- **A position is a token with a record.** The wallet answers a positions request from the NFTs it holds and the records that name them. A record that the chain confirms is answered as open or closed, and one that it does not as unconfirmed. A token without a record is not answered for, and a record without a token in the wallet is no position.
- **The wallet signs with address keys.** The controller is not part of an application's transaction.
- **An action that is not sent releases the coins it named,** unless a signature has left the wallet. In that case the wallet first finds out whether the transaction can still be sent by someone else. A time-out is not a withdrawal. Addresses made for the action follow the rule of section 7.7.
- **A session's lifetime has nothing to do with the waiting period.** A recovery is followed from the chain, not from a connection.

`xo_v1` is this project's own extension, as is `gw_recoverer_v1` below; no other wallet speaks either yet. XO has invitations and a sync client but no protocol between a website and a wallet. A standard would best come from XO, or as a WizardConnect extension that both projects agree on.

### 14.4 Between the wallet and a recoverer's page: `gw_recoverer_v1`

The wallet and the recoverer's page meet over a WizardConnect session, under a second extension of this project's own, separate from `xo_v1`: a recoverer is not an application, and neither extension's messages are taken by the other. Over it a phone has its wallet set up (section 7.9), a new phone asks to take a wallet over and receives it after the waiting period (section 11.1), and a device sends a new recoverer its kit (section 9.7).

The recoverer's page takes the part an application takes: it shows the session's `wiz://` address, inside its code, with its name, the address of its page and its encryption key. The phone that scans the code has the recoverer's particulars at once, joins the session, and is told what the recoverer offers a new wallet. The wallet announces the extension in the session and offers no key paths and nothing of `xo_v1`; the page answers only a wallet that announces it.

```
{ "gw_recoverer_v1": { "version": 1 } }
```

| Message | Direction | Meaning |
| --- | --- | --- |
| `gw_recoverer_particulars` | recoverer's page → wallet | The name, the page's address and the encryption key, as the code gives them, and, from a page that sets wallets up, its offer: the waiting period it creates wallets with and the starting balance. Sent when a wallet connects. The wallet sends nothing to a page whose key or address differs from the code's. |
| `gw_recoverer_enroll` | wallet → recoverer's page | A phone's enrollment request, sealed to the recoverer's key, with an identifier the phone chose. The phone sends it again every few seconds until it has an answer, after a reload too; the same identifier is the same request. |
| `gw_recoverer_enroll_answer` | recoverer's page → wallet | `received`: the page has it (a friend's page then asks before it creates). `created`: the identity, the creating transaction and the recovery key hash, which the phone checks against the chain. `refused`, with the reason: a waiting period the recoverer no longer uses, a balance too low, a person who said no. A request that arrives again is answered from what the page keeps: the same wallet, never a second one. |
| `gw_recoverer_sealed` | wallet → recoverer's page | Sealed bytes, exactly what a link of that kind carries, and the kind: a kit for a new recoverer (`enroll`) or a new phone's takeover request (`takeover`). An identifier made from the bytes; a repeat gets the answer it had. |
| `gw_recoverer_sealed_answer` | recoverer's page → wallet | `received`: the page has it. `kept`: it passed the page's checks; for a kit, the receipt is on the stores; for a takeover on a lost phone's code, it is saved for that wallet and the recovery is requested. `refused`, with the reason. The same message from the wallet with `kept` says that it kept a hand-over. |
| `gw_recoverer_hand_over` | recoverer's page → wallet | After a recovery, the hand-over, sealed to the new phone's key: exactly what the hand-over's code carries. Sent again until the phone says it kept it. |

The session adds a way of carrying and nothing else. What goes to the recoverer over it is sealed to the recoverer's key, which only the recoverer's page holds, and what comes back is checked by the phone against the chain: the creation as any client checks it (section 5.7), the hand-over against the identity's history. The session's peer name is shown nowhere as proof. The answer `created` is not a receipt; recovery is on only when the wallet finds the receipt on the stores (section 9.5), which the recoverer leaves before it answers.

A session serves one phone, and only while both pages are open; the page offers a new one for the next phone. The wallet keeps its key for the session and the page keeps what opens the session again, so that either can be loaded again and the two meet on the same session. A phone whose recoverer's page does not answer within twenty seconds says so and offers to try again; nothing is shown to copy. The hand-over after a completion goes over the session of the lost phone's code if both pages are open then; otherwise the new phone scans the hand-over's code on the recoverer's screen. Update messages for a new seed or a new waiting period stay links. Sessions with applications are not touched by any of this. (`packages/connect/src/recoverer.ts`, `packages/connect/src/recoverer-session.ts`, `packages/app/src/set-up.ts`.)

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
- **The jar's address follows from the key alone:** P2SH32 of `SavingsJar(key.category, key.commitment)`. That was rule 3 of version 0.4; this version does not rely on it (section 15.3).
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

**From a page, in browsers** (18 November 2026, `docs/runs/stage-9-browser-chipnet.md`): a page of this project's own (`apps/loan`), which says on every screen that it is an independent demonstration and not Paryon's site, pairs with the wallet as the jar's page does. From it a loan key was made, Paryon's period brought up to date, 100 PUSD borrowed against 60,188,752 satoshis (125% at the oracle's $207.79), and collateral added. The page reckons collateral at the lower of the stored price and the oracle's, and takes nothing under 115%. The wallet's review showed, from its own figures, the PUSD received or paid, what an action destroys, Paryon's coins spent, and what goes into Paryon or comes back. Then the phone was lost; after the recovery the new phone listed the loan with its debt and collateral, read from the chain in the template's words, and closed it without the page. The course cost 107,954 satoshis, 90,915 of them Paryon's fee.

**What was not:** the other 21 contracts (interest, redemption, liquidation, staking) were read only as far as they bear on a loan of this kind. Paryon's transaction-building library is not public; this project's is written from the contracts. The deployment's parameters are published only inside Paryon's web application. Paryon's contracts repository states no licence, so the npm package is used as a dependency and not copied.

One consequence for privacy: because managing returns the loan key to the script it left, the key stays at one address for as long as the wallet does not move it. That address is known to anyone who looks at the loan. A sweep moves the key, and the key's public history then links the loan to the recovery.

### 15.3 The two applications in this version

Sections 15.1 and 15.2 describe the applications as the second design ran them, each with a declaration. In this version neither has one.

**Savings Jar.** The contract is unchanged. The template changes in one place: the key becomes an input of its own that names the key's category, at a fixed index, and the jar's unlocking gives that index as a constant in place of a variable the wallet had to fill. Everything else a withdrawal needs is then in the record or is the wallet's own to give, so the wallet empties a jar by itself, after a recovery too. The date stays on the key: an ordinary wallet keeps no record, and the jar's page finds a Cashonize user's jar from it. A changed template has a new identifier; jars opened with the earlier one are emptied with the second design's build first.

**ParyonUSD.** Paryon's contracts and the template's scripts are unchanged. What the declaration held moves to the loan page (`apps/loan`), which is this project's own:

| The declaration said | Now |
| --- | --- |
| How to find the loan from its key, through the sidecar coin | The wallet's record says which key belongs to a loan of this template. The page asks the wallet for its positions and finds the loan's coin and its sidecar itself. |
| Which of Paryon's shared coins an action spends, and what each must hold | The page names them by outpoint in its request. Paryon's own contracts, which the wallet runs before the user is asked, refuse a wrong one. |
| The values read from those coins and from the loan | The page reads them and sends them as variables |
| That the loan key goes back to the script it left | The page says so in its request (`return`) |
| What a loan holds, and whether it is still open | The wallet shows the key under the template's name. The debt, the collateral and whether the loan is open are shown by the page, which no longer takes the wallet's word for the last. |
| What the coin that holds the key is worth, which Paryon's contracts require an action to repeat | The wallet's answer to a positions request carries it, and the page sends it back as a value |

The record for a loan is written when the key reaches the wallet, at the borrowing; the step before it, which makes the key and leaves it in Paryon's contract, delivers nothing to the wallet and leaves nothing the wallet follows. The page already has the code that finds a loan and its sidecar from a key and reads Paryon's coins (`packages/paryon`); what it lacks is naming them in its requests.

After a recovery: the user opens the loan page on the new phone and connects; the wallet answers with the key and the record; the page builds the request; the wallet shows its own figures and signs. The second design closed a loan with the page not opened. This version does not, and says "Open the application to do this" where the user taps the loan.

**A page is replaceable.** Both pages are static files whose only dependency is the chain's servers. Anyone can serve them, from any address, and the template they send is identified by its hash. The wallet keeps the address a request came from in the position's record and shows it when an action needs the application; the user can open another copy. This is the answer to an application's site going away, in place of the wallet doing the application's work.

A template for the tests alone, with a script that takes a key of the device and an action that pays into it, shows the finding of section 12.3 on the simulated chain. No application is built for it.

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
| Creating the wallet | The recoverer's coins it was created from, the address of the recoverer's balance, where the change goes, and the address of the starting balance (section 7.9) |
| Any controller transaction that a wallet coin pays for (cancel, change of settings) | That coin and its change |
| The recoverer's request and completion | Coins of the recoverer's balance and its address, which every wallet it created or acted for shares (section 9.6). Nothing leads to a coin of the owner. |
| Sending everything, when a coin in it needs the controller | Every coin in that transaction, and the address it pays |
| Closing | Every coin in the closing transaction, and the address it pays |
| A sweep | Every address swept, and the new addresses the coins go to |
| Spending from a vault address | That vault address |

Nothing else the wallet does shows the identity. A link, once made, spreads in the ordinary way: a coin that is tied to the identity ties to it whatever it is later spent together with.

### 16.4 What a recovery reveals

A sweep has the controller as its first input and shows the identity in every swept input. Everything the wallet held at that moment is tied together. Coins received afterwards at new addresses are not, until they are spent together with coins that are. A token whose history is public, such as a loan key, links its position before and after the sweep.

Limiting this would take several controllers, each covering part of the addresses, at the price of enrolling and watching each. Hiding it fully would need a way to prove the link without showing it, which this project has not found for Bitcoin Cash and does not claim. Neither is part of this design. A later version of the wallet's scripts could add either without changing applications, because applications are never sent the identity or the controller and deal only with tokens, and because an address shows nothing about how its tag was made. Coins stay under the rules of the address they are at.

### 16.5 What the recoverer sees

The recoverer can read the wallet. That is a consequence of asking it to hold what a new device needs. With the content key of the backup it can also read which templates the user trusted and, new in this version, the position records: which positions the wallet holds in which application, and the values each was made with. Where an application keeps a position's values off the chain, the recoverer is then the one party besides the owner who can know them. It needs none of this for its work (section 9.8). A later option is to seal the viewing key under a phrase the user remembers, so that the recoverer keeps it without being able to read it; this trades the recoverer's view for something the user must not forget, and is not part of this proposal.

## 17. User experience and background operation

**Owner.** It should feel like enrolling in a bank's mobile app. The first screen asks whether the user starts a new wallet or had one before. Under "New wallet" it offers "I have a code from my bank" and "Someone I trust is setting it up"; under "I had a wallet before", quieter, "I lost my phone", "I still have my old phone" and "I have my own backup". Each of the first two opens the scanner, then shows "Setting up…" (with "Waiting for … to say yes" when a friend is asked), then "Your wallet is ready" with the balance and "Protected by …". On a test network the scanner's screen also names the deployment's own recoverer page, where someone trying the wallet out can act as the bank or the trusted person; on the main network it names none. The waiting period is shown as a fact. A set-up that did not hold says so on the first screen. Then: "Protected", "Someone asked to move your wallet", "Cancel". Wallet screens that are new or changed have a title, the main figure and the main action; an explanation is at most one short line, and the rest is behind a tappable "?". **Recoverer.** The first run's choice, the balance and its address, "New customer" or "Help someone set up", "Set up …'s wallet?", the list of wallets, "… lost their phone", the state of the request, the end of the wait as the chain gives it, "Complete". The recoverer's page may say more: it is not part of the wallet's experience. Template identifiers, invitations, roles and inputs are not routine user tasks; they stay available for developers and for troubleshooting.

**Little text.** The owner's screens show a title, the main thing and the main actions. An explanation sits behind a small "?" beside what it explains, a heading, a label or a figure; a tap opens it over the page and a second tap, a tap elsewhere or Escape closes it. Nothing the screen used to say is lost that way. What guards against losing coins or tokens is never behind a "?": a plain address refused for a token, a token that controls something with its tick, an address shown again, too little Bitcoin Cash for a fee, and in an application's request what the wallet found about the template, a refusal with its reason, a token of the wallet's that leaves it, tokens destroyed and a payment the wallet makes to itself first. Receive, Send and the review of an application's action follow this; the other screens of the owner's wallet are to follow. The recoverer's page keeps its fuller wording.

**What an application leaves behind.** In this wallet the user is not asked to judge whether something can be recovered. The wallet works it out (section 12.3), does what section 12.5 says for this wallet, and shows something only where it matters:

| Case | What the user sees |
| --- | --- |
| The action comes back | Nothing more than the review of the action |
| No store confirms the record | The action is not offered for approval. "Your backup can't be reached. Try again in a moment." |
| The action would leave something that does not come back, or the wallet cannot tell | A refusal in place of the review: "This would tie money to this phone alone. If the phone is lost, nobody can get it back." |
| An action that needs something only the application knows, tapped in the wallet's own list | "Open the application to do this", with the address of its page |
| After a recovery, a position the chain confirms | Listed as before the loss |
| After a recovery, a position the chain does not confirm | Listed apart and greyed, as "Not confirmed", with a "?". Taking out is offered; paying in is not. |
| A token with no record | The token is listed, by the template's name where an earlier note gives one, and can be sent |

The refusal, "Not confirmed" and a backup that cannot be reached are never behind a "?". The words are proposals; the screens are to be pictured on a phone and on a desktop before they are built. A wallet that warns and goes on, as section 12.5 allows, needs screens of its own for that; none are designed here.

**Watching.** The wallet reads its controller's whole history again from several servers at each check and works the status out from nothing, so a reorganization or a replaced transaction is followed without bookkeeping, and one server leaving a request out does not hide it. (`packages/app/src/monitor.ts`.)

**How much the device knows.** A transaction's identifier proves its content. It does not prove that the transaction is confirmed, that its outputs are unspent, or that a server has told everything. A request that is seen, confirmed or not, is reason to warn at once. The end of a waiting period is worked out from confirmed blocks, never from the device's clock or from a countdown that a server supplies. Confirmation itself is taken from the servers the device is set up with, unless the device checks block headers. In this project's deployment those servers include the user's own node. The engine's header check does not work on chipnet at present (section 13.1), and a phone that verifies headers by itself is later work. Until then the wallet does not describe chain state as verified, and it reports disagreement between servers as disagreement.

| Status | Meaning | The wallet |
| --- | --- | --- |
| Quiet | Nothing is asked | — |
| Request to a key this device does not hold | Someone wants the wallet | Warns; cancels, by hand or automatically |
| Request to a key this device holds | Its own takeover | Waits |
| Owned by a key this device does not hold | A recovery or a change of owner has happened | Stops giving out addresses and says so |

**Cancelling costs a transaction.** Because ordinary use does not cancel, the device must be able to send one. Its fee, about 1,100 satoshis, comes from the wallet's coins like a payment's, and from a vault coin or an unswept coin at an earlier address when those are all there is (section 8). The wallet cannot pay only when everything it holds without a token comes to less than the fee, as with a wallet that holds tokens or application positions and next to no Bitcoin Cash. Then the warning screen, where the request is refused, says that a little Bitcoin Cash is needed to refuse, shows how much, and offers an address to receive it at; the button to refuse appears once it has arrived. This is said only there and only then: it matters only while a request is waiting. A phone that is switched on is not thereby watching the chain; background scheduling and notifications on phones need their own validation before any claim of protection is made.

**Codes between screens.** The owner usually has the wallet on a phone and the recoverer's page and the applications on a desktop. Every field of the wallet that takes a link or an address from another screen has a button that reads a QR code with the phone's camera, or from a picture. A scan fills the field as a paste would; a code of another kind is named and the scanner stays open. A tap on the camera's picture goes to the next rear camera, the camera that read the last code is the one the next scan starts with, and the browser's zoom is offered where it has one. The recoverer's code also offers the session of section 14.4, so that setting a wallet up, and asking for it on a new phone, needs one scan and no copying. A phone without a camera can paste the code's text instead. Camera switching was tried only in a browser with simulated cameras, and zoom, which those cameras do not offer, not at all.

**Tokens.** The wallet names an NFT that a record ties to a position after the template and the output that made it, and says which template. Every other token it shows by category and in raw units (section 13.3). Sending a token: the choice between Bitcoin Cash and a token, "Not a token address" with what to ask the receiver for when a plain address is given, the review with what goes and what comes back, and for a token that controls something, what it controls and "I understand that whoever receives this token gets what it controls" before it can be sent (section 8). Receiving: "Receiving a token?" shows the token-aware form of the address.

**Fees and emptying.** Before approval the wallet shows the fee of every transaction in satoshis, with any remainder that is too small to return. "Max" beside the amount fills in everything the wallet can send; the review then shows the amount that will arrive, and nothing is left behind. When the wallet holds too little, it shows the three figures instead (section 8). There is one button to review and one to send. Closing a wallet is not in the interface.

**A recovery while the old device still works.** If the user simply has a new phone, the old one moves the wallet with `ownerUpdate` and no waiting, in the order of section 9.7. If a request arrives and the old device is watching, it cancels; the software must not switch that off because a message says the recovery is wanted.

**When the wallet finds itself owned elsewhere,** it stops giving out addresses and taking on application actions, as soon as the network shows the change. Until a block holds the change, on more than one server, this is a pause: a completion can still lose to the owner's cancellation, and a change can be replaced by a holder of the owner's key. If it disappears, the wallet carries on by itself. Once a block holds it, the device has stopped for good, and resumes only if the chain names its key again. If the owner did not want the change, the device's keys still spend every coin not yet swept, and the wallet offers to move them out at once, to a wallet with a new identity, on the user's approval. This is a race against the new owner's sweep. Coins at vault addresses, and coins already swept, cannot be moved this way.

**Repeated requests** cost the owner a fee each and cannot take anything. The owner replaces the recoverer.

**What still waits for a block.** Everything that can go on before a block does: the recoverer's creation of the wallet, the phone opening it and giving out its addresses, the starting balance spent at once (section 7.9), the recoverer's receipt and recovery shown as on (section 9.5), a move to a new seed and a new recoverer (section 9.7), the hand-over after a completion and the new device's sweep (section 11.1), the backup of section 18.1. A transaction that disappears later takes with it what was built on it; the wallet follows the chain at every check, and coins at a device's addresses stay that device's by key. What waits, and why:

| What waits | Why it cannot go on before a block |
| --- | --- |
| The count of a recovery's waiting period starts with the block that holds the request | A relative time lock enforced by the network measures the age of an output, and an output not in a block has none. The period is the owner's whole protection, so it is measured by the chain and not by a clock anyone claims (section 5.4). The request itself is shown, and can be refused, at once. |
| A device stops for good only when a block holds another owner | Until then a completion can lose to the owner's cancellation. Retiring the owner's own phone on a transaction that then disappears would lock the owner out of the wallet. The device pauses at once and gives out nothing meanwhile, so nobody waits for this. |
| Time locks of applications | They belong to the applications' contracts (section 15), not to the wallet. |

Where the wallet shows whether something is in a block, as for a request it warns about, that is information and decides nothing.

**After a recovery, people who pay the wallet need a new address,** or should have been given a vault address. The wallet keeps watching earlier addresses and sweeps what arrives, but until it does, the earlier seed can spend it too.

## 18. Local backup, being one's own recoverer, versions

### 18.1 A backup the user keeps

The design does not need one and supports one.

- **What to keep for the current seed:** the twelve words and the wallet's identity (64 hexadecimal characters), with the network and the version of the address scheme noted beside them. A device with these is the same owner. It recomputes every key and address of that seed, finds its coins by searching, and needs no controller transaction and no waiting period. Nothing more is needed, because the search ranges belong to the scheme and not to the wallet.
- **What that leaves out:** addresses of earlier seeds. If the wallet has been recovered or moved to a new seed before, payments that still arrive at earlier addresses, and the earlier seeds' vault addresses, are found only with the earlier viewing keys. A complete backup adds the viewing-key record of every earlier seed. A device that is given only the words and the identity says that earlier addresses are not covered.
- **Worth adding:** the transaction that created the identity, and the backup stores with their content key, so that templates, position records and labels come back too. Without them the coins and tokens are still restored, and templates can be had again from the applications. A position is not found again without its record.
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
| Position record | Fields; what makes a record count |
| Rules for applications | The two rules of section 12 |
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
| The wallet holds tokens or application positions and less Bitcoin Cash than a cancellation's fee | It cannot refuse a request until a little Bitcoin Cash arrives. The warning screen says so, with the amount and an address; anyone can send it. No coin is kept apart against this case. |
| The recoverer has no coins for fees | It cannot send a request. Its page says so beforehand, with what is missing, and goes on once its balance holds coins; anyone can send coins to it. |
| The recoverer's balance is too low for a new wallet | Nothing is created. The phone is told that the recoverer cannot set up a wallet just now; the recoverer's page says how much to add. The same request goes through once coins arrive. |
| The recoverer is dishonest at enrollment | The first transaction is trusted. The recoverer can refuse, create nothing, or create a wallet the phone refuses. It cannot make the phone accept a wallet that names another owner, another recoverer than the one that answered on the scanned code's session, or another waiting period: the phone checks the creation (section 7.9). It sees the viewing key, as any recoverer does. |
| Either page is loaded again during a set-up, or an answer is lost | The same request is sent again and answered from what the recoverer's page kept: the same wallet, never a second one. |
| A wallet holds less than the smallest output plus the fee | It cannot be emptied. The wallet shows the total, the fee and the smallest output. |
| The owner's key closes the wallet | The identity ends. Vault addresses are unspendable for good, coins at an earlier seed's addresses obey only that seed, and there is no recovery. Neither the recoverer's key nor an earlier owner's key can do this. |
| Backup store is compromised or withholds | Nothing readable, nothing spendable. Templates, position records and labels may be missing; coins and tokens are not affected. A position cannot be found by the wallet until a copy of its record turns up; its token is swept and safe meanwhile. |
| A record is forged by someone who knows the content key | Refused: it is not signed by an owner's key |
| The holder of an earlier seed signs a new record | Genuine as to who signed it; it says nothing of when. It replaces no viewing-key record that a receipt names and makes no template trusted. |
| The holder of an earlier seed, after the sweep, signs a position record for a look-alike it paid for itself | The chain does not tie it to the token: no transaction that paid the look-alike carried the token. Shown as not confirmed; the wallet pays nothing into it (section 10.4). |
| The holder of an earlier seed acts before the sweep | Its key still spends the token, so it can take the position itself. No record and no check changes that; it is the first cost of the design, below. |
| Every copy of a position record is lost, the lost phone's included | The wallet cannot find the position. Its token is still the wallet's, is listed, and can be sent. An action that the application builds for it is carried out only where the wallet gives nothing but the fee. |
| Someone else's transaction changes a position | The record is out of date: it names a script that holds nothing, or a coin that is gone. Where the position still exists, the application has to name it again; the wallet cannot find it. Recovery restores remaining rights only as far as they can be known. |
| A store hands back an older set of records | Noticed where the device or the recoverer holds a newer receipt; otherwise the device says that the backup may be out of date |
| An application asks for a transaction that takes more than it says | The wallet's own figures show what the transaction moves. The application cannot change them. |
| An application's site disappears | The position stays the user's. The wallet carries out by itself the actions that need nothing from the application, such as emptying a Savings Jar. For the others another copy of the application's page is needed; the pages of this project are static and can be served by anyone (section 15.3). |
| An application liquidates or closes a position | The token then leads to nothing. Recovery restores remaining rights only. |
| A server hides a request | Read from several servers; hidden only if all leave it out |
| A server reports a confirmation that did not happen | Believed, unless another server disagrees or the device checks headers. The deployment of this project includes the user's own node. |
| A token imitates an identity | The category differs, so the rule refuses it. An identity whose creation was not valid is refused by the client. |
| The recoverer's creation is replaced, or its block undone, after addresses were given out | No coin is lost: coins at those addresses are spent by their keys. The wallet says that the set-up did not hold, keeps watching the addresses, is set up again with the recoverer, and moves the coins over by key. It makes no identity of its own. Payments made from the starting balance are undone with it. |
| A vault address of an identity that disappears is paid | Lost: a vault address has no key. It takes a payer of the recoverer's coins who takes them back before a block holds the creation, after a vault address was given out; that payer gains nothing by it (section 7.9). |
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
8. The wallet's starting balance can be traced to the creation of its identity, and to the recoverer's coins.
9. Applications have to be reached through a template; front ends that build transactions from the wallet's public keys cannot serve it.
10. A complete search looks up every address of fixed ranges, for every seed the wallet has had, and a seed has a fixed number of fresh addresses.
11. An address that outlives its controller's rules keeps the old identity in service.
12. The closing action makes every controller transaction 45 bytes larger, and closing turns the identity's vault addresses into addresses nobody can spend from.
13. The templates that hold keys can never change. A change means other keys: a new seed's worth of addresses, or a new identity. A template names the network versions it supports, and one made today cannot name next year's; whether the engine goes on running it then is for XO to say.
14. Every position in an application depends on the backup stores. Making one waits for a store, and the wallet finds it again only where a copy of its record is found.
15. The recoverer can read which positions the wallet holds and the values they were made with.
16. This wallet refuses to open a position that a key of the device opens, even where part of that position would survive a recovery.
17. The wallet does not act for an application where an action needs something only the application knows. A ParyonUSD loan is managed through a page.
18. A token that came from someone else is held and can be sent, and the wallet does not find what it controls.
19. Fungible tokens are shown by category and in raw units.

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
| WizardConnect transport, `xo_v1` and `gw_recoverer_v1` messages | Implemented in the form of section 14 (`packages/connect`): the announcement without templates, the request that names its template and sends the texts when the wallet asks for them, the per-application record that carries a request out at most once, positions answered only for a template trusted with that application, and a reasoned refusal of a standard signing request (AP04, AP11 to AP14). The second extension, `gw_recoverer_v1` (section 14.4), is implemented and tested with both sides over a relay in memory: the hand-over, a refusal, a recoverer's page that is gone, a message too large for one relay message, a wallet and a message of another extension; and a kit received this way is the link's kit byte for byte and passes the same checks (RC12, RC13). Since 18 November 2026 the extension also carries a phone's set-up request and its answer, and the hand-over after a recovery; the page offers the same session again after a reload (RC14, RC15). |
| Recoverable address, vault address | Implemented (`contracts/recoverableAddress.cash`, `contracts/vaultAddress.cash`); tested in the virtual machine (AD01 to AD13), with each refusal shown to come from the script meant to refuse. A wallet's life ran on a local node and on chipnet: receiving, a payment by key, a sweep by a new owner, a spend from the vault, and the refusals of a sweep attached to a request and of a sweep approved by an earlier owner (`docs/runs/stage-1-chipnet.md`). |
| Derivation, viewing key, giving out and finding addresses | Implemented and tested (KV01 to KV05, KV07 to KV12, PV01, PV02), with test vectors in `test/vectors/`. The wallet's own derivation gives the keys the engine makes. The cost of the full pass is recorded for a local node and a chipnet server (KV13, `docs/results/kv13-full-pass.md`). |
| Creating a wallet as in section 7.9: the recoverer creates it | Implemented on 18 November 2026 (`packages/enrollment/src/request.ts`, `packages/app/src/recoverer-funds.ts`, `set-up.ts`, `OwnerWallet.enrolled`): the request, the creation from the recoverer's coins with its own key and the starting balance, the kit the recoverer assembles and its receipt, the phone's check and its wallet, requests carried out once through reloads and lost answers, a balance too low, servers that list late, a creation that disappears, and a recovery of a wallet set up this way through to the sweep: tested on the simulated chain and over the session with both sides (CR05 to CR10, RC14, RC15, SW09). The two pages were run in browsers through a relay on this machine (`scripts/session-check.ts`), and the wallet course with this set-up ran on the local node (`docs/runs/wallet-set-up-local-node.md`). Not run on chipnet, through public relays or on real phones. |
| The wallet creating itself from a funding address | The library's own creation, kept for the tests and the scripts of earlier runs; no screen offers it. Implemented (`packages/app/src/owner-wallet.ts`): in steps a device can resume (CR01 to CR04). Since 18 November 2026 no step waits for a block, and a creation that disappears is handled as section 7.9 says: tested on the simulated chain, which now makes blocks on demand and drops transactions; not yet run on the engine, the local node or chipnet. Ran on the XO engine against a local node and on chipnet. |
| Recovery kit, receipts, takeover and update messages, sweep, moving to a new seed, replacing the recoverer | Implemented and tested on the simulated chain (RC01 to RC11, SW01, SW03 to SW08, MG01 to MG08, KV06, FE09, PV03): the kit and the enrollment link, receipts and prepared receipts, the recoverer's fees from its one balance (RC06, and on the XO engine on the local node, `docs/runs/stage-4-local-node.md`), the takeover message and the hand-over, both passes and the sweep, the move to a new seed and the replacement of the recoverer with every step stopped and repeated, and the backup of section 18.1 (`packages/enrollment`, `packages/app/src/recovery-flow.ts`, `packages/app/src/user-backup.ts`). The whole course ran through the XO engine on a local node and on chipnet: a wallet created and used, recovered to a new device after the waiting period, swept with a vault coin and an NFT, used again and closed, with every coin returned (SW02, `docs/runs/stage-5-chipnet.md`). |
| The wallet page and the recoverer page | Since 18 November 2026 the wallet's first screen offers "I have a code from my bank" and "Someone I trust is setting it up" (labelled "Someone I trust is helping me" until 19 November, when the screen was grouped under "New wallet" and "I had a wallet before" because testers could not tell it from "I lost my phone"), each leading to the scanner, "Setting up…" and "Your wallet is ready", and "I lost my phone" scans the recoverer's code; the self-funded set-up, the funding address, the step list, the recoverer's link field, the fingerprint and the kit link are gone from its screens. The recoverer's page asks on its first run whether it is a bank or someone helping a person they know, shows its balance and an address to fund it, has settings for the starting balance and the waiting period, a bank's "New customer" code that sets a wallet up without asking, a friend's "Set up …'s wallet?", lists of wallets, the one balance that pays every fee, with "Send all" to another address, and "… lost their phone". The page shows the chain's clock, the median time of the last eleven blocks by which the network measures a waiting period, with the height of the last block; it reads it again at every new block, and a request that is waiting is shown with that clock and the time it has to pass. While its account opens the page shows how far the check of block headers has come, and after half a minute offers to make that check afresh, which touches neither the balance nor the wallets looked after. Its settings have "Start afresh", which erases everything the page keeps in the browser after saying what that costs: the owners lose this recoverer, and coins left in the balance can no longer be reached, so the page shows the balance and lets its words be saved first. The screens were pictured on a phone and a desktop from the fixtures pages (`scripts/session-check.ts`, `docs/screens/`) and run with coins in the course on the local node (`docs/runs/wallet-set-up-local-node.md`); the descriptions behind a "?" on the wallet's new screens are still to be placed. What follows describes the pages before that change, as far as it still holds. Implemented (`apps/wallet`, `apps/recoverer`), for a phone and for a desktop: creating a wallet in steps that survive a reload, what the wallet holds and whether it is protected, fresh and vault addresses, the fee before sending and sending everything, the alarm and the refusal, with what to do when the wallet holds too little to pay for it, the takeover on a new phone, the move to a new phone, replacing the recoverer, the waiting period, the user's own backup, and the wallet owned elsewhere; on the recoverer's side the link, kits, takeover requests, each wallet's standing, the request and the completion paid from the recoverer's balance, and the hand-over. What the wallet says about its protection is tested (OP02). Every field that takes a link or an address from another screen has a QR code scanner; it was checked in Chromium with simulated cameras (`scripts/scan-check.ts`, OP04) and has not been tried on real phones. The recoverer's code offers the session of section 14.4, over which the wallet sends the kit, the kit for a new recoverer and a new phone's takeover request; the links remain the second way. The two pages were run in browsers through a relay on the same machine, as far as a sealed sample handed over and refused (`scripts/session-check.ts`); a wallet created and enrolled over a session has not been run with coins, and the scripted course still sends its links. A scripted course drives both pages in real browsers, one profile for each device, and passed on a local node and on chipnet with the public pages (`docs/runs/stage-6-local-node.md`, `docs/runs/stage-6-chipnet.md`). The public sites were switched to this design, and the way back was tried (OP03, `docs/runs/stage-6-switch.md`). A walkthrough to follow by hand, with what the demonstration does not show, is in `docs/walkthrough.md`. The pages watch the wallet only while they are open, and they do not offer closing a wallet. |
| Backup records as in section 10 | Implemented and tested with stores in memory (BK01 to BK03, BK07 to BK09): signed records sealed on several stores, the rules for records of an earlier seed, what a reader says when it cannot rely on what it was given, and the copy into a new archive after a change of seed (`packages/archive`). The records that applications bring are stored and confirmed by a store before the first action of a template; a note of a token is a hint that is checked against the chain, and a template an earlier owner stored is offered and not trusted (BK04 to BK06, BK10). |
| The wallet's templates | Implemented (`packages/app/src/templates.ts`) and accepted by the XO validator. The controller template and the two address templates are final; a test fixes their identifiers. Every action ran through the unmodified engine on a local node, with the engine's keys and addresses equal to the ones this project's code derives and every transaction of the size worked out beforehand (`docs/runs/stage-3-local-node.md`). The same actions ran on chipnet, where the engine needed a local fix for its header check and was given one server (`docs/runs/stage-5-chipnet.md`). Loading the run's invitations in XO's debugging tool is still to be tried. |
| Application templates with wallet-bound outputs; recovery declaration | Implemented (`packages/app/src/applications.ts` and the files beside it) and tested on the simulated chain with two templates made for the tests, one with its position at an address of its own and one found through a companion coin (AP01 to AP09, AP11 to AP15): an action of an application's template is carried out with the wallet's coins and addresses, the wallet works the transaction out itself and shows its own figures, the statement about a template is one of the three of section 14.3, and positions are found from tokens and the chain. No code of the wallet or the recoverer names an application (AP07). Both templates ran through the unmodified engine on a local node (`docs/runs/stage-7-local-node.md`). The wallet page has a screen for connections, requests and tokens. The declaration is a companion document of this project's own form. |
| Receiving and sending tokens; names of tokens | Implemented (`packages/app/src/token-send.ts`, `token-names.ts`; the Send and Receive screens) and tested on the simulated chain (TK01 to TK10): the token-aware form of every address, a part or all of a fungible balance gathered from several coins with token change, an NFT whole, the fee from ordinary coins only, plain addresses refused, a vault token moved first, the review and the tick for a token that controls something, names from trusted templates only with disagreement shown, and amounts typed in a token's decimals. The ParyonUSD declaration names PUSD (2 decimals) and the loan key, the Savings Jar's the jar key. The screens were checked in a browser from the fixtures page (`scripts/token-send-check.ts`); nothing of this has been run on a node, on chipnet or on a real phone. |
| Savings Jar with a key NFT | Implemented: the contract (`contracts/savingsJar.cash`), the template with its recovery declaration (`packages/savings-jar`), and the application page (`apps/jar`) for this wallet and for ordinary wallets (SJ01 to SJ06, AP10). With this wallet on the XO engine, a jar was opened, the device lost, the wallet recovered, and the jar found from the swept key and the template and emptied, then paid into again and emptied again, on a local node and on chipnet (`docs/runs/stage-8-local-node.md`, `docs/runs/stage-8-chipnet.md`). The same course ran in real browsers with the wallet page, the recoverer page and the jar page, the new phone making no request to the jar page before it emptied the jar (`docs/runs/stage-8-browser-local-node.md`), and on chipnet with the public pages (`docs/runs/stage-8-browser-chipnet.md`; that run was continued twice from its profiles on disk, and its list of requests covers the continued part). The unmodified Cashonize web wallet opened and emptied a jar with the same page and contract on chipnet (`docs/runs/stage-8-cashonize-chipnet.md`). |
| ParyonUSD template and front end | A loan was opened, managed and closed on Paryon's chipnet deployment from recoverable addresses, first with transactions built by this project's code from the published contracts (PY01, PY04; `docs/runs/stage-9-loan-chipnet.md`), then through the wallet from a template, and through the loss of the device: the new device found the loan and closed it (PY02 and PY03 at the level of the library; `packages/paryon`, `docs/runs/stage-9-template-chipnet.md`). Then from a page of this project's own in browsers (`apps/loan`, `docs/runs/stage-9-browser-chipnet.md`): the loan was opened and given more collateral from the page, the phone was lost, and the new phone closed the loan from its own list of tokens with the page not opened (PY02, PY03; `docs/results/stage-9.md`). The page is served locally; it has no public address. A repayment that leaves the loan open is shown in the virtual machine and on the simulated chain only. |
| Position records, and the check that makes one count (sections 10.2 and 10.4) | The record is implemented; the check is not. The trial of stage 11 (20 November 2026, `docs/stage-11-trial.md`, on the branch `design-3`) ran on the local node through the unmodified engine with no declaration: one seed opened a Savings Jar from its template alone; a second seed, with no history, followed the jar from a record file and emptied it after the date; and the check was worked through from chain data, for that jar and for a made-up record that it rejects. The check was also worked through on chipnet for the jars and the loans of earlier runs. Since stage 12 the wallet builds the record from the template and the transaction it worked out, has a store confirm it before the action is signed, and after a recovery copies an earlier owner's records as suggestions, leaving out those of actions never sent (PR01, PR02, PR10, PR11 on the simulated chain; `docs/results/stage-12.md` on the branch `design-3`). The check in the wallet's code, and listing positions from records, are still to be built. |
| Actions judged by what they leave behind (sections 12.3 and 12.5) | Proposed; not implemented. Today the check is made for a template as a whole (`packages/app/src/template-check.ts`), and a template with a script that takes a key of the device is refused whole. |
| An application used from its template alone (section 13.3) | Tried for the Savings Jar in stage 11, with the filling of values in the trial's own code; not implemented in the wallet. Today an action about a token is refused when the template comes without a declaration, and a coin of the application's that a request names is checked against the declaration (`packages/app/src/applications.ts`). The code that reads declarations, finds positions from the chain and takes token names from a declaration is to be removed. |
| The wallet's screens for these (section 17) | Proposed; neither pictured nor built. |
| The two applications without declarations (section 15.3) | Proposed; not built. The Savings Jar's template is to change in one place, with the validator's acceptance of that form tried on 20 November 2026. The loan page is to name Paryon's coins and read their values itself. |
| A recoverer other than this project's page (section 9.8) | Not built, and not planned in this version. The role is stated. |

Licences: the XO engine and utilities declare MIT. The XO web development tool has no licence statement and is used as a tool only. WizardConnect declares LGPL-3.0-or-later. Paryon's contracts repository states no licence.

The stages in which the second design was built, and which tests closed each, are in [IMPLEMENTATION_PLAN_v0.4.md](IMPLEMENTATION_PLAN_v0.4.md). The stages of this version are in [IMPLEMENTATION_PLAN_v0.6.md](IMPLEMENTATION_PLAN_v0.6.md). The bounty also asks for developer feedback written personally; this document is not a substitute.

## 21. Acceptance tests

These are tests an implementation must pass. Except where the status table above says otherwise, they are not results already obtained. The implementation plan names the stage that closes each one. A test is closed by a recorded result, not by its place in this table.

**Tests of the second design that this version retires or replaces.** They were closed by recorded results and stay in the table as that design's record.

| Test | In this version |
| --- | --- |
| AP01, as far as it concerns a declaration; AP08; AP09; AP14; BK05; TK09; TK10 | Retired with the declaration. What the wallet calls a token is in section 13.3 |
| AP15, as far as the wallet finds a shared coin itself or checks a named one against a declaration | Retired; PR13 and PR17 take its place |
| AP16; TK07; BK04; BK11 | Kept, and rewritten to rest on records in place of declarations and token notes |
| SJ06, as far as it expects a withdrawal that would not return the key to be refused | Changed: such an action is shown and carried out only with the user's tick (PR15) |
| The parts of PY02 and PY03 that concern the wallet's statement about a template, a look-alike of the sidecar, and acting from the wallet's own list | Retired or moved to the loan page, which finds the loan and tells a look-alike apart |
| AP12, as far as it concerns an address the application supplies | Replaced by PR14 |
| AP06 | Replaced by PR18 |
| AP10 | Replaced by PR16 |
| SJ04; PY03 | Run again as PR19 and PR20 |

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
| CR02 | Every step without a block; the preparing or creating transaction is replaced or reorganized away after addresses were given out and paid; the device stops between steps | Addresses of every kind are given out and recovery can be on before any block. After the replacement no coin is lost: the wallet makes a new identity, collects the coins by key, keeps watching the earlier addresses, and says recovery must be set up again. The device continues from the transactions that exist and makes no second identity while the first exists. |
| CR03 | The creating transaction and what follows it | A valid identity (section 5.7); every satoshi accounted for; no coin kept apart, and a first coin that pays for a cancellation; nothing for the recoverer |
| CR04 | A wallet that the recoverer has not yet confirmed; a later payment to the funding address | Recovery is shown as off; the payment is shown with a warning that it is not recoverable |
| CR05 | The recoverer creates a wallet for a phone's request, from its own coins | One creation: the controller naming the phone's key, the recoverer's own key for this wallet and the waiting period; the starting balance at the phone's address; nothing kept apart for the recoverer's fees. The phone checks it and opens its wallet; the starting balance is spendable at once, before any block, and recovery is on with the receipt |
| CR06 | A creation that names another owner key, another recoverer than the one that answered, or another waiting period; a transaction that is not a creation; a request opened with another key; a request for a waiting period the recoverer no longer uses | Refused by the phone, with the reason, and nothing is opened; the request cannot be read; the recoverer refuses and creates nothing |
| CR07 | The recoverer's balance does not cover a creation | Nothing is created; the recoverer's page gives the figures, the phone is told that the balance is too low; the same request goes through once coins arrive |
| CR08 | The phone is loaded again after sending; the recoverer's page is loaded again after creating and before answering, or stops at any transaction of the creation; the answer is lost; two phones ask at once | The same request gets the same wallet; no second wallet is made; two requests get two wallets from coins of their own |
| CR09 | The servers list the creation a moment after they take it | The recoverer checks its creation and the phone opens its wallet without taking the creation for gone |
| CR10 | The recoverer's creation disappears after addresses were given out and paid; the same creation comes back | The wallet says that the set-up did not hold, keeps what arrived by key, and is set up again after the numbers it gave out; the coins are moved over by key. A creation of the same identity again makes its addresses the wallet's again |
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
| RC05 | Two wallets with the same recoverer | No key hash in common in their controllers, and nothing in a controller's state leads to the recoverer's balance; a request for each is paid from that one balance, which the two transactions then share |
| RC06 | Three requests cancelled, then a fourth request and its completion: with a balance of one coin, with a balance of small coins, and with an empty balance | The recoverer pays all five fees from its balance at the stated rate in the first two cases, each in the one transaction that spends the controller, with the change back to the balance; in the third its software says what is missing and goes on once coins arrive. The whole balance can be sent to another address, and coins at an earlier fee address are brought into it |
| RC07 | Order of handing over viewing keys in a recovery; a completion that disappears after the hand-over | The new device's record reaches the recoverer before the request, without the device knowing the identity; earlier ones reach the new device only after completion, as soon as the network shows it. If it disappears, the recoverer's kit is put back as it was and the takeover is saved again. |
| RC08 | A request to an unknown key, shown by only one of several servers; a request to the device's own key | Alarm; no alarm |
| RC09 | A request or cancellation is reorganized away or replaced | Status is rebuilt from the chain; a request that is seen unconfirmed warns and is not reported as confirmed |
| RC10 | A prepared receipt for another controller output, other settings, another recipient or another viewing-key record; a matching change that disappears | Does not count; recovery is shown as on as soon as the network shows a matching change, and off again if it disappears |
| RC11 | A kit with the viewing keys of several seeds, given to a new recoverer | Delivered by reference to sealed records; the recoverer confirms only after it has fetched and saved them |
| RC12 | A kit and a takeover request sent over the session of the recoverer's code; one altered on the way; one too large for one relay message | Byte for byte what the link carries, taken in through the same checks; the altered one refused as a link would be; the large one arrives in parts. Nothing unsealed about the wallet goes over the session. |
| RC13 | The recoverer's page closed, silent, refusing, or answering for another recoverer; a wallet or a message of another extension on the session | The wallet says the page did not answer and offers to try again, and sends nothing to another recoverer's page; the refusal's reason is shown; the page serves no such wallet and takes no such message |
| RC14 | A set-up request over the session: a page that asks a person first, one that refuses, one that never answers, one that speaks for another recoverer; an answer lost; the page loaded again and offering the same session | Sent until the wallet comes back, with "received" meanwhile; the reason shown; given up in time; not sent; given again; the phone that joined is answered on the same session |
| RC15 | The hand-over after a completion, with the new phone on the session, and without | Sent until the phone says it kept it; otherwise the page shows the hand-over's code, which the phone scans |
| **A new seed without loss; a new recoverer** | | |
| MG01 | A move to a new seed by `ownerUpdate`, then a sweep; the change disappears before a block holds it | The recoverer's prepared receipt comes first; no waiting period and no block; afterwards the earlier seed can move nothing that was swept. If the change disappears, the old device owns the wallet again and makes the change again, the new device pauses and keeps what was paid to it, and no coin is lost. |
| MG02 | The new device is lost right after a move to a new seed, and right after a recovery completes | The recoverer already holds its viewing key and archive access; another recovery succeeds |
| MG03 | The recoverer is replaced while a request is pending | The request is cleared; the earlier recoverer's key can neither request nor complete |
| MG04 | The recoverer is replaced after it has paid for a request | The old recoverer's balance is as it was and nothing of its is at an address of the wallet; the new one pays from a balance of its own |
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
| SW09 | A wallet the recoverer created is recovered: the takeover request, the request with the recoverer's own key paid from its balance, the completion, the hand-over, the sweep | As SW01; recovery is on again for the new device |
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
| BK11 | The user stops trusting a stored template; the backup is read again, also on a device that starts from it; the template is trusted again | The tokens stay and are listed; reading the backup does not trust it again; trusted again, a later reading trusts it |
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
| AP16 | An application offers its template without an action to a wallet that holds a token of it; the user trusts, or declines; the text is not the one named | Nothing is answered before the user decides; trusted, the token leads to its position and the application is answered; declined, nothing is trusted; a wrong text is refused |
| **Tokens** | | |
| TK01 | The token-aware form of each kind of the wallet's addresses | Decodes to the same locking bytecode as the plain form; the Receive screen shows it on request |
| TK02 | A token sent to a plain address and to a token-aware one, of the key-hash and the script type | The plain one is refused before anything is built, with what to ask for; the token-aware ones are taken |
| TK03 | Part of a fungible balance; an amount that needs several coins; all of it | The coins are gathered, the largest first; the rest comes back to a fresh change address; with "Max" there is no token change; each token output holds its smallest value |
| TK04 | A send while the wallet holds only coins with tokens, of more value than the fee; then with an ordinary coin | Refused with the figures, the fee never coming from a token's coin; then the ordinary coin pays, and what the token coins held beyond their outputs comes back as change; tokens of other categories are untouched |
| TK05 | An NFT; a coin with an NFT and a fungible amount | Sent whole, commitment and capability unchanged; the coin with both moves whole and is not taken for an amount |
| TK06 | A token at a vault address | Refused until moved; moved through the controller; then sent |
| TK07 | A token that controls a position is sent | It is no longer listed, no position is reported for it, and its actions are refused |
| TK08 | After a recovery and the sweep | The new device sends a swept fungible amount and a swept NFT |
| TK09 | Token descriptions in a declaration: well formed, malformed, and not matching the template | Read; refused as unreadable; a violation, and the template is not taken in |
| TK10 | Names from a template that is presented but not trusted, from trusted ones that agree and that disagree; amounts with more decimals than the token has; a declaration replaced for a trusted template | No name; the name with its sources; neither name, with what each says; refused, never rounded; the earlier declaration kept until the user approves the new one |
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
| **Applications from their templates alone; position records** | | |
| PR01 | An action that leaves a position: with a store that confirms; with no store reachable | The record is on the store before a signature for that action leaves the wallet; refused, and nothing of the action is signed |
| PR02 | An action that leaves nothing outside the wallet's addresses, with no store reachable | Carried out; no record is written |
| PR03 | The device is lost with a position open; recovery; an action that needs nothing from the application | The new device reads the record, the chain confirms it, the position is listed, and the wallet carries the action out by itself |
| PR04 | After the sweep, the holder of an earlier seed pays a look-alike script and signs a record that names the wallet's token | Shown as not confirmed, never as the position; paying in is refused |
| PR05 | A position that is not confirmed | An action whose figures show the wallet giving nothing but the fee is carried out; any other is refused |
| PR06 | A position moved to another script by a later action, so that two records count for one token | The record whose script holds coins is the current one; the other is not listed |
| PR07 | An application that makes several NFTs of one category; a record that matches by commitment; one that cannot be told apart | Confirmed; not confirmed |
| PR08 | A template with a script that takes a key of the device: an action that puts nothing there; an action that would | The finding is that it comes back, and it is carried out; the finding is that it does not, and this wallet refuses with the reason, before the user is asked |
| PR09 | A template that uses something the wallet cannot analyse | The finding is that the wallet cannot tell; this wallet refuses |
| PR10 | A record of an action that was never sent | Nothing is listed for it; it is not copied into a new archive |
| PR11 | The earlier archive's position records after a recovery, while a store cannot be reached or the device stops | Copied as suggestions; nothing is removed before the copy is complete; a record is written as the new owner's only after the chain has confirmed it |
| PR12 | Every copy of a record is gone | The token is swept, listed and can be sent; no position is shown; an action the application asks for with it is carried out only where the wallet gives nothing but the fee |
| PR13 | A template that comes with no declaration: an action that creates a token, and one that spends it, with coins of the application's named in the request | Carried out from the template, the request and the record |
| PR14 | A locking script that the wallet's role has to provide: supplied by nobody; supplied by the request; with the kinds `return` and `lasting` named in the request. A variable that nothing fills | An address of the wallet's; shown as leaving the wallet; as named; refused, with the variable named |
| PR15 | An action that would not return a token of the wallet's; one that would send elsewhere a token made from the wallet's coin | Shown as leaving, and carried out only with the user's tick |
| PR16 | From the wallet's own list: an action that needs nothing from the application; one that needs a coin or a value of the application's | Carried out by the wallet alone; "Open the application to do this", with the address of its page |
| PR17 | A coin that the request names and that does not belong with the wallet's token | Refused before the user is asked, by the application's own contract |
| PR18 | A positions request after a recovery: for a position at a script of its own that counts, and one that does not; for a position at a script many users share; for a token without a record | Answered as `open`, with the script's values and the value of the token's coin; as `unconfirmed`; as held, with no word on whether it is open; not answered for |
| PR19 | The Savings Jar without a declaration, in browsers on the local node and on chipnet: opened, the phone lost, the wallet recovered, the jar emptied with its page not opened | Works; the new phone makes no request to the jar's page before it empties the jar |
| PR20 | A ParyonUSD loan without a declaration, on chipnet: opened and given collateral from the loan page, the phone lost, the wallet recovered, the loan closed from the page on the new phone | Works |
| PR21 | Wallet and recoverer code searched for a reader of declarations, and for any application's name | None |
| PR22 | After a recovery, an action from the wallet's list on a position whose record was made by the earlier seed: one that returns the key; one that pays in | The key goes to an address of the new seed, never to one in the record; the amount is asked of the user, never taken from the record |
| PR23 | Before the sweep, the holder of the earlier seed spends the key in a transaction that pays a script of their own and gives the key back, and later signs a record for it: with a template that names the key as an input; with one that does not, while the genuine position holds coins | Does not count; both are shown as not confirmed, and nothing is paid into either |
| PR24 | A record whose NFT differs from the wallet's only in commitment or capability; a token that can mint, of which a copy exists | Does not count; counts only where the token is followed back to the wallet's coin without a fork |
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
| OP02 | The device was not running for part of a wait; the wallet holds less than a cancellation's fee | The wallet says that it could not watch, and does not show full protection. Holding too little to cancel does not change what it says about protection; it says so on the warning screen when a request is waiting. |
| OP03 | The public sites are switched to the second design and switched back | Services installed from the intended checkout; the running version, the stores' data and the public walkthrough checked; the way back tried |
| OP04 | A QR code scanned into each kind of field: of its kind, of another kind, from a picture; several rear cameras; a refused or missing camera; the page hidden | The field is filled as by a paste; another kind is named and the scanner stays open; a tap goes round the rear cameras and the one that read is used next; each problem is said plainly; the camera is released |

The decisive demonstration:

> Create a wallet and open a savings jar and a loan. Erase the device. On a new device, with the recoverer: request, wait, complete, sweep. Find the jar and the loan from their tokens, with the applications' sites unavailable, and operate both.

A second demonstration must show that during the wait the recoverer can do none of this, and that after the sweep the earlier seed can do none of it either.

## 22. Decisions to resolve

Each has a proposed answer, which implementation follows unless the owner says otherwise. The implementation plan gives the stage by which each is needed. The numbers are this section's own; `D1` to `D15` in `docs/decisions.md` are decisions already taken.

| No. | Decision | Proposed |
| --- | --- | --- |
| 1 | **Derivation.** The key tree; the number `B` for the blinding seed; the encoding of the viewing-key record | Settled: the XO engine's tree, with templates that do not change (sections 7.2 and 9.2); `B` as in section 7.2; the record as canonical JSON signed by the controller key, with a one-line text form (`packages/archive/src/viewing-key.ts`). |
| 2 | **Address chains and ranges.** Two kinds of ordinary address and one of vault address; the windows; the sizes `N0`, `N1`, `N2`; how often the full pass is repeated | Windows of 20, 5 and 5; `N0` = 10,000, `N1` = 10,000, `N2` = 1,000; the full pass once a week and after the events of section 7.7 |
| 3 | **Who makes the recoverer's key** | Decided by the owner on 18 November 2026: the recoverer, when it creates the wallet (section 9.2). A device that replaces its recoverer still makes the new one's credential |
| 4 | **The viewing key's written form** | The two extended public keys and the blinding seed in one signed record |
| 5 | **Readable controller state** | Settled by the controller that exists: readable, with a recoverer key per wallet. Open again only with new controller rules. |
| 6 | **The waiting period for real use,** the margin for cancelling, and whether cancelling is automatic by default | Time only; the length is open. Decided by the owner on 18 November 2026: a request to a key the phone does not hold is refused without asking while the page is open, unless the owner turns that off under Recovery; the refusal is shown and kept in the wallet's activity. A phone that is to hand the wallet to a new one that way has the setting turned off first, or moves the wallet itself (section 9.7) |
| 7 | **Fees.** The rate; how the owner pays for a cancellation; how the recoverer pays for its own | One satoshi per byte; from the wallet's coins like a payment, with no coin kept apart. Decided by the owner on 18 November 2026: the recoverer pays its own, from its one balance, in the same transaction that spends the controller; nothing is kept apart for a wallet, and the owner's allowance is dropped. Amounts from measured sizes |
| 20 | **The starting balance and the waiting period of a recoverer's new wallets** | The recoverer's own settings. The page proposes 10,000 satoshis and about a day; the least starting balance is what a cancellation costs |
| 8 | **Messages with the recoverer:** enrollment, takeover, update, hand-over and receipts, and how the recoverer establishes who the user is | As in sections 9 and 11; the last is the recoverer's own process |
| 9 | **Backup:** record formats; whether refusing an action without a stored template stays the default; no commitment on chain | Refusing stays the default. Decided by the owner on 20 November 2026: position records are kept on the backup stores, not written to the chain. A store has to confirm before signing every action that leaves a position. The owner first agreed to a narrower rule, a store only where the chain could not give the position back; without a declaration the wallet has no way to read a position from the chain, so the narrower rule has nothing left to rest on. The owner confirmed the wider rule on the same day |
| 10 | **Template extension:** wallet-bound outputs and the recovery declaration in XO's schema or beside the template | Withdrawn. Decided by the owner on 20 November 2026: the declaration is retired, an application needs only its XO template, and nothing is asked of XO's schema (section 13.3) |
| 11 | **`xo_v1`:** a WizardConnect extension or a protocol of XO's | This project's extension, in its version 2 (section 14.2), until XO says how an invitation is meant to travel between an application and a wallet |
| 12 | **Division of work between the engine and the wallet's own code** | Settled: section 13.2 |
| 13 | **Sweep policy:** order, size of parts, how outputs are grouped | Most valuable first, unknown tokens counted as valuable |
| 14 | **Local backup:** whether the wallet offers it, and in what form | Offered as the user's choice, in the form of section 18.1 |
| 15 | **Upgrade policy** for controller rules, and how long an old identity is kept | A new identity; the old one kept while something can still arrive |
| 16 | **Watching and confidence in the chain:** monitoring on phones; checking headers; the user's own node | The user's own node among the servers; no claim of verified chain state or of protection on phones before each is shown |
| 17 | **ParyonUSD:** telling the team; the missing licence | Decided by the owner: the team is not asked. The contracts are public and are used unchanged, as a dependency, in the way they are meant to be used |
| 18 | **When the public demonstration switches** | To the second design: done, after the scripted run passed on the public addresses. To this version: the owner's decision once PR15 has passed; until then the public sites show the second design |
| 19 | **Closing a wallet:** whether a released wallet keeps the action in the controller, keeps it out of the interface, or offers it | In every controller; used by the test runs and a tool; not offered in the interface |
| 21 | **What a wallet does when an action leaves something that does not come back** | Decided by the owner on 20 November 2026: left to whoever builds the wallet (section 12.5). The design says what a wallet has to work out and must not misstate. This wallet refuses |
| 22 | **The finding "cannot tell" in this wallet** | Treated like "does not come back" |
| 23 | **The position record:** its fields; whether token notes go on being written | The engine's own field names, with the token, the other values of the action and the address of the application's page; token notes are read and no longer written |
| 24 | **When a record counts:** the check of section 10.4, and what happens where an application makes several NFTs of one category | Decided by the owner on 20 November 2026: the chain has to tie the record to a token the wallet holds; otherwise it is shown as not confirmed and nothing is paid in. Where the NFT cannot be told apart, the record does not count |
| 25 | **What the wallet calls a token** now that no declaration names one | An NFT by its template and output. Decided by the owner on 20 November 2026: fungible tokens by category and in raw units for now, and names and decimals from a token registry (BCMR) once the wallet reads one. Until then sending a token such as PUSD is harder to read than in the second design |
| 26 | **XO's synchronisation in place of this project's stores** | When it exists and offers the three things of section 13.6 |
| 27 | **A position that the application names** for a token without a record: one that came from someone else, one whose record is lost, one that someone else's transaction moved | Not in this version. The check of section 10.4 would apply to what the application names |
| 28 | **Other ways of getting a recoverer:** a recoverer outside XO; a token as the recoverer's authority; a recoverer who uses an ordinary wallet; a viewing secret with a log on chain in place of the kit | Decided by the owner on 20 November 2026: not in this version. Section 9.8 states the role, so that the first can be built without changing the wallet. The others are in `docs/idea-viewing-secret-and-chain-log.md` |
| 29 | **Keeping the declaration as an optional extra,** so that the wallet could manage a ParyonUSD loan with the page not opened | Decided by the owner on 20 November 2026: no. The loan page carries that knowledge, and a page can be served by anyone (section 15.3) |
| 30 | **A token of the wallet's that an action does not return** | Decided by the owner on 20 November 2026: carried out with the user's tick, as when such a token is sent. This changes one test of the second design, SJ06, from a refusal to a tick, which the owner confirmed on the same day |
| 32 | **A token that an action makes from the wallet's coin and does not deliver to the wallet** | Decided by the owner on 20 November 2026: carried out with the user's tick, like a token that an action does not return. Every new ParyonUSD loan asks for it once, at the step that makes the key |
| 33 | **Corrections from stage 11** to sections 10.2, 10.4, 13.3 and 14.2: the record keeps the script's values apart from the action's others and holds no address; an address and a paid-in amount never come from a record; the check compares the whole NFT and tests the template's token input; a position at a shared script has a record without a script, and the application says whether it is open | Taken into this text on 20 November 2026 |
| 31 | **Acting without the application** | Decided by the owner on 20 November 2026: not required. The wallet does it where an action needs nothing that only the application knows |

The first engineering checkpoint of this version is a trial on the local node: a Savings Jar opened by one seed from its template alone, and followed and emptied by another seed from the record, with no declaration anywhere (stage 11 of the plan). The first checkpoint of the second design was the two address contracts passing AD01–AD13, because those tests establish that the recoverer's key never gains spending power and state the cost of the earlier seed exactly.

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
- **S20 — XO state package:** `@xo-cash/state` 0.0.5, its type `ScriptHashData` and its class `RemoteEncryptedStateManager`, read from the published package on 20 November 2026. https://www.npmjs.com/package/@xo-cash/state
- **S21 — XO's authors on state and recovery:** their replies of 20 November 2026 in XO's public chat to this project's question about `docs/xo-position-recovery.md`, and to its later question about a call that follows a script, as summarised in section 13.6.
- **This repository:** `docs/decisions.md` (D1–D15), `docs/xo-spike.md`, `docs/xo-engine-signing-bug.md`, `docs/xo-chipnet-header-verification.md`, `docs/xo-position-recovery.md`, `docs/idea-viewing-secret-and-chain-log.md`.
