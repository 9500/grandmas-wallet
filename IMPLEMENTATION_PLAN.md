# Grandma's Wallet — Implementation Plan

**Design:** [Architecture proposal v0.2](Grandmas_Wallet_Architecture_Proposal_v0.2.md), with an illustrated overview in [docs/design.html](docs/design.html) · **Target:** BCH Blaze 2026, "Build with XO" bounty, and use beyond it

This plan gives the order of work and what must be true before each stage counts as done. It gives no dates. Section names in *italics* refer to sections of the overview page. The proposal's acceptance tests (its section 21) are the detailed form of the exit criteria below; where a stage's exit criteria and those tests differ, the tests are the more specific.

## Rules that hold throughout

- **Mainnet-capable code.** Chipnet is where it runs for now; nothing may depend on chipnet. Waiting periods are in time, not blocks.
- **Test coins are not lost.** Every key is written to disk, in a git-ignored folder, before its address is funded. Every run ends by returning what it holds. What a run leaves behind is listed in `.xo-demo/leftovers.md`.
- **The wallet knows no application.** Anything the wallet does for an application comes from the application's template. A test fails if wallet or recoverer code names one.
- **Applications work with ordinary wallets too.** The demonstration applications are checked with Cashonize as well as with this wallet.
- **Each stage ends with `npm run check` passing** and, where the stage says so, a recorded run on chipnet. A stage is not done while one of its exit criteria is open; an open one is written down with its reason, not passed over.
- **Pushes** happen at the milestones marked below, or when asked.

## What is already here

| Part | Where | Used from stage |
| --- | --- | --- |
| Controller contract, state encoding, transitions, genesis check, history reading | `contracts/controller.cash`, `contracts/lib/authorization.cash`, `packages/core` | 1 |
| Transaction builder and local script check | `packages/core/src/builder.ts` | 1 |
| Simulated chain and a controller-only test wallet | `packages/testing` | 1 |
| Chipnet server access; several servers read as one | `packages/chipnet` | 1 |
| Waiting-period calculation, recovery alarm | `packages/app` | 4 |
| Sealing to the recoverer, signing, backup stores and the store server | `packages/enrollment`, `packages/archive`, `apps/archive-store` | 4 |
| WizardConnect transport and the `xo_v1` messages | `packages/connect` | 7 |
| Page components, browser storage, build settings; service scripts | `packages/ui`, `deploy/` | 6 |

Parts that are rewritten start from the first design's files, read with `git show design-1:<path>`. Each stage names the files worth reading.

## Stage 0 — Trials that decide the shape of later stages

Short experiments, kept under `spikes/`, each ending in a written answer in `docs/`. No production code depends on a trial's code.

| Question | Why it matters | Answer needed |
| --- | --- | --- |
| Can an XO template describe a recoverable address whose tag and key differ per address, and will the engine track many such addresses of one template? | Decides whether the wallet's coins live in the engine or in our own code beside it (stage 3). | Yes with how, or no with what the engine refuses. |
| How does the engine choose the child index of a template key, and can the wallet choose it? | Addresses must follow one counter so that a new device can find them by scanning (*Keys and addresses*). | The rule, and whether a counter can be imposed. |
| Can one invitation carry the controller and several address inputs of the same wallet template, each with its own secret? | This is the sweep (*Recovery flow*). | Yes, or the smallest change that makes it so. |
| Do `RecoverableAddress` and `VaultAddress` compile with the shared `ownerApproves` and stay small enough to be worth the bytes? | Sizes go into fees and into the design page's "larger transactions" cost. | Compiled sizes; bytes per spend by key and per swept input. |

**Exit:** each question has an answer in writing. If the engine cannot hold the wallet's addresses, stage 3 uses our own builder for address inputs and the engine for the controller and for application templates, and this plan is amended before stage 3 starts.

## Stage 1 — The two addresses

**Builds:** `RecoverableAddress(tag, keyHash)` with `spend` and `sweep`; `VaultAddress(tag)` with `spend`; their script helpers in `packages/core`; a test wallet that holds coins at such addresses.

**Reads:** `design-1:contracts/asset.cash`, `design-1:packages/core/test/protected.test.ts`, `design-1:packages/core/test/wallet-flow.test.ts`, `design-1:packages/chipnet/src/lifecycle.ts`.

**Exit**

