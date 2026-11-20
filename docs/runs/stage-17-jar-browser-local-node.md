# Stage 17 in browsers on the local node: the Savings Jar from its template alone, through the loss of a phone (PR19)

Written by `scripts/stage-17-jar-browser.ts local` on 2026-11-20 23:27 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.local-runs/stage-17-jar-browser/`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds (`deploy/preview.sh build`) served by `deploy/serve.mjs` with the content security policy at http://localhost:8301/, http://localhost:8302/ and http://localhost:8303/, against the regtest node, with two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet reads no recovery declaration: the Savings Jar reached it as its template of version 4, in the page's requests of `xo_v1` version 2. Times in the log are seconds since the start.

Outcome: every step was carried out.

What the run showed:

- Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 12:28 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT a029…d09a Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT a029…d09a This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. a0299045…6bd09a Opens on When the jar can be emptied, as a Unix time. 1795221420 Date on the key The same time, as it is written on the jar's key. ace7006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20b653…4c0187 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve."
- On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · a0299045…6bd09a · ace7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `a0299045cba79efd60ea87749de4b63f0f432f7dc010bae59fb3ca7c3d6bd09a`; the jar's date 2026-11-21T00:37:00Z; its address `bchreg:pwjzdzda5dly4mdl2v9n7zmprpr87gmzzgksng44v4a3acxdrmpzvnatslxu3` (transaction `6b16ecb254f9e68d56514645d768b9f6cd123d27030c310d9e6f5727ec591386`).
- On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · a0299045…6bd09a · ace7006b Template not trusted What it controls can't be shown here. ? Trust this template Send".
- Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · a0299045…6bd09a · ace7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".
- From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 1:37 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. a0299045…6bd09a Opens on When the jar can be emptied, as a Unix time. 1795221420 Date on the key The same time, as it is written on the jar's key. ace7006b Key holder Where the jar's key goes: an address of the wallet. aa20895f…ac3c87 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out."
- The jar was emptied by the new phone from its own list of positions (transaction `0a232c9bcc310d531b3f825e5a192f657a5c31089ff5ddc9517b685ecc37d4c5`), with the Savings Jar page never opened on it: of the 164 requests its browser made up to then, none went to the jar page's origin http://localhost:8303. The list then showed the jar as "Closed", "It holds nothing now.".

## The new phone's requests

Every request the new phone's browser made, from the moment its profile was made until the end of the run, recorded by Playwright for every page of the profile (requests of the pages and of their workers, and web sockets): 205 in all.

| Origin | Requests | What was asked |
| --- | --- | --- |
| http://localhost:8301 | 38 | `/`, `/assets/index-8fcuRqAF.js`, `/assets/rolldown-runtime-BYOrzxDO.js`, `/assets/path-browserify-cMkRY8gI.js`, `/assets/preload-helper-7y9sWmk5.js`, `/assets/__vite-browser-external-BnCWfpkB.js`, `/assets/index-D3vLygGb.css`, `/config.json`, and 5 more |
| ws://127.0.0.1:60403 | 16 | `/` |
| blob: | 1 | `(the whole address)` |
| http://localhost:8311 | 74 | `/v1/archives/dbe3220d00b72dfe34de87cc15f2de43/blobs`, `/v1/archives/dbe3220d00b72dfe34de87cc15f2de43/blobs/3446ff9c5dbb86f509410cdeb86e546da04910c0a585540645333346efde7f40`, `/v1/archives/dbe3220d00b72dfe34de87cc15f2de43/blobs/3d4716bfc7695d5df01f65cf3ee7a8de0be77fd2cecb6bc0c6572d8a5c399b38`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs/06a76209f0cc4e52730f63d51ab74ef22a34c10fa822cd51418e46ac48b1cdd3`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs/480a53125b6be80df6dd68cb7930b5654a8418a315d8246965148d7f106a7511`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs/50fbbb0ef3f09f8d7b36086d71673a0ff5f33b04c419fc0c968bf01d551cf5c7`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs/c80f3557d4795fec09a5636753630a6edfeeb724f8ae962bfb49e91e3a6c9d7e`, and 4 more |
| http://localhost:8312 | 75 | `/v1/archives/dbe3220d00b72dfe34de87cc15f2de43/blobs`, `/v1/archives/dbe3220d00b72dfe34de87cc15f2de43/blobs/3446ff9c5dbb86f509410cdeb86e546da04910c0a585540645333346efde7f40`, `/v1/archives/dbe3220d00b72dfe34de87cc15f2de43/blobs/3d4716bfc7695d5df01f65cf3ee7a8de0be77fd2cecb6bc0c6572d8a5c399b38`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs/06a76209f0cc4e52730f63d51ab74ef22a34c10fa822cd51418e46ac48b1cdd3`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs/480a53125b6be80df6dd68cb7930b5654a8418a315d8246965148d7f106a7511`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs/50fbbb0ef3f09f8d7b36086d71673a0ff5f33b04c419fc0c968bf01d551cf5c7`, `/v1/archives/329a1b8ba91449c8039588d15d4f6b74/blobs/c80f3557d4795fec09a5636753630a6edfeeb724f8ae962bfb49e91e3a6c9d7e`, and 4 more |
| ws://127.0.0.1:37035 | 1 | `/` |

