# Stage 17 in browsers on chipnet (run G): the Savings Jar from its template alone, through the loss of a phone (PR19)

Written by `scripts/stage-17-jar-browser.ts chipnet --within 35` on 2026-11-21 02:12 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/stage-17-jar-browser-chipnet/`; the Savings Jar page is a second tab of the phone that uses it. The pages are the public ones, https://wallet.9500.cash/, https://recoverer.9500.cash/, https://jar.9500.cash/, as served, on chipnet with the public backup stores. Blocks, the waiting period and the jar's date took their real time; the coins came from the funding address and went back to it. Served from: https://wallet.9500.cash/ commit cd02fd3 of main, released 2026-11-21T01:42:50Z; https://recoverer.9500.cash/ commit cd02fd3 of main, released 2026-11-21T01:42:50Z; https://jar.9500.cash/ commit cd02fd3 of main, released 2026-11-21T01:42:50Z. The wallet reads no recovery declaration: the Savings Jar reached it as its template of version 4, in the page's requests of `xo_v1` version 2. Times in the log are seconds since the start.

Outcome: every step was carried out.

What the run showed:

- Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 3:13 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 3179…78b4 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 3179…78b4 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 31793454…1b78b4 Opens on When the jar can be emptied, as a Unix time. 1795228740 Date on the key The same time, as it is written on the jar's key. 4404016b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20278c…769e87 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve."
- On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · 31793454…1b78b4 · 4404016b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `31793454da2a93096588ded46200372ab8cc1527e854d60dc8c17d2ee41b78b4`; the jar's date 2026-11-21T02:39:00Z; its address `bchtest:p0s6st2h0v0v9wgws2lfxrstmfy53fulwlc6v448vlycf5kxrjrucr3gr5p4a` (transaction `8f69b0f4ed66032a5d9462e2f8fa7f56e7c1fbb22397f9f991e32bf899f7761d`).
- On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · 31793454…1b78b4 · 4404016b Template not trusted What it controls can't be shown here. ? Trust this template Send".
- Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · 31793454…1b78b4 · 4404016b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".
- From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 3:39 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 31793454…1b78b4 Opens on When the jar can be emptied, as a Unix time. 1795228740 Date on the key The same time, as it is written on the jar's key. 4404016b Key holder Where the jar's key goes: an address of the wallet. aa206b0f…cffe87 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out."
- The jar was emptied by the new phone from its own list of positions (transaction `66b4dcab51c5ab98a0b4a3d2182c8207bed57f573792953d006b4a474597a564`), with the Savings Jar page never opened on it: of the 286 requests its browser made up to then, none went to the jar page's origin https://jar.9500.cash. The list then showed the jar as "Closed", "It holds nothing now.".

## The new phone's requests

Every request the new phone's browser made, from the moment its profile was made until the end of the run, recorded by Playwright for every page of the profile (requests of the pages and of their workers, and web sockets): 331 in all.

| Origin | Requests | What was asked |
| --- | --- | --- |
| https://wallet.9500.cash | 47 | `/`, `/assets/index-DjHWdFYN.js`, `/assets/rolldown-runtime-BYOrzxDO.js`, `/assets/path-browserify-cMkRY8gI.js`, `/assets/preload-helper-7y9sWmk5.js`, `/assets/__vite-browser-external-BnCWfpkB.js`, `/assets/index-RO6nObWw.css`, `/config.json`, and 5 more |
| wss://chipnet.9500.cash | 15 | `/` |
| wss://chipnet.imaginary.cash:50004 | 5 | `/` |
| blob: | 1 | `(the whole address)` |
| https://store1.9500.cash | 130 | `/v1/archives/ab013bd854812affbce14ea44d39bbdc/blobs`, `/v1/archives/ab013bd854812affbce14ea44d39bbdc/blobs/2281b4651457262786979087f00b94b146cde832a793dc014bc110071565d178`, `/v1/archives/ab013bd854812affbce14ea44d39bbdc/blobs/ce1c81839a2f849da6188e41e26411a0fc9b501e556ca4a08de2a1dcfb33fba6`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs/4e13d9c4ec701eb31a06b7bb37c11926db5a245aa896e2222cd656df44af1691`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs/52a251b3906ad1406f074b677ce2185def9567a8f224d54f6cd81d2b6b107b3a`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs/6da289ec3bfba8d2a3a3cc04bc4528d91db24bbd77da9f3a697fdacbe9fdb096`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs/d9c2b84728188df797d2d9bb50dfec9b584e5f13b7cc5b2103225fed0cb069ff`, and 5 more |
| https://store2.9500.cash | 131 | `/v1/archives/ab013bd854812affbce14ea44d39bbdc/blobs`, `/v1/archives/ab013bd854812affbce14ea44d39bbdc/blobs/2281b4651457262786979087f00b94b146cde832a793dc014bc110071565d178`, `/v1/archives/ab013bd854812affbce14ea44d39bbdc/blobs/ce1c81839a2f849da6188e41e26411a0fc9b501e556ca4a08de2a1dcfb33fba6`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs/4e13d9c4ec701eb31a06b7bb37c11926db5a245aa896e2222cd656df44af1691`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs/52a251b3906ad1406f074b677ce2185def9567a8f224d54f6cd81d2b6b107b3a`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs/6da289ec3bfba8d2a3a3cc04bc4528d91db24bbd77da9f3a697fdacbe9fdb096`, `/v1/archives/d8b991ba46d546954b5d877b7270e106/blobs/d9c2b84728188df797d2d9bb50dfec9b584e5f13b7cc5b2103225fed0cb069ff`, and 5 more |
| wss://relay.riften.net | 1 | `/` |
| wss://relay.cauldron.quest | 1 | `/` |

