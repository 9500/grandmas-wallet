# Grandma's Wallet — Implementation Plan

**Implementation plan v0.6 — BCH Blaze 2026**  
**Date:** 20 November 2026  
**Design:** [Architecture proposal v0.6](Grandmas_Wallet_Architecture_Proposal_v0.6.md)  
**Target:** BCH Blaze 2026, "Build with XO" bounty, and use beyond it

This plan gives the order of work for the third design (design 3) and what must be true before each stage counts as done. It gives no dates. Section numbers and test IDs refer to the proposal. The proposal says what the wallet must do; this plan says in which stage each new part is built and which of the proposal's acceptance tests (its section 21) close the stage.

The second design was built in stages 0 to 10 of [version 0.4 of this plan](IMPLEMENTATION_PLAN_v0.4.md), which stays in the repository as its record. The stages here continue that numbering.

## Rules that hold throughout

The rules of version 0.4 hold unchanged: mainnet-capable code, test coins are not lost, the wallet knows no application, applications work with ordinary wallets too, every transaction is checked before it is signed and pays the exact fee, chain state is not called verified, and each stage ends with `npm run check` passing and with its run script passing on the local node. Three are restated because this version leans on them, and one is new:

- **No signature before its dependencies are stored.** To the template, the viewing key and the kit this version adds the record of every position an action leaves (proposal section 10.5).
- **The wallet knows no application, and reads nothing written for it.** Everything the wallet does for an application comes from the application's XO template, the request and the wallet's own record. A test fails if wallet code names an application or reads a declaration.
- **Pushes** happen at the milestones marked below, or when asked.
- **The public sites show the third design since 20 November 2026,** by the owner's decision (first from commit `cd18348` of `design-3`, then `b67f221`). They are served from a release copy and are released again only when the owner says so. The second design's release, its unit files and a copy of the stores' data are kept in `~/.local/share/grandmas-wallet/switches/2026-11-20-to-design-3/`; how to put it back is in `docs/runs/stage-17-switch.md` on the branch, and has not been tried.

## Where tests run

As in version 0.4: the simulated chain for every change, the local node for every run script, and chipnet last and once. This version has two chipnet runs.

| Run | Started at the end of stage | What it shows |
| --- | --- | --- |
| G | 17 | The Savings Jar from its template alone, in browsers: opened, the phone lost, the wallet recovered, the jar emptied from the record with its page not opened (PR19) |
| H | 17 | A ParyonUSD loan from its template alone, with the loan page carrying what the declaration did: opened, given collateral, the phone lost, the wallet recovered, the loan closed from the page (PR20) |

## What is already here

Everything of the second design, at the tag `design-2`. The parts this version builds on:

| Part | Where |
| --- | --- |
| Sealed, signed records on several stores; the rules for records of an earlier seed; the copy into a new archive; writes that wait for a store and writes that are retried | `packages/archive`, `packages/app/src/applications.ts` |
| Token notes, and the check of a note against the chain | `packages/archive/src/records.ts`, `packages/app/src/applications.ts` |
| Reading a declaration; checking a template against it; finding a position from a token and the chain. These were removed in stage 14; the reading of coins from the chain in the last is kept for the check of stage 13 | `packages/app/src/declaration.ts`, `template-check.ts`, `positions.ts` |
| Making a script known to the engine from its template, locking script, role and values | `followScript` in `packages/app/src/account.ts` |
| Working an action out before the user is asked, with the wallet's own figures | `plan` in `packages/app/src/applications.ts` |
| The request, with the wallet's own outputs, the token an action spends and the application's coins; the positions request and its answer | `packages/connect/src/protocol.ts` |
| The loan page, and what a page needs to know of Paryon's contracts | `apps/loan`, `packages/paryon` |
| The Savings Jar: contract, template, page | `contracts/savingsJar.cash`, `packages/savings-jar`, `apps/jar` |

Parts that are rewritten start from the files at the tag `design-2`, read with `git show design-2:<path>`.

## Stage 11 — Trial: from the template alone, and back from a record

This decides the shape of the later stages, and is the proposal's first checkpoint. It is done by hand and by script, with no change to the wallet's rules yet.

