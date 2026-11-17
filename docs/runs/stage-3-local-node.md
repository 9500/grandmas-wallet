# Stage 3 run on the local node

Written by the run itself (`scripts/stage-3-run.ts`). The owner's wallet (`packages/app/src/owner-wallet.ts`) on the unmodified XO engine, with the wallet's templates, against the local node in regtest mode with the public networks' relay rules.

- Repository at commit `457dfc9`
- Wallet identity: `282a83ad952c9490afe427e82e74f8def6730ac2d7b0fbe1b0ded65239f535a0`
- Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before sending.

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `5bd0eb8dabd006a08cbd030de37f8b82a43df907dc60253b6741df1d59df5650` | 421 | 421 | with the coin for cancelling and an allowance of 6,000 for the recoverer |
| pay | `0c32668e2f771ad5286e3e45937fb6aee4017949238eec00644080b51e03f872` | 384 | 384 | with change to a fresh change address |
| send the token | `7c2bfe089e027614b24c66a10d708e0bd68dd82e9013e2f9789626317357877e` | 717 | 717 | the token unchanged; the fee from another coin |
| change settings | `5a59c97965217161d6fa306bb9d243a759ec42ca4a0e0ee9018b953b088a649e` | 1181 | 1181 | the waiting period doubled; a coin of the wallet pays, with change |
| send everything | `90a611b7344a205df386c2e9c6d307991a3378139b20e48926bb20c08ad644f6` | 2230 | 2230 | the vault coin goes with the controller |
| close | `c3148134c3221efe04ce2a6046dd11aa3d13cb7d0317e1e5590ab03db9011724` | 977 | 977 | the last coin and the controller's value to one address |

Also observed: no address was given out before the creation was confirmed; recovery was shown as off; closing was refused before the full search had finished; after sending everything the wallet said that it could not cancel; the controller's history ends with a closing.
