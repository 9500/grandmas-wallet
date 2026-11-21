# Grandma's Wallet

A Bitcoin Cash wallet that can recover access after a lost phone without manual backups. Every address of the wallet has its own key for everyday use and a second way to spend through the wallet's controller on chain. A trusted recoverer can replace the wallet's owner key only after a request that has stayed unchallenged on chain for a waiting period; the owner can cancel the request at any time before that. The new device then moves the wallet's coins and tokens to addresses of its own.

Built for BCH Blaze 2026 on the XO stack.

**Status:** a working demonstration on chipnet, the Bitcoin Cash test network. The wallet, the recoverer's page, two applications and the backup stores are built and have run through their whole course on chipnet, in scripts and in browsers. Nothing has been audited, the pages keep their keys unencrypted in the browser, and a phone watches for recovery requests only while the page is open. Use it with test coins only.

`main` holds the third design of the wallet (design 3), which is what the pages under "Try it" serve. [Designs](#designs) says what each design is and why the third was made.

## Try it

| | |
| --- | --- |
| Introduction | <https://blaze2026.9500.cash/> |
| Wallet | <https://wallet.9500.cash/> |
| Recoverer, for a bank or a friend who sets wallets up and moves them to a new phone | <https://recoverer.9500.cash/> |
| Savings Jar, an application the wallet uses from its XO template | <https://jar.9500.cash/> |
| Loan desk, an independent page for ParyonUSD's contracts on chipnet, not affiliated with Paryon | <https://paryon.9500.cash/> |

[docs/walkthrough.md](docs/walkthrough.md) goes through the course by hand: a helper sets up a wallet, the owner receives and pays, opens a savings jar and a loan, a request nobody asked for is refused, the phone is lost, and the wallet comes back on a new one with the jar and the loan. It takes about half an hour, a little chipnet coin, and about 0.6 BCH of it more for the loan.

## Built on XO

Every transaction the wallet sends is an invitation of an XO template, built and signed by the XO engine.

- **The wallet's own templates** define its controller, its addresses and its payments: [docs/templates/](docs/templates/).
- **Applications arrive as templates.** The wallet's code names no application, and an application needs nothing but its XO template. The wallet carries out a template's actions, shows its own figures before anything is signed, and stores the template and a record of each position in the backup before it signs. After a recovery it reads those records, lets the chain confirm them, and lists what the owner holds again.
- **ParyonUSD as an XO template.** [A template](packages/paryon/frozen/paryon-loan-v1-chipnet-fast-periods-6.json) for Paryon's public loan contracts, used unchanged: making a loan key, borrowing, managing and closing are actions of it.
- **Invitations.** [docs/xo-invitations.md](docs/xo-invitations.md) lists the invitations of complete runs of the second design on chipnet, shows how to open one in XO's debug tool, and says how to produce them with the third. In the wallet and on the recoverer's page, developer mode saves the invitation of any transaction that browser sent.

## Designs

- **Design 1** is at the tag [`design-1`](https://github.com/9500/grandmas-wallet/tree/design-1), with its web demonstration and chipnet runs. It spent every coin together with the wallet's controller, which linked all of a wallet's activity and got in the way of applications.
- **Design 2** is at the tag [`design-2`](https://github.com/9500/grandmas-wallet/tree/design-2), and was what the pages under "Try it" ran until 20 November 2026. It gives each address its own key and uses the controller only for recovery. After a recovery, the new phone finds what the owner holds in an application from the application's token, its template, a second document written for this wallet, and the chain.
- **Design 3** is what `main` holds. It keeps design 2's keys, addresses and controller, and changes how an application's position comes back after a recovery: from the application's XO template, the application's request and the wallet's own record in its sealed backup, checked against the chain. It has run on a local test node and on chipnet, in scripts and in browsers. Its [architecture proposal](Grandmas_Wallet_Architecture_Proposal_v0.6.md) is version 0.6.

### Why a third design

- **The chain does not hold everything.** Design 2 finds a position again only when the values its script was made with are on chain, as they are for the Savings Jar and the ParyonUSD loan, and only when someone has written down for the wallet where they are. It cannot be used with an application for which either is missing.
- **Such values have to be carried from the old phone to the new one.** XO's authors, asked about [the proposal for finding positions](docs/xo-position-recovery.md), pointed to state synchronisation for this. XO's own synchronisation is not implemented yet.
- **The wallet already has a way to carry them.** Its backup is sealed, and the recoverer hands the new phone the access to it. In design 3 the wallet stores there, before an action is signed, what the XO engine keeps for each script of an application it follows. The new phone reads these records and follows the scripts again. The recoverer's part does not change, and it needs to know nothing about any application.
- **The chain stays in use, as the check.** A record counts only when the chain ties it to a token the wallet holds. The records keep the engine's own fields, so that XO's synchronisation can take the store's place when it exists.
- **An application should need nothing but its XO template.** Design 2 also needs a second document written for this wallet, which says how to find a position and how the wallet takes part in each action. Design 3 retires it: what it said comes from the template, from the application's request and from the wallet's own record. An application's page then carries what only the application knows, and the wallet acts by itself only where nothing is missing.

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

- Design 3, as built: [architecture proposal v0.6](Grandmas_Wallet_Architecture_Proposal_v0.6.md), [implementation plan v0.6](IMPLEMENTATION_PLAN_v0.6.md), and the [illustrated overview v0.6](https://blaze2026.9500.cash/design.html) ([source](docs/design_v0.6.html))
- Design 2, at the tag `design-2`: [architecture proposal v0.4](Grandmas_Wallet_Architecture_Proposal_v0.4.md), [implementation plan v0.4](IMPLEMENTATION_PLAN_v0.4.md), and the [illustrated overview v0.5](https://blaze2026.9500.cash/design_v0.5.html) ([source](docs/design_v0.5.html))
- [Decisions log](docs/decisions.md)
- Proposed, not built: [token names and units from registries (BCMR)](docs/token-registries.md)
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