- The Savings Jar's template with the key as an input of its own, at a fixed index, and that index as a constant in the jar's unlocking (proposal section 15.3). No declaration.
- On the local node: one seed opens a jar through the engine, with the values filled as proposal section 13.3 says: the request's, then the wallet's own. What the record would hold is written to a file.
- A second seed, in an account with no history, is given the key by an ordinary transfer and the file. It hands the script to the engine and empties the jar after the date, every value coming from the file or from the wallet.
- The check of proposal section 10.4 is worked through by hand for this jar, from the script's side, and for a ParyonUSD loan from the records in `docs/runs/`, from the token's side.

**Done on 20 November 2026.** The result is in `docs/stage-11-trial.md` on the branch `design-3`: the engine takes such an input and signs with the wallet's coin there; the engine's stored values are enough; the record needs the script's values, one other value of the action, and the token; filling works once an address and a paid-in amount never come from a record; and the check holds for the jar on the local node and for the jars and loans of earlier chipnet runs. The proposal's sections 10.2, 10.4, 13.3 and 14.2 were corrected accordingly (its decision 33).

The exit criterion was: the result is written to `docs/` with the transactions, and it says: whether the engine takes an input that names a token and has no unlocking script; whether the engine's stored values are enough to follow and to spend; which fields the record needs; whether filling from the role's requirements works; and whether the check holds for both applications. Where the answer is no, the proposal is changed before stage 12 starts.

## Stage 12 — Position records in the backup

- The record type, with the engine's field names, the token, the action's other values kept apart from the script's, no address of the wallet's, and the address of the application's page (proposal section 10.2). A record without a script, for a token of an application whose scripts the wallet does not follow. Token notes are still read and no longer written.
- Writing: the wallet builds the record from the transaction it has worked out, and a store confirms it before anything is signed (section 10.5).
- Reading after a recovery: records of the earlier archive are copied as suggestions, and written as the new owner's own only after the chain has confirmed them (section 10.6).
- A record of an action that was never sent is not copied.

**Tests:** PR01, PR02, PR10, PR11. **Done on 20 November 2026:** they pass on the simulated chain with stores in memory, recorded in `docs/results/stage-12.md` on the branch `design-3`. Token notes are still written until stage 14 rewrites the tests that rest on them. The proposal's section 10.2 was corrected for three things the work showed: an address that is one of a script's own values stays in the record; a record is due only where a token of the wallet's takes part; the wallet may pay itself before the record exists.

## Stage 13 — The check, and positions that are not confirmed

- The check of section 10.4, from the chain alone: a transaction carried the token and paid the record's script; the token is the one the wallet holds, compared whole and followed back where it could have been copied; the template's token input agrees with the record.
- Positions are listed from records that count. Several records for one token; the one whose script holds coins. A token without a record is listed as a token.
- The status "not confirmed", and the rule that only an action in which the wallet gives nothing but the fee is carried out there.

**Tests:** PR03, PR04, PR05, PR06, PR07, PR12, PR23, PR24. **Done on 20 November 2026:** they pass on the simulated chain (`docs/results/stage-13.md`), and PR03 ran on the local node through the engine with the real recovery flow (`docs/runs/stage-13-local-node.md`). In that run the record, the check, the listing and the hand-over to the engine used no declaration; the withdrawal still took its values from one, until stage 14.

## Stage 14 — An application from its template alone

In two parts, so that the tree passes its check throughout. The first adds the way without a declaration beside the existing one. The second, after stage 17 has moved the two applications over, removes the declaration from the wallet.

