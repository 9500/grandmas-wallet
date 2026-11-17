# Trial: the two address contracts and what each input costs

**Date:** 17 November 2026 · **Status:** done · **Plan:** stage 0, "Do `RecoverableAddress` and `VaultAddress` compile as the proposal gives them, and what does each kind of input cost?"

## Answer

Both contracts compile with cashc 0.14.0 exactly as sections 7.4 and 7.5 of the proposal give them, to 96 and 75 bytes of rules. Every size was measured on signed transactions that pass the 2026 rules with standardness in the libauth virtual machine, and one whole life of a wallet was then run against a real node in regtest mode. The node and the virtual machine gave the same verdict on every transaction, except where the virtual machine cannot judge: whether a waiting period has passed.

The measured sizes confirm the proposal's figures. Nothing in sections 5.8, 7.4 or 9.6 needs correcting; three figures the proposal does not give are added below.

## What was done

- `spikes/addresses/recoverableAddress.cash` and `vaultAddress.cash` hold the contracts as the proposal prints them. They import `ownerApproves` from `contracts/lib/authorization.cash`, unchanged. `controller.cash` there is the repository's controller with `ownerClose` added (the trial of section 5.8).
- `node spikes/addresses/build.mjs` compiles them and keeps the bytecode in `spikes/addresses/artifacts/`.
- `node spikes/addresses/measure.mjs` builds and signs each transaction, checks it in the virtual machine, and prints the sizes and the refusals. Results are in `spikes/addresses/results/vm.json`.
- `node spikes/addresses/regtest-run.mjs` runs a wallet's life on the local node (see [local-node.md](local-node.md)). Results are in `spikes/addresses/results/regtest.json`.

Keys, secrets and tags in the trial are made as section 7.3 says (`secret = hash256(blinding seed ‖ kind ‖ n)`, `tag = hash256(identity ‖ secret)`), with fixed test keys in place of the key tree of section 7.2. Every signature is a Schnorr signature of type `0x61`; a payment by key was also checked with `0x41`, with the same size.

## Scripts and outputs

| | Bytes | Smallest value nodes relay |
| --- | --- | --- |
| Recoverable address, rules | 96 | |
| Recoverable address, with tag and key hash | 150 | |
| Vault address, rules | 75 | |
| Vault address, with tag | 108 | |
| Controller with `ownerClose`, rules | 457 | |
| Controller with `ownerClose`, with the identity | 490 | |
| P2PKH output | 34 | 546 sat |
| Output at an address of the wallet (P2SH32) | 44 | 576 sat |
| Controller output | 148 | 888 sat |

## Inputs

Bytes of one input, with its outpoint and sequence number.

| Input | Bytes |
| --- | --- |
| P2PKH, for comparison | 141 |
| Recoverable address, spent by its key | 296 |
| Recoverable address, swept | 260 |
| Vault address | 217 |
| Controller, `ownerAuthorize` | 637 |
| Controller, `requestRecovery` | 658 |
| Controller, `finalizeRecovery` | 637 |
| Controller, `ownerUpdate` | 683 |
| Controller, `ownerClose` | 637 |

## Whole transactions

At one satoshi per byte the fee in satoshis is the size in bytes. In every transaction below the fee was set to exactly the size, and both the virtual machine and the node accepted it.

| Transaction | Bytes |
| --- | --- |
| Payment by key, one input, change to an address of the wallet | 384 |
| Payment by key, one input, no change | 340 |
| For comparison: P2PKH payment, one input, P2PKH change | 219 |
| Sweep of 1 coin into one output | 1,099 |
| Sweep of 5 coins into one output | 2,139 |
| Sweep of 20 coins into one output | 6,039 |
| Sweep of 5 coins and a vault coin, one output for each | 2,576 |
| Spend from a vault address to a P2PKH address | 1,046 |
| Cancel, fee from a coin of the wallet, with change | 1,135 |
| Change of settings (`ownerUpdate`), fee from a coin of the wallet, with change | 1,181 |
| Request, fee from the recoverer's P2PKH coin, with change | 991 |
| Completion, fee from the recoverer's P2PKH coin, with change | 970 |
| Close with one coin of the wallet, to a P2PKH address | 977 |

A sweep costs 839 bytes for the controller and one output, and 260 for each coin.

## Against the proposal's figures

