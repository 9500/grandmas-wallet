# Stage 17 in browsers on the local node: the Savings Jar from its template alone, through the loss of a phone (PR19)

Written by `scripts/stage-17-jar-browser.ts local --directory verify-jar --within 6` on 2026-11-21 00:19 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.local-runs/verify-jar/`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds (`deploy/preview.sh build`) served by `deploy/serve.mjs` with the content security policy at http://localhost:8301/, http://localhost:8302/ and http://localhost:8303/, against the regtest node, with two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet reads no recovery declaration: the Savings Jar reached it as its template of version 4, in the page's requests of `xo_v1` version 2. Times in the log are seconds since the start.

Outcome: every step was carried out.

What the run showed:

- Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 1:20 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 1bc5…6183 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 1bc5…6183 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 1bc55160…f46183 Opens on When the jar can be emptied, as a Unix time. 1795223100 Date on the key The same time, as it is written on the jar's key. 3cee006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa205917…d2b387 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve."
- On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · 1bc55160…f46183 · 3cee006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `1bc5516022277433c32806e5498048fe6a7e50254fdeb4ae91b7024888f46183`; the jar's date 2026-11-21T01:05:00Z; its address `bchreg:pw745hqgy95w6fewnqnp6fyqntrx0q2kxn43l0zr4368ztn643axcxk6f5jva` (transaction `1a2ea6b8f58d037dad6ee04fe79d22d3730b6f48fc657ca7ec062908599c76fe`).
- On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · 1bc55160…f46183 · 3cee006b Template not trusted What it controls can't be shown here. ? Trust this template Send".
- Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · 1bc55160…f46183 · 3cee006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".
- From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 2:05 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 1bc55160…f46183 Opens on When the jar can be emptied, as a Unix time. 1795223100 Date on the key The same time, as it is written on the jar's key. 3cee006b Key holder Where the jar's key goes: an address of the wallet. aa20c994…c35787 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out."
- The jar was emptied by the new phone from its own list of positions (transaction `1460e2b258be907f8689c0b8e00c2ef9ca7e5613fa04d5723c209416d44cc03c`), with the Savings Jar page never opened on it: of the 166 requests its browser made up to then, none went to the jar page's origin http://localhost:8303. The list then showed the jar as "Closed", "It holds nothing now.".

## The new phone's requests

Every request the new phone's browser made, from the moment its profile was made until the end of the run, recorded by Playwright for every page of the profile (requests of the pages and of their workers, and web sockets): 207 in all.

| Origin | Requests | What was asked |
| --- | --- | --- |
| http://localhost:8301 | 38 | `/`, `/assets/index-nzivoJhS.js`, `/assets/rolldown-runtime-BYOrzxDO.js`, `/assets/path-browserify-cMkRY8gI.js`, `/assets/preload-helper-7y9sWmk5.js`, `/assets/__vite-browser-external-BnCWfpkB.js`, `/assets/index-C2-jQtPl.css`, `/config.json`, and 5 more |
| ws://127.0.0.1:60403 | 16 | `/` |
| blob: | 1 | `(the whole address)` |
| http://localhost:8311 | 75 | `/v1/archives/43b134291e84da077d84ed5729f7a248/blobs`, `/v1/archives/43b134291e84da077d84ed5729f7a248/blobs/8f65e167f59abbecf04b650ab0d3915071f00dd5fd604e47a7f80fb0141681f0`, `/v1/archives/43b134291e84da077d84ed5729f7a248/blobs/c8d0826d381d4e6d6b7ef3dae0a7259a2faab0666efb8e339cc6d0ee23916d15`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs/08985552572783392ebd268c9ddccbe768a14b89bc7ddcba9865e590b097285e`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs/35c470cfb046072907bc878457fb919d246cf2b325c5243a3ea59520538db761`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs/621aefc6dffe1c02fd0b9c7a8796183fdda3717490cf71fb653a7fa7c8e772c2`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs/6320001ac0a77bebb4f6d27b6fdc9638606f9ef30439ef7abae14a2fc710ee09`, and 4 more |
| http://localhost:8312 | 76 | `/v1/archives/43b134291e84da077d84ed5729f7a248/blobs`, `/v1/archives/43b134291e84da077d84ed5729f7a248/blobs/8f65e167f59abbecf04b650ab0d3915071f00dd5fd604e47a7f80fb0141681f0`, `/v1/archives/43b134291e84da077d84ed5729f7a248/blobs/c8d0826d381d4e6d6b7ef3dae0a7259a2faab0666efb8e339cc6d0ee23916d15`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs/08985552572783392ebd268c9ddccbe768a14b89bc7ddcba9865e590b097285e`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs/35c470cfb046072907bc878457fb919d246cf2b325c5243a3ea59520538db761`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs/621aefc6dffe1c02fd0b9c7a8796183fdda3717490cf71fb653a7fa7c8e772c2`, `/v1/archives/2a0b0f6f017b4c10ec346fcf5fb734b4/blobs/6320001ac0a77bebb4f6d27b6fdc9638606f9ef30439ef7abae14a2fc710ee09`, and 4 more |
| ws://127.0.0.1:44035 | 1 | `/` |

