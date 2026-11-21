# The first use of the wallet on mainnet: a recoverer, a payment in and out, and a Savings Jar left open

Written by `npx tsx scripts/stage-17-jar-browser.ts mainnet --folder <the run's folder> --funder <funding key file> --screens --record mainnet-first-run.md --within 30` on 2026-11-21 01:29 UTC. Chromium (Playwright), one browser profile per device kept on disk under `<the run's folder>`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds served on this machine by `deploy/serve.mjs` with the content security policy, at the wallet http://localhost:8701/, the recoverer http://localhost:8702/, the Savings Jar http://localhost:8703/, the backup stores http://localhost:8711 and http://localhost:8712, with `deploy/config/mainnet.example.json` and this machine's addresses (`"network": "mainnet"`, `"mainnetEnabled": true`), against mainnet's servers wss://bch.imaginary.cash:50004, wss://electrum.imaginary.cash:50004, wss://fulcrum.greyh.at:50004, with a relay on this machine for the sessions between the pages. Each page's statement about mainnet was confirmed once per browser as a person would. Blocks and the chain's clock took their real time; nothing waited for a block. Times in the log are seconds since the start.

The steps are those of the Savings Jar course in its first use (`--first-use`, implied on mainnet): the recoverer keeps the waiting period and starting balance her page proposes; the amounts are small; the owner receives and pays a small amount out; a jar is opened with the smallest first amount the Savings Jar page takes and the soonest date it offers; the run stops there. The wallet is not closed and its coins are not returned: the wallet, its jar and the recoverer's kit are where the later part starts. Only what was left at the run's key went back to the funding address.

Outcome: stopped after step 4 with the jar open, as the first use asks; the wallet, its jar and the recoverer's balance stay, and what was left at the run's key went back to the funding address.

After the run, the position record was read again from the stores' folders (the run looked for the wallet's archive key under the test networks' name and did not find it); the times of Approve and "Done" for that reading are those of the log, to about a second.
The wallet's review of the opening showed the jar's key as "NFT 0000…0000" and the key in the template's words as a row of zeros: the wallet had no coin a new token can be made from, so it worked the figures out before paying itself, with zeros for the identifier that payment gives. What it signed afterwards carried the real key (`e09edd50…a1bab0`, from the transaction in which it paid itself). Corrected in the wallet page after the run: such an identifier is now said as "new, made by this action", and the notice of paying itself says that the identifier, and an address made with it, come from that payment.

What the run showed:

- An ordinary payment out of the wallet: 5,000 sat to the run's key from the Send screen (transaction `2b5d7de773a8a51eab31d65ce55c8411b35b2f0aee69cece7024faf91b822369`). Its review said: "Check and send You send 0.00005BCH to qqepusqg3gw0…ng9fzgmm To bitcoincash:qqep…ng9fzgmm Amount 0.00005 BCH · 5,000 sat Network fee ? 384 sat Leaves the wallet 0.00005384 BCH · 5,384 sat Send Change"
- Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 2:30 AM Your wallet From your wallet to Savings Jar: 0.00002 BCH From Savings Jar to your wallet: NFT 0000…0000 Savings Jar Your wallet goes down by ? −0.00002433BCH 2,433 sat, the network fee of 433 sat included Your wallet receives NFT 0000…0000 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of 394 sat, and then carries out the action. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 2000 satoshis. Jar key The token category of the jar's key. 00000000…000000 Opens on When the jar can be emptied, as a Unix time. 1795225260 Date on the key The same time, as it is written on the jar's key. acf6006b Amount to save Satoshis to put into the jar. 2000 Key holder Where the jar's key goes: an address of the wallet. aa209328…7b6c87 This wallet's own figures The fee, and all 2 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve."
- On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · e09edd50…a1bab0 · acf6006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send". The jar's key is `e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0`; the jar's date 2026-11-21T01:41:00Z; its address `bitcoincash:pd9220yugmajmypuv0k6t8gpesryn2hl6wk4f6vcthg5t0ckpxhlymh47fgz5` (transaction `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926`).