- Filling a value: the wallet's own, the request, the record, the user, with an address and a paid-in amount never from a record (section 13.3). The kinds of the wallet's own outputs, named by the request where they are not a plain receipt.
- An action about a token with no declaration: the request names the position and says whether the token is spent, or the template's own token input says so; the wallet makes sure the coin it puts there is the token.
- The application's coins as the request names them, read from the chain, each matched to a script of the template by its bytecode, with the application's contracts run before the user is asked.
- A token of the wallet's that would leave it or come back changed, and a token made from the wallet's coin that would go elsewhere: shown, and carried out only with the user's tick.
- From the wallet's own list: the actions a script offers; carried out alone where nothing is missing, and otherwise "Open the application to do this" with the page's address.
- `xo_v1` in its version 2 (section 14.2): no profile, no declaration, the new answers to a positions request.
- Second part, after stage 17: removed are reading a declaration, finding a position from the chain, the template check that depends on a declaration, and token names from a declaration. Token notes are no longer written. The tests of the second design that this version retires (proposal section 21) are removed with the code they test; the others still pass.

**Tests:** PR13, PR14, PR15, PR16, PR17, PR18, PR22 in the first part; PR21 in the second. **Done when** they pass on the simulated chain. **The first part was done on 20 November 2026** (`docs/results/stage-14.md` on the branch `design-3`), on the simulated chain only. The proposal's section 13.3 was corrected for what it showed: when an action creates a token category, and which input spends a position. **The second part was done on 20 November 2026** (`docs/results/stage-14b.md`): PR21 passes, and the wallet, the recoverer, the messages and the applications' packages hold nothing that reads a declaration. With it went version 1 of `xo_v1`, the Savings Jar's third template version, and the run scripts of the second design that drove declarations. The script of stage 13's local run now uses the fourth template version; its record stays as it was made. Five defects that stage 17 found on the wallet's side were corrected in the same part, among them the coins of an action just sent, for which the wallet now waits on the engine's server (proposal section 13.4).

## Stage 15 — Findings for each action

- The wallet works out which outputs of a transaction sit at a script of the template that it would follow, and reaches one of the three findings of section 12.3.
- This wallet's answers of section 12.5: it refuses where something does not come back or cannot be told.
- A template for the tests alone, with a script that takes a key of the device.

**Tests:** PR08, PR09. **Done on 20 November 2026:** they pass on the simulated chain (`docs/results/stage-15.md` on the branch `design-3`).

## Stage 16 — The wallet's screens

- The refusal when no store confirms; the refusal of an action that would tie money to the phone; "Open the application to do this"; "Not confirmed" in the list of positions; a token with no record; a token that would leave the wallet, with its tick (section 17).
- Tokens shown by category and in raw units, and an NFT by its template and output (section 13.3), on Send, Receive and the review.
- Each is pictured on a phone and on a desktop from the fixtures page before it is wired to the wallet, and shown to the owner.

**Done when** the pictures are in `docs/screens/` and the owner has seen them. The pictures were made on 20 November 2026 (`docs/screens/apps-*.png` on the branch `design-3`).

## Stage 17 — The two applications without declarations

- Before anything else: positions that the second design opened on chipnet with its declarations are closed with the build at the tag `design-2`, and `.xo-demo/leftovers.md` is brought up to date.
- Savings Jar: the changed template in `packages/savings-jar`, frozen like the first; the jar's page sends requests of version 2.
- ParyonUSD: the loan page (`apps/loan`) finds the loan and its sidecar from the key, names Paryon's coins by outpoint, reads their values and sends them, and names the kind `return` (section 15.3). The template loses the variables that only the declaration filled where a constant can take their place.
- Both courses in browsers on the local node, with the new phone's requests recorded.
- **Chipnet runs G and H.** They need the wallet and the two pages of this version to be reachable; where they are served from is the owner's decision.

**Tests:** PR19, PR20. **Done when** the runs' records are committed. **Push.**

A release is checked with `node deploy/check-public.mjs <configuration> --expect <commit>` and then `npx tsx scripts/page-smoke.ts <configuration>`, which goes through the start screens of the public pages and needs no coins. `docs/walkthrough.md` is the hand course of this version; the second design's is at the tag `design-2`. The invitations kept in `docs/xo-invitations.md` are of this version's chipnet runs of 21 November 2026; the second design's stay beside them.

The owner decided on 20 November 2026 that the pages of this version are served at the public addresses, in place of the second design's, whose release is kept so that it can be put back. On 21 November 2026 the owner decided that this version is the one to be judged: `main` holds it since then, and the branch `design-3` ends there.

