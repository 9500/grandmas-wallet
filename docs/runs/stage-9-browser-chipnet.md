# Stage 9 scripted run in a browser, on chipnet: a ParyonUSD loan from the loan page, through the loss of a phone

Written by `scripts/browser-run-loan.ts chipnet --local-pages` on 2026-11-18 07:18 UTC. Chromium (Playwright), one browser profile per device kept on disk under `.chipnet/browser-run-loan-chipnet/`; the loan page is a second tab of the phone that uses it. The pages are this checkout's production builds (`deploy/preview.sh build`), served on this machine by `deploy/serve.mjs` with the content security policy and `deploy/config/local.json`: the wallet at http://localhost:8101/, the recoverer at http://localhost:8102/, the loan page at http://localhost:8104/ (it has no public address), and two backup stores of the run's own. They worked on chipnet, against Paryon's deployment `chipnet-fast-periods-6`, its contracts used unchanged. The wallet page and the loan page reached each other through the public WizardConnect relays (wss://relay.riften.net:443, wss://relay.cauldron.quest:443). The loan page is an independent demonstration, not Paryon's site. Times are seconds since the start.

Outcome: every step was carried out, in parts with the same browser profiles, as named below and in the log.

The first part stopped in step 6, after the key was made and approved: the loan page had forgotten the key, because it asked the server for the key's outputs a moment before the server listed them and took them for spent. The page was changed to keep a key made in the last ten minutes while its outputs are not listed yet (apps/loan/src/xo.ts, with a test), rebuilt, and the key's transaction was put back into the page's list in the old phone's profile by script; the run was then continued from step 7.
The run was continued from step 7 with the same browser profiles; the line "continued from step 7" in the log marks where.
The run was continued from step 15 with the same browser profiles; the line "continued from step 15" in the log marks where.

What the run showed:

