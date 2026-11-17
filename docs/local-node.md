# The local node: does it stand in for chipnet?

**Date:** 17 November 2026 · **Status:** answered for everything except the XO engine and the pages, which are tried separately · **Plan:** stage 0, "Does the local node stand in for chipnet in every respect the runs need?"

## Answer

Yes, for what a run script needs from a chain: a real node's script and relay rules, waiting periods with a clock the test sets, chains of unconfirmed transactions, Fulcrum's notifications, and blocks that are undone with a transaction replaced. All of it was shown and takes seconds.

With one exception. **The local node cannot run the rules chipnet runs today.** The plan asks that a run script pass on the local node "under both sets of rules". The released node, version 29.2.0, has a setting for the activation time of the May 2027 upgrade and nothing behind it: its source keeps ten-minute blocks on every network. Chipnet's one-minute blocks come from a different build. The user's chipnet node reports version 29.2.1 and fields the release does not have (`blocks_ticks`, `target_time: 60`). The local node therefore shows mainnet's rules, and the plan's sentence needs to change unless that build is installed here too.

Three things were found on the way that the wallet's code has to take into account; they are listed under "Findings for the wallet's code".

## What is installed

| | |
| --- | --- |
| Node | Bitcoin Cash Node 29.2.0, regtest, `acceptnonstdtxn=0` so that the relay rules are those of the public networks. RPC on `127.0.0.1:18443`. No node wallet. |
| Fulcrum | 2.1.4, the version both chipnet servers in use report. TCP `127.0.0.1:60401`, WebSocket `127.0.0.1:60403`. It reads the node's mempool once a second. |
| Where | `~/.local/share/grandmas-wallet/regtest/`, outside the repository. About 135 MB of memory for both. |
| Services | `grandmas-wallet-regtest-node.service` and `grandmas-wallet-regtest-fulcrum.service`, units of the current user, started at boot. |

`deploy/regtest/regtest.sh` sets it up and drives it:

| Command | What it does |
| --- | --- |
| `setup` | Downloads the two pinned releases, checks their SHA-256, unpacks them, writes the configuration from the templates beside the script with a password of its own making |
| `services` | Installs and starts the two services |
| `start`, `stop`, `status` | As they say; through the services when they are installed |
| `reset` | Deletes the chain and Fulcrum's index and starts again from block 0 |
| `cli …` | `bitcoin-cli` against the node |
| `unservice` | Removes the services |

The node's download was checked against the SHA-256 recorded when it was first fetched; no published list was found to compare that with. Fulcrum's matches the list published with its release.

Scripts reach the node through `spikes/local-node/rpc.mjs`, which reads the port and password from the node's configuration file.

## What was shown

| Question | Result | Script |
| --- | --- | --- |
| Does the node apply the same rules as this project's own check? | Yes. Nineteen transactions of one wallet's life got the same verdict from both, apart from the two that were early for their waiting period, which only the node can judge. | `spikes/addresses/regtest-run.mjs`, [address-contracts-trial.md](address-contracts-trial.md) |
| Does a waiting period pass without waiting? | Yes. `setmocktime` and a few blocks move the chain's median time. A completion was refused at 511 seconds and accepted at 512. | the same |
| Does Fulcrum notify about an address? | Yes: between 0.06 and 1.4 seconds after a transaction was sent, and half a second after a block. A new block's header is announced within about 10 ms. | `spikes/local-node/notifications.mjs` |
| Are chains of unconfirmed transactions accepted and shown? | Yes. Three transactions, each spending the one before, were accepted unconfirmed. Fulcrum gives height 0 to one whose inputs are confirmed and −1 to one that spends an unconfirmed output. After a block all three have its height. | the same |
| Does Fulcrum list tokens? | Yes, with category, capability and the 69-byte commitment of the controller, when asked in the right way (see below). | the same |
| How are refusals worded through Fulcrum? | `the transaction was rejected by network rules.` followed by the node's reason: `non-BIP68-final (code 64)`, `min relay fee not met (code 66)`, `dust (code 64)`. | the same |
| Can blocks be undone, and does Fulcrum follow? | Yes, see the next table. | `spikes/local-node/reorg.mjs` |
| Does this project's Electrum client connect? | Over WebSocket, yes. Over TCP, no (see below). | `spikes/local-node/client.ts` |
| Does the node work with the 2027 activation time in the past? | It reports the upgrade as active and the whole wallet's life passes unchanged. With the default `-expire` setting it also keeps answering on regtest. Nothing about blocks changes, because the release holds no such change. | a throwaway node, not kept |

