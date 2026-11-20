# Stage 17 in browsers on chipnet (run G): the Savings Jar from its template alone, through the loss of a phone (PR19)

Written by `scripts/stage-17-jar-browser.ts chipnet --screens` on 2026-11-20 21:24 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/stage-17-jar-browser-chipnet/`; the Savings Jar page is a second tab of the phone that uses it. The pages are the public ones, https://wallet.9500.cash/, https://recoverer.9500.cash/, https://jar.9500.cash/, as served, on chipnet with the public backup stores. Blocks, the waiting period and the jar's date took their real time; the coins came from the funding address and went back to it. Served from: https://wallet.9500.cash/ commit cd18348 of design-3, released 2026-11-20T21:13:24Z; https://recoverer.9500.cash/ commit cd18348 of design-3, released 2026-11-20T21:13:24Z; https://jar.9500.cash/ commit cd18348 of design-3, released 2026-11-20T21:13:24Z. The wallet reads no recovery declaration: the Savings Jar reached it as its template of version 4, in the page's requests of `xo_v1` version 2. Times in the log are seconds since the start.

Outcome: every step was carried out.

What the run showed:

- Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 20, 2026, 10:25 PM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT a695…0254 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT a695…0254 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. a6957444…ea0254 Opens on When the jar can be emptied, as a Unix time. 1795211460 Date on the key The same time, as it is written on the jar's key. c4c0006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20f92f…63f987 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve."
- On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · a6957444…ea0254 · c4c0006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `a69574448c824774587846dc2cb5f9ba7b34f840a37187c7ba6a29c896ea0254`; the jar's date 2026-11-20T21:51:00Z; its address `bchtest:pv2rmmh0vaat84dx3kk9znr4u5cf8k8dyp8juj2nz89eerakvtytkc32w5df7` (transaction `fae1f401b3a5eafb31b2d7cc7577c82db3af0278b23d7e1f55db3f6191499f86`).
- On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · a6957444…ea0254 · c4c0006b Template not trusted What it controls can't be shown here. ? Trust this template Send".
- Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · a6957444…ea0254 · c4c0006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".
- From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 20, 2026, 10:51 PM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. a6957444…ea0254 Opens on When the jar can be emptied, as a Unix time. 1795211460 Date on the key The same time, as it is written on the jar's key. c4c0006b Key holder Where the jar's key goes: an address of the wallet. aa20e2ca…fba487 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out."
- The jar was emptied by the new phone from its own list of positions (transaction `041364a2197f2140b50203a48cc1a138ae6f648d5d808f378bf2c16479ba799c`), with the Savings Jar page never opened on it: of the 183 requests its browser made up to then, none went to the jar page's origin https://jar.9500.cash. The list then showed the jar as "Closed", "It holds nothing now.".

## The new phone's requests

Every request the new phone's browser made, from the moment its profile was made until the end of the run, recorded by Playwright for every page of the profile (requests of the pages and of their workers, and web sockets): 224 in all.

| Origin | Requests | What was asked |
| --- | --- | --- |
| https://wallet.9500.cash | 38 | `/`, `/assets/index-8fcuRqAF.js`, `/assets/rolldown-runtime-BYOrzxDO.js`, `/assets/path-browserify-cMkRY8gI.js`, `/assets/preload-helper-7y9sWmk5.js`, `/assets/__vite-browser-external-BnCWfpkB.js`, `/assets/index-D3vLygGb.css`, `/config.json`, and 5 more |
| wss://chipnet.9500.cash | 12 | `/` |
| wss://chipnet.imaginary.cash:50004 | 4 | `/` |
| blob: | 1 | `(the whole address)` |
| https://store1.9500.cash | 83 | `/v1/archives/bac8dea8b3b1855d406049cb55bcbe85/blobs`, `/v1/archives/bac8dea8b3b1855d406049cb55bcbe85/blobs/c21148fa22984ed1907c8149d38c891205a812e12754fef01e7a1292d980f7ed`, `/v1/archives/bac8dea8b3b1855d406049cb55bcbe85/blobs/d6c4c43ccb0cbf0b26363dc74ce10a343c051b645eb2ed593c83525d2433e79b`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs/0dbafba339a9d1569024c4bc50105ede445f2baceed495e2d168f11567004285`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs/3e9c86851fd15482589732b07eb9c54974cd8a4ffb6f4d96d21efd6d5a87af25`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs/e60ded843b3948adcb1fdc5710a88141e6457080a79a6ebb42152342fc2760da`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs/ecee57da33de82ae2a42051d0fe65f7205c91efe809adb300bde6379b64c055a`, and 4 more |
| https://store2.9500.cash | 84 | `/v1/archives/bac8dea8b3b1855d406049cb55bcbe85/blobs`, `/v1/archives/bac8dea8b3b1855d406049cb55bcbe85/blobs/c21148fa22984ed1907c8149d38c891205a812e12754fef01e7a1292d980f7ed`, `/v1/archives/bac8dea8b3b1855d406049cb55bcbe85/blobs/d6c4c43ccb0cbf0b26363dc74ce10a343c051b645eb2ed593c83525d2433e79b`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs/0dbafba339a9d1569024c4bc50105ede445f2baceed495e2d168f11567004285`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs/3e9c86851fd15482589732b07eb9c54974cd8a4ffb6f4d96d21efd6d5a87af25`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs/e60ded843b3948adcb1fdc5710a88141e6457080a79a6ebb42152342fc2760da`, `/v1/archives/e03f5caa7a51e105627a51c1c1d25710/blobs/ecee57da33de82ae2a42051d0fe65f7205c91efe809adb300bde6379b64c055a`, and 4 more |
| wss://relay.riften.net | 1 | `/` |
| wss://relay.cauldron.quest | 1 | `/` |

