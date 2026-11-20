# XO templates and invitations

Every transaction this wallet sends is an invitation of an XO template, built and signed by the XO engine. This page lists the templates and the invitations kept in this repository, shows how to open one in XO's debug tool, and says how to produce the invitations again.

Everything kept here is on chipnet, the Bitcoin Cash test network. The engine is `@xo-cash/engine` `0.1.1-next.18170561234`, as published, with no local change.

The invitations kept here were made by the second design (tag `design-2`), in which an application came with a recovery declaration beside its template. The wallet's own templates, and the ParyonUSD template, are the same in the third design, which is what this branch holds; the Savings Jar's template changed. How to make invitations with the third design is at the end.

## Templates

| Template | File | Identifier |
| --- | --- | --- |
| Grandma's Wallet controller | [templates/grandmas-wallet-controller.json](templates/grandmas-wallet-controller.json) | `a6998934ebc12728630ccd54e4d28f879484f6c4432f855eb14499c16bf59fc8` |
| Grandma's Wallet actions | [templates/grandmas-wallet-actions.json](templates/grandmas-wallet-actions.json) | `1e0dd0b3738c5c47a889b824a04d3673fccfba3bcadf303cde1b49a2a7ca003e` |
| Grandma's Wallet addresses | [templates/grandmas-wallet-givenOut.json](templates/grandmas-wallet-givenOut.json) | `a67fcc2d0b479552a03669b3ac5a95da53b1490489364127898b01199b2f475c` |
| Grandma's Wallet change | [templates/grandmas-wallet-change.json](templates/grandmas-wallet-change.json) | `c7419f58e404da2a9847df27cebd6e38cf3240f66e46e4e94a36d0958f72acd1` |
| Wallet (P2PKH), from `@xo-cash/templates` | [templates/grandmas-wallet-coins.json](templates/grandmas-wallet-coins.json) | `a31eb85891dbf248f1709a92b0fa7e3e6fdc518e6b34e376b197ed7f12dbc672` |
| ParyonUSD loan (chipnet-fast-periods-6) | [../packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json](../packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json) | `aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be` |
| Savings Jar, version 4 (third design) | [../packages/savings-jar/frozen/savings-jar-v4.json](../packages/savings-jar/frozen/savings-jar-v4.json) | `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25` |
| Savings Jar, version 3 (second design) | at the tag `design-2`: `git show design-2:packages/savings-jar/frozen/savings-jar-v3.json` | `04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c` |

The wallet's own templates are defined in `packages/app/src/templates.ts`. The files under `templates/` are written from there by `scripts/export-templates.ts`, and a test fails if they differ.

