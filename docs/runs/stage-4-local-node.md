# Stage 4 run on the local node

Written by the run itself (`scripts/stage-4-run.ts`). An owner's wallet and a recoverer, each on the unmodified XO engine with the wallet's templates, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state.

- Wallet identity: `5aea6cc8e4d878b76b6a7b516dfd98df3ea4415cb2428dcec05bbde1ece9ec5f`

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `6d120a3ddfcb69f059dcbf77e1889841d75cacc2a119bf87ecc3fb9f1faf6634` | 421 | 421 | with an allowance of 4900 for the recoverer: four requests and one completion |
| request | `8371147a2071f9746681ceb6b91767fdf2167ff9bbf53c8669fdf523856c897d` | 991 | 991 | paid from the recoverer's fee address |
| cancel | `3b8f98602ebb0537fb6fffc2362e7d39c0fa29fc13cef5133be6dce2ed5ecccc` | 1091 | 1091 | paid by the coin kept for cancelling, exactly |
| request | `4cc590d11898c81a151eb2d2726eb93579a4f05836664e88a65ac13b6d54c0fb` | 991 | 991 | paid from the recoverer's fee address |
| complete | `64334ae576c1369a914b9b8f7384c90b8357abe220651100d12f8e98044c96a4` | 970 | 970 | after the waiting period |
