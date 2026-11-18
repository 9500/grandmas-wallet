# Position recovery for XO templates

A proposal to XO's authors. It describes a declarative addition to a template that lets any wallet holding an application's token find the position that token controls, and operate it, from the template and the chain alone.

**Status.** Implemented as a document beside the template, with no change to XO, and run on chipnet with the unmodified engine (section 10). Whether and how it enters XO is for XO to decide. The field names are proposals.

**How to read this.** Sections 1 to 3 make the case. Section 4 shows the whole idea on one small application. Sections 5 to 8 are the specification. Section 9 lists what is asked of XO.

## 1. Summary

An XO template tells a wallet how to build an application's transactions. It does not tell a wallet how to find its way back to what those transactions made.

Take a loan. On chain it is a contract coin, and the borrower holds an NFT that the contract accepts as permission to manage it. The borrower's wallet can manage the loan because its engine built the transaction that opened it and kept the values the loan's script was made with. A wallet that holds the same NFT and the same template, but did not build that transaction, can do nothing. To that wallet the NFT is a category and a few bytes, and the template asks for values it does not have.

That second wallet is an ordinary case. It is the user's new phone, another wallet restored from the same seed, the wallet of someone the NFT was sent to, or any wallet on a day the application's site is offline.

We propose that a template can state two more things:

1. **Which outputs are the wallet's.** What the user receives is locked by a script the wallet chooses, never by one the application supplies.
2. **How a token leads to its position.** From an NFT the wallet holds: where the contract coin is, which values its script was made with, and what each action needs.

A wallet that reads these needs only the token, the template and the chain to list the user's positions and act on them. We call this **position recovery**.

## 2. The problem

**Terms.** A *position* is what an application holds on chain for one user: a savings jar, a loan, a stake. It is one or more coins at a contract's script. An *authority token* is an NFT that the contract accepts as permission to act on the position. The contract requires the token to be spent in the same transaction and checks no key of the user's.

Applications on Bitcoin Cash are already built this way. A ParyonUSD loan, for example, is managed by whoever holds its loan key NFT.

**What goes missing.** To act on a position, a wallet needs the values its script was made with. In XO these are the locking script's `state`, and the engine has them because it made the script. They are kept in one installation's storage. The user still holds the token, and the values are gone, when:

| Situation | Why the values are gone |
| --- | --- |
| The seed is restored on a new device or in another wallet | Keys derive from the seed. A jar's date or a loan's terms do not. |
| The token is sent, sold or inherited | The receiving wallet never saw the position being made. |
| The wallet's keys are replaced (rotation, a multisig that changes members, key recovery) | The coins move to new scripts under a new account, which has no history. |
| The application's site is unreachable | Often only the site knows which shared contract coins an action spends, and with which values. |

In all four the authority survived and the information did not. The usual remedies are the application's server, or copying the engine's state between devices. Both add a dependence that the application's contracts do not have.

**An ordinary wallet has the same gap.** Take a wallet with plain P2PKH keys whose seed is restored on a new device. This is what we found in the versions we ran, `@xo-cash/engine` 0.1.1-next.18029697917 and `@xo-cash/state` 0.0.5:

- **The engine does not search from a seed.** It learns of a script when it builds or receives the invitation that made it, or when it is asked for an address. A wallet can make its addresses again in order, and so find its coins and the authority token. The position stays unknown: its values do not derive from the seed, its address is a hash that cannot be read backwards, and nothing in the template says that the values are on the token.
- **Copying state between devices is not there yet.** The state package describes synchronisation with remote servers, and its class for it, `RemoteEncryptedStateManager`, is marked "Not implemented yet". When it exists it will serve a user's own devices. It will not serve a token that changed hands, a different wallet product, or a user whose state was lost.

**Where the token lands.** There is a second, smaller gap. A template can already leave an output's script to the caller. XO's stock templates do it with a variable of type `locking_script`:

```json
"lockingScript": "$(<recipientLockingScript>)"
```

Nothing says *whose* script that has to be. For a payment it is someone else's. For an authority token it has to be the wallet's own, chosen by the wallet. Otherwise the party that fills in the variable, usually the application's page, decides where the user's authority goes. And a wallet whose coins are not at plain keys of one seed (a multisig, a vault, a wallet with key recovery) has no stated way to say "send it here".

**Which applications this fits.** Position recovery works for applications that follow three rules. None of them mentions recovery, and existing contracts can already meet them.