None went to the Savings Jar page (https://jar.9500.cash).

## Transactions and coins

Read from chipnet's server after the run: every transaction in the blocks after height 340483, where the run started, or not yet in a block, that touches an address of the run (the wallet's addresses of both phones' seeds, its controller, the jar and the recoverer's balance). The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.

| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The funding address pays the run's key | `f282d8e9b2161f1336fceb5b609c7f1461c3ab196ccf2c23fefa959171a21900` | 340484 | 360 | 360 | 1.00 |
| 2 | The run's key pays the recoverer's balance | `d94b0aef262b76c3708377937dad20bd4edb25fdc51257ad87e32a206434d89e` | 340485 | 219 | 219 | 1.00 |
| 3 | The run's key pays the owner's wallet | `31793454da2a93096588ded46200372ab8cc1527e854d60dc8c17d2ee41b78b4` | 340485 | 229 | 229 | 1.00 |
| 4 | The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance | `f750ee1412a6c80f9377e37ae8fc9df23989f99ef64ad68140ed7076dfe3dc7e` | 340485 | 377 | 377 | 1.00 |
| 5 | The owner's phone opens the jar, on the Savings Jar page's request (30,000 sat into the jar, the key to the wallet) | `8f69b0f4ed66032a5d9462e2f8fa7f56e7c1fbb22397f9f991e32bf899f7761d` | 340486 | 477 | 477 | 1.00 |
| 6 | The recoverer asks to move the wallet to the new phone's key (the controller's request), paid from her balance | `cbeb00eae3f0a68d2ba35c667f07ff80afd89e92c5518c3af3696c9f124a77d4` | 340488 | 991 | 991 | 1.00 |
| 7 | The recoverer completes the move after the waiting period, paid from her balance | `8219618965a62387642ad7062b0c699e562089d6e4d638ef723b8474ed555b3a` | 340505 | 970 | 970 | 1.00 |
| 8 | The new phone: Moved 3 coins from earlier addresses | `5808846eda1599080f63dc7cbbfd89172f26d4780ca8c5dda5b4c57e7b93d064` | 340506 | 1702 | 1702 | 1.00 |
| 9 | The new phone empties the jar by itself, from its own list (the key at input 0, the key and the savings to the new seed) | `66b4dcab51c5ab98a0b4a3d2182c8207bed57f573792953d006b4a474597a564` | not in a block | 520 | 520 | 1.00 |
| 10 | The new phone: Sent everything to qphf9jdtnr…y9q77u | `71474df87c0e914ff8978b95f61984fa3a1a7e90ccfeca9cae9254fd35640dee` | not in a block | 636 | 636 | 1.00 |
| 11 | The recoverer sends her balance back | `b622c1f4911c2a42511c3a9cbc90803bd1fb37bf8f24de062343cba672ea5e40` | not in a block | 185 | 185 | 1.00 |
| 12 | The run's key sends what it holds back to the funding address | `6caf40467eb4ee1e014b1169e132f0aff98122adc3e053cae3b71d73819e8d05` | not in a block | 185 | 185 | 1.00 |

