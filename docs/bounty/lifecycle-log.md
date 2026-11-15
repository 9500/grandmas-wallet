# Lifecycle through the XO engine

Written by `npm run xo-demo -- run`. Every transaction was built and signed by the XO engine from an invitation, checked against the network's script rules by this project's own code, and then broadcast by the engine on chipnet.

- Template: Grandma's Wallet version 1, identifier `edf2e4b4b423a785602b8837dfc82e7823f9558254889c6be8d4df02aad17642`
- Wallet identity: `29c932dc2911b63d077e494f58778b28302a144f4a026528d627a4e29365155f`
- Wallet address: `bchtest:p0hc7e5mdtnm2a38t9q2yhyxywzqj6hj9h049jjme520d4dp00ggzaw4923nt`

| # | Step | Account | What it shows | Transaction | Invitation |
| --- | --- | --- | --- | --- | --- |
| 1 | create-wallet | owner | Owner sets up the wallet alone; the recoverer is enrolled by its key hash only | `06074deb17b461965c63bd104913437404a47a0f7eecfb6734cf393b59c2c414` | [01-create-wallet.json](invitations/01-create-wallet.json) |
| 2 | open-savings-jar | owner | Owner locks funds in a savings jar | `dcf0163daa512c2e9539bc81f13a404fe4519be30f2c82b1bd31814159136bf6` | [02-open-savings-jar.json](invitations/02-open-savings-jar.json) |
| 3 | request-recovery | recoverer | Recoverer and replacement device request recovery together; the recoverer pays the fee | `ec4471594ac250e7492bc44f8b5a8efd9faa6bb98e5d08aaf2bb2d1e2d392d04` | [03-request-recovery.json](invitations/03-request-recovery.json) |
| 4 | complete-recovery | recoverer | Recoverer completes recovery once the challenge delay has passed | `3c0288ba2db90cede67ec0adb2ef12b6bb1c6a01d0a7fb931543a10b4252754b` | [04-complete-recovery.json](invitations/04-complete-recovery.json) |
| 5 | empty-savings-jar | replacement | New owner empties the savings jar after its unlock time; the jar never moved | `9fbbf9a19eb1c308950d5c049cd69120fadbebb7acc86bf4b4acbeefd037c135` | [05-empty-savings-jar.json](invitations/05-empty-savings-jar.json) |
