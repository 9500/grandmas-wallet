# Stage 8 scripted run in a browser, against the local node: a savings jar through the loss of a phone

Written by `scripts/browser-run-jar.ts` on 2026-11-18 03:10 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-jar/`; the Savings Jar page is a second tab of the phone that uses it. The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node and two backup stores on this machine. The run made the blocks and moved the chain's clock. The wallet page and the Savings Jar page reached each other through the public WizardConnect relays (wss://relay.riften.net:443, wss://relay.cauldron.quest:443); nothing but the session's messages went over them. Times are seconds since the start.

Outcome: every step was carried out.

What the run showed:

- Before the jar was opened, the wallet's Applications screen showed the request of the page that names itself "Savings Jar" (its own name, marked as not verified), the template "Savings Jar" as "Not verified", that approving trusts the template and stores it in the backup first, the action in the template's words, and the wallet's own figures.
- The jar was opened from the Savings Jar page through the wallet (transaction `be8547fd58a6694f7e5bac6c465c3663c720b34013e638d8af197f93a916a4e9`): 30,000 satoshis until 2026-11-18T04:55:00Z, key `11278fb7e8de8f6877ec41261c69b7c9c5691d6ca353727c4133986560b5fe8e`, address `bchreg:pd3ya685zmzy75q90y9w63gt4sxr6fjwa6xcpej7u97cvh4759rdk8lp2mn44`.
- Emptying before the date: the jar page offers no button for it ("Locked"); from the wallet's list of tokens the review says when the network takes the transaction, and the network refused it: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)".
- On the new phone the swept key was listed as "Cannot be worked out": "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
- After the template from the backup was trusted, the new phone found the jar from the key and the chain: "Open", "Holds 0.0003 BCH · 30,000 sat".
- Up to the first withdrawal the new phone's browser made 100 requests, to http://localhost:8101, ws://127.0.0.1:60403, http://localhost:8111, http://localhost:8112: none to the Savings Jar page (http://localhost:8103). The jar was emptied from the wallet's list of tokens (transaction `1942254a592114f0ed07ea8c5bf47d7b6b68833ace1a29aff9d85268f7d19df1`).
- The wallet's balance rose from 130196 to 159676 satoshis, and the key is still listed ("Closed").
- 8,000 satoshis paid into the jar after the first withdrawal were emptied with the same key (transaction `23fdd69fffc3195267469c86e09ab23cd0aacbef274329dbf33e70031735b120`).
- Connected to the Savings Jar page, the new phone's wallet asked whether the page may see the tokens of its template; once allowed, the page listed the jar from the wallet's answer: 0.00BCH Empty, "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too.".

```
   0 s  local node: node: running, block 700, median time 2026-11-18T04:29:01Z
   1 s  1. The recoverer opens its page and gives its link
   2 s     link of 180 characters; fingerprint f171 37a8 9efe 5558
   2 s  2. The owner creates a wallet with Anna as recoverer
   3 s     the wallet shows the same fingerprint, f171 37a8 9efe 5558
   4 s     funding address bchtest:qraxqmfzhwdx7h8xd5rht0rtpmynh70kcydq37ndk7
   5 s     paid 120000 satoshis in 5d6ff10d435264e9a02fdeb3706d494145433aad0f4d0f854dca507889ae53ab:0, confirmed at height 701
   9 s     created; waiting for a block, which the run makes now
  15 s     confirmed; the kit link has 1288 characters
  15 s  3. Anna takes in the kit; the wallet says that recovery is on
  15 s     the recoverer kept the kit and left its receipt
  45 s     the wallet shows "Protected"
  45 s  4. The owner receives
  45 s     address bchtest:pvcz2gxj2ksdcyfwyd7fyeln9vml52kwxww6yetv3f2uqe0c2zkjcuk8c34sm
  46 s     paid 50000 satoshis in 11278fb7e8de8f6877ec41261c69b7c9c5691d6ca353727c4133986560b5fe8e:0, confirmed at height 703
  46 s     vault address bchtest:pdyu9hq25lnc2zjptutm5u9daydpadxfcfu8fd03e2u6ldemn2zsc8v09wtmr
  46 s     the wallet holds 0.00113679 BCH
  46 s  5. The owner connects the wallet to the Savings Jar page and opens a jar from it
  46 s     the Savings Jar page shows its connection address (77 characters, wiz://…) and waits for a wallet
  48 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 4:11 AM; "Connected"
  48 s     the Savings Jar page: "Connected to Grandma's Wallet"
  49 s     the jar page lists: "No jars to show. Your wallet tells this page about its jars once you open one here, or once you allow it in the wallet."
  50 s     the chain's clock: last block 2026-11-18T04:29:02Z, median time 2026-11-18T04:29:01Z; this machine 2026-11-18T03:11:07Z
  50 s     the form says: "0.0003 BCH stays in the jar until Nov 18, 2026, 5:55 AM, 2 hours from now." (the date 2026-11-18T04:55:00Z)
  50 s     the jar page: "On its way", "Approved in your wallet Your wallet has the request. Check it there and approve it."
  51 s     the wallet's Applications screen: "Savings Jar asks for your decision"; Its own name, not verified Asked Nov 18, 2026, 4:11 AM
  51 s     the request: template "Savings Jar", "Not verified" (Nothing was found against the template, and this wallet has not yet seen a token of it lead to its position on chain. Whether its contracts give authority to the token and to nothing else, a wallet cannot check.)
  51 s     it says: "This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it."
  51 s     in the template's words: "Open a savings jar"; Jar key: 11278fb7…b5fe8e; Opens on: 1794977700; Date on the key: a42ffd6a; Amount to save: 30000; Key holder: aa202d76…381087
  51 s     the wallet's own figures: Leaves your wallet: 0.0005 BCH · 50,000 sat; Comes back to your wallet: 0.00019523 BCH · 19,523 sat; Network fee: 477 sat; Your wallet goes down by: 0.00030477 BCH · 30,477 sat
  51 s       Goes to others: Savings jar · at aa2062…46db87 0.0003 BCH · 30,000 sat
  51 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 11278fb7…b5fe8e with a42ffd6a
  51 s       Arrives at your wallet: What is left over, as change 0.00018523 BCH · 18,523 sat
  53 s     approved; the wallet: "Done: Open a savings jar", transaction be8547fd58a6694f7e5bac6c465c3663c720b34013e638d8af197f93a916a4e9
  57 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 18, 2026, 5:55 AM"
  59 s     the wallet's tokens: "Savings Jar" (Open), Holds 0.0003 BCH · 30,000 sat; key 11278fb7e8de8f6877ec41261c69b7c9c5691d6ca353727c4133986560b5fe8e
  60 s     the jar's address, as the page gives it and as the contract makes it from the key and the date: bchreg:pd3ya685zmzy75q90y9w63gt4sxr6fjwa6xcpej7u97cvh4759rdk8lp2mn44
  61 s  6. Emptying the jar before its date is refused
  62 s     the jar page offers no "Empty the jar": 0.0003BCH Locked, "Opens on Nov 18, 2026, 5:55 AM", "In 2 hours."
  63 s     from the wallet's list of tokens, "Empty a savings jar":
  63 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
  63 s     in the template's words: "Empty a savings jar"; Jar key: 11278fb7…b5fe8e; Opens on: 1794977700; Date on the key: a42ffd6a; Key holder: aa205759…8d1187; Key input: 1
  63 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
  63 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 11278fb7…b5fe8e with a42ffd6a
  63 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 11278fb7…b5fe8e with a42ffd6a
  63 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
  63 s       "The network accepts this transaction from Nov 18, 2026, 5:55 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
  64 s     "Not carried out": "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"
  65 s  7. The phone is lost
  65 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
  65 s  8. A new phone takes the wallet over with Anna's help, and sweeps
  66 s     both sides show 668d d6b8 869e 8573
  78 s     the request is in a block; the waiting period runs
  79 s     the chain's clock moved on by 700 seconds; height 716
  98 s     completed; the hand-over link is ready
 100 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 718: The requested header is ahead of the current checkpoint at height 717
 101 s    [new-phone] console: Failed to process transaction update: Error: Could not validate a block header on height 718: The requested header is ahead of the current checkpoint at height 717
 113 s     the new phone holds 0.00130196 BCH
 115 s     recovery is on for the new phone
 115 s  9. The new phone finds the jar from the swept key and the template, the Savings Jar page not consulted, and empties it
 116 s     the Applications screen lists the swept key: "Savings Jar" (Cannot be worked out): "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
 117 s     "A template from your backup": "Savings Jar", "Not verified"
 118 s     trusted; the key: "Savings Jar" (Open), "Holds 0.0003 BCH · 30,000 sat"; actions: "Pay into a savings jar", "Empty a savings jar"
 119 s     the chain's clock moved on by 975 seconds; height 732
 119 s     the chain's median time is 2026-11-18T04:57:00Z, past the jar's date 2026-11-18T04:55:00Z
 122 s     the first withdrawal, from the wallet's list of tokens:
 122 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 122 s     it says: "You trust this template on this phone, and it is not in your backup yet. Approving stores it there first, before anything is signed."
 122 s     in the template's words: "Empty a savings jar"; Jar key: 11278fb7…b5fe8e; Opens on: 1794977700; Date on the key: a42ffd6a; Key holder: aa20aa7a…6e1687; Key input: 1
 122 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
 122 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 11278fb7…b5fe8e with a42ffd6a
 122 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 11278fb7…b5fe8e with a42ffd6a
 122 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
 122 s       "The network accepts this transaction from Nov 18, 2026, 5:55 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 123 s     done: 1942254a592114f0ed07ea8c5bf47d7b6b68833ace1a29aff9d85268f7d19df1
 123 s     up to here the new phone's browser made 100 requests, to http://localhost:8101, ws://127.0.0.1:60403, http://localhost:8111, http://localhost:8112; none to the Savings Jar page (http://localhost:8103)
 132 s     the wallet's balance rose from 130196 to 159676 satoshis
 132 s     the key is still listed: "Savings Jar" (Closed), "It holds nothing now."
 133 s  10. Someone pays into the jar again, and the new phone empties that too
 134 s     paid 8000 satoshis in fe3815e15339d33082de9d02a16e3f4e10ed06cc109541c37aed0019d3c735eb:0, confirmed at height 734
 136 s     the key: (Open), "Holds 0.00008 BCH · 8,000 sat"
 136 s     the second withdrawal, from the wallet's list of tokens:
 136 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 136 s     in the template's words: "Empty a savings jar"; Jar key: 11278fb7…b5fe8e; Opens on: 1794977700; Date on the key: a42ffd6a; Key holder: aa202534…a78087; Key input: 1
 136 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0000848 BCH · 8,480 sat; Taken out of the application's scripts: 0.00008 BCH · 8,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0000748 BCH · 7,480 sat
 136 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token 11278fb7…b5fe8e with a42ffd6a
 136 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token 11278fb7…b5fe8e with a42ffd6a
 136 s       Arrives at your wallet: What is left over, as change 0.0000748 BCH · 7,480 sat
 136 s       "The network accepts this transaction from Nov 18, 2026, 5:55 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 136 s     done: 23fdd69fffc3195267469c86e09ab23cd0aacbef274329dbf33e70031735b120
 137 s  11. The new phone connects to the Savings Jar page, which lists the jar from the wallet's answer
 137 s     the Savings Jar page shows its connection address (77 characters, wiz://…) and waits for a wallet
 139 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 4:12 AM; "Connected"
 139 s     the Savings Jar page: "Connected to Grandma's Wallet"
 140 s     the wallet: "Savings Jar asks to see your tokens": "It asks which tokens of the template Savings Jar this wallet holds, and what they control. You trust this template on this phone, but not in a session with this application, so it was told nothing."
 170 s     allowed; the Savings Jar page lists, from the wallet's answer: 0.00BCH Empty, "Opens on Nov 18, 2026, 5:55 AM", "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too."
```
