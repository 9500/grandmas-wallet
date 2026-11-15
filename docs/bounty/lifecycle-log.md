# Lifecycle through the XO engine

Written by `npm run xo-demo -- run`. Every transaction was built and signed by the XO engine from an invitation, checked against the network's script rules by this project's own code, and then broadcast by the engine on chipnet.

- Template: Grandma's Wallet version 1, identifier `16b3adcc29848aa87daf71774e8b47c25ae6da8c93640ea30e2f2a7b838527fe`
- Wallet identity: `970a0752b0f721b68f635e05a27cdcfd78c01d02cb0f48bb5e4bdf6e0863a5d3`
- Wallet address: `bchtest:pdjl76nsy9pv74gwmyft7fvth0cl44lph0ardtg3vpvrwta35rzy2q6mlvnta`

| # | Step | Account | What it shows | Transaction | Invitation |
| --- | --- | --- | --- | --- | --- |
| 1 | create-wallet | owner | Owner sets up the wallet alone; the recoverer is enrolled by its key hash only | `abe03b6a1a008b011be412613db1e23e4aa60026b3982ed750afe21067700351` | [01-create-wallet.json](invitations/01-create-wallet.json) |
| 2 | send | owner | Owner pays from the wallet without the recoverer | `efa3c6b914000c616618be5ad7c92bd048ec767c95ba55b6cddbce2cd312ac8a` | [02-send.json](invitations/02-send.json) |
| 3 | request-recovery-1 | recoverer | Recoverer and replacement device request recovery together; the recoverer pays the fee | `2edbe498e4aa3aa9b41d1080e6c69cd0d11ca087c2d12d159be7a5ce888ebb09` | [03-request-recovery-1.json](invitations/03-request-recovery-1.json) |
| 4 | cancel-recovery | owner | Owner cancels the recovery request | `e09fadc46f49f98bbabb14b5b7f28de38765acc19942262d71461a044d023446` | [04-cancel-recovery.json](invitations/04-cancel-recovery.json) |
| 5 | open-savings-jar | owner | Owner pays into a savings jar, an application with its own template | `f2f6f3a9bbd13e48cc59b39f93bf386f9be2f78953ea365a305a0ff81f8ba370` | [05-open-savings-jar.json](invitations/05-open-savings-jar.json) |
| 6 | request-recovery-2 | recoverer | Recoverer and replacement device request recovery together; the recoverer pays the fee | `0b22d5e024568fd57161046b184c4af276c44b86e9e76fde06e92d83db2773f1` | [06-request-recovery-2.json](invitations/06-request-recovery-2.json) |
| 7 | complete-recovery | recoverer | Recoverer completes recovery once the challenge delay has passed | `0a14ac74535a7d6770990305b90fcf226ab14878580499851f018a1dee0d3e40` | [07-complete-recovery.json](invitations/07-complete-recovery.json) |
