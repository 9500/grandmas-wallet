# Decisions log

Protocol and tooling decisions, newest last. Each entry records what was decided, on what evidence, and what it affects.

The log holds the decisions that apply to the design in [design.html](design.html). Numbers that are missing belong to parts that have been replaced; those entries, the run logs they cite and the acceptance tests that labels such as C05 or R01 refer to are in the repository at the tag `design-1`.

## D1 — Controller state is stored unhashed in the NFT commitment

**Date:** 15 Nov 2026 · **Status:** decided

The controller state (69 bytes) is stored directly in the identity NFT's commitment, so that asset and application contracts can read the current owner from the controller input.

**Evidence**

- CHIP-2024-12 P2S: "The limit on maximum length of token commitments is raised from 40 bytes to 128 bytes." Active on chipnet since Nov 2025 and on mainnet since 15 May 2026.
- Checked in the libauth `BCH_2026_05` virtual machine with standardness enabled: a 69-byte and a 128-byte commitment are accepted, 129 bytes is rejected, and 69 bytes is rejected under the 2025 rules (`packages/core/test/commitment-limit.test.ts`).

**Consequence:** the state does not need to be hashed to fit. 59 bytes remain free for later fields.

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

Each XO package is declared, at the version above, by the workspace that uses it.

## D4 — Controller contract v1

**Date:** 15 Nov 2026 · **Status:** implemented, tested in the VM and run on chipnet; not audited. D7 and D8 change two of the rules below.

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

- The initial state is not checked by the contract. A client must validate the genesis transaction (exactly one token output of the category, mutable, valid state, sent to the controller script) before trusting an identity (`packages/core/src/genesis.ts`).
- The VM tests check that the finalizing input carries a sequence number satisfying the delay. That the UTXO has really aged that long is enforced by nodes (BIP68); see D13.
- Any party can attach further inputs and outputs to a controller transaction. The signer's signature covers all of them.
- The epoch stops at 2^31-1 owner changes.

**Tests:** `packages/core/test/controller.test.ts` runs the compiled bytecode in the libauth 2026 VM with standardness rules on. Each rejection test first confirms the unmodified transaction is accepted, then applies one change.

## D7 — Controller address is specific to each wallet

**Date:** 15 Nov 2026 · **Status:** implemented, tested in the VM, and run on chipnet; supersedes the "no constructor parameters" part of D4

The controller contract takes the wallet identity as a parameter and requires the token it carries to be that identity's NFT with mutable capability. Compiled size is 405 bytes plus the 33-byte identity push.

**Why:** with one shared controller script, every wallet's controller sat at the same address. Tools that follow outputs by script (the XO engine, Electrum subscriptions) then show every wallet's controller to every user: an XO test account listed another wallet's controller as its own spendable output. With the identity in the script, a wallet's controller can be found and watched by address, and a notification for that address concerns that wallet only.

**Unchanged:** the transition rules and the state layout. The address is derived from the identity alone. A template can express the script with the identity as a variable, so one template serves all wallets.

**Evidence:** `packages/core/test/controller.test.ts` adds a test that another wallet's identity token at this wallet's controller address is rejected. The chipnet lifecycle was repeated with this contract (identity `ffc65007e29e31f46d50755bf812f1a05364b6cf0d2683264d379826a82f9939`): all permitted steps accepted, all invalid attempts refused.

## D8 — Contracts accept two signing types

**Date:** 15 Nov 2026 · **Status:** implemented and tested in the VM; supersedes the "signing type `0x61` only" rule in D4

The controller and the shared authorization interface accept a signature of type `0x41` (all inputs and outputs) or `0x61` (the same plus the amount and script of every spent output). Any other type is rejected. Compiled size of the controller: 412 bytes.

**Why:** the current XO engine cannot produce a valid `0x61` signature for a transaction with more than one input (`docs/xo-engine-signing-bug.md`), and every controller transaction has at least two. Requiring `0x61` would make the wallet unusable on the stock engine, which the hackathon bounty expects.