| Section | The proposal says | Measured |
| --- | --- | --- |
| 5.8 | Controller input 637 bytes with the closing action | 637 |
| 5.8 | Closing with no other input: 1,000 − 681 = 319 satoshis, cannot be sent | 681 bytes; the node refuses it as dust |
| 5.8 | Closing together with other coins adds 1,000 satoshis and 637 bytes | The same. With one coin of the wallet the transaction is 977 bytes. |
| 5.8 | Every other controller transaction is 45 bytes larger | 457 − 412 = 45 |
| 7.4 | 96 and 75 bytes of rules; scripts of 150 and 108 bytes | The same |
| 7.4 | An input spent by its key about 300 bytes, a swept input about 260, P2PKH about 140 | 296, 260, 141 |
| 8 | A change output costs 44 bytes now and about 300 when it is spent | 44 and 296 |
| 8 | Emptying needs about 900 satoshis in one coin at an address of the wallet | 546 + 340 = 886 |
| 9.6 | A controller transaction is about 1,000 bytes; a request and a completion cost about 2,000 satoshis | 991 + 970 = 1,961 |
| 9.6 | An allowance for four requests and one completion | 4 × 991 + 970 = 4,934 satoshis before any margin |
| 19 | Transactions are about twice the bytes per input | 296 against 141 per input; 384 against 219 for a whole payment with change |

Three figures the proposal does not give:

- **A vault input is 217 bytes.**
- **A cancellation paid by a coin of the wallet is 1,135 bytes with change and 1,091 without.** The coin kept for cancelling (section 8) therefore has to hold at least 1,091 satoshis for one cancellation.
- **A change of settings is 1,181 bytes** with a fee coin of the wallet and change.

## Refusals

In the virtual machine, each refusal comes from the script that is meant to refuse. Inputs are checked in order, so a refusal by input 1 means that the controller at input 0 was satisfied.

| Test | Case | Result |
| --- | --- | --- |
| AD01 | A coin spent by its key, no controller in the transaction | Accepted |
| AD02 | The same with another key | Refused by the address |
| AD03 | Two coins and a vault coin swept with the owner's approval | Accepted |
| AD04 | A sweep with the wrong secret; one naming another identity; a vault spend with the wrong secret | Refused by the address, each |
| AD05 | A sweep attached to a request; to a completion; a vault spend attached to a request | Refused by the address, each, with the controller satisfied |
| AD06 | The controller not at input 0 | Refused by the address at input 0 |
| AD06 | Another wallet's controller, with the sweep naming this wallet, and naming that wallet | Refused by the address, both |
| AD06 | A successor with a changed owner, recoverer or waiting period | Refused by the address, each |
| AD12 | A sweep beside an `ownerUpdate` that changes nothing | Accepted |

These are checks made in passing, with one signing type. They do not close the tests; stage 1 does.

## The same on a real node

One wallet's life on the local node, Bitcoin Cash Node 29.2.0 in regtest mode with the relay rules of the public networks. Each transaction was checked in the virtual machine, tried with `testmempoolaccept`, and sent. The whole run takes about a third of a second.

| Step | Bytes | Virtual machine | Node |
| --- | --- | --- | --- |
| Create the controller | 333 | accepted | accepted |
| Receive at three addresses, a vault address, and fee coins | 439 | accepted | accepted |
| Pay by key, signed by another key (AD02) | 384 | refused | refused, script |
| Pay by key, with change to a fresh address | 384 | accepted | accepted |
| Request with a sweep attached (AD05) | 1,110 | refused | refused, script |
| Request recovery to a stranger's key | 991 | accepted | accepted |
| Cancel, fee from the wallet's coin kept for it | 1,135 | accepted | accepted |
| Request recovery to the new device's key | 991 | accepted | accepted |
| Complete right after the request | 970 | accepted | refused, `non-BIP68-final` |
| Complete when the chain's median time is 511 seconds past the reference | 970 | accepted | refused, `non-BIP68-final` |
| Complete at 512 seconds | 970 | accepted | accepted |
| Sweep approved by the earlier owner's key (AD07) | 1,099 | refused | refused, script |
| Sweep with a wrong secret (AD04) | 1,099 | refused | refused, script |
| Sweep four coins to an address of the new seed | 1,879 | accepted | accepted |
| Spend the vault coin, approved by the earlier owner (AD09) | 1,056 | refused | refused, script |
| Spend the vault coin to an address of the new seed | 1,056 | accepted | accepted |
| Close with nothing else in the transaction | 681 | refused, dust | refused, `dust` |
| Close signed by the recoverer | 1,273 | refused | refused, script |
| Close: the last coins and the controller's value in one output | 1,273 | accepted | accepted |

`testmempoolaccept` gave the same answer as sending in all nineteen steps. After the closing, the controller's output is spent and one P2PKH output holds everything.

Two things the run showed about the waiting period:

- **The virtual machine does not judge it.** It accepts a completion whatever the time; only the node, or this project's simulated chain, refuses one that is early.
- **The wait is counted from the median time of the block before the one that holds the request,** and it is over when the chain's median time is 512 seconds later, to the second. With the node's clock held still, block times still move forward by a second every few blocks, because a block must be later than the median of the eleven before it. A test therefore reads the reference from the node; it does not assume it.

## What remains open

- The tests of stage 1 (AD01–AD13, CT13–CT15) in the repository's own test suite, under both signing types, with tokens.
- Inputs and outputs that carry tokens were not measured. An output with a token is larger and has a higher smallest value.
- The keys came from fixed test values, not from the key tree of section 7.2.
