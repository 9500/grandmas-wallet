# Stage 5 run on the local node: the complete course

Written by the run itself (`scripts/stage-5-run.ts`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine with the wallet's templates, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state.

- Wallet identity: `2ea0f5f3d09ec5912cf3ba813caaa0f79a12c08fca858ed9e74728f4e42c9d8f`

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `4d5fc8b51250a936b694ff392bddeb839102f35119da75d8fa9b24c21ab3cb94` | 421 | 421 | the old device creates the wallet, with an allowance for the recoverer |
| pay | `585df7536656e74505f2aa42456a5badbfb57e1851636222a5cd4ec58f42f0c2` | 384 | 384 | an everyday payment by key, with change |
| request | `0c2b49dea730c8973b86afad2c13ac34e4410b76d4703db2f95ef370af9d8914` | 991 | 991 | the recoverer names the new device's key |
| complete | `98a585bfd96040383788cf7c6f875236822dd498728a97331677cef6505d8126` | 970 | 970 | after the waiting period; no coin has moved |
| sweep | `be70e0754a6bcf55cb9bf33d3990cb198083badcbbd558a3e37791764c162336` | 2437 | 2437 | 6 coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed |
| pay | `109c273a110bcf0cdc459513ed1aca4e563f4ab7a48a7192b694f31e8dd1b158` | 384 | 384 | the new owner pays from what it swept, by its own key |
| send the NFT | `c29d5f6f11a2d94b68b0e5ea9859d61b2b57ee22ca9de0901661771dafd0181a` | 717 | 717 | unchanged |
| close | `8b11bf847dca93446df3d66e0709b8c303dc91bfb79f8bfc822607b03107433d` | 977 | 977 | everything, and the controller's value, to one address |

Also observed:

- The old device holds 13749694295 satoshis at two addresses given out, change addresses and a vault address, and an NFT. Then it is lost.
- The new device's quick pass found 6 coins; the wallet is reported as "searching", not as fully found.
- The full pass over both seeds (42000 addresses) took 9.4 seconds; the wallet is then "fully-found".
- After the sweep the new device holds everything at its own addresses: 13749690858 satoshis and 1 NFT, reported as a token of unknown meaning (1).
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. Owners: 2.