12 transactions, 6851 bytes, 6,851 sat in fees.

What came into the run, from coins no transaction of the run made:

- 60,255,216 sat from the outside address the coins went back to (bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u)

Where every coin went: the outputs that no transaction of the run spent, by whose they are (an output at the funding address may have been spent since by its next payment):

| Where | Coins | Value | Tokens on them |
| --- | --- | --- | --- |
| the outside address the coins went back to (bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u) | 4 | 60,246,365 sat |  |
| the wallet's controller (its identity token) | 1 | 1,000 sat | an NFT (mutable, commitment 010001000000c7f2…) of category d94b0aef262b… |
| an address of the new phone's seed | 1 | 1,000 sat | an NFT (none, commitment 4404016b) of category 31793454da2a… |

60,255,216 sat came in; 60,248,365 sat is in these outputs and 6,851 sat went to fees, which adds up.

## The wallet closed

The wallet `a13c094a214b497d1442df45be63d8059c6ecda539fdf9b77d6b6f38629d2eaa` was closed (transaction `05ef93663c68991b8041e61b22d5955040c20d279419becdded5f185b86dc9c2`, 977 bytes, fee 977 sat): its controller of 1,000 sat and 1,000 sat with the NFT of a69574448c82…, destroyed went to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u, where 1,023 sat arrived.

The funding address held 60,018,096 sat when the run started and 60,406,117 sat once its wallet was closed. In between it was also used by the Cashonize run on the public jar page ([its record](stage-17-jar-cashonize-chipnet.md), 2,875 sat in fees) and got back what a first attempt of this run had taken: that attempt, started at 21:17 UTC from the same commit's pages, stopped in step 2 because the course looked for the recoverer's "Grandma's wallet is set up" only after the phone said "ready", by which time her page had gone on to the next code (corrected in the course, commit `b9f275b`). Its wallet (`53fe97d2…e0`, 100,000 sat and its controller) was closed (`ed074dcd5af9e0c9e0a350ba9d887545e1330ab9c5d9024704ba68b8608d3d6d`, 977 bytes, fee 977 sat, 100,023 sat arrived) and its recoverer sent her balance back (`a04d119d64af0590398c821277757b07d267dec392696c7f218d859f854a9eca`, fee 185 sat, 298,438 sat arrived): it cost 2,040 sat. Its profiles are kept in `.chipnet/stage-17-jar-browser-first-chipnet/`. 60,018,096 + 398,461 − 2,875 − 7,565 = 60,406,117: this run itself cost the 7,565 sat of fees in the table above.

## Log