### Undoing blocks

A payment is confirmed, its block is undone, then one more, and a different transaction that spends the same coin is confirmed instead. This is the situation of test CR02.

| Step | Node's tip | Fulcrum's tip | First address | Second address | Mempool | Notifications |
| --- | --- | --- | --- | --- | --- | --- |
| Payment to the first address, confirmed | 421 | 421 | at 421 | — | 0 | header, first address |
| `invalidateblock` on its block | 420 | 420 | unconfirmed | — | 1 | header, first address |
| `invalidateblock` on the block before | 419 | 419 | no history | — | 0 | header, first address |
| Two new blocks; the coin now pays the second address | 421 | 421 | no history | at 421 | 0 | header, second address |

Sending the first payment again is then refused with `Missing inputs`.

The node keeps a payment in its mempool when its block is undone, and Bitcoin Cash has no way to replace a transaction that is in the mempool. The script gets around this by spending a block reward in the first block in which it may be spent: undoing a second block makes the reward too young, and the node drops the payment. No restart is needed.

After the payment was dropped, Fulcrum still returned it when asked for it by its identifier. Knowing a transaction by its identifier says nothing about whether it is in the chain, which is what the proposal's section 17 already assumes.

## Findings for the wallet's code

1. **Outputs with tokens are not listed for this project's client as it is.** Fulcrum leaves outputs that carry tokens out of `blockchain.scripthash.listunspent` for a client that negotiates a protocol version below 1.5, unless the request adds `include_tokens` or `tokens_only`. `packages/chipnet/src/electrum.ts` negotiates 1.4.1 and adds neither, so its `listUnspent` returned nothing for the controller's address and can never report `hasToken`. The history of the address is complete either way. Both chipnet servers in use run the same Fulcrum version. The client needs the extra argument, or version 1.5, before stage 1 lists a wallet's tokens. The default has a use too: a list without tokens is exactly what choosing a fee coin wants.
2. **The client's `tcp://` and `ssl://` endpoints do not work.** For those the client passes a host name to the Electrum library, which opens a WebSocket to it. Plain TCP needs the package `@electrum-cash/tcp-socket`, which is not installed. WebSocket works, and it is what the pages use; run scripts can use it too.
3. **Sending a transaction that is already in the mempool is answered as accepted** through Fulcrum, with the same identifier. A run that stops after sending can send again when it resumes.

## The chain's clock

A run that lets a waiting period pass moves the chain's median time ahead by about nine minutes. After a dozen such runs the chain is more than two hours ahead of the real clock, and the node then refuses to make a block on the real clock (`time-too-new`; tried on a throwaway node). Two habits keep this from mattering:

- A script sets the node's clock from the chain before it starts (`startClock` in `spikes/local-node/chain.mjs`) and returns it to the real clock when it ends.
- `regtest.sh reset` starts a new chain. It takes about a second.

With the clock held still, block times still creep forward, a second every few blocks. A test of a waiting period reads the reference time from the node.

An empty chain counts as still downloading, and Fulcrum waits for it. `start` therefore makes one block when the chain has none.

## What remains open

- **The XO engine and the pages** against the local node: not tried here.
- **Chipnet's own rules on the local node.** They need the build chipnet's nodes run. Until then, what differs between the two networks is shown on chipnet only. For this wallet the visible difference is how often blocks come. Whether the median time is still taken over eleven blocks under those rules was not checked here.
- **TCP for the project's client**, if anything needs it.
