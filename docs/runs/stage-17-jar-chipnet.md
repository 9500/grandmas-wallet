# Stage 17 run on chipnet: the Savings Jar without a declaration, through the loss of a device (PR19)

Written by the run itself (`scripts/stage-17-jar-run.ts chipnet`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, on chipnet, paid from the funding address and with everything returned to it at the end; no block was made by the run, and the waiting period and the jar's date passed on the chain's own clock. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template of version 4 alone, as a text, in the requests of the jar's page: the page's own code (`apps/jar/src/xo.ts`), connected to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels; only the relay was left out. Every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.

- Wallet identity: `dcfe1c5f5693a753215dd703de329696814f68c1f87409696220d4c68aabca42`
- Jar key (token category): `9e2d303a822ca46b906e6d51cb59cadecb96fda2788189bc93e55c2dc03d3929`; the jar's date: 2026-11-21T21:27:46.000Z
- Template "Savings Jar", version 4, `fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25`, with no declaration
- The page's address in its requests: https://jar.example/
- Repository at commit `0dd4fda`
- Started 2026-11-21T21:26:28.100Z
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `docs/runs/invitations/stage-17-jar-chipnet/`, with `index.json` naming the template, action and role of each.
- The engine ran as published, with no local change, given one server (chipnet.9500.cash), as in run B.

The position record the earlier device wrote before the opening was signed, as the new device read it from a store:

```json
{
 "kind": "position",
 "token": {
  "category": "9e2d303a822ca46b906e6d51cb59cadecb96fda2788189bc93e55c2dc03d3929",
  "commitment": "d20c026b",
  "capability": "none"
 },
 "templateIdentifier": "fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25",
 "lockingScriptIdentifier": "savingsJarLockingScript",
 "roleIdentifier": "saver",
 "variables": {
  "keyCategory": "9e2d303a822ca46b906e6d51cb59cadecb96fda2788189bc93e55c2dc03d3929",
  "unlockTime": "1795296466"
 },
 "values": {
  "savedSatoshis": "30000",
  "unlockTimeBytes": "d20c026b"
 },
 "applicationPage": "https://jar.example/"
}
```

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `82cedc32afc8877dfd53b78fbe5e0cf06adcfcfbf6f8ec7812bec71a621bb22a` | 343 | 343 | the controller and the rest | [create](invitations/stage-17-jar-chipnet/01-the-owner-s-device-create-82cedc32.json) |
| open the jar | `68fdf1bfa5306060142457db4e8bfab3441ad00e7efc134be59ff6ee9ba1abbf` | 477 | 477 | an action of the application's template, from the page's request: 30,000 satoshis into the jar, the key to a fresh address of the wallet; its record was on both stores before the engine signed | [open](invitations/stage-17-jar-chipnet/03-the-owner-s-device-open-68fdf1bf.json) |
| request | `1f49a0d7a4e180d5b1fc16065ab9ce6a2d735e8135d37f42075ebe00057aeed4` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | [pay](invitations/stage-17-jar-chipnet/04-the-recoverer-pay-1f49a0d7.json) |
| complete | `cca64a4b372228663b5cd727b14e1c1eee77ce5401e5c6ef80bf83d209f4c0d9` | 970 | 970 | after the waiting period (9 minutes); no coin has moved | [pay](invitations/stage-17-jar-chipnet/05-the-recoverer-pay-cca64a4b.json) |
| sweep | `6a2978cda20e0d55e9a17e52bc4be1a7ab73e1b78b62982fb19cb2f0abefd1ae` | 1702 | 1702 | 3 coins of the earlier seed, the jar's key among them, to addresses of the new seed | [approve](invitations/stage-17-jar-chipnet/06-the-new-device-approve-6a2978cd.json) |
| empty the jar | `140214e5d049dd0ce4b7b081c2148458b2ccb493a9a186d95255d3fb35f3daac` | 520 | 520 | carried out by the new device by itself, from its list of positions; no page, no session, no request. The key at input 0, the jar's coin after it; the key and the savings to addresses of the new seed | [withdraw](invitations/stage-17-jar-chipnet/07-the-new-device-withdraw-140214e5.json) |
| send the key on | `a2586977e13b8ffc04867dac3e8c5daf527599c50882bdbd772e39d2b5f48e61` | 719 | 719 | unchanged, to the address that paid for the run | [pay](invitations/stage-17-jar-chipnet/08-the-new-device-pay-a2586977.json) |
| close | `7f39098d8b0d32d57675763ac7b251735aac72487acd6acd33392a552b6de737` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run | [close](invitations/stage-17-jar-chipnet/09-the-new-device-close-7f39098d.json) |
| return the recoverer's balance | `ec43f3ae5c1b9ced01ee257e15d51a3bf294ea3cf2a88971916aa30923f14f4c` | 185 | 185 | what the recoverer did not use | [pay](invitations/stage-17-jar-chipnet/10-the-recoverer-pay-ec43f3ae.json) |

Also observed:

- Before the opening the page asked the wallet which jars of its template it holds (version 2): not trusted with this page yet, so nothing is reported.
- The wallet showed the page's request with its own figures: it gives 60000 satoshis, 30000 go into the jar, the fee is 477; it would store the template (true) and the record of the position it leaves (true) in the backup before anything is signed; the template is shown with no declaration.
- The page's request, as it travelled: {"templateAction":"open","role":"saver","variables":{"unlockTime":1795296466,"unlockTimeBytes":"d20c026b","savedSatoshis":30000},"page":"https://jar.example/","template":{"identifier":"fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25","contentHash":"66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c"}}; it was sent 2 times, the second time with the template's text alone, after the wallet said it did not have it. No declaration was named or sent.
- The page lists the jar from the wallet's answer and reads its balance from the chain: [{"category":"9e2d303a822c…","unlockTime":1795296466,"satoshis":"30000","status":"open"}].
- The earlier device holds 1 position record: the jar's script "savingsJarLockingScript" with the values {"keyCategory":"9e2d303a822ca46b906e6d51cb59cadecb96fda2788189bc93e55c2dc03d3929","unlockTime":"1795296466"}, its key 9e2d303a822c… with commitment d20c026b, the other values unlockTimeBytes, savedSatoshis, and the page's address https://jar.example/.
- The earlier device keeps 1 template, the jar's of version 4, with no declaration.
- The earlier device lists the jar from its own record: "open", 30000 satoshis in 1 coin(s), from a record of its own.
- The old device holds 102796 satoshis at its addresses, the jar's key among them, and 30,000 satoshis are in the jar. Then the device is lost.
- The new device's search over both seeds ended as "fully-found".
- The new device copied 2 records of the earlier archive into its own; a record of an action that was never sent is left out.
- The new device read the record from a store. It is the earlier seed's, a suggestion; with the template not yet trusted here the jar is listed as nothing.
- The backup held the template of version 4 as the earlier owner stored it, with no declaration.
- The user trusted the template "Savings Jar" the earlier owner stored, on the user's word.
- The check of section 10.4 found that the record counts: A transaction that paid the record's script carried its NFT, which the wallet holds. The transaction that carried the key and paid the jar: 68fdf1bfa5306060142457db4e8bfab3441ad00e7efc134be59ff6ee9ba1abbf. It cost 1 history, 1 transaction(s) and 0 list of coins from the server, and the wallet's own list of coins.
- The record was written again as the new owner's own on the stores (1 record), and its script was handed to the engine with the record's values (1 script).
- The new device's engine, given the jar's script from the record, lists 1 coin there under the template fde627e027ac…, 30000 satoshis.
- The new device lists the jar from the record: "open", 30000 satoshis in 1 coin(s), from a record of its own; the template offers "withdraw" at the jar.
- When the new device came to empty the jar, the chain's clock was 2026-11-21T21:35:15Z, already past the jar's date 2026-11-21T21:27:46Z: the recovery before it had taken longer than the time to the date, and no wait was needed.
- The wallet's own list offers at the jar: [{"action":"withdraw","asks":[],"needsApplication":null}].
- The action the wallet made from its own list: {"template":{"identifier":"fde627e027ac2474d28ed10f84b255c097e546720771ce264d5cc134efceff25","contentHash":"66763f90d2a808ce9eaff21a3a6c8a772c1c40dd361ba76f2306bdc46f6bea5c"},"action":"withdraw","role":"saver","variables":{},"about":{"category":"9e2d303a822ca46b906e6d51cb59cadecb96fda2788189bc93e55c2dc03d3929","spent":true},"fromWallet":{"typed":{},"script":"aa200ff7e23b80a69a15e4ca747f3b9a7491314d172992f5b423be65160f4cc2b2f487"}}.
- Before emptying, the wallet's own figures: 30000 satoshis from the jar's 1 coin, a fee of 520, the key and the savings to the wallet (receive, left over); the position is confirmed; the earliest time 1795296466. Every value came from the record (the jar's two values and the date as written on the key) or from the wallet itself (the key's address, the key at input 0); the template is shown with no declaration.
- The new device keeps 1 template, the jar's of version 4, with no declaration; it made no request to the jar's page and had no session with any application.
- After the withdrawal the jar is listed from the record as "closed", 0 satoshis in 0 coin(s), from a record of its own; the key is still in the wallet.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 159944249 satoshis before the run and holds 159935911 after it: the run cost 8338 satoshis in fees (if no other run paid from the same key meanwhile). Nothing is left anywhere else.