- In the virtual machine, with standardness on and under both accepted signing types:
  - a coin is spent by its own key with no controller in the transaction;
  - a coin is swept with the controller at input 0 and the owner's approval; several coins and a vault coin in one transaction;
  - BCH, fungible tokens and NFTs can each be held and moved both ways.
- Each of these is refused, and the test shows the refusal comes from the address script: another key; a sweep with the wrong identity or wrong address secret; a sweep beside a recovery request or a completion; a sweep where the controller is not input 0, is another wallet's, or continues with a changed owner, recoverer or delay; a sweep approved by the earlier owner after a recovery.
- A scripted run on chipnet: create a controller, receive at three addresses and a vault address, pay by key, request, cancel, request, complete, sweep to the new owner's addresses, spend the vault coin. The same refusals are observed from the network. The log is committed.
- **Push.**

## Stage 2 — Keys, viewing key, finding addresses

**Builds:** a library for: seed to controller key and address chain; the viewing key (extended public key and blinding seed) with a text form; address secret, tag and address for index *i*; vault addresses; scanning a chain for a wallet's coins and tokens from identity and viewing key, with a gap limit.

**Reads:** `design-1:apps/jar/src/plain.ts` (scanning an HD wallet), `packages/core/src/xo-keys.ts`.

**Exit**

- From identity and viewing key alone, a scan of the simulated chain finds every coin, token and NFT of a wallet that used some addresses, skipped some within the gap limit, and holds a vault coin.
- With another wallet's viewing key, or the right key and another identity, the scan finds nothing.
- The viewing key cannot produce a signature or a sweep: a test tries and fails.
- Test vectors (seed, indices, expected tags and addresses) are in a file that the specification of stage 10 can cite.

## Stage 3 — The wallet on the XO engine

**Builds:** the wallet's XO template (controller actions; receive; pay by key; sweep); the account that drives the engine; creating a wallet, receiving, paying, holding tokens.

**Reads:** `design-1:packages/templates/src/grandmas-wallet.ts`, `design-1:packages/app/src/account.ts`, `design-1:packages/app/src/owner.ts`, `design-1:packages/xo-demo/src/run.ts`, [docs/xo-spike.md](docs/xo-spike.md).

**Exit**

- On chipnet, through the engine: create a wallet, receive at fresh addresses, pay with change to a fresh address, receive and send a token.
- The template passes the XO validator; a test checks that the scripts in the template are the compiled contracts, byte for byte.
- The invitations of the run load in the XO debugging tool.
- Every transaction the engine builds passes our own script check before it is sent.

## Stage 4 — The recoverer

**Builds:** what the recoverer is given (identity, creating transaction, recovery credential, viewing key, backup stores) and its sealed delivery; the sealed copy of the viewing key on backup stores; request, completion; the owner's alarm and cancel; a recovery key that differs per wallet.

**Reads:** `design-1:packages/enrollment/src/` (`package.ts`, `owner.ts`, `recoverer.ts`), `design-1:packages/app/src/recoverer.ts`, `design-1:packages/archive/src/` (`records.ts`, `writer.ts`, `restore.ts`), `design-1:docs/restoration.md`.

**Exit** (simulated chain unless stated)

- The recoverer checks what it was given against the chain and refuses a package for another network, a changed one, or one not signed by the wallet's owner.
- With everything the recoverer holds, no coin can be spent or swept: a test tries each path.
- A request by the recoverer is noticed by the owner's device from any one of several servers, and cancelled; a request to the device's own key is not treated as an attack.
- The new device hands its own viewing key to the recoverer before the request is made, and receives the earlier one only after completion.
- Two wallets with the same recoverer show no common value on chain.
- The recoverer can pay for its transactions without being sent coins by hand.

## Stage 5 — A new device takes over

**Builds:** joining a recovery from a new seed; after completion, scanning with the earlier viewing key and sweeping coins, tokens and NFTs to the new seed's addresses; spending vault coins; sweeping what arrives at an earlier address later.

**Reads:** `design-1:packages/app/src/device.ts`, `design-1:test/device-loss.test.ts`, `design-1:docs/device-loss/`.

**Exit**

- Simulated chain: the owner's device is erased; a new device ends up holding everything the wallet held, at its own addresses; the earlier seed can then move nothing. A coin sent to an earlier address afterwards is found and swept.
- A sweep too large for one transaction is split and completes after an interruption between parts.
- A wallet that holds only tokens can still be swept (the fee has a source).
- The same course on chipnet through the engine, recorded with its transactions.
- **Push. This is the point at which the branch replaces `main`.**

