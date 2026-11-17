# Grandma's Wallet — Implementation Plan

**Implementation plan v0.4 — BCH Blaze 2026**  
**Date:** 17 November 2026  
**Design:** [Architecture proposal v0.4](Grandmas_Wallet_Architecture_Proposal_v0.4.md), with an illustrated overview in [docs/design_v0.4.html](docs/design_v0.4.html)  
**Target:** BCH Blaze 2026, "Build with XO" bounty, and use beyond it

This plan gives the order of work and what must be true before each stage counts as done. It gives no dates. Section numbers and test IDs refer to the proposal. The proposal says what the wallet must do; this plan says in which stage each part is built and which of the proposal's acceptance tests (its section 21) close the stage. The three documents carry the same version number and are changed together.

## Rules that hold throughout

- **Mainnet-capable code.** Chipnet is where it runs for now; nothing may depend on chipnet. Waiting periods are in time, not blocks.
- **Test coins are not lost.** Every key, and every viewing-key record, is written to disk in a git-ignored folder before its address is funded. A test that erases a device keeps the test's own copy apart from the device's. Every run ends by returning what it holds, except a token that still opens something. A run that has no further use for its wallet closes it, so that the controller's value comes back too (proposal section 5.8). What a run leaves behind is listed in `.xo-demo/leftovers.md`.
- **The wallet knows no application.** Anything the wallet does for an application comes from the application's template. A test fails if wallet or recoverer code names one, or behaves differently for one.
- **Applications work with ordinary wallets too.** The demonstration applications are checked with Cashonize as well as with this wallet.
- **No signature before its dependencies are stored.** The wallet releases no signature that depends on a template, a viewing key or a kit that is not yet where the proposal's section 10.5 requires it.
- **Every transaction is checked before it is signed.** Whoever built it, it passes this project's own script check against the outputs it spends.
- **Every transaction pays the exact fee.** One check, used by every stage before anything is sent, holds a transaction to the fee rules of the proposal's section 8: the fee is the signed size times the rate, and no output is below its smallest value.
- **Chain state is not called verified.** Confirmations are taken from the configured servers, which include the user's own node. Until a device checks block headers itself, results say so (proposal section 17).
- **Each stage ends with `npm run check` passing** and, where the stage says so, a recorded run on chipnet, with compiler and library versions and transaction identifiers. A stage is not done while one of its tests is open; an open one is written down with its reason, not passed over. A test that passes on the simulated chain is run again where a later stage puts it on chipnet or in a browser.
- **Pushes** happen at the milestones marked below, or when asked.
- **The public sites** keep serving the first design, from a separate checkout of the tag `design-1`, until stage 6 switches them.

## What is already here

| Part | Where | Used from stage |
| --- | --- | --- |
| Controller contract, state encoding, transitions, genesis check, history reading | `contracts/controller.cash`, `packages/core` | 1 |
| The owner-approval rule, written and without tests | `contracts/lib/authorization.cash` | 1 |
| Transaction builder and local script check | `packages/core/src/builder.ts` | 1 |
| Simulated chain and a controller-only test wallet | `packages/testing` | 1 |
| Chipnet server access; several servers read as one | `packages/chipnet` | 1 |
| Waiting-period calculation, recovery alarm | `packages/app` | 4 |
| Sealing to the recoverer, signing, backup stores and the store server | `packages/enrollment`, `packages/archive`, `apps/archive-store` | 4 |
| WizardConnect transport and the `xo_v1` messages, with an earlier form of the announcement | `packages/connect` | 7 |
| Page components, browser storage, build settings; service scripts | `packages/ui`, `deploy/` | 6 |
| The engine's signing problem with several inputs, and a local fix | `docs/xo-engine-signing-bug.md`, `spikes/xo-engine/patches/engine-sign-all-utxos.mjs` | 0 |
| The engine's header check on chipnet, and a local fix | `docs/xo-chipnet-header-verification.md`, `spikes/xo-engine/patches/chipnet-faster-blocks.mjs` | 0 |

Parts that are rewritten start from the first design's files, read with `git show design-1:<path>`. Each stage names the files worth reading. A first-design file is a starting point, not a specification.

## Stage 0 — Trials that decide the shape of later stages

Short experiments, kept under `spikes/`, each ending in a written answer in `docs/`. No production code depends on a trial's code.

