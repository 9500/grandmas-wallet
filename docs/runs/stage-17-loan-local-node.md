# Stage 17 run on the local node: a ParyonUSD loan without a declaration, through the loss of a device (PR20)

Written by the run itself (`scripts/stage-17-loan-run.ts`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules, on which the run deployed Paryon's contracts as published, as the run of stage 9 did (`packages/paryon/src/local-deployment.ts`). Each part ran in a process of its own with an empty engine state. The Paryon template reached the wallet alone, as a text, in the requests of the loan page: the library the page uses (`packages/paryon`: `page-requests.ts`, `findLoan`, `loanCoins`, `readParyonState`) made each request from what it read on the chain, and the page's `DappRequests` sent it to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels; only the relay and the page's screens were left out. Every transaction of the loan is an invitation of that template, built by the unmodified engine, which signed the wallet's own inputs, and compared with what the wallet's own code had worked out before it was sent; every input of Paryon's was evaluated in the virtual machine before the user was asked. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `7524995c63f05583cf923b4c43d85fd0616247f7ce0cd7c348ce7e75de660d5d`
- Loan key (token category): `b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5`
- Template "ParyonUSD loan (local)" `4a35305d392e967911d4475ab01550f77a1c4100aa19f69dfb7307312f95f197`, content `ae0ef64d6e2f8ef32cf1edf36bb7aaf8542965675f08a7f853373dc993480140`, with no declaration
- Paryon's deployment on the local chain: PUSD `98361a6d703cc9da77014ecf83e89d0338178e9aba6f46b696d0dbc83a315b30`, factories `8ac8eec901ac26f4304dfdf9913d9fb457908fc417c4ddfe90b4427fe39521e6`
- The page's address in its requests: https://loan.example/
- Repository at commit `695b20a`
- Started 2026-11-20T17:55:05.832Z

The position record the earlier device wrote before the borrowing was signed, when the key reached the wallet, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5",
  "commitment": "",
  "capability": "minting"
 },
 "templateIdentifier": "4a35305d392e967911d4475ab01550f77a1c4100aa19f69dfb7307312f95f197",
 "values": {
  "borrowingCommitment": "4c000000",
  "borrowingFee": "119789",
  "borrowingSupply": "100000000000",
  "collateral": "59894586",
  "debt": "10000",
  "interestManagerConfiguration": "000000ff7f",
  "keyCategory": "b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5",
  "loanCommitment": "01102700000000000000000000004c00000000000000000000ff7f",
  "priceCommitment": "00e903000086510000",
  "startingInterest": "0000"
 },
 "applicationPage": "https://loan.example/"
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `41e703a285edd7938e33677b516fc605d3991c46d4fcd140a519580483574eca` | 343 | 343 | the controller and the rest | create (Grandma's Wallet controller) |
| pay the wallet | `b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5` | 229 | 229 | 60,164,375 sat from the funder to an address the wallet gave out, as output 0 |  |
| make a loan key | `f278c1d3036dd8f48a93022947c9bb7f4ae0fe700447f60667c31fcbe9169a97` | 798 | 798 | from the page's request, with the user's tick: the wallet's coin that is output 0 defines the key's category (input 0); Paryon's factory, named by the page; the key waits in Paryon's contract; output 0 is what the wallet keeps of its coin | createKey (ParyonUSD loan (local)) |
| bring the Borrowing thread up to date | `5b549a12427526ef9e15a95877f83d3f2341a2201207e30ba71f6205d9943f50` | 1042 | 1042 | from the page's request: the thread named by the page, moved from period 1 to 76 (lock time 229); its supply as the page read it | movePeriod (ParyonUSD loan (local)) |
| borrow | `f1a7eeca764c1cec56b9291203d95958c3357b258290614d6426f9c595f57a4e` | 2056 | 2056 | from the page's request: 100.00 PUSD against 59,894,586 sat of collateral, Paryon's fee 119,789 sat, starting interest 0; the page named the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and gave the values it read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed | borrow (ParyonUSD loan (local)) |
| add collateral | `6da221db65efd8b8338c17a92b40c6f9103601ceb314912cc691a7f49b8612cc` | 1915 | 1915 | from the page's request: 100,000 sat more collateral; the page named the price, the loan, its sidecar and a manage function, and gave the key's coin value as the wallet reported it; the key back to the address it was spent from (`return`) | manage (ParyonUSD loan (local)) |
| request | `777484ea34648406dd4729cf1131a377e888d096d51f3d56898419c9522296a8` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | pay (Grandma's Wallet actions) |
| complete | `ad605eb1cb4f77e708a65c669a64c33c0f3c560f054ef8eb8dafd68a73fb1838` | 970 | 970 | after the waiting period; no coin has moved, the loan is still open under the key the earlier seed holds | pay (Grandma's Wallet actions) |
| sweep | `6c837b585c26e101072f2e77631f7aa61a6143eeef55ae2229569ee46294be26` | 2038 | 2038 | 4 coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there) | approve (Grandma's Wallet controller) |
| close the loan | `f860d7383777f1eec3d3dbf5613457fa7ee591d3889c1eecca9d1f90a4467945` | 1850 | 1850 | from the page's request on the new phone: the page named the price, the loan, its sidecar and a manage function, and gave the loan's record, the debt and the key's coin value as the wallet reported it; the whole debt repaid, the PUSD and the loan's record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed | close (ParyonUSD loan (local)) |
| send the key on | `902ec0efd160904befbe15850d9903a4367bc1eaa9d6e4de7ec88e562ab5f7bf` | 714 | 714 | the loan key, unchanged, to the address that paid for the run | pay (Grandma's Wallet actions) |
| close the wallet | `8dab6cf54d6f0f3bda1ea070e8afe3a3f64c2f25275d95c00ec3be6f340239eb` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | close (Grandma's Wallet controller) |
| return the recoverer's balance | `1631673c2d1ad737568bcfbbc88f9b6d2d228b4c167a9b41256673a583f25e7f` | 185 | 185 | what the recoverer did not use | pay (Grandma's Wallet actions) |
| destroy the key | `efcdb34fe5a96bc6cbd52614e1a15dcaf06dfc722f25fcc195109836d3be1ef2` | 749 | 749 | the funder spends the loan key without carrying it on, and keeps its satoshis |  |

Amounts:

- Borrowing thread: period 1 moved to 76 (lock time 229); the loan's interest starts there
- Debt: 100.00 PUSD
- Collateral: 59,894,586 sat: 125% of the debt at the stored price $208.70; Paryon's fee 119,789 sat, paid to the address that paid for the run
- Closing: the loan held 59,994,586 sat and a debt of 100.00 PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed
- Funder: 19,999,990,954 sat before the run (after deploying Paryon's contracts), 19,999,974,775 sat after it

Also observed:

- Paryon's contracts as published (`@paryonusd/contracts` 1.1.0) were deployed on the local chain by this script, with categories of its own: PUSD `98361a6d703cc9da77014ecf83e89d0338178e9aba6f46b696d0dbc83a315b30`, factories `8ac8eec901ac26f4304dfdf9913d9fb457908fc417c4ddfe90b4427fe39521e6`; two Borrowing threads in period 1, two price threads at $208.70, two manage NFTs and two key factories. Paryon's fee goes to the address that paid for the run.
- Making a loan key: the wallet showed the page's request with its own figures: it gives 60,164,375 sat, gets 60,161,577 sat, 2,000 sat go into the application, the fee is 798 sat; Paryon's coins spent: "Paryon's key factory"; to the wallet: left over; it asks for the user's tick: a token made from the wallet's coin leaves to "The new loan key, waiting"; it records nothing; the template is shown with no declaration.
- Making a loan key: the page's request, as it travelled: {"templateAction":"createKey","variables":{},"creates":"keyCategory","inputs":{"factoryInput":"3b1e1be9bb228c0ac6cf4fefcd4f410e3c5af7bc6618ba263fef87348deb0977:0"},"page":"https://loan.example/"}.
- After the key was made the wallet holds 0 position record: the key is in Paryon's contract, not in the wallet, and the wallet follows nothing there.
- Bringing Paryon up to date: the wallet showed the page's request with its own figures: it gives 60,161,577 sat, gets 60,160,535 sat, 0 sat go into the application, the fee is 1,042 sat; Paryon's coins spent: "Paryon's borrowing contract"; to the wallet: left over; destroyed: "Paryon's borrowing contract" (not carried on, the application's); it records nothing; the template is shown with no declaration.
- Bringing Paryon up to date: the page's request, as it travelled: {"templateAction":"movePeriod","variables":{"borrowingSupply":"100000000000","newBorrowingCommitment":"4c000000","lockHeight":229},"inputs":{"periodBorrowingInput":"6c4fc5b8acac8016840530618d830c0d71413d679f595c7dee63323781956d34:1"},"page":"https://loan.example/"}.
- Borrowing: the wallet showed the page's request with its own figures: it gives 60,160,535 sat, gets 145,104 sat, 60,013,375 sat go into the application, the fee is 2,056 sat; Paryon's coins spent: "Paryon's borrowing contract", "Paryon's price contract", "The new loan key", "The loan key's proof of origin"; to the wallet: receive, receive, left over; tokens +10000; destroyed: "The loan key's proof of origin" (not carried on, the application's); it records a position; the template is shown with no declaration.
- Borrowing: the page's request, as it travelled: {"templateAction":"borrow","variables":{"keyCategory":"b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5","borrowingSupply":"100000000000","borrowingCommitment":"4c000000","priceCommitment":"00e903000086510000","debt":"10000","collateral":"59894586","loanCommitment":"01102700000000000000000000004c00000000000000000000ff7f","borrowingFee":"119789","startingInterest":"0000","interestManagerConfiguration":"000000ff7f"},"bindings":{"keyHolder":"receive","tokensHolder":"receive"},"inputs":{"borrowingInput":"5b549a12427526ef9e15a95877f83d3f2341a2201207e30ba71f6205d9943f50:0","priceInput":"6c4fc5b8acac8016840530618d830c0d71413d679f595c7dee63323781956d34:3","enforcerInput":"f278c1d3036dd8f48a93022947c9bb7f4ae0fe700447f60667c31fcbe9169a97:2","proofInput":"f278c1d3036dd8f48a93022947c9bb7f4ae0fe700447f60667c31fcbe9169a97:3"},"page":"https://loan.example/"}.
- The earlier device holds 1 position record, written when the key reached the wallet: the key b11901580928… (minting, commitment ""), the template, no script (the loan is at Paryon's shared contracts), the values keyCategory, borrowingSupply, borrowingCommitment, priceCommitment, debt, collateral, loanCommitment, borrowingFee, startingInterest, interestManagerConfiguration, and the page's address https://loan.example/.
- The earlier device keeps 1 template, Paryon's, with no declaration.
- The wallet answered the page's positions request (version 2): {"trusted":true,"positions":[{"category":"b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5","commitment":"","capability":"minting","satoshis":"1000","status":"held"}]}. Whether the loan is open the page finds out itself.
- The page found the loan from the key, through its sidecar: the loan at f1a7eeca764c1cec…:2 with 59,894,586 sat, debt 100.00 PUSD; the sidecar at …:3.
- Adding collateral: the wallet showed the page's request with its own figures: it gives 144,104 sat, gets 42,189 sat, 100,000 sat go into the application, the fee is 1,915 sat; Paryon's coins spent: "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function"; to the wallet: return, left over; it records nothing; the template is shown with no declaration.
- Adding collateral: the page's request, as it travelled: {"templateAction":"manage","variables":{"keySatoshis":"1000","priceCommitment":"00e803000086510000","interestManagerConfiguration":"000000ff7f","collateral":"59994586","loanCommitment":"01102700000000000000000000004c00000000000000000000ff7f"},"bindings":{"keyHolder":"return"},"about":{"category":"b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5","spent":true},"inputs":{"priceInput":"6c4fc5b8acac8016840530618d830c0d71413d679f595c7dee63323781956d34:2","loanInput":"f1a7eeca764c1cec56b9291203d95958c3357b258290614d6426f9c595f57a4e:2","sidecarInput":"f1a7eeca764c1cec56b9291203d95958c3357b258290614d6426f9c595f57a4e:3","manageInput":"6c4fc5b8acac8016840530618d830c0d71413d679f595c7dee63323781956d34:4"},"page":"https://loan.example/"}.
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
- Once the user allowed the page, the wallet answered [{"category":"b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5","commitment":"","capability":"minting","satoshis":"1000","status":"held"}]; the page found the loan from the key: 59,994,586 sat, debt 100.00 PUSD.
- Closing the loan on the new phone: the wallet showed the page's request with its own figures: it gives 2,000 sat, gets 59,995,736 sat, -59,995,586 sat go into the application, the fee is 1,850 sat; Paryon's coins spent: "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function"; to the wallet: receive, left over; tokens -10000; destroyed: "PUSD repaid" (data output, the wallet's), "The loan's record" (data output, the application's), "The loan's sidecar" (not carried on, the application's); it records nothing; the template is shown with no declaration.
- Closing the loan on the new phone: the page's request, as it travelled: {"templateAction":"close","variables":{"keySatoshis":"1000","priceCommitment":"00e803000086510000","interestManagerConfiguration":"000000ff7f","loanCommitment":"01102700000000000000000000004c00000000000000000000ff7f","repayAmount":"10000"},"bindings":{"keyHolder":"receive"},"about":{"category":"b11901580928d06d873d960532b4cf35ff18811eb4987202fbca4726f24991e5","spent":true},"inputs":{"priceInput":"6da221db65efd8b8338c17a92b40c6f9103601ceb314912cc691a7f49b8612cc:0","loanInput":"6da221db65efd8b8338c17a92b40c6f9103601ceb314912cc691a7f49b8612cc:1","sidecarInput":"6da221db65efd8b8338c17a92b40c6f9103601ceb314912cc691a7f49b8612cc:2","repayInput":"6c4fc5b8acac8016840530618d830c0d71413d679f595c7dee63323781956d34:5"},"page":"https://loan.example/"}.
- After closing, the page finds no loan for the key; the key is still in the wallet (true); the wallet holds no PUSD. The new device keeps 1 template, Paryon's, with no declaration.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 19999990954 satoshis before the run and holds 19999974775 after it: the run cost 16179 satoshis in network fees (Paryon's fee went to the same address and came back). Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses, and no loan. Paryon's deployment stays on the local chain.