```
   0 s  the run's bound: 35 minutes, until 02:47:49 UTC (--within)
   1 s  wallet page: https://wallet.9500.cash/, commit cd02fd3 of main, released 2026-11-21T01:42:50Z
   1 s  recoverer page: https://recoverer.9500.cash/, commit cd02fd3 of main, released 2026-11-21T01:42:50Z
   1 s  jar page: https://jar.9500.cash/, commit cd02fd3 of main, released 2026-11-21T01:42:50Z
   2 s  funding address: 59795401 satoshis in 1 coin at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   3 s  an earlier run's key: back to the funding address bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u: paid 459815 satoshis in 1f84b5aad2aff40bad36367eb6b57a6f80846e4abd50af9d24b5028ec3884a13:0 from bchtest:qqk49p8vwfg78vlpyzy0pp049es3a3048cezqcetrn, unconfirmed
   3 s  about to make the run's key in .chipnet/stage-17-jar-browser-chipnet/run-key.json and pay it 460000 satoshis from the funding address
   5 s  the run's key bchtest:qpv6nfav99697tyeuhrr0f3ddscvd75s3cgkhf5k6c: paid 460000 satoshis in f282d8e9b2161f1336fceb5b609c7f1461c3ab196ccf2c23fefa959171a21900:0, unconfirmed; the key is kept in .chipnet/stage-17-jar-browser-chipnet/run-key.json
   5 s     the run starts after block 340483; the jar page is at https://jar.9500.cash/, on chipnet
   5 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
  17 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
  32 s     Anna's balance is funded at bchtest:qqh44f7j7nl7xk6qnxtsum35q4etemwvryza5tynmj; what her page keeps, her words among it, is copied to .chipnet/stage-17-jar-browser-chipnet/storage-recoverer.json first
  32 s     about to pay 400000 satoshis from the run's key to bchtest:qqh44f7j7nl7xk6qnxtsum35q4etemwvryza5tynmj
  33 s     paid 400000 satoshis in d94b0aef262b76c3708377937dad20bd4edb25fdc51257ad87e32a206434d89e:0 from bchtest:qpv6nfav99697tyeuhrr0f3ddscvd75s3cgkhf5k6c, unconfirmed
  33 s     waiting for the payment to reach Anna's balance on her page: at most 1 min, until 02:14:22 UTC
  41 s     the payment to reach Anna's balance on her page: after 8 s
  41 s     Anna's page shows her balance: 400000 satoshis
  41 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  41 s     Anna's code carries her name, her key and a session, 280 characters
  45 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  45 s     about to say yes on Anna's page ("Set up Grandma's wallet On their phone they open the wallet, tap "Someone I trust is setting it up" and scan this code. Set up Grandma's wallet with 0.001 BCH · 100,000 sat? It is paid from your balance. Their phone is waiting. Set it up No The code as text New wallets get 0.001 BCH · 100,000 sat an"): her page creates the wallet from her balance and sends it
  53 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  53 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  54 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  54 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  54 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  54 s     From "Set it up" to "Your wallet is ready": 9 s; the chain is at height 340484; not in a block yet: the recoverer's payment that defines the identity d94b0aef262b…, the creation f750ee1412a6…; in a block: 0 of the 2 transactions looked at.
  54 s     Anna's page says the wallet is set up and keeps what a recovery needs
  54 s     waiting for the wallet to show "Protected": Anna's receipt read from the backup stores: at most 1 min, until 02:14:43 UTC
  55 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  55 s     From "Set it up" to "Protected", recovery on: 10 s; the chain is at height 340484; not in a block yet: the recoverer's payment that defines the identity d94b0aef262b…, the creation f750ee1412a6…; in a block: 0 of the 2 transactions looked at.
  55 s  3. The owner receives
  55 s     address bchtest:rwg46px4ag2erjstselcwenwy0ydeaj5nuh4w6k03udw2wyuasp9cgm3pme6k
  55 s     about to pay 50000 satoshis from the run's key to bchtest:rwg46px4ag2erjstselcwenwy0ydeaj5nuh4w6k03udw2wyuasp9cgm3pme6k
  56 s     paid 50000 satoshis in 31793454da2a93096588ded46200372ab8cc1527e854d60dc8c17d2ee41b78b4:0 from bchtest:qpv6nfav99697tyeuhrr0f3ddscvd75s3cgkhf5k6c, unconfirmed
  56 s     vault address bchtest:rdgmfv432ndfqcmjw7mqwv63y37favj8cn53srjm4vurq3gketw5zaun5044w
  57 s     From "Set it up" to the vault address shown: 12 s; the chain is at height 340484; not in a block yet: the recoverer's payment that defines the identity d94b0aef262b…, the creation f750ee1412a6…; in a block: 0 of the 2 transactions looked at.
  57 s     waiting for the payment of 50,000 satoshis to reach the wallet's balance (more than 0.0014 BCH): at most 1 min, until 02:14:45 UTC
  63 s     the payment of 50,000 satoshis to reach the wallet's balance (more than 0.0014 BCH): after 6 s
  63 s     the wallet holds 0.0015 BCH
  63 s  4. The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it
  63 s     the Savings Jar page shows its connection address (77 characters) and waits for a wallet
  65 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 21, 2026, 3:13 AM; "Connected"
  65 s     the Savings Jar page: "Connected to Grandma's Wallet"
  65 s     waiting for the Savings Jar page to look for jars: at most 1 min, until 02:14:54 UTC
  66 s     the jar page lists: "No jars to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds."
  67 s     the chain's clock: last block 2026-11-21T02:13:19Z, median time 2026-11-21T02:07:53Z; this machine 2026-11-21T02:13:55Z
  67 s     the form says: "0.0003 BCH stays in the jar until Nov 21, 2026, 3:39 AM, 25 minutes from now." (the date 2026-11-21T02:39:00Z)
  67 s     the wallet's review of the page's request, every fold opened: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 3:13 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 3179…78b4 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 3179…78b4 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 31793454…1b78b4 Opens on When the jar can be emptied, as a Unix time. 1795228740 Date on the key The same time, as it is written on the jar's key. 4404016b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20278c…769e87 This wallet's own figures The fee, and all 3 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.0005 BCH · 50,000 sat Comes back to your wallet 0.00019523 BCH · 19,523 sat Goes into the application To its contracts and others, less what comes back from them 0.0003 BCH · 30,000 sat Network fee 477 bytes at one satoshi per byte 477 sat Your wallet goes down by 0.00030477 BCH · 30,477 sat Goes to others Savings jar · at aa20e1…87cc87 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 31793454…1b78b4 with 4404016b What is left over, as change 0.00018523 BCH · 18,523 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. Pay into a savings jar Add savings to a jar. They stay there until the jar's date. Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Approve Decline Nothing is signed or sent unless you approve."
  67 s     (Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 3:13 AM Your wallet From your wallet to Savings Jar: 0.0003 BCH From Savings Jar to your wallet: NFT 3179…78b4 Savings Jar Your wallet goes down by ? −0.00030477BCH 30,477 sat, the network fee of 477 sat included Your wallet receives NFT 3179…78b4 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 30000 satoshis. Jar key The token category of the jar's key. 31793454…1b78b4 Opens on When the jar can be emptied, as a Unix time. 1795228740 Date on the key The same time, as it is written on the jar's key. 4404016b Amount to save Satoshis to put into the jar. 30000 Key holder Where the jar's key goes: an address of the wallet. aa20278c…769e87 This wallet's own figures The fee, and all 3 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve.")
  67 s     about to approve: the wallet writes its records to the backup stores, then signs the opening of the jar and sends it
  72 s     approved; the wallet: "Done: Open a savings jar", transaction 8f69b0f4ed66032a5d9462e2f8fa7f56e7c1fbb22397f9f991e32bf899f7761d
  74 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 21, 2026, 3:39 AM"
  74 s     waiting for the wallet to list the jar from its record, read against the chain: at most 1 min, until 02:15:02 UTC
  76 s     the wallet's list: "Jar key · Savings Jar NFT · 31793454…1b78b4 · 4404016b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"; key 31793454da2a93096588ded46200372ab8cc1527e854d60dc8c17d2ee41b78b4
  76 s     (On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · 31793454…1b78b4 · 4404016b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The jar's key is `31793454da2a93096588ded46200372ab8cc1527e854d60dc8c17d2ee41b78b4`; the jar's date 2026-11-21T02:39:00Z; its address `bchtest:p0s6st2h0v0v9wgws2lfxrstmfy53fulwlc6v448vlycf5kxrjrucr3gr5p4a` (transaction `8f69b0f4ed66032a5d9462e2f8fa7f56e7c1fbb22397f9f991e32bf899f7761d`).)
  76 s  5. The phone is lost
  76 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  76 s  6. A new phone takes the wallet over with Anna's help, and sweeps
  79 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 3 min, until 02:17:07 UTC
  84 s     the new phone sent its request over the session of the code
  85 s     waiting for the recoverer's page to show "Your request is waiting": at most 1 min, until 02:15:14 UTC
  91 s     the recoverer's page to show "Your request is waiting": after 5 s
  91 s     waiting for a block to hold the recovery request (on chipnet about a minute): at most 15 min, until 02:29:19 UTC
 151 s     still waiting for a block to hold the recovery request (on chipnet about a minute): 1 min of at most 15 min
 181 s     a block to hold the recovery request (on chipnet about a minute): after 90 s
 181 s     the request is in a block; the waiting period runs
 181 s     the recoverer's page shows the chain's clock at 03:12:41 AM, block 340488; the waiting period ends when it passes 03:21:02 AM
 181 s     the waiting period takes its real time
 181 s     waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): at most 25 min, until 02:40:50 UTC
 241 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 1 min of at most 25 min
 301 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 2 min of at most 25 min
 362 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 3.0 min of at most 25 min
 422 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 4.0 min of at most 25 min
 482 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 5.0 min of at most 25 min
 543 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 6.0 min of at most 25 min
 603 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 7.0 min of at most 25 min
 663 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 8.0 min of at most 25 min
 724 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 9.1 min of at most 25 min
 784 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 10.1 min of at most 25 min
 844 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 11.1 min of at most 25 min
 904 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 12.1 min of at most 25 min
 965 s     still waiting for the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): 13.1 min of at most 25 min
1011 s     the waiting period to end on the chain's clock ("Complete the move" enabled; on chipnet its median time passes 512 seconds after the block): after 830 s
1013 s     waiting for the hand-over, made once the server shows the completion: at most 1 min, until 02:30:42 UTC
1021 s     the hand-over, made once the server shows the completion: after 7 s
1021 s     completed; the hand-over is ready
1021 s     From the completion to the hand-over: 8 s; the chain is at height 340504.
1032 s    [new-phone] console: Failed to process transaction update: Error: Could not validate a block header on height 340505: The requested header is ahead of the current checkpoint at height 340504 (logged once; the same message again is not)
1032 s     the hand-over reached the new phone over the session
1032 s     the recoverer's page says that the new phone has the wallet
1032 s     waiting for the new phone to find the wallet's coins and sweep them ("Open the wallet"): at most 5 min, until 02:35:01 UTC
1035 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
1035 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
1038 s     From the completion to the sweep sent by the new phone: 25 s; the chain is at height 340505; not in a block yet: "Moved 3 coins from earlier addresses" 5808846eda15…; in a block: 4 of the 5 transactions looked at.
1076 s     the new phone to find the wallet's coins and sweep them ("Open the wallet"): after 44 s
1076 s     the new phone holds 0.00116821 BCH
1077 s     From the completion to the swept coins in the new phone's wallet: 64 s; the chain is at height 340505; not in a block yet: "Moved 3 coins from earlier addresses" 5808846eda15…; in a block: 4 of the 5 transactions looked at.
1077 s     recovery is on for the new phone
1077 s     From the completion to "Protected" on the new phone: 65 s.
1077 s  7. The new phone trusts the template from the backup and lists the jar from its record, confirmed
1077 s     waiting for the new phone to list the swept key, read from the chain, with "Trust this template": at most 1 min, until 02:31:46 UTC
1079 s     the Applications screen lists the swept key: "Savings Jar NFT · 31793454…1b78b4 · 4404016b Template not trusted What it controls can't be shown here. ? Trust this template Send"
1079 s     (On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · 31793454…1b78b4 · 4404016b Template not trusted What it controls can't be shown here. ? Trust this template Send".)
1079 s     "A template from your backup": "An earlier owner of this wallet stored this template in the backup. It is not trusted on this phone until you say so. ? TEMPLATE Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Technical details Trust this template Back"
1079 s     waiting for the new phone to list the jar from its record, checked against the chain: at most 1 min, until 02:31:48 UTC
1080 s     trusted; the wallet's list: "Jar key · Savings Jar NFT · 31793454…1b78b4 · 4404016b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send"
1080 s     (Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · 31793454…1b78b4 · 4404016b Open Holds 0.0003 BCH · 30,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".)
1080 s  8. The jar's date passes; the new phone empties the jar from its own list, the jar page never opened
1081 s     the chain's median time is 2026-11-21T02:25:45Z; waiting for it to pass the jar's date 2026-11-21T02:39:00Z
1081 s     waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): at most 33.3 min (the run's bound leaves 17.0 min), until 02:47:49 UTC
1141 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 1.0 min of at most 17.0 min
1202 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 2.0 min of at most 17.0 min
1263 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 3.0 min of at most 17.0 min
1323 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 4.0 min of at most 17.0 min
1384 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 5.0 min of at most 17.0 min
1445 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 6.1 min of at most 17.0 min
1505 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 7.1 min of at most 17.0 min
1566 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 8.1 min of at most 17.0 min
1626 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 9.1 min of at most 17.0 min
1687 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 10.1 min of at most 17.0 min
1748 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 11.1 min of at most 17.0 min
1808 s     still waiting for the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): 12.1 min of at most 17.0 min
1854 s     the chain's median time to pass the jar's date 2026-11-21T02:39:00Z (it trails the blocks' times by about six blocks): after 773 s
1854 s     the chain's median time is 2026-11-21T02:39:40Z, past the jar's date 2026-11-21T02:39:00Z
1854 s     waiting for the new phone to list the jar as open, from its record checked against the chain: at most 1 min, until 02:44:43 UTC
1855 s    [new-phone] console: Failed to process transaction update: Error: Server reported merkle root 6c3531327e4146ee6bdbd2d62c43a1ee31747d7ed79c4f540435d7a768ca0827 for checkpoint #340507, expected f49b38cd6df90e7a66692e71898a7 (logged once; the same message again is not)
1895 s     the new phone to list the jar as open, from its record checked against the chain: after 41 s
1897 s     "Empty a savings jar", from the wallet's own list, every fold opened: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 3:39 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 31793454…1b78b4 Opens on When the jar can be emptied, as a Unix time. 1795228740 Date on the key The same time, as it is written on the jar's key. 4404016b Key holder Where the jar's key goes: an address of the wallet. aa206b0f…cffe87 This wallet's own figures The fee, and all 4 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.00001 BCH · 1,000 sat Comes back to your wallet 0.0003048 BCH · 30,480 sat Comes back from the application Out of its contracts, more than goes into them 0.0003 BCH · 30,000 sat Network fee 520 bytes at one satoshi per byte 520 sat Your wallet goes up by 0.0002948 BCH · 29,480 sat Your tokens it spends A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 31793454…1b78b4 with 4404016b The application's coins it spends Read from the chain by this wallet. None of them is yours. Savings jar · 8f69b0…1d:0 0.0003 BCH · 30,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 31793454…1b78b4 with 4404016b What is left over, as change 0.0002948 BCH · 29,480 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. It has come back once A token made with it led to its position after a recovery. This is no audit of its contracts. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Carry it out Back Nothing is signed or sent until you carry it out."
1897 s     (From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.0003 BCH Savings Jar Your wallet goes up by ? +0.0002948BCH 29,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 3:39 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. 31793454…1b78b4 Opens on When the jar can be emptied, as a Unix time. 1795228740 Date on the key The same time, as it is written on the jar's key. 4404016b Key holder Where the jar's key goes: an address of the wallet. aa206b0f…cffe87 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out.")
1898 s     done: 66b4dcab51c5ab98a0b4a3d2182c8207bed57f573792953d006b4a474597a564
1900 s     waiting for the wallet's list to show the jar closed, once the server has the emptying: at most 1 min, until 02:45:29 UTC
1900 s     the wallet's list: "Jar key · Savings Jar NFT · 31793454…1b78b4 · 4404016b Closed It holds nothing now. Send"
1900 s     (The jar was emptied by the new phone from its own list of positions (transaction `66b4dcab51c5ab98a0b4a3d2182c8207bed57f573792953d006b4a474597a564`), with the Savings Jar page never opened on it: of the 286 requests its browser made up to then, none went to the jar page's origin https://jar.9500.cash. The list then showed the jar as "Closed", "It holds nothing now.".)
1900 s  9. The coins go back to where they came from
1902 s     the new phone sent everything to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u; tokens stay where they are, so the jar's key stays in the wallet
1903 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 3 min, until 02:47:31 UTC
1903 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6c3531327e4146ee6bdbd2d62c43a1ee31747d7ed79c4f540435d7a768ca0827 for checkpoint #340507, expected f49b38cd6df90e7a66692e71898a7 (logged once; the same message again is not)
1934 s     the recoverer's page to open the wallet's account (its engine's header check): after 31 s
1935 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 340488: The requested header is ahead of the current checkpoint at height 306176 (logged once; the same message again is not)
1943 s     Anna sent her balance back: Sent 0.00296477 BCH · 296,477 sat to qphf9jdtnr…y9q77u. The fee was 185 sat.
1943 s  about to send everything the run's key holds back to the funding address bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
1944 s  back to the funding address bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u: paid 9367 satoshis in 6caf40467eb4ee1e014b1169e132f0aff98122adc3e053cae3b71d73819e8d05:0 from bchtest:qpv6nfav99697tyeuhrr0f3ddscvd75s3cgkhf5k6c, unconfirmed
```
