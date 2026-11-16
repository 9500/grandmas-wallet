# Grandma's Wallet — Build with XO submission material

Two XO templates, the invitations from a complete run of them on chipnet, and how to reproduce that run.

This folder does not contain the written developer feedback the bounty asks for; that is submitted separately by the author.

## What the templates do

**Grandma's Wallet** ([frozen/grandmas-wallet-v1.json](../../packages/templates/frozen/grandmas-wallet-v1.json)) is a wallet whose owner key can be replaced by a trusted recoverer, but only after a recovery request has stayed unchallenged on chain for a set delay. The owner spends alone in normal use and can cancel a request until the delay ends. The wallet's funds stay at the same address when the owner key changes.

| Action | Role | What it does |
| --- | --- | --- |
| Set up wallet | owner | Creates the wallet's identity token, its controller and its first funds. The recoverer is enrolled by a key hash and does not take part. |
| Send | owner | Pays from the wallet. Also cancels a pending recovery request. |
| Cancel recovery | owner | Cancels a pending recovery request. |
| Approve | owner | Approves a transaction that spends outputs of an application bound to the wallet. |
| Change recovery settings | owner | Replaces the owner key, the recoverer or the challenge delay. |
| Request recovery | recoverer and new owner | The recoverer opens the request; the new owner's device joins the invitation to name its key. |
| Complete recovery | recoverer | Installs the new owner key once the delay has passed. |

**Savings Jar** ([frozen/savings-jar-v1.json](../../packages/savings-jar/frozen/savings-jar-v1.json)) is a small separate application: funds locked for a wallet until a chosen time. It has no keys of its own. Anyone can pay into a jar; after the unlock time it is emptied by the wallet's owner using the wallet template's Approve action, with the jar as an input. When the wallet's owner key is replaced, the jar stays where it is and the new owner is the one who can empty it.

The runs recorded here used version 1 of that template. [Version 2](../../packages/savings-jar/frozen/savings-jar-v2.json) adds a withdraw action with the jar as its input and the unlock time as its lock time, so that a wallet that has never seen the application can carry out both actions from the template alone ([how](../web-apps.md#how-the-wallet-carries-out-an-action-it-has-never-heard-of)). The script is the same in both.

The contracts behind both templates are in [contracts/](../../contracts/). The templates carry their compiled bytecode unchanged, which a test checks.

## The run

[lifecycle-log.md](lifecycle-log.md) lists the ten transactions of one run on chipnet, each with its invitation in [invitations/](invitations/). Three XO accounts took part: the owner, the recoverer, and the replacement device that becomes the new owner.

1. The owner sets up the wallet and pays from it.
2. The recoverer and the replacement device request recovery; the owner cancels.
3. The owner opens a savings jar by paying its address.
4. A second recovery request is left unchallenged, and the recoverer completes it after the delay. The network refuses the completing transaction until then.
5. The replacement device, now the owner, pays from the same wallet funds, empties the jar once its time lock has passed, and changes the challenge delay.

Follow-up actions are used throughout: every step after the first spends the controller output created by an earlier invitation.

## Reproducing it

Requirements: Node 22 or later, and about 30,000 satoshis of chipnet coins.

```bash
npm install
npm run xo-demo -- addresses
```

The second command creates three accounts (their mnemonics are kept in `.xo-demo/`, which git ignores) and prints an ordinary chipnet address for each. Send about 20,000 satoshis to the owner, 5,000 to the recoverer and 3,000 to the replacement device, then:

```bash
npm run xo-demo -- run
```

The run takes about 20 minutes, most of it waiting for the challenge delay (one 512-second interval) and the jar's time lock. It writes the invitations and the log into this folder. If it stops part-way, `npm run xo-demo -- rescue` returns the wallet's funds to the account that owns it.

The Electrum server used for looking up transactions can be changed with the `CHIPNET_ENDPOINT` environment variable.

## Things to know when inspecting or reproducing

- **Engine version.** `@xo-cash/engine` 0.1.1-next.18029697917, unmodified, with the package versions the XO web dev wallet pins.
- **One process per account.** The engine allows one account per process, so the runner starts three and passes serialized invitations between them.
- **Storage in Node.** The engine's SQLite storage is not usable in this version, so the accounts run with an in-memory IndexedDB. Their state lasts for one run.
- **Keys depend on the template.** XO derives keys under the template identifier, so a wallet can only be operated with the exact template it was created with. That is why the templates are kept as frozen files.
- **Key generation.** The wallet template generates a key in one place, when a wallet is set up. The recoverer and the replacement device ask for their key in the intent of their first recovery request and reuse it afterwards.
- **Fees and change.** The runner sets change itself; the engine's fee estimate assumes much smaller inputs than a covenant input.
- **Header errors on chipnet.** The engine logs "Could not validate a block header" for transactions confirmed after chipnet's switch to one-minute blocks. It does not affect building, signing or broadcasting. The cause and a fix are described in [../xo-chipnet-header-verification.md](../xo-chipnet-header-verification.md).
- **Signing type.** The templates sign with `all_outputs`. Signing with `all_outputs_all_utxos` fails in this engine version for transactions with more than one input; see [../xo-engine-signing-bug.md](../xo-engine-signing-bug.md).