| Rule | Meaning |
| --- | --- |
| 1. Authority is a token | Whoever may act on a position is whoever spends its NFT in the same transaction. No key or key hash of the user's is written into the application's scripts. |
| 2. The wallet's parts are the wallet's | Tokens, payouts and change go to scripts the wallet names. The application assumes nothing about the script or size of the wallet's inputs. |
| 3. The token leads to the position | From the NFT's category and commitment, the template and the chain, a wallet can find the position and everything its actions need. |

Rule 1 is a property of the contract. The extension is how a template states rules 2 and 3.

## 3. What it enables

- **Positions survive.** A position outlives the loss of a device, a move to another wallet, and the end of the application's front end. The user can always get out.
- **Positions can change hands.** Sending the token sends the position. The receiving wallet can use it at once.
- **Every wallet can show positions.** "Savings jar, 0.3 BCH, opens 1 March" or "Loan, 100 PUSD owed, 0.6 BCH collateral", read from the chain in the template's own words. Today only the application's site can show that.
- **Wallets with scripts of their own can use applications.** Multisig wallets, vaults and wallets with key recovery receive tokens at their own scripts, and no application has to know about them.
- **Application authors need no server that remembers who owns what.** They write the declaration once, and every wallet that reads it serves their users.
- **Part of a template's safety can be checked by a program.** No user key in the contract; the authority token goes to the wallet; the token leads to a position.
- **Less is asked of servers.** A wallet looks up only the scripts that follow from tokens it holds. It needs no index of "all positions of this user" and tells no application's server what it holds.

## 4. The idea on one example: a savings jar

A jar holds savings until a date. Anyone can pay in. After the date, whoever holds the jar's key NFT can empty it.

```
contract SavingsJar(bytes32 keyCategory, int unlockTime) {
    function withdraw(int keyInput) {
        require(tx.inputs[keyInput].tokenCategory == keyCategory);
        require(tx.time >= unlockTime);
    }
}
```

**The template** is ordinary XO and passes the validator as it is. Three choices in it matter here (excerpt; names and descriptions left out):

```json
"variables": {
  "keyCategory": { "type": "token_category" },
  "unlockTime":  { "type": "integer" },
  "unlockTimeBytes": { "type": "bytes" },
  "keyHolder":   { "type": "locking_script" }
},
"lockingScripts": {
  "savingsJarLockingScript": {
    "lockingType": "p2sh", "lockingBytecode": "savingsJarBytecode",
    "state": { "variables": ["keyCategory", "unlockTime"] }
  }
},
"outputs": {
  "jarKeyOutput": {
    "lockingScript": "$(<keyHolder>)",
    "valueSatoshis": "1000",
    "token": { "category": "$(<keyCategory>)",
               "nft": { "capability": "none", "commitment": "$(<unlockTimeBytes>)" } }
  }
}
```

- The key goes to a script held in a variable, `keyHolder`.
- The jar's script is made from two values, `keyCategory` and `unlockTime`.
- Both values are on the key: its category, and the date as its commitment. The date is in the template twice, as a number for the script and as bytes for the commitment, because a token field takes its value as text.

**The declaration** is the addition. This is the whole of it for the jar:

```json
{
  "profile": "recoverable-app-v1",
  "version": 1,
  "template": { "identifier": "04db6aef…ee5c", "contentHash": "5450fe6a…74da" },

  "authority": {
    "jarKey": {
      "token": "jarKeyOutput",
      "position": {
        "lockingScript": "savingsJarLockingScript",
        "variables": { "keyCategory": "token.category", "unlockTime": "token.commitment" }
      },
      "actions": ["deposit", "withdraw"]
    }
  },

  "actions": {
    "open":     { "creates": "keyCategory",
                  "outputs": { "keyHolder": "receive" } },
    "deposit":  { "variables": { "keyCategory": "token.category", "unlockTime": "token.commitment" } },
    "withdraw": { "spends": "jarKey",
                  "position": "savingsJarInput",
                  "outputs": { "keyHolder": "receive" },
                  "variables": { "keyCategory": "token.category",
                                 "unlockTime": "token.commitment",
                                 "unlockTimeBytes": "token.commitment",
                                 "keyInput": "token.inputIndex" } }
  },

  "tokens": { "jarKey": { "kind": "nft", "authority": "jarKey", "name": "Jar key" } }
}
```

Read aloud, it says:

- The output `jarKeyOutput` makes a token that carries authority. Call it `jarKey`.
- Its position is at `savingsJarLockingScript`, built with the token's category and commitment.
- Its holder can deposit and withdraw.
- When opening, the wallet creates the new category and puts a fresh script of its own into `keyHolder`.
- When withdrawing, the wallet spends the key, spends the jar's coins as `savingsJarInput`, takes every value from the key, and receives the key back at a fresh script of its own.

