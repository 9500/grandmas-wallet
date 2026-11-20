# Stage 17 run on the local node: a ParyonUSD loan without a declaration, through the loss of a device (PR20)

Written by the run itself (`scripts/stage-17-loan-run.ts`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules, on which the run deployed Paryon's contracts as published, as the run of stage 9 did (`packages/paryon/src/local-deployment.ts`). Each part ran in a process of its own with an empty engine state. The Paryon template reached the wallet alone, as a text, in the requests of the loan page: the library the page uses (`packages/paryon`: `page-requests.ts`, `findLoan`, `loanCoins`, `readParyonState`) made each request from what it read on the chain, and the page's `DappRequests` sent it to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels; only the relay and the page's screens were left out. Every transaction of the loan is an invitation of that template, built by the unmodified engine, which signed the wallet's own inputs, and compared with what the wallet's own code had worked out before it was sent; every input of Paryon's was evaluated in the virtual machine before the user was asked. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `3ecc2f00a318853b89c3fe204b311955535febfa7a02f8703548f08a640ed4b2`
- Loan key (token category): `84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e`
- Template "ParyonUSD loan (local)" `8dd014fba592eee020dcbdf90ccdb50227fcb0865d39496dabcebf9800e0f350`, content `635e25dd14b17ed03ea2101ad65a60db607c009ad9aae9de72e6c299a5e40eb0`, with no declaration
- Paryon's deployment on the local chain: PUSD `7c4c663baad56dc6e022d109c3b36316a1715f8c2f9232cb297f4a6a11040f39`, factories `59dfd31dbb199980ef1c3ea7e61b0423ec7acd0d73ab7d3cba8f33b232262428`
- The page's address in its requests: https://loan.example/
- Repository at commit `aee92d3`
- Started 2026-11-20T16:42:06.068Z

The position record the earlier device wrote before the borrowing was signed, when the key reached the wallet, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e",
  "commitment": "",
  "capability": "minting"
 },
 "templateIdentifier": "8dd014fba592eee020dcbdf90ccdb50227fcb0865d39496dabcebf9800e0f350",
 "values": {
  "borrowingCommitment": "3b010000",
  "borrowingFee": "119789",
  "borrowingSupply": "100000000000",
  "collateral": "59894586",
  "debt": "10000",
  "interestManagerConfiguration": "000000ff7f",
  "keyCategory": "84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e",
  "loanCommitment": "01102700000000000000000000003b01000000000000000000ff7f",
  "priceCommitment": "00e903000086510000",
  "startingInterest": "0000"
 },
 "applicationPage": "https://loan.example/"
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `060798de5a746c7de88db331504d47a84847ee892320b39d4ef267c447248631` | 343 | 343 | the controller and the rest | create (Grandma's Wallet controller) |
| pay the wallet | `84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e` | 229 | 229 | 60,164,375 sat from the funder to an address the wallet gave out, as output 0 |  |
| make a loan key | `e6dcc0f66e193a5d114c0ab8ac294a89d67bc8c752439489f7ead590eaea924c` | 798 | 798 | from the page's request, with the user's tick: the wallet's coin that is output 0 defines the key's category (input 0); Paryon's factory, named by the page; the key waits in Paryon's contract; output 0 is what the wallet keeps of its coin | createKey (ParyonUSD loan (local)) |
| bring the Borrowing thread up to date | `05f067b05c0531f14c4bfe55ae3a388dc41e68189a6a1d728ee1d914fc147033` | 1042 | 1042 | from the page's request: the thread named by the page, moved from period 1 to 315 (lock time 945); its supply as the page read it | movePeriod (ParyonUSD loan (local)) |
| borrow | `a36b967c8b5426c5149b92fc7a5d6da953ad3f37bf8241e51745f19219a61c45` | 2056 | 2056 | from the page's request: 100.00 PUSD against 59,894,586 sat of collateral, Paryon's fee 119,789 sat, starting interest 0; the page named the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and gave the values it read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed | borrow (ParyonUSD loan (local)) |
| add collateral | `d11948e0cd710d0d835f81aaedd52b76500d170d14de3ff1880be6329c775216` | 1915 | 1915 | from the page's request: 100,000 sat more collateral; the page named the price, the loan, its sidecar and a manage function, and gave the key's coin value as the wallet reported it; the key back to the address it was spent from (`return`) | manage (ParyonUSD loan (local)) |
| request | `4b40161d15950cf1a15f2ec08d95a9caeef277df25924e8a1bb0b4ba37fa21f5` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | pay (Grandma's Wallet actions) |
| complete | `10bdb9ea67452fc2092213f0ad112b71a114d0ba011f65153adfa0bfa54c65aa` | 970 | 970 | after the waiting period; no coin has moved, the loan is still open under the key the earlier seed holds | pay (Grandma's Wallet actions) |
| sweep | `631f7cf7ec0c8b7a63ac2dc412d305ef597832856972b218ae47dacc7fce3528` | 2038 | 2038 | 4 coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there) | approve (Grandma's Wallet controller) |
| close the loan | `0cfb30176c2b86b78cf3666e659fd33871c51c4784d69b2a7cd60b6d0aa864fb` | 1850 | 1850 | from the page's request on the new phone: the page named the price, the loan, its sidecar and a manage function, and gave the loan's record, the debt and the key's coin value as the wallet reported it; the whole debt repaid, the PUSD and the loan's record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed | close (ParyonUSD loan (local)) |
| send the key on | `b1a18c1363cf0604e365da385699d4634cd42b7e1346bf1c3b977c33c9451468` | 714 | 714 | the loan key, unchanged, to the address that paid for the run | pay (Grandma's Wallet actions) |
| close the wallet | `cf083f99347dffe3721bd231688cdd50904996207b6aeeca795a5239ffa0ef18` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | close (Grandma's Wallet controller) |
| return the recoverer's balance | `ce37f408debb0bafa54999b580577d3b3248e1c9fdb07e0432d8ee31c42b0763` | 185 | 185 | what the recoverer did not use | pay (Grandma's Wallet actions) |
| destroy the key | `a697287c9edc761349f263f031f7a134e13c41debabea3c949595a50687c31d3` | 749 | 749 | the funder spends the loan key without carrying it on, and keeps its satoshis |  |

Amounts:

- Borrowing thread: period 1 moved to 315 (lock time 945); the loan's interest starts there
- Debt: 100.00 PUSD
- Collateral: 59,894,586 sat: 125% of the debt at the stored price $208.70; Paryon's fee 119,789 sat, paid to the address that paid for the run
- Closing: the loan held 59,994,586 sat and a debt of 100.00 PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed
- Funder: 624,990,954 sat before the run (after deploying Paryon's contracts), 624,974,775 sat after it

Also observed:

- Paryon's contracts as published (`@paryonusd/contracts` 1.1.0) were deployed on the local chain by this script, with categories of its own: PUSD `7c4c663baad56dc6e022d109c3b36316a1715f8c2f9232cb297f4a6a11040f39`, factories `59dfd31dbb199980ef1c3ea7e61b0423ec7acd0d73ab7d3cba8f33b232262428`; two Borrowing threads in period 1, two price threads at $208.70, two manage NFTs and two key factories. Paryon's fee goes to the address that paid for the run.
- Making a loan key: the wallet showed the page's request with its own figures: it gives 60,164,375 sat, gets 60,161,577 sat, 2,000 sat go into the application, the fee is 798 sat; Paryon's coins spent: "Paryon's key factory"; to the wallet: left over; it asks for the user's tick: a token made from the wallet's coin leaves to "The new loan key, waiting"; it records nothing; the template is shown with no declaration.
- Making a loan key: the page's request, as it travelled: {"templateAction":"createKey","variables":{},"creates":"keyCategory","inputs":{"factoryInput":"bf31aa91c4fcc09b0fecfe8e24b36ca47d824d3caf7b5af23864fbac3b861175:0"},"page":"https://loan.example/"}.
- After the key was made the wallet holds 0 position record: the key is in Paryon's contract, not in the wallet, and the wallet follows nothing there.
- Bringing Paryon up to date: the wallet showed the page's request with its own figures: it gives 60,161,577 sat, gets 60,160,535 sat, 0 sat go into the application, the fee is 1,042 sat; Paryon's coins spent: "Paryon's borrowing contract"; to the wallet: left over; destroyed: "Paryon's borrowing contract" (not carried on, the application's); it records nothing; the template is shown with no declaration.
- Bringing Paryon up to date: the page's request, as it travelled: {"templateAction":"movePeriod","variables":{"borrowingSupply":"100000000000","newBorrowingCommitment":"3b010000","lockHeight":945},"inputs":{"periodBorrowingInput":"3fd514f414cbeb43f0ec06ee181659385368253187044dfa541dcb90aac5b758:1"},"page":"https://loan.example/"}.
- Borrowing: the wallet showed the page's request with its own figures: it gives 60,160,535 sat, gets 145,104 sat, 60,013,375 sat go into the application, the fee is 2,056 sat; Paryon's coins spent: "Paryon's borrowing contract", "Paryon's price contract", "The new loan key", "The loan key's proof of origin"; to the wallet: receive, receive, left over; tokens +10000; destroyed: "The loan key's proof of origin" (not carried on, the application's); it records a position; the template is shown with no declaration.
- Borrowing: the page's request, as it travelled: {"templateAction":"borrow","variables":{"keyCategory":"84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e","borrowingSupply":"100000000000","borrowingCommitment":"3b010000","priceCommitment":"00e903000086510000","debt":"10000","collateral":"59894586","loanCommitment":"01102700000000000000000000003b01000000000000000000ff7f","borrowingFee":"119789","startingInterest":"0000","interestManagerConfiguration":"000000ff7f"},"bindings":{"keyHolder":"receive","tokensHolder":"receive"},"inputs":{"borrowingInput":"05f067b05c0531f14c4bfe55ae3a388dc41e68189a6a1d728ee1d914fc147033:0","priceInput":"3fd514f414cbeb43f0ec06ee181659385368253187044dfa541dcb90aac5b758:3","enforcerInput":"e6dcc0f66e193a5d114c0ab8ac294a89d67bc8c752439489f7ead590eaea924c:2","proofInput":"e6dcc0f66e193a5d114c0ab8ac294a89d67bc8c752439489f7ead590eaea924c:3"},"page":"https://loan.example/"}.
- The earlier device holds 1 position record, written when the key reached the wallet: the key 84314b5d6c63… (minting, commitment ""), the template, no script (the loan is at Paryon's shared contracts), the values keyCategory, borrowingSupply, borrowingCommitment, priceCommitment, debt, collateral, loanCommitment, borrowingFee, startingInterest, interestManagerConfiguration, and the page's address https://loan.example/.
- The earlier device keeps 1 template, Paryon's, with no declaration.
- The wallet answered the page's positions request (version 2): {"trusted":true,"positions":[{"category":"84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e","commitment":"","capability":"minting","satoshis":"1000","status":"held"}]}. Whether the loan is open the page finds out itself.
- The page found the loan from the key, through its sidecar: the loan at a36b967c8b5426c5…:2 with 59,894,586 sat, debt 100.00 PUSD; the sidecar at …:3.
- Adding collateral: the wallet showed the page's request with its own figures: it gives 144,104 sat, gets 42,189 sat, 100,000 sat go into the application, the fee is 1,915 sat; Paryon's coins spent: "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function"; to the wallet: return, left over; it records nothing; the template is shown with no declaration.
- Adding collateral: the page's request, as it travelled: {"templateAction":"manage","variables":{"keyCategory":"84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e","keySatoshis":"1000","priceCommitment":"00e803000086510000","interestManagerConfiguration":"000000ff7f","collateral":"59994586","loanCommitment":"01102700000000000000000000003b01000000000000000000ff7f"},"bindings":{"keyHolder":"return"},"about":{"category":"84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e","spent":true},"inputs":{"priceInput":"3fd514f414cbeb43f0ec06ee181659385368253187044dfa541dcb90aac5b758:2","loanInput":"a36b967c8b5426c5149b92fc7a5d6da953ad3f37bf8241e51745f19219a61c45:2","sidecarInput":"a36b967c8b5426c5149b92fc7a5d6da953ad3f37bf8241e51745f19219a61c45:3","manageInput":"3fd514f414cbeb43f0ec06ee181659385368253187044dfa541dcb90aac5b758:4"},"page":"https://loan.example/"}.
- The old device holds the loan key and 100.00 PUSD at its addresses, and 114,462 sat without tokens; the loan holds 59,994,586 sat. Then the device is lost, with the loan open.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 2 records of the earlier archive into its own.
- The new device read the record of the key from a store, the earlier seed's, a suggestion; the backup held Paryon's template as the earlier owner stored it, with no declaration.
- The user trusted the template "ParyonUSD loan (local)" the earlier owner stored, on the user's word.
- The check of section 10.4 found that the record counts: The record names no script: it ties the token to its template, and the application says where the position stands.
- The record was written again as the new owner's own on the stores (1 record); it names no script, so nothing was handed to the engine (0 scripts).
- The new device lists the key from the record: "held", a record of its own, under the template "ParyonUSD loan (local)", the key at an address of the new seed; whether the loan is open is the page's to say.
- From its own list the wallet offers 0 actions for the key, and asked to close the loan by itself it answers: "Open the application to do this: https://loan.example/. It needs "Price", "Loan record", "Interest manager", which only the application gives." (the page: https://loan.example/).
- The page on the new phone asked which keys of its template the wallet holds: not answered, since the template came from the backup and this page has not been allowed yet.
- Once the user allowed the page, the wallet answered [{"category":"84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e","commitment":"","capability":"minting","satoshis":"1000","status":"held"}]; the page found the loan from the key: 59,994,586 sat, debt 100.00 PUSD.
- Closing the loan on the new phone: the wallet showed the page's request with its own figures: it gives 2,000 sat, gets 59,995,736 sat, -59,995,586 sat go into the application, the fee is 1,850 sat; Paryon's coins spent: "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function"; to the wallet: receive, left over; tokens -10000; destroyed: "PUSD repaid" (data output, the wallet's), "The loan's record" (data output, the application's), "The loan's sidecar" (not carried on, the application's); it records nothing; the template is shown with no declaration.
- Closing the loan on the new phone: the page's request, as it travelled: {"templateAction":"close","variables":{"keyCategory":"84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e","keySatoshis":"1000","priceCommitment":"00e903000086510000","interestManagerConfiguration":"000000ff7f","loanCommitment":"01102700000000000000000000003b01000000000000000000ff7f","repayAmount":"10000"},"bindings":{"keyHolder":"receive"},"about":{"category":"84314b5d6c632bb9edf3b757b2f0f2078201b9c81eb1f49dadc90cfc52548a0e","spent":true},"inputs":{"priceInput":"a36b967c8b5426c5149b92fc7a5d6da953ad3f37bf8241e51745f19219a61c45:1","loanInput":"d11948e0cd710d0d835f81aaedd52b76500d170d14de3ff1880be6329c775216:1","sidecarInput":"d11948e0cd710d0d835f81aaedd52b76500d170d14de3ff1880be6329c775216:2","repayInput":"3fd514f414cbeb43f0ec06ee181659385368253187044dfa541dcb90aac5b758:5"},"page":"https://loan.example/"}.
- After closing, the page finds no loan for the key; the key is still in the wallet (true); the wallet holds no PUSD. The new device keeps 1 template, Paryon's, with no declaration.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 624990954 satoshis before the run and holds 624974775 after it: the run cost 16179 satoshis in network fees (Paryon's fee went to the same address and came back). Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses, and no loan. Paryon's deployment stays on the local chain.
