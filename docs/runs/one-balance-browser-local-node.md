# The wallet course in a browser, against the local node, the wallet set up by its recoverer

Written by `scripts/browser-run.ts local --record one-balance-browser-local-node.md` on 2026-11-18 19:45 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run/`. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node, two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet was set up by its recoverer: the phone took in Anna's code and asked over the session it offers, Anna said yes on her page, and her page created the wallet from her own coins. Times are seconds since the start.

Outcome: every step was carried out.

Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages' first server had it at that moment, and which of the wallet's transactions were not in a block yet when the page had already gone on.

- From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 341; not in a block yet: the creation 4645e3ff211e…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to "Protected", recovery on: 17 s; the chain is at height 341; not in a block yet: the creation 4645e3ff211e…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to the vault address shown: 18 s; the chain is at height 343; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
- A payment from the wallet, 26 s after "Set it up"; the chain is at height 343; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" 0bb5de7cc7d1…; in a block: 2 of the 3 transactions looked at.
- From the refusal to "Protected" again: 9 s; the chain is at height 346; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
- From the completion to the hand-over: 10 s; the chain is at height 358.
- From the completion to the sweep sent by the new phone: 11 s; the chain is at height 358; not in a block yet: "Moved 2 coins from earlier addresses" 3f5ae7b02676…, the completion 1d9c9999ae34…; in a block: 5 of the 7 transactions looked at.
- From the completion to the swept coins in the new phone's wallet: 23 s; the chain is at height 362; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
- From the completion to "Protected" on the new phone: 23 s.
- From the move link opened on the newer phone to the sweep it sent: 21 s; the chain is at height 363; not in a block yet: "Moved 1 coin from earlier addresses" 629861d9c9ed…; in a block: 8 of the 9 transactions looked at.
- From the move link opened on the newer phone to its wallet in use with recovery on: 37 s; the chain is at height 364; not in a block yet: none; in a block: 9 of the 9 transactions looked at.
- From Ben keeping the kit to "Recovery is on with Ben": 28 s; the chain is at height 365; not in a block yet: none; in a block: 10 of the 10 transactions looked at.

What these show:

- From the moment the wallet was asked for to a wallet in use with recovery on (17 s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".
- From the completed recovery to the swept coins, no step waited for a block: 11 s after the completion the new phone sent its sweep, and neither the completion nor the sweep was in a block yet.
- The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.

```
   0 s  local node: node: running, block 239, median time 2026-11-18T20:06:44Z
   0 s  relay: ws://127.0.0.1:43411, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8101/, this checkout at cf6d4cd, regtest
   1 s  recoverer page: http://localhost:8102/, this checkout at cf6d4cd, regtest
   1 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   2 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
   2 s     Anna's balance is funded at bchtest:qzd4p5ms6ka2gymrfthzgmeywacu8cuv9uzs2gux34; what her page keeps, her words among it, is copied to .chipnet/browser-run/storage-recoverer.json first
   3 s     paid 400000 satoshis in 42bb3e4030485afe92543ca76c8aa5ed71d49afdb174d625b9961ab1c46f1e8c:0, confirmed at height 341
  10 s     Anna's page shows her balance: 400000 satoshis
  10 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  11 s     Anna's code carries her name, her key and a session, 291 characters
  11 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  12 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  13 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  13 s     From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 341; not in a block yet: the creation 4645e3ff211e…; in a block: 1 of the 2 transactions looked at.
  13 s     Anna's page says the wallet is set up and keeps what a recovery needs
  18 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  28 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  28 s     From "Set it up" to "Protected", recovery on: 17 s; the chain is at height 341; not in a block yet: the creation 4645e3ff211e…; in a block: 1 of the 2 transactions looked at.
  29 s  3. The owner receives
  29 s     address bchtest:rvxt7n74wzee6xkq6mrwvn2t53xffrcx7edkcap2ad53pdtwze33uc0ge9fku
  30 s     paid 50000 satoshis in 997b15fb546b3d7339a3a077591d395940f0fa15fc930669a5480353b6655156:0, confirmed at height 343
  30 s     vault address bchtest:rwk4qfv94hvg0cdmgnw6fkgu3f4syfqw324c9gjfrfapr3n7ehcsxyfaas8l0
  30 s     From "Set it up" to the vault address shown: 18 s; the chain is at height 343; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  37 s     the wallet holds 0.0015 BCH
  37 s  4. The owner pays, and sees the fee before sending
  37 s     the review shows a fee of 384 sat
  37 s     sent in 0bb5de7cc7d1feb91a3e66883ad6455c90c9045630bd65ca21d133035f43be0a
  37 s     A payment from the wallet, 26 s after "Set it up"; the chain is at height 343; not in a block yet: "Sent 20,000 sat to qqg3zyg3zy…jfagm9" 0bb5de7cc7d1…; in a block: 2 of the 3 transactions looked at.
  38 s  5. A request the owner did not make is refused
  38 s     the owner turned "Refuse requests without asking" off, to be asked first
  41 s     the new phone sent its request over the session of the code
  41 s     the recoverer (deceived, or its key stolen) asked the network
  49 s     the owner's phone shows the alarm
  49 s     refused
  58 s     the fee of the refusal came from the wallet's coins; protected again
  58 s     From the refusal to "Protected" again: 9 s; the chain is at height 346; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  59 s     the recoverer sees the refusal; the wallet is protected again
  59 s  6. The phone is lost
  59 s     the old phone's profile is no longer opened
  59 s  7. A new phone takes the wallet over with Anna's help, and sweeps
  61 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  62 s     the new phone sent its request over the session of the code
  70 s     the request is in a block; the waiting period runs
  71 s     the chain's clock moved on by 700 seconds; height 358
  90 s     completed; the hand-over is ready
  90 s     From the completion to the hand-over: 10 s; the chain is at height 358.
  91 s     the hand-over reached the new phone over the session
  91 s     the recoverer's page says that the new phone has the wallet
  92 s     From the completion to the sweep sent by the new phone: 11 s; the chain is at height 358; not in a block yet: "Moved 2 coins from earlier addresses" 3f5ae7b02676…, the completion 1d9c9999ae34…; in a block: 5 of the 7 transactions looked at.
  94 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
 103 s     the new phone holds 0.00127122 BCH
 103 s     From the completion to the swept coins in the new phone's wallet: 23 s; the chain is at height 362; not in a block yet: none; in a block: 7 of the 7 transactions looked at.
 103 s     recovery is on for the new phone
 103 s     From the completion to "Protected" on the new phone: 23 s.
 104 s     the old phone, opened again, says the wallet belongs to another key
 104 s  8. The wallet moves to a newer phone, the new phone still working
 106 s     the recoverer took in the update and left a prepared receipt
 122 s     the old phone made the change
 127 s     From the move link opened on the newer phone to the sweep it sent: 21 s; the chain is at height 363; not in a block yet: "Moved 1 coin from earlier addresses" 629861d9c9ed…; in a block: 8 of the 9 transactions looked at.
 143 s     the newer phone holds 0.00124842 BCH; recovery is on
 143 s     From the move link opened on the newer phone to its wallet in use with recovery on: 37 s; the chain is at height 364; not in a block yet: none; in a block: 9 of the 9 transactions looked at.
 143 s  9. Ben replaces Anna as recoverer
 146 s     the kit reached Ben's page over the session of his code
 147 s     Ben took the kit in as the new recoverer
 149 s    [newer-phone] console: WebSocket is already in CLOSING or CLOSED state.
 153 s    [second-recoverer] console: WebSocket is already in CLOSING or CLOSED state.
 175 s     the wallet names Ben, and recovery is on with him
 175 s     From Ben keeping the kit to "Recovery is on with Ben": 28 s; the chain is at height 365; not in a block yet: none; in a block: 10 of the 10 transactions looked at.
 176 s  10. The owner keeps a backup, and restores the wallet from it on another phone
 176 s     the complete backup has 6 lines, 2513 characters
 195 s     the restored phone shows 0.00123661 BCH, the same wallet with no waiting period
 195 s  11. The coins go back to where they came from
 195 s     the wallet sent everything: 0.00123321  BCH · 123,321 sat arrives, fee 340 sat
 198 s     Anna, no longer the recoverer, sent her whole balance on: Sent 0.00295486 BCH · 295,486 sat to qqg3zyg3zy…jfagm9. The fee was 185 sat.
```
