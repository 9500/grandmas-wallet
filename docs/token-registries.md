# Token names and units from registries (BCMR)

Design and implementation notes for stage 19 of the [implementation plan](../IMPLEMENTATION_PLAN_v0.6.md). Written on 20 November 2026. Built on 21 November 2026 on the branch `token-registries`, with the decisions of section 8 taken as recommended; section 10 says where building differed from what is written here.

When this was written the wallet showed a fungible token by its category and in raw units: 100.00 PUSD read "10,000 units" of "a token of unknown meaning" (proposal section 13.3, decision 25). This document says how the wallet can show "100.00 PUSDTEST" instead, from what the token's issuer has published, without trusting anyone for it and without learning anything about any application.

## 1. What a registry is

[Bitcoin Cash Metadata Registries](https://cashtokens.org/docs/bcmr/chip) (BCMR) is the convention wallets on Bitcoin Cash use for this. The specification is version 2.0.0, a draft last revised on 26 May 2023; Cashonize, Selene and Paytaca implement it. What the wallet needs of it:

- **A registry** is a JSON file. Its `identities` are keyed by an **authbase**, a transaction identifier, and hold dated **snapshots**. A snapshot has a `name`, and for a token a `token` with `category`, `symbol` and `decimals` (0 to 18, 0 when absent). 12345 with `decimals` 2 is written "123.45 SYMBOL".
- **For a token, the authbase is its category.** A category is the identifier of the transaction whose output 0 the creating transaction spent. That is a rule of the chain, not a convention.
- **The authchain** starts at the authbase and follows output 0: the transaction that spent it, then the one that spent that transaction's output 0, and so on. The last one, whose output 0 is unspent, is the **authhead**. Whoever can spend that output controls the identity.
- **A publication** is an output on an authchain transaction: `OP_RETURN <'BCMR'> <hash> <uri> …`, locking bytecode starting `6a0442434d52`. The hash is the SHA-256 of the registry file. A URI without a scheme is HTTPS; a bare domain means `https://<domain>/.well-known/bitcoin-cash-metadata-registry.json`. If a transaction has several such outputs, the first counts.
- **The file is authenticated by the hash**, so it may be fetched from anywhere. The specification requires registries served over HTTPS to allow requests from any origin.
- **Which snapshot is current:** the one with the latest timestamp that has been reached; if none has, the oldest.

So for any token there is a chain of evidence from the category to the issuer's own words: category → authchain → publication → file with that hash → `identities[category]`. It proves that the holder of the identity output published this name. It does not prove that the name is honest: anyone can create a token and call it "USD".

## 2. What was tried

On 20 November 2026 the chain of evidence was followed by hand for the demonstration's own token, PUSD on Paryon's chipnet deployment (category `e7979ccd…e6b8`), with a script of 40 lines against a public Electrum server:

| Step | Result |
| --- | --- |
| Authchain | 3 transactions. The authbase's output 0 was spent; its script has 254 history entries, among which the spender has to be found |
| Publication | On the second and the third (the authhead): hash `dc40ba13…4389`, URI `chipnet-fast-periods-6.paryonusd.com` |
| File | 6,636 bytes from the well-known path, served with `access-control-allow-origin: *` |
| Hash | The file's SHA-256 is the published hash, byte for byte as the output carries it |
| Content | name "ParyonUSD (chipnet-fast-periods-6)", symbol `PUSDTEST`, decimals 2; the same category also has parsable NFT types (price, loan) |

The same category was looked up at the index Cashonize uses on chipnet (`bcmr-chipnet.paytaca.com/api`). It answered with the same name, symbol and decimals, and allows requests from any origin. The registry file as that index serves it hashes to another value than the chain's, so the index's copy cannot be checked against the chain: it re-writes the file.

## 3. What other wallets do

Read from their sources on 20 November 2026.

| | Cashonize (MIT) | Selene (BSD 3-Clause) |
| --- | --- | --- |
| Where a token's name comes from | An index, one request per category: `<index>/tokens/<category>/`, and `…/<commitment>/` for an NFT. Default Paytaca's, one for mainnet and one for chipnet; the user can choose another | A registry shipped with the application, then `bcmr.paytaca.com/api/registries/<authbase>/latest`; when that file names an authbase as its own identity, the authchain is walked over Electrum and the file is fetched from the published URI and checked against the hash |
| Checked against the chain | Not for token names. Yes for its identities page, which resolves authchains (Chaingraph, or Electrum link by link, stopping at ten links) and hashes every file it acts on | Only on the authchain path |
| Kept | In the wallet's store while it is open; whether it outlasts a restart was not read | The registry files and a table of category, symbol, decimals; fetched again after seven days |
| Without metadata | Shown without a name | "Token" with the first six characters of the category, 0 decimals |
| Icons | From the issuer's host or an IPFS gateway at display time; a setting turns them off | Downloaded once and kept on the device |
| Privacy | Its notes say plainly that an index learns the tokens the wallet looks up and an issuer's host learns who shows its icon | A setting turns resolution off |

Two things carry over: Cashonize's Electrum walk, with its limits (a few requests per link; a link at a busy address is slow or unresolvable), and Selene's check of the downloaded file against the hash on chain.

## 4. What this wallet requires

1. **The chain is the check.** A name, symbol or number of decimals is shown only when the file it comes from hashes to what the token's authchain publishes. This is the rule position records already follow (proposal section 10.4). A wrong number of decimals would misstate every amount by a power of ten, so an unchecked source is not good enough for it.
2. **It is the issuer's claim, and is shown as one.** Like a template's words, a registry's words were chosen by someone else. The raw amount and the category stay one tap away, behind the "?".
3. **Nothing rests on it.** Registry data changes what is written on the screen and how a typed amount is read. It never enters a transaction, a position record, a finding, the check of a record, or an answer to an application.
4. **A template outranks a registry for a position's token.** An NFT that a position record ties to a trusted template keeps the template's name ("Jar key · Savings Jar").
5. **The wallet knows no application and no token.** No built-in list of tokens. The rule is the same for every category.
6. **Typed amounts are exact.** An amount typed in the token's units is read without rounding; one with more decimal places than the token has is refused, as now.
7. **A new phone shows the same.** After a recovery the names come back without the user doing anything.
8. **Privacy is stated.** Who learns what from a lookup is written down (section 6), and resolution can be turned off in the configuration.
9. **Chipnet and mainnet alike,** from configuration, with the pages' content policy kept as tight as the choice in section 8 allows.

## 5. Design

### 5.1 Resolving a category

For each category the wallet holds, and each category in an action it is asked to review:

1. **Walk the authchain** from the transaction whose identifier is the category, over the Electrum servers the wallet already uses. For a link: read the transaction; if its output 0 is unspent, it is the authhead; if output 0 is a data output, the identity is burned and nothing is shown; otherwise read the history of output 0's script from the link's height on and find the transaction that spends output 0.
2. **Limits.** At most 10 links in one pass and 1,000 history entries at one link. A chain that is longer, or that passes an address busier than that, is left unresolved, never resolved at a link that is not its head. The wallet keeps the last link it reached and goes on from there next time, so a long chain is resolved over several passes.
3. **Take the publication** of the latest link that has one: the first output whose script starts `6a0442434d52`. Read its pushes: the hash must be 32 bytes; the rest are URIs as UTF-8.
4. **Fetch the file** from the URIs in order until one gives bytes whose SHA-256 is the hash. `https` is supported, and `ipfs://` through the gateway the configuration names; no scheme means HTTPS; a host without a path means the well-known path. The request sends no credentials and no referrer, follows redirects, stops at 2 MB or 10 seconds. A file with another hash is discarded.
5. **Read it.** `identities[category]` must exist. Take the current snapshot. Its `token.category` must be the category; `token.symbol` must match `^[A-Z0-9]+[-A-Z0-9]*$`; `decimals` must be a whole number from 0 to 18. Anything else: nothing is shown for this category.
6. **Keep the result** on the device: the name, symbol, decimals, the names of NFT types keyed by commitment (section 5.4), and where it came from: authhead, publishing transaction, hash, URI.

A file is fetched once per hash. Nothing is fetched again on a timer, because the hash fixes the content.

### 5.2 Staying current

On opening the wallet and on "Read again", the wallet asks for each kept category whether the authhead's output 0 is still unspent: one request. If it was spent, the walk goes on from there, and a new publication replaces the kept result. A category that could not be resolved (no publication, host down, wrong hash, limits reached) is tried again once per session.

Snapshots with a future date, and the gradual migrations the specification describes, are not announced in the first version: the wallet shows the snapshot that is current when it looks. Only the English registry is read, not `locales`.

### 5.3 What the screens show

| Where | Without a registry (as now) | With a checked registry |
| --- | --- | --- |
| A fungible balance | "Fungible tokens", "10,000 units", the short category | "100.00 PUSDTEST" and the name; behind the "?": that the issuer chose the name and published it on chain, the full name, the raw amount, the category |
| Sending | An amount in raw units | An amount in the token's units, read with its decimals; the review shows "100.00 PUSDTEST" and, behind the "?", the raw amount |
| The review of an application's action | Chips with raw units and the category | Chips with the amount in the token's units and its symbol |
| An NFT of a position | The template's name | Unchanged |
| Another NFT | "An NFT of unknown meaning" | The registry's name for the NFT type where there is one (section 5.4), else the token's name |

Rules of writing:

- **Symbol:** the part before the first hyphen, as the specification says for a current snapshot.
- **Name:** its first line, cut at 20 characters in lists and shown whole behind the "?". Control characters are removed; it is plain text, never markup.
- **Two held categories with the same symbol** are each shown with their short category beside the symbol.
- **A reserved symbol** (the specification's two lists: ISO 4217 currency codes, and the hundred largest cryptocurrencies at its publication, `BCH` and `USD` among them) is not shown: the token stays "unknown". See decision 4.
- **The figures of a review are those known when it opens.** A registry that resolves while a review is open does not change what the user is looking at.

No icons in the first version (decision 3).

### 5.4 NFTs

A registry describes NFTs in two ways. **Sequential:** the commitment itself is the key of a type with a name. **Parsable:** a short program in the registry is run on the commitment and its results name the type and its fields; PUSD's loans are of this kind. The first version reads sequential types only. Parsable ones need the virtual machine run as the specification's parsing transaction describes, which libauth can do; it is left for later, since the wallet's own way to say what an application's NFT is, the position record and the template, already covers the two applications.

### 5.5 Backup and recovery

Registry results are not written to the backup. They are public, and a new phone resolves them again for the tokens it sweeps, with the same check. Until it has, the tokens show in raw units. This keeps the sealed archive to what cannot be had again.

### 5.6 Configuration

One entry in the pages' configuration file:

```json
"registries": { "mode": "chain", "ipfsGateway": "https://<gateway>/ipfs/" }
```

`mode` is `chain` or `off`; without the entry it is `off`. `deploy/serve.mjs` derives the wallet page's connection policy from it (decision 2). The recoverer's page shows no token names and needs nothing.

## 6. Who learns what

| Party | Without registries | With `chain` |
| --- | --- | --- |
| The Electrum servers | Every address of the wallet | The same, and which categories' authchains it reads; they already see the tokens at its addresses |
| The issuer's host (or the IPFS gateway) | Nothing | The network address of a browser that fetched the registry file, once per publication. Not the wallet's addresses or amounts. Through a fetch helper (decision 2), the helper's address in place of the browser's |
| An index (Paytaca's) | Nothing | Nothing; none is used |

For comparison, a wallet that asks an index learns nothing from the chain and tells the index every category it holds, from its own network address.

## 7. Implementation

All on the branch `design-3`.

| Part | Where | What |
| --- | --- | --- |
| Reading a publication output; validating a registry; choosing the snapshot; symbol rules; the reserved lists | `packages/core/src/token-registry.ts`, new, pure | No network, no chain. Tested with the specification's four example registries (CC0) and made-up ones |
| The authchain walk | `packages/app/src/token-registry.ts`, new | Uses the wallet's chain access as it is: a transaction, a script's unspent coins, a script's history. Keeps its progress |
| Fetching a file | The same module, with the fetch handed in | The pages hand in the browser's `fetch`; tests hand in files in memory. A fetch helper would be handed in the same way |
| What is kept | The wallet's device state, beside its kept templates | `{ category, name, symbol, decimals, nftTypes, source, checkedAt }` or `{ category, unresolved: reason, reachedLink }` |
| The wallet's token list | `HeldToken` in `packages/app/src/applications.ts` | Gains `registry?: { name, symbol, decimals, nftType? }`; `tokens()` fills it from what is kept and never waits for a resolution |
| Screens | `apps/wallet/src/token-words.tsx`, `token-stake.ts`, `Send.tsx`, `ActionReview.tsx`, `Apps.tsx` | Section 5.3. `formatUnits` and `parseUnits` already take decimals |
| Configuration and policy | `packages/ui` configuration, `deploy/serve.mjs`, `deploy/config/*.json` | Section 5.6 |
| The local node | The loan course's local deployment | Publishes a registry for the locally deployed PUSD, so that the browser course shows "100.00 PUSD…" |

Tests, numbered in the proposal's section 21 when the stage starts:

| | Case | Expected |
| --- | --- | --- |
| TR01 | A category whose authchain publishes a registry whose file has the published hash | Name, symbol and decimals are kept and shown |
| TR02 | The file has another hash; the host is down; the file is too large | Nothing is shown; raw units; tried again next session |
| TR03 | The registry's `token.category` is another category's; its symbol breaks the rule; decimals of 19 | Nothing is shown |
| TR04 | A second publication later on the authchain | The new one replaces the kept result after the next look |
| TR05 | An authchain of 25 links; a link at a script with 5,000 history entries | Resolved over three passes; left unresolved, never at a link that is not the head |
| TR06 | A burned identity | Nothing is shown |
| TR07 | Snapshots in the past and the future | The latest one reached; the oldest when none is reached |
| TR08 | A typed amount with the token's decimals; with too many decimal places | The exact raw amount is sent; refused |
| TR09 | Two held categories with the same symbol; a reserved symbol | Shown apart with their categories; not shown |
| TR10 | An NFT of a position whose category also has a registry | The template's name |
| TR11 | A registry resolves while a review is open | The review does not change |
| TR12 | After a recovery | The new device resolves again and shows the same; nothing of it was in the backup |
| TR13 | Wallet code searched for a token's category or symbol | None |
| TR14 | `mode` off or absent | No request beyond today's; raw units |
| TR15 | A review of an action that brings a category the wallet does not hold: its registry resolves within the bound; it takes longer; the category is already resolved or known to have none | The review opens in the token's units; it opens in raw units after the bound and does not fail; no request and no wait |

**Done when** these pass on the simulated chain, the loan course in browsers on the local node shows the borrowed amount in the token's units, and on chipnet the public wallet shows PUSD as "PUSDTEST" with two decimals.

## 8. Decisions

| No. | Decision | Recommended | The alternative, and what it costs |
| --- | --- | --- | --- |
| 1 | **Where names come from** | The chain: authchain, publication, file checked against the hash (sections 4 and 5) | An index, as Cashonize does: one request per category and about half the work, but unchecked, and the index learns the wallet's tokens. A wrong answer misstates amounts |
| 2 | **How the wallet's page reaches the issuer's file.** The page may connect only to hosts its policy lists, and an issuer's host is not known beforehand | Allow the wallet page to connect to any HTTPS host, for registry files only in the code. Simple; it loosens one line of the page's policy, which today would stop an injected script from sending data to an arbitrary host | A fetch helper beside the backup stores, which fetches a URL and returns the bytes: the policy stays as it is and the issuer sees the helper, not the user. It is a server that fetches addresses it is given and must be hardened against being pointed at private ones |
| 3 | **Icons** | None in the first version | Shown: each is one more request to a host the issuer chose, the image policy has to open to any host, and SVG from strangers needs care |
| 4 | **Reserved symbols** | Not shown, by the specification's two lists | Shown like any other: a token calling itself `BCH` or `USD` then appears under that name |
| 5 | **NFT types** | Sequential in the first version, parsable later | Both at once: the virtual machine run and field formatting, perhaps two days more |
| 6 | **In the backup?** | No; resolved again on a new phone | Kept as a sealed record: names appear at once after a recovery, at the cost of a new record kind |
| 7 | **On or off** | On for chipnet in the public configuration; `off` when the entry is absent | A switch in the wallet's own screens, which the wallet otherwise avoids |
| 8 | **When** | After the chipnet runs of stage 17, before mainnet by configuration (stage 20), since mainnet is where a wrong unit costs something | — |

## 9. What stays out

- Publishing a registry for this project's own tokens. A Savings Jar's key has a category of its own for every jar, so no registry can name it; the template does.
- Holding or protecting an identity output, which Cashonize's identities page does.
- Registries found by a domain name alone, without a publication on chain, and registries imported by hand.
- Notices about planned changes of a token's name or decimals; other languages; the `chains` part of a registry.

## 10. As built (21 November 2026)

| Part | Where |
| --- | --- |
| Publication, file, snapshot, symbol rules, the reserved lists (taken from the specification's repository on 21 November 2026) | `packages/core/src/token-registry.ts` |
| The walk, the fetch, what is kept, what the screens are given | `packages/app/src/token-registry.ts` (`TokenRegistries`, `httpRegistryFetch`, `shownRegistry`); `HeldToken.registry` in `applications.ts` |
| Screens | `apps/wallet/src/token-words.tsx` (`TokenNames`, `tokenUnits`, `IssuerClaim`, `frozenNames`), `token-stake.ts`, `Apps.tsx`, `Send.tsx`, `ActionReview.tsx`; wired in `connections.ts` and `OwnerApp.tsx` |
| Configuration and policy | `registries` in `packages/ui/src/environment.ts`; `"registries": { "mode": "chain" }` in `deploy/config/production.json` and `local.json`; one line in `deploy/serve.mjs` |
| Tests | TR01 to TR12, TR14 and TR15 in `test/token-registries.test.ts`, TR13 in `test/wallet-knows-no-application.test.ts`; the screens in `scripts/registry-screens.ts`; the check against chipnet in `scripts/registry-check.ts` |
| The local node | `localRegistry` and the `registry` parameter of `packages/paryon/src/local-deployment.ts`; `scripts/stage-17-loan-browser.ts` serves the file as an IPFS gateway would |

Where building differed from sections 5 to 7:

- **Staying current costs two requests, not one:** the authhead's transaction is read again for the script of its output 0, then that script's unspent coins. Keeping the script would make it one.
- **What is kept** is in the wallet page's own storage under its own name (`registries`), not beside the kept templates: the templates' state is the applications', and keeping the two apart keeps registry data out of everything that is written to the backup.
- **The categories of a review are looked up before it opens, for at most 4 seconds.** A review shows the names known when it opens (TR11). So before it opens, for a request from an application's page and for an action started from the wallet's own list alike, the wallet looks up each category the review will write that nothing is kept of yet on the device, those coming to the wallet and those leaving it, and opens the review when that has ended or after 4 seconds, whichever comes first, with what is not resolved by then in raw units. Meanwhile the wallet shows its ordinary waiting state for the request. A category already resolved, or found to have no registry, costs no request and no wait; a lookup that fails or is slow never stops a review. A lookup still under way when the review opens goes on and is kept. At the first borrowing, PUSD is therefore in the token's units in the review (TR15). A category that the action itself makes from the wallet's coin is looked up too, before it exists, and is kept as having no registry until the next session.
- **The content policy** opens `https:` on the wallet's page only, which `deploy/serve.mjs` tells by the folder it serves (`wallet` or `wallet/dist`), and the origin of `ipfsGateway` where one is configured. A local run uses that to serve its registry as a gateway would.
- **Two held categories with the same symbol** need nothing more on the token list and the Send screen, which write the short category beside every token; `HeldToken.registry.sameSymbol` marks them for any screen that does not.
- **The registry's name is cut at 20 characters** in lists only; the "?" gives it whole, with the raw amount and the category.
- **Resolving PUSD on chipnet** from nothing took 1.4 seconds: 35 transactions read (most of them at the authbase's busy output script, in search of its spender), 2 histories, 3 lists of unspent coins and one file of 6,636 bytes.
- **On the local node** the loan course in browsers (`scripts/stage-17-loan-browser.ts local`, record in `docs/runs/stage-19-registry-loan-local-node.md`) listed the borrowed PUSD as "100.00 PUSDLOCAL" on the owner's phone, again on the new phone after the recovery, which resolved it afresh, and in the review of the closing.
