# Stage 9 run on chipnet (run E, step 1): a ParyonUSD loan of 100.00 PUSD by script, from recoverable addresses

Written by the run itself (`scripts/run-e.ts chipnet`). The wallet is an owner's wallet of this project on the XO engine, created on chipnet with a recoverer enrolled, so its addresses are recoverable addresses with a controller on chain. Every transaction of the loan was built by this project's code (`packages/paryon`) from Paryon's published contracts, unchanged, against the live outputs of Paryon's deployment `chipnet-fast-periods-6`. The wallet's inputs were unlocked by the everyday path of the recoverable address (`spend`: the address key's signature), with keys derived from the wallet's words by the script. Each transaction was checked in libauth's virtual machine (2026 and 2025 rules, standard) and by this project's check before sending, tried with `testmempoolaccept` on the owner's chipnet node, and sent through Electrum.

- Wallet identity: `8456ec8bcf3671b16ace00088da4de923fe39a65aff07c04d8a571c904a4f867`
- Loan key (token category): `9c8a60e06fcfee7b6c238ec5ee708c21554887d11f69c3261426bb6ebb129cbc`
- Contracts: `@paryonusd/contracts` 1.1.0, compiled by "cashc" 0.13.0, as published; Borrowing `aa20a8fefbcd2c1fc660fd7a2136f3b4c2de53c519ca284e60393d5e7041d3193ad287`, price (guarded) `aa200d68c1743d27c6952ada262eb2c7ff1fe19229856ea58862aad4a0a964d9037987`, Loan `aa200e21a4c1f868fe858109296e53720c50045825ab58e49d5f43e0ba8576a7509287`, sidecar `aa207886a5ad284f5ae9f09af871df72f5107b7b9dce7452b852a54e5fc6652dfd0f87`, manage `aa209c76359f2a145a0b5864425a796882cef7230bf98e23886e2bf0416bff411ef787`
- libauth 3.1.0-next.8; repository at commit `033c3c8` with the uncommitted package `packages/paryon`
- Started 2026-11-18T03:40:54.691Z

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| fund the wallet | `8456ec8bcf3671b16ace00088da4de923fe39a65aff07c04d8a571c904a4f867` | 219 | 219 | 80,000 sat from the funder to the wallet's funding address, to create the wallet |
| create | `2861ad7d0bfbffaad062518d1f82e9d623a536406d60c77acfd6652a7cae19a9` | 421 | 421 | the controller, the coin for cancelling, an allowance for the recoverer, and the rest |
| pay the wallet | `9c8a60e06fcfee7b6c238ec5ee708c21554887d11f69c3261426bb6ebb129cbc` | 229 | 229 | 60,079,566 sat from the funder to an address the wallet gave out, as output 0 |
| create a loan key | `a2d74359acc50a38a9da6597fef52402924bfb1f8d40dd773ace45229156b20c` | 798 | 798 | the wallet's coin that is output 0 defines the key's category; the change, as the category's authhead, to a fresh address; spends outputs of 1 unconfirmed transaction |
| move the Borrowing thread on | `b63cd9be5b19ce6ed930ed2b7d0d1920ca713d4c83090ffc6c7ab00f7aa2a853` | 1055 | 1055 | `updatePeriodState`: the lock time is the highest height the node takes as final, and the thread's period becomes the one of that height; spends outputs of 1 unconfirmed transaction |
| borrow | `62535345961500c1495455b5a5a59dc26ed466859f885b11d382769615f11009` | 2079 | 2079 | 100.00 PUSD against 59,834,798 sat of collateral, a borrowing fee of 90,915 sat, starting interest 0; the key, the PUSD and the change to three fresh addresses of the wallet; spends outputs of 2 unconfirmed transactions |
| manage, adding collateral | `4fa9a65e5adff764dd3e6769a89acf12bf8c399b31b19af310e114614e187fea` | 1915 | 1915 | 100,000 sat more collateral, no repayment; the key back to the address it was spent from, as the contract requires; spends outputs of 1 unconfirmed transaction |
| close | `85c1e2adabcd6e08cd983b0bc7d03f2119c1663aeecbffa09e12e13ce0df6ed9` | 1850 | 1850 | the whole debt repaid: the PUSD and the loan's own NFT burned in data outputs; the sidecar's NFT burned; the collateral and the key to fresh addresses; spends outputs of 2 unconfirmed transactions |
| send the key on | `4c0cd13a3322ba5141c43eb46c90f481c533abe99f337ef85ee573aaedf15e3d` | 714 | 714 | the loan key, unchanged, to the address that paid for the run; the wallet's own transaction |
| close the wallet | `33fee2eecdb55c8453bde8a798f53f32cc63c4bc3462031cdded2e3ac155adb9` | 1865 | 1865 | everything, and the controller's value, back to the address that paid for the run |
| return the allowance | `fa8f6356ca9dfe95e2f12c93fd9d0c03efa9f136fd3e30b8941dd26a0f744238` | 185 | 185 | what the recoverer did not use |
| destroy the key | `54f42805de3110c0c6d87e29458ee48c8c6be55b73c6c70244a3bb306911c439` | 608 | 608 | the funder spends the loan key without carrying it on, and keeps its satoshis |

Amounts:

- Borrowing thread: period 9139 moved to 10283 (lock time 332827); the loan's interest starts there
- Debt: 100.00 PUSD
- Prices when the loan was opened: stored in the price thread used $274.98; lowest stored $274.40; the oracle's latest $208.70 (2026-11-18T03:44:43.000Z); collateral is reckoned at the lower, $208.70
- Collateral: 59,834,798 sat: 124.87% of the debt at $208.70, 164.53% at the stored price; the contracts' least at the stored price is 40,002,911 sat (110%)
- Borrowing fee: 90,915 sat to Paryon's fee address (0.25% of the debt at the stored price)
- Starting interest: 0 per 10,000,000 per period; the loan's interest period starts at 10283
- Collateral after managing: 59,934,798 sat: 125.08% at $208.70
- Closing: 100 PUSD repaid and burned; the loan held 59,934,798 sat, of which 59,934,948 sat came back to the wallet after the network fee (with the sidecar's and the PUSD output's 1,000 satoshis each)
- Funder: 60,782,431 sat before the run, 60,679,578 sat after it
- Cost of the run: 102,853 sat: the borrowing fee 90,915 sat, network fees 11,938 sat for the 12 transactions above, interest 0, and 0 sat otherwise

Also observed:

- Before starting: Paryon's deployment `chipnet-fast-periods-6` showed 10 Borrowing threads (periods 9139, 9140), 5 price threads ($274.98, $274.40), 5 loan key factories and 25 manage NFTs. The tip was 336224 and 336224 at two Electrum servers and 336224 at the owner's node; the current period 11415. The oracle's latest signed price was $208.93 (2026-11-18T03:40:43.000Z); the stored price is $274.40, unchanged since height 330,200. The funder held 60,782,431 sat: enough for 59,828,651 sat of collateral, 125% of the debt at $208.93.
- The wallet gave out no address until its creation was in a block; that is the wallet's own rule, and the only wait for a block in this run.
- Before anything of the loan was sent, the whole course (5 transactions: create a loan key, move the Borrowing thread on, borrow, manage, adding collateral, close) was built against Paryon's live outputs and the wallet's actual coin, chained locally, and every input of every transaction passed the virtual machine (2026 and 2025 rules, standard).
- A lock time given as a height is compared on chipnet with the height the chain would have at ten-minute blocks: at 336227 blocks the owner's node reports 199696620 ticks, and testmempoolaccept took a lock time of 332827 as final and refused 332828 and 336227 as "bad-txns-nonfinal" (tried during the run, outside this script, with a payment of the funder that was not sent). This is the tentative upgrade of May 2027 that chipnet runs; the run's first attempt to move the Borrowing thread on, with the block height as its lock time, was refused by testmempoolaccept for that reason and nothing was sent. Paryon's periods are counted from lock times, so on chipnet they now follow that height.
- The way out was proven right after the loan was opened: the closing transaction (1850 bytes, against the loan at `62535345961500c1…:2` with 59,834,798 sat) passed the virtual machine and testmempoolaccept on the owner's node; it would return 59,834,948 sat and the key. It was not sent.
- The loan was found from its key alone, through its sidecar: `62535345961500c1…:2`, 59,834,798 sat, a debt of 100 PUSD, interest 0, interest period 10283.
- After the loan was opened, the wallet's own listing (the engine following its addresses) shows 2 coins with tokens: the loan key (a minting NFT of its category) and 100 PUSD at its recoverable addresses, and 219,509 sat without tokens.
- The way out was proven after collateral was added: the closing transaction (1850 bytes, against the loan at `4fa9a65e5adff764…:1` with 59,934,798 sat) passed the virtual machine and testmempoolaccept on the owner's node; it would return 59,934,948 sat and the key. It was not sent.
- Managing with a repayment that leaves the loan open was not sent. The manage contract takes a repayment of 0, of at least 100.00 PUSD, or of the whole debt, and leaves at least 100.00 PUSD (`manage.cash` 62–69, 92), so it needs a loan of at least 200.00 PUSD; at 115% of the oracle's $208.70 that is 110,206,038 sat of collateral, and the funder held 60,782,431 sat. The same transaction was built and checked in the virtual machine against Paryon's live outputs, with the wallet's parts at recoverable addresses (`packages/paryon/test/transactions.test.ts`, "PY04: managing with a repayment"), and this script runs that course on chain with `--loan 200`. Here the closing is the on-chain repayment: the whole debt repaid and burned, and the loan's NFT burned.
- After managing, the loan found from its key holds 59,934,798 sat with a debt of 100 PUSD; the key is at the same address as before (true).
- After managing, the wallet's own listing (the engine following its addresses) shows 2 coins with tokens: the loan key (a minting NFT of its category) and 100 PUSD at its recoverable addresses, and 117,594 sat without tokens.
- After closing, the key opens no loan any more: the finder found none (true). The key itself stays in the wallet; the contracts do not require it to continue.
- After closing, the wallet's own listing (the engine following its addresses) shows 1 coin with tokens: the loan key (a minting NFT of its category) and no PUSD at its recoverable addresses, and 60,052,542 sat without tokens.
- The wallet's search over its seed ended as "fully-found".
- The controller's history: no transition, then closed.
- The funding address held 60782431 satoshis before the run and holds 60679578 after it: the run cost 102853 satoshis. Nothing is left anywhere else: no PUSD (all of it was burned at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses.

Outcome: passed. The loan was opened from recoverable addresses, managed without a repayment and closed on Paryon's live chipnet deployment, every transaction built by this project's code; the wallet was closed and everything returned to the address that paid for the run.
