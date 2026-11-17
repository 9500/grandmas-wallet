# KV13: what the full pass costs

**Date:** 17 November 2026 · **Test:** KV13 of the proposal, "The full pass for a wallet with several seeds, at the chosen sizes: time and load on the servers measured and recorded."

Made by `npx tsx scripts/full-pass-cost.ts "the local node=ws://127.0.0.1:60403" "the user's chipnet server=wss://chipnet.9500.cash:443"`, run from `packages/chipnet`, with the library's own `fullPass` and `quickPass` and three freshly made seeds.

Full pass over 21,000 addresses for each seed (10,000 given out, 10,000 change, 1,000 vault), for a wallet with no coins, in batches of 300 addresses.
The time includes working the addresses out on this machine.

| Server | Seeds | Addresses looked up | Requests | Time | Per 1,000 addresses | Result | Quick pass, for comparison |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the local node | 3 | 63,000 | 63,000 | 13.8 s | 219 ms | complete | 90 lookups, 0.0 s |
| the user's chipnet server | 3 | 63,000 | 63,000 | 17.3 s | 275 ms | complete | 90 lookups, 0.2 s |

What this says:

- **One seed takes about five to six seconds,** of which about three are spent working the 21,000 addresses out on this machine; the rest is the server. A wallet that has had three seeds takes three times that.
- **The load is one request for each address:** 21,000 for a seed, and nothing more while the addresses are unused. An address with history costs one further request for its unspent outputs and one for each transaction that holds one.
- **The quick pass is 30 lookups for a seed** with no coins: the windows of 20, 5 and 5.
- **Not measured:** a phone, and a public server far away. The trial of stage 0 estimated about 16 seconds for a seed on a public server at 218 ms a round trip (`docs/address-ranges-trial.md`).
