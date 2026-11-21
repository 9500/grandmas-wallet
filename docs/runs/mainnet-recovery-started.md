# A recovery started on mainnet: the phone lost, the request in a block, the waiting period running

On 2026-11-21 at 01:50 UTC the wallet of the first mainnet run ([mainnet-first-run.md](mainnet-first-run.md)) was taken into a recovery, with the owner's approval and the owner's real coins. The old phone counts as lost: its profile was not opened. A new phone asked Anna, the recoverer, to move the wallet, and her page sent the recovery request. The run stopped once a block held the request. The completion, and everything after it, is for tomorrow (see the end of this record).

The steps are the course's own: `npx tsx scripts/stage-17-jar-browser.ts mainnet --folder <the run's folder> --funder <funding key file> --from 5 --request-only --record mainnet-recovery-started.md --within 36`, from this checkout at `0a0174b`. The pages are its production builds, served on this machine at the same addresses as in the first run (wallet http://localhost:8701/, recoverer http://localhost:8702/, Savings Jar http://localhost:8703/, backup stores http://localhost:8711 and http://localhost:8712, with their data from the first run), against mainnet's servers wss://bch.imaginary.cash:50004, wss://electrum.imaginary.cash:50004 and wss://fulcrum.greyh.at:50004. The sessions between the pages went through a relay on this machine. Before anything was sent, the whole run folder was copied to `.mainnet/runs/first-before-recovery/` of the main checkout, as a way back.

Outcome: the recovery request is in block 978237. The wallet is pending a move to the new phone's key. Nothing was completed, swept, emptied, closed or returned, and no process was left running. This run paid no run key, so there was nothing to send back to the funding address.

## What was on chain before

Read from mainnet at 01:46 UTC, at height 978236 (last block 01:45:06 UTC, median time 01:19:20 UTC):

- The controller of the wallet `456e6ab1422c808029151d51d954013404960b6ad0374e939dc2ce530f6c757a` is active and in a block (one controller transaction, the creation `e21f5dba…88c0be61`). It names the old phone's key as owner (`ade5c541…8643a8`), Anna's key as recoverer (`be988fe6…d43f39`), and a waiting period of 169 steps of 512 seconds. Its owner epoch is 0 and no request was pending. It holds 1,000 sat with the identity token.
- The wallet's addresses (the old phone's seed) hold 21,789 sat in 3 coins: 10,000 sat (the starting balance), 10,789 sat, and 1,000 sat with the jar's key (the NFT of `e09edd50…a1bab0`, commitment `acf6006b`).
- The jar `bitcoincash:pd9220yugmajmypuv0k6t8gpesryn2hl6wk4f6vcthg5t0ckpxhlymh47fgz5` holds 2,000 sat.
- Anna's balance `bitcoincash:qrtzp9l4skthyaha09l5fuym5pk7gacv3s0lu9lcre` holds 18,623 sat.
- The funding address holds 239,329 sat in 2 coins.
- Every transaction of the first run was in block 978235 or 978236.

The jar's date (2026-11-21T01:41:00Z) had **not** been reached on chain: the median time was 01:19:20 UTC. After block 978237 it was 01:26:33 UTC, still before the date. It will be long past by tomorrow.

## What was done

1. The old phone's profile was left closed. Anna's page was opened from her profile, and the wallet's account opened in 4 s.
2. A new browser profile, the new phone, opened the wallet page and confirmed mainnet's statement. It took "I lost my phone", scanned the code from Anna's "lost their phone" screen, and sent its takeover request over the session.
3. Anna's page then signed the recovery request at once, as it does. Before anything reached the network, the course held back her page's transaction. While it was held, two things were copied to disk: what the new phone keeps (its words and its takeover request, in `storage-new-phone.json`) and what Anna's page keeps (her saved takeover to the new phone's key `c7c6ac2b…`, in `storage-recoverer.json`). Only then was the transaction let through.
4. Anna's page showed "Your request is waiting" 6 s later.
5. The request went into a block 301 s after it was sent. Anna's page then said: "Your request is waiting. To the key c7c6 ac2b bf3d a5e0. The waiting period ends in about 24 hours, when the chain's clock passes Nov 22, 2026, 2:21 AM. Chain's clock now 02:26:33 AM … Owner's key ade5 c541 8d16 dda8 · Waiting period about 24 hours · Your key for it be98 8fe6 134c 10bd · Phones it has had 1". Her page shows times in the browser's time zone, Europe/Zagreb (UTC+1).

## Transactions

This run sent one transaction:

| What | Transaction | Block | Bytes | Fee (sat) |
| --- | --- | --- | --- | --- |
| Anna's page sends the recovery request, from her balance, to the new phone's key | `c142f6c58e121b7c7861a994d9c0ddc2ce8822d94578ee91939acceaa34d9896` | 978237 (mined 2026-11-21T01:55:25Z) | 991 | 991 (1 sat per byte) |

It spends the controller (1,000 sat, identity token) and Anna's balance (18,623 sat). It pays the controller back (1,000 sat, with the state now pending and naming the new phone's key) and returns 17,632 sat to her balance.

All transactions of the wallet so far, read from mainnet after the run (every transaction after height 978233 that touches the run's key, the wallet's addresses, its controller, the jar or Anna's balance):

| # | What | Transaction | Block | Bytes | Fee (sat) |
| --- | --- | --- | --- | --- | --- |
| 1 | The funding address pays the first run's key | `e52454ea5f08cf25727a88f496e8b5abdeb675d721a52ce2f173617f8b9f439b` | 978235 | 219 | 219 |
| 2 | The run's key pays Anna's balance | `456e6ab1422c808029151d51d954013404960b6ad0374e939dc2ce530f6c757a` | 978236 | 219 | 219 |
| 3 | The run's key pays the owner's wallet | `51040deeb1250c468041813878ff7f9bb40767698eabb2af65a22f726cdfe384` | 978236 | 229 | 229 |
| 4 | The owner pays 5,000 sat out of the wallet, to the run's key | `2b5d7de773a8a51eab31d65ce55c8411b35b2f0aee69cece7024faf91b822369` | 978236 | 384 | 384 |
| 5 | Anna creates the wallet for the phone, from her balance | `e21f5dba47c1a815d6c8055aba82e0a9844c1ee348151c227c1d8bd088c0be61` | 978236 | 377 | 377 |
| 6 | The wallet pays itself (the coin that started the jar's key) | `e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0` | 978236 | 394 | 394 |
| 7 | The owner's phone opens the jar | `9ea178ca4ca756d6cc29db25e5a2cb7878d1eae3f6184ce9e9dbb9b9f5345926` | 978236 | 433 | 433 |
| 8 | The run's key sends what it holds back to the funding address | `3292907abbdb3efa339a37d89a30419485452dade0ea5069066c47954fe71fea` | 978236 | 326 | 326 |
| 9 | Anna's page sends the recovery request (this run) | `c142f6c58e121b7c7861a994d9c0ddc2ce8822d94578ee91939acceaa34d9896` | 978237 | 991 | 991 |

9 transactions, 3,572 bytes, 3,572 sat in fees, all at 1 sat per byte.

## When the waiting period ends

- **On the chain's clock:** once the median time of the last eleven blocks passes **2026-11-22T01:21:28Z**. That is 169 × 512 = 86,528 s (24 h 2 min 8 s) after the median time of the block before the request's block, which was 01:19:20 UTC. Anna's page says the same: "Nov 22, 2026, 02:21:28 AM" in Europe/Zagreb.
- **On the wall clock, likely:** between about **01:50 and 02:30 UTC on 22 November** (02:50 to 03:30 in Europe/Zagreb). The median time trails the wall clock and moves only when a block comes: by about half an hour when the request was mined, and usually closer to an hour. "Complete the move" on Anna's page turns on at the first block whose median time is past the date. Her page reads the chain every 10 seconds.

Until then, the owner's key can refuse the request. **Do not open the old phone's profile** (`profiles/old-phone/`): it is the lost phone, and its wallet page holds the owner's key.

## Where every satoshi is now

Read at 01:56 UTC, height 978237:

| Where | Value |
| --- | --- |
| The funding address | 239,329 sat in 2 coins (unchanged) |
| The wallet's controller, pending a move to the new phone's key | 1,000 sat with the identity token |
| The old phone's addresses of the wallet | 21,789 sat in 3 coins, one with the jar's key |
| The jar | 2,000 sat |
| Anna's balance | 17,632 sat |
| The first run's key | 0 sat |

The first run's 285,322 sat are all accounted for. 239,329 sat are at the funding address and 42,421 sat are in the wallet, the jar and Anna's balance. 3,572 sat went to fees.

## What is on disk

Everything is in `/home/ubuntu/projects/grandma's-wallet/.mainnet/runs/first/`, which is not in git:

