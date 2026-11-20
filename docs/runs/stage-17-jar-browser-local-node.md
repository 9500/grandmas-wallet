# Stage 17 in browsers on the local node: the Savings Jar from its template alone, through the loss of a phone (PR19)

Written by `scripts/stage-17-jar-browser.ts --screens` on 2026-11-20 18:46 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.local-runs/stage-17-jar-browser/`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds (`deploy/preview.sh build`) served by `deploy/serve.mjs` with the content security policy at http://localhost:8301/, http://localhost:8302/ and http://localhost:8303/, against the regtest node, with two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet reads no recovery declaration: the Savings Jar reached it as its template of version 4, in the page's requests of `xo_v1` version 2. Times in the log are seconds since the start.

Outcome: every step was carried out.

What the run showed:

- Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 20, 2026, 7:47 PM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 5660…61bd Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 5660…61bd This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 5660c364…bb61bd Opens on When the jar can be emptied, as a Unix time. 1795205040 Date on the key The same time, as it is written on the jar's key. b0a7006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa202fa2…010787 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve."
- On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · 5660c364…bb61bd · b0a7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `5660c364b25a08097baacbab0a34c3873a63adff18a196649caa1bfdd5bb61bd`; the jar's date 2026-11-20T20:04:00Z; its address `bchreg:p0cefz0us9xgesn84kjqgre8rck2pc2ty83af96qe25ujk70eksa76zgqvygx` (transaction `a424da7b68e48e1c9dbfe7175d490ae725dec5f6c1345ccf8976bc3f2ef2e29c`).
- On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · 5660c364…bb61bd · b0a7006b Template not trusted What it controls can't be shown here. ? Trust this template Send".
- Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · 5660c364…bb61bd · b0a7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".
- From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 20, 2026, 9:04 PM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 5660c364…bb61bd Opens on When the jar can be emptied, as a Unix time. 1795205040 Date on the key The same time, as it is written on the jar's key. b0a7006b Key holder Where the jar's key goes: an address of the wallet. aa209622…58dd87 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out."
- The jar was emptied by the new phone from its own list of positions (transaction `c0b66600b959593bdfe31137e87576f1ae6f753d2f699454e1c82677b0861ec4`), with the Savings Jar page never opened on it: of the 163 requests its browser made up to then, none went to the jar page's origin http://localhost:8303. The list then showed the jar as "Closed", "It holds nothing now.".

## The new phone's requests

Every request the new phone's browser made, from the moment its profile was made until the end of the run, recorded by Playwright for every page of the profile (requests of the pages and of their workers, and web sockets): 204 in all.

| Origin | Requests | What was asked |
| --- | --- | --- |
| http://localhost:8301 | 38 | `/`, `/assets/index-DqsZxmku.js`, `/assets/rolldown-runtime-BYOrzxDO.js`, `/assets/path-browserify-cMkRY8gI.js`, `/assets/preload-helper-7y9sWmk5.js`, `/assets/__vite-browser-external-BnCWfpkB.js`, `/assets/index-B5x4ge8c.css`, `/config.json`, and 5 more |
| ws://127.0.0.1:60403 | 16 | `/` |
| blob: | 1 | `(the whole address)` |
| http://localhost:8311 | 74 | `/v1/archives/d711144281e00156ed680175edfe85ed/blobs`, `/v1/archives/d711144281e00156ed680175edfe85ed/blobs/46872ccc31d67bf0eb13aa94ed7b0071deb695dad41f8bfe9a3feb6775ae2696`, `/v1/archives/d711144281e00156ed680175edfe85ed/blobs/c75a1f8a9427b1efd0b1361d2fd1cae2cb1d80fe1fbe42e6b64fe44aa223cd6d`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs/085c18b7b0ad195049c6473b8873be1dce7ca1e57cfe1f6b11b8022be73483eb`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs/3d7fe6e2e12edf7fb14020336d0b72850e283233d5cd9e75e0bc996acac686d7`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs/4d3f5f19b172821c3c657222a3100d458b738a7eb6039a22954a15ac05c35b7b`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs/c7803f8691a5c883c4bf87c1a35ec3cacb9ea1f3245b5f70a7c39f2d83bec8a7`, and 4 more |
| http://localhost:8312 | 74 | `/v1/archives/d711144281e00156ed680175edfe85ed/blobs`, `/v1/archives/d711144281e00156ed680175edfe85ed/blobs/46872ccc31d67bf0eb13aa94ed7b0071deb695dad41f8bfe9a3feb6775ae2696`, `/v1/archives/d711144281e00156ed680175edfe85ed/blobs/c75a1f8a9427b1efd0b1361d2fd1cae2cb1d80fe1fbe42e6b64fe44aa223cd6d`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs/085c18b7b0ad195049c6473b8873be1dce7ca1e57cfe1f6b11b8022be73483eb`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs/3d7fe6e2e12edf7fb14020336d0b72850e283233d5cd9e75e0bc996acac686d7`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs/4d3f5f19b172821c3c657222a3100d458b738a7eb6039a22954a15ac05c35b7b`, `/v1/archives/e88101844008e747bfe07f837aaafe11/blobs/c7803f8691a5c883c4bf87c1a35ec3cacb9ea1f3245b5f70a7c39f2d83bec8a7`, and 4 more |
| ws://127.0.0.1:38339 | 1 | `/` |

