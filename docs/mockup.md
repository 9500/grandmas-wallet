# The mockup network

A public sandbox chain on which every flow of the demonstration can be tried with play coins and without waiting. It is a real Bitcoin Cash node in regtest mode with Fulcrum in front of it, separate from the local node of [local-node.md](local-node.md), and a small service that is the chain's only miner, the owner of its clock and the source of play coins. Paryon's published contracts are deployed on it, so that the loan page works too.

The pages treat it as a network of its own, named `mockup` in their configuration. Its addresses have the `bchreg:` prefix.

## Public names

| Name | Forwards to | What it is |
| --- | --- | --- |
| `wss://mockup.9500.cash` | `ws://192.168.88.112:8121` | Fulcrum's WebSocket: what the pages read the chain through and send transactions to |
| `https://mockup-api.9500.cash` | `http://192.168.88.112:8122` | The mockup service: play coins, the clock, Paryon's deployment |

The reverse proxy provides TLS for both. Nothing else listens outside this machine: the node's RPC is on `127.0.0.1:18453` and has no peers, Fulcrum's TCP port is `127.0.0.1:60411`.

## Running it

Everything lives in `~/.local/share/grandmas-wallet/mockup/` (`node/`, `fulcrum/`, `service/`). The programs are those `deploy/regtest/regtest.sh setup` downloaded; they are used, not copied.

| Command | What it does |
| --- | --- |
| `deploy/mockup/mockup.sh setup` | Writes the configuration of the node and Fulcrum |
| `deploy/mockup/mockup.sh services [checkout]` | Installs and starts `grandmas-wallet-mockup-node`, `grandmas-wallet-mockup-fulcrum` and `grandmas-wallet-mockup-service`, user services started at boot and restarted on failure. The service and the node's start run from the checkout given, by default the one the script is in. |
| `start`, `stop`, `status` | As they say; through the services when they are installed |
| `reset` | Stops, deletes the chain, Fulcrum's index and the service's state, and starts again from block 0. The treasury's key is kept, and with it Paryon's deployment comes out the same (below). |
| `cli …` | `bitcoin-cli` against the node |
| `unservice` | Removes the services |

`MOCKUP_HOST` (default `192.168.88.112`), `MOCKUP_PUBLIC_URL` (default `https://mockup-api.9500.cash`) and `MOCKUP_ORIGINS` (the four pages) change what `services` writes.

To install from the main checkout after a merge:

```
cd "/home/ubuntu/projects/grandma's-wallet" && deploy/mockup/mockup.sh services "$PWD"
```

This rewrites the three units to run from that checkout and restarts the service; the chain and its data stay.

## The service

The service talks to the node alone, and does one thing at a time: blocks, the clock and payments go through one queue.

**Treasury.** On a new chain the service mines 210 blocks to a key of its own (`service/treasury.json`, mode 600): 110 rewards of 50 BCH and 100 blocks for them to mature, about 5,500 BCH that can be paid at once. Regtest halves the reward every 150 blocks, so nothing depends on later rewards. Every later block also pays the treasury, so fees come back.

**Blocks.** Every 2 seconds, a block if the mempool holds anything. Otherwise one block every 10 minutes of the chain's clock, so that its median time follows the clock as mainnet's does. The chain stays short: the pages check headers from block 1.

**Clock.** The chain's clock is real time plus everything skipped so far (`service/state.json`). Every block is stamped with it: the node's own clock is set to it (`setmocktime`) before each block, because a node refuses a block more than two hours ahead of its own clock. For the same reason a node does not start when its last block is more than two hours ahead; `mockup.sh` starts it with its clock at the chain's (`-mocktime`). Restarts of the service or the node keep working when the chain is days ahead.

## Endpoints

Every answer is JSON. A refusal has an `error` with one plain sentence, and the HTTP status says what kind: 400 a request that cannot be read, 404 or 405 nothing there, 413 too large, 429 over the limit, 500 the network could not do it, 503 the service is still starting.

| Request | Answer |
| --- | --- |
| `GET /status` | `{"height", "medianTime", "tipTime", "realTime", "secondsAhead", "skipped", "mempool", "treasury": {"address", "spendableSatoshis"}, "paryon": true}`: times in seconds since 1970; `secondsAhead` is the median time less real time |
| `POST /coins` `{"address": "bchreg:…", "satoshis": 50000000}` | `{"transactionId": "…"}`. Pays from the treasury at once, unconfirmed; the next block, within about 2 seconds, confirms it. `bchreg:` and `bchtest:` addresses, P2PKH and P2SH (20 and 32 bytes), token-aware or not; without a prefix `bchreg:` is tried first. The amount is output 0 of the transaction. |
| `POST /skip` `{"seconds": 600}` | `{"time", "height", "skipped"}`. Pending transactions go in a block first; then the chain's median time moves on by at least the seconds asked, with as few blocks as that needs (six, or one or two for a short skip right after recent blocks). `time` is the new median time. |
| `GET /paryon` | `{"deployment": {…}, "priceCents", "registry": {"uri", "category"}, "deployedAt", "transactions"}`: Paryon's deployment as the loan page takes it in its configuration (`paryon`) |
| `GET /paryon/registry.json` | PUSD's registry file, the one published on PUSD's authchain; any origin may read it |

Browsers may call the service from `https://wallet.9500.cash`, `https://recoverer.9500.cash`, `https://jar.9500.cash`, `https://paryon.9500.cash` and any `http://localhost:<port>`.

## Limits

| | |
| --- | --- |
| Play coins | From 1,000 to 100,000,000 satoshis (1 BCH) a request; 30 requests an hour from one address |
| Skips | From 1 second to 8 days a request; 60 requests an hour from one address |
| Client's address | The last entry of `X-Forwarded-For` (the one the reverse proxy adds), or the connection's |

The clock is shared: a skip moves it for everybody on the network.

## Paryon's contracts

At its first start the service deploys Paryon's contracts as published (`@paryonusd/contracts` 1.1.0) with `packages/paryon/src/local-deployment.ts`, as the local runs do: ten Borrowing threads with 1,000,000,000.00 PUSD each to lend, ten price threads at $500.00, ten manage NFTs and ten loan key factories. Periods are 144 blocks. The rewards of blocks 1 and 2 define the two token categories, and PUSD's registry (`ParyonUSD (mockup network)`, symbol `PUSDMOCK`) is published at `https://mockup-api.9500.cash/paryon/registry.json` on the transaction that makes PUSD's first outputs. Paryon's fee goes to the treasury.

A block reward does not depend on the block's time, and the treasury's key survives a reset, so a new chain gets the same categories and the same deployment. The loan page can therefore take the deployment from its configuration.

It needs no upkeep for a week, skips included:

- Nothing in the contracts a borrower uses counts time; they count blocks. A skip adds a few blocks.
- The prices never change: no oracle signs for this deployment, and the page reckons with the stored price alone.
- Threads are not used up. Every action recreates the threads it spends, and each Borrowing thread can lend a billion PUSD.
- Periods move on with blocks, about one a day at the heartbeat's pace and faster with activity. When the thread the page would lend from is two periods behind, the page offers to bring it up to date, which costs the user about 1,100 satoshis, as on chipnet. The service does not do it itself, because it would spend a thread a borrower's request may already name.

What can go wrong with many borrowers at once is a conflict: two requests that name the same thread, the second refused because the first spent it. The page takes the Borrowing thread that can lend the most, so borrowers spread over the ten, but every loan takes the price thread with the highest price, and all ten have the same price.
