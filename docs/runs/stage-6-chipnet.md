# Stage 6 scripted run in a browser, on chipnet with the public pages (run C)

Written by `scripts/browser-run.ts`, started on 2026-11-17 23:58 UTC and continued on 2026-11-18 00:32 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-chipnet/`. The pages are the public ones, https://wallet.9500.cash/ and https://recoverer.9500.cash/, as served, on chipnet with the public backup stores. Blocks and the waiting period took their real time. Times are seconds since the start.

Outcome: every step was carried out. The run stopped once, in step 11, when the chipnet server refused new connections, and was continued from that step with the same browser profiles.

```
   1 s  wallet page: https://wallet.9500.cash/, commit 7ef8e7e of design-2, released 2026-11-17T23:56:43Z
   1 s  recoverer page: https://recoverer.9500.cash/, commit 7ef8e7e of design-2, released 2026-11-17T23:56:43Z
   2 s  funding address: 980172 satoshis in 1 coin at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   2 s  1. The recoverer opens its page and gives its link
   4 s     link of 188 characters; fingerprint bd10 6792 b85d 994a
   5 s  2. The owner creates a wallet with Anna as recoverer
   8 s     the wallet shows the same fingerprint, bd10 6792 b85d 994a
  16 s     funding address bchtest:qznjtwem8mesat60v4wt6y54af0f0u004qhu5jw80w
  17 s     paid 120000 satoshis in 5ef4cf1208a50390ae6c9160ea5085540ad5541882ac83ad2c91d87623feb46c:0, unconfirmed
  22 s     created; waiting for a block
 184 s     confirmed; the kit link has 1302 characters
 184 s  3. Anna takes in the kit; the wallet says that recovery is on
 186 s     the recoverer kept the kit and left its receipt
 215 s     the wallet shows "Protected"
 215 s  4. The owner receives
 216 s     address bchtest:pvz598elygf45qd2s68qcje2r22pjv3cstk38wdtxcw53wjx90g22frj7wz62
 216 s     paid 50000 satoshis in 45cd3b1b5a5feab513a9de45fd5e534fd7e364183c26979758c5670b27c71ccd:0, unconfirmed
 216 s     vault address bchtest:p0qyhkys5sz0e9lur9ezh2h62pw5zdfp4kxm9wd9n67sm9genwvssk8pvuy9p
 217 s     the wallet holds 0.00113679 BCH
 217 s  5. The owner pays, and sees the fee before sending
 217 s     the review shows a fee of 384 sat
 217 s     sent in 41447812d3db1475d2e13b196bc67201219d4356b99d2219adc44eea38adace6
 217 s  6. A request the owner did not make is refused
 219 s     a request from a phone with key 8ffe d228 90ab ead6
 230 s     the recoverer (deceived, or its key stolen) asked the network
 246 s     the owner's phone shows the alarm
 246 s     refused
 260 s     the coin for cancelling paid for the refusal; the wallet says that it cannot refuse another
 276 s     a new coin is put aside; protected again
 276 s     the recoverer sees the refusal; the wallet is protected again
 276 s  7. The phone is lost
 276 s     the old phone's profile is no longer opened
 276 s  8. A new phone takes the wallet over with Anna's help, and sweeps
 281 s     both sides show b801 f107 da38 a352
 294 s     the request is in a block; the waiting period runs
 294 s     the waiting period takes its real time
 755 s     completed; the hand-over link is ready
 809 s     the new phone holds 0.00140147 BCH
 809 s     recovery is on for the new phone
 811 s     the old phone, opened again, says the wallet belongs to another key
 811 s  9. The wallet moves to a newer phone, the new phone still working
 818 s     the recoverer took in the update and left a prepared receipt
 831 s     the old phone made the change
 952 s     the newer phone holds 0.00137563 BCH; recovery is on
 952 s  10. Ben replaces Anna as recoverer
 962 s     Ben took the kit in as the new recoverer
 973 s     the wallet names Ben, and recovery is on with him
 974 s  11. The owner keeps a backup, and restores the wallet from it on another phone
 975 s     the complete backup has 6 lines, 2530 characters
 980 s    [restored-phone] console: WebSocket connection to 'wss://chipnet.9500.cash/' failed: Error during WebSocket handshake: Unexpected response code: 502
 980 s    [restored-phone] console: WebSocket connection to 'wss://chipnet.9500.cash/' failed: Error during WebSocket handshake: Unexpected response code: 502
 980 s    [restored-phone] console: Error: Cannot bootstrap the header accumulator: no electrum clients are connected.
       the chipnet server the pages use first was at its limit of connections and refused new ones (502) from 00:14 UTC, with five browser profiles open, each page holding two connections to it; the restored phone could not open its keys
       the run was stopped at 1947 s; the server's limit was raised by its operator, and it answered again at 00:29 UTC
       continued from step 11 on 2026-11-18 00:32 UTC with the same browser profiles; the times below are seconds since then
   1 s  wallet page: https://wallet.9500.cash/, commit 7ef8e7e of design-2, released 2026-11-17T23:56:43Z
   1 s  recoverer page: https://recoverer.9500.cash/, commit 7ef8e7e of design-2, released 2026-11-17T23:56:43Z
   2 s  funding address: 829724 satoshis in 2 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   4 s     the newer phone's profile opens the wallet again: 0.00136382 BCH
   4 s  11. The owner keeps a backup, and restores the wallet from it on another phone
   6 s     the complete backup has 6 lines, 2530 characters
  87 s     the restored phone shows 0.00136382 BCH, the same wallet with no waiting period
  87 s  12. The coins go back to where they came from
  88 s     the wallet sent everything: 0.00135746  BCH · 135,746 sat arrives, fee 636 sat
  90 s     Anna, no longer the recoverer, sent the rest of her allowance back: Sent; the fee was 185 satoshis.
  96 s     funding address: 967233 satoshis in 4 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
```

## What the run cost

The funding address held 980,172 satoshis before the run and 967,233 after it: 12,939 satoshis. Of these, 1,000 are in the wallet's controller, which stays, because the page does not offer closing a wallet; the rest are network fees of the wallet's, the recoverer's and the payer's transactions. The wallet's coins and what was left of the first recoverer's allowance went back to the funding address in step 12. The second recoverer was given no allowance.

The browser profiles of the run, with the keys of every device in it, are kept in `.chipnet/browser-run-chipnet/profiles/`, outside git.
