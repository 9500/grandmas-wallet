# The first use of the wallet, proved on the local node: a recoverer, a payment in and out, and a Savings Jar left open

Written by `npx tsx scripts/stage-17-jar-browser.ts local --first-use --directory first-use-jar --record first-use-jar-browser-local-node.md --ports 8740 --within 10` on 2026-11-21 01:27 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.local-runs/first-use-jar/`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds served on this machine by `deploy/serve.mjs` with the content security policy, at the wallet http://localhost:8741/, the recoverer http://localhost:8742/, the Savings Jar http://localhost:8743/, the backup stores http://localhost:8751 and http://localhost:8752, against the regtest node, with a relay on this machine. The run made the blocks. Times in the log are seconds since the start.

The steps are those of the Savings Jar course in its first use (`--first-use`): the recoverer keeps the waiting period and starting balance her page proposes; the amounts are small; the owner receives and pays a small amount out; a jar is opened with the smallest first amount the Savings Jar page takes and the soonest date it offers; the run stops there. The wallet is not closed and its coins are not returned: the wallet, its jar and the recoverer's kit are where the later part starts. Only what was left at the run's key went back to the funding address.

Outcome: stopped after step 4 with the jar open, as the first use asks; the wallet, its jar and the recoverer's balance stay, and what was left at the run's key went back to the funding address.

What the run showed:

- An ordinary payment out of the wallet: 5,000 sat to the run's key from the Send screen (transaction `a60c04a8468517172366e4385b6c7dd7509bf81dfb07363e96c51ef95ea7b2af`). Its review said: "Check and send You send 0.00005BCH to qzpcg0843ynp…u9rtpyq2 To bchreg:qzpcg0843…u9rtpyq2 Amount 0.00005 BCH · 5,000 sat Network fee ? 384 sat Leaves the wallet 0.00005384 BCH · 5,384 sat Send Change"
- Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 2:27 AM Your wallet From your wallet to Savings Jar: 0.00002 BCH From Savings Jar to your wallet: NFT 0000…0000 Savings Jar Your wallet goes down by ? −0.00002433BCH 2,433 sat, the network fee of 433 sat included Your wallet receives NFT 0000…0000 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of 394 sat, and then carries out the action. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 2000 satoshis. Jar key The token category of the jar's key. 00000000…000000 Opens on When the jar can be emptied, as a Unix time. 1795225080 Date on the key The same time, as it is written on the jar's key. f8f5006b Amount to save Satoshis to put into the jar. 2000 Key holder Where the jar's key goes: an address of the wallet. aa208e99…2b0c87 This wallet's own figures The fee, and all 2 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve."
- On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · 1163be4e…53151e · f8f5006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send". The jar's key is `1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e`; the jar's date 2026-11-21T01:38:00Z; its address `bchreg:pw33uzk3f579q340met5hqqpvqccjaydwp6cpxm54ags2q68d09573a9fecs9` (transaction `ed5dfb8d01c1bc1963d7121d7873f8e8da5e7cd9b2a300a9613a7fb112d5372d`).

## The position record, before signing

- The position record of the jar's key, read back from localhost:8751 and localhost:8752 with the wallet's archive key and its signature checked (a testnet record of the wallet `db7129e0ce171e4b49168774cf49069c06baf4cf8cdb8769ff1f48b8b91daac1`): blob `b6ffa0ef2ed72cf8387c1f12bb005f2f56c8eda580937e5c79766a45e250c1b1`; store1 wrote it 4.8 s after Approve, store2 wrote it 5.6 s after Approve.
- What it says: template `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25`; the token 1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e (none, commitment f8f5006b); script `savingsJarLockingScript`, the wallet's role `saver`; the script's values {"keyCategory":"1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e","unlockTime":"1795225080"}; the action's other values {"savedSatoshis":"2000","unlockTimeBytes":"f8f5006b"}; the page http://localhost:8743/.
- Written to the stores' disks between Approve and "Done": store1 b6ffa0ef2ed7… at 4.8 s, store1 f9e4c5b3d2d3… at 2.0 s, store2 b6ffa0ef2ed7… at 5.6 s, store2 f9e4c5b3d2d3… at 2.2 s.
- What the phone's browser sent between Approve and "Done" (7.8 s), in order: a record to the store at localhost:8751 at 2.0 s; a record to the store at localhost:8752 at 2.2 s; a transaction to the server 127.0.0.1:60403 at 2.8 s; a record to the store at localhost:8751 at 4.8 s; a record to the store at localhost:8752 at 5.6 s; a transaction to the server 127.0.0.1:60403 at 7.0 s. The transaction the wallet named is `ed5dfb8d01c1bc1963d7121d7873f8e8da5e7cd9b2a300a9613a7fb112d5372d`.

## How long each part took

- steps 1 to 3 up to the payment received: 42 s
- the payment out of the wallet: 5 s
- step 4, the jar opened and listed: 14 s

## The jar's date on the chain

The jar's date is 2026-11-21T01:38:00Z. The network accepts emptying it once the median time of the last eleven blocks has passed that date. Before then the wallet's "Empty a savings jar" is refused by the network.

## Transactions and coins

Read from the local node after the run: every transaction in the blocks after height 1897, where the run started, or not yet in a block, that touches an address of the run (the run's own key, the wallet's addresses, its controller, the jar and the recoverer's balance). The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.

| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The local payer pays the run's key | `b3ec2ed3c70e9fc115a347e3c2cb2b20dbcd26e864ec99b4749b8ec544de9c8c` | 1898 | 219 | 219 | 1.00 |
| 2 | The run's key pays the recoverer's balance | `db7129e0ce171e4b49168774cf49069c06baf4cf8cdb8769ff1f48b8b91daac1` | 1899 | 219 | 219 | 1.00 |
| 3 | The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance | `75e64ca293fade8d541c2731b3b5d86bbd2ad7fdae7f72f26624ccfa18004c85` | 1900 | 377 | 377 | 1.00 |
| 4 | The run's key pays the owner's wallet | `d0d83afe0b27765c853183ef93d93737e1c957c30022a0e9d3db03d608d20d11` | 1901 | 229 | 229 | 1.00 |
| 5 | The owner pays 5,000 sat out of the wallet, to the run's key, from the Send screen | `a60c04a8468517172366e4385b6c7dd7509bf81dfb07363e96c51ef95ea7b2af` | 1902 | 384 | 384 | 1.00 |
| 6 | The wallet pays itself (a coin that can start a new token: the jar's key) | `1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e` | 1902 | 394 | 394 | 1.00 |
| 7 | The owner's phone opens the jar, on the Savings Jar page's request (2,000 sat into the jar, the key to the wallet) | `ed5dfb8d01c1bc1963d7121d7873f8e8da5e7cd9b2a300a9613a7fb112d5372d` | 1902 | 433 | 433 | 1.00 |
| 8 | The run's key sends what it holds back to the funding address | `f1bf79d58533ddf6a6bec4c84b28a366df398cfba89031628c4b245d641586b2` | 1903 | 326 | 326 | 1.00 |

8 transactions, 2581 bytes, 2,581 sat in fees.

What came into the run, from coins no transaction of the run made:

- 2,127,624,644 sat from the outside address the coins went back to (bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd)

Where every coin went: the outputs that no transaction of the run spent, by whose they are (an output at the funding address may have been spent since by its next payment):

| Where | Coins | Value | Tokens on them |
| --- | --- | --- | --- |
| the outside address the coins went back to (bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd) | 2 | 2,127,578,651 sat |  |
| the wallet's controller (its identity token) | 1 | 1,000 sat | an NFT (mutable, commitment 010000000000a793…) of category db7129e0ce17… |
| an address of the wallet (the owner's phone's seed) | 3 | 21,789 sat | an NFT (none, commitment f8f5006b) of category 1163be4e8402… |
| the recoverer's balance | 1 | 18,623 sat |  |
| the jar | 1 | 2,000 sat |  |

2,127,624,644 sat came in; 2,127,622,063 sat is in these outputs and 2,581 sat went to fees, which adds up.

The funding address: before the run (not read: no run key yet); after it 2312915238 satoshis in 21 coins at bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd.

## Pictures

In `docs/screens/`, each at 390×844 (`-phone`) and 1280×800 (`-desktop`): `live-jar-wallet-home`, `live-jar-open-review`, `live-jar-page-opened`, `live-jar-positions-owner`.

## How the later part goes on

Everything of the run is in its folder, written before any coin was sent to an address it controls:

- `profiles/recoverer/`: the recoverer's browser profile (Anna's page: her balance, her key for the wallet and its kit); `storage-recoverer.json`: a copy of what her page keeps, her balance's words among it.
- `profiles/old-phone/`: the owner's phone, with the wallet page and the Savings Jar page as a second tab; `storage-old-phone.json`: a copy of what both pages keep, the wallet's words and its archive key among it.
- `store1/`, `store2/`: the two backup stores' data (the wallet's sealed records: the recoverer's receipt, the template, the jar's position record).
- `run-key.json`: the run's key, emptied back to the funding address. `config.json`: the configuration the pages were served with. `jar.json`: what the course knows between its parts (the jar's key, date and address, the transactions' names). `log.txt`, `console.txt`, `blocks.json`, `requests.json`: what the run said.

What a page keeps in a browser is kept by the page's address, so the later part serves the pages and stores at the same addresses: http://localhost:8741/, http://localhost:8742/, http://localhost:8743/, and the stores http://localhost:8751 and http://localhost:8752 with their data in `store1/` and `store2/`. The course does that by itself with the same folder.

The wallet's waiting period is what the recoverer's page proposed, one step of 512 seconds on a test network: a recovery completes only after it has passed on the chain's clock, counted from the block that holds the request. It can be changed only by the owner's phone, with an update of the controller's settings (the contract's `ownerUpdate`, which the wallet makes once the recoverer's prepared receipt for the change is on the backup stores); the wallet page offers no screen for changing it today, so it was not changed.

Two ways on:

- Emptying the jar without a recovery: open the owner's phone's profile with the pages served as above; once the chain's median time has passed the jar's date, the wallet's Applications screen offers "Empty a savings jar" on the jar's row. No course step does this alone today.
- The recovery with the jar open, then the emptying from the new phone: `npx tsx scripts/stage-17-jar-browser.ts local --directory <the run's directory> --from 5 --screens --record <a new record> --within <minutes>`. Step 5 leaves the owner's phone closed; step 6 makes a new phone, which asks Anna, and her page sends the request from her balance; the waiting period runs (`--within` has to cover it); she completes the move and the new phone sweeps the coins; step 7 trusts the template from the backup and lists the jar; step 8 waits for the chain's median time to pass the jar's date and empties the jar from the wallet's own list; step 9 sends the wallet's coins and Anna's balance back to the funding address.

