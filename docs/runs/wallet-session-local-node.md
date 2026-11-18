# The wallet course in a browser, against the local node, the recoverer set up with one scan

Written by `scripts/browser-run.ts local --screens --directory browser-run-session --record wallet-session-local-node.md` on 2026-11-18 11:13 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-session/`. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node, two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet was made with its recoverer through the session that the recoverer's code offers: the phone read the code, and the kit went straight to the recoverer's page. Times are seconds since the start.

Outcome: every step was carried out.

Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages' first server had it at that moment, and which of the wallet's transactions were not in a block yet when the page had already gone on.

- From the payment to the wallet in use, its kit on the way to Anna's page: 5 s; the chain is at height 108; not in a block yet: the creation 085a5fc75bdc…; in a block: 1 of the 2 transactions looked at.
- From the payment to "Protected", recovery on: 35 s; the chain is at height 108; not in a block yet: the creation 085a5fc75bdc…; in a block: 1 of the 2 transactions looked at.
- From the payment to the vault address shown: 37 s; the chain is at height 109; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
- A payment from the wallet, 40 s after the payment that funded it; the chain is at height 109; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" dd7ad3f1fd4c…; in a block: 2 of the 3 transactions looked at.
- From the refusal to "Protected" again: 8 s; the chain is at height 112; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
- From the completion to the hand-over link: 10 s; the chain is at height 124.
- From the completion to the sweep sent by the new phone: 14 s; the chain is at height 124; not in a block yet: "Moved 2 coins from earlier addresses" 99f3af556d3d…, the completion 698ba48a8c19…; in a block: 5 of the 7 transactions looked at.
- From the completion to the swept coins in the new phone's wallet: 23 s; the chain is at height 127; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
- From the completion to "Protected" on the new phone: 23 s.
- From the move link opened on the newer phone to the sweep it sent: 21 s; the chain is at height 128; not in a block yet: "Moved 1 coins from earlier addresses" 3444aca6af0c…; in a block: 8 of the 9 transactions looked at.
- From the move link opened on the newer phone to its wallet in use with recovery on: 38 s; the chain is at height 129; not in a block yet: none; in a block: 9 of the 9 transactions looked at.
- From Ben keeping the kit to "Recovery is on with Ben": 29 s; the chain is at height 130; not in a block yet: none; in a block: 10 of the 10 transactions looked at.

What these show:

- From the payment that funded the wallet to a wallet in use with recovery on (35 s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".
- From the completed recovery to the swept coins, no step waited for a block: 14 s after the completion the new phone sent its sweep, and neither the completion nor the sweep was in a block yet.
- The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.

```
   0 s  local node: node: running, block 107, median time 2026-11-18T10:51:36Z
   0 s  relay: ws://127.0.0.1:37233, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8101/, this checkout at 475d666, regtest
   1 s  recoverer page: http://localhost:8102/, this checkout at 475d666, regtest
   1 s  1. The recoverer opens its page and shows its code
   3 s     link of 179 characters; fingerprint 2d64 dd9f e5c5 8072
   3 s     the code on "Your link" carries the link and a session, 288 characters; the page stays open on that screen
   4 s  2. The owner creates a wallet with Anna as recoverer
   5 s     the wallet shows the same fingerprint, 2d64 dd9f e5c5 8072
   6 s     the recoverer's page shows that a phone is connected
   8 s     funding address bchtest:qqwt0n49x63r00mqkp4sjausd0j6aekuucu3ugdq7j
   9 s     what the two pages keep, the wallet's words among it, is copied to .chipnet/browser-run-session/storage-*.json before anything is paid
  10 s     paid 120000 satoshis in 9989a7323b9b32ed3d28c38f6ab6b9ba1138583910a069ac4b3e62f73339fca3:0, confirmed at height 108
  15 s     created; the wallet sends the kit to Anna's page (its link, 1288 characters, folded away)
  15 s     From the payment to the wallet in use, its kit on the way to Anna's page: 5 s; the chain is at height 108; not in a block yet: the creation 085a5fc75bdc…; in a block: 1 of the 2 transactions looked at.
  15 s     the wallet shows that Anna's page has the kit
  16 s  3. Anna takes in the kit; the wallet says that recovery is on
  16 s     the kit arrived on Anna's page, still on "Your link"
  17 s     the recoverer kept the kit and left its receipt
  19 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  22 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  44 s     the wallet shows "Protected"
  44 s     From the payment to "Protected", recovery on: 35 s; the chain is at height 108; not in a block yet: the creation 085a5fc75bdc…; in a block: 1 of the 2 transactions looked at.
  44 s  4. The owner receives
  44 s     address bchtest:pww59kdhsq2vrjjz840e5qcv369c9q0rzf4ef7dpara7ntgxkyjcqnpctfc38
  45 s     paid 50000 satoshis in 95760487422aadbf1c76cb3593c9e42a20cbf61eb2d24ef384b09b98b06f5210:0, confirmed at height 109
  46 s     vault address bchtest:pvmufgzuxj4nfle8t772gz8uqcfkx3c5q0nvkyx6g5ae0uj078u97jwhs7arw
  46 s     From the payment to the vault address shown: 37 s; the chain is at height 109; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  47 s     the wallet holds 0.00163723 BCH
  48 s  5. The owner pays, and sees the fee before sending
  48 s     the review shows a fee of 384 sat
  49 s     sent in dd7ad3f1fd4ce869b20a1aecbfd5496efdb2c14f85094ceecb9475354855963d
  49 s     A payment from the wallet, 40 s after the payment that funded it; the chain is at height 109; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" dd7ad3f1fd4c…; in a block: 2 of the 3 transactions looked at.
  51 s  6. A request the owner did not make is refused
  52 s     a request from a phone with key 3f36 55ec d4c0 725e
  54 s     the recoverer (deceived, or its key stolen) asked the network
  65 s     the owner's phone shows the alarm
  66 s     refused
  75 s     the fee of the refusal came from the wallet's coins; protected again
  75 s     From the refusal to "Protected" again: 8 s; the chain is at height 112; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  75 s     the recoverer sees the refusal; the wallet is protected again
  75 s  7. The phone is lost
  75 s     the old phone's profile is no longer opened
  75 s  8. A new phone takes the wallet over with Anna's help, and sweeps
  77 s     both sides show 191a de98 1041 d7e6
  88 s     the request is in a block; the waiting period runs
  89 s     the chain's clock moved on by 700 seconds; height 124
 108 s     completed; the hand-over link is ready
 108 s     From the completion to the hand-over link: 10 s; the chain is at height 124.
 112 s     From the completion to the sweep sent by the new phone: 14 s; the chain is at height 124; not in a block yet: "Moved 2 coins from earlier addresses" 99f3af556d3d…, the completion 698ba48a8c19…; in a block: 5 of the 7 transactions looked at.
 122 s     the new phone holds 0.00140845 BCH
 122 s     From the completion to the swept coins in the new phone's wallet: 23 s; the chain is at height 127; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
 122 s     recovery is on for the new phone
 122 s     From the completion to "Protected" on the new phone: 23 s.
 124 s     the old phone, opened again, says the wallet belongs to another key
 125 s  9. The wallet moves to a newer phone, the new phone still working
 129 s     the recoverer took in the update and left a prepared receipt
 143 s     the old phone made the change
 150 s     From the move link opened on the newer phone to the sweep it sent: 21 s; the chain is at height 128; not in a block yet: "Moved 1 coins from earlier addresses" 3444aca6af0c…; in a block: 8 of the 9 transactions looked at.
 166 s     the newer phone holds 0.00138565 BCH; recovery is on
 167 s     From the move link opened on the newer phone to its wallet in use with recovery on: 38 s; the chain is at height 129; not in a block yet: none; in a block: 9 of the 9 transactions looked at.
 167 s  10. Ben replaces Anna as recoverer
 170 s     Ben took the kit in as the new recoverer
 199 s     the wallet names Ben, and recovery is on with him
 199 s     From Ben keeping the kit to "Recovery is on with Ben": 29 s; the chain is at height 130; not in a block yet: none; in a block: 10 of the 10 transactions looked at.
 202 s  11. The owner keeps a backup, and restores the wallet from it on another phone
 203 s     the complete backup has 6 lines, 2513 characters
 233 s     the restored phone shows 0.00137384 BCH, the same wallet with no waiting period
 235 s  12. The coins go back to where they came from
 236 s     the wallet sent everything: 0.00137044  BCH · 137,044 sat arrives, fee 340 sat
 240 s     Anna, no longer the recoverer, sent the rest of her allowance back: Sent; the fee was 185 satoshis.
```
