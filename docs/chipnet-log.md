# Chipnet run log

Written by `npm run chipnet -- run`. Transactions marked refused were deliberately invalid and were never mined.

- Wallet identity: `1a2e586aad9ca8e60a3332d78e690f41960abea28248edafcb05673429f94be1`
- Server: `wss://chipnet.9500.cash:443`
- Challenge delay: 1 x 512 seconds (time-based)

| Step | What it shows | Result | Transaction | Detail |
| --- | --- | --- | --- | --- |
| prepare | Funds gathered into one output that can create the identity | done | `1a2e586aad9ca8e60a3332d78e690f41960abea28248edafcb05673429f94be1` | fee 185 sat |
| genesis | Wallet identity, controller, funds and a Savings Jar created | done | `90bea9e16a45258c0219d4c7a001659fea5a90bbf0db2007a77bd2a1ed1ebf41` | fee 421 sat |
| owner-send | Owner pays from the wallet without the recoverer (C01) | done | `9dea653fae6bb681292d3e4952e57ff303538a27c679340b41b6ff54710ec19f` | fee 1098 sat |
| attack-claim-with-spend | Recoverer tries to take wallet funds in the claim transaction (C07) | refused-as-expected | `e8d32235ece9f71d0b32b9bb962e029d959f95671f6f9942bac8cd3c7c0eda20` | network: the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) ; local check: Unable to verify transaction: error in evaluating input index 3: Program failed an OP_VERIFY operation. |
| claim-1 | Recoverer opens a recovery claim, paying its own fee | done | `03107cf37b289f6b1a3e0e391e0a420e5ab84059a298c7bb513643f83eb81092` | fee 1087 sat |
| attack-early-finalize | Recoverer tries to complete recovery before the delay (C03) | refused-as-expected | `2e415972be9a3486f17c49e48350d6424e29a0e02e5dadf90dc81be87f154ff0` | network: the transaction was rejected by network rules. non-BIP68-final (code 64) ; local check: passes (only chain time can refuse it) |
| cancel | Owner cancels the claim (C05) | done | `b028b1c113b8b8a84d8acb44be5560ac3743945a31563bff75fc6e58b9632a8c` | fee 1064 sat |
| claim-2 | Recoverer opens a second claim | done | `17ec2804360e769da1cee7ddc7f72f556a930744dd5bc5d925c5d99ed2d2f77b` | fee 946 sat |
| finalize | Recoverer completes recovery after the delay; the replacement key becomes owner (C11) | done | `630c8750b2e680cd8bd1d86cae10136c067c8c0245305f92a110670388d9fd05` | fee 925 sat |
| attack-old-owner-spend | Old owner key tries to spend after recovery (C12) | refused-as-expected | `800875f830d430e21386582001027d281aec7f43af33f3ce0e6a556f3ca7ebee` | network: the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16) ; local check: Unable to verify transaction: error in evaluating input index 0: Program failed an OP_VERIFY operation. |
| new-owner-send | Replacement key pays from the same wallet outputs | done | `cd19c212c97851746c205723b4003cf838c7d2dcefb3872a3812c63177ed8753` | fee 1098 sat |
| jar-withdraw | Replacement key withdraws the Savings Jar after its unlock time, without it having moved | done | `cd6580aeffb8080626522df9141b3934f9563e549d62d80dac0c12059a2e5729` | fee 1342 sat |
| sweep-wallet-1 | Wallet funds returned | done | `f08aece45a9e615ac931fd740476baa3a038f1e3191b4252994cd1b74b22069e` | fee 1054 sat |
| sweep-funder-1 | Funding address returned | done | `4ac2a781802708064f5c081b2f11e296a92cc03b6b5c5b47794ba9c0d25fff31` | fee 326 sat |
