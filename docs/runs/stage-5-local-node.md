# Stage 5 run on the local node: the wallet's whole life through its own code

Written by the run itself (`scripts/run-b.ts local`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.

- Wallet identity: `e9a636f63369ff7e5a335008e5052f38063dbe2fe11a68036cf8f5f0e7d095b2`
- Repository at commit `045cf35`
- Started 2026-11-19T19:20:59.864Z
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `.chipnet/invitations/stage-5-local-node/`, with `index.json` naming the template, action and role of each.

| Step | Transaction | Invitation | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- | --- |
| create | `1d0e50cd1386d732c4c4792d6a29de07bb66348579fbeb63039da6e7bd290d0a` | `01-the-owner-s-device-create-1d0e50cd.json` | 343 | 343 | the controller and the rest |
| pay | `2576f5337ea9ee68d18fe06c00c350b6b0037a239bd35cdfae2eb9c267c00388` | `03-the-owner-s-device-pay-2576f533.json` | 384 | 384 | an everyday payment by key |
| request | `d7124f2405769c88c25a8fce1f655e5648abe43a3b8d65c173141bf989f036b5` | `04-the-recoverer-pay-d7124f24.json` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction |
| complete | `3e61ddc3d5af823176cf4236b38d7c68e92e34e77ede8c9940abd215c96a97f6` | `05-the-recoverer-pay-3e61ddc3.json` | 970 | 970 | after the waiting period; no coin has moved |
| sweep | `483b35af833531be19d82cba36a13ffc76830a1f4f10e1902e13f09f20359146` | `06-the-new-device-approve-483b35af.json` | 2177 | 2177 | 5 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed |
| pay | `5c6a9a6e455afd455c6d78a1442be4e4ec7bd0c0f868cf6486f125b94826a8d6` | `07-the-new-device-pay-5c6a9a6e.json` | 384 | 384 | the new owner pays from what it swept, by its own key |
| send the NFT | `9d9e3c5d417b83573dfc8141244382e1d1b1f22cc9f87332fde1c0fadf050801` | `08-the-new-device-pay-9d9e3c5d.json` | 717 | 717 | unchanged; the fee from another coin |
| close | `fc8b6846cf8f857a19af4a9ebd84f76ab34eebaaacf272123036854cb724d159` | `09-the-new-device-close-fc8b6846.json` | 977 | 977 | everything, and the controller's value, back to the address that paid for the run |
| return the recoverer's balance | `1ac8c6b9a873622e2eb97a4544676cf36a02103dd169a2f4bc0794187870d054` | `10-the-recoverer-pay-1ac8c6b9.json` | 185 | 185 | what the recoverer did not use |

Also observed:

- Recovery is shown as "off" while no receipt of the recoverer exists.
- The old device holds 95889 satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The recoverer's balance holds 5000 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's quick pass found 5 coins; the wallet was then reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 10 seconds; the wallet was then "fully-found".
- After the sweep the new device holds everything at its own addresses: 92712 satoshis, and the NFT, which it reports as a token of unknown meaning. Its coins pay for cancelling a request: true.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 5000000000 satoshis before the run and holds 4999990066 after it: the run cost 9934 satoshis in fees. Nothing is left anywhere else.
