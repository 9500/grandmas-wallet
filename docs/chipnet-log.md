# Chipnet run log

Written by `npm run chipnet -- run`. Transactions marked refused were deliberately invalid and were never mined.

- Wallet identity: `1819a56a9094983ba24ed3a85906c0c07261eac47e37b50454059a56481e656b`
- Server: `wss://chipnet.9500.cash:443`
- Challenge delay: 1 x 512 seconds (time-based)

| Step | What it shows | Result | Transaction | Detail |
| --- | --- | --- | --- | --- |
| selftest-1 | Funds sent to their own address | done | `377ee5eb6e661ee85b449e5e539ff9a02bee266549ad9b94266d96a83717835a` | fee 185 sat |
| prepare | Funds gathered into one output that can create the identity | done | `1819a56a9094983ba24ed3a85906c0c07261eac47e37b50454059a56481e656b` | fee 185 sat |
| genesis | Wallet identity, controller, funds and a Savings Jar created | done | `6a16f4c08fe9d741adeb4aeacae5e87589d7c8dadfa895eb13026312d412c140` | fee 421 sat |
| owner-send | Owner pays from the wallet without the recoverer (C01) | done | `c4afdcaa9acf0a5f50cf1d5906e455f2b0ae0352dc673eab473a6bf46d1fe1ff` | fee 1048 sat |
| attack-claim-with-spend | Recoverer tries to take wallet funds in the claim transaction (C07) | refused-as-expected | `abf9b5c443678683c1b1a49edec8b5d60d5e9b2e4440ba797d3136b1340c5e32` | network: the transaction was rejected by network rules.

mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16)
; local check: Unable to verify transaction: error in evaluating input index 3: Program failed an OP_VERIFY operation. |
| claim-1 | Recoverer opens a recovery claim, paying its own fee | done | `8b5c8a2f11bc8b72d450c8e2833f669756d4d4c8c23b2c161b994b75a8661732` | fee 1044 sat |
| attack-early-finalize | Recoverer tries to complete recovery before the delay (C03) | refused-as-expected | `c85d630e66194801df61962b68907a72de081790364b70b66ef7a2273ca173f8` | network: the transaction was rejected by network rules.

non-BIP68-final (code 64)
; local check: passes (only chain time can refuse it) |
| cancel | Owner cancels the claim (C05) | done | `3a6fe2a990e6f0cca1548e7dadb8a01b6d5595b796957982ebb72ef7ceccf4bc` | fee 1014 sat |
| claim-2 | Recoverer opens a second claim | done | `8ac7680318b2b041d224d46dc354671754276b6b0661cf8e23961eb805a0490a` | fee 903 sat |
| finalize | Recoverer completes recovery after the delay; the replacement key becomes owner (C11) | done | `412814c2017bcf3dea48c1b7f51eaa9cf8626f3688b138652fe98f7d34f31c2d` | fee 882 sat |
| attack-old-owner-spend | Old owner key tries to spend after recovery (C12) | refused-as-expected | `9595c076c6fd00c385b764fc26947cf45cfd756811dd47aff62d4a85c3f053e8` | network: the transaction was rejected by network rules.

mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16)
; local check: Unable to verify transaction: error in evaluating input index 0: Program failed an OP_VERIFY operation. |
| new-owner-send | Replacement key pays from the same wallet outputs | done | `fc8d2ab576fb83569c9272360d8bd13bdc9677181c240e001b3e56e851df22b6` | fee 1048 sat |
| jar-withdraw | Replacement key withdraws the Savings Jar after its unlock time, without it having moved | done | `64a75adbf870b7776c880db292dee13c054af908b2150624b6c203c868ebb9cf` | fee 1285 sat |
| sweep-wallet-1 | Wallet funds returned | done | `df75e78b468c08568e851c682620949cf1c4cc61f687e5d29585cf94d4b08d0f` | fee 1004 sat |
| sweep-funder-1 | Funding address returned | done | `3fad96b581c191985f2afc930a8f5ef0790a6e89fd022f5b9e3b1df9e48fe13c` | fee 326 sat |