None went to the Savings Jar page (https://jar.9500.cash).

## Transactions and coins

Read from chipnet's server after the run: every transaction in the blocks after height 340146, where the run started, or not yet in a block, that touches an address of the run (the wallet's addresses of both phones' seeds, its controller, the jar and the recoverer's balance). The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.

| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The funding address pays | `a13c094a214b497d1442df45be63d8059c6ecda539fdf9b77d6b6f38629d2eaa` | 340147 | 219 | 219 | 1.00 |
| 2 | The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance | `c04a3b7f4e30f3a08160197df73a0ee3d89b18669259223cfa66388d731215a3` | 340147 | 377 | 377 | 1.00 |
| 3 | The funding address pays | `a69574448c824774587846dc2cb5f9ba7b34f840a37187c7ba6a29c896ea0254` | 340168 | 511 | 511 | 1.00 |
| 4 | The owner's phone opens the jar, on the Savings Jar page's request (30,000 sat into the jar, the key to the wallet) | `fae1f401b3a5eafb31b2d7cc7577c82db3af0278b23d7e1f55db3f6191499f86` | 340168 | 477 | 477 | 1.00 |
| 5 | The recoverer asks to move the wallet to the new phone's key (the controller's request), paid from her balance | `434f76b0a0632f733ce2310124a02bbffafb8d2addbfc3b3676e283b3b5ec3c8` | 340168 | 991 | 991 | 1.00 |
| 6 | The recoverer completes the move after the waiting period, paid from her balance | `abc1a9882b5cba793be5b1e744497c798b509332378c4098dc7f7e45e78164d2` | 340183 | 970 | 970 | 1.00 |
| 7 | The new phone: Moved 3 coins from earlier addresses | `dec457330af4820cef74c9647f55fc518383a72debf377c5418c0ce514888d25` | 340183 | 1702 | 1702 | 1.00 |
| 8 | The new phone empties the jar by itself, from its own list (the key at input 0, the key and the savings to the new seed) | `041364a2197f2140b50203a48cc1a138ae6f648d5d808f378bf2c16479ba799c` | 340183 | 520 | 520 | 1.00 |
| 9 | The new phone: Sent everything to qphf9jdtnr…y9q77u | `e83ee53dcfbf75439e89426c0d975ff59b4de5068125e5fd4fc85a7dea34a98d` | 340183 | 636 | 636 | 1.00 |
| 10 | The recoverer sends her balance back | `e70b034b9dd19f3635afc77109cd31b4a79a08a1acf01d2cf01480553d6dcd4e` | 340183 | 185 | 185 | 1.00 |
| 11 | The wallet is closed | `05ef93663c68991b8041e61b22d5955040c20d279419becdded5f185b86dc9c2` | not in a block | 977 | 977 | 1.00 |

11 transactions, 7565 bytes, 7,565 sat in fees.

What came into the run, from coins no transaction of the run made:

- 60,416,557 sat from the outside address the coins went back to (bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u)

Where every coin went: the outputs that no transaction of the run spent, by whose they are (an output at the funding address may have been spent since by its next payment):

