# Stage 17 run on the local node: a ParyonUSD loan without a declaration, through the loss of a device (PR20)

Written by the run itself (`scripts/stage-17-loan-run.ts`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules, on which the run deployed Paryon's contracts as published, as the run of stage 9 did (`packages/paryon/src/local-deployment.ts`). Each part ran in a process of its own with an empty engine state. The Paryon template reached the wallet alone, as a text, in the requests of the loan page: the library the page uses (`packages/paryon`: `page-requests.ts`, `findLoan`, `loanCoins`, `readParyonState`) made each request from what it read on the chain, and the page's `DappRequests` sent it to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels; only the relay and the page's screens were left out. Every transaction of the loan is an invitation of that template, built by the unmodified engine, which signed the wallet's own inputs, and compared with what the wallet's own code had worked out before it was sent; every input of Paryon's was evaluated in the virtual machine before the user was asked. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `c3b89cb1265aaeb2d9e4d3b1b4e073bde6c9e8e3209f182599436d8c3ccb38be`
- Loan key (token category): `d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521`
- Template "ParyonUSD loan (local)" `f1747cab9bd447c58100efa9b80fdbcf97312cdba596b307cb6b1d7c2c8af64a`, content `2c4b645feb7dd143c48806d4062f0c00b19b81005f05ef46b0fb4b97aee80e60`, with no declaration
- Paryon's deployment on the local chain: PUSD `148fc5b08c1be59210abefe2a33092ee685aee4537390a5dcb547031ecd4ec25`, factories `950a7828ea77ee9675f214c562dceb02aa3913c6f00ec6ef10f4b18198d7fa43`
- The page's address in its requests: https://loan.example/
- Repository at commit `1665b1f`
- Started 2026-11-20T17:47:04.154Z

The position record the earlier device wrote before the borrowing was signed, when the key reached the wallet, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521",
  "commitment": "",
  "capability": "minting"
 },
 "templateIdentifier": "f1747cab9bd447c58100efa9b80fdbcf97312cdba596b307cb6b1d7c2c8af64a",
 "values": {
  "borrowingCommitment": "2e020000",
  "borrowingFee": "119789",
  "borrowingSupply": "100000000000",
  "collateral": "59894586",
  "debt": "10000",
  "interestManagerConfiguration": "000000ff7f",
  "keyCategory": "d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521",
  "loanCommitment": "01102700000000000000000000002e02000000000000000000ff7f",
  "priceCommitment": "00e903000086510000",
  "startingInterest": "0000"
 },
 "applicationPage": "https://loan.example/"
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `3e9026c23455406c4da67ebe9d4df158baeb4c22991f650d1696d4151eb32dbe` | 343 | 343 | the controller and the rest | create (Grandma's Wallet controller) |
| pay the wallet | `d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521` | 1639 | 1639 | 60,164,375 sat from the funder to an address the wallet gave out, as output 0 |  |
| make a loan key | `e4e7fd76784cd3e2c4af1c1344b8b1649af8b7ae8d5bb9426e7e78d0c839febb` | 798 | 798 | from the page's request, with the user's tick: the wallet's coin that is output 0 defines the key's category (input 0); Paryon's factory, named by the page; the key waits in Paryon's contract; output 0 is what the wallet keeps of its coin | createKey (ParyonUSD loan (local)) |
| bring the Borrowing thread up to date | `5500569b26800812243b6a4cf65b52a8fee4e22a7d09b076a7da60a68d51deee` | 1042 | 1042 | from the page's request: the thread named by the page, moved from period 1 to 558 (lock time 1674); its supply as the page read it | movePeriod (ParyonUSD loan (local)) |
| borrow | `4e8cba519ad4392933f8ed8e7445aeaa6da701fafdb822cbe6368c879a9b7ea9` | 2056 | 2056 | from the page's request: 100.00 PUSD against 59,894,586 sat of collateral, Paryon's fee 119,789 sat, starting interest 0; the page named the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and gave the values it read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed | borrow (ParyonUSD loan (local)) |
| add collateral | `4ae0492882c2d641b9227be7d4d117bb297c4bc14347e44d22a1ddab2e44eaba` | 1915 | 1915 | from the page's request: 100,000 sat more collateral; the page named the price, the loan, its sidecar and a manage function, and gave the key's coin value as the wallet reported it; the key back to the address it was spent from (`return`) | manage (ParyonUSD loan (local)) |
| request | `b36f25e52a1569e14b413253e1ff748ebedd10766c6e75b130d059183a46ae04` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | pay (Grandma's Wallet actions) |
| complete | `0d47fe9d6834217601ca4dce4b86bae49e7c1f5993f630a06e56924f41ff9473` | 970 | 970 | after the waiting period; no coin has moved, the loan is still open under the key the earlier seed holds | pay (Grandma's Wallet actions) |
| sweep | `633f2676dc967829bf5039a3c0ed6786a649ae1565a50f0dc3dccae6e4417eed` | 2038 | 2038 | 4 coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there) | approve (Grandma's Wallet controller) |
| close the loan | `48116208fa415029e7e20298c0087ab34b485ee904ec919106009e8365170cd9` | 1850 | 1850 | from the page's request on the new phone: the page named the price, the loan, its sidecar and a manage function, and gave the loan's record, the debt and the key's coin value as the wallet reported it; the whole debt repaid, the PUSD and the loan's record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed | close (ParyonUSD loan (local)) |
| send the key on | `2de049aa7699ad273011358747833909721618dab0d5d06164585a49d036372e` | 714 | 714 | the loan key, unchanged, to the address that paid for the run | pay (Grandma's Wallet actions) |
| close the wallet | `bdd3a4a12bcbf228ce942a31be32b043b495af020dae15bad414a30642ae8ecd` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | close (Grandma's Wallet controller) |
| return the recoverer's balance | `ed0fb35ad07d4aed1bd44fc756bcd37d9cc534fd6bf33bbe10be8f212c49608d` | 185 | 185 | what the recoverer did not use | pay (Grandma's Wallet actions) |
| destroy the key | `d3f3476e5ce77338876291db0bfb20d6a767b5ca87a04b7c5e7adaf58d52a114` | 749 | 749 | the funder spends the loan key without carrying it on, and keeps its satoshis |  |

Amounts:

- Borrowing thread: period 1 moved to 558 (lock time 1674); the loan's interest starts there
- Debt: 100.00 PUSD
- Collateral: 59,894,586 sat: 125% of the debt at the stored price $208.70; Paryon's fee 119,789 sat, paid to the address that paid for the run
- Closing: the loan held 59,994,586 sat and a debt of 100.00 PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed
- Funder: 39,053,454 sat before the run (after deploying Paryon's contracts), 87,865,354 sat after it, with 48,828,463 sat mined to it during the run (see the note at the end)

Also observed:

- Paryon's contracts as published (`@paryonusd/contracts` 1.1.0) were deployed on the local chain by this script, with categories of its own: PUSD `148fc5b08c1be59210abefe2a33092ee685aee4537390a5dcb547031ecd4ec25`, factories `950a7828ea77ee9675f214c562dceb02aa3913c6f00ec6ef10f4b18198d7fa43`; two Borrowing threads in period 1, two price threads at $208.70, two manage NFTs and two key factories. Paryon's fee goes to the address that paid for the run.
- Making a loan key: the wallet showed the page's request with its own figures: it gives 60,164,375 sat, gets 60,161,577 sat, 2,000 sat go into the application, the fee is 798 sat; Paryon's coins spent: "Paryon's key factory"; to the wallet: left over; it asks for the user's tick: a token made from the wallet's coin leaves to "The new loan key, waiting"; it records nothing; the template is shown with no declaration.
- Making a loan key: the page's request, as it travelled: {"templateAction":"createKey","variables":{},"creates":"keyCategory","inputs":{"factoryInput":"c51bbca83648ca8d9f89cf0c9e7b57d5469333eea1899c64c59bff631e2efb81:0"},"page":"https://loan.example/"}.
- After the key was made the wallet holds 0 position record: the key is in Paryon's contract, not in the wallet, and the wallet follows nothing there.
- Bringing Paryon up to date: the wallet showed the page's request with its own figures: it gives 60,161,577 sat, gets 60,160,535 sat, 0 sat go into the application, the fee is 1,042 sat; Paryon's coins spent: "Paryon's borrowing contract"; to the wallet: left over; destroyed: "Paryon's borrowing contract" (not carried on, the application's); it records nothing; the template is shown with no declaration.
- Bringing Paryon up to date: the page's request, as it travelled: {"templateAction":"movePeriod","variables":{"borrowingSupply":"100000000000","newBorrowingCommitment":"2e020000","lockHeight":1674},"inputs":{"periodBorrowingInput":"f54474614812c22af6ec5a5dbb40b3b3e7dcff6e2efa06e5abee1adda035cc43:1"},"page":"https://loan.example/"}.
- Borrowing: the wallet showed the page's request with its own figures: it gives 60,160,535 sat, gets 145,104 sat, 60,013,375 sat go into the application, the fee is 2,056 sat; Paryon's coins spent: "Paryon's borrowing contract", "Paryon's price contract", "The new loan key", "The loan key's proof of origin"; to the wallet: receive, receive, left over; tokens +10000; destroyed: "The loan key's proof of origin" (not carried on, the application's); it records a position; the template is shown with no declaration.
- Borrowing: the page's request, as it travelled: {"templateAction":"borrow","variables":{"keyCategory":"d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521","borrowingSupply":"100000000000","borrowingCommitment":"2e020000","priceCommitment":"00e903000086510000","debt":"10000","collateral":"59894586","loanCommitment":"01102700000000000000000000002e02000000000000000000ff7f","borrowingFee":"119789","startingInterest":"0000","interestManagerConfiguration":"000000ff7f"},"bindings":{"keyHolder":"receive","tokensHolder":"receive"},"inputs":{"borrowingInput":"5500569b26800812243b6a4cf65b52a8fee4e22a7d09b076a7da60a68d51deee:0","priceInput":"f54474614812c22af6ec5a5dbb40b3b3e7dcff6e2efa06e5abee1adda035cc43:3","enforcerInput":"e4e7fd76784cd3e2c4af1c1344b8b1649af8b7ae8d5bb9426e7e78d0c839febb:2","proofInput":"e4e7fd76784cd3e2c4af1c1344b8b1649af8b7ae8d5bb9426e7e78d0c839febb:3"},"page":"https://loan.example/"}.
- The earlier device holds 1 position record, written when the key reached the wallet: the key d853cc7a0c25… (minting, commitment ""), the template, no script (the loan is at Paryon's shared contracts), the values keyCategory, borrowingSupply, borrowingCommitment, priceCommitment, debt, collateral, loanCommitment, borrowingFee, startingInterest, interestManagerConfiguration, and the page's address https://loan.example/.
- The earlier device keeps 1 template, Paryon's, with no declaration.
- The wallet answered the page's positions request (version 2): {"trusted":true,"positions":[{"category":"d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521","commitment":"","capability":"minting","satoshis":"1000","status":"held"}]}. Whether the loan is open the page finds out itself.
- The page found the loan from the key, through its sidecar: the loan at 4e8cba519ad43929…:2 with 59,894,586 sat, debt 100.00 PUSD; the sidecar at …:3.
- Adding collateral: the wallet showed the page's request with its own figures: it gives 144,104 sat, gets 42,189 sat, 100,000 sat go into the application, the fee is 1,915 sat; Paryon's coins spent: "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function"; to the wallet: return, left over; it records nothing; the template is shown with no declaration.
- Adding collateral: the page's request, as it travelled: {"templateAction":"manage","variables":{"keySatoshis":"1000","priceCommitment":"00e903000086510000","interestManagerConfiguration":"000000ff7f","collateral":"59994586","loanCommitment":"01102700000000000000000000002e02000000000000000000ff7f"},"bindings":{"keyHolder":"return"},"about":{"category":"d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521","spent":true},"inputs":{"priceInput":"4e8cba519ad4392933f8ed8e7445aeaa6da701fafdb822cbe6368c879a9b7ea9:1","loanInput":"4e8cba519ad4392933f8ed8e7445aeaa6da701fafdb822cbe6368c879a9b7ea9:2","sidecarInput":"4e8cba519ad4392933f8ed8e7445aeaa6da701fafdb822cbe6368c879a9b7ea9:3","manageInput":"f54474614812c22af6ec5a5dbb40b3b3e7dcff6e2efa06e5abee1adda035cc43:4"},"page":"https://loan.example/"}.
- The old device holds the loan key and 100.00 PUSD at its addresses, and 114,462 sat without tokens; the loan holds 59,994,586 sat. Then the device is lost, with the loan open.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 2 records of the earlier archive into its own.
- The new device read the record of the key from a store, the earlier seed's, a suggestion; the backup held Paryon's template as the earlier owner stored it, with no declaration.
- The user trusted the template "ParyonUSD loan (local)" the earlier owner stored, on the user's word.
- The check of section 10.4 found that the record counts: The record names no script: it ties the token to its template, and the application says where the position stands.
- The record was written again as the new owner's own on the stores (1 record); it names no script, so nothing was handed to the engine (0 scripts).
- The new device lists the key from the record: "held", a record of its own, under the template "ParyonUSD loan (local)", the key at an address of the new seed; whether the loan is open is the page's to say.
- From its own list the wallet offers 0 actions for the key and shows it with "Open the application to do this" and the page's address from the record (https://loan.example/); asked to close the loan by itself it answers: "Open the application to do this: https://loan.example/. It needs "Price", "Loan record", "Interest manager", which only the application gives." (the page: https://loan.example/).
- The page on the new phone asked which keys of its template the wallet holds: not answered, since the template came from the backup and this page has not been allowed yet.
- Once the user allowed the page, the wallet answered [{"category":"d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521","commitment":"","capability":"minting","satoshis":"1000","status":"held"}]; the page found the loan from the key: 59,994,586 sat, debt 100.00 PUSD.
- Closing the loan on the new phone: the wallet showed the page's request with its own figures: it gives 2,000 sat, gets 59,995,736 sat, -59,995,586 sat go into the application, the fee is 1,850 sat; Paryon's coins spent: "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function"; to the wallet: receive, left over; tokens -10000; destroyed: "PUSD repaid" (data output, the wallet's), "The loan's record" (data output, the application's), "The loan's sidecar" (not carried on, the application's); it records nothing; the template is shown with no declaration.
- Closing the loan on the new phone: the page's request, as it travelled: {"templateAction":"close","variables":{"keySatoshis":"1000","priceCommitment":"00e903000086510000","interestManagerConfiguration":"000000ff7f","loanCommitment":"01102700000000000000000000002e02000000000000000000ff7f","repayAmount":"10000"},"bindings":{"keyHolder":"receive"},"about":{"category":"d853cc7a0c256131d75855fbfc09e6b714d151191f449dcd1189ada8607a5521","spent":true},"inputs":{"priceInput":"4ae0492882c2d641b9227be7d4d117bb297c4bc14347e44d22a1ddab2e44eaba:0","loanInput":"4ae0492882c2d641b9227be7d4d117bb297c4bc14347e44d22a1ddab2e44eaba:1","sidecarInput":"4ae0492882c2d641b9227be7d4d117bb297c4bc14347e44d22a1ddab2e44eaba:2","repayInput":"4ae0492882c2d641b9227be7d4d117bb297c4bc14347e44d22a1ddab2e44eaba:3"},"page":"https://loan.example/"}.
- After closing, the page finds no loan for the key; the key is still in the wallet (true); the wallet holds no PUSD. The new device keeps 1 template, Paryon's, with no declaration.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 39053454 satoshis before the run and holds 87865354 after it: the run cost -48811900 satoshis in network fees (Paryon's fee went to the same address and came back). Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses, and no loan. Paryon's deployment stays on the local chain.

Note added by hand after the run: the run stopped once, in its first part, after the wallet's creation, because the funding address held too little for the loan at the local chain's present block rewards; the chain is 1,674 blocks long. Ten blocks were mined to the funding address, and a hundred to a burn address so that their coins could be spent, and the run was continued with the same command. Those ten blocks brought 48,828,463 sat to the funding address: their rewards and the fee of the creation, which they confirmed. Less that, the run cost the funding address 16,220 sat; the network fees in the table above add up to 16,563 sat, of which the creation's 343 came back in those blocks. The figure "-48811900" in the line above is the run's own arithmetic and does not take the mined blocks into account.
