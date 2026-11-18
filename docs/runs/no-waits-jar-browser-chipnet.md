# The jar course in a browser, on chipnet with the pages of this checkout: a savings jar through the loss of a phone

Written by `scripts/browser-run-jar.ts chipnet --local-pages --directory browser-run-jar-nowaits-2 --record no-waits-jar-browser-chipnet.md --from 9` on 2026-11-18 10:14 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-jar-nowaits-2-chipnet/`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds (`deploy/preview.sh build`), served on this machine by `deploy/serve.mjs` with the content security policy and `deploy/config/local.json` (http://localhost:8101/, http://localhost:8102/, http://localhost:8103/), with two backup stores of the run's own, on chipnet. Blocks, the waiting period and the jar's date took their real time. The wallet page and the Savings Jar page reached each other through the public WizardConnect relays (wss://relay.riften.net:443, wss://relay.cauldron.quest:443); nothing but the session's messages went over them. Times are seconds since the start.

Outcome: every step was carried out, in 2 parts with the same browser profiles: each part that stopped, and where the next took over, is named below and in the log.

The run stopped in step 9 and was continued from step 9 with the same profiles (`--from 9`); the line "continued from step 9" in the log marks where. The stopped run kept the list of the new phone's requests in memory, and it was lost with that process: the requests of the new phone's browser were recorded only in the continued part. What remains of the first part is the profile's local storage, read before the profile was opened again: the new phone's held entries of http://localhost:8101, and none of the Savings Jar page (http://localhost:8103), whose page writes there whenever it starts (the old phone's profile, which opened it, held entries of it). That shows that the Savings Jar page did not run in the new phone's browser; it does not show, as a recording would, that nothing in that browser ever asked the page's server for anything.
A part of the run stopped: "FAILED at step 9: locator.click: Target crashed " It was continued from the next "continued from step" line of the log.

What the run showed:

- Before the jar was opened, the wallet's Applications screen showed the request of the page that names itself "Savings Jar" (its own name, marked as not verified), the template "Savings Jar" as "Not verified", that approving trusts the template and stores it in the backup first, the action in the template's words, and the wallet's own figures.
- The jar was opened from the Savings Jar page through the wallet (transaction `8a87d805ff72d330b28391f8d279d1c0020ebf01ab349673b73d04953d57ae6d`): 30,000 satoshis until 2026-11-18T10:15:00Z, key `a872e023898cccdeace08634705f08ae1bda6fc2b2e639cdfb4a9dc7f81d321d`, address `bchtest:pwwd7hw85tvtg2tpnmvyq9hzhy9em9fy3ta3xsskqkkwhfjn9wdgjxaegv6kf`.
- Emptying before the date: the jar page offers no button for it ("Locked"); from the wallet's list of tokens the review says when the network takes the transaction, and the network refused it: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)".
- On the new phone the swept key was listed as "Cannot be worked out": "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
- After the template from the backup was trusted, the new phone found the jar from the key and the chain: "Open", "Holds 0.0003 BCH · 30,000 sat".
- Up to the first withdrawal in the continued part of the run the new phone's browser made 41 requests, to http://localhost:8101, wss://chipnet.9500.cash, wss://chipnet.imaginary.cash:50004, http://localhost:8111, http://localhost:8112: none to the Savings Jar page (http://localhost:8103). (The requests of the stopped part were not kept; see above.) The jar was emptied from the wallet's list of tokens (transaction `df4f22c1a6071609ec8e3948c77f92eab9f1e4977f47f27620b1b56355139985`).
- The wallet's balance rose from 130196 to 159676 satoshis, and the key is still listed ("Closed").
- 8,000 satoshis paid into the jar after the first withdrawal were emptied with the same key (transaction `b462b0734adf24ae211df00d6117bf44f384b03acf8e42608412e46a3dc269cd`).
- Connected to the Savings Jar page, the new phone's wallet asked whether the page may see the tokens of its template; once allowed, the page listed the jar from the wallet's answer: 0.00BCH Empty, "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too.".
- At the end the coins went back to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u, the address that paid for the run: the wallet's coins (0.00165928 BCH · 165,928 sat arrived, fee 1,228 sat; the coin kept for cancelling went too), and the recoverer's fee coins (Sent; the fee was 185 satoshis.). What is left: the jar's key, an NFT on a coin of 1,000 satoshis, in the new phone's wallet, whose balance shows 0 satoshis; the jar is empty; the wallet's controller coin stays on chain, since sending everything leaves it in place and the pages do not close a wallet (its value was not read by this run). Every profile stays on disk.

Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages' first server had it at that moment, and which of the wallet's transactions were not in a block yet when the page had already gone on.

- From the payment to the wallet in use, its kit link shown: 6 s; the chain is at height 336577; not in a block yet: the payment that defines the identity ed0643f28585…, the creation b5aeed3b2c07…; in a block: 0 of the 2 transactions looked at.
- From the payment to "Protected", recovery on: 37 s; the chain is at height 336578; not in a block yet: the creation b5aeed3b2c07…; in a block: 1 of the 2 transactions looked at.
- From the payment to the vault address shown: 39 s; the chain is at height 336578; not in a block yet: the creation b5aeed3b2c07…; in a block: 1 of the 2 transactions looked at.
- The jar opened from the wallet, 44 s after the payment that funded the wallet; the chain is at height 336578; not in a block yet: the creation b5aeed3b2c07…, "Open a savings jar · Savings Jar" 8a87d805ff72…; in a block: 1 of the 3 transactions looked at.
- From the completion to the hand-over link: 10 s; the chain is at height 336587.
- From the completion to the sweep sent by the new phone: 23 s; the chain is at height 336589; not in a block yet: "Moved 4 coins from earlier addresses" 084e96d0ead4…; in a block: 4 of the 5 transactions looked at.
- From the completion to the swept coins in the new phone's wallet: 84 s; the chain is at height 336590; not in a block yet: "Moved 4 coins from earlier addresses" 084e96d0ead4…; in a block: 4 of the 5 transactions looked at.
- From the completion to "Protected" on the new phone: 84 s.
- The jar's date, a time lock the network checks against the median time of the last eleven blocks: the course waited 2008 s for the chain's clock to pass it, as the jar is made to.
- The jar's date, a time lock the network checks against the median time of the last eleven blocks, had passed when the new phone came to empty the jar: nothing waited for it.
- The jar emptied from the new phone's list of tokens, once its date had passed; the chain is at height 336634; not in a block yet: "Empty a savings jar · Savings Jar" df4f22c1a607…; in a block: 5 of the 6 transactions looked at.

What these show:

- From the payment that funded the wallet to a wallet in use with recovery on (37 s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".
- When the new phone sent its sweep (23 s after the completion), a block held the completion already, so this record alone does not show that no step of the takeover waited for one.
- The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.

```
   1 s  funding address: 60572479 satoshis in 4 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   2 s  wallet page: http://localhost:8101/, this checkout at 5f1fdbb, chipnet
   2 s  recoverer page: http://localhost:8102/, this checkout at 5f1fdbb, chipnet
   2 s  jar page: http://localhost:8103/, this checkout at 5f1fdbb, chipnet
   2 s  1. The recoverer opens its page and gives its link
   4 s     link of 179 characters; fingerprint c0fe 3e2a bf1b 854e
   6 s  2. The owner creates a wallet with Anna as recoverer
   9 s     the wallet shows the same fingerprint, c0fe 3e2a bf1b 854e
  16 s     funding address bchtest:qzg5v2vtadgwj0eazel6rph7n2p2w6efkc6nexqc8x
  17 s     what the two pages keep, the wallet's words among it, is copied to .chipnet/browser-run-jar-nowaits-2-chipnet/storage-*.json before anything is paid
  17 s     paid 120000 satoshis in ed0643f285859ac32b456b25b0e81988df22164729f26bf648b428d7043499c0:0, unconfirmed
  24 s     created; the kit link has 1288 characters
  24 s     From the payment to the wallet in use, its kit link shown: 6 s; the chain is at height 336577; not in a block yet: the payment that defines the identity ed0643f28585…, the creation b5aeed3b2c07…; in a block: 0 of the 2 transactions looked at.
  24 s  3. Anna takes in the kit; the wallet says that recovery is on
  26 s     the recoverer kept the kit and left its receipt
  55 s     the wallet shows "Protected"
  55 s     From the payment to "Protected", recovery on: 37 s; the chain is at height 336578; not in a block yet: the creation b5aeed3b2c07…; in a block: 1 of the 2 transactions looked at.
  55 s  4. The owner receives
  55 s     address bchtest:pvm2v3wmcxpck5444cygkmmxrq8ek3pxpwafcm4l6tkwn8kdpv7y7tn0tp5x6
  56 s     paid 50000 satoshis in a872e023898cccdeace08634705f08ae1bda6fc2b2e639cdfb4a9dc7f81d321d:0, unconfirmed
  56 s     vault address bchtest:pdevl7ll9al05ly5drdf66vjcuzvef83xld64er0k4kdp4kuw80027z8xevj7
  56 s     From the payment to the vault address shown: 39 s; the chain is at height 336578; not in a block yet: the creation b5aeed3b2c07…; in a block: 1 of the 2 transactions looked at.
  56 s     the wallet holds 0.00113679 BCH
  56 s  5. The owner connects the wallet to the Savings Jar page and opens a jar from it
  57 s     the Savings Jar page shows its connection address (77 characters, wiz://…) and waits for a wallet
  60 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 10:34 AM; "Connected"
  60 s     the Savings Jar page: "Connected to Grandma's Wallet"
  60 s     the jar page lists: "No jars to show. Your wallet tells this page about its jars once you open one here, or once you allow it in the wallet."
  60 s     the form says: "0.0003 BCH stays in the jar until Nov 18, 2026, 11:15 AM, 41 minutes from now." (the date 2026-11-18T10:15:00Z)
  60 s     the jar page: "On its way", "Approved in your wallet Your wallet has the request. Check it there and approve it."
  60 s     the wallet's Applications screen: "Savings Jar asks for your decision"; Its own name, not verified Asked Nov 18, 2026, 10:34 AM
  60 s     the request: template "Savings Jar", "Not verified" (Nothing was found against the template, and this wallet has not yet seen a token of it lead to its position on chain. Whether its contracts give authority to the token and to nothing else, a wallet cannot check.)
  60 s     it says: "This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it."
  60 s     in the template's words: "Open a savings jar"; Jar key: a872e023…1d321d; Opens on: 1794996900; Date on the key: a47afd6a; Amount to save: 30000; Key holder: aa20e11a…17c687
  60 s     the wallet's own figures: Leaves your wallet: 0.0005 BCH · 50,000 sat; Comes back to your wallet: 0.00019523 BCH · 19,523 sat; Goes into the application: 0.0003 BCH · 30,000 sat; Network fee: 477 sat; Your wallet goes down by: 0.00030477 BCH · 30,477 sat
  60 s       Goes to others: Savings jar · at aa209c…9a8987 0.0003 BCH · 30,000 sat
  60 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token a872e023…1d321d with a47afd6a
  60 s       Arrives at your wallet: What is left over, as change 0.00018523 BCH · 18,523 sat
  61 s     approved; the wallet: "Done: Open a savings jar", transaction 8a87d805ff72d330b28391f8d279d1c0020ebf01ab349673b73d04953d57ae6d
  61 s     The jar opened from the wallet, 44 s after the payment that funded the wallet; the chain is at height 336578; not in a block yet: the creation b5aeed3b2c07…, "Open a savings jar · Savings Jar" 8a87d805ff72…; in a block: 1 of the 3 transactions looked at.
  65 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 18, 2026, 11:15 AM"
  67 s     the wallet's tokens: "Savings Jar" (Open), Holds 0.0003 BCH · 30,000 sat; key a872e023898cccdeace08634705f08ae1bda6fc2b2e639cdfb4a9dc7f81d321d
  67 s     the jar's address, as the page gives it and as the contract makes it from the key and the date: bchtest:pwwd7hw85tvtg2tpnmvyq9hzhy9em9fy3ta3xsskqkkwhfjn9wdgjxaegv6kf
  67 s  6. Emptying the jar before its date is refused
  68 s     the jar page offers no "Empty the jar": 0.0003BCH Locked, "Opens on Nov 18, 2026, 11:15 AM", "In 41 minutes."
  71 s     from the wallet's list of tokens, "Empty a savings jar":
  71 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
  71 s     in the template's words: "Empty a savings jar"; Jar key: a872e023…1d321d; Opens on: 1794996900; Date on the key: a47afd6a; Key holder: aa206d6c…55e987; Key input: 1
  71 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Comes back from the application: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
  71 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token a872e023…1d321d with a47afd6a
  71 s       The application's coins it spends: Savings jar · 8a87d8…6d:0 0.0003 BCH · 30,000 sat
  71 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token a872e023…1d321d with a47afd6a
  71 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
  71 s       "The network accepts this transaction from Nov 18, 2026, 11:15 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
  72 s     "Not carried out": "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"
  72 s  7. The phone is lost
  72 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  72 s  8. A new phone takes the wallet over with Anna's help, and sweeps
  75 s     both sides show 8f72 5268 d23e 31bf
  96 s     the request is in a block; the waiting period runs
  96 s     the waiting period takes its real time
 366 s     completed; the hand-over link is ready
 367 s     From the completion to the hand-over link: 10 s; the chain is at height 336587.
 380 s     From the completion to the sweep sent by the new phone: 23 s; the chain is at height 336589; not in a block yet: "Moved 4 coins from earlier addresses" 084e96d0ead4…; in a block: 4 of the 5 transactions looked at.
 440 s     the new phone holds 0.00130196 BCH
 441 s     From the completion to the swept coins in the new phone's wallet: 84 s; the chain is at height 336590; not in a block yet: "Moved 4 coins from earlier addresses" 084e96d0ead4…; in a block: 4 of the 5 transactions looked at.
 441 s     recovery is on for the new phone
 441 s     From the completion to "Protected" on the new phone: 84 s.
 441 s  9. The new phone finds the jar from the swept key and the template, the Savings Jar page not consulted, and empties it
 442 s     the Applications screen lists the swept key: "Savings Jar" (Cannot be worked out): "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
 443 s     "A template from your backup": "Savings Jar", "Not verified"
 443 s     trusted; the key: "Savings Jar" (Open), "Holds 0.0003 BCH · 30,000 sat"; actions: "Pay into a savings jar", "Empty a savings jar"
 443 s     the chain's median time is 2026-11-18T09:47:23Z at height 336590; the jar's date is 2026-11-18T10:15:00Z. Waiting for the network's clock to pass it
 503 s     the chain's median time is 2026-11-18T09:47:31Z at height 336591
 563 s     the chain's median time is 2026-11-18T09:48:04Z at height 336593
 623 s     the chain's median time is 2026-11-18T09:48:04Z at height 336593
 684 s     the chain's median time is 2026-11-18T09:48:04Z at height 336594
 744 s     the chain's median time is 2026-11-18T09:48:15Z at height 336596
 804 s     the chain's median time is 2026-11-18T09:48:27Z at height 336598
 864 s     the chain's median time is 2026-11-18T09:48:27Z at height 336598
 924 s     the chain's median time is 2026-11-18T09:48:29Z at height 336599
 984 s     the chain's median time is 2026-11-18T09:48:29Z at height 336599
1045 s     the chain's median time is 2026-11-18T09:48:29Z at height 336600
1105 s     the chain's median time is 2026-11-18T09:49:11Z at height 336602
1165 s     the chain's median time is 2026-11-18T09:49:11Z at height 336603
1225 s     the chain's median time is 2026-11-18T09:49:38Z at height 336604
1285 s     the chain's median time is 2026-11-18T09:50:51Z at height 336606
1346 s     the chain's median time is 2026-11-18T09:51:30Z at height 336607
1406 s     the chain's median time is 2026-11-18T09:51:30Z at height 336607
1466 s     the chain's median time is 2026-11-18T09:51:40Z at height 336608
1526 s     the chain's median time is 2026-11-18T09:51:40Z at height 336608
1586 s     the chain's median time is 2026-11-18T09:53:32Z at height 336609
1646 s     the chain's median time is 2026-11-18T09:54:02Z at height 336610
1707 s     the chain's median time is 2026-11-18T09:54:10Z at height 336611
1767 s     the chain's median time is 2026-11-18T09:54:10Z at height 336611
1829 s     the chain's median time is 2026-11-18T09:54:51Z at height 336612
1921 s     the chain's median time is 2026-11-18T09:59:14Z at height 336615
2035 s     the chain's median time is 2026-11-18T09:59:14Z at height 336615
2095 s     the chain's median time is 2026-11-18T10:03:19Z at height 336617
2155 s     the chain's median time is 2026-11-18T10:03:34Z at height 336618
2216 s     the chain's median time is 2026-11-18T10:04:27Z at height 336619
2331 s     the chain's median time is 2026-11-18T10:10:10Z at height 336623
2391 s     the chain's median time is 2026-11-18T10:10:47Z at height 336625
2451 s     the chain's median time is 2026-11-18T10:16:42Z at height 336633
2451 s     the chain's median time is 2026-11-18T10:16:42Z at height 336633, past the jar's date 2026-11-18T10:15:00Z
2451 s     The jar's date, a time lock the network checks against the median time of the last eleven blocks: the course waited 2008 s for the chain's clock to pass it, as the jar is made to.
2451 s  FAILED at step 9: locator.click: Target crashed 
       continued from step 9 on 2026-11-18 10:14 UTC with the same browser profiles; the times below are seconds since then
   2 s  funding address: 60401608 satoshis in 1 coin at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   3 s  wallet page: http://localhost:8101/, this checkout at 5f1fdbb, chipnet
   3 s  recoverer page: http://localhost:8102/, this checkout at 5f1fdbb, chipnet
   3 s  jar page: http://localhost:8103/, this checkout at 5f1fdbb, chipnet
   3 s     the jar: key a872e023898cccdeace08634705f08ae1bda6fc2b2e639cdfb4a9dc7f81d321d, date 2026-11-18T10:15:00Z, address bchtest:pwwd7hw85tvtg2tpnmvyq9hzhy9em9fy3ta3xsskqkkwhfjn9wdgjxaegv6kf
   3 s     before it is opened again, the new phone's profile holds local storage of http://localhost:8101; the old phone's of http://localhost:8101, http://localhost:8103
   4 s  9. The new phone finds the jar from the swept key and the template, the Savings Jar page not consulted, and empties it
   6 s     the template is trusted on this phone already (by the stopped run); the key: "Savings Jar" (Open), "Holds 0.0003 BCH · 30,000 sat"
   6 s     the chain's median time is 2026-11-18T10:18:35Z at height 336634, past the jar's date 2026-11-18T10:15:00Z
   6 s     The jar's date, a time lock the network checks against the median time of the last eleven blocks, had passed when the new phone came to empty the jar: nothing waited for it.
   7 s     the first withdrawal, from the wallet's list of tokens:
   7 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
   7 s     it says: "You trust this template on this phone, and it is not in your backup yet. Approving stores it there first, before anything is signed."
   7 s     in the template's words: "Empty a savings jar"; Jar key: a872e023…1d321d; Opens on: 1794996900; Date on the key: a47afd6a; Key holder: aa2087d0…687987; Key input: 1
   7 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Comes back from the application: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
   7 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token a872e023…1d321d with a47afd6a
   7 s       The application's coins it spends: Savings jar · 8a87d8…6d:0 0.0003 BCH · 30,000 sat
   7 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token a872e023…1d321d with a47afd6a
   7 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
   7 s       "The network accepts this transaction from Nov 18, 2026, 11:15 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
   9 s     done: df4f22c1a6071609ec8e3948c77f92eab9f1e4977f47f27620b1b56355139985
   9 s     The jar emptied from the new phone's list of tokens, once its date had passed; the chain is at height 336634; not in a block yet: "Empty a savings jar · Savings Jar" df4f22c1a607…; in a block: 5 of the 6 transactions looked at.
   9 s     up to here in the continued part of the run the new phone's browser made 41 requests, to http://localhost:8101, wss://chipnet.9500.cash, wss://chipnet.imaginary.cash:50004, http://localhost:8111, http://localhost:8112; none to the Savings Jar page (http://localhost:8103)
  14 s     the wallet's balance rose from 130196 to 159676 satoshis
  14 s     the key is still listed: "Savings Jar" (Closed), "It holds nothing now."
  14 s  10. Someone pays into the jar again, and the new phone empties that too
  16 s     paid 8000 satoshis in 8511917739293a2511db84831abd0ae107a37e6bbfc405574bc8c6202f89ef20:0, unconfirmed
  18 s     the key: (Open), "Holds 0.00008 BCH · 8,000 sat"
  19 s     the second withdrawal, from the wallet's list of tokens:
  19 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
  19 s     in the template's words: "Empty a savings jar"; Jar key: a872e023…1d321d; Opens on: 1794996900; Date on the key: a47afd6a; Key holder: aa20198d…74ce87; Key input: 1
  19 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0000848 BCH · 8,480 sat; Comes back from the application: 0.00008 BCH · 8,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0000748 BCH · 7,480 sat
  19 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token a872e023…1d321d with a47afd6a
  19 s       The application's coins it spends: Savings jar · 851191…20:0 0.00008 BCH · 8,000 sat
  19 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token a872e023…1d321d with a47afd6a
  19 s       Arrives at your wallet: What is left over, as change 0.0000748 BCH · 7,480 sat
  19 s       "The network accepts this transaction from Nov 18, 2026, 11:15 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
  20 s     done: b462b0734adf24ae211df00d6117bf44f384b03acf8e42608412e46a3dc269cd
  20 s  11. The new phone connects to the Savings Jar page, which lists the jar from the wallet's answer
  21 s     the Savings Jar page shows its connection address (77 characters, wiz://…) and waits for a wallet
  24 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 11:14 AM; "Connected"
  24 s     the Savings Jar page: "Connected to Grandma's Wallet"
  24 s     the wallet: "Savings Jar asks to see your tokens": "It asks which tokens of the template Savings Jar this wallet holds, and what they control. You trust this template on this phone, but not in a session with this application, so it was told nothing."
  54 s     allowed; the Savings Jar page lists, from the wallet's answer: 0.00BCH Empty, "Opened on Nov 18, 2026, 11:15 AM", "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too."
  54 s  12. The coins go back to where they came from
  57 s     the new phone sent everything to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u: 0.00165928 BCH · 165,928 sat arrives, fee 1,228 sat; the wallet says that tokens stay where they are, so the jar's key stays in the wallet
  61 s     Anna sent her fee coins back: Sent; the fee was 185 satoshis.
  74 s     left: the new phone's wallet shows 0 satoshis; the jar's key (1,000 satoshis with the NFT) is still in it, and the jar holds nothing
  80 s     funding address: 60562061 satoshis in 3 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
```