**What `0x41` still guarantees:** the signature commits to every input outpoint, every sequence number, every output, and the signed input's own amount and script. It cannot be reused in another transaction and no output can be altered. The contract's properties are unchanged, and the tests run every transition under both types.

**What it gives up:** the signer's own assurance about the amounts and scripts of the *other* inputs. A signer that looks those up itself, as the wallet and the XO engine do, loses nothing. A signer that is handed a transaction without that data (an offline or hardware signer) would not notice if it were lied to about another input's amount. Such a signer should use `0x61`, which stays accepted; this project's own transaction builder uses `0x61`.

**Evidence:** every transition is tested under both types, and six other types are rejected (`packages/core/test`). The chipnet lifecycle was run with this contract (identity `1a2e586aad9ca8e60a3332d78e690f41960abea28248edafcb05673429f94be1`): all permitted steps accepted, all invalid attempts refused.

## D13 — Time locks as the network enforces them

**Date:** 15–16 Nov 2026 · **Status:** observed on chipnet with one-minute blocks

- A time-based relative delay is enforced by nodes against the median time of the last eleven blocks, which trails the clock. With a delay of one 512-second interval, the completing transaction was accepted about 11 minutes after the request was sent. Completion immediately after the request was refused (`non-BIP68-final`).
- An absolute time lock behaves the same way: with a 5-minute lock, the spend was accepted about 12.5 minutes after the output was created.
- A delay counted in blocks depends on what a network makes of a block: on chipnet with one-minute blocks a delay of 5 was enforced as 50 blocks. Units of 512 seconds mean the same everywhere, so waiting periods are offered in time only. A count of blocks stays possible in the contract.
- A controller transaction is roughly 700 to 1,000 bytes.

## D14 — Sealing, signing and backup stores

**Date:** 16 Nov 2026 · **Status:** implemented and tested (`packages/enrollment`, `packages/archive`, `apps/archive-store`)

- **What the recoverer is given** is sealed to the recoverer's encryption key with HPKE in base mode (X25519, HKDF-SHA256, ChaCha20-Poly1305) and travels once, in a link or a QR code. The sender is identified by the owner's signature inside and by the chain, not by the encryption.
- **What is kept on backup stores** is encrypted with XChaCha20-Poly1305 and stored as blobs named by their hash, on one or more stores. A store sees neither whose the blobs are nor what they hold.
- **A signature names its purpose**, so a message signed for one use cannot be presented for another.

## D15 — Web pages and the connection to applications

**Date:** 16 Nov 2026 · **Status:** decided; the pages themselves are to be rebuilt

- **The wallet, the recoverer and each application are pages on separate addresses**, so that the browser keeps their storage apart, and the connection between wallet and application is a real one between sites.
- **Everything between the pages travels as links**, with the content after `#`. No server of this project sees a package, a request or a key.
- **The recoverer's encryption key is made in the visitor's browser and handed over in a setup link.** The demonstration is public, and every visitor has to be able to act as a recoverer. A recoverer with a site of its own would publish the key there; the wallet shows the key's fingerprint either way.
- **Requests from applications are a WizardConnect extension, `xo_v1`**, using only the session's pairing and custom messages. A request is carried out at most once per identifier.
- **The wallet has no code for any application.** An application presents its XO template with its request; a template the wallet has not seen is shown to the user, by name, description and actions, to trust and remember or to decline.
- **The user sees two things side by side:** the template's words and the wallet's own figures taken from the transaction (what goes where, the fee, the earliest time). An application can word its template as it likes; it cannot change the figures.
- **The same application serves ordinary wallets.** It shows one WizardConnect address; a wallet that shares key paths is asked to sign transactions the application builds. Checked with Cashonize on chipnet.
- **Actions that are not sent release the coins they named.** The XO engine holds an invitation's inputs for it; without this, one failed attempt left an account looking empty.
- **A template has to be kept as the text it arrived in.** Its identifier depends on the order of its fields.
- **A template variable of type `timestamp` cannot be used in a script that is to be unlocked later:** the engine reads the stored value back as text.
- **Preact and Vite**, with the XO engine in the page and its Node-only imports replaced by empty stand-ins, as the XO web tool does.
