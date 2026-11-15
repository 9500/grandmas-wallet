# Lifecycle through the XO engine

Written by `npm run xo-demo -- run`. Every transaction was built and signed by the XO engine from an invitation, checked against the network's script rules by this project's own code, and then broadcast by the engine on chipnet.

- Template: Grandma's Wallet version 1, identifier `e815bceb9bd0de490c307c95bebb70ac2629e1b33159b41619e9029a7a0cf307`
- Wallet identity: `a2a4566e56f6999d86c6b56a9804ae015f085893c4f09effc019b5b3f66d3a04`
- Wallet address: `bchtest:p0ue427emz642pf66nr93mvsqchdhk62ay8jh2rltvyu7wnu2v76x2rd0tewc`

| # | Step | Account | What it shows | Transaction | Invitation |
| --- | --- | --- | --- | --- | --- |
| 1 | create-wallet | owner | Owner sets up the wallet alone; the recoverer is enrolled by its key hash only | `4445fe455afdb31594928942fa30ca446f00de372e2c6bcd42185edabf992b75` | [01-create-wallet.json](invitations/01-create-wallet.json) |
| 2 | request-recovery-1 | recoverer | Recoverer and replacement device request recovery together; the recoverer pays the fee | `c645b8c1668e56754666cde53a2039a5089649179a6da531ecdfb2bf0c2dbad5` | [02-request-recovery-1.json](invitations/02-request-recovery-1.json) |
