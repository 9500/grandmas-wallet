# Stage 5 run on the local node: the wallet's whole life through its own code

Written by the run itself (`scripts/run-b.ts local`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.

- Wallet identity: `e0dadd7cb715c4d7d0512472b42fd9b94396e9137a7a53744f544229ca151ba4`
- Repository at commit `a0a9397`
- Started 2026-11-22T13:09:11.084Z
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `.chipnet/invitations/stage-5-local-node/`, with `index.json` naming the template, action and role of each.

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `3f74381c7d1041d92da670bf890f33f5182fc7483f0ee4cdb1f5c1a655c2b135` | 343 | 343 | the controller and the rest | `01-the-owner-s-device-create-3f74381c.json` |
| pay | `e2bc65f9387984902e1c74d644e33481ac9551b61258bedf6f78a8511b7cf7ee` | 384 | 384 | an everyday payment by key | `03-the-owner-s-device-pay-e2bc65f9.json` |
| request | `c8af87e94f227d87cfad08b4db87612e75f22209937f3c1b9da6646ff2225076` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | `04-the-recoverer-pay-c8af87e9.json` |
| complete | `79e2977788272cc200c64a53edab78dfd171be433f4a5c81dd049d6294a0f014` | 970 | 970 | after the waiting period; no coin has moved | `05-the-recoverer-pay-79e29777.json` |
| sweep | `1abf6a4ea9a92318b7a4b7142f911d067be9ee7ca7de0ef2e5b771546457d33f` | 2177 | 2177 | 5 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed | `06-the-new-device-approve-1abf6a4e.json` |
| pay | `10aad12b136d6bad0a64d8e470ab5730c2cbdeac0aa8488f7347398d32a53bfa` | 384 | 384 | the new owner pays from what it swept, by its own key | `07-the-new-device-pay-10aad12b.json` |
| send the NFT | `d8240f5d0b52df330bb41ea2c11f25fb6c250b1e7bb88e751ef321bccbf4afbc` | 717 | 717 | unchanged; the fee from another coin | `08-the-new-device-pay-d8240f5d.json` |
| close | `5e3ff57fbeab09ad74329f3228f2bebfc2b6acdcb641309b6d6753fa94659bb8` | 977 | 977 | everything, and the controller's value, back to the address that paid for the run | `09-the-new-device-close-5e3ff57f.json` |
| return the recoverer's balance | `e1e51c4f0e91cafc01b272ba1c8aed103d8850e84126d8806e833e0b2a759e7c` | 185 | 185 | what the recoverer did not use | `10-the-recoverer-pay-e1e51c4f.json` |

Also observed:

- Recovery is shown as "off" while no receipt of the recoverer exists.
- The old device holds 95889 satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The recoverer's balance holds 5000 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's quick pass found 5 coins; the wallet was then reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 9 seconds; the wallet was then "fully-found".
- After the sweep the new device holds everything at its own addresses: 92712 satoshis, and the NFT, which it reports as a token of unknown meaning. Its coins pay for cancelling a request: true.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 5000000000 satoshis before the run and holds 4999990066 after it: the run cost 9934 satoshis in fees. Nothing is left anywhere else.
