# XO templates and invitations

Every transaction this wallet sends is an invitation of an XO template, built and signed by the XO engine. This page lists the templates and the invitations kept in this repository, shows how to open one in XO's debug tool, and says how to produce the invitations again.

Everything kept here is on chipnet, the Bitcoin Cash test network, and was made by the third design, which is what `main` holds and what the public pages serve: the loan run on 22 November 2026, the others on 21 November. The engine that made them is `@xo-cash/engine` `0.1.1-next.18170561234`, as published, with no local change. Since 22 November 2026 `main` uses the release after it, `0.1.1-next.18230317763`, also as published; with it the wallet's whole life, the Savings Jar run and the loan run were carried out again on the local node ([whole life](runs/stage-5-local-node.md), [jar](runs/stage-17-jar-local-node.md), [loan](runs/stage-17-loan-local-node.md)), and the chipnet runs were not made again.

## Templates

| Template | File | Identifier |
| --- | --- | --- |
| Grandma's Wallet controller | [templates/grandmas-wallet-controller.json](templates/grandmas-wallet-controller.json) | `a6998934ebc12728630ccd54e4d28f879484f6c4432f855eb14499c16bf59fc8` |
| Grandma's Wallet actions | [templates/grandmas-wallet-actions.json](templates/grandmas-wallet-actions.json) | `1e0dd0b3738c5c47a889b824a04d3673fccfba3bcadf303cde1b49a2a7ca003e` |
| Grandma's Wallet addresses | [templates/grandmas-wallet-givenOut.json](templates/grandmas-wallet-givenOut.json) | `a67fcc2d0b479552a03669b3ac5a95da53b1490489364127898b01199b2f475c` |
| Grandma's Wallet change | [templates/grandmas-wallet-change.json](templates/grandmas-wallet-change.json) | `c7419f58e404da2a9847df27cebd6e38cf3240f66e46e4e94a36d0958f72acd1` |
| Wallet (P2PKH), from `@xo-cash/templates` | [templates/grandmas-wallet-coins.json](templates/grandmas-wallet-coins.json) | `a31eb85891dbf248f1709a92b0fa7e3e6fdc518e6b34e376b197ed7f12dbc672` |
| Savings Jar, version 4 | [../packages/savings-jar/frozen/savings-jar-v4.json](../packages/savings-jar/frozen/savings-jar-v4.json) | `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25` |
| ParyonUSD loan, version 3 (chipnet-fast-periods-6) | [../packages/paryon/frozen/paryon-loan-v3-chipnet-fast-periods-6.json](../packages/paryon/frozen/paryon-loan-v3-chipnet-fast-periods-6.json) | `160a451f5398db649de7d660855db24113b774559534361f8334cbfe9a583e20` |

