# Grandma's Wallet — Implementation Plan

**Based on:** [Architecture proposal v0.1](Grandmas_Wallet_Architecture_Proposal_v0.1.md)
**Date:** 15 November 2026
**Target:** BCH Blaze 2026 (14–28 Nov; judging listed as 23–27 Nov — confirm the submission deadline on DoraHacks)

This plan turns the proposal's Milestones A–D into concrete work. Section numbers prefixed with `§` refer to the proposal; `C01`…`X04` are its acceptance tests.

---

## 1. What the reference review established

Findings from the references (S1–S18) and from inspecting the published packages on 15 Nov 2026. These shape the plan and should be rechecked when dependencies are pinned.

### 1.1 Network and VM

- The May 2026 upgrade (P2S, loops, functions, bitwise) is live on mainnet and chipnet. XO templates declare `supported: [... "BCH_2026_05"]` and default to `lockingType: "p2s"`.
- **To verify:** the P2S CHIP's raised NFT-commitment limit (expected 128 bytes, up from 40). The controller state layout (§3.2 below) depends on it; the fallback is a hashed-state commitment.

### 1.2 XO stack (the bounty target)

| Fact | Consequence |
| --- | --- |
| Engine is `@xo-cash/engine@next` (`0.1.1-next.18029697917`); getting-started pins `0.1.0-next.17612568780`. No stable 0.1. All MIT. | Pin exact versions. Expect breaking changes. |
| Templates are JSON with `roles`, `actions`, `transactions`, `inputs`, `outputs`, `lockingScripts`, `variables`, `constants`, and `scripts` written in **CashASM** (libauth), e.g. `"OP_INPUTINDEX OP_OUTPUTBYTECODE OP_INPUTINDEX OP_UTXOBYTECODE OP_EQUALVERIFY"`. | Contract bytecode must end up as CashASM / raw hex inside the template. CashScript artifacts are not consumed directly. |
| Template inputs support `sequenceNumber` (CashASM expression), transactions support `version` and `locktime`. | Relative timelocks (`OP_CHECKSEQUENCEVERIFY`) can be expressed in a template, including time-based values that CashScript's SDK cannot set. |
| Locking scripts declare tracked `state` (variables, secrets) and per-role follow-up `actions`. | Maps directly to the controller's state machine and the bounty's "follow-up actions" requirement. |
| **A secret is a derivation index into the account mnemonic, not a key.** The engine has no secret/key import API. | An owner-generated recovery key cannot simply be attached to the bank's account (proposal decision #6). See §3.5. |
| An account can hold only one role with a follow-up (`EntityMultipleRolesWithFollowUpUnsupportedError`). | Owner and bank must be separate accounts/processes — which is what we want anyway. |
| The validator rejects unknown template properties. | Restoration metadata lives in our own archive records, not inside the template JSON. |
| `@xo-cash/state` supports IndexedDB and SQLite; `RemoteEncryptedStateManager` is "Not implemented yet". | The restoration archive is ours to build. |
| Commits are append-only; reservations are local only; commit expiry is not enforced. | Affects crash recovery (R04/R05) and the connection adapter (X03). |
| Multi-party invitations need both sides to have imported the identical template. | The enrollment package must carry the exact template (§7.3). |
| `xo-web-devtool` (blaze.xo.cash) has no declared license. | Use it as a tool only; do not copy its code. |

### 1.3 Contract patterns (CashTokens, CashScript modular design)

- Authenticate a contract instance by **token category + capability**, never by locking bytecode alone: `tx.inputs[0].tokenCategory == category + 0x01`.
- Fixed input/output positions (controller at index 0) keep cross-contract checks cheap; document the layout per contract.
- Every persistent contract enforces its own recreation: bytecode, category, commitment, value, token amount.
- A category's uniqueness comes from its genesis transaction; **the genesis must be verified output by output** (no minting NFT, exactly one NFT of the category).
- Give the tracking NFT a non-empty commitment.
- `this.age` compiles to `OP_CHECKSEQUENCEVERIFY`; it is only consensus-enforced on **version 2** transactions. CashScript's `addInput()` treats the sequence as blocks only.

### 1.4 Applications

- **Cauldron** pools authorize withdrawal by a fixed `withdraw_pkh` + signature → not recoverable by owner rotation. Out of scope, as the proposal states. Swaps compose freely with extra inputs/outputs (future work).
- **Moria** loan NFTs are transferable → could later be held under the asset covenant. Not needed for the hackathon.

### 1.5 WizardConnect

