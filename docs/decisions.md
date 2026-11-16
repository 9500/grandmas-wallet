# Decisions log

Protocol and tooling decisions, newest last. Each entry records what was decided, on what evidence, and what it affects.

## D1 — Controller state is stored unhashed in the NFT commitment

**Date:** 15 Nov 2026 · **Status:** decided

The controller state (69 bytes) is stored directly in the identity NFT's commitment, so that asset and application contracts can read the current owner from the controller input.

**Evidence**

- CHIP-2024-12 P2S: "The limit on maximum length of token commitments is raised from 40 bytes to 128 bytes." Active on chipnet since Nov 2025 and on mainnet since 15 May 2026.
- Checked in the libauth `BCH_2026_05` virtual machine with standardness enabled: a 69-byte and a 128-byte commitment are accepted, 129 bytes is rejected, and 69 bytes is rejected under the 2025 rules (`packages/core/test/commitment-limit.test.ts`).

**Consequence:** the hashed-state fallback from the implementation plan is not needed. 59 bytes remain free for later fields.

## D2 — Controller state layout v1

**Date:** 15 Nov 2026 · **Status:** decided for the prototype

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 1 | format / authorization-interface version (`0x01`) |
| 1 | 1 | status: `0x00` Active, `0x01` Pending |
| 2 | 4 | owner epoch, little-endian, 0 to 2^31-1 |
| 6 | 20 | owner public key hash (hash160) |
| 26 | 20 | recoverer public key hash (hash160) |
| 46 | 3 | challenge delay as a BIP68 relative locktime, little-endian |
| 49 | 20 | proposed owner public key hash; all zero when Active |

- Integers are fixed-width little-endian with the top bit clear, so contracts can read them with `OP_BIN2NUM`.
- The delay keeps only the BIP68 value (low 16 bits) and the type flag (bit 22). Blocks: 1 to 65,535. Time: 1 to 65,535 units of 512 seconds (about 388 days).
- A reader checks the version byte first and rejects anything other than `0x01`.
- Zero key hashes are invalid. Active with a non-zero proposed owner, and Pending with a zero one, are invalid.

## D3 — Pinned dependency set

**Date:** 15 Nov 2026 · **Status:** decided, recheck before each milestone

Use the versions the XO web dev wallet pins, so invitations produced here load in the debug tool:

| Package | Version |
| --- | --- |
| `@bitauth/libauth` | 3.1.0-next.8 |
| `@xo-cash/engine` | 0.1.1-next.18029697917 |
| `@xo-cash/state` | 0.0.5 |
| `@xo-cash/templates` | 0.0.12 |
| `@xo-cash/types` | 0.0.8 |
| `@xo-cash/utils` | 0.0.10 |
| `@xo-cash/crypto` | 0.0.5 |
| `@xo-cash/primitives` | 0.0.3 |
| `@electrum-cash/web-socket` | 4.2.0 |

Only libauth is installed so far; each XO package is added, at the version above, by the first workspace that uses it.

## D4 — Controller contract v1

**Date:** 15 Nov 2026 · **Status:** implemented and tested in the VM; not audited, not yet run on chipnet

Source: `contracts/controller.cash` (CashScript 0.14.0). Compiled size: 402 bytes, 196 opcodes, so the controller is a pay-to-script-hash (32-byte) output. The contract has no constructor parameters; every wallet shares the same bytecode and address, and is told apart by its identity token category.

**Rules that hold for every transition**

- The controller is input 0 and its successor is output 0.
- Transaction version is 2.
- The successor has the same locking bytecode, the same token category and capability (mutable), the same fungible amount, and at least the same BCH value.
- The state is 69 bytes with version `0x01`.
- The authorizing signature must use signing type `0x61` (all inputs, all outputs, all spent outputs). Other types are rejected even when the signature is otherwise valid.

**Transitions**

