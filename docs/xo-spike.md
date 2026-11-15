# XO engine spike

**Date:** 15 Nov 2026 · **Status:** done. The unmodified XO engine runs the whole recovery lifecycle with our contracts on chipnet, once the contracts accept the plain "all inputs and outputs" signing type (decision D8). One engine defect was found, fixed locally to confirm the diagnosis, and written up for the XO team (`docs/xo-engine-signing-bug.md`).

## Answers so far

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the engine start on chipnet in Node? | Yes, with an IndexedDB shim | Exp. 1. The SQLite storage is a stub (templates only); `Engine.create` with `StorageType.SQLITE` fails with `listScriptHashes is not a function`. With `fake-indexeddb` it starts in about 1.5 s. State is then in memory only. |
| Does the template validator accept a template built on our compiled contracts? | Yes | Exp. 2. Contract bytecode goes in as a raw hex script (`0x…`); constructor arguments are pushed before it. |
| Does the engine compile the controller and wallet outputs to the same locking bytecode as our own code? | Yes, both | Exp. 3 and 8. Controller and asset covenant locking bytecode are byte-for-byte identical to `packages/core`. |
| Can a template compute an NFT commitment? | Only by joining hex text | Exp. 3 and 4. Token fields (category, commitment) are evaluated as text. Variables are inserted as their hex text, and pieces can be concatenated inside one `$( … )`. Byte operations and hashing give unusable results, and key operations (`<key.public_key>`) are not available there at all. |
| Can an action be funded from ordinary coins held under another template? | Yes | Exp. 11. The wallet was created through the engine with a pay-to-public-key-hash input from the standard wallet template in the same invitation. |
| Can the identity be created through the engine? | Yes | Exp. 11 and 12. The engine-built genesis (chipnet `453795030d49c50e7dad639483ff868886037eb2f57a09ccebbdd6474dd3246c`) passes `validateGenesis`, and its controller and wallet addresses equal the ones `packages/core` derives. |
| Can the engine spend the controller and a wallet output together? | Yes, with signing type `all_outputs` | Exp. 11. On the unmodified engine with the D8 contracts: chipnet `6c38365b12e7d7cc675cb40ce84994c639c46eef9abc1d5ace166d3860b5ba46`. With `all_outputs_all_utxos` the engine signs wrongly; see "The signing problem". |
| Can the recoverer act from a second account, paying its own fee from ordinary coins? | Yes | Exp. 11. Claim: chipnet `92d6c9b88273b2f7e4a2208455ebee8bff3fae180a01e86f4bc266dace4d207b`. The recoverer's key is the first key its account derives under the template; the owner had put its hash into the wallet state beforehand. |
| Does finalization with a relative-timelock sequence number work? | Yes | Exp. 11. The template's `sequenceNumber` expression sets the input's sequence; the network refused the transaction until the delay had passed and accepted it about 11 minutes after the claim: chipnet `3f178550fc11a85682a484fbd56b5bb39afdccbd1911e5415ec04c7035240218`. A spend by the owner afterwards was accepted too (`af4e3e5ae7233478b65c2d3339aee95829f63e79b74a5c6d14bc574db5a23791`). |
| Are keys reproducible from the mnemonic? | Yes, per template | Exp. 3. A secret is a derivation index; the same mnemonic, template and index give the same key on every run. A key is derived under the template identifier, so any change to the template changes every key. |
| Does block header verification cope with chipnet today? | No, but it does not stop the engine | Exp. 5 and 6. Verification stops at height 332451 ("claims target 486604799, expected 437753688") about 500 blocks below the tip and logs errors for every later transaction. Confirmed outputs are still recorded and listed. |
| Does the engine run in a browser? | Yes | Exp. 7. With the dev wallet's build workarounds (`@xo-cash/state` imports `fs`, `path`, `better-sqlite3` and `indexeddbshim`, which must be stubbed) it starts in headless Chromium in about 1.5 s, connects to chipnet, and keeps its template, keys and invitations across a page reload. The bundle is 1.6 MB before compression. |
| Can we derive the engine's keys ourselves? | Yes | Exp. 15. A template key is at `m/42415'/{first 4 bytes of the template identifier, little-endian, 31 bits}'/0'/{index}` on test networks (`2415'` on mainnet). Keys derived this way matched the owner and recoverer keys the engine had put into the wallet state, and our own builder then spent the engine-created wallet. |

## The signing problem

Our contracts require signatures of type `0x61`: all inputs, all outputs, and all spent outputs ("UTXOs"). In a template this is `schnorr_signature.all_outputs_all_utxos`.

When the engine signs an input it gives the signing code the spent output of that input only; the spent outputs of the other inputs are left empty (`sourceOutputs[inputIndex] = …` on an otherwise empty list). A signature that covers all spent outputs is therefore computed over the wrong data whenever the transaction has more than one input, and the network rejects it. Experiment 14 confirms this exactly: both of the engine's signatures verify against a message built with only that input's spent output, and against nothing else.

Every transaction that spends the controller has at least two inputs (the controller plus a fee or wallet input), so contracts that insist on `0x61` cannot be used through this engine version. The standard templates do not meet the problem because they use `all_outputs` (type `0x41`), which needs only the signed input's own spent output.