## The position record, before signing

- The position record of the jar's key, read back from store1 (http://localhost:8711) and store2 (http://localhost:8712) with the wallet's archive key and its signature checked (a mainnet record of the wallet `456e6ab1422c808029151d51d954013404960b6ad0374e939dc2ce530f6c757a`): blob `e92888bc5a9df55ff3acf02ca3223374f2279a34b79d993286e0aa32d6117c1d`; store1 wrote it 7.5 s after Approve, store2 wrote it 7.8 s after Approve.
- What it says: template `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25`; the token e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0 (none, commitment acf6006b); script `savingsJarLockingScript`, the wallet's role `saver`; the script's values {"keyCategory":"e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0","unlockTime":"1795225260"}; the action's other values {"savedSatoshis":"2000","unlockTimeBytes":"acf6006b"}; the page http://localhost:8703/.
- Written to the stores' disks between Approve and "Done": store1 c96ed1a3dfce… at 1.8 s, store1 e92888bc5a9d… at 7.5 s, store2 c96ed1a3dfce… at 2.2 s, store2 e92888bc5a9d… at 7.8 s.
- What the phone's browser sent between Approve and "Done" (9.2 s), in order: a record to the store at localhost:8711 at 2.0 s; a record to the store at localhost:8712 at 2.4 s; a transaction to the server bch.imaginary.cash:50004 at 4.8 s; a record to the store at localhost:8711 at 7.7 s; a record to the store at localhost:8712 at 8.0 s; a transaction to the server bch.imaginary.cash:50004 at 8.5 s. The transaction the wallet named is `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926`.

## How long each part took

- steps 1 to 3 up to the payment received: 50 s
- the payment out of the wallet: 3 s
- step 4, the jar opened and listed: 24 s

## The jar's date on the chain

The jar's date is 2026-11-21T01:41:00Z. The network accepts emptying it once the median time of the last eleven blocks has passed that date, which on mainnet trails the wall clock by about an hour: about 2026-11-21T02:41:00Z, give or take the blocks' times. Before then the wallet's "Empty a savings jar" is refused by the network.

## Transactions and coins

Read from mainnet's server after the run: every transaction in the blocks after height 978233, where the run started, or not yet in a block, that touches an address of the run (the run's own key, the wallet's addresses, its controller, the jar and the recoverer's balance). The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.

| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The funding address pays the run's key | `e52454ea5f08cf25727a88f496e8b5abdeb675d721a52ce2f173617f8b9f439b` | 978235 | 219 | 219 | 1.00 |
| 2 | The run's key pays the recoverer's balance | `456e6ab1422c808029151d51d954013404960b6ad0374e939dc2ce530f6c757a` | not in a block | 219 | 219 | 1.00 |
| 3 | The run's key pays the owner's wallet | `51040deeb1250c468041813878ff7f9bb40767698eabb2af65a22f726cdfe384` | not in a block | 229 | 229 | 1.00 |
| 4 | The owner pays 5,000 sat out of the wallet, to the run's key, from the Send screen | `2b5d7de773a8a51eab31d65ce55c8411b35b2f0aee69cece7024faf91b822369` | not in a block | 384 | 384 | 1.00 |
| 5 | The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance | `e21f5dba47c1a815d6c8055aba82e0a9844c1ee348151c227c1d8bd088c0be61` | not in a block | 377 | 377 | 1.00 |
| 6 | The wallet pays itself (a coin that can start a new token: the jar's key) | `e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0` | not in a block | 394 | 394 | 1.00 |
| 7 | The owner's phone opens the jar, on the Savings Jar page's request (2,000 sat into the jar, the key to the wallet) | `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926` | not in a block | 433 | 433 | 1.00 |
| 8 | The run's key sends what it holds back to the funding address | `3292907abbdb3efa339a37d89a30419485452dade0ea5069066c47954fe71fea` | not in a block | 326 | 326 | 1.00 |

8 transactions, 2581 bytes, 2,581 sat in fees.

What came into the run, from coins no transaction of the run made:

- 285,322 sat from the funding address (bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7)

Where every coin went: the outputs that no transaction of the run spent, by whose they are (an output at the funding address may have been spent since by its next payment):

| Where | Coins | Value | Tokens on them |
| --- | --- | --- | --- |
| the funding address (bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7) | 2 | 239,329 sat |  |
| the wallet's controller (its identity token) | 1 | 1,000 sat | an NFT (mutable, commitment 010000000000ade5…) of category 456e6ab1422c… |
| an address of the wallet (the owner's phone's seed) | 3 | 21,789 sat | an NFT (none, commitment acf6006b) of category e09edd5076df… |
| the recoverer's balance | 1 | 18,623 sat |  |
| the jar | 1 | 2,000 sat |  |

285,322 sat came in; 282,741 sat is in these outputs and 2,581 sat went to fees, which adds up.

The funding address: before the run 285322 satoshis in 1 coin at bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7; after it 239329 satoshis in 2 coins at bitcoincash:qp3tr46mvjmdnyq48gmwyu5vcz35hn3geg7863lpp7.

## Pictures

In `docs/screens/`, each at 390×844 (`-phone`) and 1280×800 (`-desktop`): `mainnet-jar-wallet-home`, `mainnet-jar-open-review`, `mainnet-jar-page-opened`, `mainnet-jar-positions-owner`.

## How the later part goes on

Everything of the run is in its folder (`.mainnet/runs/first/` of the main checkout, not in git), written before any coin was sent to an address it controls:

- `profiles/recoverer/`: the recoverer's browser profile (Anna's page: her balance, her key for the wallet and its kit); `storage-recoverer.json`: a copy of what her page keeps, her balance's words among it.
- `profiles/old-phone/`: the owner's phone, with the wallet page and the Savings Jar page as a second tab; `storage-old-phone.json`: a copy of what both pages keep, the wallet's words and its archive key among it.
- `store1/`, `store2/`: the two backup stores' data (the wallet's sealed records: the recoverer's receipt, the template, the jar's position record).
- `run-key.json`: the run's key, emptied back to the funding address. `config.json`: the configuration the pages were served with. `jar.json`: what the course knows between its parts (the jar's key, date and address, the transactions' names). `log.txt`, `console.txt`, `blocks.json`, `requests.json`: what the run said.

What a page keeps in a browser is kept by the page's address, so the later part serves the pages and stores at the same addresses: http://localhost:8701/, http://localhost:8702/, http://localhost:8703/, and the stores http://localhost:8711 and http://localhost:8712 with their data in `store1/` and `store2/`. The course does that by itself with the same folder.

The wallet's waiting period is what the recoverer's page proposed, 169 steps of 512 seconds, about a day: a recovery completes only after it has passed on the chain's clock, counted from the block that holds the request. It can be changed only by the owner's phone, with an update of the controller's settings (the contract's `ownerUpdate`, which the wallet makes once the recoverer's prepared receipt for the change is on the backup stores); the wallet page offers no screen for changing it today, so it was not changed.

Two ways on:

- Emptying the jar without a recovery: open the owner's phone's profile with the pages served as above; once the chain's median time has passed the jar's date, the wallet's Applications screen offers "Empty a savings jar" on the jar's row. No course step does this alone today.
- The recovery with the jar open, then the emptying from the new phone: `npx tsx scripts/stage-17-jar-browser.ts mainnet --folder <the run's folder> --funder <funding key file> --from 5 --screens --record <a new record> --within <minutes>`. Step 5 leaves the owner's phone closed; step 6 makes a new phone, which asks Anna, and her page sends the request from her balance; the waiting period runs (`--within` has to cover it: more than 1,440 minutes for about a day); she completes the move and the new phone sweeps the coins; step 7 trusts the template from the backup and lists the jar; step 8 waits for the chain's median time to pass the jar's date and empties the jar from the wallet's own list; step 9 sends the wallet's coins and Anna's balance back to the funding address. This continuation has not been run on mainnet.

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
```
