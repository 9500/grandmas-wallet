# The web applications

Three pages and one or more backup stores, each on its own address. Everything that touches a key runs in the browser; the servers hand out files and keep sealed blobs.

| Page | Demo address | What it is | Code |
| --- | --- | --- | --- |
| Wallet | `https://wallet.9500.cash` | The owner's wallet, and a new device taking a wallet over | `apps/wallet` |
| Recoverer | `https://recoverer.9500.cash` | The trusted party that can move a wallet to a new device | `apps/recoverer` |
| Savings Jar | `https://jar.9500.cash` | An application for any wallet that supports WizardConnect: savings jars that open on a date | `apps/jar`, `packages/savings-jar` |
| Backup stores | `https://store1.9500.cash`, `https://store2.9500.cash` | Keep the wallet's sealed records | `apps/archive-store` |

The demo runs on chipnet. Anyone can open the recoverer page and act as a recoverer; its keys are made in the visitor's browser.

Shared code: `packages/app` (the wallet's, recoverer's and new device's actions on top of an XO account, the monitor, links), `packages/connect` (WizardConnect sessions and XO requests between an application and a wallet), `packages/ui` (components, browser storage, configuration).

The wallet contains nothing about the Savings Jar or any other application. An application brings its XO template; the wallet asks the user whether to trust it and carries out its actions from the template alone. A test (`test/wallet-knows-no-application.test.ts`) fails if the wallet's or the recoverer's code mentions the jar.

## What each page keeps

Everything is in the browser's storage for that page's address, which the browser keeps apart from the other pages.

| Page | Keeps |
| --- | --- |
| Wallet | The account's mnemonic; the XO engine's state, including the templates the user trusted; the wallet's record (identity, where its archive is and the key to it, what it holds with applications, the recoverer's receipt); a full copy of the archive; connections to applications and the requests they made |
| Recoverer | An encryption key pair; each package it accepted, which holds that wallet's recovery credential; one XO engine state per wallet |
| Savings Jar | The keys of its connection to a wallet. For an ordinary wallet, the unlock times and names of its jars. No wallet keys. |

The mnemonics are stored unencrypted. This is a prototype for a test network.

## Walk-through

1. **Create a wallet.** The wallet page makes an account and shows an address for ordinary coins. Once at least 8,532 satoshis have arrived and a waiting period is chosen, it creates the wallet: it writes both templates to the backup stores, then sends the creating transaction. Part of the coins (4,666 satoshis) is set aside at an address of the recovery credential, so that the recoverer can pay the fees of three requests and one completion.
2. **Set up recovery.** The recoverer page shows a setup link carrying its name and encryption key. Opened on the wallet page, it shows the key's fingerprint for checking by another channel; the wallet then seals the package to that key and shows a link for the recoverer. The recovery credential is removed from the wallet page at this point. The recoverer opens the link, the page checks the package against the chain, and on "keep" leaves a signed note in the wallet's archive. The wallet page then shows "Recovery is on".
3. **Use it.** Send; receive at the wallet's address.
4. **Connect an application.** The Savings Jar page shows a WizardConnect address, as text and as a QR code. Pasted into the wallet page and confirmed, it connects the two. When the application asks for a jar, the wallet first shows the application's template, which it has never seen, for the user to trust and remember or decline. It then shows the action in the template's words next to its own figures from the transaction, and does nothing until the user approves. The jar is recorded in the backup stores before the wallet signs, and appears in the wallet under "Held with applications".
5. **A request nobody asked for.** If the recoverer asks to move the wallet, the wallet page shows a warning with a cancel button while it is open, or cancels by itself if set to. The request has no effect once cancelled.
6. **A lost device.** The recoverer starts a move and gives the owner a link for the new device. The new device makes its own key and shows a link back; the recoverer signs and sends the request and gives the device a second link. After the waiting period the recoverer completes the move, and the new device opens the wallet: funds and what the wallet holds with applications are found from the chain and the archive, together with the applications' templates. The new device can empty the jar from the wallet page itself, with the action the jar's template names, without the application. The earlier device then shows that the wallet has moved.

"Erase this device" under "Technical details" on the wallet page clears the page's storage, which is what losing the device amounts to.

## Links between the pages

Content travels in the part of the address after `#`, which browsers do not send to servers. It is compressed JSON in URL-safe base64, except the package, which is the sealed envelope described in [restoration.md](restoration.md).

