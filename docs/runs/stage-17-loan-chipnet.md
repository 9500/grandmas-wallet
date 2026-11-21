# Stage 17 run on chipnet: a ParyonUSD loan without a declaration, through the loss of a device (PR20)

Written by the run itself (`scripts/stage-17-loan-run.ts chipnet`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, on chipnet, against Paryon's own public deployment `chipnet-fast-periods-6`, unchanged, with its frozen template (`packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json`) as the page sent it; nothing of Paryon's but its contracts on the chain was consulted. The run was paid from the funding address and returned everything to it at the end but Paryon's borrowing fee; it made no block, and the waiting period passed on the chain's own clock. Each part ran in a process of its own with an empty engine state. The Paryon template reached the wallet alone, as a text, in the requests of the loan page: the library the page uses (`packages/paryon`: `page-requests.ts`, `findLoan`, `loanCoins`, `readParyonState`) made each request from what it read on the chain, and the page's `DappRequests` sent it to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels; only the relay and the page's screens were left out. Every transaction of the loan is an invitation of that template, built by the unmodified engine, which signed the wallet's own inputs, and compared with what the wallet's own code had worked out before it was sent; every input of Paryon's was evaluated in the virtual machine before the user was asked. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `efc5c7f7f8df8ae7837fcdbd758d8a49d2dd9d6aa69310eb7f7bd57bb17b1241`
- Loan key (token category): `dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324`
- Template "ParyonUSD loan (chipnet-fast-periods-6)" `aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be`, content `99b19cdebc79ac9ece0dcd7773f0ce846ec2adabd27e763e781dfb75600aaf61`, with no declaration
- Paryon's deployment `chipnet-fast-periods-6`: PUSD `e7979ccdae259293c7d0bee45ce8b7ad7660ea99477f802ed6a5161b0d30e6b8`, factories `8a51671cdc956212bd6b9c5ff2ad75a5d5364ef916162d1b82ee64a3438557f8`
- The page's address in its requests: https://loan.example/
- Repository at commit `0dd4fda`
- Started 2026-11-21T21:37:16.766Z
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `docs/runs/invitations/stage-17-loan-chipnet/`, with `index.json` naming the template, action and role of each.
- The engine ran as published, with no local change, given one server (chipnet.9500.cash), as in run B.

The position record the earlier device wrote before the borrowing was signed, when the key reached the wallet, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324",
  "commitment": "",
  "capability": "minting"
 },
 "templateIdentifier": "aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be",
 "values": {
  "borrowingCommitment": "e7280000",
  "borrowingFee": "125855",
  "borrowingSupply": "922337203685457580",
  "collateral": "62927910",
  "debt": "10000",
  "interestManagerConfiguration": "000000ff7f",
  "keyCategory": "dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324",
  "loanCommitment": "0110270000000000000000000000e728000000000000000000ff7f",
  "priceCommitment": "00aa8d1d00984d0000",
  "startingInterest": "0000"
 },
 "applicationPage": "https://loan.example/"
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `3817e13054dbf172c3b5ea2c8ba6b1ffa5f762d39549e676ece9f46bd72f3d95` | 343 | 343 | the controller and the rest | [create](invitations/stage-17-loan-chipnet/01-the-owner-s-device-create-3817e130.json) |
| pay the wallet | `dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324` | 229 | 229 | 63,203,765 sat from the funder to an address the wallet gave out, as output 0 |  |
| make a loan key | `83dacd056dcf3f0a75efb2518c3f92da94332def249de0ea1fafa8344c384d8c` | 798 | 798 | from the page's request, with the user's tick: the wallet's coin that is output 0 defines the key's category (input 0); Paryon's factory, named by the page; the key waits in Paryon's contract; output 0 is what the wallet keeps of its coin | [createKey](invitations/stage-17-loan-chipnet/03-the-owner-s-device-createKey-83dacd05.json) |
| borrow | `91bcdc44e7bd5a87a94bfc84a20cb90de1abfccaa421ae6c8641f17b81000938` | 2079 | 2079 | from the page's request: 100.00 PUSD against 62,927,910 sat of collateral, Paryon's fee 125,855 sat, starting interest 0; the page named the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and gave the values it read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed | [borrow](invitations/stage-17-loan-chipnet/04-the-owner-s-device-borrow-91bcdc44.json) |
| add collateral | `b9375be2fa9fcaaa4300fbce66b4ceedbabda29cb209adb8ab25a9e4a7c30c9b` | 1915 | 1915 | from the page's request: 100,000 sat more collateral; the page named the price, the loan, its sidecar and a manage function, and gave the key's coin value as the wallet reported it; the key back to the address it was spent from (`return`) | [manage](invitations/stage-17-loan-chipnet/05-the-owner-s-device-manage-b9375be2.json) |
| request | `4ca99b01948ca4e8dd1e087780dda958ae04d338132800c55d1d8e4ef8b7e518` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | [pay](invitations/stage-17-loan-chipnet/06-the-recoverer-pay-4ca99b01.json) |
| complete | `6a754f62236b78734c1e8954ea8dc66b4faafa1b20aa98d1515760ea5c4f96af` | 970 | 970 | after the waiting period (7 minutes); no coin has moved, the loan is still open under the key the earlier seed holds | [pay](invitations/stage-17-loan-chipnet/07-the-recoverer-pay-6a754f62.json) |
| sweep | `937eeeeb3f7baff9c323bd9a20c9a914b3fde20e58a21a523ece384df95bb6b3` | 2038 | 2038 | 4 coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there) | [approve](invitations/stage-17-loan-chipnet/08-the-new-device-approve-937eeeeb.json) |
| close the loan | `fac571d672e7a59250c99b5cd87ff0fa2b70cd77763ab10259cf8a52bcd3ee57` | 1850 | 1850 | from the page's request on the new phone: the page named the price, the loan, its sidecar and a manage function, and gave the loan's record, the debt and the key's coin value as the wallet reported it; the whole debt repaid, the PUSD and the loan's record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed | [close](invitations/stage-17-loan-chipnet/09-the-new-device-close-fac571d6.json) |
| send the key on | `5a55157a57e6f89e3f32263afd137f3cd75e7d6134abf1fd6aa8b760a07ee31e` | 714 | 714 | the loan key, unchanged, to the address that paid for the run | [pay](invitations/stage-17-loan-chipnet/10-the-new-device-pay-5a55157a.json) |
| close the wallet | `c11a10010d46cb42d8ddd236a2cd2c539bb652918340a5ce22c8191bb5243005` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | [close](invitations/stage-17-loan-chipnet/11-the-new-device-close-c11a1001.json) |
| return the recoverer's balance | `3e827948230e7508f52981a48189340cf01419bc77783a697ab9bf2b9964c7e1` | 185 | 185 | what the recoverer did not use | [pay](invitations/stage-17-loan-chipnet/12-the-recoverer-pay-3e827948.json) |
| destroy the key | `b965efe9e2ec122c00c3e5b04bd70c0e68e2533adce1fbd39d49f6701adc64fb` | 326 | 326 | the funder spends the loan key without carrying it on, and keeps its satoshis |  |

