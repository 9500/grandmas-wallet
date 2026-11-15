# XO engine spike

**Date:** 15 Nov 2026 · **Status:** partly done. Everything that needs no coins and no browser has been tried; executing transactions through the engine and running it in a browser are still open.

The spike asks whether the XO engine can express and run the recovery controller and asset covenant as a template. The experiments are in `spikes/xo-engine/` (not part of the workspace build) and use the versions the XO web dev wallet pins: engine `0.1.1-next.18029697917`, state `0.0.5`, templates `0.0.12`, types `0.0.8`, utils `0.0.10`, libauth `3.1.0-next.8`.

## Answers so far

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the engine start on chipnet in Node? | Yes, with an IndexedDB shim | Exp. 1. The SQLite storage is a stub (templates only); `Engine.create` with `StorageType.SQLITE` fails with `listScriptHashes is not a function`. With `fake-indexeddb` it starts in about 1.5 s. State is then in memory only. |
| Does the template validator accept a template built on our compiled contracts? | Yes | Exp. 2. Contract bytecode goes in as a raw hex script (`0x…`); constructor arguments are pushed before it. |
| Does the engine compile the controller and wallet outputs to the same locking bytecode as our own code? | Yes, both | Exp. 3 and 8. Controller and asset covenant locking bytecode are byte-for-byte identical to `packages/core`. |
| Can a template compute an NFT commitment? | Only by joining hex text | Exp. 3 and 4. Token fields (category, commitment) are evaluated as text. Variables are inserted as their hex text, and pieces can be concatenated inside one `$( … )`. Byte operations and hashing give unusable results, and key operations (`<key.public_key>`) are not available there at all. |
| Is the transaction layout expressible (controller at input 0 and output 0, a second contract in the same transaction, a sequence number on an input)? | The template format has all of it and the validator accepts it | Exp. 2. Not yet executed. |
| Are keys reproducible from the mnemonic? | Yes, per template | Exp. 3. A secret is a derivation index; the same mnemonic, template and index give the same key on every run. A key is derived under the template identifier, so any change to the template changes every key. |
| Does block header verification cope with chipnet today? | No, but it does not stop the engine | Exp. 5 and 6. Verification stops at height 332451 ("claims target 486604799, expected 437753688") about 500 blocks below the tip and logs errors for every later transaction. Confirmed outputs are still recorded and listed. |
| Does the engine bundle for a browser? | Yes, with the dev wallet's workarounds | Exp. 7. `@xo-cash/state` imports `fs`, `path`, `better-sqlite3` and `indexeddbshim`; these must be stubbed or polyfilled. The bundle is 1.6 MB before compression. Running it is untested: headless Chromium on the dev VM lacks system libraries. |

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

These need transactions to be executed through the engine, which needs chipnet coins at an engine-controlled address:

- Funding an action from another template's outputs (ordinary pay-to-public-key-hash coins) in the same invitation.
- Whether signatures made by the engine for a pay-to-script-hash input satisfy our contracts (covered script, signing type `all_outputs_all_utxos`).
- Creating the identity through the engine: the token category must equal the hash of a spent outpoint with index 0.
- A follow-up action that spends the controller and a wallet output together.
- Finalization with a relative-timelock sequence number.
- The recoverer acting from a second account.

And one needs a browser:

- Starting the engine in a real browser with IndexedDB, and state surviving a reload.
