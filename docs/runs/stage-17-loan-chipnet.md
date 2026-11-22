# Stage 17 run on chipnet: a ParyonUSD loan without a declaration, through the loss of a device (PR20), carried out by the wallet with Paryon's service, the page closed

Written by the run itself (`scripts/stage-17-loan-run.ts chipnet`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, on chipnet, against Paryon's own public deployment `chipnet-fast-periods-6`, unchanged. The template is the frozen text of version 3 of the ParyonUSD loan template (`packages/paryon/frozen/paryon-loan-v3-chipnet-fast-periods-6.json`), offered unchanged and checked against its identifier; it names Paryon's service (`xo_service_v1`) at https://paryon.9500.cash/service/v1, which takes part in every action as the role `service`. That service is Paryon's public one, as it runs for everyone; the run did not start it, and its log is not the run's to read. The run was paid from the funding address and returned everything to it at the end but Paryon's borrowing fee; it made no block, and the waiting period passed on the chain's own clock. Each part ran in a process of its own with an empty engine state. The loan page's only part was to offer the template to the wallet over `xo_v1` (`xo_template_offer`, sent with the page's `DappRequests` to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels); it asked for no action. From then on the wallet (`Applications`, with the service option for chipnet, which takes only an `https:` address) carried out every action from its own lists: the starting actions under the template, the borrowing under the key that waited in Paryon's contract, and the loan's actions under the key. Each action is an invitation the wallet started with its own share, which the service joined over HTTPS with one commit, bringing Paryon's coins and the values read from them; the wallet checked what the service added, worked the whole transaction out by its own rules, evaluated every input of Paryon's in the virtual machine before the user was asked, and compared what the engine built with what it had worked out before it was sent. Every request the wallet sent the service was counted by the wallet in the moment it was sent. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `21b61484a5d184c27281e4e10fb10124cd98f3cc41f2999da822e0f6298957ab`
- Loan key (token category): `b36d9f7f5b89788416a1ce7dda36cfd0b03bb1beb68a358d4376dcbd46587be5`
- Template "ParyonUSD loan (chipnet-fast-periods-6)" `160a451f5398db649de7d660855db24113b774559534361f8334cbfe9a583e20`, content `f7cdfbc37a81b71dd879bc3c07756151501aea5bfce0f5c51e7147c18d66deab`, with no declaration
- Paryon's deployment `chipnet-fast-periods-6`: PUSD `e7979ccdae259293c7d0bee45ce8b7ad7660ea99477f802ed6a5161b0d30e6b8`, factories `8a51671cdc956212bd6b9c5ff2ad75a5d5364ef916162d1b82ee64a3438557f8`
- Paryon's service as the template names it: https://paryon.9500.cash/service/v1, Paryon's public service, not started by the run; the loan page offered the template and asked for no action
- Repository at commit `9027966`, with uncommitted changes to documents only
- Started 2026-11-22T11:06:19.283Z
- Fee rate: every transaction of the run paid at least 1 sat/byte; from "the recoverer recovers" on at least 3 sat/byte, but for the return of the recoverer's balance, at 2 sat/byte (`--fee-rate 3`; see the notes)
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `docs/runs/invitations/stage-17-loan-chipnet/`, with `index.json` naming the template, action and role of each.
- The engine ran as published, with no local change, given one server (chipnet.9500.cash), as in run B.

The position record the earlier device wrote before the borrowing was signed, when the key reached the wallet, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "b36d9f7f5b89788416a1ce7dda36cfd0b03bb1beb68a358d4376dcbd46587be5",
  "commitment": "",
  "capability": "minting"
 },
 "templateIdentifier": "160a451f5398db649de7d660855db24113b774559534361f8334cbfe9a583e20",
 "values": {
  "borrowingCommitment": "05290000",
  "borrowingFee": "254556",
  "borrowingSupply": "922337203685447580",
  "collateral": "127278282",
  "debt": "20000",
  "keyCategory": "b36d9f7f5b89788416a1ce7dda36cfd0b03bb1beb68a358d4376dcbd46587be5",
  "loanCommitment": "01204e00000000000000000000000529000000000000000000ff7f",
  "priceCommitment": "007a901d00ba4c0000",
  "startingRate": "0"
 }
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `a9f35dbd7ffdcf57e93eb416b49baeac590bde9df1fdf96c58cb0e52f3efa2e4` | 343 | 343 | the controller and the rest | [create](invitations/stage-17-loan-chipnet/01-the-owner-s-device-create-a9f35dbd.json) |
| pay the wallet | `b36d9f7f5b89788416a1ce7dda36cfd0b03bb1beb68a358d4376dcbd46587be5` | 370 | 370 | 127,682,838 sat from the funder to an address the wallet gave out, as output 0 |  |
| make a loan key | `79a9d101e814d6662769360cc1069899841ca4c33af4be68a55b5a1b59eb5534` | 798 | 798 | from the wallet's own list, with the user's tick, joined by the service: the wallet's coin that is output 0 defines the key's category (input 0); Paryon's factory, brought by the service; the key waits in Paryon's contract; output 0 is what the wallet keeps of its coin | [createKey](invitations/stage-17-loan-chipnet/03-the-owner-s-device-createKey-79a9d101.json) |
| bring the Borrowing thread up to date | `8953856d2c4117dba432e8cd1b6ab4fe4bcdeb4b0f5ebe549cfe3edc1631dca4` | 1055 | 1055 | from the wallet's own list, joined by the service, which chose the thread and the lock time: the thread moved from period 10498 to 10501 (lock time 333481); its supply put back as it was; the wallet paid the fee | [movePeriod](invitations/stage-17-loan-chipnet/04-the-owner-s-device-movePeriod-8953856d.json) |
| borrow | `cc7d301c2ea87f0c299cb4ba7e6b1fb20fe0d9d857df75001f4232df5efb079d` | 2079 | 2079 | from the wallet's own list, joined by the service: 200.00 PUSD against 127,278,282 sat of collateral, starting rate 0, as the user typed them; Paryon's fee 254,556 sat; the service brought the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and the values read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed | [borrow](invitations/stage-17-loan-chipnet/05-the-owner-s-device-borrow-cc7d301c.json) |
| add collateral | `112ec780584a00dd258f347c67c64cda010407da46737a60eb3e6a374d2c1598` | 1915 | 1915 | from the key's follow-ups in the wallet, joined by the service: 100,000 sat more collateral (the user typed what the loan holds then, 127378282); the service brought the price, the loan, its sidecar and a manage function, the loan's record and what the key's coin holds; the key back to the address it was spent from | [manage](invitations/stage-17-loan-chipnet/06-the-owner-s-device-manage-112ec780.json) |
| change the interest rate | `0af98ec79d7bbe41701ed56eca3d2d50ef479bb90651523bf19e77ef1885d27a` | 1363 | 1363 | from the key's follow-ups in the wallet, joined by the service: the loan's rate for the periods to come set from 0 to 100 per 10,000,000 per period, as the user typed it; the service brought the loan, its sidecar, a coin of Paryon's interest function, the loan's new record and what the key's coin holds; no price; the key back to the address it was spent from | [changeInterest](invitations/stage-17-loan-chipnet/07-the-owner-s-device-changeInterest-0af98ec7.json) |
| repay part of the loan | `991978aadb6ef15298d3d88495b19962a629a2aa54fc0fa5eb9bb4ebce81c295` | 2341 | 2341 | from the key's follow-ups in the wallet, joined by the service: 100.00 PUSD repaid and destroyed, as the user typed it, 100.00 PUSD still owed; the service brought the price, the loan, its sidecar and a manage function, the loan's new record and what the key's coin holds; the PUSD left over and the key back to the wallet | [repay](invitations/stage-17-loan-chipnet/08-the-owner-s-device-repay-991978aa.json) |
| request | `7a310cab02850aa5e6635226dd39cda43d4e62a5cb22c9465bd0df30339f8bae` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | [pay](invitations/stage-17-loan-chipnet/09-the-recoverer-pay-7a310cab.json) |
| complete | `54b38bbe683406dca9553d17499576679af03683d738add2ec228f4b89ff54a8` | 970 | 2910 | after the waiting period (8 minutes); no coin has moved, the loan is still open under the key the earlier seed holds | [pay](invitations/stage-17-loan-chipnet/10-the-recoverer-pay-54b38bbe.json) |
| sweep | `2654729e20c2498e15c1f590ecc55ea02c889221713ceb3598399c672c81c431` | 2038 | 6114 | 4 coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there) | [approve](invitations/stage-17-loan-chipnet/11-the-new-device-approve-2654729e.json) |
| close the loan | `6d5e928cf06b2b73e1b582948f6da930876cda83acf1805b5c6f3c5d2f5b9ab6` | 1850 | 5550 | from the key's follow-ups on the new phone, joined by the service, the page closed: the service brought the price, the loan, its sidecar and a manage function, the loan's record, the debt and what the key's coin holds; the whole debt repaid from the swept PUSD, the PUSD and the loan's record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed | [close](invitations/stage-17-loan-chipnet/12-the-new-device-close-6d5e928c.json) |
| send the key on | `e126f28fb207861c3314cb80c6e9cce3c6298153f7677b0f1648d779d0ae2172` | 714 | 2142 | the loan key, unchanged, to the address that paid for the run | [pay](invitations/stage-17-loan-chipnet/13-the-new-device-pay-e126f28f.json) |
| close the wallet | `841ba3ca20bed81038da41bbffda0bb34b04348e2822793836f8be44f994ff20` | 1273 | 3819 | everything, and the controller's value, back to the address that paid for the run | [close](invitations/stage-17-loan-chipnet/14-the-new-device-close-841ba3ca.json) |
| return the recoverer's balance | `bc283b10aa1b90b84ebe952edfbceed6757129ad10b1d87f2de0010d070d32b9` | 185 | 370 | what the recoverer did not use | [pay](invitations/stage-17-loan-chipnet/15-the-recoverer-pay-bc283b10.json) |
| destroy the key | `349f49ba0bbcc1669c23f3f3056ccb4dc69c6cb0f831a97080ad340bbb05148e` | 326 | 978 | the funder spends the loan key without carrying it on, and keeps its satoshis |  |

