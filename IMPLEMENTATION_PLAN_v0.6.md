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
- **The public sites keep showing the second design.** They are served from a release copy and are released again only when the owner says so. A design-2 release is built from the tag `design-2`.

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
| Reading a declaration; checking a template against it; finding a position from a token and the chain. These are removed in stage 14; the reading of coins from the chain in the last is kept for the check of stage 13 | `packages/app/src/declaration.ts`, `template-check.ts`, `positions.ts` |
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

**Tests:** PR03, PR04, PR05, PR06, PR07, PR12, PR23, PR24. **Done when** they pass on the simulated chain, and PR03 on the local node through the engine.

## Stage 14 — An application from its template alone

- Filling a value: the wallet's own, the request, the record, the user, with an address and a paid-in amount never from a record (section 13.3). The kinds of the wallet's own outputs, named by the request where they are not a plain receipt.
- An action about a token with no declaration: the request names the position and says whether the token is spent, or the template's own token input says so; the wallet makes sure the coin it puts there is the token.
- The application's coins as the request names them, read from the chain, each matched to a script of the template by its bytecode, with the application's contracts run before the user is asked.
- A token of the wallet's that would leave it or come back changed, and a token made from the wallet's coin that would go elsewhere: shown, and carried out only with the user's tick.
- From the wallet's own list: the actions a script offers; carried out alone where nothing is missing, and otherwise "Open the application to do this" with the page's address.
- `xo_v1` in its version 2 (section 14.2): no profile, no declaration, the new answers to a positions request.
- Removed: reading a declaration, finding a position from the chain, the template check that depends on a declaration, token names from a declaration.

**Tests:** PR13, PR14, PR15, PR16, PR17, PR18, PR21, PR22. **Done when** they pass on the simulated chain. The tests of the second design that this version retires (proposal section 21) are removed with the code they test; the others still pass.

## Stage 15 — Findings for each action

- The wallet works out which outputs of a transaction sit at a script of the template that it would follow, and reaches one of the three findings of section 12.3.
- This wallet's answers of section 12.5: it refuses where something does not come back or cannot be told.
- A template for the tests alone, with a script that takes a key of the device.

**Tests:** PR08, PR09. **Done when** they pass on the simulated chain.

## Stage 16 — The wallet's screens

- The refusal when no store confirms; the refusal of an action that would tie money to the phone; "Open the application to do this"; "Not confirmed" in the list of positions; a token with no record; a token that would leave the wallet, with its tick (section 17).
- Tokens shown by category and in raw units, and an NFT by its template and output (section 13.3), on Send, Receive and the review.
- Each is pictured on a phone and on a desktop from the fixtures page before it is wired to the wallet, and shown to the owner.

**Done when** the pictures are in `docs/screens/` and the owner has seen them.

## Stage 17 — The two applications without declarations

- Before anything else: positions that the second design opened on chipnet with its declarations are closed with the build at the tag `design-2`, and `.xo-demo/leftovers.md` is brought up to date.
- Savings Jar: the changed template in `packages/savings-jar`, frozen like the first; the jar's page sends requests of version 2.
- ParyonUSD: the loan page (`apps/loan`) finds the loan and its sidecar from the key, names Paryon's coins by outpoint, reads their values and sends them, and names the kind `return` (section 15.3). The template loses the variables that only the declaration filled where a constant can take their place.
- Both courses in browsers on the local node, with the new phone's requests recorded.
- **Chipnet runs G and H.** They need the wallet and the two pages of this version to be reachable; where they are served from is the owner's decision.

**Tests:** PR19, PR20. **Done when** the runs' records are committed. **Push.**

## Stage 18 — For XO, and the documents

- The notes for developer feedback are kept up to date in [docs/xo-feedback-notes.md](docs/xo-feedback-notes.md). The feedback itself is written by the owner.
- What XO's authors answer about a call to follow a script, about synchronisation and about how invitations travel (proposal section 13.6) is noted in the proposal's section 22.
- The proposal is brought in line with what was built: its status table and every new test with its result. The overview page follows under the same version number.
- **Push.**

## Which stage closes which test

| Stage | Tests |
| --- | --- |
| 12 | PR01, PR02, PR10, PR11 |
| 13 | PR03–PR07, PR12, PR23, PR24 |
| 14 | PR13–PR18, PR21, PR22 |
| 15 | PR08, PR09 |
| 17 | PR19, PR20 |

All 24 tests that this version adds to the proposal's section 21 are in this table once. The tests of the second design are in the table of version 0.4; the proposal's section 21 says which of them this version retires or replaces.

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
