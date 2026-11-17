# Stage 5 run on the local node: the wallet's whole life through its own code

Written by the run itself (`scripts/run-b.ts local`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.

- Wallet identity: `eec9182c870ebb83087c22f56765b56257359f729dbc67d9607026ee9667d690`
- Repository at commit `603e126`
- Started 2026-11-17T21:21:32.329Z

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `ce5263a671a3e1240a40d9d0dfeea14c2ec60235dd6c72397e1165f8569c5f4a` | 421 | 421 | the controller, the coin for cancelling, an allowance for the recoverer, and the rest |
| pay | `2c3dd847f21f8f654338fba6db31d18b63a17b4633cdcb04768e4bf15da5b69a` | 384 | 384 | an everyday payment by key |
| request | `6b3b4e51f290981701f5f9a6c2922af8f819b6cbbbd26e549aa123859c59f438` | 991 | 991 | the recoverer names the new device's key; paid from its fee address |
| complete | `4573dbe464f9494940f3169172049cb5290565851bb53bc860de8ad75fb335ac` | 970 | 970 | after the waiting period; no coin has moved |
| sweep | `9a5c4f4f2775c6b1445cd0cce76f83d14204dbc050417c81e6805b5186b44e91` | 2437 | 2437 | 6 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed |
| pay | `68ed97daf83f5020af06946273e76a4b8b6b4802f82304209f0f336b754d868f` | 384 | 384 | the new owner pays from what it swept, by its own key |
| send the NFT | `728939592862fef26eafdfdeb02bf2091bbfbd2ae9b22c2b7e1a44ca25a92ebb` | 717 | 717 | unchanged; the fee from another coin |
| close | `637819247671c505a2e3703065268ab1e20992e9ca0e6242fe68cd693b3d964a` | 977 | 977 | everything, and the controller's value, back to the address that paid for the run |
| return the allowance | `3f585a17d6984d2f663f79fe0908af47b3dcc57aca980fd29a2df28bd8c1e42c` | 185 | 185 | what the recoverer did not use |

Also observed:

- No address was given out before the creation was confirmed: true.
- Recovery is shown as "off" while no receipt of the recoverer exists.
- The old device holds 96295 satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The recoverer's fee address holds 4900 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's quick pass found 6 coins; the wallet was then reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 9 seconds; the wallet was then "fully-found".
- After the sweep the new device holds everything at its own addresses: 92858 satoshis and the NFT, which it reports as a token of unknown meaning.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 5000000000 satoshis before the run and holds 4999990112 after it: the run cost 9888 satoshis in fees. Nothing is left anywhere else.