| Function | Signed by | From | Result |
| --- | --- | --- | --- |
| `ownerAuthorize` | owner | Active or Pending | Active; owner, recoverer, delay and epoch unchanged; claim cleared |
| `requestRecovery` | recoverer | Active only | Pending with the presented proposed owner; nothing else changes |
| `finalizeRecovery` | recoverer, after the relative delay | Pending only | Active; owner becomes the proposed owner; epoch + 1 |
| `ownerUpdate` | owner | Active or Pending | Active with the given owner, recoverer and delay; epoch + 1 only if the owner changed |

**Decisions taken**

- Combined authorize-and-cancel is included: `ownerAuthorize` on a Pending controller cancels the claim (proposal decision #4).
- A second claim on a Pending controller is rejected, including one naming the same proposed owner. A different destination requires the first claim to be cancelled or finalized first, which gives a fresh delay (C06).
- `ownerUpdate` validates the new delay on chain (only the BIP68 value and type flag, value not zero) and rejects zero key hashes.
- The duplicate-identity rule needs no output scan: with a mutable (non-minting) token and a fixed fungible amount, consensus rules already prevent a second token of the category from being created.

**Known limits**

- The initial state is not checked by the contract. A client must validate the genesis transaction (exactly one token output of the category, mutable, valid state, sent to the controller script) before trusting an identity. This validator is the next piece of client work.
- The VM tests check that the finalizing input carries a sequence number satisfying the delay. That the UTXO has really aged that long is enforced by nodes (BIP68) and will be exercised on chipnet.
- Any party can attach further inputs and outputs to a controller transaction. The signer's signature covers all of them.
- The epoch stops at 2^31-1 owner changes.

**Tests:** `packages/core/test/controller.test.ts` runs the compiled bytecode in the libauth 2026 VM with standardness rules on. Each rejection test first confirms the unmodified transaction is accepted, then applies one change. Covered acceptance tests at controller level: C01, C03, C04, C05, C06, C09, C10, C11, C12, C14, X02. C02, C07 and C08 need the asset and application contracts.

## D5 — Shared authorization interface v1, asset covenant and Savings Jar

**Date:** 15 Nov 2026 · **Status:** implemented and tested in the VM; not audited, not yet run on chipnet

Sources: `contracts/lib/authorization.cash` (the interface), `contracts/asset.cash` (87 bytes), `contracts/savingsJar.cash` (90 bytes).

**Interface v1.** A protected input is constructed with the wallet identity (the controller's token category) and requires all of:

1. Input 0 carries that identity's NFT with mutable capability.
2. The state in input 0 is 69 bytes with version `0x01`.
3. A public key that hashes to the owner recorded in that state, and a signature by it with signing type `0x61`.
4. Output 0 carries the same identity NFT, and its state equals the input state with the claim cleared: same epoch, owner, recoverer and delay, status Active.

Rule 4 is stricter than the implementation plan proposed ("same owner and epoch"): the recoverer and delay must be unchanged too. The only controller transitions that produce such a successor are an owner authorization and an owner update that changes nothing.

**Consequences**

- A recovery claim or completion can never share a transaction with a protected spend, whoever signs the protected input (C07, C08).
- Replacing the owner, recoverer or delay and spending protected outputs are separate transactions.
- Spending while a claim is pending works in one transaction and cancels the claim (C10).
- After recovery the old owner key fails on every protected output at once, and the new owner spends them where they are (C12).
- Each protected input carries its own owner public key and signature (about 100 bytes per input).

**Asset covenant.** One script per identity; holds BCH, fungible tokens or NFTs. It places no rule on outputs: the owner's signature covers them and the wallet chooses where change goes. It is a pay-to-script-hash (32-byte) output although the script would fit a bare script, because the wallet's receiving address must be expressible as a CashAddress that other wallets can pay.

**Savings Jar.** Parameters: identity and unlock time (block height or timestamp). Withdrawal needs the interface and a transaction locktime at or after the unlock time. Deposits are ordinary payments to the jar address; there is no separate top-up function. The unlock time is part of the script, so it must be preserved to find and spend the jar again — it is the first piece of data the restoration archive has to carry.

**Known limits**

- All of a wallet's assets sit at one address, so its balance and activity are publicly linked.
- Every protected spend consumes and recreates the controller, so a wallet's spends are sequential.
- Tokens or outputs sent to these addresses by others are spendable by the owner like any other; nothing here filters them.

**Tests:** `packages/core/test/protected.test.ts`. Rejection tests for the attacks check that the transaction fails at the protected input while the controller input on its own is satisfied, so the protection is shown to come from the interface and not from the controller. With these, the controller, asset covenant and Savings Jar pass C01–C12 and C14 in the VM, which meets the plan's first checkpoint (C03–C09). C13 concerns wallet behaviour on reorganizations and is not a contract test.

## D6 — Chipnet run of the contracts

**Date:** 15 Nov 2026 · **Status:** done once, on chipnet with one-minute blocks

The controller, asset covenant and Savings Jar were run through the full lifecycle on chipnet (`docs/chipnet-run.md`; results in `docs/chipnet-log.md`). Wallet identity `1819a56a9094983ba24ed3a85906c0c07261eac47e37b50454059a56481e656b`.

**Confirmed on the network**

- Every permitted transaction was accepted: genesis, owner payment, claim, cancellation, second claim, completion after the delay, payment and Savings Jar withdrawal by the replacement key.
- The three invalid attempts were refused by the node: a claim carrying a spend of wallet funds (script failure), completion immediately after the claim (`non-BIP68-final`), and a spend by the old owner key after recovery (script failure).
- The time-based relative delay is enforced by nodes. With a delay of one 512-second interval, the completing transaction was accepted about 11 minutes after the claim was sent: the interval itself plus the lag of the median block time.
- The Savings Jar's timestamp lock is enforced the same way: with a 5-minute lock, withdrawal was accepted about 12.5 minutes after the jar was created.

**Cost:** 60,000 satoshis in, 49,655 returned. Of the 10,345 difference, 1,000 remain in the controller output and 9,345 were fees for 14 transactions at 1 satoshi per byte. A controller transaction is roughly 700 to 1,000 bytes.

**Not covered by this run:** token and NFT transfers, owner updates, block-based delays, and behaviour across a chain reorganization.

## D7 — Controller address is specific to each wallet

**Date:** 15 Nov 2026 · **Status:** implemented, tested in the VM, and run once on chipnet; supersedes the "no constructor parameters" part of D4

The controller contract takes the wallet identity as a parameter and requires the token it carries to be that identity's NFT with mutable capability. Compiled size is 405 bytes plus the 33-byte identity push.

**Why:** with one shared controller script, every wallet's controller sat at the same address. Tools that follow outputs by script (the XO engine, Electrum subscriptions) then show every wallet's controller to every user: an XO test account listed another wallet's controller as its own spendable output. With the identity in the script, a wallet's controller can be found and watched by address, and a notification for that address concerns that wallet only.

**Unchanged:** the transition rules, the state layout, the authorization interface, and the asset and Savings Jar contracts. The address is derived from the identity alone, so enrollment and restoration records need no new field. A template can express the script with the identity as a variable, so one template serves all wallets.

**Evidence:** `packages/core/test/controller.test.ts` adds a test that another wallet's identity token at this wallet's controller address is rejected. The chipnet lifecycle was repeated with this contract (identity `ffc65007e29e31f46d50755bf812f1a05364b6cf0d2683264d379826a82f9939`, `docs/chipnet-log.md`): all permitted steps accepted, all three invalid attempts refused.

## D8 — Contracts accept two signing types

**Date:** 15 Nov 2026 · **Status:** implemented and tested in the VM; supersedes the "signing type `0x61` only" rule in D4 and D5

The controller and the shared authorization interface accept a signature of type `0x41` (all inputs and outputs) or `0x61` (the same plus the amount and script of every spent output). Any other type is rejected. Compiled sizes: controller 412 bytes, asset covenant 94, Savings Jar 97.

**Why:** the current XO engine cannot produce a valid `0x61` signature for a transaction with more than one input (`docs/xo-engine-signing-bug.md`), and every controller transaction has at least two. Requiring `0x61` would make the wallet unusable on the stock engine, which the hackathon bounty expects.

**What `0x41` still guarantees:** the signature commits to every input outpoint, every sequence number, every output, and the signed input's own amount and script. It cannot be reused in another transaction and no output can be altered. All contract-level properties (C03–C12, C14) are unchanged, and the tests run every transition under both types.

**What it gives up:** the signer's own assurance about the amounts and scripts of the *other* inputs. A signer that looks those up itself, as the wallet and the XO engine do, loses nothing. A signer that is handed a transaction without that data (an offline or hardware signer) would not notice if it were lied to about another input's amount. Such a signer should use `0x61`, which stays accepted; this project's own transaction builder uses `0x61`.

**Evidence:** every transition and both kinds of protected input are tested under both types, and six other types are rejected (`packages/core/test`). The chipnet lifecycle was run a third time with these contracts (identity `1a2e586aad9ca8e60a3332d78e690f41960abea28248edafcb05673429f94be1`, `docs/chipnet-log.md`): all permitted steps accepted, all three invalid attempts refused.

## D9 — Authorization interface v2: protected outputs hold no key

**Date:** 16 Nov 2026 · **Status:** implemented, tested in the VM, and run once on chipnet; supersedes the signature rule (points 3 and the per-input signature) of D5

A protected output (wallet funds, or an application position such as a savings jar) no longer checks a signature. It requires that input 0 is the wallet's controller and that the controller continues with the same owner, epoch, recoverer and delay and no claim pending. The owner's signature is checked once, by the controller, and covers every input and output.

Compiled sizes: asset covenant 64 bytes (was 94), Savings Jar 64 (was 97). A protected input carries only its script, about 130 bytes less than before.

**Why**

- The XO engine derives keys per template. With a signature in every protected output, an application in its own template could never produce the wallet owner's signature, so every application would have had to be part of the wallet template, and adding one would have meant new keys for every wallet.
- With no key in the application, the Savings Jar is its own XO template with no secrets, usable with any wallet identity. Opening a jar is an ordinary payment to its address; emptying it is the wallet template's `approve` action with the jar as an extra input.

**Why this is still owner approval and not mere presence of the controller**

Only the controller's owner-signed functions can produce the required successor state. A recovery request leaves a claim pending; a completed recovery changes the owner and the epoch. The tests show a protected input refusing to ride along with either, and failing at the controller when anyone but the owner signs or when the signature leaves inputs or outputs open.

**What changes for safety**

- Before, a protected output was safe even against a flaw in the controller, because it checked the signature itself. Now its safety rests on the controller never offering a way to reach the unchanged successor state without the owner's signature. Any later controller version must keep that property; the state's version byte ties an application to the controller rules it was written against.
- One signature on the controller releases every protected input in the transaction. A wallet must therefore examine every input of a transaction it is asked to approve and show the user everything being spent. This was enforced by the contracts before and is now the wallet software's duty.

**Chipnet:** the scripted lifecycle was run with these contracts (identity `f1ff8fb1ffbaf081d161d67a2d578bff9fa0476ab4dd4dc288b8e7fff83b33b9`, `docs/chipnet-log.md`). All permitted steps were accepted. The network refused a spend of wallet funds attached to a recovery request, a completion before the delay, and a spend approved by the old owner key after recovery. Eleven transactions cost 8,763 satoshis in fees, against roughly 1,000 each for controller transactions before.

## D10 — Enrollment package and restoration archive v1

**Date:** 16 Nov 2026 · **Status:** implemented, tested against a simulated chain, and run once on chipnet through the XO engine (`docs/restoration.md`)

The formats and rules are described in `docs/restoration.md`. The choices made:

- **Sealing:** HPKE base mode with X25519, HKDF-SHA256 and ChaCha20-Poly1305. The sender is identified by the owner's signature inside the package and by the chain, not by the encryption.
- **Recovery credential:** a dedicated mnemonic; the recovery key is the first key the XO engine derives from it for the wallet template. The recoverer opens it as its own XO account.
- **Archive:** records signed by the owner key of their epoch, encrypted with XChaCha20-Poly1305 under a key shared with the recoverer, chained by naming the previous record, and stored as blobs named by their hash on one or more stores. The device keeps a full copy from which stores are filled, so stores can be added or replaced without the old ones.
- **Write before sign:** on by default, with every configured store required to confirm.
- **Templates** are kept whole in the archive and referred to by content hash.
- **Confirmation of receipt** is a note signed with the recovery key and left in the archive, so it needs no channel from the recoverer back to the owner.

**Why records are verified against the chain and not by the archive key:** the recoverer holds the archive key, so the key cannot be what makes a record valid. The controller's history gives the owner of each epoch, and a record counts only when signed by that owner.

**Why completeness is checked by walking the controller's history:** the controller state has no room set aside for an archive checkpoint, and a checkpoint would not list missing positions by itself. Every owner-approved transaction is in the controller's history, so an unspent output to a script address that no record describes can be found without any extra on-chain data. The limits of this are listed in `docs/restoration.md`.

**What a record cannot do:** direct the wallet to an address. For a known kind of position the script is rebuilt from the parameters and the wallet identity and must equal the recorded one.

## D11 — Web applications

**Date:** 16 Nov 2026 · **Status:** implemented and run end to end on chipnet in browsers (`docs/web-apps.md`)

- **Three pages on three addresses**, so that the browser keeps the owner's, the recoverer's and the application's storage apart, and the connection between wallet and application is a real one between sites.
- **Everything between the pages travels as links**, with the content after `#`. No server of this project sees a package, a request or a key.
- **The recoverer's encryption key is made in the visitor's browser and handed over in a setup link**, instead of being published at a fixed path on the recoverer's site as first planned. The demo is public, and every visitor has to be able to act as a recoverer. A recoverer with a site of its own would publish the key there; the wallet shows the key's fingerprint either way.
- **A move to a new device is one XO invitation passed between the recoverer and the device**: the recoverer starts it, the device joins with its key, the recoverer sends it. That costs three links. It is how the device's engine comes to hold its key and to know the controller, and it is XO's own way for two parties to make one transaction.
- **The wallet sets aside the recoverer's fees when it is created**, at the first ordinary address of the recovery credential, which the wallet can work out. A visitor then funds one address, and a recoverer can act without coins of its own. The amount covers three requests and one completion.
- **Requests from applications are a WizardConnect extension, `xo_v1`**, using only the session's pairing and custom messages. The wallet advertises templates by identifier and content hash, with the operations it offers for each; an application names one and the user's values. A request is carried out at most once per identifier.
- **The wallet offers no key paths in a WizardConnect session.** Its funds are spent through the controller, not by plain signatures, so the standard signing request has nothing to work with.
- **Actions that are not sent release the coins they named.** The engine holds an invitation's inputs for it; without this, one failed attempt left the recoverer's fee account looking empty.
- **Waiting periods are offered in time only.** A count of blocks stays possible in the contract, but depends on what a network makes of a block: on chipnet with one-minute blocks a delay of 5 was enforced as 50 blocks. Units of 512 seconds mean the same everywhere.
- **Preact and Vite**, with the XO engine in the page and its Node-only imports replaced by empty stand-ins, as the XO web tool does.
