# Stage 11 trial: from the template alone, and back from a record

**Date:** 20 November 2026 · **Status:** done for the Savings Jar. The design holds for it, with two corrections to section 13.3 and three clarifications to sections 10.2, 10.4 and 10.6, listed at the end. The check of section 10.4 from the token's side, for a ParyonUSD loan, was not part of this trial. · **Plan:** `IMPLEMENTATION_PLAN_v0.6.md`, stage 11

The script is `spikes/xo-engine/35-template-alone-and-record.ts`. It uses the unmodified engine `0.1.1-next.18170561234`, this project's `Account` class, and a local regtest chain (Bitcoin Cash Node 29.2.0, Fulcrum 2.1.4). No recovery declaration is read anywhere in it. Every transaction named below was built and signed by the engine and accepted by the node with the public networks' relay rules.

## Answers

| Question of the plan | Answer | Evidence |
| --- | --- | --- |
| a. Does the engine take a template input that names a token and has no unlocking script, and build and sign a transaction with the wallet's own coin there? | Yes. The validator and the engine took the template; the engine built the withdrawal with seed B's key coin at that input, index 0, and signed it with `0x41`. The engine does not look at the input's `token`: the contract and the wallet's own figures are what hold the coin to it. | Withdrawal `6a5f63cd…6c8a` |
| b. Are the engine's stored values enough to follow and to spend under a new seed? | Yes. Seed B's engine, given the template, the locking script, the role and the script's two values, followed the jar, listed both its coins and unlocked them. Seed A's engine keeps every value of the action that made the script, not only the script's. | `ScriptHashData` of both accounts, below |
| c. Which fields does the record need? | The token's category, the template's identifier, the locking script, the role, the script's values, and one other value of the action (`unlockTimeBytes`). The commitment is needed only for the check. The amount and the key's address were recorded and not needed; the address must not be used again. | "The record" below |
| d. Does filling from the role's requirements work? | Yes, with two corrections. Taken word for word, section 13.3 sends the key back to seed A's address on a withdrawal, and pays the first amount again on a deposit. | "Where each value came from" below |
| e. Does the check of section 10.4 hold for this jar from the script's side? | Yes. Of the two transactions that paid the jar, the one that opened it carried the key. A record with another date, whose script someone paid without the key, does not count. | "The check" below |

## What was run

Three processes, each with an empty engine state, as devices would have. What one tells the next goes through files.

1. **The template.** A variant of `savings-jar-v3.json`, made in the script from the frozen text:
   - a new template input `jarKeyInput`: `{ name, description, token: { category: '$(<keyCategory>)' } }`, with no `unlockingScript`;
   - the withdrawal's inputs `[{ input: 'jarKeyInput', inputIndex: 0 }, { input: 'savingsJarInput' }]`;
   - the jar's unlocking `unlockSavingsJar: '<0>'` in place of `'<keyInput>'`;
   - the variable `keyInput` removed, from the variables and from the withdrawal's role requirements;
   - `version: '4-trial'`.

   `parseTemplate` of `@xo-cash/utils` accepted it, and so did the engine's `importTemplate`. Identifier `372b12a49792b90eb351ce3924470adc7c2c875ab7bb681ae1085d1fe206fbe9`, the same by both.

2. **Seed A opens a jar.** A block reward to A's first address is the coin at input 0. The script plays the application: it sends the action `open`, the role `saver`, and the date and the amount. The wallet's side fills the rest (below), works out the fee, and has the engine build and sign. The position record is written to a file after the engine has signed and before the transaction is sent. A block reward is then paid straight to the jar's address, as a deposit from someone without the key, and another to the script of a record with a date one second later, for the check's counter-example. A sends the key to an address of seed B with the wallet's own payment action, an ordinary transfer.

3. **Seed B empties it.** A new account on a new seed. It is handed the template's text (the template record of section 10.2), the position record, and its own words; the key reaches it on chain. It makes the jar's script known with `Account.followScript`, from the record's four engine fields. It fills the withdrawal from the record and its own addresses, tries it before the date (refused by the node), moves the chain's median time past the date, and sends the same transaction again (accepted).

4. **The check,** with the template's text, the record, the key's coin as the wallet would list it, and the local Fulcrum: before the withdrawal in seed B's process, and after it in a fourth process with no engine.

The run was made twice with the same results; the identifiers below are from the second run.

### Transactions

