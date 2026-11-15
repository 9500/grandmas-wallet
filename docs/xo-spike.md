# XO engine spike

**Date:** 15 Nov 2026 · **Status:** blocked on one design decision. The engine runs our contracts as far as creating a wallet on chipnet, but it cannot sign a transaction that spends the controller, because of how it handles the signing type the contracts require. See "The signing problem" below.

## Answers so far

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the engine start on chipnet in Node? | Yes, with an IndexedDB shim | Exp. 1. The SQLite storage is a stub (templates only); `Engine.create` with `StorageType.SQLITE` fails with `listScriptHashes is not a function`. With `fake-indexeddb` it starts in about 1.5 s. State is then in memory only. |
| Does the template validator accept a template built on our compiled contracts? | Yes | Exp. 2. Contract bytecode goes in as a raw hex script (`0x…`); constructor arguments are pushed before it. |
| Does the engine compile the controller and wallet outputs to the same locking bytecode as our own code? | Yes, both | Exp. 3 and 8. Controller and asset covenant locking bytecode are byte-for-byte identical to `packages/core`. |
| Can a template compute an NFT commitment? | Only by joining hex text | Exp. 3 and 4. Token fields (category, commitment) are evaluated as text. Variables are inserted as their hex text, and pieces can be concatenated inside one `$( … )`. Byte operations and hashing give unusable results, and key operations (`<key.public_key>`) are not available there at all. |
| Can an action be funded from ordinary coins held under another template? | Yes | Exp. 11. The wallet was created through the engine with a pay-to-public-key-hash input from the standard wallet template in the same invitation. |
| Can the identity be created through the engine? | Yes | Exp. 11 and 12. The engine-built genesis (chipnet `453795030d49c50e7dad639483ff868886037eb2f57a09ccebbdd6474dd3246c`) passes `validateGenesis`, and its controller and wallet addresses equal the ones `packages/core` derives. |
| Can the engine spend the controller and a wallet output together? | It builds the transaction correctly but signs it wrongly | Exp. 11, 13, 14. Layout, state and unlocking scripts are right; both signatures are invalid. See "The signing problem". |
| Finalization with a relative timelock, and the recoverer acting from a second account | Not reached | Blocked by the signing problem. The recoverer account did derive its key and receive funds. |
| Are keys reproducible from the mnemonic? | Yes, per template | Exp. 3. A secret is a derivation index; the same mnemonic, template and index give the same key on every run. A key is derived under the template identifier, so any change to the template changes every key. |
| Does block header verification cope with chipnet today? | No, but it does not stop the engine | Exp. 5 and 6. Verification stops at height 332451 ("claims target 486604799, expected 437753688") about 500 blocks below the tip and logs errors for every later transaction. Confirmed outputs are still recorded and listed. |
| Does the engine run in a browser? | Yes | Exp. 7. With the dev wallet's build workarounds (`@xo-cash/state` imports `fs`, `path`, `better-sqlite3` and `indexeddbshim`, which must be stubbed) it starts in headless Chromium in about 1.5 s, connects to chipnet, and keeps its template, keys and invitations across a page reload. The bundle is 1.6 MB before compression. |
| Can we derive the engine's keys ourselves? | Yes | Exp. 15. A template key is at `m/42415'/{first 4 bytes of the template identifier, little-endian, 31 bits}'/0'/{index}` on test networks (`2415'` on mainnet). Keys derived this way matched the owner and recoverer keys the engine had put into the wallet state, and our own builder then spent the engine-created wallet. |

## The signing problem

Our contracts require signatures of type `0x61`: all inputs, all outputs, and all spent outputs ("UTXOs"). In a template this is `schnorr_signature.all_outputs_all_utxos`.

When the engine signs an input it gives the signing code the spent output of that input only; the spent outputs of the other inputs are left empty (`sourceOutputs[inputIndex] = …` on an otherwise empty list). A signature that covers all spent outputs is therefore computed over the wrong data whenever the transaction has more than one input, and the network rejects it. Experiment 14 confirms this exactly: both of the engine's signatures verify against a message built with only that input's spent output, and against nothing else.

Every transaction that spends the controller has at least two inputs (the controller plus a fee or wallet input), so with the current contracts no controller action can be executed through this engine version. The standard templates do not meet the problem because they use `all_outputs` (type `0x41`), which needs only the signed input's own spent output.

Options:

