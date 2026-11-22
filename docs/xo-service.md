# `xo_service_v1`: a wallet and an application's service

This document specifies `xo_service_v1`, version 1. It is written for an engineer who wants to write a service or a wallet that speaks it.

`xo_service_v1` is this project's own protocol, as `xo_v1` is. It carries XO's own serialized invitations unchanged. An application's page may still start actions over `xo_v1`; this protocol is a second way in, beside it.

The reference implementation is `packages/connect/src/service.ts`, with its tests in `packages/connect/test/service.test.ts`. A service built on it is Paryon's, `apps/paryon-service`.

## What it is for

An XO template describes the actions of an application. Some actions need values or coins that only the application has: a price it sets, a contract coin many users share, the unlocking of that coin. A service is a server that supplies them. It takes part in an XO invitation as a second participant, in a role of its own.

One action goes like this:

1. The wallet starts an invitation for an action of the template. It commits the user's values and its own token.
2. The wallet sends the invitation to the service.
3. The service checks the invitation and joins it. It commits the values only it knows, the application's shared coins with their unlocking, and the application's shared outputs. It sends the invitation back.
4. The wallet checks everything the service added, adds its own outputs, a coin for the fee and its change, and builds the transaction.
5. The wallet shows the user its own figures, and signs only after the user approves.

The engine lets either side start an invitation. This protocol is the direction in which the wallet starts it.

The wallet knows nothing about the application beforehand. Everything it learns comes from the template, the chain and these messages. It trusts nothing the service says until it has checked it against the template and the chain.

## How a template names its service

An XO template may carry `resources`: a list of `{name, description, icon?, url}`. XO's parser allows no other fields and checks `url` only as a string. A resource is a service of this protocol if its name is exactly one of the following.

| Name | Meaning |
| --- | --- |
| `xo_service_v1` | The service for every network. This is the normal case. |
| `xo_service_v1:<network>` | The service for that one network. |

The normal case is one resource for every network:

```json
"resources": [
  { "name": "Documentation", "description": "How the jar works", "url": "https://jar.example/docs" },
  { "name": "xo_service_v1", "description": "The jar's service", "url": "https://jar.example/xo" }
]
```

A template that holds nothing specific to a network has the same identifier on every network, so its one service address serves them all. The `network` field of each message says which network it is about.

A template that wants a different address for a network adds a resource with the network after a colon:

```json
"resources": [
  { "name": "xo_service_v1", "description": "The loan service", "url": "https://loans.example/xo" },
  { "name": "xo_service_v1:chipnet", "description": "The loan service on chipnet", "url": "https://test.loans.example/xo" }
]
```

`<network>` is spelled exactly as the `network` field of the messages: one of `mainnet`, `chipnet`, `testnet3`, `testnet4`, `regtest`, `mockup`. Each resource is part of the template, so it is part of the template's identifier. Adding a network to such a template adds a resource and so changes the template's identifier.

The wallet's rules:

- **Exact names only.** A resource whose name is anything else is ignored: documentation links, `xo_service_v9`, `XO_SERVICE_V1`, `xo_service_v1:`, `xo_service_v1:Chipnet`, `xo_service_v1:chipnet:x`, or a network not in the list. An ignored resource is not contacted and not shown as a service.
- **The wallet's network first.** The wallet uses the resource that names the network it is on. If there is none, it uses the bare one. If there is neither, the template has no service on this network. A resource for the wallet's network stands even if its address cannot be used; the wallet does not fall back to the bare one.
- **One resource per name.** If two resources have the same full name (two bare ones, or two for the same network), the wallet uses neither. It reports the service as not usable.
- **A usable address.** The address must be `https:`, with a host, and with no user name, password, query or fragment. `http:` is allowed only when the wallet runs on a local chain of its own. A recognised resource with an address that cannot be used is reported as such. The template can still be trusted; the wallet shows "Service: address not usable".

The wallet posts to the address exactly as the template writes it.

## The carriage

There is one endpoint: the resource's `url`.

