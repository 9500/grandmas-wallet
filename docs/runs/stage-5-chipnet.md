# Stage 5 run on chipnet (run B): the wallet's whole life through its own code

Written by the run itself (`scripts/run-b.ts chipnet`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates, on chipnet. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.

- Wallet identity: `21d3ba89a120bc222f224071af7fd576c4a3bc93c56cea718552b9bd7e983e9f`
- Repository at commit `8616e45`
- Started 2026-11-19T19:39:59.201Z
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `docs/runs/invitations/stage-5-chipnet/`, with `index.json` naming the template, action and role of each.
- The engine ran as published, with no local change.
- The engine was given one server. With three, the first start of the run of 17 November ended while waiting for a block: the engine's network package asks every server for a new block's header and takes the first answer, and a server that had not seen the block yet answered first, with nothing.

| Step | Transaction | Invitation | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- | --- |
| create | `e22c9e0a045cc0abaef5c42f19e312a32dd6f55e1d59eeb12f7a8b97ba2f9bad` | [create](invitations/stage-5-chipnet/01-the-owner-s-device-create-e22c9e0a.json) | 343 | 343 | the controller and the rest |
| pay | `b7ccd85adacda202ed285b48d651155e48267891f35b171b82db10e4e43e6ddc` | [pay](invitations/stage-5-chipnet/03-the-owner-s-device-pay-b7ccd85a.json) | 384 | 384 | an everyday payment by key |
| request | `d55b7ea309c8899a8fdf6831cf5f20864e52695468519a548b5ab441cbff5a93` | [pay](invitations/stage-5-chipnet/04-the-recoverer-pay-d55b7ea3.json) | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction |
| complete | `e4fdbe7b32a5edf8bc37853c5ee22c80f3e96e14fd0ef58595dc3732753f53d5` | [pay](invitations/stage-5-chipnet/05-the-recoverer-pay-e4fdbe7b.json) | 970 | 970 | after the waiting period (6 minutes); no coin has moved |
| sweep | `4cab778245f084bd67b15c9dbb49d76024123ea9cf939d8e508e07aff7002587` | [approve](invitations/stage-5-chipnet/06-the-new-device-approve-4cab7782.json) | 2177 | 2177 | 5 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed |
| pay | `b53cd876ab01385bcfd09cb4286c55a72a5895c35dfb81a8a016dd2507207822` | [pay](invitations/stage-5-chipnet/07-the-new-device-pay-b53cd876.json) | 384 | 384 | the new owner pays from what it swept, by its own key |
| send the NFT | `9898fe6ba8f8d9a9315a08e8e8a45cc1ec131906747bf8811f148cfffd6c9486` | [pay](invitations/stage-5-chipnet/08-the-new-device-pay-9898fe6b.json) | 717 | 717 | unchanged; the fee from another coin |
| close | `2a394fffde918e3e7af3d4f9aef5c5b796a5466e20045bcad1ab3710298a9553` | [close](invitations/stage-5-chipnet/09-the-new-device-close-2a394fff.json) | 977 | 977 | everything, and the controller's value, back to the address that paid for the run |
| return the recoverer's balance | `0ebe22021200dbd9552b818a0bab2af9fc9da562b7486da21c902dd836e901b5` | [pay](invitations/stage-5-chipnet/10-the-recoverer-pay-0ebe2202.json) | 185 | 185 | what the recoverer did not use |

Also observed:

- Recovery is shown as "off" while no receipt of the recoverer exists.
- The old device holds 95889 satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The recoverer's balance holds 5000 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's quick pass found 5 coins; the wallet was then reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 12 seconds; the wallet was then "fully-found".
- After the sweep the new device holds everything at its own addresses: 92712 satoshis, and the NFT, which it reports as a token of unknown meaning. Its coins pay for cancelling a request: true.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 60561375 satoshis before the run and holds 60551300 after it: the run cost 10075 satoshis in fees. Nothing is left anywhere else.