1. **Accept type `0x41` in the contracts as well.** `0x41` still covers every input outpoint, every output and the signed input's own value and script, so a signature cannot be moved to another transaction or have outputs changed. What is lost is the signer's assurance about the *other* inputs' amounts and scripts, which matters for a signer that cannot look them up (an offline or hardware signer), not for the contract. This is a small contract change and unblocks XO now.
2. **Wait for an engine fix** and report the problem to the XO team. The contracts stay as they are; XO work stops until then.
3. **Build the transactions with our own builder and use XO only for description.** Possible, since we can derive the same keys (experiment 15), but it would not meet the bounty's requirement of a transaction executed through an invitation.

## Other things learned while executing

- **Follow-up actions must not generate keys.** The engine finds the key for a spend through the invitation that created the spent output's script, which works because the controller and wallet addresses are constant per wallet. The trial template made every action generate a key so that fresh Node processes would re-derive key 0; with persistent state that would produce a new, wrong key on every action. The real template must generate keys only when the wallet is created.
- **The recoverer needs a way to hold its key without having taken part in creating the wallet.** The engine only knows keys through invitations the account took part in. Either the recoverer joins the creating invitation (XO's own multi-party flow, a two-way exchange), or the owner derives the recoverer's public key from the recovery mnemonic it generated (experiment 15 shows the derivation) and the recoverer's first action generates that same key.
- **An invitation input must name its template input** (`inputIdentifier`), or the engine does not know which unlocking script to use.
- **An output only counts as the account's own if its script was resolved through the template** in the current engine state; a raw locking bytecode added as change is not tracked.
- **The engine's fee estimate assumes small inputs** (160 satoshis per input, 120 per output). A controller input is about 540 bytes, so change has to be set by the wallet.
- **`executeAction` can throw after a successful broadcast** (`UnspentOutputNotFoundInStoreError` while clearing reservations). The transaction is on the network; the error must not be read as failure.
- **Editing the template orphaned a live wallet during the spike.** An output was added to the template after the wallet had been created; the identifier and with it the owner key changed, and the wallet could only be spent again after restoring the exact earlier template. The frozen copy is `spikes/xo-engine/flow-template.json`.

## The chipnet header problem

Checked on 15 Nov 2026: no newer release exists that could fix it. The engine in use is the newest published (`next`, 14 Nov). Header verification lives in `@electrum-cash/application` (newest: 1 Oct) with network parameters from `@electrum-cash/checkpoint` (newest: 30 Sep); both predate the chipnet change, and neither repository shows related work.

The cause is the switch to one-minute blocks. The packaged chipnet parameters fix the ideal block time at 600 seconds. Height 332451 (12:35 UTC on 15 Nov) is the first block under the new rules: it claims minimum difficulty after a gap of 160 seconds, which the new rules allow (more than twice 60 seconds) and the old ones do not (more than twice 600), and the blocks after it use a difficulty about ten times lower than before (experiment 9).

The engine accepts custom network parameters through its `electrumServers` option, so a local workaround may be possible once the new chipnet difficulty parameters are known. It has not been tried. For now the effect is limited to logged errors and a chain status that stays behind the tip.

## Consequences for the design

1. **The wallet computes controller states, the template only assembles them.** The owner key hash, the next state and the finalized state are passed in as variables. This suits us: `packages/core` already computes every successor state. It also means the template cannot by itself guarantee that an output state is right; the contract does that.
2. **The controller address should become specific to each wallet.** The controller script is currently the same for every wallet. The engine tracks outputs by script, so an account using this template was shown another wallet's controller output (the one left on chipnet by the scripted run) as its own selectable output. The same applies to any Electrum-based monitoring. Placing the identity in the controller script, as the asset covenant already does, gives each wallet its own controller address. This is a contract change and is not made yet.
3. **A template revision changes all keys.** Keys are derived under the template identifier, which is a hash of the template content. Changing any text in the template gives a different owner key for the same mnemonic. The template must be frozen before any wallet is created with it, and a later template version needs an owner-key rotation on chain, not just a software update.
4. **The recoverer's key can be known to the owner in advance.** Since derivation is deterministic, the owner can open the recovery mnemonic it generated, derive the recoverer's public key, and put its hash into the initial state. The recoverer's engine, opened later with the same mnemonic and template, derives the same key. This still has to be shown end to end.
5. **Node processes cannot persist engine state** with the pinned version. Scripts must repeat key generation in the same order on every run, or run in a browser.

## Still open

Waiting on the signing decision:

- A follow-up action that spends the controller and a wallet output together, accepted by the network.
- Finalization with a relative-timelock sequence number.
- The recoverer acting from a second account.