Each action, carried out by the wallet from its own list with the page closed:

| Step | Who took part | What the wallet asked the user for | What came from the service | Requests to the service |
| --- | --- | --- | --- | --- |
| make a loan key | two: the wallet as the borrower (3 commits) and Paryon's service as the service (1 commit) | "Make a loan key"; nothing to type; the tick for a token made from the wallet's coin that leaves to "The new loan key, waiting"; the approval | no value; Paryon's coins "Paryon's key factory", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| bring the Borrowing thread up to date | two: the wallet as the borrower (3 commits) and Paryon's service as the service (1 commit) | "Bring Paryon up to date"; nothing to type; the approval | PUSD left to lend 922337203685447580, New period 05290000, Block height 333481; Paryon's coins "Paryon's borrowing contract", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| borrow | two: the wallet as the borrower (3 commits) and Paryon's service as the service (1 commit) | "Borrow PUSD"; typed: "Debt" (debt) 20000, "Collateral" (collateral) 127278282, "Starting interest rate" (startingRate) 0; the approval | PUSD left to lend 922337203685447580, Period of the borrowing contract 05290000, Price 007a901d00ba4c0000, Loan record 01204e0000000000…, Borrowing fee 254556; Paryon's coins "Paryon's borrowing contract", "Paryon's price contract", "The new loan key", "The loan key's proof of origin", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| add collateral | two: the wallet as the borrower (4 commits) and Paryon's service as the service (1 commit) | "Change the collateral"; typed: "Collateral" (collateral) 127378282; the approval | Price 007a901d00ba4c0000, Loan record 01204e0000000000…, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| change the interest rate | two: the wallet as the borrower (4 commits) and Paryon's service as the service (1 commit) | "Change the interest rate"; typed: "New interest rate" (interestRate) 100; the approval | Collateral 127378282, Loan record 01204e0000000000…, Satoshis with the key 1000; Paryon's coins "The loan", "The loan's sidecar", "Paryon's interest function", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| repay part of the loan | two: the wallet as the borrower (5 commits) and Paryon's service as the service (1 commit) | "Repay part of the loan"; typed: "Repayment" (repayAmount) 10000; the approval | Price 007a901d00ba4c0000, Collateral 127378282, Loan record 0110270000000000…, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back | possible 2, join 1 |
| close the loan | two: the wallet as the borrower (4 commits) and Paryon's service as the service (1 commit) | "Repay and close the loan"; nothing to type; the approval | Price 007a901d00ba4c0000, Loan record 0110270000000000…, Repayment 10000, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back | possible 2, join 1 |

