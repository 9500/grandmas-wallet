# The wallet course in a browser, against the local node, the wallet set up by its recoverer

Written by `scripts/browser-run.ts local --screens --directory browser-run-setup --record wallet-set-up-local-node.md` on 2026-11-18 16:43 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-setup/`. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node, two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet was set up by its recoverer: the phone took in Anna's code and asked over the session it offers, Anna said yes on her page, and her page created the wallet from her own coins. Times are seconds since the start.

Outcome: every step was carried out.

Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages' first server had it at that moment, and which of the wallet's transactions were not in a block yet when the page had already gone on.

- From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 157; not in a block yet: the creation afec4743aa4b…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to "Protected", recovery on: 18 s; the chain is at height 157; not in a block yet: the creation afec4743aa4b…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to the vault address shown: 20 s; the chain is at height 159; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
- A payment from the wallet, 28 s after "Set it up"; the chain is at height 159; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" 059e1ab9dd50…; in a block: 2 of the 3 transactions looked at.
- From the refusal to "Protected" again: 14 s; the chain is at height 162; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
- From the completion to the hand-over: 10 s; the chain is at height 174.
- From the completion to the sweep sent by the new phone: 13 s; the chain is at height 174; not in a block yet: "Moved 2 coins from earlier addresses" e63f4dc8f09e…, the completion 2e6042f75622…; in a block: 5 of the 7 transactions looked at.
- From the completion to the swept coins in the new phone's wallet: 24 s; the chain is at height 178; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
- From the completion to "Protected" on the new phone: 24 s.
- From the move link opened on the newer phone to the sweep it sent: 22 s; the chain is at height 179; not in a block yet: "Moved 1 coin from earlier addresses" 30a84368fc38…; in a block: 8 of the 9 transactions looked at.
- From the move link opened on the newer phone to its wallet in use with recovery on: 37 s; the chain is at height 180; not in a block yet: none; in a block: 9 of the 9 transactions looked at.
- From Ben keeping the kit to "Recovery is on with Ben": 29 s; the chain is at height 181; not in a block yet: none; in a block: 10 of the 10 transactions looked at.

What these show:

- From the moment the wallet was asked for to a wallet in use with recovery on (18 s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".
- From the completed recovery to the swept coins, no step waited for a block: 13 s after the completion the new phone sent its sweep, and neither the completion nor the sweep was in a block yet.
- The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.

```
   0 s  local node: node: running, block 156, median time 2026-11-18T16:58:29Z
   0 s  relay: ws://127.0.0.1:42243, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8101/, this checkout at 7c497d3, regtest
   1 s  recoverer page: http://localhost:8102/, this checkout at 7c497d3, regtest
   1 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   4 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
   4 s     Anna's balance is funded at bchtest:qpdpaux089zd29fwzdphxclp95kcm00tasnys30078; what her page keeps, her words among it, is copied to .chipnet/browser-run-setup/storage-recoverer.json first
   4 s     paid 400000 satoshis in 826537e6ab43111536d6e7d1c01734d26cbb3475761c320a8131cda198a1980e:0, confirmed at height 157
  12 s     Anna's page shows her balance: 400000 satoshis
  13 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  13 s     Anna's code carries her name, her key and a session, 292 characters
  15 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  18 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  18 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  18 s     From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 157; not in a block yet: the creation afec4743aa4b…; in a block: 1 of the 2 transactions looked at.
  19 s     Anna's page says the wallet is set up and keeps what a recovery needs
  23 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  34 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  34 s     From "Set it up" to "Protected", recovery on: 18 s; the chain is at height 157; not in a block yet: the creation afec4743aa4b…; in a block: 1 of the 2 transactions looked at.
  35 s  3. The owner receives
  35 s     address bchtest:pdtfmtmrwlg0ddgy9zww0wphk96ey0kt3gemqj59x0re6ysamts927q57d0xt
  36 s     paid 50000 satoshis in ee66f4b61302ca06c5de18a803a9d18ac6a4c39373789486a9df2d80ae9b37d2:0, confirmed at height 159
  37 s     vault address bchtest:pww69lymlka0y8hd0hxy903jp7m5mh6vcmquglhvk7glrkptq4r22kl5e7cf5
  37 s     From "Set it up" to the vault address shown: 20 s; the chain is at height 159; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  43 s     the wallet holds 0.0015 BCH
  44 s  4. The owner pays, and sees the fee before sending
  44 s     the review shows a fee of 384 sat
  45 s     sent in 059e1ab9dd5020bb133ea517d789a772f9c4c0bba97d890109bd8a17b75603f6
  45 s     A payment from the wallet, 28 s after "Set it up"; the chain is at height 159; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" 059e1ab9dd50…; in a block: 2 of the 3 transactions looked at.
  47 s  5. A request the owner did not make is refused
  50 s     the new phone sent its request over the session of the code
  50 s     the recoverer (deceived, or its key stolen) asked the network
  64 s     the owner's phone shows the alarm
  65 s     refused
  79 s     the fee of the refusal came from the wallet's coins; protected again
  79 s     From the refusal to "Protected" again: 14 s; the chain is at height 162; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  79 s     the recoverer sees the refusal; the wallet is protected again
  79 s  6. The phone is lost
  79 s     the old phone's profile is no longer opened
  79 s  7. A new phone takes the wallet over with Anna's help, and sweeps
  82 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  84 s     the new phone sent its request over the session of the code
  90 s     the request is in a block; the waiting period runs
  91 s     the chain's clock moved on by 700 seconds; height 174
 110 s     completed; the hand-over is ready
 110 s     From the completion to the hand-over: 10 s; the chain is at height 174.
 111 s     the hand-over reached the new phone over the session
 111 s     the recoverer's page says that the new phone has the wallet
 113 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
 113 s     From the completion to the sweep sent by the new phone: 13 s; the chain is at height 174; not in a block yet: "Moved 2 coins from earlier addresses" e63f4dc8f09e…, the completion 2e6042f75622…; in a block: 5 of the 7 transactions looked at.
 124 s     the new phone holds 0.00127122 BCH
 124 s     From the completion to the swept coins in the new phone's wallet: 24 s; the chain is at height 178; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
 124 s     recovery is on for the new phone
 124 s     From the completion to "Protected" on the new phone: 24 s.
 126 s     the old phone, opened again, says the wallet belongs to another key
 127 s  8. The wallet moves to a newer phone, the new phone still working
 131 s     the recoverer took in the update and left a prepared receipt
 144 s     the old phone made the change
 153 s     From the move link opened on the newer phone to the sweep it sent: 22 s; the chain is at height 179; not in a block yet: "Moved 1 coin from earlier addresses" 30a84368fc38…; in a block: 8 of the 9 transactions looked at.
 168 s     the newer phone holds 0.00124842 BCH; recovery is on
 168 s     From the move link opened on the newer phone to its wallet in use with recovery on: 37 s; the chain is at height 180; not in a block yet: none; in a block: 9 of the 9 transactions looked at.
 169 s  9. Ben replaces Anna as recoverer
 171 s     the kit reached Ben's page over the session of his code
 172 s     Ben took the kit in as the new recoverer
 174 s    [newer-phone] console: WebSocket is already in CLOSING or CLOSED state.
 178 s    [second-recoverer] console: WebSocket is already in CLOSING or CLOSED state.
 201 s     the wallet names Ben, and recovery is on with him
 201 s     From Ben keeping the kit to "Recovery is on with Ben": 29 s; the chain is at height 181; not in a block yet: none; in a block: 10 of the 10 transactions looked at.
 204 s  10. The owner keeps a backup, and restores the wallet from it on another phone
 205 s     the complete backup has 6 lines, 2513 characters
 224 s     the restored phone shows 0.00123661 BCH, the same wallet with no waiting period
 225 s  11. The coins go back to where they came from
 226 s     the wallet sent everything: 0.00123321  BCH · 123,321 sat arrives, fee 340 sat
 229 s     Anna, no longer the recoverer, sent on what was left at the wallet's fee address: Sent; the fee was 185 satoshis.
```
