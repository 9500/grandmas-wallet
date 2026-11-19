# XO templates and invitations

Every transaction this wallet sends is an invitation of an XO template, built and signed by the XO engine. This page lists the templates and the invitations kept in this repository, shows how to open one in XO's debug tool, and says how to produce the invitations again.

Everything here is on chipnet, the Bitcoin Cash test network. The engine is `@xo-cash/engine` `0.1.1-next.18170561234`, as published, with no local change.

## Templates

| Template | File | Identifier |
| --- | --- | --- |
| Grandma's Wallet controller | [templates/grandmas-wallet-controller.json](templates/grandmas-wallet-controller.json) | `a6998934ebc12728630ccd54e4d28f879484f6c4432f855eb14499c16bf59fc8` |
| Grandma's Wallet actions | [templates/grandmas-wallet-actions.json](templates/grandmas-wallet-actions.json) | `1e0dd0b3738c5c47a889b824a04d3673fccfba3bcadf303cde1b49a2a7ca003e` |
| Grandma's Wallet addresses | [templates/grandmas-wallet-givenOut.json](templates/grandmas-wallet-givenOut.json) | `a67fcc2d0b479552a03669b3ac5a95da53b1490489364127898b01199b2f475c` |
| Grandma's Wallet change | [templates/grandmas-wallet-change.json](templates/grandmas-wallet-change.json) | `c7419f58e404da2a9847df27cebd6e38cf3240f66e46e4e94a36d0958f72acd1` |
| Wallet (P2PKH), from `@xo-cash/templates` | [templates/grandmas-wallet-coins.json](templates/grandmas-wallet-coins.json) | `a31eb85891dbf248f1709a92b0fa7e3e6fdc518e6b34e376b197ed7f12dbc672` |
| ParyonUSD loan (chipnet-fast-periods-6) | [../packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json](../packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json) | `aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be` |
| Savings Jar | [../packages/savings-jar/frozen/savings-jar-v3.json](../packages/savings-jar/frozen/savings-jar-v3.json) | `04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c` |

The wallet's own templates are defined in `packages/app/src/templates.ts`. The files under `templates/` are written from there by `scripts/export-templates.ts`, and a test fails if they differ.

The ParyonUSD template drives [Paryon's](https://paryonusd.com/) public contracts on chipnet as they are deployed; nothing of Paryon's was changed. It is written in `packages/paryon/src/template-source.ts`. A wallet that has never heard of Paryon carries out a loan from this template alone.

## Invitations

Each folder holds one file per transaction, numbered in the order sent, and an `index.json` that names the transaction, template, action and role of each. A file is the invitation as the engine serializes it for sharing (`serializeInvitation` in `@xo-cash/utils`). It holds signatures and public keys and no secret.

| Run | Record | Invitations | What it shows |
| --- | --- | --- | --- |
| The wallet's whole life | [runs/stage-5-chipnet.md](runs/stage-5-chipnet.md) | [runs/invitations/stage-5-chipnet/](runs/invitations/stage-5-chipnet/) | A wallet is created, used, lost, recovered to a new device, swept and closed |
| ParyonUSD loan | [runs/stage-9-template-chipnet.md](runs/stage-9-template-chipnet.md) | [runs/invitations/stage-9-template-chipnet/](runs/invitations/stage-9-template-chipnet/) | A loan of 100 PUSD is opened and managed, the device is lost, and the new device finds the loan and closes it |
| Savings jar | [runs/stage-8-chipnet.md](runs/stage-8-chipnet.md) | [runs/invitations/stage-8-chipnet/](runs/invitations/stage-8-chipnet/) | A jar is opened, the device is lost, and the new device finds the jar and empties it twice |
| One payment | | [runs/invitations/test-chipnet/](runs/invitations/test-chipnet/) | The smallest case: one `pay` action |

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

There are three ways, from the least to the most work.

### In the browser

The public pages are this repository's wallet on chipnet.

1. Follow [walkthrough.md](walkthrough.md) with <https://wallet.9500.cash/> and <https://recoverer.9500.cash/> to set up a wallet and send something. For the applications, <https://paryon.9500.cash/> opens a ParyonUSD loan and <https://jar.9500.cash/> a savings jar, each through the wallet.
2. In the wallet, open **Technical details** (on the home screen, or under **Recovery**) and tick **Developer mode**. On the recoverer's page it is under **Settings**.
3. The card lists every transaction that browser sent, with its action and template. **Save** downloads the invitation as a file, the same kind of file as the ones here.

A browser holds the invitations of what it sent itself. After a recovery the new phone does not have those of the lost one.

### One payment by script

```bash
npm ci
cd packages/app
npx tsx ../../scripts/test-invitation.ts
```

It needs a funding key with a few thousand satoshis of chipnet coins in `.chipnet/funder-design-2.json`:

```json
{ "privateKey": "<32 bytes as hex>" }
```

`npx tsx scripts/chipnet-pay.ts address` (from the repository's root) prints that key's address, to send test coins to. Faucets: <https://tbch.googol.cash/>, <https://chipnet.bch.ninja/>.

The script pays 3,000 satoshis to an engine account and sends them back as a `pay` action. It writes the invitation to `docs/runs/invitations/test-chipnet/`. It costs about 700 satoshis.

### The full runs

```bash
cd packages/app
npx tsx ../../scripts/run-b.ts chipnet            # the wallet's whole life
npx tsx ../../scripts/run-d.ts chipnet            # the savings jar
npx tsx ../../scripts/run-e-template.ts chipnet   # the ParyonUSD loan
```

Each run writes its record to `docs/runs/` and its invitations to `docs/runs/invitations/`, replacing those of the run before. New keys are made for every run, so the identifiers and transactions differ from the ones kept here; the templates, actions and their order are the same.

| Run | Funding key needs | Takes | Costs about |
| --- | --- | --- | --- |
| Wallet | 150,000 sat | 15 minutes | 10,000 sat |
| Savings jar | 150,000 sat | 25 minutes | 10,000 sat |
| ParyonUSD loan | 0.61 BCH at a price near $207, for 100 PUSD at about 124% collateral | 30 minutes | 137,000 sat, of which 121,000 are Paryon's borrowing fee |

What a run needs besides the funding key:

- **Time.** Each run goes through a real waiting period of 512 seconds of the chain's clock.
- **For the loan run, a chipnet node's RPC** in `.chipnet/node-rpc.json` as `{ "url": "…", "user": "…", "password": "…" }`. The run tries every transaction with `testmempoolaccept` before sending it, and reads the height the node takes as final for lock times. The node has to be a build with chipnet's one-minute blocks.
- **The server.** The scripts give the engine `chipnet.9500.cash`; another chipnet Electrum server can be named in the script's `openAccount`.

A run that stops is continued by the same command. Its state, with the words of its wallets, is in `.chipnet/`, which is not in git; a run starts afresh when that file is moved away. Everything a run holds goes back to the funding key at its end.

The same three runs work on a local node with `local` in place of `chipnet`, with no coins and in a few minutes: see [local-node.md](local-node.md).
