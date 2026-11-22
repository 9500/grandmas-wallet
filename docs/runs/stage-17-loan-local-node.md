# Stage 17 run on the local node: a ParyonUSD loan without a declaration, through the loss of a device (PR20), carried out by the wallet with Paryon's service, the page closed

Written by the run itself (`scripts/stage-17-loan-run.ts`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules, on which the run deployed Paryon's contracts as published (`packages/paryon/src/local-deployment.ts`). Each part ran in a process of its own with an empty engine state. The template is version 3 of the ParyonUSD loan template, made for the local deployment; it names Paryon's service (`xo_service_v1`), which takes part in every action as the role `service`. Paryon's service app (`apps/paryon-service`) ran as a process of its own on 127.0.0.1, started by the run from its command line with a configuration of the local chain, as it runs in production, for the two parts that needed it, and stopped at the end of each. The loan page's only part was to offer the template to the wallet over `xo_v1` (`xo_template_offer`, sent with the page's `DappRequests` to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels); it asked for no action. From then on the wallet (`Applications`, with the service option) carried out every action from its own lists: the starting actions under the template, the borrowing under the key that waited in Paryon's contract, and the loan's actions under the key. Each action is an invitation the wallet started with its own share, which the service joined over HTTP with one commit, bringing Paryon's coins and the values read from them; the wallet checked what the service added, worked the whole transaction out by its own rules, evaluated every input of Paryon's in the virtual machine before the user was asked, and compared what the engine built with what it had worked out before it was sent. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `857bf9be69d727750439b7d2be4c4b1dbe5504419f7cee103f30c13f6ab14c4e`
- Loan key (token category): `fb11ec4348ffdd969c254e79b6d3603a870c2ccef5e6566d399d675ed345a545`
- Template "ParyonUSD loan (local)" `e6e34b22230dd84ee14c7a4359480dac5da16acb1bcdc76392794b354adac557`, content `6a7d7f93a6ead610309408ba363468e1f15c9ab556e9169775369df4732c4c2a`, with no declaration
- Paryon's deployment on the local chain: PUSD `a01d55cfbc880f15868fefdf4ad574301cc3b8b01e36685d1d43ae5de1e23118`, factories `1103061fee7a633bf604bdc6afa761785fc9a4b21e9afe81cd3d5f5b2460cc6a`
- Paryon's service as the template names it: http://127.0.0.1:18610/service/v1, started by the run for each part that needed it (`apps/paryon-service`, its command line, with the configuration `.local-runs/stage-17-loan-service.json`); the loan page's address the template names, http://127.0.0.1:18610/, serves no page in this run
- Repository at commit `badcab9`
- Started 2026-11-22T10:06:12.058Z

The position record the earlier device wrote before the borrowing was signed, when the key reached the wallet, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "fb11ec4348ffdd969c254e79b6d3603a870c2ccef5e6566d399d675ed345a545",
  "commitment": "",
  "capability": "minting"
 },
 "templateIdentifier": "e6e34b22230dd84ee14c7a4359480dac5da16acb1bcdc76392794b354adac557",
 "values": {
  "borrowingCommitment": "4c000000",
  "borrowingFee": "239578",
  "borrowingSupply": "100000000000",
  "collateral": "119789172",
  "debt": "20000",
  "keyCategory": "fb11ec4348ffdd969c254e79b6d3603a870c2ccef5e6566d399d675ed345a545",
  "loanCommitment": "01204e00000000000000000000004c00000000000000000000ff7f",
  "priceCommitment": "00e803000086510000",
  "startingRate": "0"
 }
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `019e313337c9c255245742aa5bc11d848dcfa13df8ddfc66f4f2ceedc423f8a8` | 343 | 343 | the controller and the rest | create (Grandma's Wallet controller) |
| pay the wallet | `fb11ec4348ffdd969c254e79b6d3603a870c2ccef5e6566d399d675ed345a545` | 229 | 229 | 120,178,750 sat from the funder to an address the wallet gave out, as output 0 |  |
| make a loan key | `5c1875575658623185a60596f37f18b201370fdc28b190091a417fbc2ffd1bf3` | 798 | 798 | from the wallet's own list, with the user's tick, joined by the service: the wallet's coin that is output 0 defines the key's category (input 0); Paryon's factory, brought by the service; the key waits in Paryon's contract; output 0 is what the wallet keeps of its coin | createKey (ParyonUSD loan (local)) |
| bring the Borrowing thread up to date | `aa182362b683fefc61065dce455abbf2f0388fef6f86241315cfb06f0c084eea` | 1042 | 1042 | from the wallet's own list, joined by the service, which chose the thread and the lock time: the thread moved from period 1 to 76 (lock time 230); its supply put back as it was; the wallet paid the fee | movePeriod (ParyonUSD loan (local)) |
| borrow | `d6956618ab0ef9a368c6b25251c441469dee7dce89280eb47723a9e6472c7223` | 2056 | 2056 | from the wallet's own list, joined by the service: 200.00 PUSD against 119,789,172 sat of collateral, starting rate 0, as the user typed them; Paryon's fee 239,578 sat; the service brought the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and the values read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed | borrow (ParyonUSD loan (local)) |
| add collateral | `d61a22b66b8d002e73fa83a0efb2449241e314b78f5bf774559f482a92efd8b2` | 1915 | 1915 | from the key's follow-ups in the wallet, joined by the service: 100,000 sat more collateral (the user typed what the loan holds then, 119889172); the service brought the price, the loan, its sidecar and a manage function, the loan's record and what the key's coin holds; the key back to the address it was spent from | manage (ParyonUSD loan (local)) |
| change the interest rate | `bffa3f6e0a217b1ede788d911ccd301a4a4460248ad17046ac0b60517e0daf85` | 1363 | 1363 | from the key's follow-ups in the wallet, joined by the service: the loan's rate for the periods to come set from 0 to 100 per 10,000,000 per period, as the user typed it; the service brought the loan, its sidecar, a coin of Paryon's interest function, the loan's new record and what the key's coin holds; no price; the key back to the address it was spent from | changeInterest (ParyonUSD loan (local)) |
| repay part of the loan | `a829694efeab104052c2a50c4e02285eae6f15c2d89ba99928255bbc3b7c9266` | 2341 | 2341 | from the key's follow-ups in the wallet, joined by the service: 100.00 PUSD repaid and destroyed, as the user typed it, 100.00 PUSD still owed; the service brought the price, the loan, its sidecar and a manage function, the loan's new record and what the key's coin holds; the PUSD left over and the key back to the wallet | repay (ParyonUSD loan (local)) |
| request | `5c7058f2a1dd67a1c8766d195bd9ec28bef738da1cf0192dd940874dab9a9467` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | pay (Grandma's Wallet actions) |
| complete | `f4875de670ee3d80800e2fe912a28dee112ab5df237536a7b7bbc6e39f9b5b6a` | 970 | 970 | after the waiting period; no coin has moved, the loan is still open under the key the earlier seed holds | pay (Grandma's Wallet actions) |
| sweep | `031f70f67ad08fbb1e0e93ec02269cef8ffc8c8590de19630a266ff393624c9d` | 2038 | 2038 | 4 coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there) | approve (Grandma's Wallet controller) |
| close the loan | `3ee7d7b1559265ed2bc88c32d4be8777ecc299f2d6da25a620aec64862616f50` | 1850 | 1850 | from the key's follow-ups on the new phone, joined by the service, the page closed: the service brought the price, the loan, its sidecar and a manage function, the loan's record, the debt and what the key's coin holds; the whole debt repaid from the swept PUSD, the PUSD and the loan's record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed | close (ParyonUSD loan (local)) |
| send the key on | `96bcd5e1621e83636b9f51091ffc5067a6017e97b1d0985baf563158cf11e9e7` | 714 | 714 | the loan key, unchanged, to the address that paid for the run | pay (Grandma's Wallet actions) |
| close the wallet | `5e8349432ae9efdbb6e6e853758ded01ac2ac07409b9c57cf4b4b1721d18a926` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | close (Grandma's Wallet controller) |
| return the recoverer's balance | `c2eda0338463d7328b445dfddd8bddada428c66f51a1d9cb58bd6bf3d7730c9e` | 185 | 185 | what the recoverer did not use | pay (Grandma's Wallet actions) |
| destroy the key | `181ccf39d2ae7bba9b482db27d5116e6de6c7aec0a11aee52d823bca2b182edf` | 749 | 749 | the funder spends the loan key without carrying it on, and keeps its satoshis |  |

Each action, carried out by the wallet from its own list with the page closed:

| Step | Who took part | What the wallet asked the user for | What came from the service | Requests to the service |
| --- | --- | --- | --- | --- |
| make a loan key | two: the wallet as the borrower (3 commits) and Paryon's service as the service (1 commit) | "Make a loan key"; nothing to type; the tick for a token made from the wallet's coin that leaves to "The new loan key, waiting"; the approval | no value; Paryon's coins "Paryon's key factory", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| bring the Borrowing thread up to date | two: the wallet as the borrower (3 commits) and Paryon's service as the service (1 commit) | "Bring Paryon up to date"; nothing to type; the approval | PUSD left to lend 100000000000, New period 4c000000, Block height 230; Paryon's coins "Paryon's borrowing contract", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| borrow | two: the wallet as the borrower (3 commits) and Paryon's service as the service (1 commit) | "Borrow PUSD"; typed: "Debt" (debt) 20000, "Collateral" (collateral) 119789172, "Starting interest rate" (startingRate) 0; the approval | PUSD left to lend 100000000000, Period of the borrowing contract 4c000000, Price 00e803000086510000, Loan record 01204e0000000000…, Borrowing fee 239578; Paryon's coins "Paryon's borrowing contract", "Paryon's price contract", "The new loan key", "The loan key's proof of origin", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| add collateral | two: the wallet as the borrower (4 commits) and Paryon's service as the service (1 commit) | "Change the collateral"; typed: "Collateral" (collateral) 119889172; the approval | Price 00e903000086510000, Loan record 01204e0000000000…, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| change the interest rate | two: the wallet as the borrower (4 commits) and Paryon's service as the service (1 commit) | "Change the interest rate"; typed: "New interest rate" (interestRate) 100; the approval | Collateral 119889172, Loan record 01204e0000000000…, Satoshis with the key 1000; Paryon's coins "The loan", "The loan's sidecar", "Paryon's interest function", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| repay part of the loan | two: the wallet as the borrower (5 commits) and Paryon's service as the service (1 commit) | "Repay part of the loan"; typed: "Repayment" (repayAmount) 10000; the approval | Price 00e903000086510000, Collateral 119889172, Loan record 0110270000000000…, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| close the loan | two: the wallet as the borrower (4 commits) and Paryon's service as the service (1 commit) | "Repay and close the loan"; nothing to type; the approval | Price 00e903000086510000, Loan record 0110270000000000…, Repayment 10000, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back | possible 2, join 1 |

Every request the wallet sent the service, in the moment it sent it, and what the service answered meanwhile by its own log (one line per message, with no address, token or value):

| Moment | Kind | Part | hello | possible | join | Answered at the service |
| --- | --- | --- | --- | --- | --- | --- |
| the user trusts the template | trust | the owner opens a loan | 1 | 1 | 0 | 2 |
| make a loan key | acting | the owner opens a loan | 0 | 2 | 1 | 3 |
| bring the Borrowing thread up to date | acting | the owner opens a loan | 0 | 2 | 1 | 3 |
| borrow | acting | the owner opens a loan | 0 | 2 | 1 | 3 |
| add collateral | acting | the owner opens a loan | 0 | 2 | 1 | 3 |
| change the interest rate | acting | the owner opens a loan | 0 | 2 | 1 | 3 |
| repay part of the loan | acting | the owner opens a loan | 0 | 2 | 1 | 3 |
| Connect on the new device | Connect | the new device closes the loan from its own list | 1 | 1 | 0 | 2 |
| close the loan | acting | the new device closes the loan from its own list | 0 | 2 | 1 | 3 |

By moment:

| Moment | hello | possible | join | All | Answered at the service |
| --- | --- | --- | --- | --- | --- |
| the user trusts the template | 1 | 1 | 0 | 2 | 2 |
| the user presses Connect | 1 | 1 | 0 | 2 | 2 |
| the user acts | 0 | 14 | 7 | 21 | 21 |
| at any other time | 0 | 0 | 0 | 0 | 0 |

The service answered 25 requests in all, each of them in one of the three moments; before and after each moment, and at the end of every part, the run checked that the wallet had sent nothing outside them and that the service had answered nothing else. When the earlier device was lost the service had answered 20; the new device, which trusted the template again from the backup, had sent none and the service, running from the start of that part, had answered none more when the user pressed Connect.

Amounts:

- Borrowing thread: period 1 moved to 76 (lock time 230), chosen by the service; the loan's interest starts there
- Debt: 200.00 PUSD
- Collateral: 119,789,172 sat: 125% of the debt at the stored price $208.70; Paryon's fee 239,578 sat, paid to the address that paid for the run
- Interest rate: 0 per 10,000,000 per period when the loan was opened, 100 from its next interest payment on (958 sat a period on 200.00 PUSD at $208.70, 479 sat on 100.00)
- Repayment: 100.00 PUSD repaid before the device was lost, leaving 100.00 PUSD owed
- Closing: the loan held 119,889,172 sat and a debt of 100.00 PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed
- Funder: 19,999,988,794 sat before the run (after deploying Paryon's contracts), 19,999,968,911 sat after it

Also observed:

- Paryon's contracts as published (`@paryonusd/contracts` 1.1.0) were deployed on the local chain by this script, with categories of its own: PUSD `a01d55cfbc880f15868fefdf4ad574301cc3b8b01e36685d1d43ae5de1e23118`, factories `1103061fee7a633bf604bdc6afa761785fc9a4b21e9afe81cd3d5f5b2460cc6a`; two Borrowing threads in period 1, two price threads at $208.70, two manage NFTs, two interest function NFTs and two key factories. Paryon's fee goes to the address that paid for the run.
- The page offered its template without an action; the wallet listed the offer of "ParyonUSD loan (local)" e6e34b22230d… from "the loan page" for the user to trust, and the user trusted it.
- Once the user trusted the template, the wallet spoke to the service it names, "Paryon's service, which takes part in every action of this template as the service." at http://127.0.0.1:18610/service/v1: it is "Service" (service) to the wallet's "Borrower" (borrower). The page sent the offer and nothing else; it asked for no action in the whole run.
- From its own list, under the template, the wallet offers the starting actions "Make a loan key" (the service said: possible now) and "Bring Paryon up to date" (the service said: possible now), and nothing that waits.
- Making a loan key: the wallet showed its own figures, worked out with the service's part: it gives 120,178,750 sat, gets 120,175,952 sat, 2,000 sat go into the application, the fee is 798 sat; to the wallet: left over; from the service (Service at http://127.0.0.1:18610/service/v1): no value; Paryon's coins "Paryon's key factory", with their unlocking, and the outputs that put them back.
- Bringing Paryon up to date: the wallet showed its own figures, worked out with the service's part: it gives 120,175,952 sat, gets 120,174,910 sat, 0 sat go into the application, the fee is 1,042 sat; to the wallet: left over; from the service (Service at http://127.0.0.1:18610/service/v1): PUSD left to lend 100000000000, New period 4c000000, Block height 230; Paryon's coins "Paryon's borrowing contract", with their unlocking, and the outputs that put them back.
- After the key was made, the wallet offers "Borrow PUSD" under the template, for the key that waits at "A loan key, waiting"; it asks for "Debt", "Collateral", "Starting interest rate".
- Borrowing: the wallet showed its own figures, worked out with the service's part: it gives 120,174,910 sat, gets 145,104 sat, 120,027,750 sat go into the application, the fee is 2,056 sat; to the wallet: receive, receive, left over; tokens +20000; from the service (Service at http://127.0.0.1:18610/service/v1): PUSD left to lend 100000000000, Period of the borrowing contract 4c000000, Price 00e803000086510000, Loan record 01204e0000000000…, Borrowing fee 239578; Paryon's coins "Paryon's borrowing contract", "Paryon's price contract", "The new loan key", "The loan key's proof of origin", with their unlocking, and the outputs that put them back.
- The earlier device holds 1 position record, written when the key reached the wallet: the key fb11ec4348ff… (minting, commitment ""), the template, no script (the loan is at Paryon's shared contracts), the values keyCategory, debt, collateral, startingRate, borrowingSupply, borrowingCommitment, priceCommitment, loanCommitment, borrowingFee, and no page's address: no page asked for the action.
- The earlier device keeps 1 template, Paryon's, with no declaration.
- The wallet lists the key under the template ("held") and offers from its own list, as the service last said the loan allows: "Change the collateral" (asks "Collateral"), "Repay part of the loan" (asks "Repayment"), "Repay and close the loan", "Change the interest rate" (asks "New interest rate").
- Adding collateral: the wallet showed its own figures, worked out with the service's part: it gives 144,104 sat, gets 42,189 sat, 100,000 sat go into the application, the fee is 1,915 sat; to the wallet: return, left over; from the service (Service at http://127.0.0.1:18610/service/v1): Price 00e903000086510000, Loan record 01204e0000000000…, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back.
- Changing the interest rate: the wallet showed its own figures, worked out with the service's part: it gives 74,273 sat, gets 72,910 sat, 0 sat go into the application, the fee is 1,363 sat; to the wallet: return, left over; from the service (Service at http://127.0.0.1:18610/service/v1): Collateral 119889172, Loan record 01204e0000000000…, Satoshis with the key 1000; Paryon's coins "The loan", "The loan's sidecar", "Paryon's interest function", with their unlocking, and the outputs that put them back.
- Repaying part of the loan: the wallet showed its own figures, worked out with the service's part: it gives 73,910 sat, gets 71,569 sat, 0 sat go into the application, the fee is 2,341 sat; to the wallet: return, token change, left over; tokens -10000; from the service (Service at http://127.0.0.1:18610/service/v1): Price 00e903000086510000, Collateral 119889172, Loan record 0110270000000000…, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back.
- With 100.00 PUSD owed, Paryon takes no repayment in part any more: the wallet offers "Change the collateral", "Repay and close the loan", "Change the interest rate" for the key.
- The old device holds the loan key and 100.00 PUSD at its addresses, and 111,071 sat without tokens; the loan holds 119,889,172 sat and owes 100.00 PUSD, at the rate 0 now and 100 from its next interest payment on. Then the device is lost, with the loan open.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 2 records of the earlier archive into its own.
- The new device read the record of the key from a store, the earlier seed's, a suggestion; the backup held Paryon's template as the earlier owner stored it, with no declaration.
- The user trusted the template "ParyonUSD loan (local)" the earlier owner stored, on the user's word; a trust restored from the backup does not speak to the template's service.
- The check of section 10.4 found that the record counts: The record names no script: it ties the token to its template, and the application says where the position stands.
- The record was written again as the new owner's own on the stores (1 record); it names no script, so nothing was handed to the engine (0 scripts).
- The new device lists the key from the record: "held", a record of its own, under the template "ParyonUSD loan (local)", the key at an address of the new seed; whether the loan is open is the service's or the page's to say.
- Before Connect, the new device had sent the service no request, and the service, running from the start of this part, had answered 20 requests in all, as many as when the earlier device was lost: none since the loss. The wallet shows the service "Paryon's service, which takes part in every action of this template as the service." at http://127.0.0.1:18610/service/v1 as "never asked" and offers Connect; from its own list it offers "Make a loan key" and "Bring Paryon up to date" under the template, as the template gives them, and nothing for the key, which names no script of its own: its loan's actions come from the service.
- The user pressed Connect: the wallet asked the service who it is and what is possible for the key it now holds at an address of the new seed. Under the swept key it offers "Change the collateral" (the service says Debt 10000, Collateral 119889172), "Repay and close the loan" (the service says Repayment 10000, Collateral 119889172), "Change the interest rate" (the service says New interest rate 100, Collateral 119889172).
- Closing the loan on the new phone: the wallet showed its own figures, worked out with the service's part: it gives 1,687 sat, gets 119,890,009 sat, -119,890,172 sat go into the application, the fee is 1,850 sat; to the wallet: receive, left over; tokens -10000; from the service (Service at http://127.0.0.1:18610/service/v1): Price 00e903000086510000, Loan record 0110270000000000…, Repayment 10000, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back.
- After closing, the page finds no loan for the key; the key is still in the wallet (true); the wallet holds no PUSD. The new device keeps 1 template, Paryon's, with no declaration.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 19999988794 satoshis before the run and holds 19999968911 after it: the run cost 19883 satoshis in network fees (Paryon's fee went to the same address and came back). Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses, and no loan, and no process of Paryon's service. Paryon's deployment stays on the local chain.
