# Grandma's Wallet

A Bitcoin Cash wallet that can recover access after a lost phone without manual backups. Every address of the wallet has its own key for everyday use and a second way to spend through the wallet's controller on chain. A trusted recoverer can replace the wallet's owner key only after a request that has stayed unchallenged on chain for a waiting period; the owner can cancel the request at any time before that. The new device then moves the wallet's coins and tokens to addresses of its own.

Built for BCH Blaze 2026 on the XO stack.

**Status:** a working demonstration on chipnet, the Bitcoin Cash test network. The wallet, the recoverer's page, two applications and the backup stores are built and have run through their whole course on chipnet, in scripts and in browsers. Nothing has been audited, the pages keep their keys unencrypted in the browser, and a phone watches for recovery requests only while the page is open. Use it with test coins only.

The first design, with its web demonstration and chipnet runs, is on the `main` branch and at the tag `design-1`.

## Try it

| | |
| --- | --- |
| Introduction | <https://blaze2026.9500.cash/> |
| Wallet | <https://wallet.9500.cash/> |
| Recoverer, for a bank or a friend who sets wallets up and moves them to a new phone | <https://recoverer.9500.cash/> |
| Savings Jar, an application the wallet uses from its XO template | <https://jar.9500.cash/> |
| Loan desk, an independent page for ParyonUSD's contracts on chipnet, not affiliated with Paryon | <https://paryon.9500.cash/> |

[docs/walkthrough.md](docs/walkthrough.md) goes through the course by hand: a helper sets up a wallet, the owner receives and pays, a request nobody asked for is refused, the phone is lost, and the wallet comes back on a new one. It takes about twenty minutes and a little chipnet coin.

## Built on XO

Every transaction the wallet sends is an invitation of an XO template, built and signed by the XO engine.

- **The wallet's own templates** define its controller, its addresses and its payments: [docs/templates/](docs/templates/).
- **Applications arrive as templates.** The wallet's code names no application. It carries out a template's actions, shows its own figures before anything is signed, stores the template in the backup, and after a recovery finds what the owner holds in an application from the template and the chain alone.
- **ParyonUSD as an XO template.** [A template](packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json) for Paryon's public loan contracts, used unchanged: making a loan key, borrowing, managing and closing are actions of it.
- **Invitations.** [docs/xo-invitations.md](docs/xo-invitations.md) lists the invitations of three complete runs on chipnet, shows how to open one in XO's debug tool, and says how to produce them again. In the wallet and on the recoverer's page, developer mode saves the invitation of any transaction that browser sent.

## What is where

| | |
| --- | --- |
| `contracts/` | The contracts, in CashScript: the controller, the two kinds of address, and the Savings Jar |
| `packages/core` | Addresses, the controller's states, reading a wallet from the chain, building and checking transactions |
| `packages/app` | The wallet's and the recoverer's logic on the XO engine, the wallet's templates, applications |
| `packages/paryon`, `packages/savings-jar` | The two applications' templates and what their pages need |
| `packages/connect`, `packages/enrollment`, `packages/archive` | Messages between pages, setting a recoverer up, sealed backups |
| `packages/chipnet`, `packages/testing` | Access to chain servers and a node; a simulated chain for tests |
| `packages/ui`, `apps/` | The pages: wallet, recoverer, Savings Jar, loan desk, and the backup store's server |
| `scripts/` | The scripted runs on the local node and on chipnet |
| `docs/runs/` | The record each run wrote, with its transactions |

## Documents

- [Architecture proposal v0.4](Grandmas_Wallet_Architecture_Proposal_v0.4.md)
- [Illustrated overview of the design, v0.5](docs/design_v0.5.html) (open in a browser)
- [Implementation plan v0.4](IMPLEMENTATION_PLAN_v0.4.md)
- [Decisions log](docs/decisions.md)
- [XO templates and invitations](docs/xo-invitations.md)
- [Trying the wallet by hand](docs/walkthrough.md)
- [The local test node](docs/local-node.md)
- What was learned about the XO engine: [trial](docs/xo-spike.md), [signing problem](docs/xo-engine-signing-bug.md), [chipnet header verification](docs/xo-chipnet-header-verification.md), [notes for feedback](docs/xo-feedback-notes.md)

## Development

Requires Node 22 or later.

```bash
npm ci
npm run check             # typecheck, lint, tests
npm run build:contracts   # recompile contracts after editing them
```

The pages run on your own machine against a local test node; see "On your own machine" in [docs/walkthrough.md](docs/walkthrough.md).

## License

[MIT](LICENSE)