- `profiles/new-phone/`: the new phone's browser profile, waiting for Anna. `storage-new-phone.json` is a copy of what its wallet page keeps: its words and its takeover request, written before the request was sent and again after the block.
- `profiles/recoverer/`: Anna's profile. `storage-recoverer.json` is a copy of what her page keeps: her balance's words, her kit for the wallet, the saved takeover and the request sent.
- `profiles/old-phone/` and `storage-old-phone.json`: the lost phone, as the first run left it. Not to be opened.
- `store1/`, `store2/`: the backup stores' data. `jar.json`, `log.txt`, `blocks.json`, `requests.json`: what the course knows between its parts, and what it said. Tomorrow's part goes on from these.
- `run-key.json`: the first run's key. It holds nothing, but it names the funding address that the course returns coins to.
- `/home/ubuntu/projects/grandma's-wallet/.mainnet/runs/first-before-recovery/` is a plain copy of the folder from before this run.

## Tomorrow: the command that continues

Wait until Anna's page can complete: after about 02:30 UTC on 22 November, to be safe. Before running anything, read the chain: the controller must still be pending to `c7c6ac2b…` and not completed yet. Then, from `/home/ubuntu/projects/grandmas-wallet-design-3` on branch `night-runs` (at `6e37fa6` or later):

