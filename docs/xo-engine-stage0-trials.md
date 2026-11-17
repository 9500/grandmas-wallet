# XO engine trials for the v0.4 design

**Date:** 17 Nov 2026 · **Status:** done. The unmodified XO engine can hold the wallet of the v0.4 design: the controller, one script per address with this project's tags, addresses of an earlier seed, the sweep, and a takeover by a new seed. It does this with its own key tree, which differs from the one the proposal's section 7.2 proposes. That difference is the one decision these trials leave to the owner.

These are the stage 0 trials of `IMPLEMENTATION_PLAN_v0.4.md` that concern the engine. The earlier trials, made for the first design, are in [xo-spike.md](xo-spike.md); what they established still holds and is not repeated here.

The scripts are in `spikes/xo-engine/` (`21-…` to `25-…`, with `regtest.mjs`, `wallet-trial-template.mjs` and `split-templates.mjs`). They use the contracts compiled for the address trial (`spikes/addresses/artifacts/`), the engine `0.1.1-next.18029697917` and the local regtest chain (Bitcoin Cash Node 29.2.0, Fulcrum 2.1.4). Every transaction named below was built and signed by the engine and accepted by the node with the public networks' relay rules.

## Answers

| Question of the plan | Answer | Evidence |
| --- | --- | --- |
| Can a template describe a recoverable address whose tag and key differ per address, and will the engine follow many of them? | Yes | Trials 21, 23, 25 |
| Can the engine use the keys of section 7.2? | No. It uses its own tree. Its tree can meet the requirements behind section 7.2 if the controller and the addresses are separate templates. | Trials 21, 24 |
| Can one invitation carry the controller and several swept inputs, each with its own secret? | Yes | Trials 23, 24 |
| How does a transaction of one template take inputs and outputs of another? | By the engine: an invitation accepts inputs that the account holds under another template, and outputs to scripts of another template. | Trial 24; `xo-spike.md` experiments 11 and 20 |
| Can a new seed, in a new account, take over an identity that another account created? | Yes | Trial 24 |
| Which signing type do the wallet's own inputs use? | `0x41` (`all_outputs`) whenever the engine signs. Its `0x61` signatures are still invalid with several inputs (`xo-engine-signing-bug.md`). This project's own builder signs with `0x61`. | Trials 23, 24: every engine signature was `0x41` and accepted |
| Does the engine's header check work on chipnet with the local fix? | Yes, as recorded: the verified height reaches the tip and follows it (`xo-chipnet-header-verification.md`). Not repeated. | — |
| Can the engine be pointed at the local node? | Yes, with three things it does not offer by itself; see below. Header verification reaches the tip there without errors. | Trial 22 |

## What was done

### One script per address (trials 21, 23, 25)

A template's `defaults` name a locking script and say which keys to make and which variables the caller supplies. `generateLockingBytecodeFromDefaultPolicy('address', { tag, identity, addressSecret })` then gives a new address each time: the engine makes the next key, compiles the script with that key's hash and the caller's tag, and follows the script from then on. The variables are stored with the script and are used again when it is spent.

- The addresses the engine made equal the ones this project's own code computes from the same key hash and tag, byte for byte.
- A second kind of locking script takes the key hash as a variable instead of a key. This is an address of an earlier seed: the account can follow it and sweep it, and cannot spend it by key.
- Coins were received by paying the addresses and nothing else. The engine listed all four, under the wallet's template, as spendable.
- A payment from one address by its key: one input, one output, 340 bytes.
- Making 300 addresses took 4.8 seconds, evenly (16 ms each), and the engine followed all 300.

### The sweep (trials 23, 24)

One invitation with the controller at input 0 and several address inputs. Each swept input is unlocked with the identity and the secret that were stored with its script, so the secrets differ per input without the invitation naming them.

- Single template: the controller and three coins, one of them under a key the account does not hold, 1,609 bytes.
- Separate templates: the controller and two coins, 1,359 bytes, paid to an address of the new seed.

### A new seed takes over (trial 24)

Three processes, each with an empty engine state, as three devices would have:

1. The new device makes its controller key before it knows any identity. Its hash is all it hands out.
2. The old device creates the wallet, receives at two addresses and installs the new device's key as the owner. (`ownerUpdate` was used. A recovery by request and completion changes the owner the same way on chain, and was shown through the engine in `xo-spike.md`.) A coin of the standard wallet template paid the fee in the same invitation.
3. The new device, which never saw the creation, is told the identity, the earlier public keys and the secrets. It makes the controller known to its engine under the key it already has, reproduces both earlier addresses, sees the controller and both coins, sweeps them to an address of its own, and holds the result under its own key.