- The wallet was paired with the loan page over WizardConnect: the page showed its connection address, the wallet connected to it from its Applications screen, and the page said that it is an independent demonstration on chipnet with Paryon's public contracts, not Paryon's site.
- The loan page found Paryon's borrowing contract behind the current period and explained it: "Paryon's contracts count time in periods of about half an hour, and a loan pays interest for each period from the one it starts in. The contract that would lend to you was last moved on 1,150 periods ago, because Paryon's keepers on this test network have stopped. A loan opened from it now could be charged a fee for each of those periods, up to 1,725,000 satoshis." The wallet moved it on (transaction `d6f79d203234ae597e61d8f96465d8debc57c8990bc5334797ab9595923c798c`).
- Before anything of the loan was sent, the whole course, by script from the wallet's words on disk, (create a loan key, move the Borrowing thread on, borrow 100.00 PUSD against 60144899 sat, 124.9% at $207.68, add 100000 sat, close) from the coin 69d1b7b82365b7e9358dc51e21e8e42bafaeb0167feb805513bd124528ae3d1e:0 of 60399667 sat, against Paryon's outputs as they are: every input of every transaction passed the virtual machine (2026 and 2025 rules, standard). Nothing was sent. Stored $274.40, oracle $207.68.
- The loan page borrowed 100.00 PUSD at 125% collateral at the lower price (Collateral: 0.60188752 BCH · 60,188,752 sat; Worth, at: 125.00% of the debt; Worth, at the stored: 165.50% of the debt; Paryon's fee: 0.00090915 BCH · 90,915 sat; Leaves your wallet, about: 0.60281667 BCH). The wallet showed: Leaves your wallet: 0.60399667 BCH · 60,399,667 sat; Comes back to your wallet: 0.00118921 BCH · 118,921 sat; Goes into the application: 0.60278667 BCH · 60,278,667 sat; Network fee: 2,079 sat; Your wallet goes down by: 0.60280746 BCH · 60,280,746 sat; Tokens: Your wallet receives Of token e7979ccd…30e6b8 +10,000 units; Destroyed: The loan key's proof of origin The application's The NFT of token 8a51671c…8557f8, spent and not carried on. Transaction `dd3e681db086d547d6e66e94235caee942e36d0b5aefecf8a116aa17bba87655`. The page then listed the loan, found through the wallet's answer to its question about the template's tokens and read from the chain: 100.00PUSD; Collateral: 0.60188752 BCH · 60,188,752 sat; Worth, at: 125.06% of the debt; Worth, at the stored: 165.50% of the debt; Interest: None.
- The way out was proven right after the loan was opened, from the first phone's words on disk and the chain alone, without the browser: the closing 75c3b661236d9cc11cc3363e2d6493170dac342b315da406bb278b24c3ae4ae0 (1830 bytes, fee 1830 sat) against the loan at dd3e681db086d547d6e66e94235caee942e36d0b5aefecf8a116aa17bba87655:2 with 60188752 sat passed the virtual machine and testmempoolaccept; it was not sent.
- The loan page added 0.001 BCH of collateral (transaction `17f0c1fede7a5b5b3704199a4f108d6eb992ed432aadb1624e4838bf31c67017`); the wallet showed: Leaves your wallet: 0.00117921 BCH · 117,921 sat; Comes back to your wallet: 0.00016006 BCH · 16,006 sat; Goes into the application: 0.001 BCH · 100,000 sat; Network fee: 1,915 sat; Your wallet goes down by: 0.00101915 BCH · 101,915 sat.
- The way out was proven after collateral was added, from the first phone's words on disk and the chain alone, without the browser: the closing eee4a2493dc0839519fc190d6c5dcb4f0e6c150fb424e9f5cd0cabc84150893e (1830 bytes, fee 1830 sat) against the loan at 17f0c1fede7a5b5b3704199a4f108d6eb992ed432aadb1624e4838bf31c67017:1 with 60288752 sat passed the virtual machine and testmempoolaccept; it was not sent.
- On the new phone the swept loan key was listed; once the template stored in the backup was trusted, the wallet found the loan from the key and the chain: Holds 0.60288752 BCH · 60,288,752 sat; Debt: 10,000 units; Collateral: 0.60288752 BCH · 60,288,752 sat. It offered "Add BCH to the loan, or take some out while it stays above 110% of the debt. The loan key goes back to the address it came from. Change the collateral", "Repay part of the loan Pay back part of the debt in PUSD; at least 100.00 PUSD, and at least 100.00 PUSD stays owed. The PUSD paid back is destroyed. The loan key goes back to the address it came from. Only from the application's own page. It needs values that the application works out: "Loan record".", "Pay back the whole debt in PUSD and close the loan. The PUSD paid back and the loan's record are destroyed; the collateral comes back to your wallet, and the loan key stays with you. Repay and close the loan".
- The way out was proven after the takeover, from the new phone's words on disk and the chain alone, without the browser: the closing 5d90a66210ca9e3605296568ce6827482589a403f9817658899df141761eee0f (1830 bytes, fee 1830 sat) against the loan at 17f0c1fede7a5b5b3704199a4f108d6eb992ed432aadb1624e4838bf31c67017:1 with 60288752 sat passed the virtual machine and testmempoolaccept; it was not sent.
- The new phone closed the loan from its own list of tokens, with the loan page not opened (transaction `a0fdbbc82e60d54dfc66b64eabdd073de2a7af244d5ac3c9b3336132a30891ee`). Its review: Leaves your wallet: 0.00002 BCH · 2,000 sat; Comes back to your wallet: 0.60289902 BCH · 60,289,902 sat; Comes back from the application: 0.60289752 BCH · 60,289,752 sat; Network fee: 1,850 sat; Your wallet goes up by: 0.60287902 BCH · 60,287,902 sat; Tokens: Your wallet pays Of token e7979ccd…30e6b8 −10,000 units; Destroyed: PUSD repaid Yours The 10,000 units of token e7979ccd…30e6b8, sent to a data output, which no one can spend; Destroyed: The loan's record The application's The NFT (mutable) of token e7979ccd…30e6b8 with 011027…ff7f, sent to a data output, which no one can spend; Destroyed: The loan's sidecar The application's The NFT of token 135973d0…14ac5f with 01, spent and not carried on. From the takeover on, the new phone's browser made 156 requests, to http://localhost:8101, wss://chipnet.9500.cash, wss://chipnet.imaginary.cash:50004, http://localhost:8111, http://localhost:8112: none to the loan page (http://localhost:8104). The key stays listed, its loan "Closed".
- At the end the coins went back to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u, the address that paid for the run: the wallet's coins, sent by the part of the run that stopped (0.604602 BCH · 60,460,200 sat arrived, fee 932 sat; the coin kept for cancelling went too); the loan key stayed in the wallet; the recoverer's fee coins: not returned: the recoverer's page did not open its account. The funder held 60730655 satoshis before the run and 60619947 after it. What is left: the wallet's controller coin, which the pages do not close. Every profile stays on disk.

Transactions:

| Step | Transaction |
| --- | --- |
| a loan key, asked by the loan page | `b6ddb49f85ec59a3e7ca9e918ee9fb51734f210e94748f86b11d6e3f6fee62d0` |
| Paryon's contracts brought up to date, asked by the loan page | `d6f79d203234ae597e61d8f96465d8debc57c8990bc5334797ab9595923c798c` |
| the wallet is paid for the loan | `69d1b7b82365b7e9358dc51e21e8e42bafaeb0167feb805513bd124528ae3d1e` |
| borrow 100.00 PUSD, asked by the loan page | `dd3e681db086d547d6e66e94235caee942e36d0b5aefecf8a116aa17bba87655` |
| collateral added, asked by the loan page | `17f0c1fede7a5b5b3704199a4f108d6eb992ed432aadb1624e4838bf31c67017` |
| the loan closed from the new phone's list of tokens | `a0fdbbc82e60d54dfc66b64eabdd073de2a7af244d5ac3c9b3336132a30891ee` |

```
   1 s  funding address: 60730655 satoshis in 5 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   2 s  wallet page: http://localhost:8101/, this checkout at aef2854, chipnet
   2 s  recoverer page: http://localhost:8102/, this checkout at aef2854, chipnet
   2 s  loan page: http://localhost:8104/, this checkout at aef2854, chipnet
   3 s  1. The recoverer opens its page and gives its link
   5 s     link of 179 characters; fingerprint bbaf 364c 291b 3937
   7 s  2. The owner creates a wallet with Anna as recoverer
  10 s     the wallet shows the same fingerprint, bbaf 364c 291b 3937
  17 s     funding address bchtest:qqmvkmva4h7qwjk33ymxh4cx0azg2hkmyc5gvvwk8u
  17 s     the owner's words are on disk (.chipnet/browser-run-loan-chipnet/wallets.json) before anything is paid to the wallet
  18 s     paid 120000 satoshis in 3c37f798d031b9c9e09c1e085dfd64cb4561ca05fd986c9cd24989cd99f01666:0, unconfirmed
  23 s     created; waiting for a block
  54 s     confirmed; the kit link has 1288 characters
  54 s  3. Anna takes in the kit; the wallet says that recovery is on
  56 s     the recoverer kept the kit and left its receipt
  85 s     the wallet shows "Protected"
  85 s  4. The owner receives
  85 s     address bchtest:pw8ju524pfmf68j9eztcmeyww8crrqfkaevaa3deg2nrg5kmrn90xrkw6eqkv
  86 s     paid 50000 satoshis in 135973d043b8cb4eb6857537dac9b9c26e8a0681977306a0c02ed5599b14ac5f:0, unconfirmed
  86 s     vault address bchtest:pvlwux2070v57q68uhregay0q9dx60s7rtyjht7m54lcwzal65xe6ugkjkpgg
  86 s     the wallet holds 0.00113679 BCH
  86 s     the wallet's identity 3c37f798d031b9c9e09c1e085dfd64cb4561ca05fd986c9cd24989cd99f01666
  86 s  5. The owner pairs the wallet with the loan page
  87 s     the loan page shows its connection address (77 characters) and waits for a wallet; it says: "An independent demonstration on chipnet, Bitcoin Cash's test network. This page is not Paryon's site and is not made or endorsed by Paryon. It uses Paryon's public contracts unchanged, through their test deployment chipnet-fast-periods-6. Only test coins, which have no value, are used."
  90 s     the wallet's Applications screen: "Loan desk", Its own name, not verified · through relay.riften.net · since Nov 18, 2026, 7:51 AM; "Connected"
  90 s     the loan page: "Connected to Grandma's Wallet"
  90 s     the loan page: prices Stored in Paryon's price contracts: $274.40 to $274.98; The oracle's latest: $207.89; This page reckons with: $207.89
  91 s  6. The loan page has the wallet make a loan key
  93 s     the wallet's Applications screen: "Loan desk asks for your decision"
  93 s     making a loan key: template "ParyonUSD loan (chipnet-fast-periods-6)", "Not verified"
  93 s     it says: "This wallet does not have this template yet. Approving trusts it on this phone, and stores it in your backup first, before anything is signed, so that a new phone can operate what is made with it."
  93 s     in the template's words: "Make a loan key"; Loan key: 135973d0…14ac5f
  93 s     the wallet's own figures: Leaves your wallet: 0.0005 BCH · 50,000 sat; Comes back to your wallet: 0.00047202 BCH · 47,202 sat; Goes into the application: 0.00002 BCH · 2,000 sat; Network fee: 798 sat; Your wallet goes down by: 0.00002798 BCH · 2,798 sat
  93 s       The application's coins it spends: Paryon's key factory · 83e773…42:1 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 8a51671c…8557f8
  93 s       Goes to others: Paryon's key factory · at aa2004…3d9287 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 8a51671c…8557f8
  93 s       Goes to others: The new loan key, waiting · at aa20f2…e38187 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 135973d0…14ac5f
  93 s       Goes to others: The loan key's proof of origin · at aa207a…5b6e87 0.00001 BCH · 1,000 sat Carries the NFT of token 8a51671c…8557f8
  93 s       Arrives at your wallet: What is left over, as change 0.00047202 BCH · 47,202 sat
  95 s     approved; the wallet: "Done: Make a loan key", transaction b6ddb49f85ec59a3e7ca9e918ee9fb51734f210e94748f86b11d6e3f6fee62d0
  95 s     the loan key's category 135973d043b8cb4eb6857537dac9b9c26e8a0681977306a0c02ed5599b14ac5f
 457 s  FAILED at step 6: "Your wallet has a new key" did not appear on http://localhost:8104/
       continued from step 7 on 2026-11-18 07:01 UTC with the same browser profiles; the times below are seconds since then
   1 s  funding address: 60559643 satoshis in 1 coin at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   2 s  wallet page: http://localhost:8101/, this checkout at aef2854, chipnet
   2 s  recoverer page: http://localhost:8102/, this checkout at aef2854, chipnet
   2 s  loan page: http://localhost:8104/, this checkout at aef2854, chipnet
   3 s  7. The loan page brings Paryon's contracts up to date, if they need it
   6 s     the page says: "Paryon's contracts count time in periods of about half an hour, and a loan pays interest for each period from the one it starts in. The contract that would lend to you was last moved on 1,150 periods ago, because Paryon's keepers on this test network have stopped. A loan opened from it now could be charged a fee for each of those periods, up to 1,725,000 satoshis."
   7 s     the wallet's Applications screen: "Loan desk asks for your decision"
   7 s     bringing the contracts up to date: template "ParyonUSD loan (chipnet-fast-periods-6)", "Not verified"
   7 s     in the template's words: "Bring Paryon up to date"; PUSD left to lend: 922337203685477580; New period: 31280000; Block height: 332846
   7 s     the wallet's own figures: Leaves your wallet: 0.00112588 BCH · 112,588 sat; Comes back to your wallet: 0.00111533 BCH · 111,533 sat; Network fee: 1,055 sat; Your wallet goes down by: 0.00001055 BCH · 1,055 sat
   7 s       Destroyed: Paryon's borrowing contract The application's The NFT (minting) of token e7979ccd…30e6b8 with b3230000, spent and not carried on
   7 s       The application's coins it spends: Paryon's borrowing contract · b39b36…04:0 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token e7979ccd…30e6b8 with b3230000, and 922,337,203,685,477,580 units
   7 s       Goes to others: Paryon's borrowing contract · at aa20a8…3ad287 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token e7979ccd…30e6b8 with 31280000, and 922,337,203,685,477,580 units
   7 s       Arrives at your wallet: What is left over, as change 0.00111533 BCH · 111,533 sat
   7 s       "The network accepts this transaction from block 332,846 on, not earlier."
   8 s     approved; the wallet: "Done: Bring Paryon up to date", transaction d6f79d203234ae597e61d8f96465d8debc57c8990bc5334797ab9595923c798c
  68 s     the page: "Up to date. A loan opened now starts in period 10,289, the current one."
  68 s  8. The wallet is paid for the loan; the whole course is checked by script against Paryon's outputs
  70 s     prices: stored 27440, oracle 20768, lower 20768 (US cents); collateral at 125%: 60188752 sat; Paryon's fee 90915 sat
  71 s     paid 60399667 satoshis in 69d1b7b82365b7e9358dc51e21e8e42bafaeb0167feb805513bd124528ae3d1e:0, unconfirmed
  77 s     the wallet holds 60559493 satoshis
  79 s     CHECKED: the whole course (create a loan key, move the Borrowing thread on, borrow 100.00 PUSD against 60144899 sat, 124.9% at $207.68, add 100000 sat, close) from the coin 69d1b7b82365b7e9358dc51e21e8e42bafaeb0167feb805513bd124528ae3d1e:0 of 60399667 sat, against Paryon's outputs as they are: every input of every transaction passed the virtual machine (2026 and 2025 rules, standard). Nothing was sent. Stored $274.40, oracle $207.68.
  79 s  9. The loan page borrows 100 PUSD; the way out is proven
  89 s     the page: Collateral: 0.60188752 BCH · 60,188,752 sat; Worth, at: 125.00% of the debt; Worth, at the stored: 165.50% of the debt; Paryon's fee: 0.00090915 BCH · 90,915 sat; Leaves your wallet, about: 0.60281667 BCH
  91 s     the wallet's Applications screen: "Loan desk asks for your decision"
  91 s     borrowing: template "ParyonUSD loan (chipnet-fast-periods-6)", "Not verified"
  91 s     in the template's words: "Borrow PUSD"; Loan key: 135973d0…14ac5f; PUSD left to lend: 922337203685477580; Period of the borrowing contract: 31280000; Price: 00a0f21c006a6b0000; Debt: 10000; Collateral: 60188752; Loan record: 01102700…00ff7f; Borrowing fee: 90915; Starting interest: 0000; Interest manager: 000000ff7f; Key holder: aa20045d…cad187; PUSD holder: aa20b358…af9c87
  91 s     the wallet's own figures: Leaves your wallet: 0.60399667 BCH · 60,399,667 sat; Comes back to your wallet: 0.00118921 BCH · 118,921 sat; Goes into the application: 0.60278667 BCH · 60,278,667 sat; Network fee: 2,079 sat; Your wallet goes down by: 0.60280746 BCH · 60,280,746 sat
  91 s       Tokens: Your wallet receives Of token e7979ccd…30e6b8 +10,000 units
  91 s       Destroyed: The loan key's proof of origin The application's The NFT of token 8a51671c…8557f8, spent and not carried on
  91 s       The application's coins it spends: Paryon's borrowing contract · d6f79d…8c:0 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token e7979ccd…30e6b8 with 31280000, and 922,337,203,685,477,580 units
  91 s       The application's coins it spends: Paryon's price contract · 625353…09:1 0.00001 BCH · 1,000 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 00a0f2…0000
  91 s       The application's coins it spends: The new loan key · b6ddb4…d0:2 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 135973d0…14ac5f
  91 s       The application's coins it spends: The loan key's proof of origin · b6ddb4…d0:3 0.00001 BCH · 1,000 sat Carries the NFT of token 8a51671c…8557f8
  91 s       Goes to others: Paryon's borrowing contract · at aa20a8…3ad287 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token e7979ccd…30e6b8 with 31280000, and 922,337,203,685,467,580 units
  91 s       Goes to others: Paryon's price contract · at aa200d…037987 0.00001 BCH · 1,000 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 00a0f2…0000
  91 s       Goes to others: The loan · at aa200e…509287 0.60188752 BCH · 60,188,752 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 011027…ff7f
  91 s       Goes to others: The loan's sidecar · at aa2078…fd0f87 0.00001 BCH · 1,000 sat Carries the NFT of token 135973d0…14ac5f with 01
  91 s       Goes to others: Borrowing fee · at aa20a0…2dfa87 0.00090915 BCH · 90,915 sat
  91 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 135973d0…14ac5f
  91 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the 10,000 units of token e7979ccd…30e6b8
  91 s       Arrives at your wallet: What is left over, as change 0.00116921 BCH · 116,921 sat
  93 s     approved; the wallet: "Done: Borrow PUSD", transaction dd3e681db086d547d6e66e94235caee942e36d0b5aefecf8a116aa17bba87655
  98 s     the loan page lists, from the wallet's answer and the chain: 100.00PUSD; Collateral: 0.60188752 BCH · 60,188,752 sat; Worth, at: 125.06% of the debt; Worth, at the stored: 165.50% of the debt; Interest: None
 101 s     the wallet's tokens: "ParyonUSD loan (chipnet-fast-periods-6)" (Open); Debt: 10,000 units; Collateral: 0.60188752 BCH · 60,188,752 sat; actions "Add BCH to the loan, or take some out while it stays above 110% of the debt. The loan key goes back to the address it came from. Change the collateral", "Repay part of the loan Pay back part of the debt in PUSD; at least 100.00 PUSD, and at least 100.00 PUSD stays owed. The PUSD paid back is destroyed. The loan key goes back to the address it came from. Only from the application's own page. It needs values that the application works out: "Loan record".", "Pay back the whole debt in PUSD and close the loan. The PUSD paid back and the loan's record are destroyed; the collateral comes back to your wallet, and the loan key stays with you. Repay and close the loan"
 104 s     the way out right after the loan was opened: PROVEN: the closing 75c3b661236d9cc11cc3363e2d6493170dac342b315da406bb278b24c3ae4ae0 (1830 bytes, fee 1830 sat) against the loan at dd3e681db086d547d6e66e94235caee942e36d0b5aefecf8a116aa17bba87655:2 with 60188752 sat passed the virtual machine and testmempoolaccept; it was not sent
 104 s  10. The loan page adds collateral; the way out is proven
 105 s     the page: "The loan then holds 0.60288752 BCH, 125.27% of the debt at $207.79."
 106 s     the wallet's Applications screen: "Loan desk asks for your decision"
 106 s     adding collateral: template "ParyonUSD loan (chipnet-fast-periods-6)", "Verified"
 106 s     in the template's words: "Change the collateral"; Loan key: 135973d0…14ac5f; Price: 00a0f21c006a6b0000; Collateral: 60288752; Loan record: 01102700…00ff7f; Interest manager: 000000ff7f; Satoshis with the key: 1000; Key holder: aa20045d…cad187
 106 s     the wallet's own figures: Leaves your wallet: 0.00117921 BCH · 117,921 sat; Comes back to your wallet: 0.00016006 BCH · 16,006 sat; Goes into the application: 0.001 BCH · 100,000 sat; Network fee: 1,915 sat; Your wallet goes down by: 0.00101915 BCH · 101,915 sat
 106 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 135973d0…14ac5f
 106 s       The application's coins it spends: Paryon's price contract · 47fae2…52:0 0.00001 BCH · 1,000 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 00a0f2…0000
 106 s       The application's coins it spends: The loan · dd3e68…55:2 0.60188752 BCH · 60,188,752 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 011027…ff7f
 106 s       The application's coins it spends: The loan's sidecar · dd3e68…55:3 0.00001 BCH · 1,000 sat Carries the NFT of token 135973d0…14ac5f with 01
 106 s       The application's coins it spends: Paryon's manage function · 1a286b…1:45 0.00001 BCH · 1,000 sat Carries the NFT of token e7979ccd…30e6b8 with 02
 106 s       Goes to others: Paryon's price contract · at aa200d…037987 0.00001 BCH · 1,000 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 00a0f2…0000
 106 s       Goes to others: The loan · at aa200e…509287 0.60288752 BCH · 60,288,752 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 011027…ff7f
 106 s       Goes to others: The loan's sidecar · at aa2078…fd0f87 0.00001 BCH · 1,000 sat Carries the NFT of token 135973d0…14ac5f with 01
 106 s       Goes to others: Paryon's manage function · at aa209c…1ef787 0.00001 BCH · 1,000 sat Carries the NFT of token e7979ccd…30e6b8 with 02
 106 s       Arrives at your wallet: Back where it came from 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 135973d0…14ac5f
 106 s       Arrives at your wallet: What is left over, as change 0.00015006 BCH · 15,006 sat
 108 s     approved; the wallet: "Done: Change the collateral", transaction 17f0c1fede7a5b5b3704199a4f108d6eb992ed432aadb1624e4838bf31c67017
 116 s     the way out after collateral was added: PROVEN: the closing eee4a2493dc0839519fc190d6c5dcb4f0e6c150fb424e9f5cd0cabc84150893e (1830 bytes, fee 1830 sat) against the loan at 17f0c1fede7a5b5b3704199a4f108d6eb992ed432aadb1624e4838bf31c67017:1 with 60288752 sat passed the virtual machine and testmempoolaccept; it was not sent
 116 s  11. The phone is lost, with the loan open
 116 s     the old phone's profile, with its wallet tab and its loan tab, is no longer opened
 116 s  12. A new phone takes the wallet over with Anna's help, and sweeps
 120 s     both sides show bc26 9b47 8f36 7431
 129 s     the new phone's words are on disk (.chipnet/browser-run-loan-chipnet/wallets.json) before anything is swept to it
 140 s     the request is in a block; the waiting period runs
 140 s     the waiting period takes its real time
 681 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 681 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 681 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 681 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 832 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 832 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 832 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 832 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 832 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 832 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 832 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 840 s     completed; the hand-over link is ready
 853 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 853 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 853 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 913 s     the new phone holds 0.0017223 BCH
 913 s     recovery is on for the new phone
 913 s  13. The new phone finds the loan from the swept key and the template from the backup
 915 s     the Applications screen lists the swept key: "ParyonUSD loan (chipnet-fast-periods-6)" (Cannot be worked out): "A note says the template "ParyonUSD loan (chipnet-fast-periods-6)" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet."
 916 s     "A template from your backup": "ParyonUSD loan (chipnet-fast-periods-6)", "Not verified"
 917 s     the key: "ParyonUSD loan (chipnet-fast-periods-6)" (Open), Holds 0.60288752 BCH · 60,288,752 sat; Debt: 10,000 units; Collateral: 0.60288752 BCH · 60,288,752 sat; actions "Add BCH to the loan, or take some out while it stays above 110% of the debt. The loan key goes back to the address it came from. Change the collateral", "Repay part of the loan Pay back part of the debt in PUSD; at least 100.00 PUSD, and at least 100.00 PUSD stays owed. The PUSD paid back is destroyed. The loan key goes back to the address it came from. Only from the application's own page. It needs values that the application works out: "Loan record".", "Pay back the whole debt in PUSD and close the loan. The PUSD paid back and the loan's record are destroyed; the collateral comes back to your wallet, and the loan key stays with you. Repay and close the loan"
 920 s     the way out after the takeover: PROVEN: the closing 5d90a66210ca9e3605296568ce6827482589a403f9817658899df141761eee0f (1830 bytes, fee 1830 sat) against the loan at 17f0c1fede7a5b5b3704199a4f108d6eb992ed432aadb1624e4838bf31c67017:1 with 60288752 sat passed the virtual machine and testmempoolaccept; it was not sent
 920 s  14. The new phone closes the loan from its own list of tokens; the loan page is not opened
 923 s     the review: template "ParyonUSD loan (chipnet-fast-periods-6)", "Verified"
 923 s     it says: "You trust this template on this phone, and it is not in your backup yet. Approving stores it there first, before anything is signed."
 923 s     in the template's words: "Repay and close the loan"; Loan key: 135973d0…14ac5f; Price: 00a0f21c006a6b0000; Loan record: 01102700…00ff7f; Repayment: 10000; Interest manager: 000000ff7f; Satoshis with the key: 1000; Key holder: aa20963c…d36b87
 923 s     the wallet's own figures: Leaves your wallet: 0.00002 BCH · 2,000 sat; Comes back to your wallet: 0.60289902 BCH · 60,289,902 sat; Comes back from the application: 0.60289752 BCH · 60,289,752 sat; Network fee: 1,850 sat; Your wallet goes up by: 0.60287902 BCH · 60,287,902 sat
 923 s       Tokens: Your wallet pays Of token e7979ccd…30e6b8 −10,000 units
 923 s       Destroyed: PUSD repaid Yours The 10,000 units of token e7979ccd…30e6b8, sent to a data output, which no one can spend
 923 s       Destroyed: The loan's record The application's The NFT (mutable) of token e7979ccd…30e6b8 with 011027…ff7f, sent to a data output, which no one can spend
 923 s       Destroyed: The loan's sidecar The application's The NFT of token 135973d0…14ac5f with 01, spent and not carried on
 923 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 135973d0…14ac5f
 923 s       Your tokens it spends: A coin of your wallet 0.00001 BCH · 1,000 sat Carries the 10,000 units of token e7979ccd…30e6b8
 923 s       The application's coins it spends: Paryon's price contract · 17f0c1…17:0 0.00001 BCH · 1,000 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 00a0f2…0000
 923 s       The application's coins it spends: The loan · 17f0c1…17:1 0.60288752 BCH · 60,288,752 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 011027…ff7f
 923 s       The application's coins it spends: The loan's sidecar · 17f0c1…17:2 0.00001 BCH · 1,000 sat Carries the NFT of token 135973d0…14ac5f with 01
 923 s       The application's coins it spends: Paryon's manage function · 17f0c1…17:3 0.00001 BCH · 1,000 sat Carries the NFT of token e7979ccd…30e6b8 with 02
 923 s       Goes to others: Paryon's price contract · at aa200d…037987 0.00001 BCH · 1,000 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 00a0f2…0000
 923 s       Goes to others: Paryon's manage function · at aa209c…1ef787 0.00001 BCH · 1,000 sat Carries the NFT of token e7979ccd…30e6b8 with 02
 923 s       Goes to others: PUSD repaid · at 6a 0.00 BCH · 0 sat Carries the 10,000 units of token e7979ccd…30e6b8
 923 s       Goes to others: The loan's record · at 6a 0.00 BCH · 0 sat Carries the NFT (mutable) of token e7979ccd…30e6b8 with 011027…ff7f
 923 s       Arrives at your wallet: To a receiving address 0.00001 BCH · 1,000 sat Carries the NFT (minting) of token 135973d0…14ac5f
 923 s       Arrives at your wallet: What is left over, as change 0.60288902 BCH · 60,288,902 sat
 925 s     done: a0fdbbc82e60d54dfc66b64eabdd073de2a7af244d5ac3c9b3336132a30891ee
 943 s     the key is still listed: "ParyonUSD loan (chipnet-fast-periods-6)" (Closed), "It holds nothing now."
 944 s     the new phone's browser made 156 requests, to http://localhost:8101, wss://chipnet.9500.cash, wss://chipnet.imaginary.cash:50004, http://localhost:8111, http://localhost:8112; none to the loan page (http://localhost:8104)
 944 s  15. The coins go back to the address that paid for the run
 947 s     the new phone sent everything to bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u: 0.604602 BCH · 60,460,200 sat arrives, fee 932 sat
 949 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 949 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 949 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 949 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 949 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 949 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 979 s  FAILED at step 15: locator.evaluate: Timeout 30000ms exceeded.
       continued from step 15 on 2026-11-18 07:18 UTC with the same browser profiles; the times below are seconds since then
   1 s  funding address: 60619947 satoshis in 2 coins at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u
   2 s  wallet page: http://localhost:8101/, this checkout at aef2854, chipnet
   2 s  recoverer page: http://localhost:8102/, this checkout at aef2854, chipnet
   2 s  loan page: http://localhost:8104/, this checkout at aef2854, chipnet
   2 s  15. The coins go back to the address that paid for the run
   5 s    [new-phone] console: InsufficientFundsError: Insufficient funds: the wallet's coins do not cover the outputs and the fee. Inputs 1000, fee 374, needed 1022.
    at sv (http://localhost:8101/assets/index-CqY2SbMV.js:2055:4
   5 s     the loan key: "Not enough coins for this and its fee. the wallet's coins do not cover the outputs and the fee. Inputs 1000, fee 374, needed 1022."
   9 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
   9 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
   9 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
   9 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
   9 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
   9 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 129 s     the recoverer's page has not opened its account yet ("Opening this wallet's account. The page checks the chain's block headers first."); try 1
 130 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 130 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 130 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 130 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 130 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 130 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 250 s     the recoverer's page has not opened its account yet ("Opening this wallet's account. The page checks the chain's block headers first."); try 2
 251 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 251 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 251 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 251 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 252 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 252 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 269 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336450: The requested header is ahead of the current checkpoint at height 336437
 269 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 269 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336450: The requested header is ahead of the current checkpoint at height 336437
 269 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 269 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 371 s     the recoverer's page has not opened its account yet ("Opening this wallet's account. The page checks the chain's block headers first."); try 3
 373 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 373 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336450: The requested header is ahead of the current checkpoint at height 336437
 373 s    [recoverer] console: Failed to process transaction update: Error: Could not validate a block header on height 336441: The requested header is ahead of the current checkpoint at height 336437
 373 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 373 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 373 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 373 s    [recoverer] console: Failed to process transaction update: Error: Server reported merkle root 6bc9dac5d084042148f3efc75b36231567bdbec592d837c5afb72d61c9fbab0d for checkpoint #336437, expected 56e1ccf34290949aa17274fdc5bcf
 493 s     the recoverer's page has not opened its account yet ("Opening this wallet's account. The page checks the chain's block headers first."); try 4
 493 s     Anna's fee coins: not returned: the recoverer's page did not open its account
 509 s     funding address: 60619947 satoshis
```
