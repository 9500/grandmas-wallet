# Stage 3 run on the local node

Written by the run itself (`scripts/stage-3-run.ts`). The owner's wallet (`packages/app/src/owner-wallet.ts`) on the unmodified XO engine, with the wallet's templates, against the local node in regtest mode with the public networks' relay rules.

- Repository at commit `f93c97e`
- Wallet identity: `20d82a4b5ba3690bcb7c393031ed5a62c9e606f68d9c48adf91f84e09fc98cde`
- Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before sending.

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `0eba141d7e84cc6c2ce7268ef960719b3c7849c6014925e406c1c4fe1302e0ac` | 421 | 421 | with the coin for cancelling and an allowance of 6,000 for the recoverer |
| pay | `c89fd5d3d94c5ea1ca28bd771a193b5ae3dd309ee6253ad9cdd659b996aea93c` | 384 | 384 | with change to a fresh change address |
| send the token | `f687038302f7caee831d913ac46041b024d477ddbe58a1bc59a7857160a1243c` | 717 | 717 | the token unchanged; the fee from another coin |
| change settings | `a9d8bb64cc9941df3a9b4afff0fa462f672f269486c9c0bf40fd14e8b6143d17` | 1181 | 1181 | the waiting period doubled; a coin of the wallet pays, with change |
| send everything | `4e6cf1df5a70f574b911c27ace554130517d7d8fc12af82eadf689892454b93e` | 2230 | 2230 | the vault coin goes with the controller |
| close | `41bb4ba1deac3124034425d1fa1373242d0754c677646ec2c096bcf775753ffc` | 977 | 977 | the last coin and the controller's value to one address |

Also observed: no address was given out before the creation was confirmed; recovery was shown as off; closing was refused before the full search had finished; after sending everything the wallet said that it could not cancel; the controller's history ends with a closing.
