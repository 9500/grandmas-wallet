# Stage 17 run on the local node: the Savings Jar without a declaration, through the loss of a device (PR19)

Written by the run itself (`scripts/stage-17-jar-run.ts`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template of version 4 alone, as a text, in the requests of the jar's page: the page's own code (`apps/jar/src/xo.ts`), connected to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels; only the relay was left out. Every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `dc2bb403c5cd74c1b2caa610c72be7e1400123661b7b5cfe6fa7a0c4f4659a8c`
- Jar key (token category): `2178e90f065713f3349ec55053103e37746a589fcc5543ed4f5afa30ea7717d0`; the jar's date: 2026-11-20T17:59:48.000Z
- Template "Savings Jar", version 4, `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25`, with no declaration
- The page's address in its requests: https://jar.example/
- Repository at commit `695b20a`
- Started 2026-11-20T17:54:31.199Z

The position record the earlier device wrote before the opening was signed, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "2178e90f065713f3349ec55053103e37746a589fcc5543ed4f5afa30ea7717d0",
  "commitment": "948a006b",
  "capability": "none"
 },
 "templateIdentifier": "fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25",
 "lockingScriptIdentifier": "savingsJarLockingScript",
 "roleIdentifier": "saver",
 "variables": {
  "keyCategory": "2178e90f065713f3349ec55053103e37746a589fcc5543ed4f5afa30ea7717d0",
  "unlockTime": "1795197588"
 },
 "values": {
  "savedSatoshis": "30000",
  "unlockTimeBytes": "948a006b"
 },
 "applicationPage": "https://jar.example/"
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `6b0b0b07839fb4a7f037c70e993d9137c01c1116553fd7a5235dbd06be39e32a` | 343 | 343 | the controller and the rest | create (Grandma's Wallet controller) |
| open the jar | `45a81edeb87fadcf3945b1c2724b9ecbd62508022a8c65438c46e0ad9efee12d` | 477 | 477 | an action of the application's template, from the page's request: 30,000 satoshis into the jar, the key to a fresh address of the wallet; its record was on both stores before the engine signed | open (Savings Jar) |
| request | `1137cc4a11c022da7b7f5d95b37bb43da9e37bcf8bd4fada9bb4bcd9d5104155` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | pay (Grandma's Wallet actions) |
| complete | `648d243af55220b301e97bb9a047ea21daec6d2dc390f993dc2db447a673aa95` | 970 | 970 | after the waiting period; no coin has moved | pay (Grandma's Wallet actions) |
| sweep | `25eecf9b7a450ca97611467d69b1fc7b29299c1a985c3f9acd72c7ff92dde88b` | 1702 | 1702 | 3 coins of the earlier seed, the jar's key among them, to addresses of the new seed | approve (Grandma's Wallet controller) |
| empty the jar | `34d7ca20eee9227c6521324e48e7078aa32113a35e47f5116c59470b505539e2` | 520 | 520 | carried out by the new device by itself, from its list of positions; no page, no session, no request. The key at input 0, the jar's coin after it; the key and the savings to addresses of the new seed | withdraw (Savings Jar) |
| send the key on | `cb2710a18ab9f4ef1e9f1c94a4f33c5d75f9ac5d627b390161cbb4d914c50201` | 719 | 719 | unchanged, to the address that paid for the run | pay (Grandma's Wallet actions) |
| close | `627e1f9212d8027cc40da091d9db99fe021f92ff8a5a557cb506eade63cef678` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | close (Grandma's Wallet controller) |
| return the recoverer's balance | `723876b2a907fc14173c7aa3f7a23dcced2390611781bfe22291cc79ad95ef2a` | 185 | 185 | what the recoverer did not use | pay (Grandma's Wallet actions) |

Also observed:

- Before the opening the page asked the wallet which jars of its template it holds (version 2): not trusted with this page yet, so nothing is reported.
- The wallet showed the page's request with its own figures: it gives 60000 satoshis, 30000 go into the jar, the fee is 477; it would store the template (true) and the record of the position it leaves (true) in the backup before anything is signed; the template is shown with no declaration.
- The page's request, as it travelled: {"templateAction":"open","role":"saver","variables":{"unlockTime":1795197588,"unlockTimeBytes":"948a006b","savedSatoshis":30000},"page":"https://jar.example/","template":{"identifier":"fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25","contentHash":"66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c"}}; it was sent 2 times, the second time with the template's text alone, after the wallet said it did not have it. No declaration was named or sent.
- The page lists the jar from the wallet's answer and reads its balance from the chain: [{"category":"2178e90f0657…","unlockTime":1795197588,"satoshis":"30000","status":"open"}].
- The earlier device holds 1 position record: the jar's script "savingsJarLockingScript" with the values {"keyCategory":"2178e90f065713f3349ec55053103e37746a589fcc5543ed4f5afa30ea7717d0","unlockTime":"1795197588"}, its key 2178e90f0657… with commitment 948a006b, the other values unlockTimeBytes, savedSatoshis, and the page's address https://jar.example/.
- The earlier device keeps 1 template, the jar's of version 4, with no declaration.
- The earlier device lists the jar from its own record: "open", 30000 satoshis in 1 coin(s), from a record of its own.
- The old device holds 102796 satoshis at its addresses, the jar's key among them, and 30,000 satoshis are in the jar. Then the device is lost.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 2 records of the earlier archive into its own; a record of an action that was never sent is left out.
- The new device read the record from a store. It is the earlier seed's, a suggestion; with the template not yet trusted here the jar is listed as "unconfirmed" (The record's template is not trusted on this device.), 30000 satoshis in 1 coin(s), from a record of the earlier seed.
- The backup held the template of version 4 as the earlier owner stored it, with no declaration.
- The user trusted the template "Savings Jar" the earlier owner stored, on the user's word.
- The check of section 10.4 found that the record counts: A transaction that paid the record's script carried its NFT, which the wallet holds. The transaction that carried the key and paid the jar: 45a81edeb87fadcf3945b1c2724b9ecbd62508022a8c65438c46e0ad9efee12d. It cost 1 history, 1 transaction(s) and 0 list of coins from the server, and the wallet's own list of coins.
- The record was written again as the new owner's own on the stores (1 record), and its script was handed to the engine with the record's values (1 script).
- The new device's engine, given the jar's script from the record, lists 1 coin there under the template fde627e027ac…, 30000 satoshis.
- The new device lists the jar from the record: "open", 30000 satoshis in 1 coin(s), from a record of its own; the template offers "withdraw" at the jar.
- The wallet's own list offers at the jar: [{"action":"withdraw","asks":[],"needsApplication":null}].
- The action the wallet made from its own list: {"template":{"identifier":"fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25","contentHash":"66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c"},"action":"withdraw","role":"saver","variables":{},"about":{"category":"2178e90f065713f3349ec55053103e37746a589fcc5543ed4f5afa30ea7717d0","spent":true},"fromWallet":{"typed":{}}}.
- Before emptying, the wallet's own figures: 30000 satoshis from the jar's 1 coin, a fee of 520, the key and the savings to the wallet (receive, left over); the position is confirmed; the earliest time 1795197588. Every value came from the record (the jar's two values and the date as written on the key) or from the wallet itself (the key's address, the key at input 0); the template is shown with no declaration.
- The new device keeps 1 template, the jar's of version 4, with no declaration; it made no request to the jar's page and had no session with any application.
- After the withdrawal the jar is listed from the record as "closed", 0 satoshis in 0 coin(s), from a record of its own; the key is still in the wallet.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 5000000000 satoshis before the run and holds 4999991380 after it: the run cost 8620 satoshis in fees. Nothing is left anywhere else.
