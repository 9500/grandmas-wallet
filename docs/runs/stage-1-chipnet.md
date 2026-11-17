# Stage 1 run on chipnet (run A)

Written by the run itself (`packages/chipnet/src/cli.ts`). Transactions marked refused were deliberately invalid and were never mined.

- Chain: chipnet
- Server 1: `wss://chipnet.9500.cash:443` (transactions are sent here)
- Server 2: `wss://chipnet.imaginary.cash:50004`
- Wallet identity: `f8b764eae7125775381ff9b60514c2f5d7839f7247d9cfaea585fa5976e6bd91`
- Waiting period: one unit of 512 seconds
- First step at 2026-11-17T20:20:11.074Z, last at 2026-11-17T20:33:15.649Z, by the chain's clock
- Repository at commit `56ca29f`

## Versions

| | |
| --- | --- |
| cashc (compiler) | 0.14.0 |
| @bitauth/libauth | 3.1.0-next.8 |
| Node.js | v24.11.1 |
| Server 1 | Fulcrum 2.1.4 |
| Server 2 | Fulcrum 2.1.4 |
| Node used for the check before starting | Bitcoin Cash Node:29.2.1 |

## Compiled contracts

| Contract | Bytes | SHA-256 of the bytecode |
| --- | --- | --- |
| controller | 457 | `a10f9d3e2bc3ca2e8e46b04f99305eee8c39a462b0b2237e28f0052fbce9dc00` |
| recoverableAddress | 96 | `14eebecc4b354db4276ebf92438940b14c95a6c312cc49fd8d663785a48fbe68` |
| vaultAddress | 75 | `6504d09e1519558f1dc001f67a93ef5ca5cd3dee1f429b3b59db7db95396f91b` |

## Steps

| Step | What it shows | Result | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- | --- | --- |
| create | The controller is created: the wallet's identity, with its owner, its recoverer and a waiting period of 512 seconds | done | `6628889e963b4569b0a315c59aee7a1f33fc3216258b54445b13cfd7ed182d4e` | 333 | 333 | confirmed before the next step |
| receive | Someone pays three recoverable addresses (two given out, one change) and a vault address; no script of the wallet runs | done | `3dae7c4d308a9856cab2034b609ec86b732879ab31a4118ad643e9afb1520926` | 361 | 361 |  |
| pay | The owner pays from an address by its key, with change to a change address; the controller is not in the transaction (AD01) | done | `c30dba3a8772550399a3d3a3943dd4259122a919822bedd05edc777b390c3b77` | 384 | 384 |  |
| fund-fee | The owner gives the recoverer coins for its fees, at the recoverer's fee address | done | `894e7b339a2930ca521fdf2a0cbd984bfcb5621e4428c2d7e2f0c0a82fa6ad41` | 360 | 360 |  |
| request-1 | The recoverer requests recovery to a new key, paying its own fee | done | `68cd01c28ddb78da066df77948064e6980451d8d7ec2835727f1d3c03a05b422` | 991 | 991 |  |
| cancel | The owner cancels the request; a coin of the wallet, spent by its key, pays the fee (CT04) | done | `ba63ab80440234cb9204059846738455f1f92ede8a4cf7a32ffbe2c3288cb985` | 1135 | 1135 |  |
| request-2 | The recoverer requests recovery again | done | `e48db3c8bfd243da96606b2afa6fc9fe4ea59fdf2494977320f0488dbfb19362` | 991 | 991 |  |
| complete | After the waiting period the recoverer completes; the new key is the owner and no coin has moved (CT07) | done | `e70dcd215015c46130f7c1fe2c9222cc939e4d8abc52048c8c60992eed7da5fe` | 970 | 970 |  |
| sweep | The new owner sweeps every coin at the earlier seed's addresses to an address of its own seed (AD03) | done | `f6e18ce6dd0b647c8612b319c07ca679fee19d8ae0b0279b99c96fd5a66beaef` | 1619 | 1619 |  |
| vault-spend | The new owner spends the coin at the vault address, which never obeyed a key (AD09) | done | `8c4ee9b2f54e3c64d3af5924770148d39099c399077eb3fc06639bb6aff6b5fd` | 1056 | 1056 |  |
| close | The new owner sends everything and closes the wallet: its coins and the controller's value go back in one transaction (CT13) | done | `9176af36e9619753711827bfa1166953df77a36329418aeaf46650dfe7f4e299` | 1273 | 1273 |  |
| return-fee | The recoverer returns what is left of its fee coins | done | `1c4daba06d1126fc67f0b8fb8fe7bfcb556a3b8296c8e2c1d1ff282148f37f07` | 185 | 185 |  |

Accepted transactions: 12, 9658 bytes, 9658 satoshis in fees. Every fee is the transaction's size at one satoshi per byte.

## Refusals

| Step | What was tried | Result | The node's words | This project's own check |
| --- | --- | --- | --- | --- |
| refuse-request-with-sweep | The recoverer tries to take a coin of the wallet in the request itself (AD05) | refused-as-expected | the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) | Unable to verify transaction: error in evaluating input index 2: Program failed an OP_VERIFY operation. |
| refuse-early-completion | The recoverer tries to complete before the waiting period has passed (CT02) | refused-as-expected | the transaction was rejected by network rules. non-BIP68-final (code 64) | passes (only chain time can refuse it) |
| refuse-sweep-by-earlier-owner | The earlier owner's controller key tries to approve a sweep after the recovery (AD07) | refused-as-expected | the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) | Unable to verify transaction: error in evaluating input index 0: Program failed an OP_VERIFY operation. |

## What is left

- At the funding address: 990342 satoshis.
- The controller's history ends with a closing: yes.
- At every other script of the run (the controller, the recoverer's fee address, every address of both seeds): nothing.
