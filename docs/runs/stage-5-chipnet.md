# Stage 5 run on chipnet (run B): the wallet's whole life through its own code

Written by the run itself (`scripts/run-b.ts chipnet`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates, on chipnet. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.

- Wallet identity: `cd31466c5311a8bd532d51bb8935eb8ddb2a450338d07e3ffbfe2b27523fcda1`
- Repository at commit `f8c351e`
- Started 2026-11-17T21:32:16.170Z
- The engine ran with the local fix for chipnet's block timing (`docs/xo-chipnet-header-verification.md`); without it its header check stops below the tip.
- The engine was given one server. With three, the first start of this run ended while waiting for a block: the engine's network package asks every server for a new block's header and takes the first answer, and a server that had not seen the block yet answered first, with nothing. The run was continued with the same command.

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `a9387aa2dd9d4e43d1cc7547e0b3ad75bf8600142dc1466957d01820f5354a81` | 421 | 421 | the controller, the coin for cancelling, an allowance for the recoverer, and the rest |
| pay | `25839e2692ee0292a141bd7d16be8c01f507107d5aa4ff0f23a7b70c0c85f07d` | 384 | 384 | an everyday payment by key |
| request | `3117ec80443764f20b8b250a1e79c2d5827fcdfa5b643a742b218daaaa2ac054` | 991 | 991 | the recoverer names the new device's key; paid from its fee address |
| complete | `330a4cf6b87ae19d3673cae58945c778d84834368d0fcdd946de21677cd8626a` | 970 | 970 | after the waiting period (7 minutes); no coin has moved |
| sweep | `285b6c37aacdbc5d5f39fdf272c20b483d2049bd21983ab3229a05f7be9dec12` | 2437 | 2437 | 6 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed |
| pay | `7194905df6f45ac0c63a2e7b8abaa1a37d0abf21a7c58948df2a7a407f95488e` | 384 | 384 | the new owner pays from what it swept, by its own key |
| send the NFT | `6e2b841098d7fcf3a1f309e0779ac1c4012b13d8d955fc1bce48f3676e8354c2` | 717 | 717 | unchanged; the fee from another coin |
| close | `6107543b681dc20baef356ba171bf62c52cf96df4c17a5e765f2669f546e9786` | 977 | 977 | everything, and the controller's value, back to the address that paid for the run |
| return the allowance | `78feb687e45f523f5c27bb1b083d148e6eb6d0306fc28f551cc69b8ded76d389` | 185 | 185 | what the recoverer did not use |

Also observed:

- No address was given out before the creation was confirmed: true.
- Recovery is shown as "off" while no receipt of the recoverer exists.
- The old device holds 96295 satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The recoverer's fee address holds 4900 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's quick pass found 6 coins; the wallet was then reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 12 seconds; the wallet was then "fully-found".
- After the sweep the new device holds everything at its own addresses: 92858 satoshis and the NFT, which it reports as a token of unknown meaning.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 990342 satoshis before the run and holds 980172 after it: the run cost 10170 satoshis in fees. Nothing is left anywhere else.
