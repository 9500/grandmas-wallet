# Stage 8 scripted run in a browser, on chipnet with the public pages: a savings jar through the loss of a phone

Written by `scripts/browser-run-jar.ts` on 2026-11-18 04:18 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-jar-chipnet/`; the Savings Jar page is a second tab of the phone that uses it. The pages are the public ones, https://wallet.9500.cash/, https://recoverer.9500.cash/ and https://jar.9500.cash/, as served, on chipnet with the public backup stores. Blocks, the waiting period and the jar's date took their real time. The wallet page and the Savings Jar page reached each other through the public WizardConnect relays (wss://relay.riften.net:443, wss://relay.cauldron.quest:443); nothing but the session's messages went over them. Times are seconds since the start.

Outcome: every step was carried out, in 3 parts with the same browser profiles: each part that stopped, and where the next took over, is named below and in the log.

The run stopped in step 9 and was continued from step 9 with the same profiles (`--from 9`); the line "continued from step 9" in the log marks where. The stopped run kept the list of the new phone's requests in memory, and it was lost with that process: the requests of the new phone's browser were recorded only in the continued part. What remains of the first part is the profile's local storage, read before the profile was opened again: the new phone's held entries of https://wallet.9500.cash, and none of the Savings Jar page (https://jar.9500.cash), whose page writes there whenever it starts (the old phone's profile, which opened it, held entries of it). That shows that the Savings Jar page did not run in the new phone's browser; it does not show, as a recording would, that nothing in that browser ever asked the page's server for anything.
A part of the run stopped: "FAILED at step 9: the first withdrawal was not carried out: The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The" It was continued from the next "continued from step" line of the log.
A part of the run stopped: "FAILED at step 12: locator.textContent: Timeout 30000ms exceeded." It was continued from the next "continued from step" line of the log.

What the run showed:

- (From the log of the stopped run.) The jar was opened from the Savings Jar page through the wallet (transaction `8f0cc78c2ee2d9d52542de95e76171dca112a55afeee71e6b21ae63d9c80556e`): 30,000 satoshis until 2026-11-18T04:07:00Z, key `e3ef56ae44f3a90692e73a3df017c17b12e7c604c142d9a40bcafd1cb82afbcf`, address `bchtest:pdkt7pv9wzlzpa0jvp4sdsfrure8av0wp0av2jmkt6nj4dw27nx7yx35fnmpr`.
- (From the log of the stopped run.) Emptying before the date: the jar page offered no button for it ("Locked"), and from the wallet's list of tokens the network refused it: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"
- Up to the first withdrawal in the continued part of the run the new phone's browser made 141 requests, to https://wallet.9500.cash, wss://chipnet.9500.cash, wss://chipnet.imaginary.cash:50004, https://store1.9500.cash, https://store2.9500.cash: none to the Savings Jar page (https://jar.9500.cash). (The requests of the stopped part were not kept; see above.) The jar was emptied from the wallet's list of tokens (transaction `6330c94464e382398b633edc1f6000ca0dabc2d3c2aa6e43c247941b5d8b67fb`).
- The wallet's balance rose from 130196 to 159676 satoshis, and the key is still listed ("Closed").
- 8,000 satoshis paid into the jar after the first withdrawal were emptied with the same key (transaction `09664cb5f2c0f1a257a9853365a405dddeae75a7aff27dba62b20c4adb682a0c`).
- Connected to the Savings Jar page, the new phone's wallet asked whether the page may see the tokens of its template; once allowed, the page listed the jar from the wallet's answer: 0.00BCH Empty, "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too.".
- At the end the coins went back to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u, the address that paid for the run: the wallet's coins, sent by the part of the run that stopped (0.00165928 BCH · 165,928 sat arrived, fee 1,228 sat; the coin kept for cancelling went too), and the recoverer's fee coins, sent by the part of the run that stopped (Sent; the fee was 185 satoshis.); her page now says: "The fee address holds too little to send on.". What is left: the jar's key, an NFT on a coin of 1,000 satoshis, in the new phone's wallet, whose balance shows 0 satoshis; the jar is empty; the wallet's controller coin stays on chain, since sending everything leaves it in place and the pages do not close a wallet (its value was not read by this run). Every profile stays on disk.

```
   0 s  wallet page: https://wallet.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   0 s  recoverer page: https://recoverer.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   0 s  jar page: https://jar.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   1 s  funding address: 60953161 satoshis in 3 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   1 s  1. The recoverer opens its page and gives its link
   3 s     link of 188 characters; fingerprint 22e9 8e69 785f a264
   5 s  2. The owner creates a wallet with Anna as recoverer
   8 s     the wallet shows the same fingerprint, 22e9 8e69 785f a264
  16 s     funding address bchtest:qpfd7f94tg72z72kr2j67pytj9k93lvavc8ukyhhr3
  17 s     paid 120000 satoshis in c5a92a24385420714cfcffefae69bc4770526beb2d9475f25bf9cead7446d539:0, unconfirmed
  22 s     created; waiting for a block
 144 s     confirmed; the kit link has 1302 characters
 144 s  3. Anna takes in the kit; the wallet says that recovery is on
 147 s     the recoverer kept the kit and left its receipt
 176 s     the wallet shows "Protected"
 176 s  4. The owner receives
 176 s     address bchtest:pw3rjeqqd54nnjcc3fkrzclacs3cun5j07p9j3w3s5pt25rgyv9ysgjpd28wp
 177 s     paid 50000 satoshis in e3ef56ae44f3a90692e73a3df017c17b12e7c604c142d9a40bcafd1cb82afbcf:0, unconfirmed
 177 s     vault address bchtest:pdhmsg7yzrley7h0t4k4g6l34dcrp7vudwrf9t2jztst8d9yhj5k5fgwm0lnj
 177 s     the wallet holds 0.00113679 BCH
 177 s  5. The owner connects the wallet to the Savings Jar page and opens a jar from it
 177 s     the Savings Jar page shows its connection address (77 characters, wiz://…) and waits for a wallet
 180 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 4:26 AM; "Connected"
 180 s     the Savings Jar page: "Connected to Grandma's Wallet"
 181 s     the jar page lists: "No jars to show. Your wallet tells this page about its jars once you open one here, or once you allow it in the wallet."
 182 s     the form says: "0.0003 BCH stays in the jar until Nov 18, 2026, 5:07 AM, 40 minutes from now." (the date 2026-11-18T04:07:00Z)
 183 s     the jar page: "On its way", "Approved in your wallet Your wallet has the request. Check it there and approve it."
 183 s     the wallet's Applications screen: "Savings Jar asks for your decision"; Its own name, not verified Asked Nov 18, 2026, 4:26 AM
 183 s     the request: template "Savings Jar", "Not verified" (Nothing was found against the template, and this wallet has not yet seen a token of it lead to its position on chain. Whether its contracts give authority to the token and to nothing else, a wallet cannot check.)
 183 s     it says: "This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it."
 183 s     in the template's words: "Open a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Amount to save: 30000; Key holder: aa202a53…791a87
 183 s     the wallet's own figures: Leaves your wallet: 0.0005 BCH · 50,000 sat; Comes back to your wallet: 0.00019523 BCH · 19,523 sat; Network fee: 477 sat; Your wallet goes down by: 0.00030477 BCH · 30,477 sat
 184 s       Goes to others: Savings jar · at aa206c…cde287 0.0003 BCH · 30,000 sat
 184 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 184 s       Arrives at your wallet: What is left over, as change 0.00018523 BCH · 18,523 sat
 185 s     approved; the wallet: "Done: Open a savings jar", transaction 8f0cc78c2ee2d9d52542de95e76171dca112a55afeee71e6b21ae63d9c80556e
 190 s     the jar page: "The jar is open. Its key is in your wallet."; the jar: 0.0003BCH Locked, "Opens on Nov 18, 2026, 5:07 AM"
 191 s     the wallet's tokens: "Savings Jar" (Open), Holds 0.0003 BCH · 30,000 sat; key e3ef56ae44f3a90692e73a3df017c17b12e7c604c142d9a40bcafd1cb82afbcf
 192 s     the jar's address, as the page gives it and as the contract makes it from the key and the date: bchtest:pdkt7pv9wzlzpa0jvp4sdsfrure8av0wp0av2jmkt6nj4dw27nx7yx35fnmpr
 193 s  6. Emptying the jar before its date is refused
 194 s     the jar page offers no "Empty the jar": 0.0003BCH Locked, "Opens on Nov 18, 2026, 5:07 AM", "In 40 minutes."
 197 s     from the wallet's list of tokens, "Empty a savings jar":
 197 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 197 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20858a…8d6187; Key input: 1
 197 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
 197 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 197 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 197 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
 197 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 199 s     "Not carried out": "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"
 200 s  7. The phone is lost
 200 s     the old phone's profile, with its wallet tab and its Savings Jar tab, is no longer opened
 200 s  8. A new phone takes the wallet over with Anna's help, and sweeps
 203 s     both sides show 9d58 c4fa 6bf5 98d5
 223 s     the request is in a block; the waiting period runs
 223 s     the waiting period takes its real time
 865 s     completed; the hand-over link is ready
 925 s     the new phone holds 0.00130196 BCH
 925 s     recovery is on for the new phone
 925 s  9. The new phone finds the jar from the swept key and the template, the Savings Jar page not consulted, and empties it
 928 s     the Applications screen lists the swept key: "Savings Jar" (Cannot be worked out): "A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
 929 s     "A template from your backup": "Savings Jar", "Not verified"
 930 s     trusted; the key: "Savings Jar" (Open), "Holds 0.0003 BCH · 30,000 sat"; actions: "Pay into a savings jar", "Empty a savings jar"
 933 s     the first withdrawal, from the wallet's list of tokens:
 933 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 933 s     it says: "You trust this template on this phone, and it is not in your backup yet. Approving stores it there first, before anything is signed."
 933 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
 933 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
 933 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 933 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 933 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
 933 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 935 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
 995 s     the first withdrawal, from the wallet's list of tokens:
 995 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 995 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa201934…34cb87; Key input: 1
 995 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
 995 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 995 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 995 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
 995 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 997 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1057 s     the first withdrawal, from the wallet's list of tokens:
1057 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1057 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20ed05…6d5f87; Key input: 1
1057 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1057 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1057 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1057 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1057 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1059 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1120 s     the first withdrawal, from the wallet's list of tokens:
1120 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1120 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1120 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1120 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1120 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1120 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1120 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1121 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1181 s     the first withdrawal, from the wallet's list of tokens:
1181 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1181 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1181 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1181 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1181 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1181 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1181 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1183 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1243 s     the first withdrawal, from the wallet's list of tokens:
1243 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1243 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1243 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1243 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1243 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1243 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1243 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1244 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1305 s     the first withdrawal, from the wallet's list of tokens:
1305 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1305 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1305 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1305 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1305 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1305 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1305 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1307 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1367 s     the first withdrawal, from the wallet's list of tokens:
1367 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1367 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1367 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1367 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1367 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1367 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1367 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1368 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1428 s     the first withdrawal, from the wallet's list of tokens:
1428 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1428 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1428 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1428 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1428 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1428 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1428 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1430 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1490 s     the first withdrawal, from the wallet's list of tokens:
1490 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1490 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1490 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1490 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1490 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1490 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1490 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1492 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1552 s     the first withdrawal, from the wallet's list of tokens:
1552 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1552 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1552 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1552 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1552 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1552 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1552 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1553 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1613 s     the first withdrawal, from the wallet's list of tokens:
1613 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1613 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1613 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1613 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1613 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1613 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1613 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1615 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1675 s     the first withdrawal, from the wallet's list of tokens:
1675 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1675 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1675 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1675 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1675 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1675 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1675 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1676 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1736 s     the first withdrawal, from the wallet's list of tokens:
1736 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1736 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1736 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1736 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1736 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1736 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1736 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1738 s     not yet: "The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)"; tried again in a minute
1798 s     the first withdrawal, from the wallet's list of tokens:
1798 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
1798 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
1798 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
1798 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1798 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
1798 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
1798 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
1799 s  FAILED at step 9: the first withdrawal was not carried out: The network does not take this transaction yet: the time it names has not come by the chain's clock, which goes by the median time of the last eleven blocks and runs some minutes behind the real one. Nothing was spent; try again later. (The network said: bad-txns-nonfinal, non-final transaction.)
   0 s  wallet page: https://wallet.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   0 s  recoverer page: https://recoverer.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   0 s  jar page: https://jar.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   1 s  funding address: 60679578 satoshis in 1 coin at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
       continued from step 9 on 2026-11-18 03:58 UTC with the same browser profiles; the times below are seconds since then
   1 s     the jar: key e3ef56ae44f3a90692e73a3df017c17b12e7c604c142d9a40bcafd1cb82afbcf, date 2026-11-18T04:07:00Z, address bchtest:pdkt7pv9wzlzpa0jvp4sdsfrure8av0wp0av2jmkt6nj4dw27nx7yx35fnmpr
   1 s     before it is opened again, the new phone's profile holds local storage of https://wallet.9500.cash; the old phone's of https://jar.9500.cash, https://wallet.9500.cash
   2 s  9. The new phone finds the jar from the swept key and the template, the Savings Jar page not consulted, and empties it
   4 s     the template is trusted on this phone already (by the stopped run); the key: "Savings Jar" (Open), "Holds 0.0003 BCH · 30,000 sat"
   4 s     the chain's median time is 2026-11-18T03:53:09Z at height 336239; the jar's date is 2026-11-18T04:07:00Z. Waiting for the network's clock to pass it
  64 s     the chain's median time is 2026-11-18T03:53:25Z at height 336240
 124 s     the chain's median time is 2026-11-18T03:54:02Z at height 336241
 184 s     the chain's median time is 2026-11-18T03:54:02Z at height 336241
 244 s     the chain's median time is 2026-11-18T03:54:29Z at height 336242
 305 s     the chain's median time is 2026-11-18T03:54:52Z at height 336243
 365 s     the chain's median time is 2026-11-18T03:56:54Z at height 336244
 425 s     the chain's median time is 2026-11-18T04:00:08Z at height 336246
 485 s     the chain's median time is 2026-11-18T04:00:08Z at height 336246
 545 s     the chain's median time is 2026-11-18T04:02:09Z at height 336247
 605 s     the chain's median time is 2026-11-18T04:02:20Z at height 336248
 665 s     the chain's median time is 2026-11-18T04:02:39Z at height 336249
 726 s     the chain's median time is 2026-11-18T04:02:39Z at height 336249
 786 s     the chain's median time is 2026-11-18T04:04:43Z at height 336250
 846 s     the chain's median time is 2026-11-18T04:04:50Z at height 336251
 906 s     the chain's median time is 2026-11-18T04:06:52Z at height 336252
 966 s     the chain's median time is 2026-11-18T04:09:01Z at height 336254
 966 s     the chain's median time is 2026-11-18T04:09:01Z at height 336254, past the jar's date 2026-11-18T04:07:00Z
 967 s     the first withdrawal, from the wallet's list of tokens:
 967 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 967 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
 967 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0003048 BCH · 30,480 sat; Taken out of the application's scripts: 0.0003 BCH · 30,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0002948 BCH · 29,480 sat
 967 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 967 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 967 s       Arrives at your wallet: What is left over, as change 0.0002948 BCH · 29,480 sat
 967 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 968 s     done: 6330c94464e382398b633edc1f6000ca0dabc2d3c2aa6e43c247941b5d8b67fb
 968 s     up to here in the continued part of the run the new phone's browser made 141 requests, to https://wallet.9500.cash, wss://chipnet.9500.cash, wss://chipnet.imaginary.cash:50004, https://store1.9500.cash, https://store2.9500.cash; none to the Savings Jar page (https://jar.9500.cash)
 972 s     the wallet's balance rose from 130196 to 159676 satoshis
 972 s     the key is still listed: "Savings Jar" (Closed), "It holds nothing now."
 972 s  10. Someone pays into the jar again, and the new phone empties that too
 973 s     paid 8000 satoshis in b4ce5e880722048b25da9d261a88e66d414550f6c64185edba8390119d8aca78:0, unconfirmed
 977 s     the key: (Open), "Holds 0.00008 BCH · 8,000 sat"
 977 s     the second withdrawal, from the wallet's list of tokens:
 977 s     the review: template "Savings Jar", "Verified" (The checks this wallet can run have passed, and a token made with the template led to its position on chain. This does not mean that the contract was audited.)
 977 s     in the template's words: "Empty a savings jar"; Jar key: e3ef56ae…2afbcf; Opens on: 1794974820; Date on the key: 6424fd6a; Key holder: aa20478e…299487; Key input: 1
 977 s     the wallet's own figures: Leaves your wallet: 0.00001 BCH · 1,000 sat; Comes back to your wallet: 0.0000848 BCH · 8,480 sat; Taken out of the application's scripts: 0.00008 BCH · 8,000 sat; Network fee: 520 sat; Your wallet goes up by: 0.0000748 BCH · 7,480 sat
 977 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 977 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT of token e3ef56ae…2afbcf with 6424fd6a
 977 s       Arrives at your wallet: What is left over, as change 0.0000748 BCH · 7,480 sat
 977 s       "The network accepts this transaction from Nov 18, 2026, 5:07 AM on, not earlier. It goes by the chain's clock, which runs a little behind the real one."
 978 s     done: 09664cb5f2c0f1a257a9853365a405dddeae75a7aff27dba62b20c4adb682a0c
 978 s  11. The new phone connects to the Savings Jar page, which lists the jar from the wallet's answer
 979 s     the Savings Jar page shows its connection address (77 characters, wiz://…) and waits for a wallet
 981 s     the wallet's Applications screen: "Savings Jar", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 5:14 AM; "Connected"
 981 s     the Savings Jar page: "Connected to Grandma's Wallet"
 981 s     the wallet: "Savings Jar asks to see your tokens": "It asks which tokens of the template Savings Jar this wallet holds, and what they control. You trust this template on this phone, but not in a session with this application, so it was told nothing."
1011 s     allowed; the Savings Jar page lists, from the wallet's answer: 0.00BCH Empty, "Opened on Nov 18, 2026, 5:07 AM", "Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too."
1011 s  12. The coins go back to where they came from
1014 s     the new phone sent everything to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u: 0.00165928 BCH · 165,928 sat arrives, fee 1,228 sat; the wallet says that tokens stay where they are, so the jar's key stays in the wallet
1017 s     Anna sent her fee coins back: Sent; the fee was 185 satoshis.
1031 s     left: the new phone's wallet shows 0 satoshis; the jar's key (1,000 satoshis with the NFT) is still in it, and the jar holds nothing
1061 s  FAILED at step 12: locator.textContent: Timeout 30000ms exceeded.
       continued from step 12 on 2026-11-18 04:18 UTC with the same browser profiles; the times below are seconds since then
   0 s  wallet page: https://wallet.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   0 s  recoverer page: https://recoverer.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   0 s  jar page: https://jar.9500.cash/, commit 033c3c8 of design-2, released 2026-11-18T03:23:27Z
   1 s  funding address: 60840031 satoshis in 3 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   1 s     the jar: key e3ef56ae44f3a90692e73a3df017c17b12e7c604c142d9a40bcafd1cb82afbcf, date 2026-11-18T04:07:00Z, address bchtest:pdkt7pv9wzlzpa0jvp4sdsfrure8av0wp0av2jmkt6nj4dw27nx7yx35fnmpr
   1 s  12. The coins go back to where they came from
   4 s     the wallet has nothing left to send: "Too little to send", it holds 0 sat it could spend
   7 s     Anna's fee address: "The fee address holds too little to send on."
  21 s     left: the new phone's wallet shows 0 satoshis; the jar's key (1,000 satoshis with the NFT) is still in it, and the jar holds nothing
  27 s     funding address: 60840031 satoshis in 3 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
```
