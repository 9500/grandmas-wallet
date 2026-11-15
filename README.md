# Grandma's Wallet

A Bitcoin Cash wallet that can recover access after a lost phone without manual backups. A trusted recoverer (the "bank") can replace the wallet's owner key only after an on-chain claim and an uncontested challenge period; the existing wallet can cancel the claim at any time before that.

Built for BCH Blaze 2026 on the XO stack.

**Status:** early development. The recovery controller contract exists and is tested in a virtual machine only. Nothing has been audited or run on a network.

## Documents

- [Architecture proposal v0.1](Grandmas_Wallet_Architecture_Proposal_v0.1.md)
- [Implementation plan](IMPLEMENTATION_PLAN.md)
- [Decisions log](docs/decisions.md)

## Development

Requires Node 22 or later.

```bash
npm install
npm run check             # typecheck, lint, tests
npm run build:contracts   # recompile contracts after editing them
```

## License

[MIT](LICENSE)