| Field | From → to | Carries | Secret? |
| --- | --- | --- | --- |
| `recoverer` | recoverer → wallet | name, encryption public key, the recoverer page's address | No |
| `enroll` | wallet → recoverer | the sealed package | Readable only with the recoverer's private key |
| `restore` | recoverer → new device | identity, creating transaction, archive location and key, the started request | **Yes**: the archive key lets the holder read the wallet's records. It gives no spending power. |
| `join` | new device → recoverer | identity, the request with the new key's hash | No |
| `requested` | recoverer → new device | identity, the request as sent | No |
| `connect` | application → wallet | the WizardConnect address and the application's name. The wallet page also takes a bare `wiz://` address, which is what the Savings Jar shows | The pairing secret; whoever opens it first is the wallet the application talks to |

The request is an XO invitation passed between two accounts: the recoverer starts it, the new device joins with its key, the recoverer signs and sends. The device takes in the sent invitation because that is how its engine learns of the wallet's controller.

## One application, two kinds of wallet

The Savings Jar shows one WizardConnect address and works out from the wallet's answer how to work with it. The user sees the same list of jars and the same form either way.

| | Ordinary wallet (for example Cashonize) | Wallet that speaks XO requests (Grandma's Wallet) |
| --- | --- | --- |
| What the wallet offers when it connects | The public keys of its address chains (`receive`, `change`, `defi`) | `xo_v1` in the session's extensions; no key paths |
| Who builds the transaction | The application: it finds the wallet's coins from the public keys, builds the transaction and asks for signatures with the standard `sign_transaction_request` | The wallet, from the application's template |
| What a jar is | A script that pays to one of the wallet's keys after the unlock time (`contracts/keyJar.cash`) | A script bound to the wallet's identity (`contracts/savingsJar.cash`), released by the owner's approval through the wallet's controller |
| What the user approves in the wallet | The transaction, with the application's one-line description | The template once, then each action in the template's words and the wallet's figures |
| Who sends it | The application, after checking that the wallet signed exactly what was asked and that it passes the network's script rules | The wallet |
| If the wallet's key is replaced by recovery | Does not apply | The jar stays where it is; the new owner empties it |
| Finding jars again in another browser | From notes in the wallet's own transactions: each deposit carries a small data output with the jar's unlock time | The wallet reports the positions it holds under the application's template |

### Ordinary wallets

`apps/jar/src/plain.ts`. Signature requests follow the form wallets expect: the transaction as hex, one source output per input with amounts as `<bigint: Nn>`, and `inputPaths` naming the key for each input the wallet signs. An ordinary coin has an empty unlocking script. The jar's input carries its unlocking script with a push of 65 zero bytes where the signature goes and a push of 33 zero bytes where the public key goes, and the contract's name and redeem script next to it; the wallet fills both in. Every jar of a wallet is locked to the first key of its `defi` chain.

Checked on chipnet with the Cashonize web wallet (an HD wallet; Cashonize does not connect a single-address wallet over WizardConnect) and with a wallet on the command line written from the protocol's description (`scripts/ordinary-wallet.ts`).

### Requests to a wallet that speaks XO (`xo_v1`)

Defined in `packages/connect`. A wallet says what it offers in the WizardConnect session's extensions. Nothing in it is about a particular application:

```json
{ "xo_v1": { "version": 2, "network": "chipnet", "interfaceVersion": 2,
  "bindings": ["identity"],
  "templates": [{ "identifier": "<XO template identifier>", "contentHash": "<SHA-256 of the canonical template>" }] } }
```

`templates` lists what the wallet already trusts, so that an application need not send those again. `bindings` names the values the wallet can fill into a template's variables itself.

| Message | Direction | Meaning |
| --- | --- | --- |
| `xo_action_request` | application → wallet | `id`; `template` (identifier and content hash) and, unless the wallet has it, the template itself as `definition`; `templateAction` and `role`; `variables` (text and numbers only); `bindings` (which variables the wallet is to fill in, for example `{ "identity": "identity" }`); `position` (one of the wallet's positions that the action spends); `label` |
| `xo_action_response` | wallet → application | whether the wallet took the request on; a refusal carries the reason |
| `xo_invitation_update` | wallet → application | `approved`, `recorded` (the backup holds the record), `sent` |
| `xo_action_result` | wallet → application | the outcome: the transaction and any positions created, or an error |
| `xo_positions_request` | application → wallet | which positions of a template does the wallet hold? |
| `xo_positions` | wallet → application | each with its name in the wallet, label, template output, variables and amount |

Rules the wallet follows:

- A template the wallet has not seen must come with the request and must be the template the request names. The wallet shows the user its name, description and actions; it is trusted only if the user says so, and then kept by the engine and in the archive.
- A request is identified by its `id`. However often it arrives, it is carried out at most once; a repeat gets the stored outcome. A different request under a used `id` is refused.
- A request whose time is more than ten minutes from the wallet's clock is refused.
- Positions are reported without asking, but only those made with the template asked about, and only if the wallet trusts it.
- A request that was being carried out when the wallet closed is not run again; its outcome is reported as unknown.
- An advertisement with a version other than 2 is not used by the application. If such a wallet also shares key paths, it is treated as an ordinary wallet.

### How the wallet carries out an action it has never heard of

`packages/app/src/owner.ts` and `account.ts`.

1. The XO engine takes the template in. For the action asked for, the wallet makes an invitation on that template that is never sent, lets the engine build it, and reads off the unsigned transaction: which scripts are paid how much, and the lock time. The engine starts following those scripts.
2. The wallet builds its own template's `approve` action around that: the controller first; the position being spent, if the action spends one; the wallet's funds, if what the action spends does not cover what it pays; the outputs the template asked for; the rest back to the wallet's address. The fee is set from the size of the transaction as built.
3. Outputs on whose script the wallet has a role become positions. Each is written to the backup stores, with the template, the action, the role, the output and the variables, before anything is signed.
4. The transaction passes this project's own evaluation of the network's rules before it is sent, like every other.

What the user is shown has two parts: the template's own name and description of the action with each variable shown by its declared type (an amount, a date, "this wallet" for its own identity), and the wallet's figures from step 1 and 2. The first part is the application's wording; the second cannot be influenced by it.

A position lists the actions its template's script offers the wallet's role. That is how a jar is emptied from the wallet page when the application is not there.

## The monitor

While the wallet page is open it reads the controller's history from every configured Electrum server about every twenty seconds and works the status out again from nothing each time. A request is seen if any one server reports it. A reorganization or a replaced transaction needs no special handling. With "cancel by itself" on, a request to someone else's key is cancelled once, and again after ninety seconds if it still shows. Nothing watches while the page is closed.

## Running it

```bash
npm install
npm run build:web
# Locally: three pages on ports 8101 to 8103 and two stores on 8111 and 8112, using deploy/config/local.json
node deploy/serve.mjs --root apps/wallet/dist --port 8101        # likewise recoverer (8102) and jar (8103)
node --import tsx apps/archive-store/src/cli.ts --port 8111 --origin http://localhost:8101 --origin http://localhost:8102
# As services behind a reverse proxy that provides HTTPS:
deploy/install-services.sh <address to listen on> deploy/config/production.json 2
```

One build serves any environment: each page reads `config.json`, which the server takes from the configuration file. The file names the three pages, the stores a new wallet uses (one is enough), the Electrum servers (two or more for the monitor), the relays and a block explorer. The server sends a content security policy that lets a page reach only those servers and the two chipnet servers the XO engine connects to by itself.

The pages need HTTPS, or `localhost`: the browser's cryptography is not available otherwise.

### The whole demonstration, scripted

```bash
node scripts/browser-demo.mjs --config deploy/config/production.json --fund-from owner --amount 20000
```

drives real browsers through the walk-through above, each device with its own storage kept under `.xo-demo/browser/`, so that a device's keys outlive the run. It takes about half an hour: the shortest waiting period is 512 seconds by the network's clock, which trails the wall clock, and the jar is locked for ten minutes.

The Savings Jar with an ordinary wallet:

```bash
# A wallet on the command line. Without an address it prints where it receives; fund that first.
node --import tsx scripts/ordinary-wallet.ts
node scripts/jar-ordinary-demo.mjs --config deploy/config/production.json

# The Cashonize web wallet, in a browser profile kept on disk. Fund the address the first step prints.
node scripts/jar-cashonize-demo.mjs --config deploy/config/production.json --step setup
node scripts/jar-cashonize-demo.mjs --config deploy/config/production.json --step open
node scripts/jar-cashonize-demo.mjs --config deploy/config/production.json --step empty
```

## What was run

On 16 November 2026, on chipnet, with the script above. Screens and transactions are from the browsers; every transaction was built and signed by the XO engine in the page and passed this project's own evaluation before it was sent.

Wallet identity `c29c930243a9cc8117eac382bcdf757f4996557b91ce6aabf156bc2f3a4b04d6`, waiting period one 512-second interval, against the public addresses. The run took 16 minutes from start to finish.

| # | Step | Done on | Transaction | Screen |
| --- | --- | --- | --- | --- |
| 1 | Owner creates the wallet | owner's page | `3439bc5126ed3c1e78d3cff87aec2e0bb588a8cf23ab8b43331b3449b5a8d196` | [02-owner-created.png](web-demo/02-owner-created.png) |
| 2 | Recoverer opens the package and confirms; the wallet shows "Recovery is on" | recoverer's page | — | [06-owner-recovery-on.png](web-demo/06-owner-recovery-on.png) |
| 3 | The Savings Jar application asks for a jar; the owner approves in the wallet | application and owner's page | `230472d89cce042ccf8f644d9eb9ebcf16374b8c530cebd75183d655b1f08a0c` | [07-owner-approval.png](web-demo/07-owner-approval.png) |
| 4 | The recoverer asks to move the wallet to a device the owner does not know | recoverer's page and a stranger's device | `fc0dacfb249c9ff4ee6006e7dc7964c8c1b6d5e97ed26f7e806a7c70f84f603c` | [10-owner-alarm.png](web-demo/10-owner-alarm.png) |
| 5 | The owner's page warns; the owner cancels | owner's page | `5d64e1469951b27e9495bfcd55c9ab9fbaf69111111bff40f4d208d9bded584b` | [11-stranger-cancelled.png](web-demo/11-stranger-cancelled.png) |
| 6 | The owner's device is lost; the recoverer and a new device request the move | recoverer's page and the new device | `6c364676b363eaa7809b9756a88a5bae931c226920fbd7bbcf6a3798d78e5094` | [13-new-device-waiting.png](web-demo/13-new-device-waiting.png) |
| 7 | The recoverer completes the move after the waiting period | recoverer's page | `d76aa77cc2ef0da58102b4e4b51433ecec82ed808aa33f445e4b5d4117eef6a9` | [14-recoverer-moved.png](web-demo/14-recoverer-moved.png) |
| 8 | The new device opens the wallet: funds and jar found; the earlier device shows the wallet has moved | new device | — | [15-new-device-taken-over.png](web-demo/15-new-device-taken-over.png) |
| 9 | The new device empties the jar after its time lock | new device | `15f088fb8b3c8f833570327f81294d8410e7397f973c17eae25967bdf25d7b86` | [17-new-device-jar-emptied.png](web-demo/17-new-device-jar-emptied.png) |
| 10 | The new device sends the remaining funds out | new device | `6bf5fbeeefc375bb56359766e4f60a4e899039e78dbc99729760befbd66817b9` |  |

All seventeen screens of the run are in [web-demo/](web-demo/).

Three earlier runs the same day stopped part-way and led to fixes: fee coins held by a request that was started or not sent; the recoverer's fee allowance, which covered two actions and now covers four; a page reading its own transaction from a server that had not received it yet; and the smallest amount allowed at the wallet's address (576 satoshis, not 546). One of those runs used a waiting period counted in blocks; see the limits below.

## Limits

- **Fees of the wallet's own actions are fixed amounts per kind of action**, a little over one satoshi per byte of the sizes measured; an application's action is built once to measure it and its fee set from that. The wallet checks the fee against the built transaction before sending.
- **The recoverer pays its fees from coins the wallet set aside.** After three requests and a completion the fee account has to be topped up; the page shows its address.
- **One wallet's desk per page load on the recoverer's page**, because the engine's network connection is shared within a page. Going to another wallet loads the page again.
- **Waiting periods are offered in time only**, in units of 512 seconds, which mean the same on every network. The contract also accepts a count of blocks. On chipnet, since its change to one-minute blocks, such a count is enforced tenfold: a wallet made with a delay of 5 blocks could be completed only once 50 blocks had followed its request (request in block 333867, completion accepted for block 333917, refused 33 times before). The pages work the end of such a delay out accordingly, from `secondsPerBlock` in the configuration.
- **Application actions the wallet refuses for now:** ones that create tokens, and ones whose inputs need a waiting period of their own.
- **A template can say anything about itself.** The wallet shows its own figures next to the template's words, but whether the template's scripts do what its descriptions say is what trusting a template means. Nothing checks that for the user.
- **`xo_v1` is this project's own extension.** No other wallet speaks it. With any other wallet the Savings Jar works the ordinary way, and its jars are then tied to a key, not to a recoverable wallet.
- **With an ordinary wallet the Savings Jar reads the chain itself**, from the servers in its configuration, and learns all of the wallet's addresses from the public keys the wallet shares. That is how WizardConnect applications work; the wallet warns about it when connecting.
- **Jars opened with the first version of the wallet page** were recorded as a kind of position the wallet no longer has, and cannot be emptied from the current page.
- **The `restore` link carries the archive key in the clear.** It should travel by a channel the recoverer trusts; sealing it to a key of the new device would need one more exchange.
- **No screen yet for changing backup stores or the recoverer**, although the wallet's code supports changing stores.
- **Header verification in the engine fails on chipnet** since the change to one-minute blocks ([details](xo-chipnet-header-verification.md)); the pages work regardless and the browser console shows the engine's warning.