What was done about it:

1. **The diagnosis was confirmed with a local fix.** Filling in the other inputs' spent outputs (about ten lines, `spikes/xo-engine/patches/engine-sign-all-utxos.mjs`) made the engine's signatures valid. With the fix and the `0x61`-only contracts, the full lifecycle ran on chipnet: create, spend, claim, finalize after the delay, spend again.
2. **The contracts now accept `0x41` as well as `0x61`** (decision D8), so the wallet does not depend on the fix. With these contracts and `all_outputs` in the template, the same lifecycle ran on the unmodified engine.
3. **The defect is written up for the XO team** in `docs/xo-engine-signing-bug.md`, with the cause, a reproduction, the fix, and the chipnet transactions that show it working.

The patch is not applied in the repository's normal state; the wallet is to be built on the published engine.

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

### The rule chipnet follows now

Read from the source the chipnet build is made from: Bitcoin Cash Node merge request !2184, "Implement CHIP-2025-03 Faster Blocks for Bitcoin Cash" (branch `blocktime/proposed1`, commit `6f12f6a`), files `src/chainparams.cpp`, `src/consensus/consensus.h` and `src/pow.cpp`. The master branch does not contain it.

| Parameter (chipnet) | Value |
| --- | --- |
| Activation | `upgrade2027ActivationTime = 1794744000` (2026-11-15 12:00:00 UTC); a block is under the new rules when its parent's median time past is at or after this |
| First block under the new rules | height 332451 (derived from the headers, not a constant in the source) |
| Ideal block time | 600 seconds before, 60 seconds from that block on |
| Difficulty anchor | unchanged: height 16844, bits `0x1d00ffff`, previous block time 1605451779, mined at a 600-second interval |
| Half-life | unchanged: 3600 seconds |
| Minimum-difficulty rule (test networks) | allowed when a block's time is more than twice the ideal block time after its parent: 1200 seconds before, 120 seconds after |

The difficulty formula changes from counting blocks to counting "ticks", the sum of the ideal block times of all blocks so far:

```
exponent = (parent time - anchor previous time) - (ticks at parent - ticks at anchor + 600)
target   = anchor target * 2^(exponent / half-life) * (600 / ideal block time of this block)
```

Before the activation every block adds 600 ticks, so this equals the old formula. After it, each block adds 60 ticks and the target is multiplied by ten.

Experiment 16 implements this reading and compares it with real chipnet headers: 24 blocks around the activation and the last 300 blocks up to the tip (height 333059). All 324 match.

### What a fix takes

Two small changes, both outside the engine itself:

- `@electrum-cash/checkpoint`: chipnet's parameters gain the activation point and the new ideal block time.
- `@electrum-cash/application`: `calculateAsertTarget` uses the tick-based formula and the per-block ideal time for the minimum-difficulty rule. About 30 to 40 lines.

For chipnet the activation height can be a constant, since it is now history. Mainnet activates by median time past in May 2027, so a general fix has to derive the activation from the header chain, which needs the eleven headers before each block.

A local fix exists: `spikes/xo-engine/patches/chipnet-faster-blocks.mjs` changes the two installed packages. With it, verification reaches the tip about 10 seconds after start, follows new blocks, and logs no errors once it has caught up. The write-up for the maintainers is `docs/xo-chipnet-header-verification.md`.

## Consequences for the design

1. **The wallet computes controller states, the template only assembles them.** The owner key hash, the next state and the finalized state are passed in as variables. This suits us: `packages/core` already computes every successor state. It also means the template cannot by itself guarantee that an output state is right; the contract does that.
2. **The controller address should become specific to each wallet.** The controller script is currently the same for every wallet. The engine tracks outputs by script, so an account using this template was shown another wallet's controller output (the one left on chipnet by the scripted run) as its own selectable output. The same applies to any Electrum-based monitoring. Placing the identity in the controller script, as the asset covenant already does, gives each wallet its own controller address. This is a contract change and is not made yet.
3. **A template revision changes all keys.** Keys are derived under the template identifier, which is a hash of the template content. Changing any text in the template gives a different owner key for the same mnemonic. The template must be frozen before any wallet is created with it, and a later template version needs an owner-key rotation on chain, not just a software update.
4. **The recoverer's key can be known to the owner in advance.** Since derivation is deterministic, the owner can open the recovery mnemonic it generated, derive the recoverer's public key, and put its hash into the initial state. The recoverer's engine, opened later with the same mnemonic and template, derives the same key. This still has to be shown end to end.
5. **Node processes cannot persist engine state** with the pinned version. Scripts must repeat key generation in the same order on every run, or run in a browser.

## Not covered by the spike

- The owner and recoverer using persistent engine state in a browser across a whole lifecycle. Each step here ran in a fresh Node process, with a trial template in which every action generates its key so that a fresh process re-derives key 0. The real template must generate keys only when the wallet is created, and that arrangement has not been run end to end.
- One-way enrollment: the owner deriving the recoverer's public key from the recovery mnemonic. The derivation is shown to match (experiment 15), but here the recoverer's account produced its key hash first and handed it to the owner.
- Cancelling a claim, owner updates, token and NFT transfers, and the Savings Jar through the engine.
- The engine's block header verification on chipnet, which is still failing.
