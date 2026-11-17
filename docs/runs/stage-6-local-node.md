# Stage 6 scripted run in a browser, against the local node

Written by `scripts/browser-run.ts` on 2026-11-17 23:49 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run/`. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node and two backup stores on this machine. The run made the blocks and moved the chain's clock. Times are seconds since the start.

Outcome: every step was carried out.

```
   0 s  local node: node: running, block 495, median time 2026-11-18T00:28:03Z
   1 s  1. The recoverer opens its page and gives its link
   1 s     link of 179 characters; fingerprint 7da1 c6d4 1df0 5c2d
   3 s  2. The owner creates a wallet with Anna as recoverer
   5 s     the wallet shows the same fingerprint, 7da1 c6d4 1df0 5c2d
   6 s     funding address bchtest:qz70dts7deejmfhcmr6z4fygnle79dv20uylzn8emx
   9 s     paid 120000 satoshis in d4982656d348c2271eae019dd48aab950186348ee3040679b7f95d5a371d7070:0, confirmed at height 496
  12 s     created; waiting for a block, which the run makes now
  18 s     confirmed; the kit link has 1288 characters
  19 s  3. Anna takes in the kit; the wallet says that recovery is on
  20 s     the recoverer kept the kit and left its receipt
  48 s     the wallet shows "Protected"
  48 s  4. The owner receives
  48 s     address bchtest:pdgkx585vwl2f2qt9529lzldk7030vwd8j3mm3hh9a28nhnpe5wdjslakr2kp
  49 s     paid 50000 satoshis in 06149ccc1d9eb9036cbe83daed93eebc343587b243b9c6e77b806f3b58758e22:0, confirmed at height 498
  50 s     vault address bchtest:pd9ejzkrtyvs5kc4apysv6kz6d6298esg9hzckjjzhk4vu88gxuqcxwc6h73e
  51 s     the wallet holds 0.00113679 BCH
  52 s  5. The owner pays, and sees the fee before sending
  52 s     the review shows a fee of 384 sat
  54 s     sent in 200e354bc472d5b8d75e1aee54d5fb82533131d5c9dfec936d02dc8e039080f4
  55 s  6. A request the owner did not make is refused
  56 s     a request from a phone with key 5fa6 c26a 299d 63de
  60 s     the recoverer (deceived, or its key stolen) asked the network
  70 s     the owner's phone shows the alarm
  71 s     refused
  78 s     the coin for cancelling paid for the refusal; the wallet says that it cannot refuse another
  93 s     a new coin is put aside; protected again
  93 s     the recoverer sees the refusal; the wallet is protected again
  93 s  7. The phone is lost
  93 s     the old phone's profile is no longer opened
  93 s  8. A new phone takes the wallet over with Anna's help, and sweeps
  95 s     both sides show 5e1d 2da6 86be af0a
 106 s     the request is in a block; the waiting period runs
 107 s     the chain's clock moved on by 700 seconds; height 514
 126 s     completed; the hand-over link is ready
 143 s     the new phone holds 0.00140147 BCH
 144 s     recovery is on for the new phone
 146 s     the old phone, opened again, says the wallet belongs to another key
 147 s  9. The wallet moves to a newer phone, the new phone still working
 150 s     the recoverer took in the update and left a prepared receipt
 164 s     the old phone made the change
 187 s     the newer phone holds 0.00137563 BCH; recovery is on
 188 s  10. Ben replaces Anna as recoverer
 191 s     Ben took the kit in as the new recoverer
 235 s     the wallet names Ben, and recovery is on with him
 238 s  11. The owner keeps a backup, and restores the wallet from it on another phone
 238 s     the complete backup has 6 lines, 2522 characters
 257 s     the restored phone shows 0.00136382 BCH, the same wallet with no waiting period
 258 s  12. The coins go back to where they came from
 259 s     the wallet sent everything: 0.00135746  BCH · 135,746 sat arrives, fee 636 sat
 261 s     Anna, no longer the recoverer, sent the rest of her allowance back: Sent; the fee was 185 satoshis.
```