```
deploy/preview.sh build
npx tsx scripts/stage-17-jar-browser.ts mainnet --folder "/home/ubuntu/projects/grandma's-wallet/.mainnet/runs/first" --funder "/home/ubuntu/projects/grandma's-wallet/.mainnet/funder.json" --from 6 --record mainnet-recovery-completed.md --within 60
```

What it does, in the course's steps:

- **Step 6:** opens Anna's profile and the new phone's profile where they were, and waits for "Complete the move". Started before the waiting period has ended, it waits for it, within `--within`. Anna completes the move. The new phone receives the hand-over by its code and sweeps the wallet's coins, the jar's key among them, to its own seed.
- **Step 7:** the new phone trusts the Savings Jar template from the backup and lists the jar from its record.
- **Step 8:** the new phone empties the jar from its own list.
- **Step 9:** the new phone sends everything but tokens to the funding address, and Anna sends her balance there too.

After that, the wallet still holds its controller and the jar's key (about 1,000 sat each). Closing the wallet sends both to the funding address and destroys the emptied jar's key. Check the closing first with:

```
npx tsx scripts/close-run-wallet.ts mainnet --folder "/home/ubuntu/projects/grandma's-wallet/.mainnet/runs/first" --destroy e09edd5076df2b7f9f35e37bf72cc575ecb73458057953c8a57dc06400a1bab0
```

Run it again with `--send` added to send it. `--funder <funding key file>` is needed only if nothing but the controller is left.

What these commands need:

- The pages built from this checkout.
- Ports 8701 to 8703, 8711 and 8712 free on this machine. The course serves the pages and stores there itself, with the stores' data from the folder.
- mainnet's servers reachable, and the funding key file readable.
- No other run using the folder.

Anna's balance (17,632 sat) covers the completion. Nothing else needs funding.

If the run stops after the completion was sent, do not run `--from 6` again. Read the chain first. If the new phone already holds the wallet, go on with `--from 7`.

The continuation from step 6, and the closing on mainnet, have not been run before. The closing was only checked against the folder tonight (it read the old phone's keys, found the owner and the coins, and stopped at the jar's key because no `--destroy` was given). It was not built in full or sent.

## Log

```
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
   3 s  6. A new phone asks Anna to move the wallet; her page sends the request, and it goes into a block
   5 s     waiting for the recoverer's page to open the wallet's account (its engine's header check): at most 3 min, until 01:53:44 UTC
   9 s     the recoverer's page to open the wallet's account (its engine's header check): after 4 s
  11 s     the new phone's wallet shows mainnet's statement before it starts
  12 s     confirmed; the band in view says "! Mainnet: not audited, coins can be lost"
  13 s     the new phone sent its request over the session of the code
  13 s     waiting for Anna's page to sign the request, held back from the network: at most 1 min
  14 s     Anna's page signed the request; it is held back from the network (1 message) while what both pages keep is copied to disk
  14 s     on disk before the request goes out: the new phone's words and its takeover request (storage-new-phone.json, and its profile), and Anna's saved takeover to the key c7c6ac2b… (storage-recoverer.json)
  14 s     the request is let through to the network
  20 s     Anna's page to show "Your request is waiting", once the server has the request: after 6 s
  20 s     the request: transaction c142f6c58e121b7c7861a994d9c0ddc2ce8822d94578ee91939acceaa34d9896
  20 s     waiting for a block to hold the recovery request (on mainnet about ten minutes; at most 40 minutes): at most 40 min (the run's bound leaves 35.7 min), until 02:26:39 UTC
 321 s     the request is in a block, 301 s after it was let through; the recoverer's page shows the chain's clock at 02:26:33 AM, block 978237; the waiting period ends when it passes Nov 22, 2026, 02:21:28 AM
 334 s  record written to docs/runs/mainnet-recovery-started.md
```