None went to the Savings Jar page (http://localhost:8303).

## Transactions and coins

Read from the local node after the run: every transaction in the blocks after height 1478, where the run started, or in the node's pool, that touches an address of the run (the run's own key, the wallet's addresses of both phones' seeds, its controller, the jar and the recoverer's balance), so that another run at the same time is left out. The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.

| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The local payer pays the run's key | `ef261cbafd1bdc3bba298f25b1640bcaa6cfbd6318251f93c581f40186f94ad4` | 1582 | 219 | 219 | 1.00 |
| 2 | The run's key pays | `a61024d96e3d18913f4185d4b05a1671ee633bb988e9b651f460656420dcccb0` | 1584 | 219 | 219 | 1.00 |
| 3 | The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance | `173899948145d23f438239a64e82d5626def7c23c6e11bf417eda4ff96be5019` | 1586 | 377 | 377 | 1.00 |
| 4 | The run's key pays | `1bc5516022277433c32806e5498048fe6a7e50254fdeb4ae91b7024888f46183` | 1587 | 229 | 229 | 1.00 |
| 5 | The owner's phone opens the jar, on the Savings Jar page's request (30,000 sat into the jar, the key to the wallet) | `1a2ea6b8f58d037dad6ee04fe79d22d3730b6f48fc657ca7ec062908599c76fe` | 1591 | 477 | 477 | 1.00 |
| 6 | The recoverer asks to move the wallet to the new phone's key (the controller's request), paid from her balance | `8a34cb7ce090786e3f9a493f9b5caacc63c8a0baf8e11f2f3f704f51da11e931` | 1593 | 991 | 991 | 1.00 |
| 7 | The recoverer completes the move after the waiting period, paid from her balance | `234629c371bfbc19344cfaa2151fa7a3d3f4f050b8bf508f5caa7ea0c486928a` | 1608 | 970 | 970 | 1.00 |
| 8 | The new phone: Moved 3 coins from earlier addresses | `33cb9061256967d7592aa2866ca94ca7c3f0005cd2ae2dba704a467dcf1271ea` | 1619 | 1702 | 1702 | 1.00 |
| 9 | The new phone empties the jar by itself, from its own list (the key at input 0, the key and the savings to the new seed) | `1460e2b258be907f8689c0b8e00c2ef9ca7e5613fa04d5723c209416d44cc03c` | 1636 | 520 | 520 | 1.00 |
| 10 | The new phone: Sent everything to qr0dmsu88m…l9g6hd | `5002f341c5da85f6d93b4da437fe913a43bb5999e99df217a34f5c25d08eac70` | 1637 | 636 | 636 | 1.00 |
| 11 | The recoverer sends her balance back | `d07a2033c39a24f2893daee9c38bae5c2a153dac4c011a44230eb57c36007de9` | 1639 | 185 | 185 | 1.00 |
| 12 | The run's key sends what it holds back to the funding address | `0534d38d124289e68f0ff985a66a02f9471325680b3a7c7facd04a5360eefaeb` | 1640 | 185 | 185 | 1.00 |

12 transactions, 6710 bytes, 6,710 sat in fees.

What came into the run, from coins no transaction of the run made:

- 2,189,545,082 sat from the outside address the coins went back to (bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd)

Where every coin went: the outputs that no transaction of the run spent, by whose they are (an output at the funding address may have been spent since by its next payment):

| Where | Coins | Value | Tokens on them |
| --- | --- | --- | --- |
| the outside address the coins went back to (bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd) | 4 | 2,189,536,372 sat |  |
| the wallet's controller (its identity token) | 1 | 1,000 sat | an NFT (mutable, commitment 0100010000005020…) of category a61024d96e3d… |
| an address of the new phone's seed | 1 | 1,000 sat | an NFT (none, commitment 3cee006b) of category 1bc551602227… |

