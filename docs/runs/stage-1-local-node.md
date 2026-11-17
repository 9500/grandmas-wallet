# Stage 1 run on the local node

Written by the run itself (`packages/chipnet/src/cli.ts`). Transactions marked refused were deliberately invalid and were never mined.

- Chain: local node, regtest, with mainnet's rules and the public networks' relay rules
- Server: Fulcrum at `ws://127.0.0.1:60403`; blocks made and the clock moved through the node's RPC
- Wallet identity: `82f776b813403e2c5b7110ea5ae77d08d19ae86f9be3bf38c81ff3e21366e56f`
- Waiting period: one unit of 512 seconds
- First step at 2026-11-17T20:45:29.000Z, last at 2026-11-17T20:55:47.000Z, by the chain's clock
- Repository at commit `c7f34f3, with changes not yet committed`
- The run was stopped and continued from its saved state: it was started 3 times (2026-11-17T20:17:17.624Z, 2026-11-17T20:17:18.833Z, 2026-11-17T20:17:19.644Z)

## Versions

| | |
| --- | --- |
| cashc (compiler) | 0.14.0 |
| @bitauth/libauth | 3.1.0-next.8 |
| Node.js | v24.11.1 |
| Node | Bitcoin Cash Node:29.2.0 |
| Server | Fulcrum 2.1.4 |

## Compiled contracts

| Contract | Bytes | SHA-256 of the bytecode |
| --- | --- | --- |
| controller | 457 | `a10f9d3e2bc3ca2e8e46b04f99305eee8c39a462b0b2237e28f0052fbce9dc00` |
| recoverableAddress | 96 | `14eebecc4b354db4276ebf92438940b14c95a6c312cc49fd8d663785a48fbe68` |
| vaultAddress | 75 | `6504d09e1519558f1dc001f67a93ef5ca5cd3dee1f429b3b59db7db95396f91b` |

## Steps

| Step | What it shows | Result | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- | --- | --- |
| create | The controller is created: the wallet's identity, with its owner, its recoverer and a waiting period of 512 seconds | done | `5fd82cd197853294770c9bf5d0fa596d409ce52533693cef35ecfa4490bca5b1` | 333 | 333 | confirmed before the next step |
| receive | Someone pays three recoverable addresses (two given out, one change) and a vault address; no script of the wallet runs | done | `b8d1cbad3929169d26942c9d4b21bdaca1a990133b9baa780d108236bd6a2fd9` | 361 | 361 |  |
| pay | The owner pays from an address by its key, with change to a change address; the controller is not in the transaction (AD01) | done | `63d8e8748b0df716eba728110feb700ae9dde2fd56c146e693531e5c1a1d9560` | 384 | 384 |  |
| fund-fee | The owner gives the recoverer coins for its fees, at the recoverer's fee address | done | `d18cd3389e5aaec295947822c2b276dad7b3f34def26951fcad2a2bee63e3e05` | 360 | 360 |  |
| request-1 | The recoverer requests recovery to a new key, paying its own fee | done | `a7af6d58981489111a7067d3e346609e77a3ea2c973e056f584531ced13e8d60` | 991 | 991 |  |
| cancel | The owner cancels the request; a coin of the wallet, spent by its key, pays the fee (CT04) | done | `94e8f6ce79e415783272ec3f1cd6d42dc2a186e4931a94e9022d5054591fe371` | 1135 | 1135 |  |
| request-2 | The recoverer requests recovery again | done | `0539fc8ec47d1c07fe5baddca7eb5fbc11da633ab9e8e451dc72640a50c6018f` | 991 | 991 |  |
| complete | After the waiting period the recoverer completes; the new key is the owner and no coin has moved (CT07) | done | `152263362cb96d2b94a146e55864df7cdb69d3329e75f9e7d789d48ff82b421f` | 970 | 970 |  |
| sweep | The new owner sweeps every coin at the earlier seed's addresses to an address of its own seed (AD03) | done | `4b618d80cb082a1861729c366e84f2963c55a96f9542e782cb153b9d434ddf51` | 1619 | 1619 |  |
| vault-spend | The new owner spends the coin at the vault address, which never obeyed a key (AD09) | done | `1a4e759c94595bcff021a70bd9b31ed094afb813d65d90d2f6bfc1d860377c65` | 1056 | 1056 |  |
| close | The new owner sends everything and closes the wallet: its coins and the controller's value go back in one transaction (CT13) | done | `bcb9da41aa7ec5ce3ddf1fcbfa86b74995f5ff9d911ef19eb311db95660ae7a8` | 1273 | 1273 |  |
| return-fee | The recoverer returns what is left of its fee coins | done | `5fd73b77c6440a5205f27f72044297afaf04d50a8167ccf6a2702b25259fba7b` | 185 | 185 |  |

Accepted transactions: 12, 9658 bytes, 9658 satoshis in fees. Every fee is the transaction's size at one satoshi per byte.

## Refusals

| Step | What was tried | Result | The node's words | This project's own check |
| --- | --- | --- | --- | --- |
| refuse-request-with-sweep | The recoverer tries to take a coin of the wallet in the request itself (AD05) | refused-as-expected | the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) | Unable to verify transaction: error in evaluating input index 2: Program failed an OP_VERIFY operation. |
| refuse-early-completion | The recoverer tries to complete before the waiting period has passed (CT02) | refused-as-expected | the transaction was rejected by network rules. non-BIP68-final (code 64) | passes (only chain time can refuse it) |
| refuse-sweep-by-earlier-owner | The earlier owner's controller key tries to approve a sweep after the recovery (AD07) | refused-as-expected | the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) | Unable to verify transaction: error in evaluating input index 0: Program failed an OP_VERIFY operation. |

## What is left

- At the funding address: 156240342 satoshis.
- The controller's history ends with a closing: yes.
- At every other script of the run (the controller, the recoverer's fee address, every address of both seeds): nothing.