| Where | Coins | Value | Tokens on them |
| --- | --- | --- | --- |
| the outside address the coins went back to (bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u) | 4 | 60,408,992 sat |  |

60,416,557 sat came in; 60,408,992 sat is in these outputs and 7,565 sat went to fees, which adds up.

## Pictures

In `docs/screens/`, each at 390×844 (`-phone`) and 1280×800 (`-desktop`): `chipnet-jar-open-review`, `chipnet-jar-page-opened`, `chipnet-jar-positions-owner`, `chipnet-jar-new-phone-untrusted`, `chipnet-jar-trust-from-backup`, `chipnet-jar-positions-after-recovery`, `chipnet-jar-empty-review`, `chipnet-jar-emptied-done`, `chipnet-jar-positions-emptied`.

## The wallet closed

The wallet `a13c094a214b497d1442df45be63d8059c6ecda539fdf9b77d6b6f38629d2eaa` was closed (transaction `05ef93663c68991b8041e61b22d5955040c20d279419becdded5f185b86dc9c2`, 977 bytes, fee 977 sat): its controller of 1,000 sat and 1,000 sat with the NFT of a69574448c82…, destroyed went to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u, where 1,023 sat arrived.

The funding address held 60,018,096 sat when the run started and 60,406,117 sat once its wallet was closed. In between it was also used by the Cashonize run on the public jar page ([its record](stage-17-jar-cashonize-chipnet.md), 2,875 sat in fees) and got back what a first attempt of this run had taken: that attempt, started at 21:17 UTC from the same commit's pages, stopped in step 2 because the course looked for the recoverer's "Grandma's wallet is set up" only after the phone said "ready", by which time her page had gone on to the next code (corrected in the course, commit `b9f275b`). Its wallet (`53fe97d2…e0`, 100,000 sat and its controller) was closed (`ed074dcd5af9e0c9e0a350ba9d887545e1330ab9c5d9024704ba68b8608d3d6d`, 977 bytes, fee 977 sat, 100,023 sat arrived) and its recoverer sent her balance back (`a04d119d64af0590398c821277757b07d267dec392696c7f218d859f854a9eca`, fee 185 sat, 298,438 sat arrived): it cost 2,040 sat. Its profiles are kept in `.chipnet/stage-17-jar-browser-first-chipnet/`. 60,018,096 + 398,461 − 2,875 − 7,565 = 60,406,117: this run itself cost the 7,565 sat of fees in the table above.

## Log

