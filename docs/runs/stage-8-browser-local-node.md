# Stage 8 scripted run in a browser, against the local node: a savings jar through the loss of a phone

Written by `scripts/browser-run-jar.ts` on 2026-11-18 04:19 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-jar/`; the Savings Jar page is a second tab of the phone that uses it. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node and two backup stores on this machine. The run made the blocks and moved the chain's clock. The wallet page and the Savings Jar page reached each other through the public WizardConnect relays (wss://relay.riften.net:443, wss://relay.cauldron.quest:443); nothing but the session's messages went over them. Times are seconds since the start.

Outcome: every step was carried out.

What the run showed:

- Before the jar was opened, the wallet's Applications screen showed the request of the page that names itself "Savings Jar" (its own name, marked as not verified), the template "Savings Jar" as "Not verified", that approving trusts the template and stores it in the backup first, the action in the template's words, and the wallet's own figures.
- The jar was opened from the Savings Jar page through the wallet (transaction `ed0f44778a93345bb2dd3914b1775247817104768151ff62d6ca2fa96cf8137b`): 30,000 satoshis until 2026-11-18T05:35:00Z, key `1062a9b8873560f7e172557fd1a44670702fd1ce3ca0cb84cf5b9afe86c45311`, address `bchreg:pdn8usc0dvc7g783vutl6vqsj3g8e4evwyxep5vnafxdyvyl38hlge0z0ft5x`.
- Emptying before the date: the jar page offers no button for it ("Locked"); from the wallet's list of tokens the review says when the network takes the transaction, and the network refused it: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)".
- On the new phone the swept key was listed as "Cannot be worked out": "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
- After the template from the backup was trusted, the new phone found the jar from the key and the chain: "Open", "Holds 0.0003 BCH · 30,000 sat".
- Up to the first withdrawal the new phone's browser made 100 requests, to http://localhost:8101, ws://127.0.0.1:60403, http://localhost:8111, http://localhost:8112: none to the Savings Jar page (http://localhost:8103). The jar was emptied from the wallet's list of tokens (transaction `bb3010d2eafd3c851ff45c0e5942db319ef1646f91f674f0c38e6b699b26f7a8`).
- The wallet's balance rose from 130196 to 159676 satoshis, and the key is still listed ("Closed").
- 8,000 satoshis paid into the jar after the first withdrawal were emptied with the same key (transaction `3b54311f376b454c1a4e1055f6db81f52a097abb956e1d5dd4a8b16c21984a01`).
- Connected to the Savings Jar page, the new phone's wallet asked whether the page may see the tokens of its template; once allowed, the page listed the jar from the wallet's answer: 0.00BCH Empty, "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too.".
- At the end the coins went back to bchtest:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyarjfagm9: the wallet's coins (0.00165928 BCH · 165,928 sat arrived, fee 1,228 sat; the coin kept for cancelling went too), and the recoverer's fee coins (Sent; the fee was 185 satoshis.). What is left: the jar's key, an NFT on a coin of 1,000 satoshis, in the new phone's wallet, whose balance shows 0 satoshis; the jar is empty; the wallet's controller coin stays on chain, since sending everything leaves it in place and the pages do not close a wallet (its value was not read by this run). Every profile stays on disk.

```
   0 s  local node: node: running, block 1077, median time 2026-11-18T05:09:37Z
   1 s  1. The recoverer opens its page and gives its link
   2 s     link of 179 characters; fingerprint 8bcc 5432 656f 8387
   2 s  2. The owner creates a wallet with Anna as recoverer
   3 s     the wallet shows the same fingerprint, 8bcc 5432 656f 8387
   4 s     funding address bchtest:qzrxa6z4efusqsnyj8gfkhqz6dyylzgu7ywklsxur0
   5 s     paid 120000 satoshis in 767710fa1d4b6b79220125c5527dff7d6f1e70420eb53e8c8e626669ae15dc18:0, confirmed at height 1078
   9 s     created; waiting for a block, which the run makes now
  15 s     confirmed; the kit link has 1288 characters
  15 s  3. Anna takes in the kit; the wallet says that recovery is on
  15 s     the recoverer kept the kit and left its receipt
  45 s     the wallet shows "Protected"
  45 s  4. The owner receives
  45 s     address bchtest:pdjyh2tefuws8gpx2a5z8zwzwm6c2elr066tlgcyrlhlekjt4xvcx4hv4ar44
  47 s     paid 50000 satoshis in 1062a9b8873560f7e172557fd1a44670702fd1ce3ca0cb84cf5b9afe86c45311:0, confirmed at height 1080
  47 s     vault address bchtest:pweppl64q8x8tktj7r24w4g3ewnn3dd7djzl66l68mrhkfu9ykykk6gzdzh3j
  47 s     the wallet holds 0.00113679 BCH
  47 s  5. The owner connects the wallet to the Savings Jar page and opens a jar from it
  47 s     the Savings Jar page shows its connection address (77 characters, wiz://…) and waits for a wallet
  48 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 5:20 AM; "Connected"
  48 s     the Savings Jar page: "Connected to Grandma's Wallet"
  48 s     the jar page lists: "No jars to show. Your wallet tells this page about its jars once you open one here, or once you allow it in the wallet."
  48 s     the chain's clock: last block 2026-11-18T05:09:39Z, median time 2026-11-18T05:09:38Z; this machine 2026-11-18T04:20:20Z
  48 s     the form says: "0.0003 BCH stays in the jar until Nov 18, 2026, 6:35 AM, 75 minutes from now." (the date 2026-11-18T05:35:00Z)
  49 s     the jar page: "On its way", "Approved in your wallet Your wallet has the request. Check it there and approve it."
  49 s     the wallet's Applications screen: "Savings Jar asks for your decision"; Its own name, not verified Asked Nov 18, 2026, 5:20 AM
  49 s     the request: template "Savings Jar", "Not verified" (Nothing was found against the template, and this wallet has not yet seen a token of it lead to its position on chain. Whether its contracts give authority to the token and to nothing else, a wallet cannot check.)
  49 s     it says: "This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it."
  49 s     in the template's words: "Open a savings jar"; Jar key: 1062a9b8…c45311; Opens on: 1794980100; Date on the key: 0439fd6a; Amount to save: 30000; Key holder: aa20cf9f…ec3787
  49 s     the wallet's own figures: Leaves your wallet: 0.0005 BCH · 50,000 sat; Comes back to your wallet: 0.00019523 BCH · 19,523 sat; Network fee: 477 sat; Your wallet goes down by: 0.00030477 BCH · 30,477 sat
  49 s       Goes to others: Savings jar · at aa2066…eff487 0.0003 BCH · 30,000 sat
  49 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 1062a9b8…c45311 with 0439fd6a
  49 s       Arrives at your wallet: What is left over, as change 0.00018523 BCH · 18,523 sat
  50 s     approved; the wallet: "Done: Open a savings jar", transaction ed0f44778a93345bb2dd3914b1775247817104768151ff62d6ca2fa96cf8137b
  54 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 18, 2026, 6:35 AM"
  56 s     the wallet's tokens: "Savings Jar" (Open), Holds 0.0003 BCH · 30,000 sat; key 1062a9b8873560f7e172557fd1a44670702fd1ce3ca0cb84cf5b9afe86c45311
  56 s     the jar's address, as the page gives it and as the contract makes it from the key and the date: bchreg:pdn8usc0dvc7g783vutl6vqsj3g8e4evwyxep5vnafxdyvyl38hlge0z0ft5x
  56 s  6. Emptying the jar before its date is refused
  57 s     the jar page offers no "Empty the jar": 0.0003BCH Locked, "Opens on Nov 18, 2026, 6:35 AM", "In 75 minutes."
  58 s     from the wallet's list of tokens, "Empty a savings jar":
  58 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
  58 s     in the template's words: "Empty a savings jar"; Jar key: 1062a9b8…c45311; Opens on: 1794980100; Date on the key: 0439fd6a; Key holder: aa204eb2…20c787; Key input: 1
  58 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
  58 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 1062a9b8…c45311 with 0439fd6a
  58 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 1062a9b8…c45311 with 0439fd6a
  58 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
  58 s       "The network accepts this transaction from Nov 18, 2026, 6:35 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
  58 s     "Not carried out": "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"
  59 s  7. The phone is lost
  59 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  59 s  8. A new phone takes the wallet over with Anna's help, and sweeps
  60 s     both sides show 6069 aef0 9b5a 0061
  72 s     the request is in a block; the waiting period runs
  73 s     the chain's clock moved on by 700 seconds; height 1093
  92 s     completed; the hand-over link is ready
 106 s     the new phone holds 0.00130196 BCH
 108 s     recovery is on for the new phone
 108 s  9. The new phone finds the jar from the swept key and the template, the Savings Jar page not consulted, and empties it
 109 s     the Applications screen lists the swept key: "Savings Jar" (Cannot be worked out): "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
 109 s     "A template from your backup": "Savings Jar", "Not verified"
 110 s     trusted; the key: "Savings Jar" (Open), "Holds 0.0003 BCH · 30,000 sat"; actions: "Pay into a savings jar", "Empty a savings jar"
 110 s     the chain's clock moved on by 939 seconds; height 1109
 110 s     the chain's median time is 2026-11-18T05:37:00Z at height 1109, past the jar's date 2026-11-18T05:35:00Z
 113 s     the first withdrawal, from the wallet's list of tokens:
 113 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 113 s     it says: "You trust this template on this phone, and it is not in your backup yet. Approving stores it there first, before anything is signed."
 113 s     in the template's words: "Empty a savings jar"; Jar key: 1062a9b8…c45311; Opens on: 1794980100; Date on the key: 0439fd6a; Key holder: aa20f538…fb2a87; Key input: 1
 113 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
 113 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 1062a9b8…c45311 with 0439fd6a
 113 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 1062a9b8…c45311 with 0439fd6a
 113 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
 113 s       "The network accepts this transaction from Nov 18, 2026, 6:35 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 114 s     done: bb3010d2eafd3c851ff45c0e5942db319ef1646f91f674f0c38e6b699b26f7a8
 114 s     up to here the new phone's browser made 100 requests, to http://localhost:8101, ws://127.0.0.1:60403, http://localhost:8111, http://localhost:8112; none to the Savings Jar page (http://localhost:8103)
 118 s     the wallet's balance rose from 130196 to 159676 satoshis
 118 s     the key is still listed: "Savings Jar" (Closed), "It holds nothing now."
 118 s  10. Someone pays into the jar again, and the new phone empties that too
 118 s     paid 8000 satoshis in fd64c59a9cab6766dc52687905bb99913ca215391515f8424ea7d50405b3d11b:0, confirmed at height 1111
 121 s     the key: (Open), "Holds 0.00008 BCH · 8,000 sat"
 121 s     the second withdrawal, from the wallet's list of tokens:
 121 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 121 s     in the template's words: "Empty a savings jar"; Jar key: 1062a9b8…c45311; Opens on: 1794980100; Date on the key: 0439fd6a; Key holder: aa20a9b6…633c87; Key input: 1
 121 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0000848 BCH · 8,480 sat; Taken out of the application's scripts: 0.00008 BCH · 8,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0000748 BCH · 7,480 sat
 121 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 1062a9b8…c45311 with 0439fd6a
 121 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 1062a9b8…c45311 with 0439fd6a
 121 s       Arrives at your wallet: What is left over, as change 0.0000748 BCH · 7,480 sat
 121 s       "The network accepts this transaction from Nov 18, 2026, 6:35 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 121 s     done: 3b54311f376b454c1a4e1055f6db81f52a097abb956e1d5dd4a8b16c21984a01
 122 s  11. The new phone connects to the Savings Jar page, which lists the jar from the wallet's answer
 122 s     the Savings Jar page shows its connection address (77 characters, wiz://…) and waits for a wallet
 123 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 5:21 AM; "Connected"
 123 s     the Savings Jar page: "Connected to Grandma's Wallet"
 123 s     the wallet: "Savings Jar asks to see your tokens": "It asks which tokens of the template Savings Jar this wallet holds, and what they control. You trust this template on this phone, but not in a session with this application, so it was told nothing."
 154 s     allowed; the Savings Jar page lists, from the wallet's answer: 0.00BCH Empty, "Opens on Nov 18, 2026, 6:35 AM", "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too."
 154 s  12. The coins go back to where they came from
 155 s     the new phone sent everything to bchtest:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyarjfagm9: 0.00165928 BCH · 165,928 sat arrives, fee 1,228 sat; the wallet says that tokens stay where they are, so the jar's key stays in the wallet
 157 s     Anna sent her fee coins back: Sent; the fee was 185 satoshis.
 169 s     left: the new phone's wallet shows 0 satoshis; the jar's key (1,000 satoshis with the NFT) is still in it, and the jar holds nothing
```