## Stage 6 — The pages

**Builds:** the wallet page and the recoverer page on the parts above; the public demonstration.

**Reads:** `design-1:apps/wallet/`, `design-1:apps/recoverer/`, `design-1:scripts/browser-demo.mjs`, `design-1:docs/web-apps.md`.

**Exit**

- A scripted run in real browsers on chipnet: create, enroll, receive, pay, an unwanted request cancelled, loss of the device, takeover and sweep on a new device. Each device's browser storage is kept on disk.
- The same run on the public addresses. Until then the public addresses keep serving the first design.
- A person can follow the written walkthrough by hand with two browser profiles.

## Stage 7 — Applications

**Builds:** the `xo_v1` advertisement with `receive` and `change` bindings and recovery profiles; carrying out an application template's action with the wallet's coins, including actions that create tokens; answering which positions the wallet holds from the tokens it holds.

**Reads:** `design-1:packages/connect/src/wallet.ts` (kept, to be extended), `design-1:apps/wallet/src/Apps.tsx`, `design-1:apps/wallet/src/ActionView.tsx`, `design-1:test/wallet-knows-no-application.test.ts`, decision D15.

**Exit**

- An application the wallet has never seen presents its template; the user is shown the template's words and the wallet's own figures; the action is carried out at most once.
- An action that creates a token category works, with the coin it needs at output 0 prepared by the wallet.
- A template that breaks one of the three rules (*Rules for applications*) is recognised and the user is told which.
- The test that no wallet or recoverer code names an application is back and passes.

## Stage 8 — Savings Jar

**Builds:** `SavingsJar(keyCategory, unlockTime)`; its template with the recovery declaration; the application page, for this wallet and for ordinary wallets.

**Reads:** `design-1:contracts/savingsJar.cash`, `design-1:contracts/keyJar.cash`, `design-1:packages/savings-jar/`, `design-1:apps/jar/`, `design-1:scripts/jar-cashonize-demo.mjs`.

**Exit**

- Virtual machine: the jar opens only with its key token and only after the unlock time; each alone is refused.
- Chipnet, this wallet: open a jar, lose the device, recover; the new device finds the jar from the swept key token and the template, with the application's site not consulted, and empties it.
- Chipnet, Cashonize: open and empty a jar with the same application and the same contract.
- **Push.**

## Stage 9 — ParyonUSD

Three steps, each worth having without the next.

| Step | Exit |
| --- | --- |
| A loan by script | On the live chipnet deployment, a loan is opened with the loan key and the borrowed tokens delivered to recoverable addresses, then managed and closed. Built with our own code from the published contracts. |
| Template and front end | The same actions from an XO template through the wallet, driven from a page of our own. |
| Recovery of a live loan | With a loan open, the device is lost; the new device sweeps the loan key, finds the loan from it, and repays or closes it. |

**Before starting:** about 0.5 tBCH is needed; the deployment (`chipnet-fast-periods-6`) is checked to be alive; whether to tell the Paryon team, and the missing licence on their contracts repository, are the owner's decisions.

**If a step cannot be done** (the deployment is gone, or a template cannot express their transactions), what was reached and what stood in the way is written up, and the stage ends there.

## Stage 10 — For XO and for the bounty

- Two short specifications: the recoverable address (scripts, derivation, test vectors, sweep), and the three application rules as a template profile with the recovery declaration.
- Submission material: the templates, the invitations of complete runs, and how to reproduce them.
- The notes for developer feedback are kept up to date through every stage in [docs/xo-feedback-notes.md](docs/xo-feedback-notes.md). The feedback itself is written by the owner.
- The design page is brought in line with what was built, including measured sizes.
- **Push.**

## Decisions that are the owner's

| Decision | Needed by | Default if nothing is said |
| --- | --- | --- |
| Controller state readable, with a recovery key per wallet, or hashed | Stage 1 | Readable, as in the design page |
| Viewing key as two values (extended public key, blinding seed) or one | Stage 2 | Two |
| When the public addresses switch to the new design | Stage 6 | After the scripted run passes on them |
| Telling the Paryon team; use of their unlicensed contract sources | Stage 9 | Ask before starting the stage |
| Test coins for stage 9 | Stage 9 | Ask before starting the stage |