- The wallet sends `POST` with `content-type: application/json`. A browser first sends `OPTIONS` (a CORS preflight); the service answers it with HTTP 204 and the headers below.
- The body is one JSON object with one key, `xo_service_v1`, whose value is the message. The answer has the same shape.
- Every answer of the protocol is HTTP 200, refusals included.
- HTTP codes other than 200 are for failures of the carriage only. Even then the body has the same shape where possible, with `ok: false`, `error` and perhaps `code`.

| HTTP status | When |
| --- | --- |
| 200 | Every answer of the protocol, success or refusal |
| 204 | The answer to `OPTIONS` |
| 400 | The body cannot be read: not UTF-8, not JSON, not one object under `xo_service_v1`, or not a message a wallet sends, with an `id` and a `network` |
| 405 | A method other than `POST` or `OPTIONS` |
| 413 | The body is larger than 64 KiB |
| 429 | Too many messages; `retry-after` says how many seconds to wait |
| 5xx | The service failed |

Every answer carries these headers:

| Header | Value |
| --- | --- |
| `access-control-allow-origin` | `*` |
| `access-control-allow-methods` | `POST, OPTIONS` |
| `access-control-allow-headers` | `content-type` |
| `access-control-expose-headers` | `retry-after` |
| `content-type` | `application/json` (except 204) |
| `cache-control` | `no-store` |

A service never sends `access-control-allow-credentials`. The wallet's request carries no cookies, no credentials and no referrer. It follows no redirect and stores nothing in a cache. In `fetch` terms: `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`, `cache: 'no-store'`.

The service keeps nothing between messages. The same `id` sent twice is simply answered twice.

The messages do not depend on HTTP. The same objects could travel another way.

## The messages

Every message has these fields:

| Field | Meaning |
| --- | --- |
| `action` | The kind of message, with the prefix `xo_service_` |
| `version` | `1` |
| `network` | The network the message is about. An answer names the same network. |
| `id` | Chosen by the sender, at most 80 characters. The answer repeats it. |
| `time` | Unix seconds |

A template is named as in `xo_v1`: `{"identifier", "contentHash"}`, both 64 lowercase hex characters. The identifier is XO's template identifier; the content hash is the SHA-256 of the template's text.

Every answer has `ok`. With `ok: true` it carries what the table says. With `ok: false` it carries `error` (plain words, at most 200 characters) and perhaps `code` (see Errors), and nothing else.

| Message | Direction | Content |
| --- | --- | --- |
| `xo_service_hello` | wallet to service | `template`, `role`: the role the wallet takes. Nothing else about the wallet. |
| `xo_service_hello_answer` | service to wallet | `serves`: a list of `{template, role}`, the role the service takes in each template; `limits`: `{requestBytes, entries}` |
| `xo_service_possible_request` | wallet to service | `template`, `role`, `tokens`: the NFTs the wallet holds under this template; `made`: the token categories the wallet created with this template's starting actions |
| `xo_service_possible` | service to wallet | `height`: the chain height the service read; `start`: which starting actions can be carried out; `items`: what the wallet can do under its tokens |
| `xo_service_join_request` | wallet to service | `invitation`: XO's serialized invitation holding the wallet's commit; `ref`: the item the action is for, absent for a starting action |
| `xo_service_join_result` | service to wallet | `invitation`: the same invitation with the service's commit appended |

A receiver refuses a message with a field it does not know, a field of the wrong kind, a list that is too long, a text that is too long, another version or another network.

### `xo_service_hello`

The wallet asks whether the service serves this template, and in which role.

```json
{ "xo_service_v1": {
    "action": "xo_service_hello", "version": 1, "network": "chipnet",
    "id": "7f3c9a", "time": 1790000000,
    "template": { "identifier": "a1a1…a1", "contentHash": "aaaa…aa" },
    "role": "borrower" } }
```

### `xo_service_hello_answer`