The ParyonUSD template drives [Paryon's](https://paryonusd.com/) public contracts on chipnet as they are deployed; nothing of Paryon's was changed. It is written in `packages/paryon/src/template-source.ts`. A wallet that has never heard of Paryon carries out a loan from this template alone, with the values the loan page sends in its requests.

The Savings Jar's version 4 gives the jar's key an input of its own at a fixed place, so that the wallet can empty a jar by itself (proposal section 15.3). The jar run kept here used version 3, the one to import for its invitations.

## Invitations

Each folder holds one file per transaction, numbered in the order sent, and an `index.json` that names the transaction, template, action and role of each. A file is the invitation as the engine serializes it for sharing (`serializeInvitation` in `@xo-cash/utils`). It holds signatures and public keys and no secret.

| Run | Record | Invitations | What it shows |
| --- | --- | --- | --- |
| The wallet's whole life | [runs/stage-5-chipnet.md](runs/stage-5-chipnet.md) | [runs/invitations/stage-5-chipnet/](runs/invitations/stage-5-chipnet/) | A wallet is created, used, lost, recovered to a new device, swept and closed |
| ParyonUSD loan | [runs/stage-9-template-chipnet.md](runs/stage-9-template-chipnet.md) | [runs/invitations/stage-9-template-chipnet/](runs/invitations/stage-9-template-chipnet/) | A loan of 100 PUSD is opened and managed, the device is lost, and the new device finds the loan and closes it |
| Savings jar | [runs/stage-8-chipnet.md](runs/stage-8-chipnet.md) | [runs/invitations/stage-8-chipnet/](runs/invitations/stage-8-chipnet/) | A jar is opened, the device is lost, and the new device finds the jar and empties it twice |
| One payment | | [runs/invitations/test-chipnet/](runs/invitations/test-chipnet/) | The smallest case: one `pay` action |

All four are runs of the second design (tag `design-2`), made in November 2026 with the scripts of that time. In the loan and jar runs the new device found the position from the chain, as the declaration told it; in the third design it finds it from its own record. The transactions of the wallet's own templates are made the same way in both designs.

Each record lists its transactions in a table whose last column links the invitation.

The actions to look for:

| Template | Action | Where |
| --- | --- | --- |
| Controller | `create` | `01-…-create-….json` in every run |
| Controller | `approve`: the new owner sweeps the earlier device's coins | `…-the-new-device-approve-….json` |
| Controller | `close` | the last `close` of each run |
| ParyonUSD loan | `createKey`, `borrow`, `manage`, `close` | files 03, 04, 05 and 09 of the loan run |
| Savings Jar | `open`, `withdraw` | files 03, 07 and 08 of the jar run |
| Actions | `pay` | every other file |

Two things that may surprise:

- **A recovery request and its completion are `pay` invitations.** The recoverer's key for a wallet comes from that wallet's credential, which the engine cannot hold: it derives every key from its own seed and takes none from outside. The recoverer's code signs the controller input itself and gives it to the engine as a finished input of a `pay` invitation, which pays the fee from the recoverer's balance. The controller template defines `requestRecovery` and `completeRecovery`, and those unlocking scripts are what the finished input satisfies.
- **Paryon's shared coins come with their unlocking.** The coins of Paryon's contracts sit at scripts every user shares. The wallet works out their unlocking from the template and hands each to the engine as a finished input, so the engine does not have to follow scripts with tens of thousands of transactions. The wallet's own inputs are unlocked and signed by the engine from the template.

The loan run of 19 November has no `movePeriod` invitation: the Borrowing thread it borrowed from was in the current period already, so there was nothing to move on.

## Opening an invitation in the debug tool

The tool is at <https://blaze.xo.cash/>. It is a development wallet that runs in the browser.

1. Choose **Create new account**, give it any name, set **Network** to **chipnet**, and press **Save and use account**. Let it make a phrase of its own.
2. Press **Import Template**. Under **or paste JSON**, paste the whole template file of the invitation you want to see, and press **Import JSON**. The tool answers with the template's name and identifier, which is the one in the table above.
3. Press **Join Invitation**, paste the whole invitation file, and press **View invitation**.
4. The tool shows the template, the action, each commit with its role, and under **Result** the transaction's hash. Pressing **Accept invitation** is not needed to read it.
5. To step through the scripts of the transaction itself, open **Inspect**, choose **chipnet**, and paste the transaction's identifier from `index.json`.

The template has to be imported before its invitation. The `pay` invitation in `runs/invitations/test-chipnet/` with `templates/grandmas-wallet-actions.json` is a short first try.

## Producing the invitations again

The scripts that made the loan and jar runs above (`run-d.ts`, `run-e-template.ts` and those before them) went with the recovery declaration and are at the tag `design-2` only. With the third design there are three ways.

### In the browser

1. Follow [walkthrough.md](walkthrough.md) with the public pages to set up a wallet and send something; for the applications, open a savings jar at <https://jar.9500.cash/> and a ParyonUSD loan at <https://paryon.9500.cash/>, each through the wallet. Each page's `version.json` names the commit and branch it was built from: `design-3` for the third design.
2. In the wallet, open **Technical details** (on the home screen, or under **Recovery**) and tick **Developer mode**. On the recoverer's page it is under **Settings**.
3. The card lists every transaction that browser sent, with its action and template. **Save** downloads the invitation as a file, the same kind of file as the ones here.

A browser holds the invitations of what it sent itself. After a recovery the new phone does not have those of the lost one. The same pages run on your own machine against the local node (the end of [walkthrough.md](walkthrough.md)).

### The runs of the third design, on the local node

```bash
cd packages/app
npx tsx ../../scripts/stage-17-jar-run.ts     # the Savings Jar through the loss of a device
npx tsx ../../scripts/stage-17-loan-run.ts    # a ParyonUSD loan through the loss of a device
```

They run against the local node ([local-node.md](local-node.md)), need no coins and take a few minutes; the loan run deploys Paryon's contracts as published on the local chain first. Each writes its record to `docs/runs/` ([runs/stage-17-jar-local-node.md](runs/stage-17-jar-local-node.md), [runs/stage-17-loan-local-node.md](runs/stage-17-loan-local-node.md)) and its invitations to `.local-runs/invitations/stage-17-jar/` and `.local-runs/invitations/stage-17-loan/`, which are not kept in git. A run that stops is continued by the same command; `--new` starts again. Their transactions are on the local chain only, so the debug tool's **Inspect** step, which reads a transaction from a public network, cannot show them; the loan run's template names the local deployment of Paryon's contracts, and its identifier is in the run's record.

The same courses in browsers, with the pages of this checkout and a relay on this machine, are `npx tsx scripts/stage-17-jar-browser.ts` and `npx tsx scripts/stage-17-loan-browser.ts` (from the repository's root, after `deploy/preview.sh build`). They keep each device's browser profile under `.local-runs/`, and write no invitation files.

### One payment, and the wallet's whole life, by script on chipnet

These two are unchanged from the second design.

```bash
npm ci
cd packages/app
npx tsx ../../scripts/test-invitation.ts          # one payment
npx tsx ../../scripts/run-b.ts chipnet            # the wallet's whole life
```

They need a funding key with chipnet coins in `.chipnet/funder-design-2.json`:

```json
{ "privateKey": "<32 bytes as hex>" }
```

`npx tsx scripts/chipnet-pay.ts address` (from the repository's root) prints that key's address, to send test coins to. Faucets: <https://tbch.googol.cash/>, <https://chipnet.bch.ninja/>.

`test-invitation.ts` pays 3,000 satoshis to an engine account and sends them back as a `pay` action. It writes the invitation to `docs/runs/invitations/test-chipnet/` and costs about 700 satoshis.

`run-b.ts` writes its record to `docs/runs/` and its invitations to `docs/runs/invitations/`, replacing those of the run before. New keys are made for every run, so the identifiers and transactions differ from the ones kept here; the templates, actions and their order are the same. Its funding key needs 150,000 satoshis; it takes about 15 minutes, of which a waiting period of 512 seconds of the chain's clock, and costs about 10,000 satoshis. A run that stops is continued by the same command; its state, with the words of its wallets, is in `.chipnet/`, which is not in git. Everything a run holds goes back to the funding key at its end. `run-b.ts local` makes the same run on the local node, with no coins and in a few minutes.