**State on 20 November 2026:** the template, the two pages and their packages are changed, and both courses ran on the local node through the engine without a browser (`docs/runs/stage-17-jar-local-node.md`, `docs/runs/stage-17-loan-local-node.md` on the branch `design-3`), and again after the declaration was removed from the wallet. Both courses then ran in browsers on the local node, with the new phone's requests recorded (`docs/runs/stage-17-jar-browser-local-node.md`, `docs/runs/stage-17-loan-browser-local-node.md`; pictures in `docs/screens/live-*.png`): PR19 and PR20 pass there. Six defects the courses showed were corrected, among them what the wallet's review said about an application's own NFTs. **Done on chipnet, 20 and 21 November 2026:** the second design's wallets and what the first design left that was worth its fee were drained to the funding address, and `.xo-demo/leftovers.md` says what stays; the pages of this version were released to the public addresses; run G (`docs/runs/stage-17-jar-browser-chipnet.md`), run H (`docs/runs/stage-17-loan-browser-chipnet.md`) and the Savings Jar page with the unmodified Cashonize wallet (`docs/runs/stage-17-jar-cashonize-chipnet.md`) ran against them. PR19 and PR20 are closed. Run H did not run straight through: its recovery request waited about 25 minutes for a block, the first closing was refused because someone else had spent a coin of Paryon's that it named, and the loan was closed by driving the same pages directly. What follows from it is in the next stage's list.

## Stage 18 — For XO, and the documents

- From run H: a page tries again at once when the network refuses a transaction because someone else spent a coin it named; the wallet tells the page so in a form it can act on. The run scripts stop within seconds where a page does not show what it should, and keep a picture and the page's text; only waits on the chain are long. Each chipnet run gets its own funded key, so that runs go side by side.

- The notes for developer feedback are kept up to date in [docs/xo-feedback-notes.md](docs/xo-feedback-notes.md). The feedback itself is written by the owner.
- What XO's authors answer about a call to follow a script, about synchronisation and about how invitations travel (proposal section 13.6) is noted in the proposal's section 22.
- The proposal is brought in line with what was built: its status table and every new test with its result. The overview page follows under the same version number.
- **Push.**

## Stage 19 — Token names and units from a registry

Decided by the owner on 21 November 2026: built now, with stage 20, before anything else. **Built the same day:** TR01 to TR15 pass on the simulated chain; the resolver read the registry of PUSD on Paryon's chipnet deployment from the chain in 1.4 seconds (35 transactions read, one file fetched) and the built wallet page fetched and checked the file in a browser; the loan course on the local node, whose deployment now publishes a registry, shows "100.00 PUSDLOCAL" before and after a recovery (`docs/runs/stage-19-registry-loan-local-node.md`). Before a review opens, the wallet looks up the registries of the categories it does not know yet for at most 4 seconds, so the first borrowing shows PUSD in its units too (TR15).

**On chipnet, in the public wallet (21 November 2026).** The Savings Jar course and the loan course both passed against the public pages that offer both networks (`docs/runs/stage-17-jar-browser-chipnet.md`, `docs/runs/stage-17-loan-browser-chipnet.md`). Closing the loan on the new phone, the wallet's review read "100.00 PUSDTEST". The review of the borrowing still read "10,000 units" in that run, which is what the lookup before a review corrects; the pages were released with it afterwards. A further run of the loan course against that release, once the owner had added test coins to the funding address, showed it: the review of the borrowing read "100.00 PUSDTEST", and every step was carried out in about ten minutes.

Asked for by the owner on 20 November 2026, for after the chipnet runs. Until then the wallet shows a fungible token by its category and in raw units (proposal section 13.3, decision 25).

- First an evaluation, before anything is built: whether the wallet can read Bitcoin Cash Metadata Registries (BCMR) to show a token's name, symbol and decimals. **Written on 20 November 2026: [docs/token-registries.md](docs/token-registries.md),** from the specification, the sources of Cashonize and Selene, and a trial that followed PUSD's registry on chipnet from its category to a file with the published hash. It proposes names taken only from a file the token's own chain of transactions publishes, and lists eight decisions for the owner.
- What has to be settled there: which registries the wallet trusts and how a category's own registry is found and checked against the chain; what a lookup tells a server about the wallet's tokens; what is kept on the device and in the backup, so that a new phone shows the same names; what the wallet shows when a registry and a template disagree; that amounts the wallet's own figures show stay the wallet's, with a registry supplying only the name and where the decimal point goes.
- Then the wallet's screens: balances, sending, the review of an action, and typed amounts in the token's own units.

