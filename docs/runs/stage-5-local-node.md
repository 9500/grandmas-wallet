# Stage 5 run on the local node: the wallet's whole life through its own code

Written by the run itself (`scripts/run-b.ts local`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.

- Wallet identity: `7f6f64b13fc25ef61add2a4ab3aca270d24bc4c0a16bef8d1be134ff06bd5e0d`
- Repository at commit `83c42ab`
- Started 2026-11-17T21:56:39.185Z

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `30a9fa6fdaedb50b5270e822a05e1ffa52476507e938ca6d6c02b39d041d9382` | 421 | 421 | the controller, the coin for cancelling, an allowance for the recoverer, and the rest |
| pay | `54feb94ec742ee4ba8bef70a33d625614efb8ad9355e43b704e94dd90ffbb9e5` | 384 | 384 | an everyday payment by key |
| request | `9e48db88aaa6519f9d9cb11ee1b4dbe815b7f5b7ae87e537376afd9666e76823` | 991 | 991 | the recoverer names the new device's key; paid from its fee address |
| complete | `fdedd915796eb38605ff7b0ed1acdf5c6bb974281a0cde61b7ed7d860a2ab29b` | 970 | 970 | after the waiting period; no coin has moved |
| sweep | `1a6aef9476e2761b2fdc395ac73ad240c7ad6660fd66554c676fc45b405d3e85` | 2481 | 2481 | 6 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed |
| pay | `7c45b4db3c52ea4dc4b0f0ccd4e1181155f1f61349452a390c25425519a52786` | 384 | 384 | the new owner pays from what it swept, by its own key |
| send the NFT | `f7dd29c95ff8deedae6c91ee97abec53111af510f0fee866a124c69085459e24` | 717 | 717 | unchanged; the fee from another coin |
| close | `14b77c6b3a660ca29e5f5b3eb4e89c434d342e9db11b2b065e2e1f18688e1d3a` | 1273 | 1273 | everything, and the controller's value, back to the address that paid for the run |
| return the allowance | `0b691869e96b12ad8b96cdc24120945ac09c0cd581a82b5587ba6287f19d76c1` | 185 | 185 | what the recoverer did not use |

Also observed:

- No address was given out before the creation was confirmed: true.
- Recovery is shown as "off" while no receipt of the recoverer exists.
- The old device holds 96295 satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The recoverer's fee address holds 4900 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's quick pass found 6 coins; the wallet was then reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 9 seconds; the wallet was then "fully-found".
- After the sweep the new device holds everything at its own addresses: 92814 satoshis, of which 1091 are a coin the sweep put aside for cancelling, and the NFT, which it reports as a token of unknown meaning. It can cancel a request: true.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 5000000000 satoshis before the run and holds 4999989772 after it: the run cost 10228 satoshis in fees. Nothing is left anywhere else.
