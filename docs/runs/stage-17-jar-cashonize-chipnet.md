# Stage 17 run on chipnet: a savings jar opened and emptied with Cashonize on the public jar page

Written by the run itself (`scripts/jar-cashonize.ts --public`). The ordinary wallet is the Cashonize web wallet at https://cashonize.com, unmodified, as it was served on the day of the run; the page that builds every transaction is this project's Savings Jar page (`apps/jar`), the page and contract Grandma's Wallet uses. Cashonize and the page ran in one Chromium (Playwright) profile kept on disk; the page was the public one, https://jar.9500.cash/, as served (its release is noted below), with the jar's template of version 4. Every transaction was signed in Cashonize after its request was shown, and sent by the page.

- Date: 2026-11-20
- Cashonize: the page shows no version number; its main script was `/assets/index-DZ86z_Np.js`, fetched 2026-11-20
- Browser: Chromium 159.0.8154.6 (Playwright), headless
- Cashonize's chipnet wallet receives at `bchtest:qr3w7g2w9pl2dfmgxnvycp482eakq2prsq6ecxc4ae` (keys in the browser profile; its seed phrase in `.chipnet/cashonize-run-public/wallet.json`, not in git)
- Jar key (token category): `46dc97d67c9fac989491a1f52b1eb03fb0fa2820b25e31fb4f3d4a288c66fb19`; the jar's date: 2026-11-20T21:37:00.000Z
- Jar address: `bchtest:pd5x3nwjenjcvmzpyrvxyukycpr8xh0r9e0rwt8a3htagwmu0d2xygecfw9em`
- Jar page: the public page https://jar.9500.cash/, commit `cd18348` of design-3, released 2026-11-20T21:13:24Z; the record was written at commit `81242ec`
- Started 2026-11-20T21:26:35.960Z

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| fund the wallet | `46dc97d67c9fac989491a1f52b1eb03fb0fa2820b25e31fb4f3d4a288c66fb19` | 219 | 219 | 40,000 satoshis from the funding key to Cashonize's address, as output 0 |
| open the jar | `71a8806f787a0b89b80beb9b81d73578cabd90e44927bf9bd23e4aef3ac7a271` | 302 | 311 | 4000 satoshis into the jar (output 0), its key to Cashonize's address `bchtest:zpkhxs84k5yhxsz2aedz79sdnhy7dctxnu3al6vaqs` (output 1); built by the page, signed by Cashonize |
| empty the jar | `ee325255adf855ab8ffeb9fdf0c3d946e3f194954087b915caf5b58445b4ff4a` | 345 | 355 | the jar's coin and the key in one transaction; the savings and the key back to Cashonize's addresses; built by the page, signed by Cashonize |
| pay in | `fcda2de3b40b7ae941ce99ab99910e209e926fa9d1c45b78a4a96a53461c1708` | 229 | 238 | 0.00003 BCH from Cashonize's coins into the emptied jar, with the page's "Pay in" |
| empty the jar again | `02c82e2e0f8af978a391870b1a9532cf2de1ffdbb83c1f3b3f75088b0c641106` | 345 | 355 | what was paid in after the first withdrawal, with the same key |
| pay in again | `2eb4db0980ac9ea4fdb0769b4e65a2037a42ccad64f630bc329108ff6ad9b7bb` | 229 | 238 | 0.00002 BCH more |
| empty the jar a third time | `fd5540afeca788e94302fd154b9f110ed0360f725671cae854f395e68a8cb148` | 345 | 355 | the same, emptied a third time |
| return | `ba96cb33281119c6453d32875e1a73560fa3c8c91e98f7c4d7f03478508b4ffd` | 608 | 619 | Cashonize's own send with "max": its coins without tokens to the funding address |
| destroy the key | `2656dda851b5972cbe948c2e90d124f27c0e171c9c5f9decd7325512289a1f3a` | 185 | 185 | the jar's key, which opens nothing now that the jar is empty, spent with Cashonize's key from its seed phrase and not carried on; its satoshis to the funding address |

Also observed:

- Cashonize made a chipnet "development wallet" (HD, derivation m/44'/145'/0') and shows the address `bchtest:qr3w7g2w9pl2dfmgxnvycp482eakq2prsq6ecxc4ae`; its seed phrase was written to disk before it was paid.
- The funding address `bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u` held 59965827 satoshis before the run.
- The jar page shows a connection address `wiz://?p=zyx…` (a `wiz://` address) and says "Waiting for your wallet."
- Cashonize, given the address in its Connect screen, asked: "SHARE WALLET ADDRESSES WITH THIS DAPP? Connecting shares your wallet's full current and future address list (the xpub) with the dApp. The dApp can see your entire balance and transaction history, even after disconnecting. You lose the privacy of using fresh HD wallet addresses. Spending your funds still requires your approval for each transaction. Note: the dApp's name and icon are only received after connecting."
- The jar page says: "Connected to Cashonize An ordinary wallet. This page builds each transaction and your wallet signs it. Coins this page can use: 0.0004 BCH."
- With Cashonize's shared keys the page finds its coins: "Coins this page can use: 0.0004 BCH."
- From "open" on, the jar page was the public page https://jar.9500.cash/, commit `cd18348` of design-3, released 2026-11-20T21:13:24Z.
- The page's form, with 0.00004 BCH and "10 minutes" chosen: "0.00004 BCH stays in the jar until Nov 20, 2026, 10:37 PM, 10 minutes from now."
- Opening: Cashonize asked "SIGN TRANSACTION Open a savings jar with 4,000 satoshis, until Nov 20, 2026, 10:37 PM. The jar's key, a token, comes to your wallet. Origin: Savings Jar Balance Change: - 4311 sat (-$0.01) + 46dc97... NFT Full Transaction Details"; it was signed.
- The page then said: "The jar is open. Its key is in your wallet. See the transaction"
- On chain, the opening output is at the address `savingsJarScript(category, unlockTime)` gives for the key's category and date: true.
- The page lists the jar: "0.00004BCH Locked Opens on Nov 20, 2026, 10:37 PM In 10 minutes. Pay in"
- Before its date the page offers no way to empty the jar: no "Empty the jar" button; the jar shows "0.00004BCH Locked Opens on Nov 20, 2026, 10:37 PM In 10 minutes. Pay in"
- After its date, while the network's median time was still behind it, "Empty the jar" was shown but disabled; the jar showed "0.00004BCH Opening Its date was Nov 20, 2026, 10:37 PM The network takes a withdrawal once the median time of recent blocks has passed the date, in about 5 minutes. Empty the jar Pay in"
- At 21:40:50 UTC, 230 seconds after the jar's date, the page offers to empty it: "0.00004BCH Ready to empty Open since Nov 20, 2026, 10:37 PM Empty the jar Pay in"
- Emptying: Cashonize asked "SIGN TRANSACTION Empty a savings jar: 3,645 satoshis come to your wallet, after a fee. The jar's key comes back to your wallet too. Origin: Savings Jar Balance Change: + 3645 sat ($0.01) - 46dc97... NFT + 46dc97... NFT Full Transaction Details"; it was signed.
- Emptying: when the page said "The jar is emptied.", it listed the jar as "0.00BCH Empty Opened on Nov 20, 2026, 10:37 PM Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too. Pay in The jar is emptied. The savings and the key are in your wallet. See the transaction"
- Emptying: then the page lists the jar as "0.00BCH Empty Opened on Nov 20, 2026, 10:37 PM Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too. Pay in The jar is emptied. The savings and the key are in your wallet. See the transaction"
- Paying in: Cashonize asked "SIGN TRANSACTION Pay 3,000 satoshis into a savings jar that opens on Nov 20, 2026, 10:37 PM. Origin: Savings Jar Balance Change: - 3238 sat (-$0.01) Full Transaction Details"; it was signed.
- Paying in: when the page said "Paid in.", it listed the jar as "0.00003BCH Ready to empty Open since Nov 20, 2026, 10:37 PM Empty the jar Pay in Amount to pay in BCH Pay in Pay in from any wallet Close Paid in. Anyone can pay in again, at any time. See the transaction"
- Paying in: then the page lists the jar as "0.00003BCH Ready to empty Open since Nov 20, 2026, 10:37 PM Empty the jar Pay in Paid in. Anyone can pay in again, at any time. See the transaction"
- Emptying again: Cashonize asked "SIGN TRANSACTION Empty a savings jar: 2,645 satoshis come to your wallet, after a fee. The jar's key comes back to your wallet too. Origin: Savings Jar Balance Change: + 2645 sat ($0.01) - 46dc97... NFT + 46dc97... NFT Full Transaction Details"; it was signed.
- Emptying again: when the page said "The jar is emptied.", it listed the jar as "0.00BCH Empty Opened on Nov 20, 2026, 10:37 PM Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too. Pay in The jar is emptied. The savings and the key are in your wallet. See the transaction"
- Emptying again: then the page lists the jar as "0.00BCH Empty Opened on Nov 20, 2026, 10:37 PM Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too. Pay in The jar is emptied. The savings and the key are in your wallet. See the transaction"
- Paying in again: Cashonize asked "SIGN TRANSACTION Pay 2,000 satoshis into a savings jar that opens on Nov 20, 2026, 10:37 PM. Origin: Savings Jar Balance Change: - 2238 sat (-$0.00) Full Transaction Details"; it was signed.
- Paying in again: when the page said "Paid in.", it listed the jar as "0.00002BCH Ready to empty Open since Nov 20, 2026, 10:37 PM Empty the jar Pay in Amount to pay in BCH Pay in Pay in from any wallet Close Paid in. Anyone can pay in again, at any time. See the transaction"
- Paying in again: then the page lists the jar as "0.00002BCH Ready to empty Open since Nov 20, 2026, 10:37 PM Empty the jar Pay in Paid in. Anyone can pay in again, at any time. See the transaction"
- Emptying a third time: Cashonize asked "SIGN TRANSACTION Empty a savings jar: 1,645 satoshis come to your wallet, after a fee. The jar's key comes back to your wallet too. Origin: Savings Jar Balance Change: + 1645 sat ($0.00) - 46dc97... NFT + 46dc97... NFT Full Transaction Details"; it was signed.
- Emptying a third time: when the page said "The jar is emptied.", it listed the jar as "0.00BCH Empty Opened on Nov 20, 2026, 10:37 PM Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too. Pay in The jar is emptied. The savings and the key are in your wallet. See the transaction"
- Emptying a third time: then the page lists the jar as "0.00BCH Empty Opened on Nov 20, 2026, 10:37 PM Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too. Pay in The jar is emptied. The savings and the key are in your wallet. See the transaction"
- On chain the jar address holds 0 satoshis in 0 outputs; its history has 6 transactions.
- After the last withdrawal the key is still held by Cashonize: output 0 of that transaction, at `bchtest:zpewq7qlw53w9pzfvczuwn9t9tc83qmfr54alwuqd0`, is unspent and carries the key: true.
- Cashonize's Tokens screen lists the key: "All Fungible NFTs TokenId: 46dc97d67c9fac989491...8c66fb19 send info 1 Tokens"
- Before sending back, Cashonize shows a balance of 0.00037148 tBCH.
- With the funding address and "max" (0.00036529 tBCH) in its send form, Cashonize asked: "Review send 0.00036529tBCH ≈ $0.07 To bchtest:qphf9jdt…nty9q77u CANCEL SEND"
- Cashonize then said: "Transaction Sent! 0.00036529tBCH ≈ $0.07 to bchtest:qphf…q77u Transaction ID: ba96cb33…8b4ffd Link blockexplorer"
- At the end Cashonize shows a balance of 0 tBCH.
- Nothing is left at Cashonize's first 30 addresses of either chain.
- The funding address held 59965827 satoshis before the run and 59962952 after it; other runs used it meanwhile. Of the run's own: it paid Cashonize 40000 satoshis (fee 219) and got 37344 back from Cashonize's send and the destroyed key, so the run cost 2875 satoshis, the fees of its 9 transactions together being 2875.

Outcome: passed. Cashonize, unmodified, connected to the jar page and signed the opening of a jar, three withdrawals and two payments into it, each built by the page; the page offered no withdrawal before the date; the jar ends empty on chain at the address the contract gives, and the key, which opens nothing any more, was destroyed and its satoshis sent back.

## Pictures

In `docs/screens/`, at 1000×1100 as the run takes them (the jar page on a desktop beside Cashonize): `chipnet-cashonize-jar-connected` (the public jar page connected to Cashonize), `chipnet-cashonize-open-request` (Cashonize asking to sign the opening), `chipnet-cashonize-jar-ready` (the jar after its date), `chipnet-cashonize-emptied` (the page after the first withdrawal). Every picture of the run is in `.chipnet/cashonize-run-public/shots/`.
