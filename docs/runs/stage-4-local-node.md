# Stage 4 run on the local node

Written by the run itself (`scripts/stage-4-run.ts`). An owner's wallet and a recoverer, each on the unmodified XO engine with the wallet's templates, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The recoverer's engine holds its balance only: the controller is unlocked with the recovery key by this project's code and given to the engine as another participant's input, so that a request and a completion are each one transaction paid from the balance.

- Wallet identity: `403edf1fb1c54938e917df92bd82f7f05d36a24f9697c59c56b4fd691d47ca3e`

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `97dab9ff87141308921bab302fe07b9547c653d4c4f253899be3ce980ffd8f45` | 343 | 343 | the recoverer's balance holds a block's reward of its own |
| request | `df10ccf97dea839e80bab2a85e39f1aef146d32cc84581501010ae433a1319fa` | 991 | 991 | one transaction: the controller, unlocked with the recovery key, and a coin of the recoverer's balance for the fee |
| cancel | `bcc6c4ebfe00225615504f485fb0ae02fe7202c2be0d65bab9b1b6826ec8a3c5` | 1135 | 1135 | the fee paid by the smallest coin of the wallet that pays alone, with change if there is enough |
| request | `1d5461f4528d5ab27536ff45d336ec23139211ff34640463330291ac5011f277` | 991 | 991 | one transaction: the controller, unlocked with the recovery key, and a coin of the recoverer's balance for the fee |
| complete | `f5aafbb46c7b749e529adfcb433aeb5274501d057c1ad2aaf06200517a4ce305` | 970 | 970 | after the waiting period, paid from the balance in the same way |
| take in | `2dde5254365d3d1458903f7c6b197423db75337a9bcf534c8385a1c87569d4e3` | 185 | 185 | what an earlier version kept at the wallet's fee address, unlocked with the credential's fee key, into the balance |
| send all | `d0b0ebadc2130df786b96ae2a30796c9380cc1246816b6d9f4196b3ade94f3a4` | 326 | 326 | 9999996537 satoshis to another address, no change |
