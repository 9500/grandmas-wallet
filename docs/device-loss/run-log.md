# Device loss and restoration through the XO engine

Written by `npm run xo-demo -- device-loss`. Every transaction was built and signed by the XO engine from an invitation, checked against the network's script rules by this project's own code, and then broadcast by the engine on chipnet.

- Template: Grandma's Wallet version 1, identifier `f33c98ed0d081ac3544976c7e7b9795ec47a0d45924b530e26c55645d2860588`
- Wallet identity: `a97bb094031d2dd809fba8174b363e15fb926ba173097616f5e2e5cf528e778f`
- Wallet address: `bchtest:pda8e564fl86a6xst4ga989q9zfu4zh22jnsy93pcuwkyqymh4uxc6hgpwx4a`

| # | Step | Account | What it shows | Transaction | Invitation |
| --- | --- | --- | --- | --- | --- |
| 1 | create-wallet | owner | Owner sets up the wallet alone; the recoverer is enrolled by its key hash only | `b7bef16da06d0ab5864e6287bd0b80a2ef849fdf27c8d4463253bc3645992043` | [01-create-wallet.json](invitations/01-create-wallet.json) |
| 2 | open-savings-jar | owner | Owner pays into a savings jar, an application with its own template | `61ff4efb9ee517cc8f729ad47b290cc6b54d484de69be401c4c0df37f59cfbb7` | [02-open-savings-jar.json](invitations/02-open-savings-jar.json) |
| 3 | request-recovery | recoverer | Recoverer and replacement device request recovery together; the recoverer pays the fee | `adb8067f68e0e729a87dccf9db7487b66ed2f24e9c02166053f3f676082c70de` | [03-request-recovery.json](invitations/03-request-recovery.json) |
| 4 | complete-recovery | recoverer | Recoverer completes recovery once the challenge delay has passed | `1d261d7ac43b2fc0e20bff673a06de838fdc3f7ceeacd5d0616a7e3b910939be` | [04-complete-recovery.json](invitations/04-complete-recovery.json) |
| 5 | empty-savings-jar | replacement | New owner approves emptying the savings jar after its unlock time; the jar never moved | `2f3ae809389c6bfb5b7f8c9e4e73dab71999c79def043b2d64d536286cd1c9f8` | [05-empty-savings-jar.json](invitations/05-empty-savings-jar.json) |