None went to the Savings Jar page (http://localhost:8303).

## Transactions and coins

Read from the local node after the run: every transaction in the blocks after height 680, where the run started, and in the node's pool. The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.

| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The local payer pays | `f3ae6ba5a7b998443b0b9221dacd8f04c18d334717f9c549953b1180fe67ba60` | 681 | 219 | 219 | 1.00 |
| 2 | The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance | `6422837b91f90efc19cdcb7586ba724351532d48d8b2c3453487e0da25eba1cd` | 682 | 377 | 377 | 1.00 |
| 3 | The local payer pays | `5660c364b25a08097baacbab0a34c3873a63adff18a196649caa1bfdd5bb61bd` | 683 | 229 | 229 | 1.00 |
| 4 | The owner's phone opens the jar, on the Savings Jar page's request (30,000 sat into the jar, the key to the wallet) | `a424da7b68e48e1c9dbfe7175d490ae725dec5f6c1345ccf8976bc3f2ef2e29c` | 684 | 477 | 477 | 1.00 |
| 5 | The recoverer asks to move the wallet to the new phone's key (the controller's request), paid from her balance | `84f285f8e0ca4e39ad0ca6dedf057a5ad925a740876bb6716e4921a92634feb1` | 685 | 991 | 991 | 1.00 |
| 6 | The new phone: Moved 3 coins from earlier addresses | `18986ce0ace7a6c8c9277b75e3c9221de7d1865dccb954e65925383f9423f326` | 697 | 1702 | 1702 | 1.00 |
| 7 | The recoverer completes the move after the waiting period, paid from her balance | `d30deb3de3e58cba34a7943173448a7ed2116fe3c4d3b526785ec6d71aa657bc` | 697 | 970 | 970 | 1.00 |
| 8 | The new phone empties the jar by itself, from its own list (the key at input 0, the key and the savings to the new seed) | `c0b66600b959593bdfe31137e87576f1ae6f753d2f699454e1c82677b0861ec4` | 712 | 520 | 520 | 1.00 |
| 9 | The new phone: Sent everything to qqg3zyg3zy…jfagm9 | `693d1edfba976cfa223fa5c7c0ac34f863fa0b1f721d0d8a0001efe85c9e4073` | 713 | 636 | 636 | 1.00 |
| 10 | The recoverer sends her balance back | `2898f087947f198048ef76495790326092b7d983f924a48538a41c774ebb795e` | 714 | 185 | 185 | 1.00 |

10 transactions, 6306 bytes, 6,306 sat in fees.

What came into the run, from coins no transaction of the run made:

- 2,376,197,750 sat from the local payer (`scripts/local-pay.ts`)

Where every coin went: the outputs of the run that nothing has spent, by whose they are:

| Where | Coins | Value | Tokens on them |
| --- | --- | --- | --- |
| the local payer (`scripts/local-pay.ts`) | 1 | 2,375,747,302 sat |  |
| the wallet's controller (its identity token) | 1 | 1,000 sat | an NFT (mutable, commitment 0100010000003b58…) of category f3ae6ba5a7b9… |
| an address of the new phone's seed | 1 | 1,000 sat | an NFT (none, commitment b0a7006b) of category 5660c364b25a… |
| the outside address the coins went back to (bchreg:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy8lyg7mcr) | 2 | 442,142 sat |  |

2,376,197,750 sat came in; 2,376,191,444 sat is in these outputs and 6,306 sat went to fees, which adds up.

## Pictures

In `docs/screens/`, each at 390×844 (`-phone`) and 1280×800 (`-desktop`): `live-jar-open-review`, `live-jar-page-opened`, `live-jar-positions-owner`, `live-jar-new-phone-untrusted`, `live-jar-trust-from-backup`, `live-jar-positions-after-recovery`, `live-jar-empty-review`, `live-jar-emptied-done`, `live-jar-positions-emptied`.

## Log