### The engine on the local node (trial 22)

The engine knows mainnet, chipnet and testnet4. It runs against the local regtest chain when it is given:

- chipnet as the network, which sets the key purpose and the address prefix only;
- a plain WebSocket to the local Fulcrum, in place of a server entry, because listed servers are contacted over TLS only;
- a description of the chain with a checkpoint at block 1 (a checkpoint at the genesis block fails), which `regtest.mjs` reads from the node and the server.

## The engine's keys

Every key the engine makes is at

```
m / P' / T' / 0' / n
```

where `P` is 42415 on test networks and 2415 on mainnet, `T` is the first four bytes of the template's identifier (little-endian, 31 bits), and `n` counts up from 0 for the template, across all its key variables. Trial 21 reproduced the engine's public keys with this project's own derivation.

Consequences:

- **A key cannot be placed elsewhere.** The engine signs only with keys it derived this way. A secret that holds a raw key is not used for signing.
- **Keys belong to a template's exact content.** Adding one input to the trial template changed its identifier and with it every key. A template that holds keys of a wallet must never change.
- **One counter per template.** With the controller and the addresses in one template, the controller key and the address keys are children of one node (the controller key was number 0 and the addresses 1 to 3 in trial 23), which section 7.2 rules out.
- **Separate templates give separate branches.** In trial 24 the controller key is number 0 under the controller template and the address keys count from 0 under the address template. The two differ in a hardened step, so the extended public key of the address node says nothing about the controller key.
- **Numbers are handed out in order.** A device that restores addresses makes them again from 0 upward, each with its own tag. It cannot register number 57 alone.

### What this means for section 7.2

| Requirement of section 7.2 | With the engine's tree |
| --- | --- |
| Address keys are plain children of one node | Met for each address template: its keys are plain children of `m / P' / T' / 0'` |
| The index is a counter | Met. The engine's own counter, without gaps. |
| The controller key is not on the address chain | Met only if the controller is in a template of its own |
| The blinding seed and the keys are independent | Met. The blinding seed is not a signing key; this project's code derives it from the seed at a path of its own. |
| Everything follows from the twelve words and the network | Met, with one addition: the templates. `T` is fixed by a template's content, so the templates that hold keys are part of the address scheme's version. |
| Two chains, for addresses given out and for change | One counter per template, so two chains need two address templates that differ in one word. The viewing key then holds two extended public keys. |

**Proposed:** take the engine's tree. The constant `S` of section 7.2 is replaced by the `T` of three small, frozen templates: the controller, addresses given out, and change. The paths of section 7.2, the viewing-key record of section 7.6 and the credential's paths of section 9.2 are rewritten accordingly. The requirements behind the layout stay as they are.

The alternative is to keep section 7.2 and sign address inputs with this project's own code. The engine could then not hold the wallet's coins, and each application transaction would be built outside it. It was not tried.

## Division of work

| The engine | This project's code |
| --- | --- |
| Keys and signatures | Secrets, tags, the controller's next state (a template can only join text) |
| One script per address; following them; listing coins | Finding addresses: the quick and the full pass over the ranges, with its own server connection. What is found is then made known to the engine. |
| Building each transaction from the template, the wallet's own and an application's | Choosing coins, the exact fee and the change amount. The engine's fee estimate assumes small inputs. |
| Invitations as the record of what was done | Checking every transaction with this project's script check before it is sent |

## Limits observed

- **One engine in a process or page.** A second `Engine.create` fails ("Cannot configure storage for cache after it has been initialized"), also after the first was stopped.
- **Restoring is linear.** 16 ms for each address made known again: about 3 minutes for 10,000. This counts against large ranges, beside what the lookups cost (`address-ranges-trial.md`).
- **Unspent outputs are listed by script hash,** not by locking script. `listScriptHashes` ties the two together.
- **`executeAction` can still raise an error after sending** (`xo-spike.md`). The trial scripts treat that error as success, as before.

## Not tried

- A waiting period through the engine with the node's clock moved. The contracts' part is covered by the address trial; the engine's part was shown on chipnet for the first design.
- The pages in a browser against the local node.
- An application's template of a third party with a wallet-bound output. The mechanism is the one of trial 24; stage 7 tests it.
- Vault addresses through the engine. They are a script without a key, registered like an earlier seed's address.
