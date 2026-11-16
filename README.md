# Grandma's Wallet

A Bitcoin Cash wallet that can recover access after a lost phone without manual backups. A trusted recoverer (the "bank") can replace the wallet's owner key only after an on-chain claim and an uncontested challenge period; the existing wallet can cancel the claim at any time before that.

Built for BCH Blaze 2026 on the XO stack.

**Status:** early development, chipnet only. The contracts are tested in a virtual machine and have run through the full recovery lifecycle on chipnet, both with this project's own transaction builder and through the XO engine using the project's XO templates. A recoverer can be enrolled with one sealed package, and a replacement device can rebuild the wallet from that package, the chain and an encrypted archive; this is tested against a simulated chain and has been run on chipnet through the XO engine. The wallet, the recoverer and a small application run as web pages, tried end to end on chipnet. The wallet has no code for any application: an application presents its XO template, the user decides whether to trust it, and the wallet carries out the template's actions. The same application also works with ordinary wallets over WizardConnect, checked with Cashonize. Nothing has been audited.

## Documents

- [Architecture proposal v0.1](Grandmas_Wallet_Architecture_Proposal_v0.1.md)
- [Implementation plan](IMPLEMENTATION_PLAN.md)
- [Decisions log](docs/decisions.md)
- [Chipnet run](docs/chipnet-run.md) and its [results](docs/chipnet-log.md)
- [XO templates, invitations and how to reproduce them](docs/bounty/README.md)
- [Enrollment and restoration](docs/restoration.md)
- [The web applications](docs/web-apps.md): what they do, how they talk to each other, how to run them
- [What was learned about the XO engine](docs/xo-spike.md)

## Development

Requires Node 22 or later.

```bash
npm install
npm run check             # typecheck, lint, tests
npm run build:contracts   # recompile contracts after editing them
npm run build:web         # build the three web applications
```

## License

[MIT](LICENSE)