```json
{ "xo_service_v1": {
    "action": "xo_service_hello_answer", "version": 1, "network": "chipnet",
    "id": "7f3c9a", "time": 1790000001, "ok": true,
    "serves": [ { "template": { "identifier": "a1a1…a1", "contentHash": "aaaa…aa" }, "role": "lender" } ],
    "limits": { "requestBytes": 65536, "entries": 32 } } }
```

`limits` are the service's own, each at most the protocol's. The wallet keeps within the smaller.

A refusal:

```json
{ "xo_service_v1": {
    "action": "xo_service_hello_answer", "version": 1, "network": "chipnet",
    "id": "7f3c9a", "time": 1790000001, "ok": false,
    "error": "This service does not serve that template.", "code": "unknown-template" } }
```

### `xo_service_possible_request`

The wallet asks what it can do with the template now.

```json
{ "xo_service_v1": {
    "action": "xo_service_possible_request", "version": 1, "network": "chipnet",
    "id": "7f3c9b", "time": 1790000002,
    "template": { "identifier": "a1a1…a1", "contentHash": "aaaa…aa" },
    "role": "borrower",
    "tokens": [ { "category": "c1c1…c1", "commitment": "01ab", "capability": "none",
                  "outpoint": "d1d1…d1:0" } ],
    "made": [ { "category": "c2c2…c2", "transactionId": "d2d2…d2" } ] } }
```

| Field | Meaning |
| --- | --- |
| `tokens[].category` | The token category, hex |
| `tokens[].commitment` | The NFT commitment, hex; empty for none |
| `tokens[].capability` | `none`, `mutable` or `minting` |
| `tokens[].outpoint` | The coin that holds the token, `<transaction id>:<output index>` |
| `made[].category` | A category the wallet created with one of the template's starting actions |
| `made[].transactionId` | The transaction that created it |

### `xo_service_possible`

```json
{ "xo_service_v1": {
    "action": "xo_service_possible", "version": 1, "network": "chipnet",
    "id": "7f3c9b", "time": 1790000003, "ok": true,
    "height": 280000,
    "start": [ { "action": "borrow", "available": true },
               { "action": "open", "available": false, "reason": "No loans are offered now." } ],
    "items": [ { "ref": "loan-7", "category": "c1c1…c1", "action": "repay",
                 "lockingScript": "aa20e1e1…e187", "coin": "f1f1…f1:1",
                 "about": { "category": "c1c1…c1", "spent": true },
                 "bindings": { "payout": "receive" },
                 "says": [ { "variable": "debt", "value": "1250" } ] } ] } }
```

| Field of an item | Meaning |
| --- | --- |
| `ref` | Opaque to the wallet and not a secret, at most 128 characters. The wallet sends it back with a join. The service checks everything again then. |
| `category` | The token the action belongs under |
| `action` | An action identifier of the template |
| `lockingScript` | Optional. Where the position is, as hex, so that the wallet can check the coin on the chain |
| `coin` | Optional. The coin that is the position, `<transaction id>:<output index>` |
| `about` | Optional. As in `xo_v1`: `{category, spent}`, which position the action is about and whether it spends that token |
| `bindings` | Optional. As in `xo_v1`: variable name to the kind of output the wallet fills with a locking script of its own (`receive`, `change`, `return`, `lasting`) |
| `says` | Optional. Values the service states for display, as `{variable, value}`. The wallet shows them as "From the service" and never trusts them. |

`start` lists starting actions of the template, each with `available` and, where it is not, a `reason` of at most 200 characters.

### `xo_service_join_request`

```json
{ "xo_service_v1": {
    "action": "xo_service_join_request", "version": 1, "network": "chipnet",
    "id": "7f3c9c", "time": 1790000010,
    "ref": "loan-7",
    "invitation": "{\"invitationIdentifier\":\"…\",\"createdAtTimestamp\":\"<bigint: 1790000009n>\",\"templateIdentifier\":\"a1a1…a1\",\"actionIdentifier\":\"repay\",\"commits\":[{…}]}" } }
```