| Question | Why it matters | Answer needed |
| --- | --- | --- |
| Can an XO template describe a recoverable address whose tag and key differ per address, and will the engine track many such addresses of one template? | Decides whether the wallet's coins live in the engine or in our own code beside it (stage 3). | Yes with how, or no with what the engine refuses. |
| Can the engine use the keys of section 7.2: the controller key apart from the address chain, address keys as plain children of one node with a counter, the blinding seed, the funding key? | A new device must find addresses by counting, and one extended public key must give every address's public key. | The engine's rule for choosing keys, and whether ours can be imposed. |
| Can one invitation carry the controller and several address inputs of the same wallet template, each with its own secret? | This is the sweep (section 11.2). | Yes, or the smallest change that makes it so. |
| How does a transaction of an application's template take inputs and outputs of the wallet's template, when an invitation is for one template? | Every application action is such a transaction (stages 7 to 9). | The route: by the engine, by a combined template with a fixed identifier, or by our own builder. |
| Can a new seed, in a new account, take over an identity that another account created, and then sign for its controller and sweep? | This is recovery on the engine (stage 5). | Yes with how, or what our own code has to do. |
| Do `RecoverableAddress` and `VaultAddress` compile as the proposal gives them, and what does each kind of input cost? | Fees, what a request and a completion need, and the "larger transactions" cost. | The earlier trial repeated inside the repository (96 and 75 bytes of rules, approval check first, cashc 0.14.0), with the bytecode kept; sizes of an input spent by key, a swept input and a vault input, measured on transactions in the virtual machine. |
| Which signing type do the wallet's own inputs use? | The engine's `0x61` signatures are invalid with several inputs. | The local fix, a signer of our own, or `0x41`; one answer, tested. |
| Does the engine's header check work on chipnet with the local fix? | What the wallet may say about confirmations. | Whether the verified height follows the chain with the fix. Not a gate: the rule on chain state above holds either way. |
| How large can the address ranges be? | The full pass looks up every address of every range for every seed (section 7.7). | Time and number of requests for candidate sizes, against the user's own server and a public one, with any limit on subscriptions. Sizes `N0`, `N1`, `N2` and the interval for repeating the full pass, chosen and written into the proposal. |

**Exit:** each question has an answer in writing, and decisions 1, 2 and 12 of the proposal are settled. If the engine cannot hold the wallet's addresses, stage 3 uses our own builder for address inputs and the engine for the controller and for application templates. This plan and the proposal are amended before stage 1 starts where an answer changes them.

## Stage 1 — The two addresses

**Builds:** `RecoverableAddress(tag, keyHash)` with `spend` and `sweep`; `VaultAddress(tag)` with `spend`; their script helpers in `packages/core`; a test wallet that holds coins at such addresses. The controller gains `ownerClose` (section 5.8), starting from the trial the proposal reports, and five tests. The transaction builder gains the fee rules of section 8 that do not depend on choosing coins: the smallest value of each output from its own size, the check before sending, and no limit on the fee in satoshis.

**Reads:** `design-1:contracts/asset.cash`, `design-1:packages/core/test/protected.test.ts`, `design-1:packages/core/test/wallet-flow.test.ts`, `design-1:packages/chipnet/src/lifecycle.ts`.

**Exit**

- **CT01–CT15, AD01–AD13 and FE01–FE03** pass in the virtual machine, with standardness on and under both accepted signing types. CT01–CT10 exist; CT11 (a request that names the current owner), CT12 (the highest epoch, malformed states) and CT13–CT15 (closing) are new.
- The sizes of section 5.8 are measured again on the contract as built, and the proposal's figures are corrected where they differ.
- Each refusal is shown to come from the script that is meant to refuse: the address script for AD04 to AD07, while the controller input alone is satisfied.
- AD08 is kept as a passing test of known behaviour: the earlier seed spends an unswept coin.
- A scripted run on chipnet: create a controller, receive at three addresses and a vault address, pay by key, request, cancel, request, complete, sweep to the new owner's addresses, spend the vault coin, and close: the last coins and the controller's value go back in one transaction. The same refusals are observed from the network. The log is committed.
- **Push.**

## Stage 2 — Keys, viewing key, giving out and finding addresses