- Packages `@wizardconnect/core` 0.2.10, `/wallet` 0.2.4, `/dapp` 0.2.7, `/react`. LGPL-3.0-or-later → link as a dependency, do not vendor or modify.
- Nostr relay transport, NIP-44 encryption, 65,535-byte plaintext cap with built-in chunking, replay filtering by `time`, dedupe by `sequence`.
- Extension mechanism: advertise a key in `session.extensions`, then use custom actions `<operation>_request` / `<operation>_response` paired by `sequence`. This is the hook for XO (§6 below).
- `hdwalletv1` itself assumes xpub-derived P2PKH inputs and `SIGHASH_ALL|UTXOS` — it cannot fund from controller-protected outputs. We need the extension, not the base sign flow.

### 1.6 Bounty requirements (S18)

1. A novel, functional XO template.
2. A Chipnet (or mainnet) transaction executed through an invitation, inspectable in the debug tool; submit the invitation.
3. Follow-up actions demonstrated.
4. Template + invitation + reproduction instructions.
5. **Personally written** developer feedback (~500 words). AI-written feedback is rejected — this must be written by hand. Keep a running `docs/xo-feedback-notes.md` of raw observations to write it from.

---

## 2. Technology choices

| Concern | Choice | Reason |
| --- | --- | --- |
| Language / runtime | TypeScript, Node 24, ESM | XO ecosystem is TypeScript. |
| Repo layout | npm workspaces monorepo | Small, no extra tooling. |
| Contract authoring | **CashScript 0.14** as readable source; compiled bytecode embedded in the XO template as hex with constructor arguments supplied as CashASM pushes | Auditable source plus exact bytecode reuse. Fall back to hand-written CashASM if a needed opcode pattern is not expressible. |
| Contract tests | libauth `3.1.0-next.8` VM (`BCH_2026_05`) driving the **exact bytecode** that goes into the template; vitest | One VM for unit and adversarial tests, no network. Avoids testing a different artifact than the one deployed. |
| Transaction building | XO engine for demonstrated flows; a thin libauth builder for tests, the monitor's cancel transaction, and anything the engine cannot express | Bank/owner flows must work even where the engine has gaps. |
| Enrollment encryption | HPKE (RFC 9180) base mode, DHKEM(X25519)/HKDF-SHA256/ChaCha20-Poly1305, via `hpke-js` | Proposal's candidate; small and standard. |
| Archive encryption / signing | XChaCha20-Poly1305 content key; secp256k1 Schnorr record signatures by the current owner key | Separates read capability from write authority (§9.4). |
| Chain access | Electrum (via the engine's `@electrum-cash/*`), at least two servers for monitoring | §3 "avoid a single notification endpoint". |
| UI | Vite + React web apps (owner, bank, demo dapp) | Fastest path; mobile hardening is explicitly later work. |

Proposed layout:

```
contracts/            CashScript sources, compiled artifacts, layout docs
packages/
  core/               state codec, genesis/continuity validation, tx builders, chain monitor
  templates/          XO templates (controller, asset, demo position) + build script
  enrollment/         package schema, HPKE envelope, QR/link encoding
  archive/            record schema, signing, encryption, store adapters, write-before-sign gate
  connect/            WizardConnect XO extension (wallet + dapp sides)
apps/
  owner/              owner wallet + background monitor
  bank/               recoverer console
  demo-dapp/          application that requests the demo position action
test/                 acceptance suites C*, R*, X*
docs/                 protocol notes, decisions log, demo script, xo-feedback-notes
```

---

## 3. Protocol baseline to implement

These are the concrete proposals for the open decisions in §19 of the proposal. Each is recorded in `docs/decisions.md` when confirmed or changed.

### 3.1 Identity issuance (decision #1)

- Genesis transaction: input 0 is an owner-funded outpoint at **index 0** (CashTokens genesis rule); its txid is the category = **wallet identity**.
- Outputs: exactly one token output — the controller, carrying one **mutable** NFT of that category. No minting NFT, no fungible amount.
- `core.validateGenesis(tx)` checks this output by output; every client (owner, bank, replacement wallet) runs it before trusting an identity (C09).
- Mutable capability lets the covenant rewrite its commitment; the covenant forbids capability change, burning, splitting, and any second output of the category.

### 3.2 Controller state (decision #1)

State is stored in the NFT commitment (plain, no hash) so that other contracts can read it from `tx.inputs[0].nftCommitment`.

| Field | Bytes | Notes |
| --- | --- | --- |
| format / interface version | 1 | `0x01`; unknown → reject (X02) |
| status | 1 | `0x00` Active, `0x01` Pending |
| owner epoch | 4 | +1 on any owner change |
| owner key hash | 20 | hash160 of owner pubkey |
| recoverer key hash | 20 | hash160 of recovery pubkey |
| challenge delay | 3 | BIP68 value; type flag included |
| proposed owner key hash | 20 | zero-filled when Active |

69 bytes. If the 128-byte limit is not available, commit to `hash256(state)` and pass the preimage in the unlocking script of every reader. The network id is bound by sighash fork-id and the category, not stored. A revision counter is omitted: the outpoint chain already orders states.

Constructor parameters of the controller script: none that vary per wallet (the category is read from its own UTXO), so all wallets share one controller bytecode and one template hash.

### 3.3 Controller transitions (decisions #3, #4, #5)

Layout: controller is always input 0 / output 0. Common checks for every function: `this.activeInputIndex == 0`, tx version 2, output 0 has same locking bytecode, same category+capability, `value >= input value` (C14), no other output carries the category (C09).

| Function | Auth | Commitment change |
| --- | --- | --- |
| `ownerAuthorize` | owner sig | Active → Active unchanged. From Pending: status→Active, proposed cleared (this *is* authorize-and-cancel, C10) |
| `requestRecovery` | recoverer sig | Active only → Pending with `proposedOwner`; everything else unchanged |
| `finalizeRecovery` | recoverer sig + `this.age >= delay` | Pending only → Active, owner := proposed, epoch+1, proposed cleared |
| `ownerUpdate` | owner sig | Any → Active with new owner and/or recoverer and/or delay; epoch+1 if owner changed |

- Pending cannot be re-claimed by the recoverer (C06): a new destination needs cancel-or-finalize first, hence a fresh delay.
- Signatures are `SIGHASH_ALL | SIGHASH_UTXOS`, binding all inputs and outputs (§6 property 3).
- The bank funds claim/finalize fees from its own input 1+; the controller value cannot decrease.
- **Chipnet demo delay:** block-based, e.g. 3 blocks, clearly labelled as test configuration. Time-based (512-second units) is exercised in VM tests via the template's `sequenceNumber` so the production path is proven even though the demo uses blocks.
- Including authorize-and-cancel in v1 is recommended: it costs one branch condition and removes the "cancel, then spend" UX gap.

### 3.4 Shared authorization interface v1 (decision #2)

A protected input (asset covenant or application position) is constructed with the identity category and checks, in its own script:

1. `tx.inputs[0].tokenCategory == identity + 0x01` — the genuine controller is input 0 (C09).
2. Commitment version byte is `0x01` (X02).
3. A supplied pubkey hashes to the **owner key hash read from input 0's commitment**, and a signature by it verifies over the transaction — owner authorization is checked by the asset itself, not inferred from the controller being spent (C07).
4. `tx.outputs[0]` commitment is Active with the **same owner and epoch** — a claim or finalize transition can never share a transaction with a protected spend, even if the old owner co-signs (C07, C08).
5. Its own application rules (token conservation, vesting, etc.).

After finalization the old owner's hash is no longer in the commitment, so old-key signatures fail everywhere at once (C12).

**Asset covenant:** one script parameterised by identity. Holds BCH, fungible tokens, or an NFT. Spending requires the interface; outputs are unconstrained (the owner signature covers them). The wallet's own policy sends change back to the same covenant. Receive address = this covenant's address → stable for the life of the identity, and receiving never touches the controller.

**Demo application position — "Savings Jar":** BCH locked until an absolute locktime; withdrawal requires *both* the locktime and interface authorization. It demonstrates §6 property 5 (recovery does not bypass vesting) and the end-to-end demo ("operate the same position without withdrawing it first"). An optional `topUp` action that anyone can call shows a non-owner path.

### 3.5 Recoverer capability in XO (decision #6)

Because XO secrets are derivation indexes, the **recovery credential is a dedicated BIP39 mnemonic** generated by the owner wallet, used for nothing else, and delivered inside the enrollment package. The bank opens it as its own XO account (`Engine.create(recoveryMnemonic, { network })`) holding the `recoverer` role.

- It is independent of the owner seed (§7.1) and reveals nothing about it.
- The owner derives the recovery public key from it at initialization, then discards the mnemonic (best effort).
- **Risk to check on day 2:** the bank's engine must derive the *same* key index the owner used. If the engine's `generate` step cannot be pinned, the bank's claim/finalize transactions are built with the libauth builder instead, and the XO demonstration of the bank role uses a bank-generated key supplied as a variable (a two-way exchange, noted as a prototype limitation).

---

## 4. Milestones

### Milestone A — Contract proof (proposal §17 A)

| # | Task | Output |
| --- | --- | --- |
| A1 | Repo scaffolding: workspaces, TypeScript, vitest, lint, CI running tests | green empty pipeline |
| A2 | `core/state`: encode/decode/validate commitment; property tests | codec |
| A3 | `contracts/controller.cash` with the four functions; compile; record bytecode size and op-cost | artifact + size report |
| A4 | `contracts/asset.cash`, `contracts/savings-jar.cash` using interface v1 | artifacts |
| A5 | libauth test harness: build transactions from fixtures, evaluate every input in the `BCH_2026_05` VM | `test/harness` |
| A6 | Positive tests: C01, C02, C05, C10, C11 | passing |
| A7 | Adversarial tests: **C03, C04, C06, C07, C08, C09**, C12, C14 — each as a hand-built malicious transaction that must fail for the stated reason | passing |
| A8 | Genesis + continuity validator (`validateGenesis`, `followController`) | used by all clients |
| A9 | Chipnet smoke run with libauth builder: genesis → fund → spend → claim → cancel → claim → finalize → spend with new key | txids in `docs/chipnet-log.md` |

**Exit gate (the proposal's first engineering checkpoint):** compiled controller + Savings Jar pass C03–C09 in the VM. Nothing else starts before this.

### Milestone B — XO workflow (§17 B)

| # | Task | Output |
| --- | --- | --- |
| B1 | Spike: import a minimal covenant template into the engine on chipnet; confirm token outputs, mutable-NFT commitments computed by CashASM, `sequenceNumber`, and multi-input transactions across two locking scripts work | go/no-go notes; issues logged for XO feedback |
| B2 | `templates/recovery-controller`: roles `owner`, `recoverer`; actions `initialize`, `send` (ownerAuthorize + asset inputs), `requestRecovery`, `cancelRecovery`, `finalizeRecovery`, `updatePolicy`; follow-ups attached to the controller locking script per role | template + content hash |
| B3 | Asset receive/send and Savings Jar (`deposit`, `withdraw`) as actions composing with the controller input | templates |
| B4 | Build script that injects compiled bytecode into templates and asserts it equals the bytecode tested in Milestone A | reproducible template build |
| B5 | Two-account script (owner process, bank process): initialize without the bank online; bank later imports and acts | `scripts/demo-xo.ts` |
| B6 | Recovery over XO with the Savings Jar left in place, then withdrawn by the new owner | invitation JSON files for the bounty |
| B7 | Verify each invitation loads in blaze.xo.cash | screenshots + repro instructions |

Fallback if B1 finds a blocking engine gap: keep the template as the description, execute the blocked action with the libauth builder, and report the gap in the feedback — and ask the XO team early, as the bounty page advises.

### Milestone C — Restoration proof (§17 C)

| # | Task | Output |
| --- | --- | --- |
| C1 | Enrollment package schema v1 (§7.3 field groups): network, identity + genesis txid, controller template (full JSON + hash), scheme/interface versions, recovery mnemonic, archive locators + content key, initial manifest, signed policy description | `enrollment/schema` |
| C2 | HPKE envelope to the bank's X25519 public key; sender signature by the owner key; encode as link/QR, with large parts by reference; measure sizes | R01 test |
| C3 | Archive record format (§9.3): versioned, hash-chained (`prev`), owner-signed with epoch, encrypted; statuses `prepared` → `confirmed` | `archive/record` |
| C4 | Store adapter interface + two implementations (local HTTP store ×2 instances, or HTTP + filesystem) with put-acknowledgment | R06 |
| C5 | Write-before-sign gate: wraps `signInvitation` and receive-address generation; refuses unless required stores acknowledged | R03 |
| C6 | Restore engine: package → validate genesis → follow controller → fetch + verify records against owner-epoch history → rediscover UTXOs by script → report complete / incomplete / unsupported per position | R02, R04, R05, R07, R08 |
| C7 | Replacement-wallet flow: fresh mnemonic, restore, hand new owner key hash to bank, take over after finalize, sign new records under new epoch | X04 |
| C8 | Bank acknowledgment message (optional) and "package created" vs "recoverer confirmed" status | UI state |

### Milestone D — Application experience (§17 D)

| # | Task | Output |
| --- | --- | --- |
| D1 | WizardConnect extension `xo_v1`: advertised in `session.extensions` with supported template hashes, interface and schema versions | negotiation |
| D2 | Messages `xo_action_request/response`, `xo_invitation_update`, `xo_action_result`; idempotent by `sequence` + invitation id | X03 |
| D3 | Wallet side: validate template hash against the reviewed set, build the invitation, add controller + asset inputs and change, run the write-before-sign gate, show effects, sign, broadcast | owner app |
| D4 | Demo dapp: "Open a Savings Jar" / "Withdraw" buttons; no invitation vocabulary in the UI | demo-dapp |
| D5 | Owner app screens: Set up recovery, Recovery enabled, Recovery request detected, Cancel recovery; developer inspector panel | §13 |
| D6 | Bank app screens: import package, enrolled wallet, propose replacement owner, claim status, chain-derived eligibility, finalize | §13 |
| D7 | Monitor: subscribe to the controller script hash on ≥2 Electrum servers; on Pending → alert and (configurable) auto-cancel; rebuild status after reorg/conflict | C13 |

---

## 5. Schedule

Assumes one developer and a submission by **22 Nov** to leave margin before judging starts; adjust once the DoraHacks deadline is confirmed.

| Day | Focus | Done when |
| --- | --- | --- |
| Sun 15 | Plan, repo, scaffolding (A1), state codec (A2) | CI green |
| Mon 16 | Controller + asset + jar contracts, harness (A3–A5) | positive tests pass |
| Tue 17 | Adversarial tests, validators, chipnet smoke (A6–A9); XO spike (B1) | **gate: C03–C09 pass** |
| Wed 18 | XO templates and two-account flow (B2–B5) | recovery runs through invitations |
| Thu 19 | Bounty artefacts (B6–B7); enrollment + archive format (C1–C3) | invitations inspectable in the debug tool |
| Fri 20 | Stores, gate, restore engine, replacement flow (C4–C7) | X04 passes from the command line |
| Sat 21 | WizardConnect path, owner/bank/dapp UI, monitor (D1–D7) | end-to-end demo in browsers |
| Sun 22 | Demo recording, README, repro instructions, **hand-written XO feedback**, submit | submitted |
| 23–27 | Buffer during judging: fixes, docs | — |

**Cut order if time runs short** (last cut first): WalletConnect (already out) → second archive store → WizardConnect path (replace with a direct in-page request) → web UIs (replace with CLI scripts) → token variants of the asset covenant. Never cut: Milestone A tests, the XO template + invitation, the adversarial demonstration.

---

## 6. Acceptance-test mapping

| Tests | Level | Milestone |
| --- | --- | --- |
| C01–C12, C14 | libauth VM, exact template bytecode | A |
| C13 | integration against a mocked Electrum with reorg/conflict scripts | D7 |
| R01 | unit: envelope yields nothing without the bank private key | C2 |
| R02, R04, R05, R07, R08 | integration: archive + restore engine with in-memory chain | C6 |
| R03, R06 | integration: store failure / corruption injection | C4–C5 |
| X01 | demo: dapp server stopped before restore | C7 |
| X02 | unit: unknown version bytes in commitment, package, record, extension | A2, C1, C3, D1 |
| X03 | integration: replayed and re-delivered requests | D2 |
| X04 | scripted chipnet run + recorded demo | C7 |

The two demonstrations from §18 become scripts: `scripts/demo-recovery.ts` (full device loss) and `scripts/demo-attack.ts` (bank attempts the jar withdrawal while Pending, and attempts early finalization).

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| XO engine cannot express a multi-contract covenant transaction (computed commitments, fixed indexes, CSV) | Spike B1 on day 3 before investing in templates; libauth builder as fallback; contact the XO team early |
| Recovery-key derivation mismatch between owner and bank engines | §3.5 fallback; test on day 3 |
| NFT commitment limit smaller than assumed | Hashed-state variant; decide in A2 |
| CashScript cannot produce a needed pattern or the bytecode is too large | Hand-written CashASM for that function; sizes measured in A3 |
| Chipnet block timing makes the demo slow or flaky | 3-block delay; pre-recorded run as backup; all logic also proven in the VM |
| Engine `next` release changes mid-week | Exact version pins and a lockfile |
| Feedback rejected as AI-written | Written personally from `docs/xo-feedback-notes.md` |
| Scope | Cut order in §5 |

---

## 8. Explicitly out of scope for the hackathon

Mainnet deployment and audit, production challenge duration, mobile background scheduling, WalletConnect, Cauldron/Moria integrations, multi-guardian schemes, watchtowers and claim bonds, on-chain archive profile, mnemonic-only bootstrap, controller upgrades and migration.

## 9. Open questions for the project owner

1. Team size and the actual submission deadline (changes §5).
2. Licence for this repository (MIT suggested, matching the XO packages).
3. Is a CLI-driven demo acceptable if the web UIs are cut, or is a visual demo a must?
4. Should the bank role be demonstrated as a second browser profile or as a separate hosted page?