`invitation` is a string: the text `serializeInvitation` of `@xo-cash/utils` gives, unchanged. It holds the wallet's commit. `ref` is the item's `ref` from `xo_service_possible`; it is absent for a starting action, where the service works from the invitation alone.

### `xo_service_join_result`

```json
{ "xo_service_v1": {
    "action": "xo_service_join_result", "version": 1, "network": "chipnet",
    "id": "7f3c9c", "time": 1790000011, "ok": true,
    "invitation": "{\"invitationIdentifier\":\"…\",…,\"commits\":[{…the wallet's commit…},{…the service's commit…}]}" } }
```

A refusal:

```json
{ "xo_service_v1": {
    "action": "xo_service_join_result", "version": 1, "network": "chipnet",
    "id": "7f3c9c", "time": 1790000011, "ok": false,
    "error": "The shared coin was spent. Ask again.", "code": "inputs-spent" } }
```

### How a service joins

Before it joins, a service checks the invitation it received with the engine's `validateInvitation`, against the template as its own engine stored it. The engine's `acceptInvitation` does not check signatures or history, so a party that joins an invitation started by the other side must call `validateInvitation` itself. The service then checks the action, the token and the values as the template and its own rules require, and only then appends its commit.

A service answers with exactly one new commit, in the role its hello answer named. In the engine that is one call, `acceptInvitation(invitation, { roleIdentifier, variables, inputs, outputs })`, with everything the service adds; `acceptInvitation` followed by `appendInvitation` makes two commits, and a wallet refuses the answer. The commit leaves the places of its inputs and outputs to the template, and uses no `mergesWith` and no resolutions.

A service can keep no state at all: a fresh engine for each message works. It reserves no coins, so two wallets may be handed the same shared coin; the later transaction is then refused by the network.

## Errors

A refusal is an answer with `ok: false`, `error` in plain words and, where one fits, `code`. The list of codes is the same for every service. A wallet that does not know a code reads `error`.

| Code | Meaning | What the wallet may do |
| --- | --- | --- |
| `inputs-spent` | A shared coin the service would use was spent by someone else first, or is no longer there. Same meaning as in `xo_v1`. | Ask again; it may work. |
| `not-possible` | What was asked cannot be done now, for this token or with these values. | Show `error`. |
| `unknown-template` | The service does not serve this template, or not in this role. | Show that the template has no service here. |
| `wrong-network` | The service does not serve the network the message names. | Show that the template has no service on this network. |
| `version` | The message is of a version the service does not speak. The answer is in the service's own version. | Show that the wallet and the service do not match. |
| `bad-invitation` | The invitation cannot be read, or is not one the service can join. | Show `error`. |
| `too-large` | The message, or a text in it, is larger than the limits allow. | Send less. |
| `too-many` | A list in the message has more entries than the limits allow. | Send fewer. |

A service reserves no coins. Two wallets may be handed the same shared coin, and the one whose transaction reaches the network second is refused. `inputs-spent` is for that case: the wallet may ask the service again, and the user approves the new transaction.

A service that serves several networks answers each message for the network it names and refuses any other with `wrong-network`, before it looks at anything else the message holds. A message of another version is refused with `version` before anything else.

## Limits