**What a wallet does with it.**

1. *Opening.* The application asks for the action `open` and supplies the date and the amount. It supplies neither `keyHolder` nor `keyCategory`. The wallet fills both, and the engine builds the transaction as for any template. The key is now at a script of the wallet's.
2. *Later, in a wallet that has no history of the jar.* The wallet holds an NFT and has the template and its declaration. It sets `keyCategory` and `unlockTime` from the NFT, builds `savingsJarLockingScript`, and looks up that address:

   ```
   NFT (category, commitment)  →  SavingsJar(category, commitment)  →  address  →  coins on chain
   ```

3. *Withdrawing.* Every variable the `withdraw` action requires is named in the declaration with its source. Nothing is left for the application to supply, so the wallet carries the action out by itself.

## 5. The declaration

### 5.1 Top level

| Field | Meaning |
| --- | --- |
| `profile`, `version` | `recoverable-app-v1`, `1`. A wallet refuses a profile or version it does not know. |
| `template` | The template this is about: `identifier` as the engine computes it, and `contentHash`, the SHA-256 of the template's text as published. Needed only while the declaration is a separate document. |
| `authority` | The tokens that carry authority, and how each leads to its position (5.2). |
| `actions` | For each action of the template, the parts the wallet supplies (5.4). |
| `tokens` | Optional. What the template calls its tokens (5.5). |

Every name in a declaration (an output, an input, a locking script, a variable, an action) is the identifier of that item in the template.

### 5.2 Authority: from a token to its position

| Field | Meaning |
| --- | --- |
| `token` | The template output that creates the NFT. |
| `position` | Where the position is, in one of the two forms below. |
| `actions` | The template actions the token's holder can take on the position. |
| `state` | Optional. Values to show beside the token, each with its source: `"debt": "position.commitment[1..7]"`. The names are variables of the template, so the wallet shows them in the template's words. |

**A position at an address of its own.** The address follows from the token alone:

```json
"position": { "lockingScript": "savingsJarLockingScript",
              "variables": { "keyCategory": "token.category", "unlockTime": "token.commitment" } }
```

The wallet fills the variables from the token, compiles the template's locking script, and looks up the coins there.

**A position found through a companion coin.** Some contracts do not put the token's category into the position's script. They create, beside the position, a small coin that carries an NFT of the same category as the authority token:

```json
"position": {
  "companion": { "lockingScript": "sidecarContract",
                 "tokenCategory": "token.category",
                 "commitment": "01" },
  "relative": -1,
  "genuine":  { "lockingScript": "loanContract",
                "variables": {},
                "tokenCategory": "e7979ccd…e6b8" }
}
```

The wallet works in three steps:

1. It finds the unspent coins at the `companion` script that carry an NFT of the token's category and, if `commitment` is given, that commitment.
2. For each, the candidate position is the output `relative` places away in the transaction that made the companion.
3. It checks each candidate against `genuine`: the candidate must be at that locking script, built with the stated values, and must carry a token of `tokenCategory` if one is given.

Exactly one candidate has to pass. If several pass, the wallet reports the position as ambiguous and picks none. `genuine` is required: a category and a distance alone would let the holder of a token make look-alikes.

### 5.3 Where values come from

| Source | Value |
| --- | --- |
| `token.category`, `token.commitment`, `token.valueSatoshis` | The authority token and the coin that carries it |
| `token.inputIndex` | The index of the input that spends the token in the transaction being built |
| `companion.commitment` | The commitment of the companion coin's NFT |
| `position.commitment`, `position.valueSatoshis` | The position's coin. For a position of several coins, the value is their sum. |
| `input.<name>.category`, `.commitment`, `.tokenAmount`, `.valueSatoshis` | A coin of the application's that the action spends as the template input `<name>` (5.4) |

- A commitment may be followed by a range of bytes. `position.commitment[1..7]` is bytes 1 to 6.
- The variable's type in the template decides how bytes are read. A numeric type is read as a script number; from a range it is read as `OP_BIN2NUM` reads it, so padding is allowed. Any other type takes the bytes as they are.
- A position at an address of its own may use only `token.category`, `token.commitment` and `token.valueSatoshis`.
- A value the chain does not hold cannot be a source. A position that needs one is reported as incomplete.

### 5.4 Actions: the wallet's parts