2,189,545,082 sat came in; 2,189,538,372 sat is in these outputs and 6,710 sat went to fees, which adds up.

## Pictures

In `docs/screens/`, each at 390×844 (`-phone`) and 1280×800 (`-desktop`): `live-jar-open-review`, `live-jar-page-opened`, `live-jar-positions-owner`, `live-jar-new-phone-untrusted`, `live-jar-trust-from-backup`, `live-jar-positions-after-recovery`, `live-jar-empty-review`, `live-jar-emptied-done`, `live-jar-positions-emptied`.

## Log

```
   0 s  the run's bound: 6 minutes, until 00:25:39 UTC (--within)
   0 s  local node: node: running, block 1478, median time 2026-11-21T00:39:03Z
   0 s  relay: ws://127.0.0.1:44035, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8301/, this checkout at d34df82, regtest
   1 s  recoverer page: http://localhost:8302/, this checkout at d34df82, regtest
   1 s  jar page: http://localhost:8303/, this checkout at d34df82, regtest
   3 s  the run's key bchreg:qpufpwlxjgcyw3akhhhzqurh6ckg2ggup530hawtdt: paid 460000 satoshis in ef261cbafd1bdc3bba298f25b1640bcaa6cfbd6318251f93c581f40186f94ad4:0, confirmed at height 1582; the key is kept in .local-runs/verify-jar/run-key.json
   3 s     the run starts after block 1478; the jar page is at http://localhost:8303/, on regtest
   3 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   4 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
   5 s     Anna's balance is funded at bchtest:qp2z4te6mnf0ddxmqdevvm839w2nxrqtzvv4ssllu3; what her page keeps, her words among it, is copied to .local-runs/verify-jar/storage-recoverer.json first
   5 s     paid 400000 satoshis in a61024d96e3d18913f4185d4b05a1671ee633bb988e9b651f460656420dcccb0:0 from the run's key, confirmed at height 1584
   5 s     waiting for the payment to reach Anna's balance on her page: at most 1 min, until 00:20:44 UTC
  12 s     the payment to reach Anna's balance on her page: after 7 s
  12 s     Anna's page shows her balance: 400000 satoshis
  12 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  12 s     Anna's code carries her name, her key and a session, 289 characters
  13 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  14 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  15 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  15 s     From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 1585; not in a block yet: the creation 173899948145…; in a block: 1 of the 2 transactions looked at.
  15 s     Anna's page says the wallet is set up and keeps what a recovery needs
  15 s     waiting for the wallet to show "Protected": Anna's receipt read from the backup stores: at most 1 min, until 00:20:53 UTC
  20 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  30 s     the wallet to show "Protected": Anna's receipt read from the backup stores: after 15 s
  30 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  30 s     From "Set it up" to "Protected", recovery on: 16 s; the chain is at height 1585; not in a block yet: the creation 173899948145…; in a block: 1 of the 2 transactions looked at.
  31 s  3. The owner receives
  31 s     address bchtest:rdat9jya54qg6734zpv2txzw0azy4nguwqtzfcf4fuawjlt5m36pkq94v7d4q
  31 s     paid 50000 satoshis in 1bc5516022277433c32806e5498048fe6a7e50254fdeb4ae91b7024888f46183:0 from the run's key, confirmed at height 1587
  32 s     vault address bchtest:rdv8ak99a0kavk2u2dy5acg6q5jtmm4e2ldyrls3qcgl6ra9nsd2w8705w6y7
  32 s     From "Set it up" to the vault address shown: 18 s; the chain is at height 1587; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  32 s     waiting for the payment of 50,000 satoshis to reach the wallet's balance (more than 0.0014 BCH): at most 1 min, until 00:21:10 UTC
  40 s     the payment of 50,000 satoshis to reach the wallet's balance (more than 0.0014 BCH): after 8 s
  40 s     the wallet holds 0.0015 BCH
  40 s  4. The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it
  40 s     the Savings Jar page shows its connection address (98 characters) and waits for a wallet
  40 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through 127.0.0.1:44035 · since Nov 21, 2026, 1:20 AM; "Connected"
  40 s     the Savings Jar page: "Connected to Grandma's Wallet"
  40 s     the jar page lists: "No jars to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds."
  40 s     the chain's clock: last block 2026-11-21T00:39:22Z, median time 2026-11-21T00:39:22Z; this machine 2026-11-21T00:20:19Z
  40 s     the form says: "0.0003 BCH stays in the jar until Nov 21, 2026, 2:05 AM, 45 minutes from now." (the date 2026-11-21T01:05:00Z)
  41 s     the wallet's review of the page's request, every fold opened: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 1:20 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 1bc5…6183 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 1bc5…6183 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 1bc55160…f46183 Opens on When the jar can be emptied, as a Unix time. 1795223100 Date on the key The same time, as it is written on the jar's key. 3cee006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa205917…d2b387 This wallet's own figures The fee, and all 3 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.0005 BCH · 50,000 sat Comes back to your wallet 0.00019523 BCH · 19,523 sat Goes into the application To its contracts and others, less what comes back from them 0.0003 BCH · 30,000 sat Network fee 477 bytes at one satoshi per byte 477 sat Your wallet goes down by 0.00030477 BCH · 30,477 sat Goes to others Savings jar · at aa20bd…7a6c87 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 1bc55160…f46183 with 3cee006b What is left over, as change 0.00018523 BCH · 18,523 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. Pay into a savings jar Add savings to a jar. They stay there until the jar's date. Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Approve Decline Nothing is signed or sent unless you approve."
  41 s     (Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 1:20 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 1bc5…6183 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 1bc5…6183 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 1bc55160…f46183 Opens on When the jar can be emptied, as a Unix time. 1795223100 Date on the key The same time, as it is written on the jar's key. 3cee006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa205917…d2b387 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve.")
  43 s     approved; the wallet: "Done: Open a savings jar", transaction 1a2ea6b8f58d037dad6ee04fe79d22d3730b6f48fc657ca7ec062908599c76fe
  45 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 21, 2026, 2:05 AM"
  45 s     waiting for the wallet to list the jar from its record, read against the chain: at most 1 min, until 00:21:24 UTC
  46 s     the wallet's list: "Jar key · Savings Jar NFT · 1bc55160…f46183 · 3cee006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"; key 1bc5516022277433c32806e5498048fe6a7e50254fdeb4ae91b7024888f46183
  46 s     (On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · 1bc55160…f46183 · 3cee006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `1bc5516022277433c32806e5498048fe6a7e50254fdeb4ae91b7024888f46183`; the jar's date 2026-11-21T01:05:00Z; its address `bchreg:pw745hqgy95w6fewnqnp6fyqntrx0q2kxn43l0zr4368ztn643axcxk6f5jva` (transaction `1a2ea6b8f58d037dad6ee04fe79d22d3730b6f48fc657ca7ec062908599c76fe`).)
  46 s  5. The phone is lost
  46 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  46 s  6. A new phone takes the wallet over with Anna's help, and sweeps
  47 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 1 min, until 00:21:25 UTC
  49 s     the new phone sent its request over the session of the code
  57 s     the request is in a block; the waiting period runs
  57 s     the recoverer's page shows the chain's clock at 01:39:23 AM, block 1595; the waiting period ends when it passes 01:47:54 AM
  58 s     the chain's clock moved on by 700 seconds; height 1606
  58 s     waiting for the blocks the run made to reach the recoverer's page (its chain's clock to move on): at most 1 min, until 00:21:37 UTC
  62 s     the blocks the run made to reach the recoverer's page (its chain's clock to move on): after 4 s
  62 s     the chain's clock on the page moved on by 701 seconds, to block 1607
  62 s     waiting for the waiting period to end on the chain's clock ("Complete the move" enabled): at most 1 min, until 00:21:41 UTC
  68 s     the waiting period to end on the chain's clock ("Complete the move" enabled): after 6 s
  69 s     waiting for the hand-over, made once the server shows the completion: at most 1 min, until 00:21:47 UTC
  78 s     the hand-over, made once the server shows the completion: after 9 s
  78 s     completed; the hand-over is ready
  78 s     From the completion to the hand-over: 9 s; the chain is at height 1618.
  79 s     the hand-over reached the new phone over the session
  79 s     the recoverer's page says that the new phone has the wallet
  79 s     waiting for the new phone to find the wallet's coins and sweep them ("Open the wallet"): at most 2 min, until 00:22:58 UTC
  79 s     From the completion to the sweep sent by the new phone: 11 s; the chain is at height 1619; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  81 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
  89 s     the new phone to find the wallet's coins and sweep them ("Open the wallet"): after 10 s
  90 s     the new phone holds 0.00116821 BCH
  90 s     From the completion to the swept coins in the new phone's wallet: 22 s; the chain is at height 1622; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  90 s     recovery is on for the new phone
  90 s     From the completion to "Protected" on the new phone: 22 s.
  90 s  7. The new phone trusts the template from the backup and lists the jar from its record, confirmed
  90 s     waiting for the new phone to list the swept key, read from the chain, with "Trust this template": at most 1 min, until 00:22:09 UTC
  91 s     the Applications screen lists the swept key: "Savings Jar NFT · 1bc55160…f46183 · 3cee006b Template not trusted What it controls can't be shown here. ? Trust this template Send"
  91 s     (On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · 1bc55160…f46183 · 3cee006b Template not trusted What it controls can't be shown here. ? Trust this template Send".)
  91 s     "A template from your backup": "An earlier owner of this wallet stored this template in the backup. It is not trusted on this phone until you say so. ? TEMPLATE Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Technical details Trust this template Back"
  91 s     waiting for the new phone to list the jar from its record, checked against the chain: at most 1 min, until 00:22:10 UTC
  92 s     trusted; the wallet's list: "Jar key · Savings Jar NFT · 1bc55160…f46183 · 3cee006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"
  92 s     (Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · 1bc55160…f46183 · 3cee006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".)
  92 s  8. The jar's date passes; the new phone empties the jar from its own list, the jar page never opened
  93 s     the chain's clock moved on by 254 seconds; height 1634
  93 s     the chain's median time is 2026-11-21T01:07:00Z, past the jar's date 2026-11-21T01:05:00Z
  93 s     waiting for the new phone to list the jar as open, from its record checked against the chain: at most 1 min, until 00:22:12 UTC
  94 s     "Empty a savings jar", from the wallet's own list, every fold opened: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 2:05 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 1bc55160…f46183 Opens on When the jar can be emptied, as a Unix time. 1795223100 Date on the key The same time, as it is written on the jar's key. 3cee006b Key holder Where the jar's key goes: an address of the wallet. aa20c994…c35787 This wallet's own figures The fee, and all 4 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.00001 BCH · 1,000 sat Comes back to your wallet 0.0003048 BCH · 30,480 sat Comes back from the application Out of its contracts, more than goes into them 0.0003 BCH · 30,000 sat Network fee 520 bytes at one satoshi per byte 520 sat Your wallet goes up by 0.0002948 BCH · 29,480 sat Your tokens it spends A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 1bc55160…f46183 with 3cee006b The application's coins it spends Read from the chain by this wallet. None of them is yours. Savings jar · 1a2ea6…fe:0 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 1bc55160…f46183 with 3cee006b What is left over, as change 0.0002948 BCH · 29,480 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. It has come back once A token made with it led to its position after a recovery. This is no audit of its contracts. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Carry it out Back Nothing is signed or sent until you carry it out."
  94 s     (From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 2:05 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 1bc55160…f46183 Opens on When the jar can be emptied, as a Unix time. 1795223100 Date on the key The same time, as it is written on the jar's key. 3cee006b Key holder Where the jar's key goes: an address of the wallet. aa20c994…c35787 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out.")
  95 s     done: 1460e2b258be907f8689c0b8e00c2ef9ca7e5613fa04d5723c209416d44cc03c
  96 s     waiting for the wallet's list to show the jar closed, once the server has the emptying: at most 1 min, until 00:22:15 UTC
  96 s     the wallet's list: "Jar key · Savings Jar NFT · 1bc55160…f46183 · 3cee006b Closed It holds nothing now. Send"
  96 s     (The jar was emptied by the new phone from its own list of positions (transaction `1460e2b258be907f8689c0b8e00c2ef9ca7e5613fa04d5723c209416d44cc03c`), with the Savings Jar page never opened on it: of the 166 requests its browser made up to then, none went to the jar page's origin http://localhost:8303. The list then showed the jar as "Closed", "It holds nothing now.".)
  96 s  9. The coins go back to where they came from
  97 s     the new phone sent everything to bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd; tokens stay where they are, so the jar's key stays in the wallet
  98 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 1 min, until 00:22:17 UTC
  99 s     Anna sent her balance back: Sent 0.00296477 BCH · 296,477 sat to qr0dmsu88m…l9g6hd. The fee was 185 sat.
 101 s  back to the funding address bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd: paid 9367 satoshis in 0534d38d124289e68f0ff985a66a02f9471325680b3a7c7facd04a5360eefaeb:0 from the run's key, confirmed at height 1640
```
