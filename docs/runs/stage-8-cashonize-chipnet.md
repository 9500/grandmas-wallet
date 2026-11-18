# Stage 8 run on chipnet (SJ03, an ordinary wallet): a savings jar opened and emptied with Cashonize

Written by the run itself (`scripts/jar-cashonize.ts`). The ordinary wallet is the Cashonize web wallet at https://cashonize.com, unmodified, as it was served on the day of the run; the page that builds every transaction is this project's Savings Jar page (`apps/jar`), the page and contract Grandma's Wallet uses. Cashonize and the page ran in one Chromium (Playwright) profile kept on disk; the page was built from this checkout and served on 127.0.0.1:8193 by `deploy/serve.mjs` with `deploy/config/local.json` (chipnet). Every transaction was signed in Cashonize after its request was shown, and sent by the page.

- Date: 2026-11-18
- Cashonize: the page shows no version number; its main script was `/assets/index-rGcm3-xK.js`, fetched 2026-11-18
- Browser: Chromium 159.0.8154.6 (Playwright), headless
- Cashonize's chipnet wallet receives at `bchtest:qr2h2hxtjyv3n5m37r9z3x97x7n54v0x8yp3lf4wjj` (keys in the browser profile; its seed phrase in `.chipnet/cashonize-run/wallet.json`, not in git)
- Jar key (token category): `5812ab1b5b9528f4c162bf6ca0da3b2b18c8a1056775765f7342b40bd06c3c99`; the jar's date: 2026-11-18T02:58:00.000Z
- Jar address: `bchtest:pdg3yk0lpgwv9qp99pp0ulvm34zsxmhka0g02amsqz8h6z2ydw60jayc5yh7c`
- Jar page: this repository's `apps/jar`; the source each step was carried out with is noted below (the record was written at commit `f2dc80f`)
- Started 2026-11-18T02:45:28.124Z

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| fund the wallet | `5812ab1b5b9528f4c162bf6ca0da3b2b18c8a1056775765f7342b40bd06c3c99` | 219 | 219 | 40,000 satoshis from the funding key to Cashonize's address, as output 0 |
| open the jar | `61fe01668de7323e0c8811bc582d3c380cf3cb26648494c855f30e972f354074` | 302 | 311 | 4000 satoshis into the jar (output 0), its key to Cashonize's address `bchtest:zqdnzy5g94dq99wr6cj4j86a397pjhztng59mm90du` (output 1); built by the page, signed by Cashonize |
| empty the jar | `29683a24bd7fb9fa1d524cde61f1884b909c06874d5bf9a77b710050fba9daa0` | 345 | 355 | the jar's coin and the key in one transaction; the savings and the key back to Cashonize's addresses; built by the page, signed by Cashonize |
| pay in | `470390278567653daacb2a2a851969c9ac98427467cbef06e12e62c5f0e805f3` | 229 | 238 | 0.00003 BCH from Cashonize's coins into the emptied jar, with the page's "Pay in" |
| empty the jar again | `d0b8355efc230e589b8350a61cc18e22aff0aef9914a89b4ab7be522f6be771d` | 345 | 355 | what was paid in after the first withdrawal, with the same key |
| pay in again | `6e8429377fd0da9f358908ce7f5fa6a28155df7d8cc053662e4673c255dd0400` | 229 | 238 | 0.00002 BCH more, with the page rebuilt with the fixes found in this run |
| empty the jar a third time | `aa9f63e0a539599e05f3e6c1bc2a0a8a20d062b30cb138ea02702467bcf29342` | 345 | 355 | the same, emptied with the rebuilt page |
| return | `eeaef636f65077b01cc9d1dfa0ef36c80ac9c6a50250393b4bdc5832b317ca00` | 608 | 619 | Cashonize's own send with "max": its coins without tokens to the funding address |

Also observed:

- Cashonize made a chipnet "development wallet" (HD, derivation m/44'/145'/0') and shows the address `bchtest:qr2h2hxtjyv3n5m37r9z3x97x7n54v0x8yp3lf4wjj`; its seed phrase was written to disk before it was paid.
- The funding address `bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u` held 956851 satoshis before the run.
- The jar page shows a connection address `wiz://?p=u3r…` (a `wiz://` address) and says "Reaching the relay…"
- Cashonize, given the address in its Connect screen, asked: "SHARE WALLET ADDRESSES WITH THIS DAPP? Connecting shares your wallet's full current and future address list (the xpub) with the dApp. The dApp can see your entire balance and transaction history, even after disconnecting. You lose the privacy of using fresh HD wallet addresses. Spending your funds still requires your approval for each transaction. Note: the dApp's name and icon are only received after connecting."
- The jar page says: "Connected to Cashonize An ordinary wallet. This page builds each transaction and your wallet signs it. Coins this page can use: 0.0004 BCH."
- With Cashonize's shared keys the page finds its coins: "Coins this page can use: 0.0004 BCH."
- From "open" on, the jar page was built from commit `f2dc80f`, unchanged.
- The page's form, with 0.00004 BCH and "10 minutes" chosen: "0.00004 BCH stays in the jar until Nov 18, 2026, 3:58 AM, 11 minutes from now."
- Opening: Cashonize asked "SIGN TRANSACTION Open a savings jar with 4,000 satoshis, until Nov 18, 2026, 3:58 AM. The jar's key, a token, comes to your wallet. Origin: Savings Jar Balance Change: - 4311 sat (-$0.01) + 5812ab... NFT Full Transaction Details"; it was signed.
- The page then said: "The jar is open. Its key is in your wallet. See the transaction"
- On chain, the opening output is at the address `savingsJarScript(category, unlockTime)` gives for the key's category and date: true.
- The page lists the jar: "0.00004BCH Locked Opens on Nov 18, 2026, 3:58 AM In 11 minutes. Pay in"
- Before its date the page offers no way to empty the jar: no "Empty the jar" button; the jar shows "0.00004BCH Locked Opens on Nov 18, 2026, 3:58 AM In 11 minutes. Pay in"
- After its date, while the network's median time was still behind it, "Empty the jar" was shown but disabled; the jar showed "0.00004BCH Opening Its date was Nov 18, 2026, 3:58 AM The network takes a withdrawal once the median time of recent blocks has passed the date, in about 8 minutes. Empty the jar Pay in"
- At 03:05:53 UTC, 473 seconds after the jar's date, the page offers to empty it: "0.00004BCH Ready to empty Open since Nov 18, 2026, 3:58 AM Empty the jar Pay in"
- Emptying: Cashonize asked "SIGN TRANSACTION Empty a savings jar: 3,645 satoshis come to your wallet, after a fee. The jar's key comes back to your wallet too. Origin: Savings Jar Balance Change: + 3645 sat ($0.01) - 5812ab... NFT + 5812ab... NFT Full Transaction Details"; it was signed.
- Emptying: when the page said "The jar is emptied.", it still listed the jar as "0.00004BCH Ready to empty Open since Nov 18, 2026, 3:58 AM Empty the jar Pay in": the list was read again only after the outcome was shown (fixed, see "pay in again").
- Paying in: Cashonize asked "SIGN TRANSACTION Pay 3,000 satoshis into a savings jar that opens on Nov 18, 2026, 3:58 AM. Origin: Savings Jar Balance Change: - 3238 sat (-$0.01) Full Transaction Details"; it was signed.
- After paying in, the page shows "0.00003BCH Ready to empty Open since Nov 18, 2026, 3:58 AM Empty the jar Pay in Amount to pay in BCH Pay in Pay in from any wallet Close Paid in. Anyone can pay in again, at any time. See the transaction"
- Emptying again: Cashonize asked "SIGN TRANSACTION Empty a savings jar: 2,645 satoshis come to your wallet, after a fee. The jar's key comes back to your wallet too. Origin: Savings Jar Balance Change: + 2645 sat ($0.01) - 5812ab... NFT + 5812ab... NFT Full Transaction Details"; it was signed.
- Emptying again: when the page said "The jar is emptied.", it still listed the jar as "0.00003BCH Ready to empty Open since Nov 18, 2026, 3:58 AM Empty the jar Pay in" (the same as the first time).
- After the jar's date had passed, the page's "Open a jar" form, untouched since the jar was opened, showed "Choose a date in the future." in red under its date (seen on the screenshots of this run; not checked by the script). The page was changed so that a request that went ahead leaves no problem shown; the run did not open a second jar, so this change was not seen at work on chipnet.
- From "pay in again" on, the jar page was built from commit `f2dc80f` with uncommitted changes to `apps/jar/src/main.tsx`, `apps/jar/src/view.tsx` (diff f06b191bb9c1).
- Paying in again, with the rebuilt page: Cashonize asked "SIGN TRANSACTION Pay 2,000 satoshis into a savings jar that opens on Nov 18, 2026, 3:58 AM. Origin: Savings Jar Balance Change: - 2238 sat (-$0.00) Full Transaction Details"; it was signed.
- Paying in again, with the rebuilt page: when the page said "Paid in.", it listed the jar as "0.00002BCH Ready to empty Open since Nov 18, 2026, 3:58 AM Empty the jar Pay in Amount to pay in BCH Pay in Pay in from any wallet Close Paid in. Anyone can pay in again, at any time. See the transaction"
- Paying in again, with the rebuilt page: then the page lists the jar as "0.00002BCH Ready to empty Open since Nov 18, 2026, 3:58 AM Empty the jar Pay in Paid in. Anyone can pay in again, at any time. See the transaction"
- Emptying a third time, with the rebuilt page: Cashonize asked "SIGN TRANSACTION Empty a savings jar: 1,645 satoshis come to your wallet, after a fee. The jar's key comes back to your wallet too. Origin: Savings Jar Balance Change: + 1645 sat ($0.00) - 5812ab... NFT + 5812ab... NFT Full Transaction Details"; it was signed.
- Emptying a third time, with the rebuilt page: when the page said "The jar is emptied.", it listed the jar as "0.00BCH Empty Opened on Nov 18, 2026, 3:58 AM Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too. Pay in The jar is emptied. The savings and the key are in your wallet. See the transaction"
- Emptying a third time, with the rebuilt page: then the page lists the jar as "0.00BCH Empty Opened on Nov 18, 2026, 3:58 AM Emptied. The key stays in your wallet, so whatever is paid in later can be taken out too. Pay in The jar is emptied. The savings and the key are in your wallet. See the transaction"
- On chain the jar address holds 0 satoshis in 0 outputs; its history has 6 transactions.
- After the last withdrawal the key is still held by Cashonize: output 0 of that transaction, at `bchtest:zzgn49xq7tuf95dlnhargru2hp8vwvtkcc8hasre8k`, is unspent and carries the key: true.
- Cashonize's Tokens screen lists the key: "All Fungible NFTs TokenId: 5812ab1b5b9528f4c162...d06c3c99 send info 1 Tokens" (under Cashonize's notice "Savings Jar: transaction signed and returned to the dApp").
- Before sending back, Cashonize shows a balance of 0.00037148 tBCH.
- With the funding address and "max" (0.00036529 tBCH) in its send form, Cashonize asked: "Review send 0.00036529tBCH ≈ $0.08 To bchtest:qphf9jdt…nty9q77u CANCEL SEND"
- At the end Cashonize shows a balance of 0 tBCH.
- Left with Cashonize, from the chain: 1000 satoshis with a token (the jar's key) at `bchtest:zzgn49xq7tuf95dlnhargru2hp8vwvtkcc8hasre8k` (receive 6), output aa9f63e0a539599e05f3e6c1bc2a0a8a20d062b30cb138ea02702467bcf29342:0.
- The funding address held 956851 satoshis before the run and holds 60953161 after it; in between it also received 60000000 satoshis in `417dff1783def6e973c50ceac87bf50a50675381246a4420233af25a8472041e`, which are not part of this run. The run cost 3690 satoshis: 2690 in fees for its 8 transactions and the 1000 satoshis that stay with the jar's key.

Outcome: passed. Cashonize, unmodified, connected to the jar page and signed the opening of a jar, three withdrawals and two payments into it, each built by the page; the page offered no withdrawal before the date; the jar ends empty on chain at the address the contract gives, and the key stays with Cashonize.