Amounts:

- Borrowing thread: in period 10471 already (lock height 333392); the loan's interest starts there
- Debt: 100.00 PUSD
- Collateral: 62,927,910 sat: 125% of the debt at the lowest stored price $198.64 when the run started, 125% at the price named, $198.64, at which the contracts take it (their least there: 55,376,561 sat); Paryon's fee 125,855 sat, kept by Paryon
- Closing: the loan held 63,026,410 sat and a debt of 100.00 PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed
- Funder: 159,935,911 sat before the run, 159,794,242 sat after it
- Cost of the run: 141,669 sat: Paryon's borrowing fee 125,855 sat, network fees 13,711 sat for the 13 transactions above, and 2,103 sat otherwise (the fees of the payments of the funder and of the recoverer's balance, which are not among the transactions above, and 1,500 sat for each interest payment someone else made on the loan while it was open; the interest itself was 0; anything another run paid from the same key meanwhile would be here too)

Also observed:

- Before starting: Paryon's deployment `chipnet-fast-periods-6` showed 10 Borrowing threads (periods 10471), 5 price threads ($198.64), 5 loan key factories and 25 manage functions, at the tip 341883 (the period of the highest height a lock time may name: 10471). The funding address held 159,935,911 sat: enough for 62,927,910 sat of collateral, 125% of the debt at the lowest stored price $198.64, Paryon's fee 125,855 sat at $198.64, and 1,000,000 sat left there. The template sent is the frozen one, `aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be`.
- Making a loan key: the wallet showed the page's request with its own figures: it gives 63,203,765 sat, gets 63,200,967 sat, 2,000 sat go into the application, the fee is 798 sat; Paryon's coins spent: "Paryon's key factory"; to the wallet: left over; it asks for the user's tick: a token made from the wallet's coin leaves to "The new loan key, waiting"; it records nothing; the template is shown with no declaration.
- Making a loan key: the page's request, as it travelled: {"templateAction":"createKey","variables":{},"creates":"keyCategory","inputs":{"factoryInput":"d43c67110ac92f66c73c4df5e6644ddc606a665a087723fb182076f87cbbcca8:1"},"page":"https://loan.example/"}.
- After the key was made the wallet holds 0 position record: the key is in Paryon's contract, not in the wallet, and the wallet follows nothing there.
- The Borrowing thread was not brought up to date: the thread the page takes, the one with the largest supply of the deployment's 10, was in period 10471 already, that of the highest height a lock time may name (333392, period 10471). The template's action "Bring Paryon up to date" (`movePeriod`) was therefore not needed.
- Borrowing: the wallet showed the page's request with its own figures: it gives 63,200,967 sat, gets 146,123 sat, 63,052,765 sat go into the application, the fee is 2,079 sat; Paryon's coins spent: "Paryon's borrowing contract", "Paryon's price contract", "The new loan key", "The loan key's proof of origin"; to the wallet: receive, receive, left over; tokens +10000; destroyed: "The loan key's proof of origin" (not carried on, the application's); it records a position; the template is shown with no declaration.
- Borrowing: the page's request, as it travelled: {"templateAction":"borrow","variables":{"keyCategory":"dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324","borrowingSupply":"922337203685457580","borrowingCommitment":"e7280000","priceCommitment":"00aa8d1d00984d0000","debt":"10000","collateral":"62927910","loanCommitment":"0110270000000000000000000000e728000000000000000000ff7f","borrowingFee":"125855","startingInterest":"0000","interestManagerConfiguration":"000000ff7f"},"bindings":{"keyHolder":"receive","tokensHolder":"receive"},"inputs":{"borrowingInput":"1fb0ab174cd1292fb9876b163b945000e180124a1b507543c58ad94a85605848:0","priceInput":"c829f2837f19faede083d974fae68493c35b0f2622092662f7dda65fd37f6e1e:0","enforcerInput":"83dacd056dcf3f0a75efb2518c3f92da94332def249de0ea1fafa8344c384d8c:2","proofInput":"83dacd056dcf3f0a75efb2518c3f92da94332def249de0ea1fafa8344c384d8c:3"},"page":"https://loan.example/"}.
- The earlier device holds 1 position record, written when the key reached the wallet: the key dc7b9e6db839… (minting, commitment ""), the template, no script (the loan is at Paryon's shared contracts), the values keyCategory, borrowingSupply, borrowingCommitment, priceCommitment, debt, collateral, loanCommitment, borrowingFee, startingInterest, interestManagerConfiguration, and the page's address https://loan.example/.
- The earlier device keeps 1 template, Paryon's, with no declaration.
- The wallet answered the page's positions request (version 2): {"trusted":true,"positions":[{"category":"dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324","commitment":"","capability":"minting","satoshis":"1000","status":"held"}]}. Whether the loan is open the page finds out itself.
- The page found the loan from the key, through its sidecar: the loan at 91bcdc44e7bd5a87…:2 with 62,927,910 sat, debt 100.00 PUSD; the sidecar at …:3.
- Adding collateral: the wallet showed the page's request with its own figures: it gives 145,123 sat, gets 43,208 sat, 100,000 sat go into the application, the fee is 1,915 sat; Paryon's coins spent: "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function"; to the wallet: return, left over; it records nothing; the template is shown with no declaration.
- Adding collateral: the page's request, as it travelled: {"templateAction":"manage","variables":{"keySatoshis":"1000","priceCommitment":"00aa8d1d00984d0000","interestManagerConfiguration":"000000ff7f","collateral":"63027910","loanCommitment":"0110270000000000000000000000e728000000000000000000ff7f"},"bindings":{"keyHolder":"return"},"about":{"category":"dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324","spent":true},"inputs":{"priceInput":"1e210a15532a366b8a2e12e80e1fc56b6f742dbe935405effcee686e760ff3a8:0","loanInput":"91bcdc44e7bd5a87a94bfc84a20cb90de1abfccaa421ae6c8641f17b81000938:2","sidecarInput":"91bcdc44e7bd5a87a94bfc84a20cb90de1abfccaa421ae6c8641f17b81000938:3","manageInput":"c669c8b4d81b0d2e83b21e3eb2c5ea960664f39c6b75ee9d9116c58619f881d0:1"},"page":"https://loan.example/"}.
- The old device holds the loan key and 100.00 PUSD at its addresses, and 115,481 sat without tokens; the loan holds 63,027,910 sat. Then the device is lost, with the loan open.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 2 records of the earlier archive into its own.
- The new device read the record of the key from a store, the earlier seed's, a suggestion; the backup held Paryon's template as the earlier owner stored it, with no declaration.
- The user trusted the template "ParyonUSD loan (chipnet-fast-periods-6)" the earlier owner stored, on the user's word.
- The check of section 10.4 found that the record counts: The record names no script: it ties the token to its template, and the application says where the position stands.
- The record was written again as the new owner's own on the stores (1 record); it names no script, so nothing was handed to the engine (0 scripts).
- The new device lists the key from the record: "held", a record of its own, under the template "ParyonUSD loan (chipnet-fast-periods-6)", the key at an address of the new seed; whether the loan is open is the page's to say.
- From its own list the wallet offers 0 actions for the key and shows it with "Open the application to do this" and the page's address from the record (https://loan.example/); asked to close the loan by itself it answers: "Open the application to do this: https://loan.example/. It needs "Price", "Loan record", "Interest manager", which only the application gives." (the page: https://loan.example/).
- The page on the new phone asked which keys of its template the wallet holds: not answered, since the template came from the backup and this page has not been allowed yet.
- Once the user allowed the page, the wallet answered [{"category":"dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324","commitment":"","capability":"minting","satoshis":"1000","status":"held"}]; the page found the loan from the key: 63,026,410 sat, debt 100.00 PUSD.
- Closing the loan on the new phone: the wallet showed the page's request with its own figures: it gives 2,000 sat, gets 63,027,560 sat, -63,027,410 sat go into the application, the fee is 1,850 sat; Paryon's coins spent: "Paryon's price contract", "The loan", "The loan's sidecar", "Paryon's manage function"; to the wallet: receive, left over; tokens -10000; destroyed: "PUSD repaid" (data output, the wallet's), "The loan's record" (data output, the application's), "The loan's sidecar" (not carried on, the application's); it records nothing; the template is shown with no declaration.
- Closing the loan on the new phone: the page's request, as it travelled: {"templateAction":"close","variables":{"keySatoshis":"1000","priceCommitment":"00b48d1d00bf4d0000","interestManagerConfiguration":"000000ff7f","loanCommitment":"0110270000000000000000000001e828000000000000000000ff7f","repayAmount":"10000"},"bindings":{"keyHolder":"receive"},"about":{"category":"dc7b9e6db839f9aef3b46b9c0e868597331453de2b9feaf4171148f00a3b0324","spent":true},"inputs":{"priceInput":"5af284cf205a2d531c8d43ce7abba6695e0a659473b2218e413038b9a5047c25:0","loanInput":"15f6eae0aa121130a194fb5cbde12c2eb79e0c45d3cdcc52915da82231d0568a:1","sidecarInput":"15f6eae0aa121130a194fb5cbde12c2eb79e0c45d3cdcc52915da82231d0568a:2","repayInput":"1a286be3172fe5e0356b6d14e2ff7cc75a18dc9902e38bc9d6c9e6336483f9c1:65"},"page":"https://loan.example/"}.
- After closing, the page finds no loan for the key; the key is still in the wallet (true); the wallet holds no PUSD. The new device keeps 1 template, Paryon's, with no declaration.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 159935911 satoshis before the run and holds 159794242 after it. Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses, and no loan.
