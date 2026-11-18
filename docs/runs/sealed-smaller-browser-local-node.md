# The wallet course in a browser, against the local node, the wallet set up by its recoverer

Written by `scripts/browser-run.ts local --until 7 --screens --record sealed-smaller-browser-local-node.md` on 2026-11-18 20:47 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run/`. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node, two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet was set up by its recoverer: the phone took in Anna's code and asked over the session it offers, Anna said yes on her page, and her page created the wallet from her own coins. Times are seconds since the start.

Outcome: stopped after step 7, as asked.

Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages' first server had it at that moment, and which of the wallet's transactions were not in a block yet when the page had already gone on.

- From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 457; not in a block yet: the creation 2b978ca3277d…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to "Protected", recovery on: 18 s; the chain is at height 457; not in a block yet: the creation 2b978ca3277d…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to the vault address shown: 20 s; the chain is at height 459; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
- A payment from the wallet, 29 s after "Set it up"; the chain is at height 459; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" 6dd7527f5930…; in a block: 2 of the 3 transactions looked at.
- From the refusal to "Protected" again: 14 s; the chain is at height 462; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
- From the completion to the hand-over: 10 s; the chain is at height 474.
- From the completion to the sweep sent by the new phone: 13 s; the chain is at height 474; not in a block yet: "Moved 2 coins from earlier addresses" 732da6414988…, the completion 66e7fb6d0105…; in a block: 5 of the 7 transactions looked at.
- From the completion to the swept coins in the new phone's wallet: 23 s; the chain is at height 478; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
- From the completion to "Protected" on the new phone: 23 s.

What these show:

- From the moment the wallet was asked for to a wallet in use with recovery on (18 s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".
- From the completed recovery to the swept coins, no step waited for a block: 13 s after the completion the new phone sent its sweep, and neither the completion nor the sweep was in a block yet.
- The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.

```
   0 s  local node: node: running, block 456, median time 2026-11-18T21:12:03Z
   0 s  relay: ws://127.0.0.1:45583, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8101/, this checkout at 7162bf1, regtest
   1 s  recoverer page: http://localhost:8102/, this checkout at 7162bf1, regtest
   1 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   3 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
   3 s     Anna's balance is funded at bchtest:qrccf682q9sesjmkdwkdljd9s8xm2sywkc3aeuy7at; what her page keeps, her words among it, is copied to .chipnet/browser-run/storage-recoverer.json first
   4 s     paid 400000 satoshis in 798d13c8ba20ed48a9a2765f2dc1125745987e92f1400179001c8027f1a9a307:0, confirmed at height 457
  12 s     Anna's page shows her balance: 400000 satoshis
  12 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  13 s     Anna's code carries her name, her key and a session, 292 characters
  15 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  17 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  18 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  18 s     From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 457; not in a block yet: the creation 2b978ca3277d…; in a block: 1 of the 2 transactions looked at.
  19 s     Anna's page says the wallet is set up and keeps what a recovery needs
  23 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  34 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  34 s     From "Set it up" to "Protected", recovery on: 18 s; the chain is at height 457; not in a block yet: the creation 2b978ca3277d…; in a block: 1 of the 2 transactions looked at.
  35 s  3. The owner receives
  35 s     address bchtest:rdmyka2nykxysv46g3tdfda5wy77dpek03ljqdljm65cse70x9erjar9atk3d
  36 s     paid 50000 satoshis in 106d0c9e6bf2541d8e8b8640b3cbaa0f58e16bf2101df5b0af545f172bd60c40:0, confirmed at height 459
  37 s     vault address bchtest:r07mewzq63ddaseapcgy3mhd30yldclf7h8r8rsqj9mfq544lpts68zcscm0g
  37 s     From "Set it up" to the vault address shown: 20 s; the chain is at height 459; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  44 s     the wallet holds 0.0015 BCH
  44 s  4. The owner pays, and sees the fee before sending
  45 s     the review shows a fee of 384 sat
  46 s     sent in 6dd7527f59305dd37ad7fd0307a9260e74aaeeff3f163acc40965df66bee1d6a
  46 s     A payment from the wallet, 29 s after "Set it up"; the chain is at height 459; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" 6dd7527f5930…; in a block: 2 of the 3 transactions looked at.
  47 s  5. A request the owner did not make is refused
  47 s     the owner turned "Refuse requests without asking" off, to be asked first
  51 s     the new phone sent its request over the session of the code
  51 s     the recoverer (deceived, or its key stolen) asked the network
  64 s     the owner's phone shows the alarm
  65 s     refused
  79 s     the fee of the refusal came from the wallet's coins; protected again
  79 s     From the refusal to "Protected" again: 14 s; the chain is at height 462; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  79 s     the recoverer sees the refusal; the wallet is protected again
  79 s  6. The phone is lost
  79 s     the old phone's profile is no longer opened
  79 s  7. A new phone takes the wallet over with Anna's help, and sweeps
  81 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  83 s     the new phone sent its request over the session of the code
  90 s     the request is in a block; the waiting period runs
  90 s     the recoverer's page shows the chain's clock at 10:12:04 PM, block 463; the waiting period ends when it passes 10:20:36 PM
  91 s     the chain's clock moved on by 700 seconds; height 474
  94 s     the chain's clock on the page moved on by 701 seconds, to block 474
 110 s     completed; the hand-over is ready
 110 s     From the completion to the hand-over: 10 s; the chain is at height 474.
 111 s     the hand-over reached the new phone over the session
 111 s     the recoverer's page says that the new phone has the wallet
 113 s     From the completion to the sweep sent by the new phone: 13 s; the chain is at height 474; not in a block yet: "Moved 2 coins from earlier addresses" 732da6414988…, the completion 66e7fb6d0105…; in a block: 5 of the 7 transactions looked at.
 114 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
 124 s     the new phone holds 0.00127122 BCH
 124 s     From the completion to the swept coins in the new phone's wallet: 23 s; the chain is at height 478; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
 124 s     recovery is on for the new phone
 124 s     From the completion to "Protected" on the new phone: 23 s.
 126 s     the old phone, opened again, says the wallet belongs to another key
```