Every request the wallet sent the service, in the moment it sent it, as the wallet counted it. The service is Paryon's public one at https://paryon.9500.cash/service/v1, which the run did not start; its own log is not available on chipnet, so what it answered is not counted here:

| Moment | Kind | Part | hello | possible | join |
| --- | --- | --- | --- | --- | --- |
| the user trusts the template | trust | the owner opens a loan | 1 | 1 | 0 |
| make a loan key | acting | the owner opens a loan | 0 | 2 | 1 |
| bring the Borrowing thread up to date | acting | the owner opens a loan | 0 | 2 | 1 |
| borrow | acting | the owner opens a loan | 0 | 2 | 1 |
| add collateral | acting | the owner opens a loan | 0 | 2 | 1 |
| change the interest rate | acting | the owner opens a loan | 0 | 2 | 1 |
| repay part of the loan | acting | the owner opens a loan | 0 | 2 | 1 |
| Connect on the new device | Connect | the new device closes the loan from its own list | 1 | 1 | 0 |
| close the loan | acting | the new device closes the loan from its own list | 0 | 2 | 1 |

By moment:

| Moment | hello | possible | join | All |
| --- | --- | --- | --- | --- |
| the user trusts the template | 1 | 1 | 0 | 2 |
| the user presses Connect | 1 | 1 | 0 | 2 |
| the user acts | 0 | 14 | 7 | 21 |
| at any other time | 0 | 0 | 0 | 0 |

