# Stage 5 run on the local node: the wallet's whole life through its own code

Written by the run itself (`scripts/run-b.ts local`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.

- Wallet identity: `a9bc4fe7344d74b5a19902ef19aa9dae7949a6c3743e882a63e429c5572d55b1`
- Repository at commit `edef7f3`
- Started 2026-11-17T21:31:34.597Z

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `9268912673da679aa4962b8fb35a93054f4ccc0ce785e919e37aa81c35902997` | 421 | 421 | the controller, the coin for cancelling, an allowance for the recoverer, and the rest |
| pay | `e53f44424ba12cd03fc6b1d99fb13422475746d157df4b61ccda3b2f044f614f` | 384 | 384 | an everyday payment by key |
| request | `0a08a63d76c0ae2d22bd7a5a782165be4d7c657b1b17a1c90ab334b4f1f33901` | 991 | 991 | the recoverer names the new device's key; paid from its fee address |
| complete | `589704677f987b613aac6c6c8806a24ac9bb8e65238b155150620e0bde5d819a` | 970 | 970 | after the waiting period; no coin has moved |
| sweep | `ec55d5b8f2687ef4bdc11f23a75c8cd840160de6ee30d973435d0ad2b1e2f953` | 2437 | 2437 | 6 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed |
| pay | `1dfaa0e74a0e2cd1691d5556137331fd47c96dd633629fc2040d52162cdf79df` | 384 | 384 | the new owner pays from what it swept, by its own key |
| send the NFT | `4387e9c5b12bfe77794820975759ff20750838b5abca5416aa75bf295ca9ac44` | 717 | 717 | unchanged; the fee from another coin |
| close | `5c4ca81cf45f2d1372ad32d2f90e8ed97ea96a0d8e2d5c33fa7fda28165b803f` | 977 | 977 | everything, and the controller's value, back to the address that paid for the run |
| return the allowance | `74276349b3b8b6bea2cf01d4b88cbca1199efaf281fe66b6b9259d690a86ddc7` | 185 | 185 | what the recoverer did not use |

Also observed:

- No address was given out before the creation was confirmed: true.
- Recovery is shown as "off" while no receipt of the recoverer exists.
- The old device holds 96295 satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The recoverer's fee address holds 4900 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's quick pass found 6 coins; the wallet was then reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 10 seconds; the wallet was then "fully-found".
- After the sweep the new device holds everything at its own addresses: 92858 satoshis and the NFT, which it reports as a token of unknown meaning.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 5000000000 satoshis before the run and holds 4999990112 after it: the run cost 9888 satoshis in fees. Nothing is left anywhere else.
