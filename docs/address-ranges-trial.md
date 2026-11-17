# Trial: how large can the address ranges be?

**Date:** 17 November 2026 · **Status:** measured on a server machine; not on a phone · **Plan:** stage 0, "How large can the address ranges be?" · **Proposal:** section 7.7, decision 2

## Answer

Proposed: **`N0` = 10,000** addresses given out, **`N1` = 10,000** for change and application outputs, **`N2` = 1,000** vault addresses, for every seed. The full pass is repeated **once a week**, and at once after the events listed below.

A full pass over these 21,000 addresses costs about 3 seconds of computing on this machine and 1 to 2 seconds of lookups on the user's own server. On a distant public server it is estimated at about 16 seconds. Ranges of 100,000 would cost ten times that for every seed and every repeat, and the larger share of it is computing on the device, which has not been measured on a phone.

## What was measured

`spikes/ranges/measure.mjs` asks a server for the history of addresses nobody has used, which is what nearly every address of a range is. One address is one request (`blockchain.scripthash.get_history`). It was run against:

| Server | Software | Round trip | What was sent |
| --- | --- | --- | --- |
| The local Fulcrum ([local-node.md](local-node.md)) | Fulcrum 2.1.4 | 0.2 ms | 1,000, 10,000 and 100,000 addresses, each several ways |
| The user's server, `chipnet.9500.cash` | Fulcrum 2.1.4 | 15 ms | 1,000 and 10,000 addresses, each several ways |
| A public server, `chipnet.imaginary.cash` | Fulcrum 2.1.4 | 218 ms | About 270 requests in all |

Results are kept in `spikes/ranges/results.json`.

### Lookups, in milliseconds per 1,000 addresses

| How the requests are sent | Local | User's server | Public server |
| --- | --- | --- | --- |
| One at a time | 294 | 14,700 to 15,400 | — |
| 20 waiting for an answer at a time | 25 to 45 | 750 to 810 | 12,900 |
| 100 at a time | 19 to 27 | 170 to 180 | — |
| 500 at a time | 18 to 20 | 42 to 57 | — |
| Batches of 100, one batch after another | 23 to 29 | 170 to 180 | 2,150 |
| Batches of 300, one after another | 22 to 23 | 77 to 85 | — |
| Subscribing, 100 at a time | 19 to 21 | 170 | — |

Away from the local server, the time is the round trip multiplied by the number of rounds: the server's own work is small beside it. What decides the speed is how many requests are under way at once.

### Computing the addresses

Before an address can be looked up it has to be computed: the public key of its number, its hash, the secret, the tag, the script and two hashes of it (proposal sections 7.2 to 7.4). On this machine, in one thread, that takes **131 ms per 1,000 addresses** (`node spikes/ranges/measure.mjs derive`). Against a nearby server this is more than the lookups take.

### A whole range

| Addresses | Computing, this machine | Local server | User's server, 500 at a time | User's server, batches of 300 | Public server, batches of 300 |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 0.13 s | 0.02 s | 0.05 s | 0.08 s | about 0.75 s |
| 10,000 | 1.3 s | 0.2 s | 0.42 s | 0.77 s | about 7.5 s |
| 100,000 | 13 s | 1.8 to 2.5 s | about 4 to 6 s | about 8 s | about 75 s |

Measured, except: the user's server at 100,000 is extrapolated from its 10,000, and the whole public column is an estimate. The estimate takes one round trip of 218 ms for each batch of 300; the one batch that was sent, of 100, came back in 220 ms.

### Limits of the servers

All three run Fulcrum 2.1.4. Its limits apply to each client address, and the local server exempts its own machine from them.

| Limit | Fulcrum's default | Observed |
| --- | --- | --- |
| Requests in one batch | 345, counted over all batches under way from one address | On the user's server a batch of 345 was answered; a batch of 346 got no answer within 10 seconds. Locally a batch of 1,000 was answered. |
| Subscriptions from one address | 75,000 | Not reached on a public server. Locally 120,000 were accepted, the machine being exempt. |
| Connections from one address | 12 | Not tried |

Two more things were seen:

- **Subscribing costs as much as a lookup and tells less.** It returns a short status, empty for an unused address; a used address still needs its history fetched.
- **Unsubscribing in bulk is slow.** Locally, 100,000 took 133 seconds, against 2 seconds to subscribe them. Closing the connection drops them all at once.

## What follows for the two passes and for watching

- **The full pass uses history lookups, not subscriptions.** Subscribing to a range would use up the 75,000 a server allows one address, which everything behind that address shares, and it gains nothing.
- **Lookups go in batches of 300,** below the limit of 345 with some room, or as single requests with several hundred under way. Requests one at a time are about a hundred times slower at a distance.
- **Watching subscribes only to what section 7.7 names:** addresses with history and the window beyond the last one. That is tens or hundreds of subscriptions.
- **The quick pass is negligible:** it stops after a run of unused addresses as long as the window, about 30 lookups for an empty wallet.
- **A device may keep the addresses it has computed,** so that a repeated pass costs lookups only. Nothing depends on it: they can always be computed again.

## The proposed sizes

| Range | Size | Reason |
| --- | --- | --- |
| `N0`, given out | 10,000 | A fresh address for every payment received: nearly three a day for ten years |
| `N1`, change and application outputs | 10,000 | One for each payment that has change and each output an application asks for; the same rate |
| `N2`, vault | 1,000 | Vault addresses are meant to be used again, so few are needed; a thousand costs almost nothing to search |

A full pass for one seed is then 21,000 addresses: about 2.8 seconds of computing here, 0.9 seconds of lookups on the user's server with 500 under way or 1.6 seconds in batches of 300, and an estimated 16 seconds on a public server at 218 ms. A wallet that has had three seeds takes three times that.

Why not 100,000 for the first two:

- **Ten times the cost, for every seed and every repeat.** 201,000 addresses are 26 seconds of computing on this machine and an estimated two and a half minutes of requests to a distant public server. A phone is slower by a factor that has not been measured.
- **Load on servers that are not ours.** A weekly pass of 201,000 lookups for every seed of every wallet is a different thing to ask of a public server than 21,000.
- **The choice can be widened later and not narrowed.** Addresses are numbered from 0, so a later version of the scheme with larger ranges leaves every existing address where it is. A smaller range would lose sight of addresses already given out. Starting at 10,000 keeps the way open.

A wallet that uses up a range uses addresses again or moves to a new seed (section 7.7). At ten payments a day that happens after about three years.

## How often the full pass is repeated

Proposed: **once a week** while the wallet is in use, and at once

- after a device takes over a wallet or is restored from a local backup;
- after the device sees a reorganization, or one of its own transactions dropped: this is what leaves an address given out beyond a gap;
- when the device has not run a pass for more than a week;
- when the user asks.

The quick pass and the watching cover ordinary use. The full pass exists for the rare cases they miss, and what a missed address costs is a coin that stays unseen until the next pass. A week bounds that at little cost: 21,000 lookups for each seed.

## What was not measured

- **A phone.** Neither the computing nor a mobile connection. The sizes are fixed in stage 2, where test KV13 records what the full pass costs with them; a measurement on a phone belongs there before the scheme version is frozen.
- **A public server under a full pass.** Only about 270 requests were sent to one. Whether it serves 21,000 at once without slowing a client down is not known.
- **Addresses with long histories.** Every address asked for was unused.
