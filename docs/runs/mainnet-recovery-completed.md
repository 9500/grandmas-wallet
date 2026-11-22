# Stage 17 in browsers on mainnet: the Savings Jar from its template alone, through the loss of a phone (PR19)

Written by `scripts/stage-17-jar-browser.ts mainnet --folder <the run's folder> --funder <funding key file> --screens --record mainnet-first-run.md --within 30` on 2026-11-21 01:29 UTC. Chromium (Playwright), one browser profile per device kept on disk under `<the run's folder>`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds served on this machine by `deploy/serve.mjs` with the content security policy at http://localhost:8701/, http://localhost:8702/ and http://localhost:8703/, with two backup stores and a relay for the sessions between the pages on this machine, against mainnet's servers wss://bch.imaginary.cash:50004, wss://electrum.imaginary.cash:50004, wss://fulcrum.greyh.at:50004. Blocks, the waiting period and the jar's date take their real time. The wallet reads no recovery declaration: the Savings Jar reached it as its template of version 4, in the page's requests of `xo_v1` version 2. Times in the log are seconds since the start.

Outcome: every step was carried out, in parts with the same browser profiles (see below).

After the run, the position record was read again from the stores' folders (the run looked for the wallet's archive key under the test networks' name and did not find it); the times of Approve and "Done" for that reading are those of the log, to about a second.
The wallet's review of the opening showed the jar's key as "NFT 0000…0000" and the key in the template's words as a row of zeros: the wallet had no coin a new token can be made from, so it worked the figures out before paying itself, with zeros for the identifier that payment gives. What it signed afterwards carried the real key (`e09edd50…a1bab0`, from the transaction in which it paid itself). Corrected in the wallet page after the run: such an identifier is now said as "new, made by this action", and the notice of paying itself says that the identifier, and an address made with it, come from that payment.
The run was continued from step 5 on 2026-11-21 01:50 UTC with the same browser profiles; the line "continued from step 5" in the log marks where, and the times after it count from then.
The run was continued from step 6 on 2026-11-22 02:31 UTC with the same browser profiles; the line "continued from step 6" in the log marks where, and the times after it count from then.

What the run showed:

- An ordinary payment out of the wallet: 5,000 sat to the run's key from the Send screen (transaction `2b5d7de773a8a51eab31d65ce55c8411b35b2f0aee69cece7024faf91b822369`). Its review said: "Check and send You send 0.00005BCH to qqepusqg3gw0…ng9fzgmm To bitcoincash:qqep…ng9fzgmm Amount 0.00005 BCH · 5,000 sat Network fee ? 384 sat Leaves the wallet 0.00005384 BCH · 5,384 sat Send Change"
- Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 2:30 AM Your wallet From your wallet to Savings Jar: 0.00002 BCH From Savings Jar to your wallet: NFT 0000…0000 Savings Jar Your wallet goes down by ? −0.00002433BCH 2,433 sat, the network fee of 433 sat included Your wallet receives NFT 0000…0000 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of 394 sat, and then carries out the action. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 2000 satoshis. Jar key The token category of the jar's key. 00000000…000000 Opens on When the jar can be emptied, as a Unix time. 1795225260 Date on the key The same time, as it is written on the jar's key. acf6006b Amount to save Satoshis to put into the jar. 2000 Key holder Where the jar's key goes: an address of the wallet. aa209328…7b6c87 This wallet's own figures The fee, and all 2 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve."
- On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · e09edd50…a1bab0 · acf6006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send". The jar's key is `e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0`; the jar's date 2026-11-21T01:41:00Z; its address `bitcoincash:pd9220yugmajmypuv0k6t8gpesryn2hl6wk4f6vcthg5t0ckpxhlymh47fgz5` (transaction `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926`).
- Anna's page sent the recovery request (transaction `c142f6c58e121b7c7861a994d9c0ddc2ce8822d94578ee91939acceaa34d9896`) once the new phone's keys and her saved takeover were on disk; a block held it, and her page said: "Where the wallet stands Your request is waiting To the key c7c6 ac2b bf3d a5e0. The waiting period ends in about 24 hours, when the chain's clock passes Nov 22, 2026, 2:21 AM. Chain's clock now 02:26:33 AM The waiting period ends when it passes Nov 22, 2026, 02:21:28 AM Still to go about 24 hours of the chain's clock Until then the owner's phone can refuse it. You can close this page and come back to complete. Owner's key ade5 c541 8d16 dda8 Waiting period about 24 hours Your key for it be98 8fe6 134c 10bd Phones it has had 1 Complete the move"
- On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · e09edd50…a1bab0 · acf6006b Template not trusted What it controls can't be shown here. ? Trust this template Send".
- Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · e09edd50…a1bab0 · acf6006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".
- From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.00002 BCH Savings Jar Your wallet goes up by ? +0.0000148BCH 1,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 2:41 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. e09edd50…a1bab0 Opens on When the jar can be emptied, as a Unix time. 1795225260 Date on the key The same time, as it is written on the jar's key. acf6006b Key holder Where the jar's key goes: an address of the wallet. aa20970c…4d4587 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out."
- The jar was emptied by the new phone from its own list of positions (transaction `09ac9661baf91a318913ea638119ac78c92bff9e95ca90d3659904f8cbfbf427`), with the Savings Jar page never opened on it: of the 212 requests its browser made up to then, none went to the jar page's origin http://localhost:8703. The list then showed the jar as "Closed", "It holds nothing now.".