| | Transaction | Height | Bytes | |
| --- | --- | --- | --- | --- |
| Open | `4e6317a5af7c0d21d9ab521cab04370aa90d85a2795b97f6ecea09837c13eee3` | 320 | 477 | Input: A's coin, output 0 of a block reward. Outputs: 0 the jar, 200,000 sat; 1 the key NFT, commitment `0776006b`, to A; 2 change to A |
| Deposit by someone else | `8a934ae5a211be1c8be233033dadcbd4d2644ff01b70fc6344d56d7e051db435` | 321 | 107 | A block reward to the jar's address |
| Payment to the counter-example's script | `ab816c75b277957b9d490315fd04f7572b1bfd79e86d1a0aca65fb18021bbfda` | 322 | 107 | A block reward |
| Key from A to B | `6b433c75e8e55561955e2b9ea2bc545d23755b258fa8962c803a23cd1ea0084d` | 323 | 729 | The wallet's payment action: the key and a coin for the fee, to B's address and A's change |
| Withdrawal by B | `6a5f63cd212fcd57baecf031c8312ec709be0f4365c2a36de68e3f3ef3646c8a` | 435 | 607 | Inputs: 0 the key (sequence 0), 1 and 2 the jar's coins (sequence `0xfffffffe`). Outputs: 0 the key back to B; 1 the savings to B. Lock time = the date. Fee 607 sat |

The withdrawal was first sent when the chain's median time was before the date: `bad-txns-nonfinal, non-final transaction (code 64)`. The same transaction, with the same identifier, was accepted after the median time had passed the date.

## The record

Written by seed A's process from the values it filled and the transaction as built, before sending:

```json
{
 "token": { "category": "92ea6b7d81b50b40f4cccb5f82b21d4b6bd31d8c8c2d758c70bf267065e3d692", "commitment": "0776006b" },
 "templateIdentifier": "372b12a49792b90eb351ce3924470adc7c2c875ab7bb681ae1085d1fe206fbe9",
 "lockingScriptIdentifier": "savingsJarLockingScript",
 "roleIdentifier": "saver",
 "variables": { "keyCategory": "92ea6b7d…d692", "unlockTime": "1795192327" },
 "values": { "unlockTimeBytes": "0776006b", "savedSatoshis": "200000", "keyHolder": "aa20ba77…2cad87" },
 "applicationPage": null
}
```

`variables` are the script's values, those the template's locking script lists as its state (`lockingScripts.savingsJarLockingScript.state.variables`); `values` are the other values of the action. Values are kept as the engine keeps them: text, numbers in decimal, bytes in hex. `applicationPage` is empty because the request came from the script, not from a page.

What each field was used for:

| Field | Used by seed B for | Needed |
| --- | --- | --- |
| `token.category` | Finding the key among its coins, for the input `jarKeyInput`; points 1 and 2 of the check | Yes |
| `token.commitment` | Point 3 of the check | For the check only |
| `templateIdentifier` | Matching the template text it was handed; `followScript` | Yes |
| `lockingScriptIdentifier`, `roleIdentifier` | `followScript`; the script for the check | Yes |
| `variables` | `followScript`; the withdrawal's `keyCategory` and `unlockTime`; the script for the check | Yes |
| `values.unlockTimeBytes` | The withdrawal: the commitment of the key's output | Yes. It is not a value of the script, and nothing else in the template says it equals the token's commitment. |
| `values.savedSatoshis` | — | No |
| `values.keyHolder` | — | No, and must not be used: it is seed A's address |
| `applicationPage` | — | Not in this trial |

Nothing was needed that section 10.2 does not list. The template's text was needed beside the record; section 10.2 lists it as a record of its own.

## What the engine stored

`ScriptHashData` for the jar's script, in each account (`addedAtTimestampMs` left out):

| Field | Seed A, which made the jar | Seed B, which followed it from the record |
| --- | --- | --- |
| `lockingBytecode`, `scriptHash` | `aa20fefd…219087`, `1490637f…5a8f` | the same |
| `templateIdentifier` | `372b12a4…fbe9` | the same |
| `lockingScriptIdentifier` | `savingsJarLockingScript` | the same |
| `outputIdentifier` | `savingsJarOutput` | the same |
| `roleIdentifier` | `saver` | the same |
| `secrets` | `[]` | the same |
| `invitationIdentifier` | the open's invitation | the invitation `followScript` made and put aside |
| `variables` | `keyCategory`, `unlockTime`, `unlockTimeBytes`, `savedSatoshis`, `keyHolder` | `keyCategory`, `unlockTime` |

