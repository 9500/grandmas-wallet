# Stage 9 run on the local node: a ParyonUSD loan through the wallet from the Paryon template, and through the loss of the device

Written by the run itself (`scripts/run-e-template.ts local`). The owner's wallet, the recoverer and the new device, each on the XO engine, against the local node in regtest mode with the public networks' relay rules, on which the run deployed Paryon's contracts as published. Each part ran in a process of its own with an empty engine state. The Paryon template and its recovery declaration reached the wallet as texts, as the loan's page sends them (`packages/paryon`'s requests), and were stored in the backup before the first signature. Every transaction of the loan is an invitation of that template, built and signed by the unmodified engine and compared, output by output and input by input, with what the wallet's own code had worked out; every input of every transaction was evaluated in the virtual machine before it was signed and again before it was sent, and each was tried with `testmempoolaccept` on the local node before it was sent. The wallet's code names no application: what it did for the loan came from the template, its declaration and the chain.

- Wallet identity: `759cf5cf6170c1a2eb59f6479d9c8c2d5663b6dcb4ea2f40eae421477517bdc8`
- Loan key (token category): `20c8f1f43c74f053a8fbe1ddddcf6a3e7b9044cdca62ccd4a7410a87d6d2fa40`
- Template "ParyonUSD loan (local)" `3d703ff59203f187331504021756529d8fb9a0fe850cb7bcaebfe4111870ce5e`, content `6d673299817dc9ab853fe930a7bc1d093859012b0fa99db568b7444410837989`; declaration `a42f40e7085eabc005070c4eca94001deadc785cced0026a512e75e19462ee79`
- Repository at commit `df6414b`, with the uncommitted work of stage 9 steps 2 and 3
- Started 2026-11-18T04:35:32.529Z

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| fund the wallet | `759cf5cf6170c1a2eb59f6479d9c8c2d5663b6dcb4ea2f40eae421477517bdc8` | 219 | 219 | 80,000 sat from the funder to the wallet's funding address, to create the wallet |
| create | `829b8c9c819628ddb94825f046dbbea62bf9cc01715ba6eb321c0f2463faaafa` | 421 | 421 | the controller, the coin for cancelling, an allowance for the recoverer, and the rest |
| pay the wallet | `20c8f1f43c74f053a8fbe1ddddcf6a3e7b9044cdca62ccd4a7410a87d6d2fa40` | 370 | 370 | 60,174,375 sat from the funder to an address the wallet gave out, as output 0 |
| create a loan key | `29d6b3cb1b8c956107607265c9e4b2e068dd42fda771c806ad06bf936d88f482` | 798 | 798 | an action of the template: the wallet's coin that is output 0 defines the key's category (input 0); Paryon's factory, found by the wallet; output 0 is what the wallet keeps of its coin |
| move the Borrowing thread on | `2aae7139f5a989ff55899dfd01546dcb2e68f8ba03c907ae380535a3e6d6a943` | 1042 | 1042 | an action of the template: `updatePeriodState`, the lock time the highest height the node takes as final; the thread named by the page |
| borrow | `6d4ef3d9381c7b4afddb70fd0b0962c8cc8de473bcadbaca8c297775cfa001fc` | 2056 | 2056 | an action of the template: 100.00 PUSD against 59,894,586 sat of collateral, Paryon's fee 119,789 sat, starting interest 0; the key and the PUSD to two fresh addresses of the wallet, what is left to a third |
| manage, adding collateral | `b34ef07f4cf7a964424b39e37551550b1cc03a64a9f3375b1714670cd73af11b` | 1915 | 1915 | an action of the template: 100,000 sat more collateral; the page named nothing but the amount, the wallet found Paryon's price and manage coins itself; the key back to the address it was spent from |
| request | `1d07a87a1cc5456d8bfede98ea2c99489eaf43e16cc04c78fad7dfc6345f8d9d` | 991 | 991 | the recoverer names the new device's key; paid from its fee address |
| complete | `fcce777fe105809b1bbef527958082f01813be2620c7f5182984618167932841` | 970 | 970 | after the waiting period; no coin has moved, the loan is still open under the key the earlier seed holds |
| sweep | `aed5df700f23b08a07723b411778bae70cae042b2fc33167115bef5f5cb044a5` | 2342 | 2342 | 5 coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there) |
| close | `ae9c8e4a1d99defbc4feab4a8697e05ce2d32ac86e912e38da4bfe242126c1a4` | 1850 | 1850 | an action of the template from the new device's own list of tokens, every value read from the chain: the whole debt repaid, the PUSD and the loan's record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed |
| send the key on | `f2234d2c96f1510ae032a8a93d0d1be230939614208eee8cdb0d95b5efa3b670` | 714 | 714 | the loan key, unchanged, to the address that paid for the run; the wallet's own transaction |
| close the wallet | `4e19502063c172a1dc58e2536a121d72b4b892c727ce2a0d4e023c3457ec27c4` | 1569 | 1569 | everything, and the controller's value, back to the address that paid for the run |
| return the allowance | `405e03e65f6880018f5e6cd97c1f23c8c4b90271c1620efd9721d3df39668cc4` | 185 | 185 | what the recoverer did not use |
| destroy the key | `febf3327a320420a6c855f8e0db76e2c64d844c4cdfde34dc40515e9c2a06360` | 326 | 326 | the funder spends the loan key without carrying it on, and keeps its satoshis |

Amounts:

- Borrowing thread: period 1 moved to 406 (lock time 1220); the loan's interest starts there
- Debt: 100.00 PUSD
- Prices when the loan was opened: stored in the price thread used $208.70; lowest stored $208.70; collateral is reckoned at the lower, $208.70
- Collateral: 59,894,586 sat: 125% of the debt at $208.70, 125% at the stored price; the contracts' least at the stored price is 52,707,236 sat (110%)
- Closing: the loan held 59,994,586 sat; 59,995,736 sat came back to the wallet with the key
- Funder: 156,240,954 sat before the run, 156,225,186 sat after it
- Cost of the run: 15,768 sat: the borrowing fee 119,789 sat (to the run's own fee address on the local chain, so it came back), network fees 15,768 sat for the 15 transactions above, interest 0, and -119,789 sat otherwise

Also observed:

- Paryon's contracts as published (`@paryonusd/contracts` 1.1.0) were deployed on the local chain by this script, with categories of its own: PUSD `9ed7bd8fc494111b89841b2bc7fc8baf3810a442bbb0c9580431b0ece5737650`, factories `d5490862fc3cd9c3c6245df22238d82d84ef680493be1b3f1d6acd1132461491`; two Borrowing threads, two price threads at $208.70, two manage NFTs and two key factories.
- Before starting: Paryon's deployment `local` showed 2 Borrowing threads (periods 1), 2 price threads ($208.70), 2 loan key factories and 2 manage NFTs. The tip was 1219 at the Electrum server and 1219 at the local node. The funder held 156,240,954 sat: enough for 59,894,586 sat of collateral, 125% of the debt at $208.70.
- The wallet gave out no address until its creation was in a block; that is the wallet's own rule, and the only wait for a block before the recovery.
- Before anything of the loan was sent, the whole course (5 transactions: create a loan key, move the Borrowing thread on, borrow, manage, close) was built by step 1's builders against Paryon's outputs as they were and the wallet's actual coin, chained, and every input of every transaction passed the virtual machine (2026 and 2025 rules, standard). The wallet then worked each transaction out again from the template, and evaluated it in the virtual machine before it was signed.
- The wallet described the template as "ParyonUSD loan (local)", "not verified", with the actions "Make a loan key", "Bring Paryon up to date", "Borrow PUSD", "Change the collateral", "Repay part of the loan", "Repay and close the loan".
- Before the first action the wallet said that the template would be stored in the backup first (true), and showed its own figures: it gives 60,174,375 sat, gets 60,171,577 sat, 2,000 sat go into the application, the fee is 798 sat; Paryon's coins spent: "Paryon's key factory".
- The wallet's own figures for the borrowing, before it was approved: it gives 60,170,535 sat and gets 155,104 sat back (the key, the PUSD and what is left over), 60,013,375 sat go into the application (the collateral and Paryon's fee of 119,789 sat), the network fee is 2,056 sat; it receives 100 PUSD; destroyed: "The loan key's proof of origin" (not carried on, the application's).
- The wallet found the loan from its key, by the template's declaration: open, 59,894,586 sat; it shows "Debt" 10000 and "Collateral" 59894586, and offers "Change the collateral", "Repay part of the loan" (through the page only), "Repay and close the loan".
- The way out was proven right after the loan was opened, twice: the closing through the template (1850 bytes, built and signed by the engine) and the closing by plain script with step 1's builder (1830 bytes), each against the loan at `6d4ef3d9381c7b4a…:2` with 59,894,586 sat, passed the virtual machine and testmempoolaccept on the local node. Neither was sent.
- After managing, the key is at the same address as before (true), and the loan holds 59,994,586 sat.
- The way out was proven after collateral was added, twice: the closing through the template (1850 bytes, built and signed by the engine) and the closing by plain script with step 1's builder (1830 bytes), each against the loan at `b34ef07f4cf7a964…:1` with 59,994,586 sat, passed the virtual machine and testmempoolaccept on the local node. Neither was sent.
- The old device holds the loan key and 100 PUSD at its addresses, and 123,777 sat without tokens. Then the device is lost, with the loan open.
- The new device's search over both seeds ended as "fully-found".
- The sweep reported the tokens as of unknown meaning: the wallet moves what it does not understand.
- Before reading the backup the new device listed the swept key as a token of unknown meaning. The backup held 1 template that the earlier owner had stored and 1 note; the template was offered as "ParyonUSD loan (local)", shown as "not verified", and trusted on the user's word.
- The new device found the loan from the swept key, with the template from the backup and the chain alone (Paryon's site and API not consulted, and `packages/paryon`'s finder not used by the wallet): open, 59,994,586 sat, "Debt" 10000, "Collateral" 59994586; the key at an address of the new seed. It offers "Change the collateral" (asking for "Collateral"), "Repay part of the loan" (asking for "Collateral", "Repayment") (through the page only), "Repay and close the loan".
- The way out was proven after the takeover, with the new seed, twice: the closing through the template (1850 bytes, built and signed by the engine) and the closing by plain script with step 1's builder (1830 bytes), each against the loan at `b34ef07f4cf7a964…:1` with 59,994,586 sat, passed the virtual machine and testmempoolaccept on the local node. Neither was sent.
- The new device's own figures for the closing, from its list of tokens: it gives 2,000 sat (the key and the PUSD), gets 59,995,736 sat back, 59,995,586 sat come back from the application, the fee is 1,850 sat; destroyed: "PUSD repaid" (data output, the wallet's), "The loan's record" (data output, the application's), "The loan's sidecar" (not carried on, the application's).
- After closing, the key is still in the wallet and its loan is "closed"; the wallet holds no PUSD (true).
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 156240954 satoshis before the run and holds 156225186 after it. Nothing is left anywhere else: no PUSD (all of it was burned at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses, and no loan.

Outcome: passed. A loan of 100.00 PUSD was opened, managed and, after the loss of the device and a recovery, closed from the new device's own list of tokens, every transaction an action of the Paryon template carried out by the wallet; the wallet was closed and everything returned to the address that paid for the run.