## Log

```
   0 s  the run's bound: 10 minutes, until 01:37:08 UTC (--within)
   0 s  local node: node: running, block 1897, median time 2026-11-21T01:19:24Z
   0 s  relay: ws://127.0.0.1:42617, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8741/, this checkout at 5061322, regtest
   1 s  recoverer page: http://localhost:8742/, this checkout at 5061322, regtest
   1 s  jar page: http://localhost:8743/, this checkout at 5061322, regtest
   1 s  about to make the run's key in .local-runs/first-use-jar/run-key.json and pay it 80000 satoshis from the funding address
   3 s  the run's key bchreg:qzpcg0843ynpvqy8x8rzul6l3p97e5k025u9rtpyq2: paid 80000 satoshis in b3ec2ed3c70e9fc115a347e3c2cb2b20dbcd26e864ec99b4749b8ec544de9c8c:0, confirmed at height 1898; the key is kept in .local-runs/first-use-jar/run-key.json
   3 s     the run starts after block 1897; the jar page is at http://localhost:8743/, on regtest
   3 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   3 s     friend mode; the waiting period and the starting balance are left as the page proposes them
   4 s     Anna's balance is funded at bchtest:qz9twvprvezdt9qgvev4h20nghenunc8vynmy8ahef; what her page keeps, her words among it, is copied to .local-runs/first-use-jar/storage-recoverer.json first
   4 s     about to pay 30000 satoshis from the run's key to bchtest:qz9twvprvezdt9qgvev4h20nghenunc8vynmy8ahef
   5 s     paid 30000 satoshis in db7129e0ce171e4b49168774cf49069c06baf4cf8cdb8769ff1f48b8b91daac1:0 from the run's key, confirmed at height 1899
   5 s     waiting for the payment to reach Anna's balance on her page: at most 1 min, until 01:28:14 UTC
  12 s     the payment to reach Anna's balance on her page: after 7 s
  12 s     Anna's page shows her balance: 30000 satoshis
  12 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  13 s     Anna's code carries her name, her key and a session, 291 characters
  15 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  15 s     about to say yes on Anna's page ("Set up Grandma's wallet On their phone they open the wallet, tap "Someone I trust is setting it up" and scan this code. Set up Grandma's wallet with 0.0001 BCH · 10,000 sat? It is paid from your balance. Their phone is waiting. Set it up No The code as text New wallets get 0.0001 BCH · 10,000 sat an"): her page creates the wallet from her balance and sends it
  17 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  17 s     the phone shows "Your wallet is ready" with 10,000 satoshis
  17 s     From "Set it up" to "Your wallet is ready": 2 s; the chain is at height 1899; not in a block yet: the creation 75e64ca293fa…; in a block: 1 of the 2 transactions looked at.
  17 s     Anna's page says the wallet is set up and keeps what a recovery needs
  17 s     waiting for the wallet to show "Protected": Anna's receipt read from the backup stores: at most 1 min, until 01:28:25 UTC
  23 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  32 s     the wallet to show "Protected": Anna's receipt read from the backup stores: after 15 s
  32 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  32 s     From "Set it up" to "Protected", recovery on: 17 s; the chain is at height 1899; not in a block yet: the creation 75e64ca293fa…; in a block: 1 of the 2 transactions looked at.
  34 s  3. The owner receives
  34 s     address bchtest:rvfcspwawxl8vl8a475vvcv0ftqfgm9j9zpdys2mg2e2mshue4zpuaak3lrky
  34 s     about to pay 20000 satoshis from the run's key to bchtest:rvfcspwawxl8vl8a475vvcv0ftqfgm9j9zpdys2mg2e2mshue4zpuaak3lrky
  36 s     paid 20000 satoshis in d0d83afe0b27765c853183ef93d93737e1c957c30022a0e9d3db03d608d20d11:0 from the run's key, confirmed at height 1901
  36 s     vault address bchtest:rwuc75kc65q8lmxpxzgm44jsdh5jhgevgq8jryh0qfcfvyc7x9hws4c35kjzy
  36 s     From "Set it up" to the vault address shown: 21 s; the chain is at height 1901; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  37 s     waiting for the payment of 20,000 satoshis to reach the wallet's balance (more than 0.0002 BCH): at most 1 min, until 01:28:45 UTC
  42 s     the payment of 20,000 satoshis to reach the wallet's balance (more than 0.0002 BCH): after 5 s
  42 s     the wallet holds 0.0003 BCH
  42 s     (steps 1 to 3 up to the payment received took 42 s)
  42 s     the review of the payment: "Check and send You send 0.00005BCH to qzpcg0843ynp…u9rtpyq2 To bchreg:qzpcg0843…u9rtpyq2 Amount 0.00005 BCH · 5,000 sat Network fee ? 384 sat Leaves the wallet 0.00005384 BCH · 5,384 sat Send Change"
  42 s     about to send 5,000 satoshis from the wallet to the run's key bchreg:qzpcg0843ynpvqy8x8rzul6l3p97e5k025u9rtpyq2
  47 s     sent: transaction a60c04a8468517172366e4385b6c7dd7509bf81dfb07363e96c51ef95ea7b2af; the wallet says "Sent Amount 0.00005 BCH · 5,000 sat Network fee 384 bytes 384 sat Transaction a60c04a8468517172366e4385b6c7dd7509bf81dfb07363e96c51ef95ea7b2af Copy Send another payment Home"
  47 s     (An ordinary payment out of the wallet: 5,000 sat to the run's key from the Send screen (transaction `a60c04a8468517172366e4385b6c7dd7509bf81dfb07363e96c51ef95ea7b2af`). Its review said: "Check and send You send 0.00005BCH to qzpcg0843ynp…u9rtpyq2 To bchreg:qzpcg0843…u9rtpyq2 Amount 0.00005 BCH · 5,000 sat Network fee ? 384 sat Leaves the wallet 0.00005384 BCH · 5,384 sat Send Change")
  47 s     (the payment out of the wallet took 5 s)
  47 s  4. The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it
  47 s     the Savings Jar page shows its connection address (98 characters) and waits for a wallet
  48 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through 127.0.0.1:42617 · since Nov 21, 2026, 2:27 AM; "Connected"
  48 s     the Savings Jar page: "Connected to Grandma's Wallet"
  48 s     the jar page lists: "No jars to show. Your wallet does not trust this page's template yet, so it tells the page nothing about what it holds."
  48 s     the chain's clock: last block 2026-11-21T01:27:43Z, median time 2026-11-21T01:19:25Z; this machine 2026-11-21T01:27:56Z
  48 s     the date: "10 minutes", the soonest the page offers to choose, gives 2026-11-21T02:38 in the browser's time zone (2026-11-21T01:38:00Z); the hint says "In your time zone, Europe/Zagreb. The network accepts a withdrawal a few minutes after this time, once the median time of its recent blocks has passed it."
  48 s     the form says: "0.00002 BCH stays in the jar until Nov 21, 2026, 2:38 AM, 10 minutes from now." (the date 2026-11-21T01:38:00Z)
  48 s     the wallet's review of the page's request, every fold opened: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 2:27 AM Your wallet From your wallet to Savings Jar: 0.00002 BCH From Savings Jar to your wallet: NFT 0000…0000 Savings Jar Your wallet goes down by ? −0.00002433BCH 2,433 sat, the network fee of 433 sat included Your wallet receives NFT 0000…0000 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of 394 sat, and then carries out the action. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 2000 satoshis. Jar key The token category of the jar's key. 00000000…000000 Opens on When the jar can be emptied, as a Unix time. 1795225080 Date on the key The same time, as it is written on the jar's key. f8f5006b Amount to save Satoshis to put into the jar. 2000 Key holder Where the jar's key goes: an address of the wallet. aa208e99…2b0c87 This wallet's own figures The fee, and all 2 coins in and out Worked out by this wallet from the transaction it built. The application cannot change them. Leaves your wallet The coins it spends, token coins included 0.00003433 BCH · 3,433 sat Comes back to your wallet 0.00001 BCH · 1,000 sat Goes into the application To its contracts and others, less what comes back from them 0.00002 BCH · 2,000 sat Network fee 433 bytes at one satoshi per byte 433 sat Your wallet goes down by 0.00002433 BCH · 2,433 sat Goes to others Savings jar · at aa20cb…7f4787 0.00002 BCH · 2,000 sat Arrives at your wallet To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 00000000…000000 with f8f5006b The template What it is, and its identifiers Savings Jar Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar's key can empty it. The 3 actions it has Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. Pay into a savings jar Add savings to a jar. They stay there until the jar's date. Empty a savings jar Take everything out of the jar. Possible from the jar's date on. The key stays with you, so the jar can be used again. Technical details Identifier fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25 Content hash 66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c Approve Decline Nothing is signed or sent unless you approve."
  48 s     (Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "Savings Jar asks for your decision Its own name, not verified Asked Nov 21, 2026, 2:27 AM Your wallet From your wallet to Savings Jar: 0.00002 BCH From Savings Jar to your wallet: NFT 0000…0000 Savings Jar Your wallet goes down by ? −0.00002433BCH 2,433 sat, the network fee of 433 sat included Your wallet receives NFT 0000…0000 This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it. This wallet has no coin that can start a new token. It first pays itself, in a transaction of its own with a fee of 394 sat, and then carries out the action. IN THE TEMPLATE'S WORDS ? Open a savings jar Make a new jar with its key, and pay the first savings in. They stay in the jar until its date. A savings jar was opened with 2000 satoshis. Jar key The token category of the jar's key. 00000000…000000 Opens on When the jar can be emptied, as a Unix time. 1795225080 Date on the key The same time, as it is written on the jar's key. f8f5006b Amount to save Satoshis to put into the jar. 2000 Key holder Where the jar's key goes: an address of the wallet. aa208e99…2b0c87 This wallet's own figures The fee, and all 2 coins in and out The template What it is, and its identifiers Approve Decline Nothing is signed or sent unless you approve.")
  48 s     about to approve: the wallet writes its records to the backup stores, then signs the opening of the jar and sends it
  56 s     approved; the wallet: "Done: Open a savings jar", transaction ed5dfb8d01c1bc1963d7121d7873f8e8da5e7cd9b2a300a9613a7fb112d5372d
  57 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.00002BCH Locked, "Opens on Nov 21, 2026, 2:38 AM"
  59 s     waiting for the wallet to list the jar from its record, read against the chain: at most 1 min, until 01:29:07 UTC
  60 s     the wallet's list: "Jar key · Savings Jar NFT · 1163be4e…53151e · f8f5006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send"; key 1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e
  60 s     (On the owner's phone the wallet listed the jar from its own record: "Jar key · Savings Jar NFT · 1163be4e…53151e · f8f5006b Open Holds 0.00002 BCH · 2,000 sat Empty a savings jar ? Send". The jar's key is `1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e`; the jar's date 2026-11-21T01:38:00Z; its address `bchreg:pw33uzk3f579q340met5hqqpvqccjaydwp6cpxm54ags2q68d09573a9fecs9` (transaction `ed5dfb8d01c1bc1963d7121d7873f8e8da5e7cd9b2a300a9613a7fb112d5372d`).)
  61 s     The position record of the jar's key, read back from localhost:8751 and localhost:8752 with the wallet's archive key and its signature checked (a testnet record of the wallet `db7129e0ce171e4b49168774cf49069c06baf4cf8cdb8769ff1f48b8b91daac1`): blob `b6ffa0ef2ed72cf8387c1f12bb005f2f56c8eda580937e5c79766a45e250c1b1`; store1 wrote it 4.8 s after Approve, store2 wrote it 5.6 s after Approve.
  61 s     What it says: template `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25`; the token 1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e (none, commitment f8f5006b); script `savingsJarLockingScript`, the wallet's role `saver`; the script's values {"keyCategory":"1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e","unlockTime":"1795225080"}; the action's other values {"savedSatoshis":"2000","unlockTimeBytes":"f8f5006b"}; the page http://localhost:8743/.
  61 s     Written to the stores' disks between Approve and "Done": store1 b6ffa0ef2ed7… at 4.8 s, store1 f9e4c5b3d2d3… at 2.0 s, store2 b6ffa0ef2ed7… at 5.6 s, store2 f9e4c5b3d2d3… at 2.2 s.
  61 s     What the phone's browser sent between Approve and "Done" (7.8 s), in order: a record to the store at localhost:8751 at 2.0 s; a record to the store at localhost:8752 at 2.2 s; a transaction to the server 127.0.0.1:60403 at 2.8 s; a record to the store at localhost:8751 at 4.8 s; a record to the store at localhost:8752 at 5.6 s; a transaction to the server 127.0.0.1:60403 at 7.0 s. The transaction the wallet named is `ed5dfb8d01c1bc1963d7121d7873f8e8da5e7cd9b2a300a9613a7fb112d5372d`.
  61 s     (step 4, the jar opened and listed took 14 s)
  61 s  about to send everything the run's key holds back to the funding address bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd
  66 s  back to the funding address bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd: paid 34226 satoshis in f1bf79d58533ddf6a6bec4c84b28a366df398cfba89031628c4b245d641586b2:0 from the run's key, confirmed at height 1903
  66 s     the funding address: 2312915238 satoshis in 21 coins at bchreg:qr0dmsu88mywdlcw8w04ppm755u4hxzh9u5yl9g6hd
  67 s  record written to docs/runs/first-use-jar-browser-local-node.md
   0 s  the run's bound: 6 minutes, until 01:35:22 UTC (--within)
   0 s  record written to docs/runs/first-use-jar-browser-local-node.md
   0 s  the run's bound: 6 minutes, until 01:41:30 UTC (--within)
```