The wallet sent the service 25 requests in all, each of them in one of the three moments; before and after each moment, and at the end of every part, the run checked that the wallet had sent nothing outside them. The new device, which trusted the template again from the backup, had sent none when the user pressed Connect.

Amounts:

- Borrowing thread: period 10498 moved to 10501 (lock time 333481), chosen by the service; the loan's interest starts there
- Debt: 200.00 PUSD
- Collateral: 127,278,282 sat: 125% of the debt at the lowest stored price $196.42 when the run started, 125% at the price the service named, $196.42, at which the contracts take it (their least there: 112,004,888 sat); Paryon's fee 254,556 sat, kept by Paryon
- Interest rate: 0 per 10,000,000 per period when the loan was opened, 100 from its next interest payment on (1,018 sat a period on 200.00 PUSD at $196.42, 509 sat on 100.00)
- Repayment: 100.00 PUSD repaid before the device was lost, leaving 100.00 PUSD owed
- Closing: the loan held 127,378,282 sat and a debt of 100.00 PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed
- Funder: 159,494,982 sat before the run, 159,206,685 sat after it
- Cost of the run: 288,297 sat: Paryon's borrowing fee 254,556 sat, network fees 33,138 sat for the 16 transactions above, and 603 sat otherwise (the fees of the payments of the funder and of the recoverer's balance, which are not among the transactions above, and 1,500 sat and the interest for each interest payment someone else made on the loan while it was open: the interest was 0 until the first payment after the rate was changed to 100 per 10,000,000 per period; anything another run paid from the same key meanwhile would be here too)

