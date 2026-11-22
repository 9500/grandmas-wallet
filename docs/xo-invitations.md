# XO templates and invitations

Every transaction this wallet sends is an invitation of an XO template, built and signed by the XO engine. This page lists the templates and the invitations kept in this repository, shows how to open one in XO's debug tool, and says how to produce the invitations again.

Everything kept here is on chipnet, the Bitcoin Cash test network, and was made on 21 November 2026 by the third design, which is what `main` holds and what the public pages serve. The engine is `@xo-cash/engine` `0.1.1-next.18170561234`, as published, with no local change.

## Templates

| Template | File | Identifier |
| --- | --- | --- |
| Grandma's Wallet controller | [templates/grandmas-wallet-controller.json](templates/grandmas-wallet-controller.json) | `a6998934ebc12728630ccd54e4d28f879484f6c4432f855eb14499c16bf59fc8` |
| Grandma's Wallet actions | [templates/grandmas-wallet-actions.json](templates/grandmas-wallet-actions.json) | `1e0dd0b3738c5c47a889b824a04d3673fccfba3bcadf303cde1b49a2a7ca003e` |
| Grandma's Wallet addresses | [templates/grandmas-wallet-givenOut.json](templates/grandmas-wallet-givenOut.json) | `a67fcc2d0b479552a03669b3ac5a95da53b1490489364127898b01199b2f475c` |
| Grandma's Wallet change | [templates/grandmas-wallet-change.json](templates/grandmas-wallet-change.json) | `c7419f58e404da2a9847df27cebd6e38cf3240f66e46e4e94a36d0958f72acd1` |
| Wallet (P2PKH), from `@xo-cash/templates` | [templates/grandmas-wallet-coins.json](templates/grandmas-wallet-coins.json) | `a31eb85891dbf248f1709a92b0fa7e3e6fdc518e6b34e376b197ed7f12dbc672` |
| Savings Jar, version 4 | [../packages/savings-jar/frozen/savings-jar-v4.json](../packages/savings-jar/frozen/savings-jar-v4.json) | `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25` |
| ParyonUSD loan (chipnet-fast-periods-6) | [../packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json](../packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json) | `aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be` |