**Builds:** a library for: seed to controller key, address node, blinding seed and funding key; the recovery credential with its recovery key and fee key; the viewing-key record with its signature and a text form; secret, tag and address for kind and number; the counters, the windows and the ranges; the quick pass and the full pass over a chain, with progress that survives an interruption; watching.

**Reads:** `design-1:apps/jar/src/plain.ts` (scanning an HD wallet), `packages/core/src/xo-keys.ts`.

**Exit**

- **KV01–KV05, KV07–KV13, PV01 and PV02** pass.
- Test vectors (words, kinds, numbers, expected keys, secrets, tags and addresses) are in a file that the specification of stage 10 can cite.
- The sizes chosen in stage 0 are in the code as constants of the scheme version, and KV13 records what the full pass costs with them.

## Stage 3 — Creating a wallet; the wallet on the XO engine

**Builds:** the wallet's XO template with every action of section 13.2 (create, pay, cancel, change settings, sweep, spend from a vault address; request and complete for the recoverer); the account that drives the engine, or the division settled in stage 0; creating a wallet as in section 7.9; receiving, paying, holding tokens; choosing coins and sending everything as in section 8; a tool that closes a wallet, with its refusals.

**Reads:** `design-1:packages/templates/src/grandmas-wallet.ts`, `design-1:packages/app/src/account.ts`, `design-1:packages/app/src/owner.ts`, `design-1:packages/xo-demo/src/run.ts`, [docs/xo-spike.md](docs/xo-spike.md).

**Creating a wallet** uses the credential from stage 2: fund the funding address; pay itself if the coin is not an output 0; create the controller with the recovery key hash; check the creation; move the rest; set aside the owner's coin for cancelling and, if the user chose to give one, an allowance at the recoverer's fee address; wait for confirmation before giving out an address; continue correctly after a stop at any point.

**Exit**

- **CR01–CR04 and FE04–FE08** pass.
- On chipnet, by the route stage 0 settled: create a wallet, receive at fresh addresses, pay with change to a fresh address, receive and send a token, send everything, and close.
- The template passes the XO validator; a test checks that the scripts in the template are the compiled contracts, byte for byte.
- The invitations of the run load in the XO debugging tool. What the engine did not build is not presented as an invitation.
- Recovery is shown as off: nothing in this stage confirms a kit.

## Stage 4 — The recoverer

**Builds:** the recovery kit and the enrollment message; receipts and prepared receipts; the records of section 10 with their signatures and the rules for records of an earlier seed; the sealed copies on backup stores; request and completion; the owner's alarm and cancel; the fee accounts.

**Reads:** `design-1:packages/enrollment/src/` (`package.ts`, `owner.ts`, `recoverer.ts`), `design-1:packages/app/src/recoverer.ts`, `design-1:packages/archive/src/` (`records.ts`, `writer.ts`, `restore.ts`), `design-1:docs/restoration.md`.

**Exit** (simulated chain unless stated)

- **RC01–RC11, BK01–BK03, BK07, BK08 and OP01** pass.
- "Recovery is on" appears only with a receipt that matches what was sent and the controller's confirmed state (RC04, RC10).
- The enrollment message is measured as the link a phone has to read (RC01).
- The recoverer pays for three cancelled requests, a fourth and its completion from its fee address, with an allowance and with coins it added itself; with an empty fee address its software says beforehand what is missing (RC06).
- The interface offered to stage 7 for "this template is stored" exists and is tested without an application.

## Stage 5 — A new device takes over; a new seed without loss; a new recoverer

**Builds:** the takeover message and the hand-over; after completion, both passes for every earlier seed and the sweep of coins, tokens and NFTs; spending vault coins; collecting what arrives at an earlier address later; the move to a new seed with the old device, in the order of section 9.7; replacing the recoverer; a new archive at each change of seed; the local backup of section 18.1; what the device does when it sees its wallet owned elsewhere.

**Reads:** `design-1:packages/app/src/device.ts`, `design-1:test/device-loss.test.ts`, `design-1:docs/device-loss/`.

**Exit**

- **SW01–SW08, MG01–MG08, KV06, BK09, PV03 and FE09** pass.
- Every step of a recovery, of a move to a new seed and of a replacement is stopped once in a test and continued (MG08). The earlier kit is still usable until the new one is confirmed.
- The complete course on chipnet, recorded with its transactions (SW02): the device is erased, the new device takes over, finishes the full pass and sweeps.
- **Push. This is the point at which the branch replaces `main`.** The public sites are not touched by this.