```
   0 s  wallet page: https://wallet.9500.cash/, commit cd18348 of design-3, released 2026-11-20T21:13:24Z
   0 s  recoverer page: https://recoverer.9500.cash/, commit cd18348 of design-3, released 2026-11-20T21:13:24Z
   1 s  jar page: https://jar.9500.cash/, commit cd18348 of design-3, released 2026-11-20T21:13:24Z
   1 s  funding address: 60018096 satoshis in 1 coin at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   1 s     the run starts after block 340146; the jar page is at https://jar.9500.cash/, on chipnet
   1 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   3 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
  12 s     Anna's balance is funded at bchtest:qz73hjc838dxmj0m3jez8lfd503gc5yn3yal973et0; what her page keeps, her words among it, is copied to .chipnet/stage-17-jar-browser-chipnet/storage-recoverer.json first
  13 s     paid 400000 satoshis in a13c094a214b497d1442df45be63d8059c6ecda539fdf9b77d6b6f38629d2eaa:0, unconfirmed
  20 s     Anna's page shows her balance: 400000 satoshis
  20 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  20 s     Anna's code carries her name, her key and a session, 283 characters
  24 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  31 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  31 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  31 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  31 s     From "Set it up" to "Your wallet is ready": 7 s; the chain is at height 340146; not in a block yet: the recoverer's payment that defines the identity a13c094a214b…, the creation c04a3b7f4e30…; in a block: 0 of the 2 transactions looked at.
  31 s     Anna's page says the wallet is set up and keeps what a recovery needs
  31 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  31 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  32 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  32 s     From "Set it up" to "Protected", recovery on: 8 s; the chain is at height 340146; not in a block yet: the recoverer's payment that defines the identity a13c094a214b…, the creation c04a3b7f4e30…; in a block: 0 of the 2 transactions looked at.
  32 s  3. The owner receives
  32 s     address bchtest:rwfdc8x075v823fe8m595qzc4yrpflfcuy4mdkaa7yyj94hzq09lyjqhfj98y
  33 s     paid 50000 satoshis in a69574448c824774587846dc2cb5f9ba7b34f840a37187c7ba6a29c896ea0254:0, unconfirmed
  33 s     vault address bchtest:rvwaczvckrvj3nh06uz0k2qemctu5wxaxxp8ennclwptpv00xa3u20xzgkppq
  33 s     From "Set it up" to the vault address shown: 9 s; the chain is at height 340146; not in a block yet: the recoverer's payment that defines the identity a13c094a214b…, the creation c04a3b7f4e30…; in a block: 0 of the 2 transactions looked at.
  39 s     the wallet holds 0.0015 BCH
  39 s  4. The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it
  40 s     the Savings Jar page shows its connection address (77 characters) and waits for a wallet
  42 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 20, 2026, 10:25 PM; "Connected"
  42 s     the Savings Jar page: "Connected to Grandma's Wallet"
  42 s     the jar page lists: "No jars to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds."
  42 s     the chain's clock: last block 2026-11-20T21:25:26Z, median time 2026-11-20T21:18:08Z; this machine 2026-11-20T21:25:31Z
  42 s     the form says: "0.0003 BCH stays in the jar until Nov 20, 2026, 10:51 PM, 26 minutes from now." (the date 2026-11-20T21:51:00Z)
  44 s     the wallet's review of the page's request, every fold opened: "Savings Jar asks for your decision Its own name, not verified Asked Nov 20, 2026, 10:25 PM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT a695…0254 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT a695…0254 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. a6957444…ea0254 Opens on When the jar can be emptied, as a Unix time. 1795211460 Date on the key The same time, as it is written on the jar's key. c4c0006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20f92f…63f987 This wallet's own figures The fee, and all 3 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.0005 BCH · 50,000 sat Comes back to your wallet 0.00019523 BCH · 19,523 sat Goes into the application To its contracts and others, less what comes back from them 0.0003 BCH · 30,000 sat Network fee 477 bytes at one satoshi per byte 477 sat Your wallet goes down by 0.00030477 BCH · 30,477 sat Goes to others Savings jar · at aa2014…c8bb87 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token a6957444…ea0254 with c4c0006b What is left over, as change 0.00018523 BCH · 18,523 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. Pay into a savings jar Add savings to a jar. They stay there until the jar's date. Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Approve Decline Nothing is signed or sent unless you approve."
  44 s     (Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 20, 2026, 10:25 PM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT a695…0254 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT a695…0254 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. a6957444…ea0254 Opens on When the jar can be emptied, as a Unix time. 1795211460 Date on the key The same time, as it is written on the jar's key. c4c0006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20f92f…63f987 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve.")
  46 s     approved; the wallet: "Done: Open a savings jar", transaction fae1f401b3a5eafb31b2d7cc7577c82db3af0278b23d7e1f55db3f6191499f86
  48 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 20, 2026, 10:51 PM"
  51 s     the wallet's list: "Jar key · Savings Jar NFT · a6957444…ea0254 · c4c0006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"; key a69574448c824774587846dc2cb5f9ba7b34f840a37187c7ba6a29c896ea0254
  51 s     (On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · a6957444…ea0254 · c4c0006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `a69574448c824774587846dc2cb5f9ba7b34f840a37187c7ba6a29c896ea0254`; the jar's date 2026-11-20T21:51:00Z; its address `bchtest:pv2rmmh0vaat84dx3kk9znr4u5cf8k8dyp8juj2nz89eerakvtytkc32w5df7` (transaction `fae1f401b3a5eafb31b2d7cc7577c82db3af0278b23d7e1f55db3f6191499f86`).)
  52 s  5. The phone is lost
  52 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  52 s  6. A new phone takes the wallet over with Anna's help, and sweeps
  61 s     the new phone sent its request over the session of the code
  67 s     the request is in a block; the waiting period runs
1217 s     the recoverer's page shows the chain's clock at 10:40:40 PM, block 340168; the waiting period ends when it passes 10:47:34 PM
1217 s     the waiting period takes its real time
1687 s     completed; the hand-over is ready
1687 s     From the completion to the hand-over: 10 s; the chain is at height 340178.
1696 s     the hand-over reached the new phone over the session
1696 s     the recoverer's page says that the new phone has the wallet
1699 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
1699 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
1699 s     From the completion to the sweep sent by the new phone: 21 s; the chain is at height 340178; not in a block yet: "Moved 3 coins from earlier addresses" dec457330af4…, the completion abc1a9882b5c…; in a block: 3 of the 5 transactions looked at.
1764 s     the new phone holds 0.00116821 BCH
1764 s     From the completion to the swept coins in the new phone's wallet: 86 s; the chain is at height 340178; not in a block yet: "Moved 3 coins from earlier addresses" dec457330af4…, the completion abc1a9882b5c…; in a block: 3 of the 5 transactions looked at.
1764 s     recovery is on for the new phone
1764 s     From the completion to "Protected" on the new phone: 86 s.
1764 s  7. The new phone trusts the template from the backup and lists the jar from its record, confirmed
1766 s     the Applications screen lists the swept key: "Savings Jar NFT · a6957444…ea0254 · c4c0006b Template not trusted What it controls can't be shown here. ? Trust this template Send"
1766 s     (On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · a6957444…ea0254 · c4c0006b Template not trusted What it controls can't be shown here. ? Trust this template Send".)
1767 s     "A template from your backup": "An earlier owner of this wallet stored this template in the backup. It is not trusted on this phone until you say so. ? TEMPLATE Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Technical details Trust this template Back"
1769 s     trusted; the wallet's list: "Jar key · Savings Jar NFT · a6957444…ea0254 · c4c0006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"
1769 s     (Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · a6957444…ea0254 · c4c0006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".)
1770 s  8. The jar's date passes; the new phone empties the jar from its own list, the jar page never opened
1770 s     the waiting period takes its real time
1770 s     the chain's median time is 2026-11-20T21:49:24Z; waiting for it to pass the jar's date 2026-11-20T21:51:00Z
1891 s     the chain's median time is 2026-11-20T21:52:36Z, past the jar's date 2026-11-20T21:51:00Z
1895 s     "Empty a savings jar", from the wallet's own list, every fold opened: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 20, 2026, 10:51 PM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. a6957444…ea0254 Opens on When the jar can be emptied, as a Unix time. 1795211460 Date on the key The same time, as it is written on the jar's key. c4c0006b Key holder Where the jar's key goes: an address of the wallet. aa20e2ca…fba487 This wallet's own figures The fee, and all 4 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.00001 BCH · 1,000 sat Comes back to your wallet 0.0003048 BCH · 30,480 sat Comes back from the application Out of its contracts, more than goes into them 0.0003 BCH · 30,000 sat Network fee 520 bytes at one satoshi per byte 520 sat Your wallet goes up by 0.0002948 BCH · 29,480 sat Your tokens it spends A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token a6957444…ea0254 with c4c0006b The application's coins it spends Read from the chain by this wallet. None of them is yours. Savings jar · fae1f4…86:0 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token a6957444…ea0254 with c4c0006b What is left over, as change 0.0002948 BCH · 29,480 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. It has come back once A token made with it led to its position after a recovery. This is no audit of its contracts. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Carry it out Back Nothing is signed or sent until you carry it out."
1895 s     (From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 20, 2026, 10:51 PM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. a6957444…ea0254 Opens on When the jar can be emptied, as a Unix time. 1795211460 Date on the key The same time, as it is written on the jar's key. c4c0006b Key holder Where the jar's key goes: an address of the wallet. aa20e2ca…fba487 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out.")
1897 s     done: 041364a2197f2140b50203a48cc1a138ae6f648d5d808f378bf2c16479ba799c
1900 s     the wallet's list: "Jar key · Savings Jar NFT · a6957444…ea0254 · c4c0006b Closed It holds nothing now. Send"
1901 s     (The jar was emptied by the new phone from its own list of positions (transaction `041364a2197f2140b50203a48cc1a138ae6f648d5d808f378bf2c16479ba799c`), with the Savings Jar page never opened on it: of the 183 requests its browser made up to then, none went to the jar page's origin https://jar.9500.cash. The list then showed the jar as "Closed", "It holds nothing now.".)
1901 s  9. The coins go back to where they came from
1904 s     the new phone sent everything to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u; tokens stay where they are, so the jar's key stays in the wallet
1908 s     Anna sent her balance back: Sent 0.00296477 BCH · 296,477 sat to qphf9jdtnr…y9q77u. The fee was 185 sat.
1910 s  record written to docs/runs/stage-17-jar-browser-chipnet.md
   2 s  record written to docs/runs/stage-17-jar-browser-chipnet.md
   2 s  record written to docs/runs/stage-17-jar-browser-chipnet.md
```
