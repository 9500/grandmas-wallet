# Stage 5 run on chipnet (run B): the wallet's whole life through its own code

Written by the run itself (`scripts/run-b.ts chipnet`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates, on chipnet. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.

- Wallet identity: `cefe5c399aef242be367b4218f87bb6a10769d8fd63ad343843e9340e5fa2a6d`
- Repository at commit `0dd4fda`
- Started 2026-11-21T20:56:08.970Z
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `docs/runs/invitations/stage-5-chipnet/`, with `index.json` naming the template, action and role of each.
- The engine ran as published, with no local change.
- The engine was given one server. With three, the first start of the run of 17 November ended while waiting for a block: the engine's network package asks every server for a new block's header and takes the first answer, and a server that had not seen the block yet answered first, with nothing.

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `da8263510e3adfd55be4d9c000fccb070ed3733d4341ed59d211ee5d07edf91a` | 343 | 343 | the controller and the rest | [create](invitations/stage-5-chipnet/01-the-owner-s-device-create-da826351.json) |
| pay | `3a9b1528c391aca4b338b548f9e1e08285207b623a63a9263b3a5606357c98a5` | 384 | 384 | an everyday payment by key | [pay](invitations/stage-5-chipnet/03-the-owner-s-device-pay-3a9b1528.json) |
| request | `a407dea4c4d140968a6a279d326327f2642445a0406abacfaafc6ae82056a5f0` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | [pay](invitations/stage-5-chipnet/04-the-recoverer-pay-a407dea4.json) |
| complete | `223f6b31697d6db22a7a02e1e58a6a3a375c5ee3860d7984ebaad0c1a277d03c` | 970 | 970 | after the waiting period (8 minutes); no coin has moved | [pay](invitations/stage-5-chipnet/05-the-recoverer-pay-223f6b31.json) |
| sweep | `0c6d1a63f7d82fb09c7f74d96452ffebc078aeff647cc83e2cd0f83a7c7adf0c` | 2177 | 2177 | 5 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed | [approve](invitations/stage-5-chipnet/06-the-new-device-approve-0c6d1a63.json) |
| pay | `073157360b59af8b2bf923829d823cff5a1e8bfaaa8a7719be44f9543e940c68` | 384 | 384 | the new owner pays from what it swept, by its own key | [pay](invitations/stage-5-chipnet/07-the-new-device-pay-07315736.json) |
| send the NFT | `a3b2801a906913441b6bb5fdd69f77badbf8ece752fe49bf3997dbb4f197845b` | 717 | 717 | unchanged; the fee from another coin | [pay](invitations/stage-5-chipnet/08-the-new-device-pay-a3b2801a.json) |
| close | `046c70c916c573e0737ef133306e389d109587c581b85288a5340a1bb25419cb` | 977 | 977 | everything, and the controller's value, back to the address that paid for the run | [close](invitations/stage-5-chipnet/09-the-new-device-close-046c70c9.json) |
| return the recoverer's balance | `aae069778b10c96631616f534aa9a3f1e99d26ecfb224936fb0318c0d7a43bd5` | 185 | 185 | what the recoverer did not use | [pay](invitations/stage-5-chipnet/10-the-recoverer-pay-aae06977.json) |

Also observed:

- Recovery is shown as "off" while no receipt of the recoverer exists.
- The old device holds 95889 satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The recoverer's balance holds 5000 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's quick pass found 5 coins; the wallet was then reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 12 seconds; the wallet was then "fully-found".
- After the sweep the new device holds everything at its own addresses: 92712 satoshis, and the NFT, which it reports as a token of unknown meaning. Its coins pay for cancelling a request: true.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 159954606 satoshis before the run and holds 159944249 after it: the run cost 10357 satoshis in fees. Nothing is left anywhere else.
