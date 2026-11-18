# The wallet course in a browser, against the local node, the wallet set up by its recoverer

Written by `scripts/browser-run.ts local --until 7 --record chain-clock-browser-local-node.md` on 2026-11-18 20:15 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run/`. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node, two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet was set up by its recoverer: the phone took in Anna's code and asked over the session it offers, Anna said yes on her page, and her page created the wallet from her own coins. Times are seconds since the start.

Outcome: stopped after step 7, as asked.

Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages' first server had it at that moment, and which of the wallet's transactions were not in a block yet when the page had already gone on.

- From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 368; not in a block yet: the creation 041117b412b5…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to "Protected", recovery on: 17 s; the chain is at height 368; not in a block yet: the creation 041117b412b5…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to the vault address shown: 18 s; the chain is at height 370; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
- A payment from the wallet, 26 s after "Set it up"; the chain is at height 370; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" 92b43b4c277a…; in a block: 2 of the 3 transactions looked at.
- From the refusal to "Protected" again: 9 s; the chain is at height 373; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
- From the completion to the hand-over: 10 s; the chain is at height 385.
- From the completion to the sweep sent by the new phone: 11 s; the chain is at height 385; not in a block yet: "Moved 2 coins from earlier addresses" a1ae647c2e98…, the completion 4dca13746246…; in a block: 5 of the 7 transactions looked at.
- From the completion to the swept coins in the new phone's wallet: 22 s; the chain is at height 389; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
- From the completion to "Protected" on the new phone: 22 s.

What these show:

- From the moment the wallet was asked for to a wallet in use with recovery on (17 s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".
- From the completed recovery to the swept coins, no step waited for a block: 11 s after the completion the new phone sent its sweep, and neither the completion nor the sweep was in a block yet.
- The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.

```
   0 s  local node: node: running, block 367, median time 2026-11-18T20:18:45Z
   0 s  relay: ws://127.0.0.1:46325, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8101/, this checkout at af44d28, regtest
   1 s  recoverer page: http://localhost:8102/, this checkout at af44d28, regtest
   1 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   2 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
   2 s     Anna's balance is funded at bchtest:qphdqmkmnz65307gwpkndqmmw8v0xfelf54uhscta8; what her page keeps, her words among it, is copied to .chipnet/browser-run/storage-recoverer.json first
   3 s     paid 400000 satoshis in c14eb2d9dc2eaf61086a810d53af8cdb43f46994fa6cb0d64d07d598cefed687:0, confirmed at height 368
  10 s     Anna's page shows her balance: 400000 satoshis
  10 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  11 s     Anna's code carries her name, her key and a session, 292 characters
  12 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  13 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  13 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  13 s     From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 368; not in a block yet: the creation 041117b412b5…; in a block: 1 of the 2 transactions looked at.
  13 s     Anna's page says the wallet is set up and keeps what a recovery needs
  18 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  28 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  28 s     From "Set it up" to "Protected", recovery on: 17 s; the chain is at height 368; not in a block yet: the creation 041117b412b5…; in a block: 1 of the 2 transactions looked at.
  29 s  3. The owner receives
  29 s     address bchtest:r0v5qmtzceleslry8kzx38yed8jcjwyt2aczwumykqtmkzc22hhr278dalhmu
  30 s     paid 50000 satoshis in 384dfcd3529a1880813bf9401fa1a83fac118729d709553560e56e96346f01d0:0, confirmed at height 370
  30 s     vault address bchtest:r0t9hxwg7w6dzfplr8vek6w9vcfsuf269rn090rwyk7fu0e7zdu3ja4agvmp8
  30 s     From "Set it up" to the vault address shown: 18 s; the chain is at height 370; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  37 s     the wallet holds 0.0015 BCH
  37 s  4. The owner pays, and sees the fee before sending
  37 s     the review shows a fee of 384 sat
  37 s     sent in 92b43b4c277a3178334a3416f1f014becb8da796a12f7122e847ad3ce272f763
  37 s     A payment from the wallet, 26 s after "Set it up"; the chain is at height 370; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" 92b43b4c277a…; in a block: 2 of the 3 transactions looked at.
  38 s  5. A request the owner did not make is refused
  38 s     the owner turned "Refuse requests without asking" off, to be asked first
  42 s     the new phone sent its request over the session of the code
  42 s     the recoverer (deceived, or its key stolen) asked the network
  49 s     the owner's phone shows the alarm
  50 s     refused
  59 s     the fee of the refusal came from the wallet's coins; protected again
  59 s     From the refusal to "Protected" again: 9 s; the chain is at height 373; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  59 s     the recoverer sees the refusal; the wallet is protected again
  59 s  6. The phone is lost
  59 s     the old phone's profile is no longer opened
  59 s  7. A new phone takes the wallet over with Anna's help, and sweeps
  62 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  63 s     the new phone sent its request over the session of the code
  70 s     the request is in a block; the waiting period runs
  70 s     the recoverer's page shows the chain's clock at 09:18:46 PM, block 374; the waiting period ends when it passes 09:27:18 PM
  71 s     the chain's clock moved on by 700 seconds; height 385
  75 s     the chain's clock on the page moved on by 701 seconds, to block 385
  91 s     completed; the hand-over is ready
  91 s     From the completion to the hand-over: 10 s; the chain is at height 385.
  91 s     the hand-over reached the new phone over the session
  91 s     the recoverer's page says that the new phone has the wallet
  92 s     From the completion to the sweep sent by the new phone: 11 s; the chain is at height 385; not in a block yet: "Moved 2 coins from earlier addresses" a1ae647c2e98…, the completion 4dca13746246…; in a block: 5 of the 7 transactions looked at.
  94 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
 103 s     the new phone holds 0.00127122 BCH
 103 s     From the completion to the swept coins in the new phone's wallet: 22 s; the chain is at height 389; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
 103 s     recovery is on for the new phone
 103 s     From the completion to "Protected" on the new phone: 22 s.
 104 s     the old phone, opened again, says the wallet belongs to another key
```
