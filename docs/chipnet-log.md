# Chipnet run log

Written by `npm run chipnet -- run`. Transactions marked refused were deliberately invalid and were never mined.

- Wallet identity: `ffc65007e29e31f46d50755bf812f1a05364b6cf0d2683264d379826a82f9939`
- Server: `wss://chipnet.9500.cash:443`
- Challenge delay: 1 x 512 seconds (time-based)

| Step | What it shows | Result | Transaction | Detail |
| --- | --- | --- | --- | --- |
| prepare | Funds gathered into one output that can create the identity | done | `ffc65007e29e31f46d50755bf812f1a05364b6cf0d2683264d379826a82f9939` | fee 185 sat |
| genesis | Wallet identity, controller, funds and a Savings Jar created | done | `cd81b724d4e0f9f3dd697f7b5ad02f8f09a1ac1672a8bf6d298c7d24817610ac` | fee 421 sat |
| owner-send | Owner pays from the wallet without the recoverer (C01) | done | `972b13af4a03bb8372e4010a7d39ef09302a5e5387c9f7a3473bc5a53bf67cf7` | fee 1084 sat |
| attack-claim-with-spend | Recoverer tries to take wallet funds in the claim transaction (C07) | refused-as-expected | `a45c3f2aa604d8e53fba4bf5598f80466b67f327160c94bdc56618b7dfaaa279` | network: the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) ; local check: Unable to verify transaction: error in evaluating input index 3: Program failed an OP_VERIFY operation. |
| claim-1 | Recoverer opens a recovery claim, paying its own fee | done | `7590a4531a760700cbcd5bbe8bd01b92fbed24a56f394174d62dd972043d08f0` | fee 1080 sat |
| attack-early-finalize | Recoverer tries to complete recovery before the delay (C03) | refused-as-expected | `f79ec5ebf61515571e9a176e1a6ab22538d14196e4ae467bbd70fb90a31f5836` | network: the transaction was rejected by network rules. non-BIP68-final (code 64) ; local check: passes (only chain time can refuse it) |
| cancel | Owner cancels the claim (C05) | done | `d9d229c8a72355c148f3dec0d988c96442233e800d5aecd92a802d2694381409` | fee 1050 sat |
| claim-2 | Recoverer opens a second claim | done | `8c5f08d3d5ef5f4944f76c6d0fa728b936862d63b5339938ad29a882f38d0865` | fee 939 sat |
| finalize | Recoverer completes recovery after the delay; the replacement key becomes owner (C11) | done | `033c1dc36ca234cbd5d0c5f17d96f5079c22a1489a6a888d087b4268dcde1f2f` | fee 918 sat |
| attack-old-owner-spend | Old owner key tries to spend after recovery (C12) | refused-as-expected | `ba2d64f3781614b778feaab462d67ff3a1109dcd4cb252c54bff994def055b86` | network: the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) ; local check: Unable to verify transaction: error in evaluating input index 0: Program failed an OP_VERIFY operation. |
| new-owner-send | Replacement key pays from the same wallet outputs | done | `65fa7f8c18e061787ad95e489adc9d59d20183780f1dd925b2247d40dffd7aca` | fee 1084 sat |
| jar-withdraw | Replacement key withdraws the Savings Jar after its unlock time, without it having moved | done | `89ff837f739a1e80dbcb867d60da1c9b699abda2aadab7449dcec1d10512a5e3` | fee 1321 sat |
| sweep-wallet-1 | Wallet funds returned | done | `275aca780e858bee7a355bf3d6b4744cfc0771a37ab36aa42964b8acc23a2985` | fee 1040 sat |
| sweep-funder-1 | Funding address returned | done | `a1aad8078ea97833c9f0b22c79eee498f5697aa09dd76b50a7589b47e98d04e8` | fee 326 sat |