**Done when** the owner has decided the points of that document's section 8, and, if it is built, its tests TR01 to TR15 pass and its exit criteria are met.

## Stage 20 — Mainnet by configuration

Asked for by the owner on 20 November 2026, to meet the requirements of BCH Blaze. The code has been kept able to run on mainnet throughout (the rules above); this stage makes it something a configuration can turn on.

- One configuration parameter for the wallet, the recoverer's page and the two applications' pages, off by default, in the configuration file the pages are served with. Nothing in a page's own interface turns it on.
- With it on, every page shows a warning that stays in view and that the user confirms once before a wallet is created or opened: mainnet is enabled only to meet the requirements of BCH Blaze; nothing here has been audited; coins can be lost; this project does not recommend enabling it.
- What mainnet changes and has to be checked before it is turned on anywhere: the chain servers and their checkpoints; the recoverer's waiting periods, whose mainnet default is about a day; XO's key path for mainnet; the stores' addresses; fees and the smallest outputs; and for the loan page, whether a deployment of ParyonUSD is named at all or the page stays off on mainnet.
- A run on mainnet with small amounts is the owner's decision and is not part of this stage.

**Done when** a page built with the parameter on shows the warning and works against mainnet servers in a test that sends nothing, and a page built without it cannot be brought to mainnet.

**Built on 21 November 2026.** A page runs on mainnet only when its served configuration has `"network": "mainnet"` and `"mainnetEnabled": true`; without the second it refuses to start and says why, and the serving and installing scripts refuse such a configuration too. `deploy/config/mainnet.example.json` is an example, not a deployment. On a mainnet page a band stays in view ("Mainnet: not audited, coins can be lost") and a full statement is confirmed once per browser before the page connects to anything or makes a key: enabled only to meet the requirements of BCH Blaze, nothing audited, coins can be lost, not recommended. One defect was found and corrected: the pages created the XO engine for chipnet whatever the network, so on mainnet its keys would have been made under the test networks' path while the wallet's own were made under mainnet's. The recoverer's waiting period on mainnet is 169 units of 512 seconds, about a day, and the short one for trying out was not offered there at first; since 22 November 2026 it is, with a word that a move with it usually takes about half an hour on mainnet, and a new wallet there still starts with about a day. The loan page was off on mainnet at first; later the same day Paryon's deployment `mainnet-v1` was found, checked against three of Paryon's public sources and against the chain, and given a template of its own, and the page works with it, with a larger collateral margin (150% proposed, 130% the least) and a word on redemptions. No loan has been opened there. In a read-only look at mainnet servers the recoverer's page passed its header check in about eight seconds and showed a zero balance at a `bitcoincash:` address, and the wallet's page reached it over the relays; nothing was sent.

**The network chosen in the page (asked for by the owner and built on 21 November 2026).** A deployment may describe chipnet and mainnet together: what differs by network sits under `networks` in the configuration, `"network"` names where a new visitor starts, and `"mainnetEnabled": true` still decides whether mainnet is offered at all (`deploy/config/both.example.json`). Where it is, the network label in the header of the wallet and of the recoverer's page opens a choice, "Chipnet · test coins" or "Mainnet · real coins"; the full statement is shown on every choice of mainnet, and the page starts again on the chosen network. What a page keeps in the browser is kept apart by network, with chipnet keeping its names so that today's wallets still open; a test fails when a new place to keep data is added without the network in its name. The Savings Jar and loan pages follow the network of the wallet that connects, or say plainly that they do not work on it. One backup store can serve both networks: every signed record names its network, and restoring refuses another's. Seen in a browser read-only, with both networks served locally; an application following a wallet to the other network is tested in unit tests only.

