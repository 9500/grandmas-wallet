# Stage 8 scripted run in a browser, against the local node: a savings jar through the loss of a phone

Written by `scripts/browser-run-jar.ts local --screens` on 2026-11-18 21:28 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-jar/`; the Savings Jar page is a second tab of the phone that uses it. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node and two backup stores on this machine. The run made the blocks and moved the chain's clock. The wallet page and the Savings Jar page reached each other through the public WizardConnect relays (wss://relay.riften.net:443, wss://relay.cauldron.quest:443); nothing but the session's messages went over them. Times are seconds since the start.

Outcome: every step was carried out.

What the run showed:

- Before the jar was opened, the wallet's Applications screen showed the request of the page that names itself "Savings Jar" (its own name, marked as not verified), the template "Savings Jar" as "Not verified", that approving trusts the template and stores it in the backup first, the action in the template's words, and the wallet's own figures.
- The jar was opened from the Savings Jar page through the wallet (transaction `e7ceb973476b048a49a2764d6e7f856865e5ff25c04567d01943a077638954b1`): 30,000 satoshis until 2026-11-18T22:45:00Z, key `3cccbc1dc3346080bf88ba9d078b8299457860627e9338f0e9178928c69135b8`, address `bchreg:p0rxxesuak3skqpm7q9wzskrn45nsevpdmsxh4usjch269hhat8fu45tr5y60`.
- Emptying before the date: the jar page offers no button for it ("Locked"); from the wallet's list of tokens the review says when the network takes the transaction, and the network refused it: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)".
- On the new phone the swept key was listed as "Cannot be worked out": "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
- After the template from the backup was trusted, the new phone found the jar from the key and the chain: "Open", "Holds 0.0003 BCH · 30,000 sat".
- Up to the first withdrawal the new phone's browser made 101 requests, to http://localhost:8101, ws://127.0.0.1:60403, http://localhost:8111, http://localhost:8112, ws://127.0.0.1:46351: none to the Savings Jar page (http://localhost:8103). The jar was emptied from the wallet's list of tokens (transaction `b97e8aacbf589f2c18d22eab710316e38f016978f2e6c2334b6ec102c7f43315`).
- The wallet's balance rose from 116821 to 146301 satoshis, and the key is still listed ("Closed").
- 8,000 satoshis paid into the jar after the first withdrawal were emptied with the same key (transaction `352b00a61d077e5ae236b0a9e950e00465b93bcef6296dc2a2cb88295096a26b`).
- Connected to the Savings Jar page, the new phone's wallet asked whether the page may see the tokens of its template; once allowed, the page listed the jar from the wallet's answer: 0.00BCH Empty, "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too.".
- The new phone then stopped trusting the template from the wallet's list of templates: the key stayed in the wallet, shown as a token of a template no longer trusted, and the page was told nothing. From its button the page offered its template without an action; the wallet showed the template, the user trusted it, and the page listed the jar again.
- At the end the coins went back to bchtest:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyarjfagm9: the wallet's coins (0.00152849 BCH · 152,849 sat arrived, fee 932 sat), and the recoverer's balance (Sent 0.00296477 BCH · 296,477 sat to qqg3zyg3zy…jfagm9. The fee was 185 sat.). What is left: the jar's key, an NFT on a coin of 1,000 satoshis, in the new phone's wallet, whose balance shows 0 satoshis; the jar is empty; the wallet's controller coin stays on chain, since sending everything leaves it in place and the pages do not close a wallet (its value was not read by this run). Every profile stays on disk.

Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages' first server had it at that moment, and which of the wallet's transactions were not in a block yet when the page had already gone on.

- From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 551; not in a block yet: the creation dc22cbcb0419…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to "Protected", recovery on: 17 s; the chain is at height 551; not in a block yet: the creation dc22cbcb0419…; in a block: 1 of the 2 transactions looked at.
- From "Set it up" to the vault address shown: 18 s; the chain is at height 553; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
- The jar opened from the wallet, 32 s after the payment that funded the wallet; the chain is at height 553; not in a block yet: "Open a savings jar · Savings Jar" e7ceb973476b…; in a block: 2 of the 3 transactions looked at.
- From the completion to the hand-over: 10 s; the chain is at height 566.
- From the completion to the sweep sent by the new phone: 12 s; the chain is at height 567; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
- From the completion to the swept coins in the new phone's wallet: 22 s; the chain is at height 570; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
- From the completion to "Protected" on the new phone: 22 s.
- The jar's date, a time lock the network checks against the median time of the last eleven blocks: the course waited 1 s for the chain's clock to pass it, as the jar is made to.
- The jar emptied from the new phone's list of tokens, once its date had passed; the chain is at height 581; not in a block yet: "Empty a savings jar · Savings Jar" b97e8aacbf58…; in a block: 5 of the 6 transactions looked at.

What these show:

- From the moment the wallet was asked for to a wallet in use with recovery on (17 s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".
- When the new phone sent its sweep (12 s after the completion), a block held the completion already, so this record alone does not show that no step of the takeover waited for one.
- The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.

```
   0 s  local node: node: running, block 550, median time 2026-11-18T22:19:01Z
   0 s  relay: ws://127.0.0.1:46351, on this machine, for the sessions between the pages
   1 s  wallet page: http://localhost:8101/, this checkout at a120c60, regtest
   1 s  recoverer page: http://localhost:8102/, this checkout at a120c60, regtest
   1 s  jar page: http://localhost:8103/, this checkout at a120c60, regtest
   1 s  1. Anna opens the recoverer's page to help someone she knows, and funds her balance
   2 s     friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes
   2 s     Anna's balance is funded at bchtest:qztlajdljd4fuyd974h0cmtlgyrwf7ztr54e47955f; what her page keeps, her words among it, is copied to .chipnet/browser-run-jar/storage-recoverer.json first
   3 s     paid 400000 satoshis in abe50f9b454c94a04625cc609c3137be3f45f7e4c550d0af55f8b9938ac19551:0, confirmed at height 551
  10 s     Anna's page shows her balance: 400000 satoshis
  10 s  2. Anna sets up Grandma's wallet: the phone scans her code, she says yes
  11 s     Anna's code carries her name, her key and a session, 291 characters
  11 s     the phone asked over the session; Anna's page asks "Set up Grandma's wallet?", the phone waits for her
  12 s    [old-phone] console: WebSocket is already in CLOSING or CLOSED state.
  13 s     the phone shows "Your wallet is ready" with 100,000 satoshis
  13 s     From "Set it up" to "Your wallet is ready": 1 s; the chain is at height 551; not in a block yet: the creation dc22cbcb0419…; in a block: 1 of the 2 transactions looked at.
  13 s     Anna's page says the wallet is set up and keeps what a recovery needs
  18 s    [recoverer] console: WebSocket is already in CLOSING or CLOSED state.
  28 s     the wallet shows "Protected": Anna's receipt is on the backup stores
  28 s     From "Set it up" to "Protected", recovery on: 17 s; the chain is at height 551; not in a block yet: the creation dc22cbcb0419…; in a block: 1 of the 2 transactions looked at.
  29 s  3. The owner receives
  29 s     address bchtest:rvxptl50g87p2haxfskzh65zvemzw5ar7r9sfn8hyuwc7udztm9njjdumq8t6
  30 s     paid 50000 satoshis in 3cccbc1dc3346080bf88ba9d078b8299457860627e9338f0e9178928c69135b8:0, confirmed at height 553
  30 s     vault address bchtest:rvespfkdru4mn4l3l6t53smhc6e7ft9hjp307spry5s2hfkgvm4z2k83w3hp5
  30 s     From "Set it up" to the vault address shown: 18 s; the chain is at height 553; not in a block yet: none; in a block: 2 of the 2 transactions looked at.
  37 s     the wallet holds 0.0015 BCH
  37 s  4. The owner connects the wallet to the Savings Jar page and opens a jar from it
  37 s     the Savings Jar page shows its connection address (98 characters, wiz://127.0.0.1:46351…) and waits for a wallet
  39 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through 127.0.0.1:46351 · since Nov 18, 2026, 10:29 PM; "Connected"
  39 s     the Savings Jar page: "Connected to Grandma's Wallet"
  40 s     the jar page lists: "No jars to show. Your wallet has not used this page before, so it tells the page nothing about what it holds."
  41 s     the chain's clock: last block 2026-11-18T22:19:03Z, median time 2026-11-18T22:19:02Z; this machine 2026-11-18T21:29:26Z
  41 s     the form says: "0.0003 BCH stays in the jar until Nov 18, 2026, 11:45 PM, 76 minutes from now." (the date 2026-11-18T22:45:00Z)
  41 s     the jar page: "On its way", "Approved in your wallet Your wallet has the request. Check it there and approve it."
  42 s     the wallet's Applications screen: "Savings Jar asks for your decision"; Its own name, not verified Asked Nov 18, 2026, 10:29 PM
  42 s     the request: template "Savings Jar", "Template not verified" (Nothing was found against the template, and this wallet has not yet seen a token of it lead to its position on chain. Whether its contracts give authority to the token and to nothing else, a wallet cannot check.)
  42 s     it says: "This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it."
  42 s     in the template's words: "Open a savings jar"; Jar key: 3cccbc1d…9135b8; Opens on: 1795041900; Date on the key: 6c2afe6a; Amount to save: 30000; Key holder: aa206cb7…aa0e87
  42 s     the wallet's own figures: Leaves your wallet: 0.0005 BCH · 50,000 sat; Comes back to your wallet: 0.00019523 BCH · 19,523 sat; Goes into the application: 0.0003 BCH · 30,000 sat; Network fee: 477 sat; Your wallet goes down by: 0.00030477 BCH · 30,477 sat
  42 s       Goes to others: Savings jar · at aa20c6…ce9e87 0.0003 BCH · 30,000 sat
  42 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 3cccbc1d…9135b8 with 6c2afe6a
  42 s       Arrives at your wallet: What is left over, as change 0.00018523 BCH · 18,523 sat
  43 s     approved; the wallet: "Done: Open a savings jar", transaction e7ceb973476b048a49a2764d6e7f856865e5ff25c04567d01943a077638954b1
  43 s     The jar opened from the wallet, 32 s after the payment that funded the wallet; the chain is at height 553; not in a block yet: "Open a savings jar · Savings Jar" e7ceb973476b…; in a block: 2 of the 3 transactions looked at.
  47 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 18, 2026, 11:45 PM"
  49 s     the wallet's tokens: "Jar key · Savings Jar" (Open), Holds 0.0003 BCH · 30,000 sat; key 3cccbc1dc3346080bf88ba9d078b8299457860627e9338f0e9178928c69135b8
  50 s     the jar's address, as the page gives it and as the contract makes it from the key and the date: bchreg:p0rxxesuak3skqpm7q9wzskrn45nsevpdmsxh4usjch269hhat8fu45tr5y60
  51 s  5. Emptying the jar before its date is refused
  51 s     the jar page offers no "Empty the jar": 0.0003BCH Locked, "Opens on Nov 18, 2026, 11:45 PM", "In 75 minutes."
  53 s     from the wallet's list of tokens, "Empty a savings jar":
  53 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
  53 s     in the template's words: "Empty a savings jar"; Jar key: 3cccbc1d…9135b8; Opens on: 1795041900; Date on the key: 6c2afe6a; Key holder: aa2053cf…581087; Key input: 1
  53 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Comes back from the application: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
  53 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 3cccbc1d…9135b8 with 6c2afe6a
  53 s       The application's coins it spends: Savings jar · e7ceb9…b1:0 0.0003 BCH · 30,000 sat
  53 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 3cccbc1d…9135b8 with 6c2afe6a
  53 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
  55 s     "Not carried out": "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"
  56 s  6. The phone is lost
  56 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  56 s  7. A new phone takes the wallet over with Anna's help, and sweeps
  59 s     the new phone sent its request over the session of the code
  67 s     the request is in a block; the waiting period runs
  67 s     the recoverer's page shows the chain's clock at 11:19:02 PM, block 555; the waiting period ends when it passes 11:27:34 PM
  68 s     the chain's clock moved on by 700 seconds; height 566
  72 s     the chain's clock on the page moved on by 701 seconds, to block 566
  87 s     completed; the hand-over is ready
  87 s     From the completion to the hand-over: 10 s; the chain is at height 566.
  88 s     the hand-over reached the new phone over the session
  88 s     the recoverer's page says that the new phone has the wallet
  90 s     From the completion to the sweep sent by the new phone: 12 s; the chain is at height 567; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
  91 s    [new-phone] console: WebSocket is already in CLOSING or CLOSED state.
 100 s     the new phone holds 0.00116821 BCH
 100 s     From the completion to the swept coins in the new phone's wallet: 22 s; the chain is at height 570; not in a block yet: none; in a block: 5 of the 5 transactions looked at.
 100 s     recovery is on for the new phone
 100 s     From the completion to "Protected" on the new phone: 22 s.
 100 s  8. The new phone finds the jar from the swept key and the template, the Savings Jar page not consulted, and empties it
 100 s     the Applications screen lists the swept key: "Savings Jar" (Cannot be worked out): "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
 101 s     "A template from your backup": "Savings Jar", "Not verified"
 102 s     trusted; the key: "Jar key · Savings Jar" (Open), "Holds 0.0003 BCH · 30,000 sat"; actions: "Pay into a savings jar", "Empty a savings jar"
 104 s     the chain's clock moved on by 975 seconds; height 581
 104 s     the chain's median time is 2026-11-18T22:47:00Z at height 581, past the jar's date 2026-11-18T22:45:00Z
 104 s     The jar's date, a time lock the network checks against the median time of the last eleven blocks: the course waited 1 s for the chain's clock to pass it, as the jar is made to.
 104 s     the first withdrawal, from the wallet's list of tokens:
 104 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 104 s     in the template's words: "Empty a savings jar"; Jar key: 3cccbc1d…9135b8; Opens on: 1795041900; Date on the key: 6c2afe6a; Key holder: aa2017e9…c4d287; Key input: 1
 104 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Comes back from the application: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
 104 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 3cccbc1d…9135b8 with 6c2afe6a
 104 s       The application's coins it spends: Savings jar · e7ceb9…b1:0 0.0003 BCH · 30,000 sat
 104 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 3cccbc1d…9135b8 with 6c2afe6a
 104 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
 106 s     done: b97e8aacbf589f2c18d22eab710316e38f016978f2e6c2334b6ec102c7f43315
 106 s     The jar emptied from the new phone's list of tokens, once its date had passed; the chain is at height 581; not in a block yet: "Empty a savings jar · Savings Jar" b97e8aacbf58…; in a block: 5 of the 6 transactions looked at.
 106 s     up to here the new phone's browser made 101 requests, to http://localhost:8101, ws://127.0.0.1:60403, http://localhost:8111, http://localhost:8112, ws://127.0.0.1:46351; none to the Savings Jar page (http://localhost:8103)
 108 s     the wallet's balance rose from 116821 to 146301 satoshis
 108 s     the key is still listed: "Jar key · Savings Jar" (Closed), "It holds nothing now."
 109 s  9. Someone pays into the jar again, and the new phone empties that too
 110 s     paid 8000 satoshis in ab8c6e7b44a2680c2575f6a98395de5ffbb007308f54d95b6d6382f97a76944b:0, confirmed at height 583
 112 s     the key: (Open), "Holds 0.00008 BCH · 8,000 sat"
 112 s     the second withdrawal, from the wallet's list of tokens:
 112 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 112 s     in the template's words: "Empty a savings jar"; Jar key: 3cccbc1d…9135b8; Opens on: 1795041900; Date on the key: 6c2afe6a; Key holder: aa20dc9e…b11987; Key input: 1
 112 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0000848 BCH · 8,480 sat; Comes back from the application: 0.00008 BCH · 8,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0000748 BCH · 7,480 sat
 112 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 3cccbc1d…9135b8 with 6c2afe6a
 112 s       The application's coins it spends: Savings jar · ab8c6e…4b:0 0.00008 BCH · 8,000 sat
 112 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 3cccbc1d…9135b8 with 6c2afe6a
 112 s       Arrives at your wallet: What is left over, as change 0.0000748 BCH · 7,480 sat
 112 s     done: 352b00a61d077e5ae236b0a9e950e00465b93bcef6296dc2a2cb88295096a26b
 113 s  10. The new phone connects to the Savings Jar page, which lists the jar from the wallet's answer
 113 s     the Savings Jar page shows its connection address (98 characters, wiz://127.0.0.1:46351…) and waits for a wallet
 115 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through 127.0.0.1:46351 · since Nov 18, 2026, 10:30 PM; "Connected"
 115 s     the Savings Jar page: "Connected to Grandma's Wallet"
 115 s     the wallet: "Savings Jar asks to see your tokens": "It asks which tokens of the template Savings Jar this wallet holds, and what they control. You trust this template on this phone, but not in a session with this application, so it was told nothing."
 145 s     allowed; the Savings Jar page lists, from the wallet's answer: 0.00BCH Empty, "Opens on Nov 18, 2026, 11:45 PM", "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too."
 148 s     the wallet no longer trusts the template: its list says "Savings Jar Not trusted · you stopped trusting it ›"
 148 s     the key is still in the wallet: "A note says the template "Savings Jar" made this token. You stopped trusting that template."
 176 s     the page offers its template; the wallet: "Savings Jar offers its template", Savings Jar
 177 s     trusted again in the wallet ("Savings Jar Trusted · in your backup ›"); the Savings Jar page lists the jar again
 177 s  11. The coins go back to where they came from
 178 s     the new phone sent everything to bchtest:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyarjfagm9: 0.00152849 BCH · 152,849 sat arrives, fee 932 sat; the wallet says that tokens stay where they are, so the jar's key stays in the wallet
 181 s     Anna sent her balance back: Sent 0.00296477 BCH · 296,477 sat to qqg3zyg3zy…jfagm9. The fee was 185 sat.
 194 s     left: the new phone's wallet shows 0 satoshis; the jar's key (1,000 satoshis with the NFT) is still in it, and the jar holds nothing
```
