# Chipnet run log

Written by `npm run chipnet -- run`. Transactions marked refused were deliberately invalid and were never mined.

- Wallet identity: `f1ff8fb1ffbaf081d161d67a2d578bff9fa0476ab4dd4dc288b8e7fff83b33b9`
- Server: `wss://chipnet.9500.cash:443`
- Challenge delay: 1 x 512 seconds (time-based)

| Step | What it shows | Result | Transaction | Detail |
| --- | --- | --- | --- | --- |
| prepare | Funds gathered into one output that can create the identity | done | `f1ff8fb1ffbaf081d161d67a2d578bff9fa0476ab4dd4dc288b8e7fff83b33b9` | fee 185 sat |
| genesis | Wallet identity, controller, funds and a Savings Jar created | done | `9e45ba4cf3299e98b15be030376686700caa17d7b5ddc5085b6df3ac61c406dc` | fee 421 sat |
| owner-send | Owner pays from the wallet without the recoverer (C01) | done | `0d20ecaa4fd03cb1d591ed7c144175267f077ca03294df8ff805db0befdcc6a7` | fee 968 sat |
| attack-claim-with-spend | Recoverer tries to take wallet funds in the claim transaction (C07) | refused-as-expected | `dc964288dfeee4dc45d18c7cfb50ba95cba274e9eb8834452d8a8c34273bb371` | network: the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) ; local check: Unable to verify transaction: error in evaluating input index 3: Program failed an OP_VERIFY operation. |
| claim-1 | Recoverer opens a recovery claim, paying its own fee | done | `0abb44bb51b5d5af9438be80a743b5160fddc42b5efa36578524f602dac2608e` | fee 1087 sat |
| attack-early-finalize | Recoverer tries to complete recovery before the delay (C03) | refused-as-expected | `c5483dd8ce4276f5dc2fd33a7f656fdb2e7005b157558cbdbad532321f644c3f` | network: the transaction was rejected by network rules. non-BIP68-final (code 64) ; local check: passes (only chain time can refuse it) |
| cancel | Owner cancels the claim (C05) | done | `3ea29976c9aff952c9db1c5e6978df9f538948dc3d892547092297c102ff684d` | fee 934 sat |
| claim-2 | Recoverer opens a second claim | done | `d737addc23f742fcb5205f233aed379079dc8d16952e2ce350a86c54a5f3ce78` | fee 946 sat |
| finalize | Recoverer completes recovery after the delay; the replacement key becomes owner (C11) | done | `1239d08ada5a3e39f581919978097859fbe879531128176e849cc474ba0cdbaf` | fee 925 sat |
| attack-old-owner-spend | Old owner key tries to spend after recovery (C12) | refused-as-expected | `f72a7838e11e590c38134c9ef32ccdafc8ec80c9b3a8a9f6d7aa8d845a4b63cb` | network: the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) ; local check: Unable to verify transaction: error in evaluating input index 0: Program failed an OP_VERIFY operation. |
| new-owner-send | Replacement key pays from the same wallet outputs | done | `f11eff3b7019ff820d0fbf7a498fed899e427e105afb1283a8fee78422420a2c` | fee 968 sat |
| jar-withdraw | Replacement key withdraws the Savings Jar after its unlock time, without it having moved | done | `39a74bd8209a0fb7b2996d5e46766ac7a9ea2bf6bc9699442f52d85c063d47f6` | fee 1079 sat |
| sweep-wallet-1 | Wallet funds returned | done | `9a9d55ae88016cea33890b71d2098988a869a281cd7ae82ec015505f7fbcf1b1` | fee 924 sat |
| sweep-funder-1 | Funding address returned | done | `81bd6aed24bf7ede24f0f4c0aa35cbf1e0d6417f4e6c57e62fc1ac1cd696efe8` | fee 326 sat |