**Public since 21 November 2026 (01:26 UTC), by the owner's decision:** the public pages offer mainnet beside chipnet, starting on chipnet, from commit `65d34d4`. In a browser the public wallet showed the choice, the statement and the band, and its first screen on mainnet.

**First use on mainnet (21 November 2026), with about 0.5 EUR of the owner's coins.** A helper set a wallet up, the wallet received 20,000 sat and paid 5,000 out, and a Savings Jar of 2,000 sat was opened, with its record in both stores before the opening was sent: eight transactions in 89 seconds, 2,581 sat in fees ([record](docs/runs/mainnet-first-run.md)). The wallet's own header check passed on mainnet. One defect was found and corrected: the review of the opening showed the jar's key, which the action itself makes, as a row of zeros; it now reads "new, made by this action". The same night the phone was treated as lost: a new phone asked the helper, and her recovery request went into block 978237 ([record](docs/runs/mainnet-recovery-started.md)). The waiting period of this wallet is the mainnet default, 169 units of 512 seconds, and ends when the chain's median time passes 01:21:28 UTC on 22 November. The run stopped there on purpose. **Completed on 22 November 2026:** after the waiting period the recoverer completed the move in block 978407, the new phone swept the wallet's coins and the jar's key, trusted the template the old phone had stored, listed the jar from its record and emptied it with the jar's page never opened, and sent everything back to the address the coins came from ([record](docs/runs/mainnet-recovery-completed.md)).

Still open:

- The wallet page has no screen for changing the waiting period of a wallet that exists; the layer under the page can do it. A wallet set up with a day's period keeps it.
- The owner's to decide: a first loan on mainnet (the least needs about 0.77 BCH at the proposed margin; not wanted for now), letting the borrower choose the interest rate there, and checking the page's words on redemptions against Paryon's documentation.

## Stage 21 — More actions recognised as coming back

Agreed by the owner on 21 November 2026, for after stages 19 and 20. The wallet refuses an action when it finds that what the action leaves would not come back after a recovery, or when it cannot tell (proposal sections 12.3 and 12.5). Two cases are refused today although nothing of the wallet's would be tied to the phone:

- **A script that takes no key, with a rule for following it that is given as an expression.** Whether the wallet follows it or not, nothing depends on a key of the device: the finding is "comes back".
- **A script that takes a key of another party only.** Where the template says which role keeps which key of a script, a key that only another role keeps is not counted as the device's. A template that does not say whose key it is stays refused.
- A rule given as an expression is evaluated by the wallet only once XO says how such a rule is evaluated; the question is in the notes for XO.

**Done when** tests on the simulated chain show both cases carried out and the neighbouring cases still refused: the same script with a key of the wallet's role, and a template that names no role for its key. **Done on 21 November 2026** (PR26, PR27): the two applications' templates get the same finding for every action as before.

## Built beside the stages

Built on 21 and 22 November 2026, outside the stages above. Each is described in the proposal where a reader would look for it.

- **The mockup network** (21 November). The pages offer a third network beside chipnet and mainnet: a public regtest chain of the deployment's own, with Paryon's contracts deployed on it, play coins at a press and a button that lets a waiting period or a jar's date pass ([docs/mockup.md](docs/mockup.md); proposal section 2).
- **An application's service** (22 November). A template can name a server that joins an action as a second participant; the wallet carries out the template's actions with it from its own Apps screen, with the page closed ([docs/xo-service.md](docs/xo-service.md); proposal section 14.5). The loan page sends version 3 of the ParyonUSD template, which names the loan service beside the page; the loan course with it ran in browsers on the local node (`docs/runs/stage-17-loan-service-browser-local-node.md`).
- **The Apps screen** (22 November). Every action of a trusted template is visible; follow-ups appear right after an action; values are in the template's units in the review; each screen has its way back at the top; a template can be deleted, and added from a file (proposal section 17, decision D16 in `docs/decisions.md`).
- **Templates written by others** (22 November). Four generic changes, so that templates published at XO Grid work where nothing is tied to one device: starting actions under several roles, a token category a request gives used as an existing one, a template's coins giving their satoshis to the fee as `omitChangeAmounts` says, and an application's coin recognised by the state values a request gives (proposal sections 12.4 and 13.3). Five of those templates were then run through the wallet on the unmodified XO engine, on the local node and on chipnet (`scripts/xo-grid-run.ts`, `docs/runs/xo-grid-templates-chipnet.md`); the engine showed three things the simulated chain had not, each met in the wallet's own code: an output to a script that does not name the paying role, a coin at a script the acting role never pays to, and a contract address shared by tens of thousands of transactions, which the engine must not be made to follow.

