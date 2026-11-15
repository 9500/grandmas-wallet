# Chipnet run

A scripted run of the whole wallet lifecycle on chipnet: create a wallet, spend, open a recovery claim, cancel it, claim again, wait out the challenge delay, complete recovery, and spend with the replacement key. Along the way it sends three transactions that must be refused and checks that the network refuses them.

It needs an Electrum (Fulcrum) server for chipnet and about 30,000 satoshis of chipnet BCH. Expect to get back everything except roughly 10,000 satoshis: about 9,000 in fees and 1,000 that stay in the controller output, which cannot be closed.

## Commands

All commands are run from the repository root.

```bash
npm run chipnet -- probe ssl://host:port   # check a server without sending anything, and remember it
npm run chipnet -- address                 # create keys, show the funding address
npm run chipnet -- selftest                # send the funds to their own address once and wait for a confirmation
npm run chipnet -- run                     # the full lifecycle
npm run chipnet -- status                  # balances and step results
npm run chipnet -- sweep bchtest:...       # return the remaining coins
```

The endpoint scheme is `tcp`, `ssl`, `ws` or `wss`. A server on mainnet is refused.

## What the run does

| Step | What it shows |
| --- | --- |
| `prepare`, `genesis` | Wallet identity, controller, wallet funds and a Savings Jar are created; the genesis is validated |
| `owner-send` | The owner pays from the wallet without the recoverer (C01) |
| `attack-claim-with-spend` | Refused: the recoverer cannot take funds in a claim transaction (C07) |
| `claim-1` | The recoverer opens a claim, paying its own fee |
| `attack-early-finalize` | Refused: recovery cannot be completed before the delay (C03) |
| `cancel` | The owner cancels the claim (C05) |
| `claim-2`, `finalize` | A second claim is completed after the delay; the replacement key becomes owner (C11) |
| `attack-old-owner-spend` | Refused: the old owner key no longer works (C12) |
| `new-owner-send`, `jar-withdraw` | The replacement key spends the same wallet outputs and withdraws the jar, which never moved |

The challenge delay is one 512-second interval, time-based as it would be on mainnet. The run waits for it by retrying the completing transaction every 30 seconds, so the whole run takes roughly 15 to 25 minutes.

Results, with transaction IDs and the network's refusal messages, are written to `docs/chipnet-log.md`.

## Safety

- Keys and progress are kept in `.chipnet/run.json`, which git ignores. Keys are written before the funding address is shown. Do not delete this file while coins are in play.
- Every transaction is checked locally against the network's script rules before it is sent, and saved before it is sent.
- Every command can be run again after an interruption. A step that was already sent is detected and not built again.
- `sweep` can be used at any point. A Savings Jar that is still locked stays in place until a later sweep.
- If a deliberately invalid transaction is ever accepted, the run stops and reports it as a security finding.

The resume and sweep behaviour is tested against a simulated network in `packages/chipnet/test/lifecycle.test.ts`, with the connection dropped at every broadcast in turn.