## Stage 6 — The pages

**Builds:** the wallet page and the recoverer page on the parts above, including: the steps of creating a wallet; "recovery is on" and what it rests on; the vault address; using an address again when a window is full; the fee of each transaction and sending everything; the coin for cancelling; the recoverer's fee address, what it holds and what it needs; moving to a new phone; replacing the recoverer; the local backup; the alarm; the wallet owned elsewhere.

**Reads:** `design-1:apps/wallet/`, `design-1:apps/recoverer/`, `design-1:scripts/browser-demo.mjs`, `design-1:docs/web-apps.md`, `deploy/`.

**Exit**

- **OP02 and OP03** pass.
- A scripted run in real browsers on chipnet: create, enroll, receive, pay, an unwanted request cancelled, loss of the device, takeover and sweep on a new device, a move to a new seed, a new recoverer. Each device's browser storage is kept on disk.
- The same run on the public addresses.
- A person can follow the written walkthrough by hand with two browser profiles. It says what the demonstration does not show, monitoring on a phone in the background among it.

**Switching the public sites** is work of its own, not a change of branch. The services run from the checkout of the tag `design-1`; the stores' data is outside both checkouts. In order: note the running service definitions and where the stores keep their data; copy that data; install the services from the checkout that holds this design, with the script in `deploy/`; check the running version, the stores and the public walkthrough; keep the earlier checkout and its service definitions, and try the way back once (OP03). Until the run passes on the public addresses, they keep serving the first design.

## Stage 7 — Applications

**Builds:** the `xo_v1` announcement in the form of section 14.2, with the four kinds of wallet-bound output; the recovery declaration, bound to its template by content hash; carrying out an application template's action with the wallet's coins, by the route stage 0 settled, including actions that create tokens; finding a position from a token, directly and through a companion coin with its check; the three statements about a template (verified, a violation found, not verified); answering which positions the wallet holds; storing a template before its first signature.

**Reads:** `packages/connect/src/wallet.ts` (kept, to be extended), `design-1:apps/wallet/src/Apps.tsx`, `design-1:apps/wallet/src/ActionView.tsx`, `design-1:test/wallet-knows-no-application.test.ts`, decision D15.

**Exit**

- **AP01–AP09, AP11–AP15, BK04–BK06 and BK10** pass, with templates made for the tests and neither demonstration application involved.
- An application the wallet has never seen presents its template; the user is shown the template's words, the wallet's own figures and "not verified"; the action is carried out at most once.
- The test that no wallet or recoverer code names an application is back and passes (AP07).

## Stage 8 — Savings Jar

**Builds:** `SavingsJar(keyCategory, unlockTime)`; its template with the recovery declaration; the application page, for this wallet and for ordinary wallets.

**Reads:** `design-1:contracts/savingsJar.cash`, `design-1:contracts/keyJar.cash`, `design-1:packages/savings-jar/`, `design-1:apps/jar/`, `design-1:scripts/jar-cashonize-demo.mjs`.

**Exit**

- **SJ01–SJ06 and AP10** pass.
- Chipnet, this wallet: open a jar, lose the device, recover; the new device finds the jar from the swept key token and the template, with the application's site not consulted, and empties it. Someone then pays in again, and that is withdrawn too (SJ06).
- Chipnet, Cashonize: open and empty a jar with the same application and the same contract.
- **Push.**

## Stage 9 — ParyonUSD

Three steps, each worth having without the next.

| Step | Exit |
| --- | --- |
| A loan by script | **PY01, PY04.** On the live chipnet deployment, a loan is opened with the loan key and the borrowed tokens delivered to recoverable addresses, then managed with and without a repayment, and closed. Built with our own code from the published contracts, in the layouts of section 15.2. |
| Template and front end | **PY02.** The same actions from an XO template through the wallet, by the route of stage 7, driven from a page of our own. No code of the wallet names Paryon. |
| Recovery of a live loan | **PY03.** With a loan open, the device is lost; the new device sweeps the loan key, finds the loan through its sidecar, and repays or closes it with Paryon's site not consulted. |

