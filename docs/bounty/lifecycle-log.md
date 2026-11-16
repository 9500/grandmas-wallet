# Lifecycle through the XO engine

Written by `npm run xo-demo -- run`. Every transaction was built and signed by the XO engine from an invitation, checked against the network's script rules by this project's own code, and then broadcast by the engine on chipnet.

- Template: Grandma's Wallet version 1, identifier `f33c98ed0d081ac3544976c7e7b9795ec47a0d45924b530e26c55645d2860588`
- Wallet identity: `b894c28098532e014ccea22b077917a63b679c761c53eaabd0f22b838cc703cc`
- Wallet address: `bchtest:pd57vn3vymdadnkfej9xz50qw262kusq6h872y6s7ajcn79juz4ccmu2fk8a4`

| # | Step | Account | What it shows | Transaction | Invitation |
| --- | --- | --- | --- | --- | --- |
| 1 | create-wallet | owner | Owner sets up the wallet alone; the recoverer is enrolled by its key hash only | `d8f0c74f5f359a97ded8e25836448be419b3df3fbd8bb1017272a57a2979f18e` | [01-create-wallet.json](invitations/01-create-wallet.json) |
| 2 | send | owner | Owner pays from the wallet without the recoverer | `a374211685bc77269e0aa7bfe05d70fd4de3d00f8d2ec822bac0f93dc00769ba` | [02-send.json](invitations/02-send.json) |
| 3 | request-recovery-1 | recoverer | Recoverer and replacement device request recovery together; the recoverer pays the fee | `70f04c8d367fd014ac5332dcfe71edd74af1967fb7f7fb45369e7bcd6baf265f` | [03-request-recovery-1.json](invitations/03-request-recovery-1.json) |
| 4 | cancel-recovery | owner | Owner cancels the recovery request | `8b88112a6c9164d30192555afc46960da61302a7b1ffdad2113c42feee1a4c2c` | [04-cancel-recovery.json](invitations/04-cancel-recovery.json) |
| 5 | open-savings-jar | owner | Owner pays into a savings jar, an application with its own template | `29b885d1dd69bc318c4a733875c690ebdd522a4a14e7a75670eba545017d31b1` | [05-open-savings-jar.json](invitations/05-open-savings-jar.json) |
| 6 | request-recovery-2 | recoverer | Recoverer and replacement device request recovery together; the recoverer pays the fee | `f5bb6ced24b0c5ecbd231f79f4447a33886776dead19bdc7701e9d8e4f7b1fe3` | [06-request-recovery-2.json](invitations/06-request-recovery-2.json) |
| 7 | complete-recovery | recoverer | Recoverer completes recovery once the challenge delay has passed | `4af217c4b1b08979dff2d99420df1f0becdd8a257578f52812a8e051a019971d` | [07-complete-recovery.json](invitations/07-complete-recovery.json) |
| 8 | send-after-recovery | replacement | New owner pays from the same wallet funds, which never moved | `9136bab7ab9463b6edc859fc095ae8b0ed8da23590fbbbea751136fbb58caa25` | [08-send-after-recovery.json](invitations/08-send-after-recovery.json) |
| 9 | empty-savings-jar | replacement | New owner approves emptying the savings jar after its unlock time; the jar never moved | `e8c21633ae530159f6e652762f60a2f2d4a27f39b39cd49e53344e56dcd3a21f` | [09-empty-savings-jar.json](invitations/09-empty-savings-jar.json) |
| 10 | change-recovery-settings | replacement | New owner changes the challenge delay, paying the fee from outside the wallet | `937d7e9904d664b9f384b215d82a317b4a46277d8f14a069ceb865791ce9d021` | [10-change-recovery-settings.json](invitations/10-change-recovery-settings.json) |