## The new phone's requests

Every request the new phone's browser made, from the moment its profile was made until the end of the run, recorded by Playwright for every page of the profile (requests of the pages and of their workers, and web sockets): 254 in all.

| Origin | Requests | What was asked |
| --- | --- | --- |
| http://localhost:8701 | 62 | `/`, `/assets/index-DjHWdFYN.js`, `/assets/rolldown-runtime-BYOrzxDO.js`, `/assets/path-browserify-cMkRY8gI.js`, `/assets/preload-helper-7y9sWmk5.js`, `/assets/__vite-browser-external-BnCWfpkB.js`, `/assets/index-RO6nObWw.css`, `/config.json`, and 7 more |
| wss://fulcrum.greyh.at:50004 | 6 | `/` |
| wss://bch.imaginary.cash:50004 | 14 | `/` |
| wss://electrum.imaginary.cash:50004 | 6 | `/` |
| blob: | 1 | `(the whole address)` |
| http://localhost:8711 | 82 | `/v1/archives/4ad2e6d92f33bc59de917ebdd85c33ab/blobs`, `/v1/archives/4ad2e6d92f33bc59de917ebdd85c33ab/blobs/0a6171f80cd101c3a4739023ad0809ed00630ecbc382f3ab26a12002164050cd`, `/v1/archives/4ad2e6d92f33bc59de917ebdd85c33ab/blobs/0e4689f016879708652fd49a79189c236f59019b55b08e8428aa1c31701ed9b8`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs/492cf59153ea2bf16cfb5a44b4948e6888e3a8d0085d362331b1a7e931ac2e6b`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs/8f994f8b40622e62ba30ce9dd76c915e1b63ff5df21a1909684e17d665bd003c`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs/c96ed1a3dfce43bf942317d9d643ffa0c3e8974abdb8240e0d0a3307b6b094de`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs/e92888bc5a9df55ff3acf02ca3223374f2279a34b79d993286e0aa32d6117c1d`, and 4 more |
| http://localhost:8712 | 82 | `/v1/archives/4ad2e6d92f33bc59de917ebdd85c33ab/blobs`, `/v1/archives/4ad2e6d92f33bc59de917ebdd85c33ab/blobs/0a6171f80cd101c3a4739023ad0809ed00630ecbc382f3ab26a12002164050cd`, `/v1/archives/4ad2e6d92f33bc59de917ebdd85c33ab/blobs/0e4689f016879708652fd49a79189c236f59019b55b08e8428aa1c31701ed9b8`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs/492cf59153ea2bf16cfb5a44b4948e6888e3a8d0085d362331b1a7e931ac2e6b`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs/8f994f8b40622e62ba30ce9dd76c915e1b63ff5df21a1909684e17d665bd003c`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs/c96ed1a3dfce43bf942317d9d643ffa0c3e8974abdb8240e0d0a3307b6b094de`, `/v1/archives/67152e2194e26fe7241c653b1f79ca69/blobs/e92888bc5a9df55ff3acf02ca3223374f2279a34b79d993286e0aa32d6117c1d`, and 4 more |
| ws://127.0.0.1:40621 | 1 | `/` |

None went to the Savings Jar page (http://localhost:8703).

## Transactions and coins

Read from mainnet's server after the run: every transaction in the blocks after height 978233, where the run started, or not yet in a block, that touches an address of the run (the wallet's addresses of both phones' seeds, its controller, the jar and the recoverer's balance). The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.

| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The funding address pays the run's key | `e52454ea5f08cf25727a88f496e8b5abdeb675d721a52ce2f173617f8b9f439b` | 978235 | 219 | 219 | 1.00 |
| 2 | The run's key pays the recoverer's balance | `456e6ab1422c808029151d51d954013404960b6ad0374e939dc2ce530f6c757a` | 978236 | 219 | 219 | 1.00 |
| 3 | The run's key pays the owner's wallet | `51040deeb1250c468041813878ff7f9bb40767698eabb2af65a22f726cdfe384` | 978236 | 229 | 229 | 1.00 |
| 4 | The owner pays 5,000 sat out of the wallet, to the run's key, from the Send screen | `2b5d7de773a8a51eab31d65ce55c8411b35b2f0aee69cece7024faf91b822369` | 978236 | 384 | 384 | 1.00 |
| 5 | The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance | `e21f5dba47c1a815d6c8055aba82e0a9844c1ee348151c227c1d8bd088c0be61` | 978236 | 377 | 377 | 1.00 |
| 6 | The wallet pays itself (a coin that can start a new token: the jar's key) | `e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0` | 978236 | 394 | 394 | 1.00 |
| 7 | The owner's phone opens the jar, on the Savings Jar page's request (2,000 sat into the jar, the key to the wallet) | `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926` | 978236 | 433 | 433 | 1.00 |
| 8 | The run's key sends what it holds back to the funding address | `3292907abbdb3efa339a37d89a30419485452dade0ea5069066c47954fe71fea` | 978236 | 326 | 326 | 1.00 |
| 9 | Anna's page sends the recovery request, from her balance, to the new phone's key | `c142f6c58e121b7c7861a994d9c0ddc2ce8822d94578ee91939acceaa34d9896` | 978237 | 991 | 991 | 1.00 |
| 10 | The recoverer completes the move after the waiting period, paid from her balance | `f179cd3efc73bd2db194039d9bb46328af57c3ddcdd84e6d8a07f7dafac443c5` | 978407 | 970 | 970 | 1.00 |
| 11 | The recoverer sends her balance back | `bc2bb76883335b2c6c903c974d0636a9811a1a668e7d7910e3de4bc32a1e9b86` | 978408 | 185 | 185 | 1.00 |
| 12 | The new phone: Moved 3 coins from earlier addresses | `a0f026b2debbced381444313819f52902503841425df163f01be08f4fff5d475` | not in a block | 1702 | 1702 | 1.00 |
| 13 | The new phone empties the jar by itself, from its own list (the key at input 0, the key and the savings to the new seed) | `09ac9661baf91a318913ea638119ac78c92bff9e95ca90d3659904f8cbfbf427` | not in a block | 520 | 520 | 1.00 |
| 14 | The new phone: Sent everything to qp3tr46mvj…63lpp7 | `c4f4c324509aac0fb2c7361847ed0a26239259f5cbda566213186ae9aea6b5d7` | not in a block | 636 | 636 | 1.00 |

14 transactions, 7585 bytes, 7,585 sat in fees.

What came into the run, from coins no transaction of the run made:

- 285,322 sat from the funding address (bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7)

Where every coin went: the outputs that no transaction of the run spent, by whose they are (an output at the funding address may have been spent since by its next payment):

| Where | Coins | Value | Tokens on them |
| --- | --- | --- | --- |
| the funding address (bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7) | 4 | 275,737 sat |  |
| the wallet's controller (its identity token) | 1 | 1,000 sat | an NFT (mutable, commitment 010001000000c7c6…) of category 456e6ab1422c… |
| an address of the new phone's seed | 1 | 1,000 sat | an NFT (none, commitment acf6006b) of category e09edd5076df… |

285,322 sat came in; 277,737 sat is in these outputs and 7,585 sat went to fees, which adds up.


## The closing, after the run

Sent on 2026-11-22 at about 02:36 UTC with `npx tsx scripts/close-run-wallet.ts mainnet --folder <the run's folder> --destroy e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0 --send`, after the same command without `--send` had checked it.

- The wallet `456e6ab1422c808029151d51d954013404960b6ad0374e939dc2ce530f6c757a` is closed: transaction `24711b0f3401f0624038619b4ec289339b2dd63ee0c561376ba253d43f1da6ab`, 977 bytes, fee 977 sat. It spent the controller (1,000 sat, the identity token) and the emptied jar's key (1,000 sat), destroyed both tokens, and paid 1,023 sat to the funding address.
- The funding address then held 276,760 sat in 5 coins (275,737 sat in blocks and the closing's 1,023 sat not in a block yet), read from mainnet's server.
- Of the 285,322 sat the first run took from the funding address, 276,760 sat are back there and 8,562 sat went to network fees over 15 transactions, all at 1 sat per byte. Nothing is left at the wallet's addresses, its controller, the jar, the recoverer's balance or the run's key.

## Pictures

In `docs/screens/`, each at 390×844 (`-phone`) and 1280×800 (`-desktop`): `mainnet-jar-wallet-home`, `mainnet-jar-open-review`, `mainnet-jar-page-opened`, `mainnet-jar-positions-owner`.

## Log

```
   0 s  the run's bound: 30 minutes, until 01:59:48 UTC (--within)
   3 s  mainnet; funding address: 285322 satoshis in 1 coin at bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7
   3 s  relay: ws://127.0.0.1:40553, on this machine, for the sessions between the pages
   4 s  wallet page: http://localhost:8701/, this checkout at 5061322, mainnet
   4 s  recoverer page: http://localhost:8702/, this checkout at 5061322, mainnet
   4 s  jar page: http://localhost:8703/, this checkout at 5061322, mainnet
   6 s  about to make the run's key in /home/ubuntu/projects/grandma's-wallet/.mainnet/runs/first/run-key.json and pay it 80000 satoshis from the funding address
   8 s  the run's key bitcoincash:qqepusqg3gw0kk7ylhjgjg44hl5rluvqsgng9fzgmm: paid 80000 satoshis in e52454ea5f08cf25727a88f496e8b5abdeb675d721a52ce2f173617f8b9f439b:0 from bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7, unconfirmed; the key is kept in /home/ubuntu/projects/grandma's-wallet/.mainnet/runs/first/run-key.json
   8 s     the run starts after block 978233; the jar page is at http://localhost:8703/, on mainnet
   8 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
  10 s     the recoverer's page shows mainnet's statement before it starts: "! Mainnet: not audited, coins can be lost This page uses real Bitcoin Cash It runs on the main network of Bitcoin Cash, where coins have real value. Mainnet is enabled here only to meet the requirements of BCH Blaze. Nothing here has been audited. Coins can be lost. This project does not recommend enabling it. I understand that coins can be lost Asked once in this browser."
  11 s     confirmed; the band in view says "! Mainnet: not audited, coins can be lost"
  11 s     friend mode; the waiting period and the starting balance are left as the page proposes them
  18 s     Anna's balance is funded at bitcoincash:qrtzp9l4skthyaha09l5fuym5pk7gacv3s0lu9lcre; what her page keeps, her words among it, is copied to /home/ubuntu/projects/grandma's-wallet/.mainnet/runs/first/storage-recoverer.json first
  18 s     about to pay 30000 satoshis from the run's key to bitcoincash:qrtzp9l4skthyaha09l5fuym5pk7gacv3s0lu9lcre
  20 s     paid 30000 satoshis in 456e6ab1422c808029151d51d954013404960b6ad0374e939dc2ce530f6c757a:0 from bitcoincash:qqepusqg3gw0kk7ylhjgjg44hl5rluvqsgng9fzgmm, unconfirmed
  20 s     waiting for the payment to reach Anna's balance on her page: at most 1 min, until 01:31:08 UTC
  26 s     the payment to reach Anna's balance on her page: after 6 s
  26 s     Anna's page shows her balance: 30000 satoshis
  26 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  26 s     Anna's code carries her name, her key and a session, 289 characters
  29 s     the wallet shows mainnet's statement before it starts: "! Mainnet: not audited, coins can be lost This page uses real Bitcoin Cash It runs on the main network of Bitcoin Cash, where coins have real value. Mainnet is enabled here only to meet the requirements of BCH Blaze. Nothing here has been audited. Coins can be lost. This project does not recommend enabling it. I understand that coins can be lost Asked once in this browser."
  30 s     confirmed; the band in view says "! Mainnet: not audited, coins can be lost"
  31 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  31 s     about to say yes on Anna's page ("Set up Grandma's wallet On their phone they open the wallet, tap "Someone I trust is setting it up" and scan this code. Set up Grandma's wallet with 0.0001 BCH · 10,000 sat? It is paid from your balance. Their phone is waiting. Set it up No The code as text New wallets get 0.0001 BCH · 10,000 sat an"): her page creates the wallet from her balance and sends it
  40 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  40 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  41 s     the phone shows "Your wallet is ready" with 10,000 satoshis
  42 s     From "Set it up" to "Your wallet is ready": 10 s; the chain is at height 978235; not in a block yet: none; in a block: 0 of the 0 transactions looked at.
  42 s     Anna's page says the wallet is set up and keeps what a recovery needs
  42 s     waiting for the wallet to show "Protected": Anna's receipt read from the backup stores: at most 1 min, until 01:31:30 UTC
  44 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  45 s     From "Set it up" to "Protected", recovery on: 13 s; the chain is at height 978235; not in a block yet: none; in a block: 0 of the 0 transactions looked at.
  45 s  3. The owner receives
  46 s     address bitcoincash:r043a77hwa50n8d967cvushq2cvf033rk9a80cvx4cu38gz28hrx54v70d8ua
  46 s     about to pay 20000 satoshis from the run's key to bitcoincash:r043a77hwa50n8d967cvushq2cvf033rk9a80cvx4cu38gz28hrx54v70d8ua
  48 s     paid 20000 satoshis in 51040deeb1250c468041813878ff7f9bb40767698eabb2af65a22f726cdfe384:0 from bitcoincash:qqepusqg3gw0kk7ylhjgjg44hl5rluvqsgng9fzgmm, unconfirmed
  49 s     vault address bitcoincash:rw7vjpjlgxxsj9pve57pzksrea938m30c3p23lpt33h3gje7yqhmjl402g24g
  50 s     From "Set it up" to the vault address shown: 18 s; the chain is at height 978235; not in a block yet: none; in a block: 0 of the 0 transactions looked at.
  50 s     waiting for the payment of 20,000 satoshis to reach the wallet's balance (more than 0.0002 BCH): at most 1 min, until 01:31:38 UTC
  51 s     the wallet holds 0.0003 BCH
  51 s     (steps 1 to 3 up to the payment received took 50 s)
  51 s     the review of the payment: "Check and send You send 0.00005BCH to qqepusqg3gw0…ng9fzgmm To bitcoincash:qqep…ng9fzgmm Amount 0.00005 BCH · 5,000 sat Network fee ? 384 sat Leaves the wallet 0.00005384 BCH · 5,384 sat Send Change"
  51 s     about to send 5,000 satoshis from the wallet to the run's key bitcoincash:qqepusqg3gw0kk7ylhjgjg44hl5rluvqsgng9fzgmm
  54 s     sent: transaction 2b5d7de773a8a51eab31d65ce55c8411b35b2f0aee69cece7024faf91b822369; the wallet says "Sent Amount 0.00005 BCH · 5,000 sat Network fee 384 bytes 384 sat Transaction 2b5d7de773a8a51eab31d65ce55c8411b35b2f0aee69cece7024faf91b822369 Copy Send another payment Home"
  54 s     (An ordinary payment out of the wallet: 5,000 sat to the run's key from the Send screen (transaction `2b5d7de773a8a51eab31d65ce55c8411b35b2f0aee69cece7024faf91b822369`). Its review said: "Check and send You send 0.00005BCH to qqepusqg3gw0…ng9fzgmm To bitcoincash:qqep…ng9fzgmm Amount 0.00005 BCH · 5,000 sat Network fee ? 384 sat Leaves the wallet 0.00005384 BCH · 5,384 sat Send Change")
  54 s     (the payment out of the wallet took 3 s)
  54 s  4. The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it
  54 s     the Savings Jar page shows mainnet's statement before it starts: "! Mainnet: not audited, coins can be lost This page uses real Bitcoin Cash It runs on the main network of Bitcoin Cash, where coins have real value. Mainnet is enabled here only to meet the requirements of BCH Blaze. Nothing here has been audited. Coins can be lost. This project does not recommend enabling it. I understand that coins can be lost Asked once in this browser."
  54 s     confirmed; the band in view says "! Mainnet: not audited, coins can be lost"
  54 s     the Savings Jar page shows its connection address (98 characters) and waits for a wallet
  59 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through 127.0.0.1:40553 · since Nov 21, 2026, 2:30 AM; "Connected"
  59 s     the Savings Jar page: "Connected to Grandma's Wallet"
  59 s     the jar page lists: "No jars to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds."
  60 s     the chain's clock: last block 2026-11-21T01:30:05Z, median time 2026-11-21T01:18:36Z; this machine 2026-11-21T01:30:48Z
  60 s     the date: "10 minutes", the soonest the page offers to choose, gives 2026-11-21T02:41 in the browser's time zone (2026-11-21T01:41:00Z); the hint says "In your time zone, Europe/Zagreb. The network accepts a withdrawal about an hour after this time, once the median time of its recent blocks has passed it."
  60 s     the form says: "0.00002 BCH stays in the jar until Nov 21, 2026, 2:41 AM, 10 minutes from now." (the date 2026-11-21T01:41:00Z)
  61 s     the wallet's review of the page's request, every fold opened: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 2:30 AM Your wallet From your wallet to Savings Jar: 0.00002 BCH From Savings Jar to your wallet: NFT 0000…0000 Savings Jar Your wallet goes down by ? −0.00002433BCH 2,433 sat, the network fee of 433 sat included Your wallet receives NFT 0000…0000 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of 394 sat, and then carries out the action. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 2000 satoshis. Jar key The token category of the jar's key. 00000000…000000 Opens on When the jar can be emptied, as a Unix time. 1795225260 Date on the key The same time, as it is written on the jar's key. acf6006b Amount to save Satoshis to put into the jar. 2000 Key holder Where the jar's key goes: an address of the wallet. aa209328…7b6c87 This wallet's own figures The fee, and all 2 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.00003433 BCH · 3,433 sat Comes back to your wallet 0.00001 BCH · 1,000 sat Goes into the application To its contracts and others, less what comes back from them 0.00002 BCH · 2,000 sat Network fee 433 bytes at one satoshi per byte 433 sat Your wallet goes down by 0.00002433 BCH · 2,433 sat Goes to others Savings jar · at aa2091…6c6787 0.00002 BCH · 2,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 00000000…000000 with acf6006b The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. Pay into a savings jar Add savings to a jar. They stay there until the jar's date. Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Approve Decline Nothing is signed or sent unless you approve."
  61 s     (Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 2:30 AM Your wallet From your wallet to Savings Jar: 0.00002 BCH From Savings Jar to your wallet: NFT 0000…0000 Savings Jar Your wallet goes down by ? −0.00002433BCH 2,433 sat, the network fee of 433 sat included Your wallet receives NFT 0000…0000 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of 394 sat, and then carries out the action. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 2000 satoshis. Jar key The token category of the jar's key. 00000000…000000 Opens on When the jar can be emptied, as a Unix time. 1795225260 Date on the key The same time, as it is written on the jar's key. acf6006b Amount to save Satoshis to put into the jar. 2000 Key holder Where the jar's key goes: an address of the wallet. aa209328…7b6c87 This wallet's own figures The fee, and all 2 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve.")
  61 s     about to approve: the wallet writes its records to the backup stores, then signs the opening of the jar and sends it
  70 s     approved; the wallet: "Done: Open a savings jar", transaction 9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926
  72 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.00002BCH Locked, "Opens on Nov 21, 2026, 2:41 AM"
  72 s     waiting for the wallet to list the jar from its record, read against the chain: at most 1 min, until 01:32:00 UTC
  77 s     the wallet to list the jar from its record, read against the chain: after 5 s
  77 s     the wallet's list: "Jar key · Savings Jar NFT · e09edd50…a1bab0 · acf6006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send"; key e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0
  77 s     (On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · e09edd50…a1bab0 · acf6006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send". The jar's key is `e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0`; the jar's date 2026-11-21T01:41:00Z; its address `bitcoincash:pd9220yugmajmypuv0k6t8gpesryn2hl6wk4f6vcthg5t0ckpxhlymh47fgz5` (transaction `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926`).)
  78 s     The wallet's archive key was not found in what its page keeps, so the stores were not read.
  78 s     What the phone's browser sent between Approve and "Done" (9.2 s), in order: a record to the store at localhost:8711 at 2.0 s; a record to the store at localhost:8712 at 2.4 s; a transaction to the server bch.imaginary.cash:50004 at 4.8 s; a record to the store at localhost:8711 at 7.7 s; a record to the store at localhost:8712 at 8.0 s; a transaction to the server bch.imaginary.cash:50004 at 8.5 s. The transaction the wallet named is `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926`.
  78 s     (step 4, the jar opened and listed took 24 s)
  78 s  about to send everything the run's key holds back to the funding address bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7
  80 s  back to the funding address bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7: paid 34226 satoshis in 3292907abbdb3efa339a37d89a30419485452dade0ea5069066c47954fe71fea:0 from bitcoincash:qqepusqg3gw0kk7ylhjgjg44hl5rluvqsgng9fzgmm, unconfirmed
  82 s     the funding address: 239329 satoshis in 2 coins at bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7
  89 s  record written to docs/runs/mainnet-first-run.md
   0 s  the run's bound: 30 minutes, until 02:02:29 UTC (--within)
   0 s     The position record of the jar's key, read back from store1 (http://localhost:8711) and store2 (http://localhost:8712) with the wallet's archive key and its signature checked (a mainnet record of the wallet `456e6ab1422c808029151d51d954013404960b6ad0374e939dc2ce530f6c757a`): blob `e92888bc5a9df55ff3acf02ca3223374f2279a34b79d993286e0aa32d6117c1d`; store1 wrote it 7.5 s after Approve, store2 wrote it 7.8 s after Approve.
   0 s     What it says: template `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25`; the token e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0 (none, commitment acf6006b); script `savingsJarLockingScript`, the wallet's role `saver`; the script's values {"keyCategory":"e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0","unlockTime":"1795225260"}; the action's other values {"savedSatoshis":"2000","unlockTimeBytes":"acf6006b"}; the page http://localhost:8703/.
   0 s     Written to the stores' disks between Approve and "Done": store1 c96ed1a3dfce… at 1.8 s, store1 e92888bc5a9d… at 7.5 s, store2 c96ed1a3dfce… at 2.2 s, store2 e92888bc5a9d… at 7.8 s.
   0 s     What the phone's browser sent between Approve and "Done" (9.2 s), in order: a record to the store at localhost:8711 at 2.0 s; a record to the store at localhost:8712 at 2.4 s; a transaction to the server bch.imaginary.cash:50004 at 4.8 s; a record to the store at localhost:8711 at 7.7 s; a record to the store at localhost:8712 at 8.0 s; a transaction to the server bch.imaginary.cash:50004 at 8.5 s. The transaction the wallet named is `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926`.
  11 s  record written to docs/runs/mainnet-first-run.md
   0 s  the run's bound: 30 minutes, until 02:05:17 UTC (--within)
  13 s  record written to docs/runs/mainnet-first-run.md
   0 s  the run's bound: 30 minutes, until 02:05:42 UTC (--within)
  11 s  record written to docs/runs/mainnet-first-run.md
   0 s  the run's bound: 36 minutes, until 02:26:39 UTC (--within)
       continued from step 5
   2 s  mainnet; funding address: 239329 satoshis in 2 coins at bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7
   2 s  relay: ws://127.0.0.1:40621, on this machine, for the sessions between the pages
   3 s  wallet page: http://localhost:8701/, this checkout at 0a0174b, mainnet
   3 s  recoverer page: http://localhost:8702/, this checkout at 0a0174b, mainnet
   3 s  jar page: http://localhost:8703/, this checkout at 0a0174b, mainnet
   3 s     the run starts after block 978233; the jar page is at http://localhost:8703/, on mainnet
   3 s     the jar: key e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0, date 2026-11-21T01:41:00Z, address bitcoincash:pd9220yugmajmypuv0k6t8gpesryn2hl6wk4f6vcthg5t0ckpxhlymh47fgz5
   3 s  5. The phone is lost
   3 s     the old phone's profile is not opened again
   3 s     continuing: the recoverer's page about:blank shows: ""
   3 s  6. A new phone asks Anna to move the wallet; her page sends the request, and it goes into a block
   5 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 3 min, until 01:53:44 UTC
   9 s     the recoverer's page to open the wallet's account (its engine's header check): after 4 s
  11 s     the new phone's wallet shows mainnet's statement before it starts: "! Mainnet: not audited, coins can be lost This page uses real Bitcoin Cash It runs on the main network of Bitcoin Cash, where coins have real value. Mainnet is enabled here only to meet the requirements of BCH Blaze. Nothing here has been audited. Coins can be lost. This project does not recommend enabling it. I understand that coins can be lost Asked once in this browser."
  12 s     confirmed; the band in view says "! Mainnet: not audited, coins can be lost"
  13 s     the new phone sent its request over the session of the code
  13 s     waiting for Anna's page to sign the request, held back from the network: at most 1 min, until 01:51:51 UTC
  14 s     Anna's page signed the request; it is held back from the network (1 message) while what both pages keep is copied to disk
  14 s     on disk before the request goes out: the new phone's words and its takeover request (storage-new-phone.json, and its profile), and Anna's saved takeover to the key c7c6ac2b… (storage-recoverer.json)
  14 s     the request is let through to the network
  14 s     waiting for Anna's page to show "Your request is waiting", once the server has the request: at most 1 min, until 01:51:52 UTC
  20 s     Anna's page to show "Your request is waiting", once the server has the request: after 6 s
  20 s     the request: transaction c142f6c58e121b7c7861a994d9c0ddc2ce8822d94578ee91939acceaa34d9896
  20 s     waiting for a block to hold the recovery request (on mainnet about ten minutes; at most 40 minutes): at most 40 min (the run's bound leaves 35.7 min), until 02:26:39 UTC
  80 s     still waiting for a block to hold the recovery request (on mainnet about ten minutes; at most 40 minutes): 1 min of at most 35.7 min
 140 s     still waiting for a block to hold the recovery request (on mainnet about ten minutes; at most 40 minutes): 2 min of at most 35.7 min
 200 s     still waiting for a block to hold the recovery request (on mainnet about ten minutes; at most 40 minutes): 3.0 min of at most 35.7 min
 261 s     still waiting for a block to hold the recovery request (on mainnet about ten minutes; at most 40 minutes): 4.0 min of at most 35.7 min
 321 s     a block to hold the recovery request (on mainnet about ten minutes; at most 40 minutes): after 301 s
 321 s     the request is in a block, 301 s after it was let through; the recoverer's page shows the chain's clock at 02:26:33 AM, block 978237; the waiting period ends when it passes Nov 22, 2026, 02:21:28 AM
 321 s     Anna's page: "Where the wallet stands Your request is waiting To the key c7c6 ac2b bf3d a5e0. The waiting period ends in about 24 hours, when the chain's clock passes Nov 22, 2026, 2:21 AM. Chain's clock now 02:26:33 AM The waiting period ends when it passes Nov 22, 2026, 02:21:28 AM Still to go about 24 hours of the chain's clock Until then the owner's phone can refuse it. You can close this page and come back to complete. Owner's key ade5 c541 8d16 dda8 Waiting period about 24 hours Your key for it be98 8fe6 134c 10bd Phones it has had 1 Complete the move"
 321 s     (Anna's page sent the recovery request (transaction `c142f6c58e121b7c7861a994d9c0ddc2ce8822d94578ee91939acceaa34d9896`) once the new phone's keys and her saved takeover were on disk; a block held it, and her page said: "Where the wallet stands Your request is waiting To the key c7c6 ac2b bf3d a5e0. The waiting period ends in about 24 hours, when the chain's clock passes Nov 22, 2026, 2:21 AM. Chain's clock now 02:26:33 AM The waiting period ends when it passes Nov 22, 2026, 02:21:28 AM Still to go about 24 hours of the chain's clock Until then the owner's phone can refuse it. You can close this page and come back to complete. Owner's key ade5 c541 8d16 dda8 Waiting period about 24 hours Your key for it be98 8fe6 134c 10bd Phones it has had 1 Complete the move")
 334 s  record written to docs/runs/mainnet-recovery-started.md
   0 s  the run's bound: 60 minutes, until 03:31:09 UTC (--within)
       continued from step 6
   2 s  mainnet; funding address: 239329 satoshis in 2 coins at bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7
   2 s  relay: ws://127.0.0.1:44271, on this machine, for the sessions between the pages
   3 s  wallet page: http://localhost:8701/, this checkout at b4941cd, mainnet
   3 s  recoverer page: http://localhost:8702/, this checkout at b4941cd, mainnet
   3 s  jar page: http://localhost:8703/, this checkout at b4941cd, mainnet
   3 s     the run starts after block 978233; the jar page is at http://localhost:8703/, on mainnet
   3 s     the jar: key e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0, date 2026-11-21T01:41:00Z, address bitcoincash:pd9220yugmajmypuv0k6t8gpesryn2hl6wk4f6vcthg5t0ckpxhlymh47fgz5
   3 s     continuing: the recoverer's page about:blank shows: ""
   3 s  6. A new phone takes the wallet over with Anna's help, and sweeps
   4 s     the request was sent by the part that stopped; the new phone's profile and Anna's page are opened again where they were
   5 s     waiting for the recoverer's page to show "Your request is waiting": at most 1 min, until 02:32:14 UTC
         (left out of this log: 11,036 console lines of the new phone's page, "Connecting to 'ws://127.0.0.1:40621/' violates the following Content Security Policy directive", and 22,064 that followed them, "[relay] Failed to publish wallet_ready". The page kept trying the relay of the day before, whose address its profile had kept from the takeover request; that relay no longer ran, and the pages of this part were served with the address of the new one. The tries went on through the whole part, about 55 a second.)
   6 s     waiting for a block to hold the recovery request (on mainnet about ten minutes): at most 60 min (the run's bound leaves 59.9 min), until 03:31:09 UTC
   7 s     the request is in a block and its waiting period has passed on the chain's clock (block 978406)
   7 s     the waiting period takes its real time
   7 s     waiting for the waiting period to end on the chain's clock ("Complete the move" enabled): at most 1560 min (the run's bound leaves 59.9 min), until 03:31:09 UTC
  11 s     waiting for the hand-over, made once the server shows the completion: at most 1 min, until 02:32:20 UTC
  21 s     the hand-over, made once the server shows the completion: after 10 s
  21 s     completed; the hand-over is ready
  23 s     From the completion to the hand-over: 10 s; the chain is at height 978406.
  43 s     the hand-over did not arrive over the session; the new phone opens the hand-over's code
  55 s     waiting for the new phone to find the wallet's coins and sweep them ("Open the wallet"): at most 5 min, until 02:37:04 UTC
  65 s     From the completion to the sweep sent by the new phone: 52 s; the chain is at height 978407; not in a block yet: "Moved 3 coins from earlier addresses" a0f026b2debb…; in a block: 4 of the 5 transactions looked at.
 116 s     still waiting for the new phone to find the wallet's coins and sweep them ("Open the wallet"): 1 min of at most 5 min
 125 s     the new phone to find the wallet's coins and sweep them ("Open the wallet"): after 69 s
 125 s     the new phone holds 0.00019087 BCH
 127 s     From the completion to the swept coins in the new phone's wallet: 114 s; the chain is at height 978407; not in a block yet: "Moved 3 coins from earlier addresses" a0f026b2debb…; in a block: 4 of the 5 transactions looked at.
 127 s     recovery is on for the new phone
 127 s     From the completion to "Protected" on the new phone: 115 s.
 127 s  7. The new phone trusts the template from the backup and lists the jar from its record, confirmed
 127 s     waiting for the new phone to list the swept key, read from the chain, with "Trust this template": at most 1 min, until 02:34:15 UTC
 131 s     the new phone to list the swept key, read from the chain, with "Trust this template": after 4 s
 131 s     the Applications screen lists the swept key: "Savings Jar NFT · e09edd50…a1bab0 · acf6006b Template not trusted What it controls can't be shown here. ? Trust this template Send"
 131 s     (On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "Savings Jar NFT · e09edd50…a1bab0 · acf6006b Template not trusted What it controls can't be shown here. ? Trust this template Send".)
 131 s     "A template from your backup": "An earlier owner of this wallet stored this template in the backup. It is not trusted on this phone until you say so. ? TEMPLATE Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Technical details Trust this template Back"
 131 s     waiting for the new phone to list the jar from its record, checked against the chain: at most 1 min, until 02:34:19 UTC
 133 s     trusted; the wallet's list: "Jar key · Savings Jar NFT · e09edd50…a1bab0 · acf6006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send"
 133 s     (Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "Jar key · Savings Jar NFT · e09edd50…a1bab0 · acf6006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send". The actions it offers: "Empty a savings jar".)
 133 s  8. The jar's date passes; the new phone empties the jar from its own list, the jar page never opened
 137 s     the chain's median time is 2026-11-22T01:41:49Z, past the jar's date 2026-11-21T01:41:00Z
 137 s     waiting for the new phone to list the jar as open, from its record checked against the chain: at most 1 min, until 02:34:26 UTC
 142 s     the new phone to list the jar as open, from its record checked against the chain: after 5 s
 145 s     "Empty a savings jar", from the wallet's own list, every fold opened: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.00002 BCH Savings Jar Your wallet goes up by ? +0.0000148BCH 1,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 2:41 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. e09edd50…a1bab0 Opens on When the jar can be emptied, as a Unix time. 1795225260 Date on the key The same time, as it is written on the jar's key. acf6006b Key holder Where the jar's key goes: an address of the wallet. aa20970c…4d4587 This wallet's own figures The fee, and all 4 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.00001 BCH · 1,000 sat Comes back to your wallet 0.0000248 BCH · 2,480 sat Comes back from the application Out of its contracts, more than goes into them 0.00002 BCH · 2,000 sat Network fee 520 bytes at one satoshi per byte 520 sat Your wallet goes up by 0.0000148 BCH · 1,480 sat Your tokens it spends A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e09edd50…a1bab0 with acf6006b The application's coins it spends Read from the chain by this wallet. None of them is yours. Savings jar · 9ea178…26:0 0.00002 BCH · 2,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e09edd50…a1bab0 with acf6006b What is left over, as change 0.0000148 BCH · 1,480 sat The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. It has come back once A token made with it led to its position after a recovery. This is no audit of its contracts. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Carry it out Back Nothing is signed or sent until you carry it out."
 145 s     (From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "Check and carry out Your wallet From your wallet to Savings Jar: Nothing From Savings Jar to your wallet: 0.00002 BCH Savings Jar Your wallet goes up by ? +0.0000148BCH 1,480 sat, the network fee of 520 sat included The network accepts this transaction from Nov 21, 2026, 2:41 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one. IN THE TEMPLATE'S WORDS ? Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Everything was taken out of a savings jar. Jar key The token category of the jar's key. e09edd50…a1bab0 Opens on When the jar can be emptied, as a Unix time. 1795225260 Date on the key The same time, as it is written on the jar's key. acf6006b Key holder Where the jar's key goes: an address of the wallet. aa20970c…4d4587 This wallet's own figures The fee, and all 4 coins in and out The template What it is, and its identifiers Carry it out Back Nothing is signed or sent until you carry it out.")
 150 s     done: 09ac9661baf91a318913ea638119ac78c92bff9e95ca90d3659904f8cbfbf427
 152 s     waiting for the wallet's list to show the jar closed, once the server has the emptying: at most 1 min, until 02:34:40 UTC
 152 s     the wallet's list: "Jar key · Savings Jar NFT · e09edd50…a1bab0 · acf6006b Closed It holds nothing now. Send"
 152 s     (The jar was emptied by the new phone from its own list of positions (transaction `09ac9661baf91a318913ea638119ac78c92bff9e95ca90d3659904f8cbfbf427`), with the Savings Jar page never opened on it: of the 212 requests its browser made up to then, none went to the jar page's origin http://localhost:8703. The list then showed the jar as "Closed", "It holds nothing now.".)
 152 s  9. The coins go back to where they came from
 157 s     the new phone sent everything to bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7; tokens stay where they are, so the jar's key stays in the wallet
 159 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 3 min, until 02:36:47 UTC
 164 s     the recoverer's page to open the wallet's account (its engine's header check): after 5 s
 165 s     Anna sent her balance back: Sent 0.00016477 BCH · 16,477 sat to qp3tr46mvj…63lpp7. The fee was 185 sat.
 165 s  about to send everything the run's key holds back to the funding address bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7
 181 s  back to the funding address bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7: bitcoincash:qqepusqg3gw0kk7ylhjgjg44hl5rluvqsgng9fzgmm holds nothing
```