- **The controller** is the recovery contract: one coin per wallet that names the owner's key, the recoverer's key and the waiting period. Its actions are `create`, `approve`, `changeSettings`, `close`, `requestRecovery`, `completeRecovery` and `takeUp`.
- **The wallet's own templates** are defined in `packages/app/src/templates.ts`. The files under `templates/` are written from there by `scripts/export-templates.ts`, and a test fails if they differ.
- **The Savings Jar** is an application the wallet knows nothing about: it reaches the wallet as this template alone, in the requests of the jar's page. The jar's key has an input of its own at a fixed place, so that the wallet can empty a jar by itself, with the jar's page closed.
- **The ParyonUSD template** drives [Paryon's](https://paryonusd.com/) public loan contracts on chipnet as they are deployed; nothing of Paryon's was changed. It is written in `packages/paryon/src/template-source.ts`, and a wallet that has never heard of Paryon carries out a loan from it alone. The next section describes it.

## The ParyonUSD loan template, version 3

Version 3 is what the loan page at <https://paryon.9500.cash/> offers and what the kept loan run used. It differs from the first version in two ways: it declares its follow-up actions, and it names a service that takes part in every action.

**Seven actions, two of them starting actions.** The other five are declared as follow-ups on the script of the coin they act on (`lockingScripts.<script>.roles.borrower.actions` in the file):

| Action | The template's name for it | Kind | Declared on |
| --- | --- | --- | --- |
| `createKey` | Make a loan key | starting action | |
| `movePeriod` | Bring Paryon up to date | starting action | |
| `borrow` | Borrow PUSD | follow-up | "A loan key, waiting" (`originEnforcerContract`), where `createKey` leaves the new key |
| `manage` | Change the collateral | follow-up | "A loan" (`loanContract`), which `borrow` makes |
| `changeInterest` | Change the interest rate | follow-up | "A loan" |
| `repay` | Repay part of the loan | follow-up | "A loan" |
| `close` | Repay and close the loan | follow-up | "A loan" |

**Two roles.** The `borrower` is the wallet's user, who holds the loan key. The `service` supplies what only Paryon's side of the chain knows at the moment of the action: the price, the loan's record, and Paryon's shared coins with their unlocking. Every action needs one participant in each role.

| Action | The borrower commits | The service commits |
| --- | --- | --- |
| `createKey` | the new key | Paryon's key factory |
| `movePeriod` | nothing | the Borrowing thread and its new state |
| `borrow` | the key, the debt, the collateral, the starting rate | the Borrowing thread, the price, the waiting key and its proof, the loan's record, Paryon's fee |
| `manage` | the key, the new collateral | the price, the loan with its sidecar and record, a manage function |
| `changeInterest` | the key, the new rate | the loan with its sidecar and record, an interest function |
| `repay` | the key, the amount | the price, the loan with its sidecar and record, a manage function |
| `close` | the key | the price, the loan with its sidecar and record, the debt, a manage function |

**The service is named in the template.** Its `resources` hold one entry with the name `xo_service_v1` and the address `https://paryon.9500.cash/service/v1`. The wallet starts the invitation with the borrower's commit and sends it there; the service appends one commit in its own role and sends it back; the wallet checks what was added, adds its own outputs and a coin for the fee, and signs last. The invitation is XO's own, unchanged. The protocol is [xo-service.md](xo-service.md); the service is `apps/paryon-service`. It holds no key and keeps nothing between requests.

**What the wallet does with the declarations.**

- Once the template is trusted, the wallet lists the two starting actions on the template's screen and names the other five there as actions done from a token.
- Under a loan key it offers an action only if the template declares that action as a follow-up for the borrower. The service says what can be done under a key now; the wallet drops anything the template does not declare.
- When it creates the invitation, the wallet gives the engine the follow-up's entry from the script as the intent, where a starting action gets its entry of `start`.

**The same template serves mainnet** with Paryon's mainnet deployment ([../packages/paryon/frozen/paryon-loan-v3-mainnet-v1.json](../packages/paryon/frozen/paryon-loan-v3-mainnet-v1.json), identifier `89b1af236ace2e5544f28f286a830186dc742597ddb9a7e7e3a205ad1b48092a`), at the same service address. No mainnet loan was taken.

The earlier versions are beside it in `packages/paryon/frozen/`: version 1 lists every action as a starting action, and version 2 declares the follow-ups and has no service, so the loan page supplies Paryon's coins with each request.

## Invitations

Each folder holds one file per transaction, numbered in the order sent, and an `index.json` that names the transaction, template, action and role of each. A file is the invitation as the engine serializes it for sharing (`serializeInvitation` in `@xo-cash/utils`). It holds signatures and public keys and no secret.

| Run | Record | Invitations | What it shows |
| --- | --- | --- | --- |
| The wallet's whole life | [runs/stage-5-chipnet.md](runs/stage-5-chipnet.md) | [runs/invitations/stage-5-chipnet/](runs/invitations/stage-5-chipnet/) | A wallet is created, used, lost, recovered to a new device, swept and closed |
| Savings Jar | [runs/stage-17-jar-chipnet.md](runs/stage-17-jar-chipnet.md) | [runs/invitations/stage-17-jar-chipnet/](runs/invitations/stage-17-jar-chipnet/) | A jar is opened, the device is lost, and the new device finds the jar in its own record and empties it by itself |
| ParyonUSD loan, version 3 with the service | [runs/stage-17-loan-chipnet.md](runs/stage-17-loan-chipnet.md) | [runs/invitations/stage-17-loan-chipnet/](runs/invitations/stage-17-loan-chipnet/) | All seven actions of the template: a key is made, Paryon is brought up to date, 200 PUSD are borrowed, collateral is added, the rate is changed, half is repaid; the device is lost, and the new device closes the loan from its own list, with the loan page closed |
| One payment | | [runs/invitations/test-chipnet/](runs/invitations/test-chipnet/) | The smallest case: one `pay` action |

Each record lists its transactions in a table whose last column links the invitation. Every run ended with all its coins back at the address that paid for it.

### Where each action is

| Template | Action | Run | File |
| --- | --- | --- | --- |
| Controller | `create` | every run | `01-…-create-….json` |
| Controller | `approve`: the new owner sweeps the earlier device's coins | whole life | [06](runs/invitations/stage-5-chipnet/06-the-new-device-approve-0c6d1a63.json) |
| Controller | `close` | whole life | [09](runs/invitations/stage-5-chipnet/09-the-new-device-close-046c70c9.json) |
| Savings Jar | `open` | jar | [03](runs/invitations/stage-17-jar-chipnet/03-the-owner-s-device-open-68fdf1bf.json) |
| Savings Jar | `withdraw` | jar | [07](runs/invitations/stage-17-jar-chipnet/07-the-new-device-withdraw-140214e5.json) |
| ParyonUSD loan | `createKey`, a starting action | loan | [03](runs/invitations/stage-17-loan-chipnet/03-the-owner-s-device-createKey-79a9d101.json) |
| ParyonUSD loan | `movePeriod`, a starting action | loan | [04](runs/invitations/stage-17-loan-chipnet/04-the-owner-s-device-movePeriod-8953856d.json) |
| ParyonUSD loan | `borrow`, a follow-up of `createKey` | loan | [05](runs/invitations/stage-17-loan-chipnet/05-the-owner-s-device-borrow-cc7d301c.json) |
| ParyonUSD loan | `manage`, a follow-up of `borrow` | loan | [06](runs/invitations/stage-17-loan-chipnet/06-the-owner-s-device-manage-112ec780.json) |
| ParyonUSD loan | `changeInterest`, a follow-up | loan | [07](runs/invitations/stage-17-loan-chipnet/07-the-owner-s-device-changeInterest-0af98ec7.json) |
| ParyonUSD loan | `repay`, a follow-up | loan | [08](runs/invitations/stage-17-loan-chipnet/08-the-owner-s-device-repay-991978aa.json) |
| ParyonUSD loan | `close`, a follow-up, by the new device | loan | [12](runs/invitations/stage-17-loan-chipnet/12-the-new-device-close-6d5e928c.json) |
| Actions | `pay` | every run | every other file |

The loan run's other files are the wallet's own: 01 creates it, 02 and 13 are payments, 09 and 10 the recovery's request and completion, 11 the new device's sweep (`approve`), 14 the wallet's close and 15 the return of the recoverer's balance.

### Follow-up actions

A follow-up action spends a coin that an earlier action of the same template made. A template declares one on the script of that coin, for the role that may carry it out. All three templates here declare them.

**ParyonUSD loan.** Five of its seven actions are follow-ups, and the loan run carries out every one of them on chipnet:

| Step | File | Follows | Signed by |
| --- | --- | --- | --- |
| `createKey` makes the loan key, which waits in Paryon's contract | [03](runs/invitations/stage-17-loan-chipnet/03-the-owner-s-device-createKey-79a9d101.json) | starting action | the owner's device |
| `borrow` takes the waiting key and opens the loan | [05](runs/invitations/stage-17-loan-chipnet/05-the-owner-s-device-borrow-cc7d301c.json) | `createKey`, declared on "A loan key, waiting" | the owner's device |
| `manage` adds collateral | [06](runs/invitations/stage-17-loan-chipnet/06-the-owner-s-device-manage-112ec780.json) | `borrow`, declared on "A loan" | the owner's device |
| `changeInterest` sets a new rate | [07](runs/invitations/stage-17-loan-chipnet/07-the-owner-s-device-changeInterest-0af98ec7.json) | the loan as `manage` left it | the owner's device |
| `repay` pays back half | [08](runs/invitations/stage-17-loan-chipnet/08-the-owner-s-device-repay-991978aa.json) | the loan as `changeInterest` left it | the owner's device |
| `close` repays the rest and ends the loan | [12](runs/invitations/stage-17-loan-chipnet/12-the-new-device-close-6d5e928c.json) | the loan as `repay` left it | the new device, after the recovery |

- **Each file holds two participants.** The first commit is the wallet's, in the role `borrower`; the second is the service's, in the role `service`, with Paryon's coins and the values read from them; the rest are the wallet's own outputs, fee and change. The debug tool shows the two roles on the commits.
- **Each step spends what the one before made.** Every transaction but the last puts the loan back at the same script with a new record, and the next action spends that coin. The key returns to the wallet each time.
- **The wallet offers them from the template.** After `createKey` it offered "Borrow PUSD" for the waiting key; after `borrow` it listed the four actions of the loan under the key. No page asked for any of them: the loan page's only part in the run was to offer the template.
- **The last one is carried out after the loss of the device.** The new device restores its trust in the template from the backup, the user presses Connect, the service says what can be done under the swept key, and `close` appears under it.
- **`movePeriod`** ([04](runs/invitations/stage-17-loan-chipnet/04-the-owner-s-device-movePeriod-8953856d.json)) is the second starting action. It moves one of Paryon's Borrowing threads on to the current period and needs no key.

**Controller.** `create` makes the controller coin; `approve` spends it and makes its successor; `close` spends that and ends the wallet. In the whole-life run these are files 01, 06 and 09. The `approve` and the `close` are signed by the new device, whose key became the owner's through the recovery in between.

**Savings Jar.** `open` makes the jar and its key; `withdraw` spends both. In the jar run these are files 03 and 07. The `open` was signed by the device that was then lost, and the `withdraw` by the new one, from the record the first device stored in the backup.

### Things that may surprise

- **A recovery request and its completion are `pay` invitations.** The recoverer's code signs the controller input itself and gives it to the engine as a finished input of a `pay` invitation, which pays the fee from the recoverer's balance. In every run these are the recoverer's two files before the `approve`. The reason is in the next section.
- **An invitation file does not say whether its action was a follow-up.** It names the template and the action. That the action is a follow-up, and of which script, is in the template; the engine does not write it into the invitation.
- **Paryon's shared coins come with their unlocking, in the service's commit.** The coins of Paryon's contracts sit at scripts every user shares. The template marks those scripts as ones a wallet does not follow, so the engine holds no coin of theirs and does not have to follow scripts with tens of thousands of transactions. The service brings each such coin as a finished input; the wallet checks every one against the template and runs it in the virtual machine before the user is asked. The wallet's own inputs are unlocked and signed by the engine from the template.
- **The service is the second participant, and it signs nothing that spends.** Its commit carries values, Paryon's coins and the outputs that put them back. It holds no key that can spend anything: the user's coins are signed by the wallet, and Paryon's contracts are unlocked by their own rules.
- **The loan run paid more than one fee rate.** Its transactions up to the recovery request paid 1 satoshi per byte and the ones after it 3; the last return of the recoverer's balance paid 2, because what was left could not pay 3. Chipnet's mempool was being filled by someone else's transactions that morning, and nodes had begun to ask for more than 1; the run was continued with `--fee-rate 3`. The record says so in its facts and notes.
- **No kept run uses `changeSettings`.** It replaces the owner key, the recoverer or the waiting period, and none of the runs does that.

## Why a recovery is a `pay` invitation

The controller template has seven actions. The owner's (`create`, `approve`, `changeSettings`, `close`) are carried out by the engine under their own names. The recoverer's two, `requestRecovery` and `completeRecovery`, reach the chain inside `pay` invitations. The contract's recovery branches are what those transactions run; only the name on the invitation differs.

- **An engine signs with the keys of one seed.** An engine is opened on one twelve-word phrase and derives every key from it. It takes no key from outside, and only one engine can be open in a page.
- **A recoverer looks after many wallets, each with a key of its own.** For every wallet it creates, the recoverer makes a separate twelve-word credential, and the recovery key for that wallet comes from it. Two wallets with the same recoverer then share no value on chain, and a credential that leaks exposes one wallet.
- **The recoverer pays every fee from one balance.** The balance is at a seed of the recoverer's own, and the page's engine is opened on that seed.
- **A request therefore needs signatures from two seeds.** Its first input is the wallet's controller, signed with the recovery key from that wallet's credential. Its other inputs are coins of the balance, signed with the balance's key. The page's one engine holds the second key and not the first.

An engine opened on a wallet's credential derives the same recovery key, and the template's `takeUp` action is how such an engine takes the key up. The page would then need an engine per wallet, loaded one at a time, and coins set apart for each wallet's fees. Signing the controller input outside the engine was found more convenient: one page with one engine and one balance serves every wallet.

What the page does for a request or a completion:

1. Its own code builds the controller input and signs it with the recovery key, as the template's `requestRecovery` or `completeRecovery` unlocking script asks.
2. It gives that input to the engine as a finished input, the way another participant's input arrives.
3. The engine adds coins of the balance for the fee, signs them, and builds and sends the transaction as a `pay` action of the actions template.

Proposal sections 9.2 and 9.6 have the decision and its reasons.

## Opening an invitation in the debug tool

The tool is at <https://blaze.xo.cash/>. It is a development wallet that runs in the browser.

1. Choose **Create new account**, give it any name, set **Network** to **chipnet**, and press **Save and use account**. Let it make a phrase of its own.
2. Press **Import Template**. Under **or paste JSON**, paste the whole template file of the invitation you want to see, and press **Import JSON**. The tool answers with the template's name and identifier, which is the one in the table above.
3. Press **Join Invitation**, paste the whole invitation file, and press **View invitation**.
4. The tool shows the template, the action, the commits, and under **Result** the transaction's hash with who created and sent it. A commit that opens a participant's part is marked with its role; the commits that add to it say which commit they extend. Pressing **Accept invitation** is not needed to read it.
5. To step through the scripts of the transaction itself, open **Inspect**, choose **chipnet**, and paste the transaction's identifier from `index.json`.

The template has to be imported before its invitation: the one named in the invitation's row of `index.json`. The `pay` invitation in `runs/invitations/test-chipnet/` with `templates/grandmas-wallet-actions.json` is a short first try.

For a follow-up with two participants, import `packages/paryon/frozen/paryon-loan-v3-chipnet-fast-periods-6.json` and open the loan run's file 06 (`manage`): the tool shows five commits, the first marked with the role borrower and the second with the role service, and the transaction `112ec780…2c1598` under **Result**. These steps were tried on 22 November 2026 with that file, with files 05 (`borrow`) and 12 (`close`), and with two of the wallet's own invitations.

## Producing the invitations again

### By script on chipnet

The four runs above were made this way, the loan run on 22 November 2026 and the others the day before.

```bash
npm ci
cd packages/app
npx tsx ../../scripts/test-invitation.ts                # one payment
npx tsx ../../scripts/run-b.ts chipnet                  # the wallet's whole life
npx tsx ../../scripts/stage-17-jar-run.ts chipnet       # the Savings Jar through the loss of a device
npx tsx ../../scripts/stage-17-loan-run.ts chipnet      # a ParyonUSD loan through the loss of a device, version 3 with the service
```

The loan run offers the wallet the frozen version 3 template and nothing else. The wallet then carries out every action from its own lists, and each invitation is joined by the public service the template names, `https://paryon.9500.cash/service/v1`; the run starts no service of its own. `stage-17-loan-run.ts chipnet --page` is the earlier course, in which the loan page supplies Paryon's coins with each request, with version 2 of the template; it writes to files of its own.

They need a funding key with chipnet coins in `.chipnet/funder-design-2.json`:

```json
{ "privateKey": "<32 bytes as hex>" }
```

`npx tsx scripts/chipnet-pay.ts address` (from the repository's root) prints that key's address, to send test coins to. Faucets: <https://tbch.googol.cash/>, <https://chipnet.bch.ninja/>.

| Run | The funding key needs | Cost when it was made | Time it took |
| --- | --- | --- | --- |
| One payment | a few thousand sat | about 700 sat | under a minute |
| The wallet's whole life | 150,000 sat | 10,357 sat | about 15 minutes, once chipnet's blocks carried transactions |
| Savings Jar | 200,000 sat | 8,338 sat | about 10 minutes |
| ParyonUSD loan | about 128,800,000 sat, most of it the loan's collateral, which comes back at the close | 288,297 sat, of which Paryon's borrowing fee 254,556 sat and network fees 33,741 sat (about 20,000 sat at 1 sat/byte throughout) | about 15 minutes of steps and the waiting period; 50 minutes on the day, most of it waiting for a block that carried its transactions |

What to expect:

- **New keys every run.** The identifiers and transactions differ from the ones kept here; the templates, actions and their order are the same.
- **Each run replaces what the run before wrote:** its record in `docs/runs/` and its invitations in `docs/runs/invitations/`.
- **Most of the time is the recovery's waiting period,** 512 seconds of the chain's clock, which starts when the request is in a block. When chipnet's blocks carry no transactions for a while, a run waits for that block for up to 20 minutes and then stops.
- **A run that stops is continued by the same command.** Its state, with the words of its wallets, is in `.chipnet/`, which is not in git. Everything a run holds goes back to the funding key at its end.
- **`--dry`** on the jar and loan runs reads chipnet and says what the run would need, and sends nothing. For the loan it also asks the service whether it serves the template and which starting actions are possible now.
- **The loan's figures move with the price.** The collateral is 125% of 200 PUSD at the lowest price stored in Paryon's contracts; the run stops before paying anything if the key holds too little.
- **The loan run needs the public service to answer.** If it does not, the run stops at that action with its state saved.
- **The runs pay 1 satoshi per byte.** A node whose mempool was full a little earlier asks for more for a while and refuses them ("mempool min fee not met"); a run stopped by that sends nothing. The loan run takes `--fee-rate <n>`, also on a run that is continued, and pays that from then on: `npx tsx ../../scripts/stage-17-loan-run.ts chipnet --fee-rate 3`. The other runs are continued by the same command once the node takes 1 satoshi per byte again.
- **Run one at a time.** They pay from the same key.

`test-invitation.ts` pays 3,000 satoshis to an engine account and sends them back as a `pay` action.

### The same runs on the local node

```bash
cd packages/app
npx tsx ../../scripts/run-b.ts local
npx tsx ../../scripts/stage-17-jar-run.ts
npx tsx ../../scripts/stage-17-loan-run.ts
```

They run against the local node ([local-node.md](local-node.md)), need no coins and take a few minutes; the loan run deploys Paryon's contracts as published on the local chain first and starts the service app for that deployment on 127.0.0.1. The jar and loan runs write their invitations to `.local-runs/invitations/`, the whole-life run to `.chipnet/invitations/`; neither is kept in git. Their transactions are on the local chain only, so the debug tool's **Inspect** step, which reads a transaction from a public network, cannot show them, and the loan run's template names the local deployment of Paryon's contracts.

### In the browser

1. Follow [walkthrough.md](walkthrough.md) with the public pages to set up a wallet and send something; for the applications, open a savings jar at <https://jar.9500.cash/> and a ParyonUSD loan at <https://paryon.9500.cash/>, each through the wallet.
2. In the wallet, open **Technical details** (on the home screen, or under **Recovery**) and tick **Developer mode**. On the recoverer's page it is under **Settings**.
3. The card lists every transaction that browser sent, with its action and template. **Save** downloads the invitation as a file, the same kind of file as the ones here.

A browser holds the invitations of what it sent itself. After a recovery the new phone does not have those of the lost one.

## Earlier runs

Until 22 November 2026 the loan run kept here was one of version 1 of the ParyonUSD template (21 November: 100 PUSD, the actions `createKey`, `borrow`, `manage` and `close`, all of them starting actions, with the loan page supplying Paryon's coins). Its record and invitations are in git at commit `cacb0fb`: `git show cacb0fb:docs/runs/stage-17-loan-chipnet.md`, and the files under `docs/runs/invitations/stage-17-loan-chipnet/` at that commit.

The runs of the second design (19 November 2026) are still in this repository: the Savings Jar in [runs/stage-8-chipnet.md](runs/stage-8-chipnet.md) and the ParyonUSD loan in [runs/stage-9-template-chipnet.md](runs/stage-9-template-chipnet.md), with their invitations beside the others. In that design an application came with a recovery declaration beside its template, and the new device found a position from the chain. The jar's invitations there belong to version 3 of its template, which is at the tag `design-2` (`git show design-2:packages/savings-jar/frozen/savings-jar-v3.json`); the scripts that made them are at that tag too.