```
   0 s  local node: node: running, block 680, median time 2026-11-20T19:38:02Z
   0 s  relay: ws://127.0.0.1:38339, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8301/, this checkout at 295a0bc, regtest
   1 s  recoverer page: http://localhost:8302/, this checkout at 295a0bc, regtest
   1 s  jar page: http://localhost:8303/, this checkout at 295a0bc, regtest
   1 s     the run starts after block 680; the jar page is at http://localhost:8303/, on regtest
   1 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   2 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
   3 s     Anna's balance is funded at bchtest:qz72kz0g57px355v7u737a0lgegpxtnk35cjmrjd4l; what her page keeps, her words among it, is copied to .local-runs/stage-17-jar-browser/storage-recoverer.json first
   4 s     paid 400000 satoshis in f3ae6ba5a7b998443b0b9221dacd8f04c18d334717f9c549953b1180fe67ba60:0, confirmed at height 681
  11 s     Anna's page shows her balance: 400000 satoshis
  11 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  11 s     Anna's code carries her name, her key and a session, 291 characters
  12 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  13 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  14 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  14 s     From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 681; not in a block yet: the creation 6422837b91f9…; in a block: 1 of the 2 transactions looked at.
  14 s     Anna's page says the wallet is set up and keeps what a recovery needs
  19 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  29 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  29 s     From "Set it up" to "Protected", recovery on: 17 s; the chain is at height 681; not in a block yet: the creation 6422837b91f9…; in a block: 1 of the 2 transactions looked at.
  30 s  3. The owner receives
  30 s     address bchtest:r0zlevuz2fs8wfp40j7wauyvdph78aalpp90ye8p35xxmfr9r7czq99a072ra
  30 s     paid 50000 satoshis in 5660c364b25a08097baacbab0a34c3873a63adff18a196649caa1bfdd5bb61bd:0, confirmed at height 683
  31 s     vault address bchtest:rvxc4h84hylcdqp0677veu7udqrgvx7q0uzktfc7cjacz8fhdhzq6lyc3ed6z
  31 s     From "Set it up" to the vault address shown: 18 s; the chain is at height 683; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  38 s     the wallet holds 0.0015 BCH
  38 s  4. The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it
  38 s     the Savings Jar page shows its connection address (98 characters) and waits for a wallet
  38 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through 127.0.0.1:38339 · since Nov 20, 2026, 7:47 PM; "Connected"
  38 s     the Savings Jar page: "Connected to Grandma's Wallet"
  38 s     the jar page lists: "No jars to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds."
  38 s     the chain's clock: last block 2026-11-20T19:38:03Z, median time 2026-11-20T19:38:02Z; this machine 2026-11-20T18:47:16Z
  38 s     the form says: "0.0003 BCH stays in the jar until Nov 20, 2026, 9:04 PM, 77 minutes from now." (the date 2026-11-20T20:04:00Z)
  40 s     the wallet's review of the page's request, every fold opened: "Savings Jar asks for your decision Its own name, not verified Asked Nov 20, 2026, 7:47 PM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 5660…61bd Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 5660…61bd This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 5660c364…bb61bd Opens on When the jar can be emptied, as a Unix time. 1795205040 Date on the key The same time, as it is written on the jar's key. b0a7006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa202fa2…010787 This wallet's own figures The fee, and all 3 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.0005 BCH · 50,000 sat Comes back to your wallet 0.00019523 BCH · 19,523 sat Goes into the application To its contracts and others, less what comes back from them 0.0003 BCH · 30,000 sat Network fee 477 bytes at one satoshi per byte 477 sat Your wallet goes down by 0.00030477 BCH · 30,477 sat Goes to others Savings jar · at aa20f1…a1df87 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 5660c364…bb61bd with b0a7006b What is left over, as change 0.00018523 BCH · 18,523 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. Pay into a savings jar Add savings to a jar. They stay there until the jar's date. Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Approve Decline Nothing is signed or sent unless you approve."
  40 s     (Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 20, 2026, 7:47 PM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 5660…61bd Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 5660…61bd This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 5660c364…bb61bd Opens on When the jar can be emptied, as a Unix time. 1795205040 Date on the key The same time, as it is written on the jar's key. b0a7006b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa202fa2…010787 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve.")
  42 s     approved; the wallet: "Done: Open a savings jar", transaction a424da7b68e48e1c9dbfe7175d490ae725dec5f6c1345ccf8976bc3f2ef2e29c
  44 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 20, 2026, 9:04 PM"
  46 s     the wallet's list: "Jar key · Savings Jar NFT · 5660c364…bb61bd · b0a7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"; key 5660c364b25a08097baacbab0a34c3873a63adff18a196649caa1bfdd5bb61bd
  46 s     (On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · 5660c364…bb61bd · b0a7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `5660c364b25a08097baacbab0a34c3873a63adff18a196649caa1bfdd5bb61bd`; the jar's date 2026-11-20T20:04:00Z; its address `bchreg:p0cefz0us9xgesn84kjqgre8rck2pc2ty83af96qe25ujk70eksa76zgqvygx` (transaction `a424da7b68e48e1c9dbfe7175d490ae725dec5f6c1345ccf8976bc3f2ef2e29c`).)
  47 s  5. The phone is lost
  47 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  47 s  6. A new phone takes the wallet over with Anna's help, and sweeps
  51 s     the new phone sent its request over the session of the code
  58 s     the request is in a block; the waiting period runs
  58 s     the recoverer's page shows the chain's clock at 08:38:02 PM, block 685; the waiting period ends when it passes 08:46:34 PM
  59 s     the chain's clock moved on by 700 seconds; height 696
  63 s     the chain's clock on the page moved on by 701 seconds, to block 696
  79 s     completed; the hand-over is ready
  79 s     From the completion to the hand-over: 10 s; the chain is at height 696.
  79 s     the hand-over reached the new phone over the session
  79 s     the recoverer's page says that the new phone has the wallet
  81 s     From the completion to the sweep sent by the new phone: 13 s; the chain is at height 697; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  82 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
  91 s     the new phone holds 0.00116821 BCH
  91 s     From the completion to the swept coins in the new phone's wallet: 22 s; the chain is at height 700; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  91 s     recovery is on for the new phone
  91 s     From the completion to "Protected" on the new phone: 22 s.
  91 s  7. The new phone trusts the template from the backup and lists the jar from its record, confirmed
  91 s     the Applications screen lists the swept key: "Savings Jar NFT · 5660c364…bb61bd · b0a7006b Template not trusted What it controls can't be shown here. ? Trust this template Send"
  91 s     (On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · 5660c364…bb61bd · b0a7006b Template not trusted What it controls can't be shown here. ? Trust this template Send".)
  92 s     "A template from your backup": "An earlier owner of this wallet stored this template in the backup. It is not trusted on this phone until you say so. ? TEMPLATE Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Technical details Trust this template Back"
  93 s     trusted; the wallet's list: "Jar key · Savings Jar NFT · 5660c364…bb61bd · b0a7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"
  93 s     (Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · 5660c364…bb61bd · b0a7006b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".)
  94 s  8. The jar's date passes; the new phone empties the jar from its own list, the jar page never opened
  95 s     the chain's clock moved on by 975 seconds; height 711
  95 s     the chain's median time is 2026-11-20T20:06:00Z, past the jar's date 2026-11-20T20:04:00Z
  97 s     "Empty a savings jar", from the wallet's own list, every fold opened: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 20, 2026, 9:04 PM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 5660c364…bb61bd Opens on When the jar can be emptied, as a Unix time. 1795205040 Date on the key The same time, as it is written on the jar's key. b0a7006b Key holder Where the jar's key goes: an address of the wallet. aa209622…58dd87 This wallet's own figures The fee, and all 4 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.00001 BCH · 1,000 sat Comes back to your wallet 0.0003048 BCH · 30,480 sat Comes back from the application Out of its contracts, more than goes into them 0.0003 BCH · 30,000 sat Network fee 520 bytes at one satoshi per byte 520 sat Your wallet goes up by 0.0002948 BCH · 29,480 sat Your tokens it spends A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 5660c364…bb61bd with b0a7006b The application's coins it spends Read from the chain by this wallet. None of them is yours. Savings jar · a424da…9c:0 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 5660c364…bb61bd with b0a7006b What is left over, as change 0.0002948 BCH · 29,480 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. It has come back once A token made with it led to its position after a recovery. This is no audit of its contracts. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Carry it out Back Nothing is signed or sent until you carry it out."
  97 s     (From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 20, 2026, 9:04 PM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 5660c364…bb61bd Opens on When the jar can be emptied, as a Unix time. 1795205040 Date on the key The same time, as it is written on the jar's key. b0a7006b Key holder Where the jar's key goes: an address of the wallet. aa209622…58dd87 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out.")
  97 s     done: c0b66600b959593bdfe31137e87576f1ae6f753d2f699454e1c82677b0861ec4
  99 s     the wallet's list: "Jar key · Savings Jar NFT · 5660c364…bb61bd · b0a7006b Closed It holds nothing now. Send"
 100 s     (The jar was emptied by the new phone from its own list of positions (transaction `c0b66600b959593bdfe31137e87576f1ae6f753d2f699454e1c82677b0861ec4`), with the Savings Jar page never opened on it: of the 163 requests its browser made up to then, none went to the jar page's origin http://localhost:8303. The list then showed the jar as "Closed", "It holds nothing now.".)
 100 s  9. The coins go back to where they came from
 100 s     the new phone sent everything to bchtest:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyarjfagm9; tokens stay where they are, so the jar's key stays in the wallet
 103 s     Anna sent her balance back: Sent 0.00296477 BCH · 296,477 sat to qqg3zyg3zy…jfagm9. The fee was 185 sat.
```