| Field | Meaning |
| --- | --- |
| `creates` | The variable that receives a new token category. The wallet supplies the coin that defines it: a coin of its own that is output 0 of its transaction. |
| `spends` | The authority entry whose token the action spends. |
| `position` | The template input that each coin of the position is spent as. |
| `companion` | The template input that the companion coin is spent as. |
| `outputs` | Variables of type `locking_script` that the wallet fills with a script of its own, each with a kind (below). |
| `variables` | Variables the wallet fills from the token and the chain, each with its source (5.3). |
| `inputs` | The application's other coins, by template input (below). |
| `fromApplication` | Variables that only the application can work out. An action that needs one is offered through the application only. |

**Kinds of wallet-bound output.**

| Kind | The wallet supplies | For |
| --- | --- | --- |
| `receive` | A fresh script of its own | A coin or token created now |
| `change` | A fresh script of its own | What is left over |
| `return` | The script of its coin that holds the authority token the action spends | Contracts that require the token to go back to the script it left |
| `lasting` | A script that stays the wallet's however its keys change later | An address written into a contract now and paid much later |

The wallet fills each kind itself. A value the application supplies for such a variable is not used. A wallet that keeps its coins at plain keys of one seed can treat all four as "an address of mine". A wallet that does not offer a kind refuses the action.

**The application's other coins.** Contracts that all users share (a price, a factory) appear in a transaction as inputs that are neither the wallet's nor the position:

```json
"inputs": {
  "priceInput": { "lockingScript": "priceContract",
                  "token": { "category": "e7979ccd…e6b8", "capability": "mutable" } }
}
```

For a template input, this gives the locking script the coin sits at and the token it must carry. An application may name the coin by outpoint; the wallet reads it from the chain and checks it against this description. Without an application, the wallet finds a fitting unspent coin itself.

### 5.5 Token names (optional)

```json
"tokens": {
  "pusd":    { "kind": "fungible", "category": "e7979ccd…e6b8", "name": "ParyonUSD", "symbol": "PUSD", "decimals": 2 },
  "loanKey": { "kind": "nft", "authority": "loanKey", "name": "Loan key" }
}
```

An entry names either a category that the template deals in literally, or the tokens of an authority entry, whatever category each was made with. A name is the template's claim. A wallet shows it only for a template the user trusts, and refuses a declaration that names tokens its template never deals in.

## 6. A second example: a loan on ParyonUSD

ParyonUSD lends its dollar token against BCH. Each loan is managed by whoever holds its loan key NFT. We wrote a template and a declaration for Paryon's published contracts as they are, without changing them, to see whether the format holds for an application we did not design. The template and declaration are ours and are independent of Paryon.

It needed the three things the jar does not:

- **A companion.** A loan's script does not contain its key's category. Each loan is created with a "sidecar" coin one output after it, and the sidecar carries an NFT of the key's category. The `position` is the companion form shown in 5.2.
- **Shared coins.** Managing a loan spends Paryon's price contract and its manage contract. The declaration describes both under `inputs`.
- **`return`.** Paryon's contracts require the loan key to go back to the script it left.

The entry for managing a loan:

```json
"manage": {
  "spends": "loanKey",
  "position": "loanInput",
  "companion": "sidecarInput",
  "inputs": {
    "priceInput":  { "lockingScript": "priceContract",
                     "token": { "category": "e7979ccd…e6b8", "capability": "mutable" } },
    "manageInput": { "lockingScript": "manageContract",
                     "token": { "category": "e7979ccd…e6b8", "capability": "none", "commitment": "02" } }
  },
  "outputs": { "keyHolder": "return" },
  "variables": {
    "keyCategory": "token.category",
    "keySatoshis": "token.valueSatoshis",
    "priceCommitment": "input.priceInput.commitment",
    "loanCommitment": "position.commitment",
    "interestManagerConfiguration": "position.commitment[22..27]"
  }
}
```

With `"state": { "debt": "position.commitment[1..7]", "collateral": "position.valueSatoshis" }`, a wallet that has never seen the loan shows its debt and collateral, and can add collateral or close it. One action shows the limit: a repayment that leaves the loan open needs a new loan record that a template's expressions cannot compute. Its declaration lists that value under `fromApplication`, and the wallet offers that action through the application's page only.

## 7. What a wallet does

**Taking a template in.**

- The declaration is bound to its template by hash. The user trusts the two together. A different declaration for a template the user already trusts is shown as something new to trust.
- The wallet checks what a program can check, and refuses a template that fails:
  - the template's scripts take no key of the user's;
  - every output that creates an authority token takes its locking script from a variable that the declaration gives to the wallet;
  - every position's script can be built from the sources the declaration names;
  - every name in the declaration exists in the template.
