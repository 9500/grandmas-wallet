# Grandma's Wallet

A Bitcoin Cash wallet that can recover access after a lost phone without manual backups. Every address of the wallet has its own key for everyday use and a second way to spend through the wallet's controller on chain. A trusted recoverer can replace the wallet's owner key only after a request that has stayed unchallenged on chain for a waiting period; the owner can cancel the request at any time before that. The new device then moves the wallet's coins and tokens to addresses of its own.

Built for BCH Blaze 2026 on the XO stack.

**Status:** this branch is being rebuilt to the design in [docs/design.html](docs/design.html). It holds the parts that the design uses as they are: the controller contract and its tests, reading and checking a controller's history from the chain, access to chipnet servers, the waiting-period calculation and the recovery alarm, sealing and backup stores, the WizardConnect message set, and the page components. The addresses, the wallet, the recoverer and the applications are not here yet. Nothing has been audited.

The first design, with its web demonstration and chipnet runs, is on the `main` branch and at the tag `design-1`.

## Documents

- [Design](docs/design.html) (open in a browser)
- [Decisions log](docs/decisions.md)
- What was learned about the XO engine: [trial](docs/xo-spike.md), [signing problem](docs/xo-engine-signing-bug.md), [chipnet header verification](docs/xo-chipnet-header-verification.md), [notes for feedback](docs/xo-feedback-notes.md)

## Development

Requires Node 22 or later.

```bash
npm install
npm run check             # typecheck, lint, tests
npm run build:contracts   # recompile contracts after editing them
```

## License

[MIT](LICENSE)
