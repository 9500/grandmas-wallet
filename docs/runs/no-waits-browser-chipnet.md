# The wallet course in a browser, on chipnet with the pages of this checkout

Written by `scripts/browser-run.ts chipnet --local-pages --directory browser-run-nowaits-3 --record no-waits-browser-chipnet.md` on 2026-11-18 09:20 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-nowaits-3-chipnet/`. The pages are this checkout's production builds (`deploy/preview.sh build`), served on this machine by `deploy/serve.mjs` with the content security policy and `deploy/config/local.json` (http://localhost:8101/, http://localhost:8102/), with two backup stores of the run's own, on chipnet. Blocks and the waiting period took their real time. Times are seconds since the start.

Outcome: every step was carried out.

Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages' first server had it at that moment, and which of the wallet's transactions were not in a block yet when the page had already gone on.

- From the payment to the wallet in use, its kit link shown: 6 s; the chain is at height 336557; not in a block yet: the payment that defines the identity 9c5cd6fe9013…, the creation 1a560d1c0084…; in a block: 0 of the 2 transactions looked at.
- From the payment to "Protected", recovery on: 37 s; the chain is at height 336557; not in a block yet: the payment that defines the identity 9c5cd6fe9013…, the creation 1a560d1c0084…; in a block: 0 of the 2 transactions looked at.
- From the payment to the vault address shown: 39 s; the chain is at height 336557; not in a block yet: the payment that defines the identity 9c5cd6fe9013…, the creation 1a560d1c0084…; in a block: 0 of the 2 transactions looked at.
- A payment from the wallet, 40 s after the payment that funded it; the chain is at height 336557; not in a block yet: the payment that defines the identity 9c5cd6fe9013…, the creation 1a560d1c0084…, "Sent 20,000 sat to qphf9jdtnr…y9q77u" a78977e15bd7…; in a block: 0 of the 3 transactions looked at.
- From the refusal to "Protected" again, with a new coin for cancelling: 30 s; the chain is at height 336559; not in a block yet: "Put a coin aside for cancelling" 82efcf4eb570…, "Refused a recovery request" c61efc3eeee2…; in a block: 4 of the 6 transactions looked at.
- From the completion to the hand-over link: 10 s; the chain is at height 336570.
- From the completion to the sweep sent by the new phone: 22 s; the chain is at height 336570; not in a block yet: "Moved 3 coins from earlier addresses" 53a56569e0c1…, the completion 2d10da3e2992…; in a block: 5 of the 7 transactions looked at.
- From the completion to the swept coins in the new phone's wallet: 66 s; the chain is at height 336571; not in a block yet: "Moved 3 coins from earlier addresses" 53a56569e0c1…, the completion 2d10da3e2992…; in a block: 5 of the 7 transactions looked at.
- From the completion to "Protected" on the new phone: 66 s.
- From the move link opened on the newer phone to the sweep it sent: 24 s; the chain is at height 336572; not in a block yet: "Moved 2 coins from earlier addresses" e7cc4afa93ea…, the completion 2d10da3e2992…, a transaction of the controller 2f15730ce1cb…, a transaction of the controller 53a56569e0c1…; in a block: 5 of the 9 transactions looked at.
- From the move link opened on the newer phone to its wallet in use with recovery on: 99 s; the chain is at height 336572; not in a block yet: "Moved 2 coins from earlier addresses" e7cc4afa93ea…, the completion 2d10da3e2992…, a transaction of the controller 2f15730ce1cb…, a transaction of the controller 53a56569e0c1…; in a block: 5 of the 9 transactions looked at.
- From Ben keeping the kit to "Recovery is on with Ben": 11 s; the chain is at height 336573; not in a block yet: "Changed the recoverer" 00d86ef730c7…, "Moved 2 coins from earlier addresses" e7cc4afa93ea…, the completion 2d10da3e2992…, a transaction of the controller 2f15730ce1cb…, a transaction of the controller 53a56569e0c1…; in a block: 5 of the 10 transactions looked at.

What these show:

- From the payment that funded the wallet to a wallet in use with recovery on (37 s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".
- From the completed recovery to the swept coins, no step waited for a block: 22 s after the completion the new phone sent its sweep, and neither the completion nor the sweep was in a block yet.
- The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.

```
   1 s  funding address: 60585700 satoshis in 3 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   2 s  wallet page: http://localhost:8101/, this checkout at 5f1fdbb, chipnet
   2 s  recoverer page: http://localhost:8102/, this checkout at 5f1fdbb, chipnet
   2 s  1. The recoverer opens its page and gives its link
   5 s     link of 176 characters; fingerprint e908 353b 3810 c6aa
   6 s  2. The owner creates a wallet with Anna as recoverer
   9 s     the wallet shows the same fingerprint, e908 353b 3810 c6aa
  17 s     funding address bchtest:qqdcktu556uyshmkhlek97s7khmq887k0gyhaxqzu2
  17 s     what the two pages keep, the wallet's words among it, is copied to .chipnet/browser-run-nowaits-3-chipnet/storage-*.json before anything is paid
  18 s     paid 120000 satoshis in 9c5cd6fe9013f460a29100a6fa80f99ccb6280939389ff4e3435735e4cf98125:0, unconfirmed
  25 s     created; the kit link has 1288 characters
  25 s     From the payment to the wallet in use, its kit link shown: 6 s; the chain is at height 336557; not in a block yet: the payment that defines the identity 9c5cd6fe9013…, the creation 1a560d1c0084…; in a block: 0 of the 2 transactions looked at.
  25 s  3. Anna takes in the kit; the wallet says that recovery is on
  27 s     the recoverer kept the kit and left its receipt
  56 s     the wallet shows "Protected"
  56 s     From the payment to "Protected", recovery on: 37 s; the chain is at height 336557; not in a block yet: the payment that defines the identity 9c5cd6fe9013…, the creation 1a560d1c0084…; in a block: 0 of the 2 transactions looked at.
  56 s  4. The owner receives
  56 s     address bchtest:pd32uv5rfmjh7gyq84c72kem3tue37pwrxs3ehgfjnyszf344aqmy68ulv0ym
  57 s     paid 50000 satoshis in 4c549d7784b9f8eb0a0cdfb24504bb6d66000bb3e42d59dd001df60985c41911:0, unconfirmed
  57 s     vault address bchtest:pvvg7tgmt2ynkqu4xan7qtm69kma0qagn77pgcdv6n0nlgnte2kwzu93nekdt
  57 s     From the payment to the vault address shown: 39 s; the chain is at height 336557; not in a block yet: the payment that defines the identity 9c5cd6fe9013…, the creation 1a560d1c0084…; in a block: 0 of the 2 transactions looked at.
  57 s     the wallet holds 0.00113679 BCH
  57 s  5. The owner pays, and sees the fee before sending
  58 s     the review shows a fee of 384 sat
  58 s     sent in a78977e15bd72d29ac48c006eaa5805f92dd6eca5edd50de9fe1d572ea1b7617
  58 s     A payment from the wallet, 40 s after the payment that funded it; the chain is at height 336557; not in a block yet: the payment that defines the identity 9c5cd6fe9013…, the creation 1a560d1c0084…, "Sent 20,000 sat to qphf9jdtnr…y9q77u" a78977e15bd7…; in a block: 0 of the 3 transactions looked at.
  58 s  6. A request the owner did not make is refused
  60 s     a request from a phone with key 1f80 a52e ca6a d373
  72 s     the recoverer (deceived, or its key stolen) asked the network
  86 s     the owner's phone shows the alarm
  86 s     refused
 101 s     the coin for cancelling paid for the refusal; the wallet says that it cannot refuse another
 116 s     a new coin is put aside; protected again
 116 s     From the refusal to "Protected" again, with a new coin for cancelling: 30 s; the chain is at height 336559; not in a block yet: "Put a coin aside for cancelling" 82efcf4eb570…, "Refused a recovery request" c61efc3eeee2…; in a block: 4 of the 6 transactions looked at.
 116 s     the recoverer sees the refusal; the wallet is protected again
 116 s  7. The phone is lost
 116 s     the old phone's profile is no longer opened
 116 s  8. A new phone takes the wallet over with Anna's help, and sweeps
 121 s     both sides show 637f f0e5 dc2c 3058
 133 s     the request is in a block; the waiting period runs
 133 s     the waiting period takes its real time
 454 s     completed; the hand-over link is ready
 454 s     From the completion to the hand-over link: 10 s; the chain is at height 336570.
 467 s     From the completion to the sweep sent by the new phone: 22 s; the chain is at height 336570; not in a block yet: "Moved 3 coins from earlier addresses" 53a56569e0c1…, the completion 2d10da3e2992…; in a block: 5 of the 7 transactions looked at.
 510 s     the new phone holds 0.00140147 BCH
 510 s     From the completion to the swept coins in the new phone's wallet: 66 s; the chain is at height 336571; not in a block yet: "Moved 3 coins from earlier addresses" 53a56569e0c1…, the completion 2d10da3e2992…; in a block: 5 of the 7 transactions looked at.
 510 s     recovery is on for the new phone
 510 s     From the completion to "Protected" on the new phone: 66 s.
 514 s     the old phone, opened again, says the wallet belongs to another key
 514 s  9. The wallet moves to a newer phone, the new phone still working
 520 s     the recoverer took in the update and left a prepared receipt
 544 s     the old phone made the change
 544 s     From the move link opened on the newer phone to the sweep it sent: 24 s; the chain is at height 336572; not in a block yet: "Moved 2 coins from earlier addresses" e7cc4afa93ea…, the completion 2d10da3e2992…, a transaction of the controller 2f15730ce1cb…, a transaction of the controller 53a56569e0c1…; in a block: 5 of the 9 transactions looked at.
 619 s     the newer phone holds 0.00137563 BCH; recovery is on
 620 s     From the move link opened on the newer phone to its wallet in use with recovery on: 99 s; the chain is at height 336572; not in a block yet: "Moved 2 coins from earlier addresses" e7cc4afa93ea…, the completion 2d10da3e2992…, a transaction of the controller 2f15730ce1cb…, a transaction of the controller 53a56569e0c1…; in a block: 5 of the 9 transactions looked at.
 620 s  10. Ben replaces Anna as recoverer
 628 s     Ben took the kit in as the new recoverer
 639 s     the wallet names Ben, and recovery is on with him
 639 s     From Ben keeping the kit to "Recovery is on with Ben": 11 s; the chain is at height 336573; not in a block yet: "Changed the recoverer" 00d86ef730c7…, "Moved 2 coins from earlier addresses" e7cc4afa93ea…, the completion 2d10da3e2992…, a transaction of the controller 2f15730ce1cb…, a transaction of the controller 53a56569e0c1…; in a block: 5 of the 10 transactions looked at.
 641 s  11. The owner keeps a backup, and restores the wallet from it on another phone
 644 s     the complete backup has 6 lines, 2517 characters
 738 s     the restored phone shows 0.00136382 BCH, the same wallet with no waiting period
 738 s  12. The coins go back to where they came from
 738 s     the wallet sent everything: 0.00135746  BCH · 135,746 sat arrives, fee 636 sat
 742 s     Anna, no longer the recoverer, sent the rest of her allowance back: Sent; the fee was 185 satoshis.
 748 s     funding address: 60572479 satoshis in 4 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
```