**Before starting:** the deployment (`chipnet-fast-periods-6`) is checked to be alive and the amount of test coins is worked out again from its rules and price; about 0.5 tBCH was the figure on 17 November 2026. Whether to tell the Paryon team, and the missing licence on their contracts repository, are the owner's decisions.

**If a step cannot be done** (the deployment is gone, or a template cannot express their transactions), what was reached and what stood in the way is written up, the tests not reached stay open, and the stage ends there. The decisive demonstration of the proposal is then reported as shown for the jar and not for the loan.

## Stage 10 — For XO and for the bounty

- Two short specifications: the recoverable address (scripts, derivation, ranges and windows, test vectors, viewing-key record, sweep), and the application profile (the three rules, the four kinds of wallet-bound output, the recovery declaration, what "verified" does and does not mean).
- Submission material: the templates, the invitations of complete runs, and how to reproduce them. What our own code built in place of the engine is marked as such.
- The notes for developer feedback are kept up to date through every stage in [docs/xo-feedback-notes.md](docs/xo-feedback-notes.md). The feedback itself is written by the owner.
- The proposal is brought in line with what was built: its status table, measured sizes, the decisions taken, and every test with its result. This plan and the design page follow it, under a new common version number.
- **Push.**

## Which stage closes which test

| Stage | Tests |
| --- | --- |
| 1 | CT01–CT15, AD01–AD13, FE01–FE03 |
| 2 | KV01–KV05, KV07–KV13, PV01, PV02 |
| 3 | CR01–CR04, FE04–FE08 |
| 4 | RC01–RC11, BK01–BK03, BK07, BK08, OP01 |
| 5 | SW01–SW08, MG01–MG08, KV06, BK09, PV03, FE09 |
| 6 | OP02, OP03 |
| 7 | AP01–AP09, AP11–AP15, BK04–BK06, BK10 |
| 8 | SJ01–SJ06, AP10 |
| 9 | PY01–PY04 |

All 122 tests of the proposal's section 21 are in this table once.

## Decisions

The numbers are those of the proposal's section 22. Work follows the default unless the owner says otherwise.

| No. | Decision | Needed by | Default |
| --- | --- | --- | --- |
| 1 | Derivation: the constant `S`, paths, encodings, engine or own code | Stage 0, for stage 2 | As in sections 7.2 and 9.2 |
| 2 | Address chains, windows, range sizes, interval of the full pass | Stage 0, for stage 2 | Windows of 20, 5 and 5; sizes from the trial |
| 3 | Who makes the recoverer's key | Stage 2 | The owner's device |
| 4 | The viewing key's written form | Stage 2 | Two values in one signed record |
| 5 | Readable controller state | Settled | Readable, as the controller is |
| 6 | Waiting period for real use; margin; automatic cancelling | Stage 6 | Time only; length and default open |
| 7 | Fees: the rate; the coin for cancelling; an allowance for the recoverer | Stage 1 for sizes, stage 3 for amounts | One satoshi per byte; one cancellation; an allowance offered and not required, for four requests and one completion |
| 8 | Messages with the recoverer; how the recoverer knows the user | Stage 4 | As in sections 9 and 11 |
| 9 | Backup record formats; refusing without a stored template | Stage 4, for stage 7 | Refusing stays the default |
| 10 | Template extension and recovery declaration | Stage 7; XO's word by stage 10 | The four kinds; a companion document until XO says |
| 11 | `xo_v1` as an extension or a protocol of XO's | Stage 7; others' word by stage 10 | This project's extension |
| 12 | Division between the engine and our own code | Stage 0 | From the trials |
| 13 | Sweep policy | Stage 5 | Most valuable first, unknown tokens counted as valuable |
| 14 | Local backup: offered, and in what form | Stage 5, for stage 6 | Offered, as in section 18.1 |
| 15 | Upgrade policy; how long an old identity is kept | Stage 10 | A new identity; the old one kept while something can arrive |
| 16 | Watching and confidence in the chain | Stage 0, stage 4, stage 6 | The user's own node among the servers; no claim beyond what is shown |
| 17 | ParyonUSD: telling the team; the licence | Stage 9 | Ask before starting the stage |
| 18 | When the public sites switch | Stage 6 | After the scripted run passes on them |
| 19 | Closing a wallet: kept in a released controller, kept out of the interface, or offered | Stage 1 for the contract; stage 10 for a release | In every controller; used by the test runs and a tool; not offered in the interface |