## Which stage closes which test

| Stage | Tests |
| --- | --- |
| 12 | PR01, PR02, PR10, PR11 |
| 13 | PR03–PR07, PR12, PR23, PR24, PR25 |
| 14 | PR13–PR18, PR21, PR22 |
| 15 | PR08, PR09 |
| 17 | PR19, PR20 |
| 19 | TR01–TR15 |
| 21 | PR26, PR27 |

All 42 tests that this version adds to the proposal's section 21 are in this table once. The tests of the second design are in the table of version 0.4; the proposal's section 21 says which of them this version retires or replaces.

`scripts/test-record.mjs` reads the statements of the tests from the proposal of version 0.6.

## Decisions

The numbers are those of the proposal's section 22. Work follows the default unless the owner says otherwise. Decisions 1 to 20 are in version 0.4 of this plan.

| No. | Decision | Needed by | Default |
| --- | --- | --- | --- |
| 9 | Where position records are kept; when a store has to confirm | Decided, 20 November 2026 | On the backup stores; before every action that leaves a position |
| 10 | Template extension and recovery declaration | Decided, 20 November 2026 | Withdrawn; the declaration is retired |
| 11 | `xo_v1` | Stage 14 | This project's extension, version 2 |
| 21 | What a wallet does when something does not come back | Decided, 20 November 2026 | Left to whoever builds the wallet; this wallet refuses |
| 22 | The finding "cannot tell" in this wallet | Stage 15 | Treated like "does not come back" |
| 23 | The position record's fields; token notes | Stage 11, for stage 12 | The engine's field names, the token, the action's other values, the page's address; token notes read and no longer written |
| 24 | When a record counts; several NFTs of one category | Decided in principle, 20 November 2026; the detail in stage 13 | The chain ties it to a token the wallet holds; a record that cannot be told apart does not count |
| 25 | What the wallet calls a token | Decided, 20 November 2026 | An NFT by its template and output; fungible tokens by category and in raw units, and from a token registry (BCMR) later |
| 26 | XO's synchronisation in place of the stores | XO's word | When it exists and offers the three things of section 13.6 |
| 27 | A position that the application names for a token without a record | Not in this version | — |
| 28 | Other ways of getting a recoverer | Decided, 20 November 2026 | Not in this version |
| 29 | The declaration as an optional extra | Decided, 20 November 2026 | No |
| 30 | A token of the wallet's that an action does not return | Decided, 20 November 2026 | Carried out with the user's tick |
| 31 | Acting without the application | Decided, 20 November 2026 | Not required; done where nothing is missing |
| 32 | A token made from the wallet's coin that does not come to the wallet | Decided, 20 November 2026 | Carried out with the user's tick |
| 33 | Corrections from stage 11 | Taken into the proposal, 20 November 2026 | — |
| 34 | Several places that hold coins for one token | Decided, 20 November 2026 | Each is listed as an open position; telling a moved position from one set beside it is not pursued |
| 36 | Where the pages of this version are served for the chipnet runs | Decided, 20 November 2026 | At the public addresses, in place of the second design's pages |
| 37 | The wait for the engine to list the coins of an action just sent | Decided, 20 November 2026 | Accepted |
| 38 | Token names and units from a registry (BCMR) | Built, 21 November 2026 | From the chain only, as `docs/token-registries.md` proposed |
| 39 | Mainnet | Built, 21 November 2026 | `"mainnetEnabled": true` beside `"network": "mainnet"` in the served configuration; off without it; a warning on every page. Public beside chipnet. A first use ran on mainnet with small amounts, and its recovery was completed on 22 November |