Also observed:

- Before starting: Paryon's deployment `chipnet-fast-periods-6` showed 10 Borrowing threads (periods 10498), 5 price threads ($196.42), 5 loan key factories, 25 manage functions and 25 interest functions, at the tip 342758 (the period of the highest height a lock time may name for the next block: 10500). The funding address held 159,494,982 sat: enough for 127,278,282 sat of collateral, 125% of the debt at the lowest stored price $196.42, Paryon's fee 254,556 sat at $196.42, and 1,000,000 sat left there. The template offered is the frozen one of version 3, `160a451f5398db649de7d660855db24113b774559534361f8334cbfe9a583e20`, whose service is Paryon's public one at https://paryon.9500.cash/service/v1.
- The page offered its template without an action; the wallet listed the offer of "ParyonUSD loan (chipnet-fast-periods-6)" 160a451f5398… from "the loan page" for the user to trust, and the user trusted it.
- Once the user trusted the template, the wallet spoke to the service it names, "Paryon's service, which takes part in every action of this template as the service." at https://paryon.9500.cash/service/v1: it is "Service" (service) to the wallet's "Borrower" (borrower). The page sent the offer and nothing else; it asked for no action in the whole run.
- From its own list, under the template, the wallet offers the starting actions "Make a loan key" (the service said: possible now) and "Bring Paryon up to date" (the service said: possible now), and nothing that waits.
- Making a loan key: the wallet showed its own figures, worked out with the service's part: it gives 127,682,838 sat, gets 127,680,040 sat, 2,000 sat go into the application, the fee is 798 sat; to the wallet: left over; from the service (Service at https://paryon.9500.cash/service/v1): no value; Paryon's coins "Paryon's key factory", with their unlocking, and the outputs that put them back.
- Bringing Paryon up to date: the wallet showed its own figures, worked out with the service's part: it gives 127,680,040 sat, gets 127,678,985 sat, 0 sat go into the application, the fee is 1,055 sat; to the wallet: left over; from the service (Service at https://paryon.9500.cash/service/v1): PUSD left to lend 922337203685447580, New period 05290000, Block height 333481; Paryon's coins "Paryon's borrowing contract", with their unlocking, and the outputs that put them back.
- After the key was made, the wallet offers "Borrow PUSD" under the template, for the key that waits at "A loan key, waiting"; it asks for "Debt", "Collateral", "Starting interest rate".
- Borrowing: the wallet showed its own figures, worked out with the service's part: it gives 127,678,985 sat, gets 145,068 sat, 127,531,838 sat go into the application, the fee is 2,079 sat; to the wallet: receive, receive, left over; tokens +20000; from the service (Service at https://paryon.9500.cash/service/v1): PUSD left to lend 922337203685447580, Period of the borrowing contract 05290000, Price 007a901d00ba4c0000, Loan record 01204e0000000000…, Borrowing fee 254556; Paryon's coins "Paryon's borrowing contract", "Paryon's price contract", "The new loan key", "The loan key's proof of origin", with their unlocking, and the outputs that put them back.
- The earlier device holds 1 position record, written when the key reached the wallet: the key b36d9f7f5b89… (minting, commitment ""), the template, no script (the loan is at Paryon's shared contracts), the values keyCategory, debt, collateral, startingRate, borrowingSupply, borrowingCommitment, priceCommitment, loanCommitment, borrowingFee, and no page's address: no page asked for the action.
- The earlier device keeps 1 template, Paryon's, with no declaration.
- The wallet lists the key under the template ("held") and offers from its own list, as the service last said the loan allows: "Change the collateral" (asks "Collateral"), "Repay part of the loan" (asks "Repayment"), "Repay and close the loan", "Change the interest rate" (asks "New interest rate").
- Adding collateral: the wallet showed its own figures, worked out with the service's part: it gives 144,068 sat, gets 42,153 sat, 100,000 sat go into the application, the fee is 1,915 sat; to the wallet: return, left over; from the service (Service at https://paryon.9500.cash/service/v1): Price 007a901d00ba4c0000, Loan record 01204e0000000000…, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back.
- Changing the interest rate: the wallet showed its own figures, worked out with the service's part: it gives 74,273 sat, gets 72,910 sat, 0 sat go into the application, the fee is 1,363 sat; to the wallet: return, left over; from the service (Service at https://paryon.9500.cash/service/v1): Collateral 127378282, Loan record 01204e0000000000…, Satoshis with the key 1000; Paryon's coins "The loan", "The loan's sidecar", "Paryon's interest function", with their unlocking, and the outputs that put them back.
- Repaying part of the loan: the wallet showed its own figures, worked out with the service's part: it gives 73,910 sat, gets 71,569 sat, 0 sat go into the application, the fee is 2,341 sat; to the wallet: return, token change, left over; tokens -10000; from the service (Service at https://paryon.9500.cash/service/v1): Price 007a901d00ba4c0000, Collateral 127378282, Loan record 0110270000000000…, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back.
- With 100.00 PUSD owed, Paryon takes no repayment in part any more: the wallet offers "Change the collateral", "Repay and close the loan", "Change the interest rate" for the key.
- The old device holds the loan key and 100.00 PUSD at its addresses, and 111,035 sat without tokens; the loan holds 127,378,282 sat and owes 100.00 PUSD, at the rate 0 now and 100 from its next interest payment on. Then the device is lost, with the loan open.
- From "the recoverer recovers" on the run paid at least 3 sat/byte (continued with --fee-rate 3; 1 sat/byte before), because the node asked for more.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 2 records of the earlier archive into its own.
- The new device read the record of the key from a store, the earlier seed's, a suggestion; the backup held Paryon's template as the earlier owner stored it, with no declaration.
- The user trusted the template "ParyonUSD loan (chipnet-fast-periods-6)" the earlier owner stored, on the user's word; a trust restored from the backup does not speak to the template's service.
- The check of section 10.4 found that the record counts: The record names no script: it ties the token to its template, and the application says where the position stands.
- The record was written again as the new owner's own on the stores (1 record); it names no script, so nothing was handed to the engine (0 scripts).
- The new device lists the key from the record: "held", a record of its own, under the template "ParyonUSD loan (chipnet-fast-periods-6)", the key at an address of the new seed; whether the loan is open is the service's or the page's to say.
- Before Connect, the new device had sent the service no request (the public service's own log is not available on chipnet). The wallet shows the service "Paryon's service, which takes part in every action of this template as the service." at https://paryon.9500.cash/service/v1 as "never asked" and offers Connect; from its own list it offers "Make a loan key" and "Bring Paryon up to date" under the template, as the template gives them, and nothing for the key, which names no script of its own: its loan's actions come from the service.
- The user pressed Connect: the wallet asked the service who it is and what is possible for the key it now holds at an address of the new seed. Under the swept key it offers "Change the collateral" (the service says Debt 10000, Collateral 127378282), "Repay and close the loan" (the service says Repayment 10000, Collateral 127378282), "Change the interest rate" (the service says New interest rate 100, Collateral 127378282).
- Closing the loan on the new phone: the wallet showed its own figures, worked out with the service's part: it gives 1,687 sat, gets 127,375,419 sat, -127,379,282 sat go into the application, the fee is 5,550 sat; to the wallet: receive, left over; tokens -10000; from the service (Service at https://paryon.9500.cash/service/v1): Price 007a901d00ba4c0000, Loan record 0110270000000000…, Repayment 10000, Satoshis with the key 1000; Paryon's coins "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function", with their unlocking, and the outputs that put them back.
- After closing, the page finds no loan for the key; the key is still in the wallet (true); the wallet holds no PUSD. The new device keeps 1 template, Paryon's, with no declaration.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- What the recoverer had left was too little to pay 3 sat/byte and leave an output; it was returned at 2 sat/byte.
- The funding address held 159494982 satoshis before the run and holds 159206685 after it. Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses, and no loan.