- A template that passes is "not verified" until a token made with it has led to its position on chain. Whether the contract gives authority to the token and to nothing else takes reading the contract. The wallet does not claim it.

**Finding positions.**

- For each NFT it holds, the wallet tries the authority entries of the templates the user trusts, as in 5.2.
- The answer is one of: open, closed, not found, incomplete, ambiguous. "Not found" is an ordinary answer. A position can end without the wallet, as when a loan is liquidated, and a token can be one that no known template made.
- What the wallet finds, it makes known to the engine, with the values it worked out.

**Carrying out an action.**

- The wallet's outputs come from the declaration. If the application's request states them too, the two must agree.
- Before signing an action that creates an authority token, the wallet checks that the new token leads, by the declaration, to a position made in the same transaction. A token that would not lead back is not created.
- The wallet spends an authority token only in a transaction it built itself from a template the user trusts. Such a token is a bearer instrument: whoever gets it spent in a transaction of their own shape can use it.

## 8. Limits

- A declaration cannot supply data that is not on chain, and it gives no authority that a contract does not grant. A wrong declaration finds nothing.
- It does not replace the application's interface or its off-chain services. It covers finding a position and the actions whose values are on chain or typed by the user.
- The format was shaped by two applications. Others may need more sources, or another way to find a position.
- No second wallet reads the format yet, and the field names have not been discussed with anyone.

## 9. What this asks of XO

Nothing has to change for the form described here. Templates stay valid, and the unmodified engine builds and signs every transaction. Three decisions would make it more than one wallet's convention:

1. **Is finding a position a template's business?** If so, the declaration can live in one of two places:
   - **In the template**, as one property (`"recovery": { "profile": …, "authority": …, "actions": … }`). One artifact and one identifier, and the validator can check the names. The schema is strict, so it has to admit the property.
   - **Beside the template**, as a profile that XO publishes and versions separately from the schema. This is the form in use. It costs a second hash to carry.
2. **Should the core schema be able to say "this script is the wallet's"?** This is useful without the rest. The proposal is a kind (`receive`, `change`, `return`, `lasting`) on a `locking_script` variable or on the output that uses it. The schema already has `importDefaultValue` on a variable, "a neutral intent that the engine uses to populate the default value for this variable". We found no use of it in the stock templates or in the engine build we ran, so we may misread its purpose. If it is meant for this, two properties matter:
   - The template does not name the wallet's template. An application cannot know what kind of wallet its user has.
   - The value is not a default that a caller can replace. Only the wallet supplies it.
3. **Could the engine do the finding?** A function that takes a template, an authority entry and a token, and returns the position's script with its values, would give every XO wallet position recovery without code of its own. One thing would help with shared contracts: spending a coin at a template's script without first following that script's whole history. A script that every user of an application shares can have tens of thousands of entries. We marked such scripts `relevant: false` and compiled their unlocking from the template ourselves.

## 10. Status and where to look

The format is implemented in Grandma's Wallet, an MIT-licensed Bitcoin Cash wallet whose keys can be replaced after an on-chain waiting period. Replacing the seed leaves the new device with no keys and no engine history from the old one, which is where the need came from.

- **Engine.** `@xo-cash/engine` 0.1.1-next.18029697917, unmodified. Both templates pass the XO validator.
- **Savings Jar on chipnet** (18 November 2026). A jar was opened from its page through the wallet. The phone was then treated as lost and the wallet's keys were replaced. The new phone, with a new seed, found the jar from the key, the template and the chain, and emptied it. Up to the withdrawal, none of its browser's recorded requests went to the jar's page.
- **ParyonUSD loan on chipnet** (18 November 2026), on Paryon's public test deployment. A loan of 100 PUSD was opened and given more collateral. After the same loss and key replacement, the new device found the loan through its sidecar, showed its debt and collateral, and closed it without an application's page.
- **Ordinary wallets.** The same jar contract was opened and emptied with an unmodified Cashonize. An application that follows the three rules does not have to know that this extension exists.

In this repository:

| What | Where |
| --- | --- |
| Jar template and declaration | [packages/savings-jar/frozen/](../packages/savings-jar/frozen/) |
| Loan template and declaration | [packages/paryon/frozen/](../packages/paryon/frozen/) |
| Reading a declaration | [packages/app/src/declaration.ts](../packages/app/src/declaration.ts) |
| Checking a template | [packages/app/src/template-check.ts](../packages/app/src/template-check.ts) |
| Finding a position | [packages/app/src/positions.ts](../packages/app/src/positions.ts) |
| Records of the chipnet runs | [docs/runs/](runs/) |