Seed A's engine keeps under `variables` every value of the invitation that made the script, not only the script's. Seed B's keeps what it was given, and that was enough: its engine followed and unlocked the jar from the script's two values, and the values the withdrawal's own outputs need came with the withdrawal's invitation. Seed A's, which holds more, was not tried for spending.

`followScript` made the script known through the action `open`, the first whose transaction pays to the jar, with only the two values; the open's other values (the amount, the key's address) were not asked for. Seed B's engine then listed both coins of the jar under the jar's template, the one from the open and the block reward paid in before B existed.

What seed B was given, in all: its own twelve words; the template's text; the record; the key NFT, on chain, at its address. Nothing came from seed A's engine. (The script's file of facts carried seed A's `ScriptHashData` across for the comparison above, and the address the key was to go to, which seed B's words give.)

## Where each value came from

The wallet's side fills each variable of the role's requirements (`actions.<action>.roles.saver.requirements.variables`) from the first source that has it: the request, the record, the wallet itself, the user. The wallet's own are a locking script (a new address of its own) and a token category that the action creates (a coin of its own at input 0). That a category is created is read from the template: an output of the action's transaction names the variable as its token's category, and no input of it does.

| Action | Variable | Type | Filled from |
| --- | --- | --- | --- |
| open (A) | `keyCategory` | `token_category` | the wallet: its coin at input 0 |
| | `unlockTime` | `integer` | the request |
| | `unlockTimeBytes` | `bytes` | the request |
| | `savedSatoshis` | `satoshis` | the request |
| | `keyHolder` | `locking_script` | the wallet: an address of its own |
| withdraw (B), as built | `keyCategory` | | the record (script's values) |
| | `unlockTime` | | the record (script's values) |
| | `unlockTimeBytes` | | the record (other values) |
| | `keyHolder` | | the wallet: an address of its own |

Two things went wrong when section 13.3 was followed word for word. Neither was sent; the script prints the values.

- **Withdraw:** the record holds `keyHolder` from the open, and the record comes before the wallet. The key would have gone back to `bchreg:pwa80vpws0zfkjltefccsrza4yxc4w25ggersx4wwwm295vpn5k26g89hlypc`, seed A's address. After a recovery that is an address of the earlier seed, which the earlier seed can still spend. The withdrawal that was sent fills a locking script from the wallet and never from the record.
- **Deposit**, acted on from the record with the user typing 5,000 sat: `savedSatoshis` came from the record, 200,000 sat, the amount of the open. The record comes before the user.

The template input that names the key's category also settles which token the withdrawal spends: the record's category is the one `$(<keyCategory>)` gives. Without such an input (the template of version 3), the rule above would read `keyCategory` in the withdrawal as a category the action creates. There the record fills it first, so no harm follows; with neither a record nor a request it would be taken wrongly.

## The check

Section 10.4 worked through for seed B's record, with the template's text, the record, the key's coin and the local Fulcrum. The script is compiled by this project's own code from the template, `lockingScriptIdentifier` and `variables`; Fulcrum gives its history; each transaction in it that has an output to the script is read, with the transactions its inputs spend.

Before the withdrawal:

```
1. the wallet holds an NFT of the record's category: true
2. transactions that paid the script bchreg:p0l0mrjrqhtt664nukglxqm6tdr8ahufjurfjcyuc9ckvm2ms5seq7acv2jl6: 2
   4e6317a5…eee3 at height 320: carried the NFT, output 1, commitment 0776006b
   8a934ae5…b435 at height 321: no NFT of the category
3. the NFT is the one the wallet holds: one NFT per category in this template; commitment as recorded: true
=> the record counts; the script holds 2 coin(s), 1250200000 sat: the position is shown and can be acted on
```

After it, the same with `the script holds 0 coin(s), 0 sat: the position is closed`. The withdrawal itself is in the script's history and carried the key, but it spent the script and paid nothing to it, so it is not one of the transactions of point 2.

The counter-example, a record identical but for `unlockTime` one second later, whose script was paid by a block reward:

```
2. transactions that paid the script bchreg:pwjn3sgwh7u0vhxw4wf5g3vstpz3nm324wsgfu58dhzzpfx4dyw4zhyqwxazr: 1
   ab816c75…bfda at height 322: no NFT of the category
=> the record does not count; the script holds 1 coin(s), 1250000000 sat
```

Point 3 rests on the template: its `open` makes the category from the coin at input 0 and gives exactly one output an NFT of it, with no capability, so the jar makes one NFT for each category. The commitment was compared as well.

## What has to change in the proposal

1. **Section 13.3, where a value comes from.** Two exceptions to the order are needed:
   - a locking script is never taken from the record: the record's is an address the position was made with, which after a recovery belongs to the earlier seed. It comes from the request or from the wallet;
   - a value of the record that is not one of the script's is taken only for an action that spends the position. A deposit pays into a jar without spending it; its amount is the user's (or the request's) to give, not the record's.

   One way to say both: "the record fills the variables of the position's script for any action on the position, and its other values, except locking scripts, for an action that spends it."
2. **Section 13.3, a token category the action creates.** Say how the wallet tells: an output of the action's transaction names the variable as its token's category, and no input of the transaction does. An input that names the token, as the jar's key input does, is then what marks an action as spending the token rather than making it.
3. **Section 13.3, the token's input.** Confirmed: XO's validator and the engine take an input that names a token's category and has no unlocking script, and the engine builds and signs with the wallet's coin there. Add: the engine does not check the input's `token` against the coin given (from reading the engine's code; not tried), and gives the input sequence number 0 when the template states none. The template's `token` on an input is information for the wallet.
4. **Section 10.2, the values.** The engine keeps every value of the action under `variables`, not only those of the script. The record can follow the engine and keep one map, or keep the script's values apart, which the template's `state.variables` of the locking script gives. Either serves; the proposal should say which. The engine also keeps `outputIdentifier`, which was not needed.
5. **Section 10.2, the last bullet,** speaks of a record that names "a transaction that does not exist", but the record has no transaction field. The check does not need one. Either drop the words or add the field.
6. **Section 10.6.** A device that has followed a script from a record holds in its engine only what it was given. When it writes the record again as its own, it copies the record's values; it cannot take them from its engine.
7. **Section 10.4, point 3.** Say how the wallet knows that an application makes one NFT for each category: from the template, by the action that makes the category (one output with an NFT of it, no minting capability).
8. **Section 13.4, the last item,** "that it is enough for a position whose values came from a record is still to be shown": shown for the Savings Jar on the local node.

## Not shown

- Chipnet. Only the local node.
- The wallet's own route for applications (`Applications`, its `plan`). The filling of values, the fee and the places are the trial's own code; the wallet's route still reads declarations and is rewritten in stage 14.
- A recovery. Seed B received the key by an ordinary transfer, not by the controller's sweep, and the record by a file, not from a sealed archive on a store.
- The check from the token's side, and a ParyonUSD loan. Not part of this trial.
- That the engine refuses, or builds, a coin of the wrong token at the key's input. Read from its code, not tried. The contract would refuse such a transaction, and this project's check before sending runs the contract.
- A template with several NFTs of one category, or a position that moves to another script.
- The jar's page, and Cashonize, with the changed template.

## The local chain

The shared local chain could not be used: its node had lost its blocks after being stopped uncleanly on 19 November and restarted at block 0, while Fulcrum's index still stood at height 478. When this trial made block 1, Fulcrum found the two apart, could not rewind, and stopped; its service has been restarting since. `deploy/regtest/regtest.sh reset` puts both right; it was not run, because it restarts the services. The trial ran on a second local chain instead, started by hand from the same releases and the same configuration templates, in `~/.local/share/grandmas-wallet/regtest/node2` and `fulcrum2` (RPC 18453, Fulcrum TCP 60411, WebSocket 60413), which `spikes/xo-engine/regtest.mjs` reads when `REGTEST_INSTANCE=2`. Both programs were stopped after the run. To run again:

```
R=~/.local/share/grandmas-wallet/regtest
$R/bitcoin-cash-node-29.2.0/bin/bitcoind -datadir=$R/node2 -daemon
nohup $R/Fulcrum-2.1.4-x86_64-linux/Fulcrum $R/fulcrum2/fulcrum.conf > $R/fulcrum2/fulcrum.log 2>&1 &
cd packages/app && REGTEST_INSTANCE=2 npx tsx ../../spikes/xo-engine/35-template-alone-and-record.ts
```

On the shared chain, once it is reset, the same command runs without `REGTEST_INSTANCE`.
