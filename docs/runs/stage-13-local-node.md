# Stage 13 run on the local node: a position found again from its record (PR03)

Written by the run itself (`scripts/stage-13-run.ts`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template and recovery declaration, as texts; every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent. The backup stores are two directories of the run, read and written as a store server's are.

- Wallet identity: `2a95815269f1eac791dd8ff32270e75e2f7564b948a3d160ac0d78ea346ef39f`
- Jar key (token category): `c7cbe5976d592f2ce9d79d52dc2672656c709317d643c052918b9f41d8f63b6e`; the jar's date: 2026-11-20T15:54:09.000Z
- Template "Savings Jar" `04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c`
- Repository at commit `b4ce9be`
- Started 2026-11-20T15:28:25.225Z

The position record the earlier device wrote before the opening was signed, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "c7cbe5976d592f2ce9d79d52dc2672656c709317d643c052918b9f41d8f63b6e",
  "commitment": "216d006b",
  "capability": "none"
 },
 "templateIdentifier": "04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c",
 "lockingScriptIdentifier": "savingsJarLockingScript",
 "roleIdentifier": "saver",
 "variables": {
  "keyCategory": "c7cbe5976d592f2ce9d79d52dc2672656c709317d643c052918b9f41d8f63b6e",
  "unlockTime": "1795190049"
 },
 "values": {
  "savedSatoshis": "30000",
  "unlockTimeBytes": "216d006b"
 },
 "applicationPage": "https://jar.example/"
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `618f570296288fe36ff31895f6407d1a1fe3e4114b1a19e693394f1a3afad271` | 343 | 343 | the controller and the rest | create (Grandma's Wallet controller) |
| open the jar | `677ce67be30a9db8f53fee201be9134331921a27d98fc5140c371fb3c94aa96f` | 477 | 477 | an action of the application's template: 30,000 satoshis into the jar, the key to a fresh address of the wallet; its record was on both stores before the engine signed | open (Savings Jar) |
| request | `38b86c32af50723f300839c6f4067641d9bae803d0a7d9de3229d0489935db98` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | pay (Grandma's Wallet actions) |
| complete | `d234a10e822fc13e429b4d4944f6acd8f6a386b6190196dba1a0dabeb455f4fa` | 970 | 970 | after the waiting period; no coin has moved | pay (Grandma's Wallet actions) |
| sweep | `8c77f4dd459323b68dc928d896fb78557eabbf880cb3b3ee4ed32a3e5067c41e` | 1702 | 1702 | 3 coins of the earlier seed, the jar's key among them, to addresses of the new seed | approve (Grandma's Wallet controller) |
| empty the jar | `92ee3a4d43c30b36167f6e64ea55126a0beee95e70c664f2219d4688ba6ec74f` | 520 | 520 | carried out by the new device by itself, from its list of positions; no application was asked. The key and the savings to addresses of the new seed | withdraw (Savings Jar) |
| send the key on | `c97871eb0fc571c6d8cd3748b642abafb9b6113dc4ac84fac30a78ceb8bfbb08` | 719 | 719 | unchanged, to the address that paid for the run | pay (Grandma's Wallet actions) |
| close | `fff2625ebe8de92a7152cc5d471235ebb1167a73b9f4324672ccc1ea5df58c0f` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | close (Grandma's Wallet controller) |
| return the recoverer's balance | `7f97e26bcb2a01774b0fbe830c3089d5ba30d0f118758a597825141614f1f111` | 185 | 185 | what the recoverer did not use | pay (Grandma's Wallet actions) |

Also observed:

- Before the opening the wallet said that it would store the template (true) and the record of the position it leaves (true) in the backup before anything is signed.
- The earlier device holds 1 position record: the jar's script "savingsJarLockingScript" with the values {"keyCategory":"c7cbe5976d592f2ce9d79d52dc2672656c709317d643c052918b9f41d8f63b6e","unlockTime":"1795190049"}, its key c7cbe5976d59… with commitment 216d006b, and the other values unlockTimeBytes, savedSatoshis.
- The earlier device lists the jar from its own record: "open", 30000 satoshis in 1 coin(s), from a record of its own.
- The old device holds 102796 satoshis at its addresses, the jar's key among them, and 30,000 satoshis are in the jar. Then the device is lost.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 3 records of the earlier archive into its own; a record of an action that was never sent is left out.
- The new device read the record from a store. It is the earlier seed's, a suggestion; with the template not yet trusted here the jar is listed as "unconfirmed" (The record's template is not trusted on this device.), 30000 satoshis in 1 coin(s), from a record of the earlier seed.
- The user trusted the template "Savings Jar" the earlier owner stored, on the user's word.
- The check of section 10.4 found that the record counts: A transaction that paid the record's script carried its NFT, which the wallet holds. The transaction that carried the key and paid the jar: 677ce67be30a9db8f53fee201be9134331921a27d98fc5140c371fb3c94aa96f. It cost 1 history, 1 transaction(s) and 0 list of coins from the server, and the wallet's own list of coins.
- The record was written again as the new owner's own on the stores (1 record), and its script was handed to the engine with the record's values (1 script).
- The new device's engine, given the jar's script from the record, lists 1 coin there under the template 04db6aef50ad…, 30000 satoshis.
- The new device lists the jar from the record: "open", 30000 satoshis in 1 coin(s), from a record of its own; the template offers "withdraw" at the jar.
- Before emptying, the wallet's own figures: 30000 satoshis from the jar's 1 coin, a fee of 520, the key and the savings to the wallet; the position is confirmed. The withdrawal's values and the jar's coin were worked out by the route of stage 7, through the template's recovery declaration.
- After the withdrawal the jar is listed from the record as "closed", 0 satoshis in 0 coin(s), from a record of its own; the key is still in the wallet.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 1250000000 satoshis before the run and holds 1249991380 after it: the run cost 8620 satoshis in fees. Nothing is left anywhere else.