| Limit | Value |
| --- | --- |
| A message to a service | at most 64 KiB (65,536 bytes) |
| What a wallet reads of an answer | at most 128 KiB (131,072 bytes) |
| Time a wallet waits for an answer | 10 seconds |
| Time a wallet waits for the answer to a join | 25 seconds |
| Entries in any one list of a message (`tokens`, `made`, `serves`, `start`, `items`, `says`, an item's `bindings`) | at most 32 |
| `ref` | at most 128 characters |
| `error`, a starting action's `reason` | at most 200 characters |
| `id` | at most 80 characters |
| The address in a template | at most 2,048 characters |

A wallet that would send more than 64 KiB does not send. A service that would answer more than 128 KiB answers HTTP 500 instead.

## When a wallet speaks to a service

A wallet speaks to a service only at these moments:

- **When the user trusts the template.** The wallet may send `xo_service_hello`, to show whether the service answers and in which role.
- **When the user presses Connect** on the template's screen. The wallet sends `xo_service_hello` and `xo_service_possible_request`, and shows what is possible.
- **When the user carries out an action.** The wallet may ask `xo_service_possible_request` again, then sends `xo_service_join_request`.

Never otherwise, and never in the background. A wallet does not poll a service.

## What the service is told, and what it is not

The service is told:

- the template and the role the wallet takes in it;
- the NFTs the wallet holds under this template, and the categories it created with this template's starting actions, each with its coin or transaction;
- at a join, the invitation with the wallet's commit: the user's values for this action and the wallet's coins and token in it.

The service is not told:

- anything about other templates, other applications or other tokens of the wallet;
- the wallet's balance, its other coins or addresses, or any key;
- who the user is. The hello carries nothing about the wallet beyond its role.

Like any web server, the service sees the network address the message comes from and when it comes. The request carries no cookies, no credentials and no referrer.

## Who the service is

A service is recognised by its address in the template, and by nothing else. The hello answer carries no identity.

An XO entity identifier is new for each invitation, so there is nothing stable to publish, remember or compare. The signatures on an invitation's commits show only that the commits of one participant within one invitation belong together and were not changed afterwards. They do not show who that participant is.

Safety rests on the wallet's checks below, not on who answered.

## What a wallet must check before signing

The engine does not enforce these. The wallet does, in this order, and refuses the action if any fails.

1. **The invitation is the one it sent.** The invitation identifier, the template and the action are unchanged. The wallet's own commit is intact, unchanged in every field. The service appended exactly one commit, and that commit names no other template or action (a commit's `actionReference`, if present, names this template and this action). `checkJoinedInvitation` in the reference implementation does these checks without the engine.
2. **Every commit signature verifies.** The engine's `updateInvitation` checks signatures and history; `acceptInvitation` does not.
3. **The service did not touch the wallet's values.** It stated no variable that the template assigns to the wallet's role, and did not state again a variable the wallet set. In the engine the last writer wins, and a role tag overrides the template's assignment. The wallet refuses, or states its own values again last.
4. **The service stated only its own values.** Every variable the service stated is one the template assigns to the service's role (the role the hello answer named) for this action.
5. **Every input the service added is the template's.** Each is a template input of the action. The wallet reads each coin from the chain itself. Each is unspent, at the template's script for that input, with exactly the unlocking and the sequence number the template compiles from the merged values.
6. **Every output the service added is the template's.** Each is a template output of the action and equals what the template compiles from the merged values: script, value and token. Nothing else was added.
7. **The wallet adds its own part.** Its outputs, a coin for the fee and its change.
8. **Every input is evaluated in the virtual machine** with the built transaction.
9. **The wallet shows its own figures** from the built transaction: what goes where, what the wallet gives and gets in coins and tokens, which shared coins are spent, the fee. Values the service stated in `says` are shown as "From the service", apart from the wallet's figures.

A commit's `expiresAtTimestamp` is not enforced by the engine and is not covered by the commit's signature. The wallet applies its own time limit to an answer instead.

## Versioning

`xo_service_v1` names the protocol family. `version` counts revisions inside it; this document is version 1.

A receiver refuses a message of a version it does not speak with code `version`, and answers in its own version. The sender learns from the answer which version the other side speaks.

A change that a reader of this version could misread takes a new identifier, such as `xo_service_v2`. It sits beside this one:

- The body's key is the identifier, so one address can tell the two apart.
- A template may name a resource of each identifier.
- A wallet keeps a list of the identifiers it speaks, the preferred first. It uses the most preferred identifier for which the template has a usable resource on its network. If none is usable, it reports why for the most preferred one it found.
- A resource with an identifier the wallet does not speak is ignored like any other link.

The same applies to any later carriage of these messages: it would be named by an identifier of its own, beside this one.