- **The controller** is the recovery contract: one coin per wallet that names the owner's key, the recoverer's key and the waiting period. Its actions are `create`, `approve`, `changeSettings`, `close`, `requestRecovery`, `completeRecovery` and `takeUp`.
- **The wallet's own templates** are defined in `packages/app/src/templates.ts`. The files under `templates/` are written from there by `scripts/export-templates.ts`, and a test fails if they differ.
- **The Savings Jar** is an application the wallet knows nothing about: it reaches the wallet as this template alone, in the requests of the jar's page. The jar's key has an input of its own at a fixed place, so that the wallet can empty a jar by itself, with the jar's page closed.
- **The ParyonUSD template** drives [Paryon's](https://paryonusd.com/) public loan contracts on chipnet as they are deployed; nothing of Paryon's was changed. It is written in `packages/paryon/src/template-source.ts`. A wallet that has never heard of Paryon carries out a loan from this template alone, with the values the loan page sends in its requests. The kept loan run used version 1 of it. The loan page now sends version 3 ([../packages/paryon/frozen/paryon-loan-v3-chipnet-fast-periods-6.json](../packages/paryon/frozen/paryon-loan-v3-chipnet-fast-periods-6.json)), which names the loan service in its `resources`: the service takes part in each action in a role of its own, so an invitation of it holds the service's commit beside the wallet's ([xo-service.md](xo-service.md)).

## Invitations

Each folder holds one file per transaction, numbered in the order sent, and an `index.json` that names the transaction, template, action and role of each. A file is the invitation as the engine serializes it for sharing (`serializeInvitation` in `@xo-cash/utils`). It holds signatures and public keys and no secret.

| Run | Record | Invitations | What it shows |
| --- | --- | --- | --- |
| The wallet's whole life | [runs/stage-5-chipnet.md](runs/stage-5-chipnet.md) | [runs/invitations/stage-5-chipnet/](runs/invitations/stage-5-chipnet/) | A wallet is created, used, lost, recovered to a new device, swept and closed |
| Savings Jar | [runs/stage-17-jar-chipnet.md](runs/stage-17-jar-chipnet.md) | [runs/invitations/stage-17-jar-chipnet/](runs/invitations/stage-17-jar-chipnet/) | A jar is opened, the device is lost, and the new device finds the jar in its own record and empties it by itself |
| ParyonUSD loan | [runs/stage-17-loan-chipnet.md](runs/stage-17-loan-chipnet.md) | [runs/invitations/stage-17-loan-chipnet/](runs/invitations/stage-17-loan-chipnet/) | A loan of 100 PUSD is opened and managed, the device is lost, and the new device closes the loan |
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
| ParyonUSD loan | `createKey` | loan | [03](runs/invitations/stage-17-loan-chipnet/03-the-owner-s-device-createKey-83dacd05.json) |
| ParyonUSD loan | `borrow` | loan | [04](runs/invitations/stage-17-loan-chipnet/04-the-owner-s-device-borrow-91bcdc44.json) |
| ParyonUSD loan | `manage` | loan | [05](runs/invitations/stage-17-loan-chipnet/05-the-owner-s-device-manage-b9375be2.json) |
| ParyonUSD loan | `close` | loan | [09](runs/invitations/stage-17-loan-chipnet/09-the-new-device-close-fac571d6.json) |
| Actions | `pay` | every run | every other file |

### Follow-up actions

A follow-up action spends a coin that an earlier action of the same template made. A template declares one on the script of that coin, for the role that may carry it out. Two templates here declare them, and the third has the same chain without the declaration:

- **Controller:** `create` makes the controller coin; `approve` spends it and makes its successor; `close` spends that and ends the wallet. In the whole-life run these are files 01, 06 and 09. The `approve` and the `close` are signed by the new device, whose key became the owner's through the recovery in between.
- **Savings Jar:** `open` makes the jar and its key; `withdraw` spends both. In the jar run these are files 03 and 07. The `open` was signed by the device that was then lost, and the `withdraw` by the new one, from the record the first device stored in the backup.
- **ParyonUSD loan:** `createKey`, `borrow`, `manage`, `close`, each spending what the one before made. In the loan run these are files 03, 04, 05 and 09. The template lists all of its actions as starting actions and declares none on a script. Paryon's scripts are shared by all its users, so the template marks them as scripts a wallet need not track, and the engine holds no coin of theirs to offer a follow-up on. The wallet finds the loan from its loan key and carries out the next action as a new invitation.

### Things that may surprise

- **A recovery request and its completion are `pay` invitations.** The recoverer's code signs the controller input itself and gives it to the engine as a finished input of a `pay` invitation, which pays the fee from the recoverer's balance. In every run these are the recoverer's two files before the `approve`. The reason is in the next section.
- **Paryon's shared coins come with their unlocking.** The coins of Paryon's contracts sit at scripts every user shares. The wallet works out their unlocking from the template and hands each to the engine as a finished input, so the engine does not have to follow scripts with tens of thousands of transactions. The wallet's own inputs are unlocked and signed by the engine from the template.
- **The loan run has no `movePeriod` invitation.** The Borrowing thread it borrowed from was in the current period already, so there was nothing to move on.
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
4. The tool shows the template, the action, each commit with its role, and under **Result** the transaction's hash. Pressing **Accept invitation** is not needed to read it.
5. To step through the scripts of the transaction itself, open **Inspect**, choose **chipnet**, and paste the transaction's identifier from `index.json`.

The template has to be imported before its invitation: the one named in the invitation's row of `index.json`. The `pay` invitation in `runs/invitations/test-chipnet/` with `templates/grandmas-wallet-actions.json` is a short first try.

## Producing the invitations again

### By script on chipnet

The four runs above were made this way.

```bash
npm ci
cd packages/app
npx tsx ../../scripts/test-invitation.ts                # one payment
npx tsx ../../scripts/run-b.ts chipnet                  # the wallet's whole life
npx tsx ../../scripts/stage-17-jar-run.ts chipnet       # the Savings Jar through the loss of a device
npx tsx ../../scripts/stage-17-loan-run.ts chipnet      # a ParyonUSD loan through the loss of a device
```

They need a funding key with chipnet coins in `.chipnet/funder-design-2.json`:

```json
{ "privateKey": "<32 bytes as hex>" }
```

`npx tsx scripts/chipnet-pay.ts address` (from the repository's root) prints that key's address, to send test coins to. Faucets: <https://tbch.googol.cash/>, <https://chipnet.bch.ninja/>.

| Run | The funding key needs | Cost on 21 November 2026 | Time it took |
| --- | --- | --- | --- |
| One payment | a few thousand sat | about 700 sat | under a minute |
| The wallet's whole life | 150,000 sat | 10,357 sat | about 15 minutes, once chipnet's blocks carried transactions |
| Savings Jar | 200,000 sat | 8,338 sat | about 10 minutes |
| ParyonUSD loan | about 64,200,000 sat, most of it the loan's collateral | 141,669 sat, of which Paryon's borrowing fee 125,855 sat | about 10 minutes |

What to expect:

- **New keys every run.** The identifiers and transactions differ from the ones kept here; the templates, actions and their order are the same.
- **Each run replaces what the run before wrote:** its record in `docs/runs/` and its invitations in `docs/runs/invitations/`.
- **Most of the time is the recovery's waiting period,** 512 seconds of the chain's clock, which starts when the request is in a block. When chipnet's blocks carry no transactions for a while, a run waits for that block for up to 20 minutes and then stops.
- **A run that stops is continued by the same command.** Its state, with the words of its wallets, is in `.chipnet/`, which is not in git. Everything a run holds goes back to the funding key at its end.
- **`--dry`** on the jar and loan runs reads chipnet and says what the run would need, and sends nothing.
- **The loan's figures move with the price.** The collateral is 125% of 100 PUSD at the lowest price stored in Paryon's contracts; the run stops before paying anything if the key holds too little.
- **Run one at a time.** They pay from the same key.

`test-invitation.ts` pays 3,000 satoshis to an engine account and sends them back as a `pay` action.

### The same runs on the local node

```bash
cd packages/app
npx tsx ../../scripts/run-b.ts local
npx tsx ../../scripts/stage-17-jar-run.ts
npx tsx ../../scripts/stage-17-loan-run.ts
```

They run against the local node ([local-node.md](local-node.md)), need no coins and take a few minutes; the loan run deploys Paryon's contracts as published on the local chain first. The jar and loan runs write their invitations to `.local-runs/invitations/`, the whole-life run to `.chipnet/invitations/`; neither is kept in git. Their transactions are on the local chain only, so the debug tool's **Inspect** step, which reads a transaction from a public network, cannot show them, and the loan run's template names the local deployment of Paryon's contracts.

### In the browser

1. Follow [walkthrough.md](walkthrough.md) with the public pages to set up a wallet and send something; for the applications, open a savings jar at <https://jar.9500.cash/> and a ParyonUSD loan at <https://paryon.9500.cash/>, each through the wallet.
2. In the wallet, open **Technical details** (on the home screen, or under **Recovery**) and tick **Developer mode**. On the recoverer's page it is under **Settings**.
3. The card lists every transaction that browser sent, with its action and template. **Save** downloads the invitation as a file, the same kind of file as the ones here.

A browser holds the invitations of what it sent itself. After a recovery the new phone does not have those of the lost one.

## Earlier runs

The runs of the second design (19 November 2026) are still in this repository: the Savings Jar in [runs/stage-8-chipnet.md](runs/stage-8-chipnet.md) and the ParyonUSD loan in [runs/stage-9-template-chipnet.md](runs/stage-9-template-chipnet.md), with their invitations beside the others. In that design an application came with a recovery declaration beside its template, and the new device found a position from the chain. The jar's invitations there belong to version 3 of its template, which is at the tag `design-2` (`git show design-2:packages/savings-jar/frozen/savings-jar-v3.json`); the scripts that made them are at that tag too.