None went to the Savings Jar page (http://localhost:8303).

## Transactions and coins

Read from the local node after the run: every transaction in the blocks after height 1315, where the run started, or in the node's pool, that touches an address of the run (the run's own key, the wallet's addresses of both phones' seeds, its controller, the jar and the recoverer's balance), so that another run at the same time is left out. The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.

| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The local payer pays the run's key | `b5fa5bd91c2704202035a33f9bf0efb6e4d997d056347e38db58ac4eaf36b945` | 1411 | 219 | 219 | 1.00 |
| 2 | The run's key pays | `157707ffb4ad1b4afb61d0bf7f63d902d19e86f1148034a1026d73c55e8128b0` | 1413 | 219 | 219 | 1.00 |
| 3 | The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance | `9544f2c647e602e6145cbf2d9689d066bffc4dfa670355240bfd7e296b129bad` | 1415 | 377 | 377 | 1.00 |
| 4 | The run's key pays | `a0299045cba79efd60ea87749de4b63f0f432f7dc010bae59fb3ca7c3d6bd09a` | 1416 | 229 | 229 | 1.00 |
| 5 | The owner's phone opens the jar, on the Savings Jar page's request (30,000 sat into the jar, the key to the wallet) | `6b16ecb254f9e68d56514645d768b9f6cd123d27030c310d9e6f5727ec591386` | 1420 | 477 | 477 | 1.00 |
| 6 | The recoverer asks to move the wallet to the new phone's key (the controller's request), paid from her balance | `7997ec9188963338e674f7a44b3a5fe2bdaf08d1ba509862df688d668a7fe5d5` | 1421 | 991 | 991 | 1.00 |
| 7 | The recoverer completes the move after the waiting period, paid from her balance | `fb3515c22bdf5ad23446c0deffacc91970233f650a934a3e1e86c9fd5b230f0f` | 1437 | 970 | 970 | 1.00 |
| 8 | The new phone: Moved 3 coins from earlier addresses | `6170c5ffffbac53a7b1bd616c23eb38d5d6f81bb5fa8a5aec1bea5e702cb68fb` | 1448 | 1702 | 1702 | 1.00 |
| 9 | The new phone empties the jar by itself, from its own list (the key at input 0, the key and the savings to the new seed) | `0a232c9bcc310d531b3f825e5a192f657a5c31089ff5ddc9517b685ecc37d4c5` | 1463 | 520 | 520 | 1.00 |
| 10 | The new phone: Sent everything to qr0dmsu88m…l9g6hd | `db8ea797e8c59c4f92c269e0f584b0bf7cec4b491f6ec12f5bf852f9789b08de` | 1465 | 636 | 636 | 1.00 |
| 11 | The recoverer sends her balance back | `c58b534025b2a09cfe930d094daf56b28359918c24dcae4bb7056036c5042ac2` | 1467 | 185 | 185 | 1.00 |
| 12 | The run's key sends what it holds back to the funding address | `0ac8e0b6d2486172c02dad850d3f535bcc737d421361bfcc817a9da849d34535` | 1468 | 185 | 185 | 1.00 |

12 transactions, 6710 bytes, 6,710 sat in fees.

What came into the run, from coins no transaction of the run made:

- 2,251,925,739 sat from the outside address the coins went back to (bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd)

Where every coin went: the outputs that no transaction of the run spent, by whose they are (an output at the funding address may have been spent since by its next payment):

| Where | Coins | Value | Tokens on them |
| --- | --- | --- | --- |
| the outside address the coins went back to (bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd) | 4 | 2,251,917,029 sat |  |
| the wallet's controller (its identity token) | 1 | 1,000 sat | an NFT (mutable, commitment 0100010000007bc2…) of category 157707ffb4ad… |
| an address of the new phone's seed | 1 | 1,000 sat | an NFT (none, commitment ace7006b) of category a0299045cba7… |

