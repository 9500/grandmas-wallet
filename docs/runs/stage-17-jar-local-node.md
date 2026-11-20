# Stage 17 run on the local node: the Savings Jar without a declaration, through the loss of a device (PR19)

Written by the run itself (`scripts/stage-17-jar-run.ts`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template of version 4 alone, as a text, in the requests of the jar's page: the page's own code (`apps/jar/src/xo.ts`), connected to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels; only the relay was left out. Every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `0a0921794417d81dc57b520a57ae2734cbc16daf4a74429ad58bf6f5d8017216`
- Jar key (token category): `9741d0576632d4798271b94321e6397ceac6b970e24c75ab7ef3569e8b28b710`; the jar's date: 2026-11-20T16:47:06.000Z
- Template "Savings Jar", version 4, `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25`, with no declaration
- The page's address in its requests: https://jar.example/
- Repository at commit `18a9212`
- Started 2026-11-20T16:31:54.111Z

The position record the earlier device wrote before the opening was signed, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "9741d0576632d4798271b94321e6397ceac6b970e24c75ab7ef3569e8b28b710",
  "commitment": "8a79006b",
  "capability": "none"
 },
 "templateIdentifier": "fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25",
 "lockingScriptIdentifier": "savingsJarLockingScript",
 "roleIdentifier": "saver",
 "variables": {
  "keyCategory": "9741d0576632d4798271b94321e6397ceac6b970e24c75ab7ef3569e8b28b710",
  "unlockTime": "1795193226"
 },
 "values": {
  "savedSatoshis": "30000",
  "unlockTimeBytes": "8a79006b"
 },
 "applicationPage": "https://jar.example/"
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `5b01cdfcf6b8f9fc3b541c619c2d4ad1e0363da8af11252de7ec69296c90ecd3` | 343 | 343 | the controller and the rest | create (Grandma's Wallet controller) |
| open the jar | `302949126d6fe5735ce7d8b716ecbc0122fb51f49728fb429657e52cc9cb325f` | 477 | 477 | an action of the application's template, from the page's request: 30,000 satoshis into the jar, the key to a fresh address of the wallet; its record was on both stores before the engine signed | open (Savings Jar) |
| request | `78663fe9738483fbc21f0f1bcf8ff5dfbb8878583224dce95be4c84dd1226efe` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | pay (Grandma's Wallet actions) |
| complete | `f1a360e100fe662875c2947b75ae849aba7183de4d856a60ff56b93bdccbf85a` | 970 | 970 | after the waiting period; no coin has moved | pay (Grandma's Wallet actions) |
| sweep | `fe55f9518ec53c1220b6f66a7104c6dcbacc1e17d11f584e205e01980b8e6d47` | 1702 | 1702 | 3 coins of the earlier seed, the jar's key among them, to addresses of the new seed | approve (Grandma's Wallet controller) |
| empty the jar | `83f896400b60bf77a8c3c093070f210921139a85d142197e305d4bb2c8c28d97` | 520 | 520 | carried out by the new device by itself, from its list of positions; no page, no session, no request. The key at input 0, the jar's coin after it; the key and the savings to addresses of the new seed | withdraw (Savings Jar) |
| send the key on | `b9dfcba2d008c1ca180583fba8b6497cc95334ffcd614607f671f846e7c86c05` | 719 | 719 | unchanged, to the address that paid for the run | pay (Grandma's Wallet actions) |
| close | `3924cbb1b75a3f00eab14c1b60750abb8c334bfa3748a84659a691ebb3a82de9` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | close (Grandma's Wallet controller) |
| return the recoverer's balance | `600f8b97122bde69c2c147c3fa5f831a2003d32e65f8c5e1d08479bb336c06e6` | 185 | 185 | what the recoverer did not use | pay (Grandma's Wallet actions) |

Also observed:

- Before the opening the page asked the wallet which jars of its template it holds (version 2): not trusted with this page yet, so nothing is reported.
- The wallet showed the page's request with its own figures: it gives 60000 satoshis, 30000 go into the jar, the fee is 477; it would store the template (true) and the record of the position it leaves (true) in the backup before anything is signed; the template is shown with no declaration.
- The page's request, as it travelled: {"templateAction":"open","role":"saver","variables":{"unlockTime":1795193226,"unlockTimeBytes":"8a79006b","savedSatoshis":30000},"page":"https://jar.example/","template":{"identifier":"fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25","contentHash":"66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c"}}; it was sent 2 times, the second time with the template's text alone, after the wallet said it did not have it. No declaration was named or sent.
- The page lists the jar from the wallet's answer and reads its balance from the chain: [{"category":"9741d0576632…","unlockTime":1795193226,"satoshis":"30000","status":"open"}].
- The earlier device holds 1 position record: the jar's script "savingsJarLockingScript" with the values {"keyCategory":"9741d0576632d4798271b94321e6397ceac6b970e24c75ab7ef3569e8b28b710","unlockTime":"1795193226"}, its key 9741d0576632… with commitment 8a79006b, the other values unlockTimeBytes, savedSatoshis, and the page's address https://jar.example/.
- The earlier device keeps 1 template, the jar's of version 4, with no declaration.
- The earlier device lists the jar from its own record: "open", 30000 satoshis in 1 coin(s), from a record of its own.
- The old device holds 102796 satoshis at its addresses, the jar's key among them, and 30,000 satoshis are in the jar. Then the device is lost.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 2 records of the earlier archive into its own; a record of an action that was never sent is left out.
- The new device read the record from a store. It is the earlier seed's, a suggestion; with the template not yet trusted here the jar is listed as "unconfirmed" (The record's template is not trusted on this device.), 30000 satoshis in 1 coin(s), from a record of the earlier seed.
- The backup held the template of version 4 as the earlier owner stored it, with no declaration.
- The user trusted the template "Savings Jar" the earlier owner stored, on the user's word.
- The check of section 10.4 found that the record counts: A transaction that paid the record's script carried its NFT, which the wallet holds. The transaction that carried the key and paid the jar: 302949126d6fe5735ce7d8b716ecbc0122fb51f49728fb429657e52cc9cb325f. It cost 1 history, 1 transaction(s) and 0 list of coins from the server, and the wallet's own list of coins.
- The record was written again as the new owner's own on the stores (1 record), and its script was handed to the engine with the record's values (1 script).
- The new device's engine, given the jar's script from the record, lists 1 coin there under the template fde627e027ac…, 30000 satoshis.
- The new device lists the jar from the record: "open", 30000 satoshis in 1 coin(s), from a record of its own; the template offers "withdraw" at the jar.
- The wallet's own list offers at the jar: [{"action":"withdraw","asks":[],"needsApplication":null}].
- The action the wallet made from its own list: {"template":{"identifier":"fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25","contentHash":"66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c"},"action":"withdraw","role":"saver","variables":{},"about":{"category":"9741d0576632d4798271b94321e6397ceac6b970e24c75ab7ef3569e8b28b710","spent":true},"fromWallet":{"typed":{}}}.
- Before emptying, the wallet's own figures: 30000 satoshis from the jar's 1 coin, a fee of 520, the key and the savings to the wallet (receive, left over); the position is confirmed; the earliest time 1795193226. Every value came from the record (the jar's two values and the date as written on the key) or from the wallet itself (the key's address, the key at input 0); the template is shown with no declaration.
- The new device keeps 1 template, the jar's of version 4, with no declaration; it made no request to the jar's page and had no session with any application.
- After the withdrawal the jar is listed from the record as "closed", 0 satoshis in 0 coin(s), from a record of its own; the key is still in the wallet.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 625000000 satoshis before the run and holds 624991380 after it: the run cost 8620 satoshis in fees. Nothing is left anywhere else.
