# Stage 6 scripted run in a browser, against the local node

Written by `scripts/browser-run.ts` on 2026-11-18 00:35 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run/`. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node and two backup stores on this machine. The run made the blocks and moved the chain's clock. Times are seconds since the start.

Outcome: every step was carried out.

```
   0 s  local node: node: running, block 524, median time 2026-11-18T00:39:47Z
   1 s  1. The recoverer opens its page and gives its link
   2 s     link of 179 characters; fingerprint 290f 8c5b e2c9 fff5
   2 s  2. The owner creates a wallet with Anna as recoverer
   3 s     the wallet shows the same fingerprint, 290f 8c5b e2c9 fff5
   3 s     funding address bchtest:qrfz434nq2ue9cw93k730grqacyp0y05tc3d9pt6u4
   4 s     paid 120000 satoshis in fa0f18dc613c27e091be971af392edd21901f7d2af7400729401f62aa7c394c3:0, confirmed at height 525
   9 s     created; waiting for a block, which the run makes now
  14 s     confirmed; the kit link has 1288 characters
  14 s  3. Anna takes in the kit; the wallet says that recovery is on
  15 s     the recoverer kept the kit and left its receipt
  44 s     the wallet shows "Protected"
  44 s  4. The owner receives
  44 s     address bchtest:pwd54faw75sg8yz49nup5xcgh2a0l0pw5acdaad0zg062y5ts0tpg909pxgtz
  45 s     paid 50000 satoshis in 24049d0471ef395ca7f586c6322ec2011ab0163cde97d5c51717df2a266dc686:0, confirmed at height 527
  45 s     vault address bchtest:pwe2762r2czj65lnherr4znwm69j5jsaztq3puwrxda9nfkv0a9x5hfw5patd
  45 s     the wallet holds 0.00113679 BCH
  45 s  5. The owner pays, and sees the fee before sending
  45 s     the review shows a fee of 384 sat
  45 s     sent in d946b03a75bade2b75140859236ab1c2e4aa5b8825af5c06f297b5c460649189
  46 s  6. A request the owner did not make is refused
  47 s     a request from a phone with key c9ff d6aa e4de e387
  48 s     the recoverer (deceived, or its key stolen) asked the network
  59 s     the owner's phone shows the alarm
  59 s     refused
  74 s     the coin for cancelling paid for the refusal; the wallet says that it cannot refuse another
  89 s     a new coin is put aside; protected again
  89 s     the recoverer sees the refusal; the wallet is protected again
  89 s  7. The phone is lost
  89 s     the old phone's profile is no longer opened
  89 s  8. A new phone takes the wallet over with Anna's help, and sweeps
  90 s     both sides show 0051 397b 20a0 9424
 101 s     the request is in a block; the waiting period runs
 102 s     the chain's clock moved on by 700 seconds; height 543
 121 s     completed; the hand-over link is ready
 134 s     the new phone holds 0.00140147 BCH
 137 s     recovery is on for the new phone
 138 s     the old phone, opened again, says the wallet belongs to another key
 138 s  9. The wallet moves to a newer phone, the new phone still working
 140 s     the recoverer took in the update and left a prepared receipt
 155 s     the old phone made the change
 178 s     the newer phone holds 0.00137563 BCH; recovery is on
 178 s  10. Ben replaces Anna as recoverer
 181 s     Ben took the kit in as the new recoverer
 224 s     the wallet names Ben, and recovery is on with him
 225 s  11. The owner keeps a backup, and restores the wallet from it on another phone
 226 s     the complete backup has 6 lines, 2519 characters
 244 s     the restored phone shows 0.00136382 BCH, the same wallet with no waiting period
 244 s  12. The coins go back to where they came from
 244 s     the wallet sent everything: 0.00135746  BCH · 135,746 sat arrives, fee 636 sat
 246 s     Anna, no longer the recoverer, sent the rest of her allowance back: Sent; the fee was 185 satoshis.
```