2,251,925,739 sat came in; 2,251,919,029 sat is in these outputs and 6,710 sat went to fees, which adds up.

## Pictures

In `docs/screens/`, each at 390×844 (`-phone`) and 1280×800 (`-desktop`): `live-jar-open-review`, `live-jar-page-opened`, `live-jar-positions-owner`, `live-jar-new-phone-untrusted`, `live-jar-trust-from-backup`, `live-jar-positions-after-recovery`, `live-jar-empty-review`, `live-jar-emptied-done`, `live-jar-positions-emptied`.

## Log

```
   0 s  the run's bound: 6 minutes, until 23:33:27 UTC (--within)
   0 s  local node: node: running, block 1326, median time 2026-11-21T00:11:06Z
   0 s  relay: ws://127.0.0.1:37035, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8301/, this checkout at 1cd970a, regtest
   1 s  recoverer page: http://localhost:8302/, this checkout at 1cd970a, regtest
   1 s  jar page: http://localhost:8303/, this checkout at 1cd970a, regtest
   4 s  the run's key bchreg:qqcm28nrd9pnp42ecxs52yes2r67wuzja5mp7kl9zq: paid 460000 satoshis in b5fa5bd91c2704202035a33f9bf0efb6e4d997d056347e38db58ac4eaf36b945:0, confirmed at height 1411; the key is kept in .local-runs/stage-17-jar-browser/run-key.json
   4 s     the run starts after block 1315; the jar page is at http://localhost:8303/, on regtest
   4 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   4 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
   5 s     Anna's balance is funded at bchtest:qpggeqf46xhpp7zqxn62hd95ga7nuh8vygs504jmhm; what her page keeps, her words among it, is copied to .local-runs/stage-17-jar-browser/storage-recoverer.json first
   6 s     paid 400000 satoshis in 157707ffb4ad1b4afb61d0bf7f63d902d19e86f1148034a1026d73c55e8128b0:0 from the run's key, confirmed at height 1413
   6 s     waiting for the payment to reach Anna's balance on her page: at most 1 min, until 23:28:33 UTC
  14 s     the payment to reach Anna's balance on her page: after 8 s
  14 s     Anna's page shows her balance: 400000 satoshis
  14 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  14 s     Anna's code carries her name, her key and a session, 288 characters
  15 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  16 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  16 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  16 s     From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 1414; not in a block yet: the creation 9544f2c647e6…; in a block: 1 of the 2 transactions looked at.
  16 s     Anna's page says the wallet is set up and keeps what a recovery needs
  16 s     waiting for the wallet to show "Protected": Anna's receipt read from the backup stores: at most 1 min, until 23:28:43 UTC
  21 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  31 s     the wallet to show "Protected": Anna's receipt read from the backup stores: after 15 s
  31 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  31 s     From "Set it up" to "Protected", recovery on: 16 s; the chain is at height 1414; not in a block yet: the creation 9544f2c647e6…; in a block: 1 of the 2 transactions looked at.
  32 s  3. The owner receives
  32 s     address bchtest:rvaneghtv2d24vgqv68xtn0x595cvs8k50shgl9hrkkqhxxyh7q4ghfj5twt9
  33 s     paid 50000 satoshis in a0299045cba79efd60ea87749de4b63f0f432f7dc010bae59fb3ca7c3d6bd09a:0 from the run's key, confirmed at height 1416
  33 s     vault address bchtest:rv6ztawtgccjl4zc44kzp0fk2pj2u240rtmj3ssswt3c9nhpjwavsuae7c5zt
  33 s     From "Set it up" to the vault address shown: 18 s; the chain is at height 1417; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  33 s     waiting for the payment of 50,000 satoshis to reach the wallet's balance (more than 0.0014 BCH): at most 1 min, until 23:29:00 UTC
  41 s     the payment of 50,000 satoshis to reach the wallet's balance (more than 0.0014 BCH): after 8 s
  41 s     the wallet holds 0.0015 BCH
  41 s  4. The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it
  41 s     the Savings Jar page shows its connection address (98 characters) and waits for a wallet
  42 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through 127.0.0.1:37035 · since Nov 21, 2026, 12:28 AM; "Connected"
  42 s     the Savings Jar page: "Connected to Grandma's Wallet"
  42 s     the jar page lists: "No jars to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds."
  42 s     the chain's clock: last block 2026-11-21T00:11:22Z, median time 2026-11-21T00:11:21Z; this machine 2026-11-20T23:28:09Z
  42 s     the form says: "0.0003 BCH stays in the jar until Nov 21, 2026, 1:37 AM, 69 minutes from now." (the date 2026-11-21T00:37:00Z)
  42 s     the wallet's review of the page's request, every fold opened: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 12:28 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT a029…d09a Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT a029…d09a This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. a0299045…6bd09a Opens on When the jar can be emptied, as a Unix time. 1795221420 Date on the key The same time, as it is written on the jar's key. ace7006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20b653…4c0187 This wallet's own figures The fee, and all 3 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.0005 BCH · 50,000 sat Comes back to your wallet 0.00019523 BCH · 19,523 sat Goes into the application To its contracts and others, less what comes back from them 0.0003 BCH · 30,000 sat Network fee 477 bytes at one satoshi per byte 477 sat Your wallet goes down by 0.00030477 BCH · 30,477 sat Goes to others Savings jar · at aa20a4…c22687 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token a0299045…6bd09a with ace7006b What is left over, as change 0.00018523 BCH · 18,523 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. Pay into a savings jar Add savings to a jar. They stay there until the jar's date. Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Approve Decline Nothing is signed or sent unless you approve."
  42 s     (Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 12:28 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT a029…d09a Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT a029…d09a This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. a0299045…6bd09a Opens on When the jar can be emptied, as a Unix time. 1795221420 Date on the key The same time, as it is written on the jar's key. ace7006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20b653…4c0187 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve.")
  44 s     approved; the wallet: "Done: Open a savings jar", transaction 6b16ecb254f9e68d56514645d768b9f6cd123d27030c310d9e6f5727ec591386
  45 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 21, 2026, 1:37 AM"
  46 s     waiting for the wallet to list the jar from its record, read against the chain: at most 1 min, until 23:29:13 UTC
  47 s     the wallet's list: "Jar key · Savings Jar NFT · a0299045…6bd09a · ace7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"; key a0299045cba79efd60ea87749de4b63f0f432f7dc010bae59fb3ca7c3d6bd09a
  47 s     (On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · a0299045…6bd09a · ace7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `a0299045cba79efd60ea87749de4b63f0f432f7dc010bae59fb3ca7c3d6bd09a`; the jar's date 2026-11-21T00:37:00Z; its address `bchreg:pwjzdzda5dly4mdl2v9n7zmprpr87gmzzgksng44v4a3acxdrmpzvnatslxu3` (transaction `6b16ecb254f9e68d56514645d768b9f6cd123d27030c310d9e6f5727ec591386`).)
  47 s  5. The phone is lost
  47 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  47 s  6. A new phone takes the wallet over with Anna's help, and sweeps
  48 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 1 min, until 23:29:15 UTC
  50 s     the new phone sent its request over the session of the code
  58 s     the request is in a block; the waiting period runs
  58 s     the recoverer's page shows the chain's clock at 01:11:22 AM, block 1424; the waiting period ends when it passes 01:19:53 AM
  59 s     the chain's clock moved on by 700 seconds; height 1435
  59 s     waiting for the blocks the run made to reach the recoverer's page (its chain's clock to move on): at most 1 min, until 23:29:26 UTC
  63 s     the blocks the run made to reach the recoverer's page (its chain's clock to move on): after 4 s
  63 s     the chain's clock on the page moved on by 702 seconds, to block 1436
  63 s     waiting for the waiting period to end on the chain's clock ("Complete the move" enabled): at most 1 min, until 23:29:30 UTC
  69 s     the waiting period to end on the chain's clock ("Complete the move" enabled): after 6 s
  69 s     waiting for the hand-over, made once the server shows the completion: at most 1 min, until 23:29:37 UTC
  78 s     the hand-over, made once the server shows the completion: after 9 s
  78 s     completed; the hand-over is ready
  78 s     From the completion to the hand-over: 9 s; the chain is at height 1447.
  79 s     the hand-over reached the new phone over the session
  79 s     the recoverer's page says that the new phone has the wallet
  80 s     waiting for the new phone to find the wallet's coins and sweep them ("Open the wallet"): at most 2 min, until 23:30:47 UTC
  80 s     From the completion to the sweep sent by the new phone: 11 s; the chain is at height 1448; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  82 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
  90 s     the new phone to find the wallet's coins and sweep them ("Open the wallet"): after 10 s
  91 s     the new phone holds 0.00116821 BCH
  91 s     From the completion to the swept coins in the new phone's wallet: 22 s; the chain is at height 1451; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  91 s     recovery is on for the new phone
  91 s     From the completion to "Protected" on the new phone: 22 s.
  91 s  7. The new phone trusts the template from the backup and lists the jar from its record, confirmed
  91 s     waiting for the new phone to list the swept key, read from the chain, with "Trust this template": at most 1 min, until 23:29:58 UTC
  92 s     the Applications screen lists the swept key: "Savings Jar NFT · a0299045…6bd09a · ace7006b Template not trusted What it controls can't be shown here. ? Trust this template Send"
  92 s     (On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · a0299045…6bd09a · ace7006b Template not trusted What it controls can't be shown here. ? Trust this template Send".)
  92 s     "A template from your backup": "An earlier owner of this wallet stored this template in the backup. It is not trusted on this phone until you say so. ? TEMPLATE Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Technical details Trust this template Back"
  92 s     waiting for the new phone to list the jar from its record, checked against the chain: at most 1 min, until 23:29:59 UTC
  93 s     trusted; the wallet's list: "Jar key · Savings Jar NFT · a0299045…6bd09a · ace7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"
  93 s     (Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · a0299045…6bd09a · ace7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".)
  93 s  8. The jar's date passes; the new phone empties the jar from its own list, the jar page never opened
  94 s     the chain's clock moved on by 254 seconds; height 1462
  94 s     the chain's median time is 2026-11-21T00:39:00Z, past the jar's date 2026-11-21T00:37:00Z
  94 s     waiting for the new phone to list the jar as open, from its record checked against the chain: at most 1 min, until 23:30:01 UTC
  95 s     "Empty a savings jar", from the wallet's own list, every fold opened: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 1:37 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. a0299045…6bd09a Opens on When the jar can be emptied, as a Unix time. 1795221420 Date on the key The same time, as it is written on the jar's key. ace7006b Key holder Where the jar's key goes: an address of the wallet. aa20895f…ac3c87 This wallet's own figures The fee, and all 4 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.00001 BCH · 1,000 sat Comes back to your wallet 0.0003048 BCH · 30,480 sat Comes back from the application Out of its contracts, more than goes into them 0.0003 BCH · 30,000 sat Network fee 520 bytes at one satoshi per byte 520 sat Your wallet goes up by 0.0002948 BCH · 29,480 sat Your tokens it spends A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token a0299045…6bd09a with ace7006b The application's coins it spends Read from the chain by this wallet. None of them is yours. Savings jar · 6b16ec…86:0 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token a0299045…6bd09a with ace7006b What is left over, as change 0.0002948 BCH · 29,480 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. It has come back once A token made with it led to its position after a recovery. This is no audit of its contracts. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Carry it out Back Nothing is signed or sent until you carry it out."
  95 s     (From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 1:37 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. a0299045…6bd09a Opens on When the jar can be emptied, as a Unix time. 1795221420 Date on the key The same time, as it is written on the jar's key. ace7006b Key holder Where the jar's key goes: an address of the wallet. aa20895f…ac3c87 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out.")
  96 s     done: 0a232c9bcc310d531b3f825e5a192f657a5c31089ff5ddc9517b685ecc37d4c5
  97 s     the wallet's list: "Jar key · Savings Jar NFT · a0299045…6bd09a · ace7006b Closed It holds nothing now. Send"
  97 s     (The jar was emptied by the new phone from its own list of positions (transaction `0a232c9bcc310d531b3f825e5a192f657a5c31089ff5ddc9517b685ecc37d4c5`), with the Savings Jar page never opened on it: of the 164 requests its browser made up to then, none went to the jar page's origin http://localhost:8303. The list then showed the jar as "Closed", "It holds nothing now.".)
  97 s  9. The coins go back to where they came from
  98 s     the new phone sent everything to bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd; tokens stay where they are, so the jar's key stays in the wallet
  99 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 1 min, until 23:30:06 UTC
 100 s     Anna sent her balance back: Sent 0.00296477 BCH · 296,477 sat to qr0dmsu88m…l9g6hd. The fee was 185 sat.
 101 s  back to the funding address bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd: paid 9367 satoshis in 0ac8e0b6d2486172c02dad850d3f535bcc737d421361bfcc817a9da849d34535:0 from the run's key, confirmed at height 1468
```
