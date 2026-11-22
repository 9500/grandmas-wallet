# Five XO Grid templates on chipnet

Written by the run itself (`scripts/xo-grid-run.ts chipnet`). An owner's wallet on the unmodified XO engine, on chipnet, paid from the funding address and with everything that is not given away by design returned to it at the end; no block was made by the run. Each part ran in a process of its own with an empty engine state. The wallet has its recovery arrangement and two backup stores (directories of the run, read and written as a store server's are), and each template was stored in the backup before its first action.

The templates' texts were taken from XO Grid (https://xogrid.vercel.app/api/templates/<identifier>/raw) at run time, 2026-11-22T04:08:24.206Z, and checked with the wallet's own reader to have the identifier asked for. They are not this project's and are kept only in the run's git-ignored folder, as are the engine's invitations, which hold them. The wallet took each in as a person adding a file does; the run then asked as an application's page would: a request naming the template, action, role and values, and for an action on a coin of the application's, the coin by outpoint. Drip Mine's `fund` was asked from the wallet's own list of the template's actions instead.

- Template "Drip Mine": `346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185`
- Template "Revenue Split": `b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e`
- Template "Claim-Code Voucher": `317c4947b5b9cc71d1fe01616cdc930b6ca3ef5808700c68d1cb0696e79b4911`
- Template "Token Burner": `1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0`
- Template "Block Points": `9941f723c962e64956c5dcbc9e97e6a735736e4a8e94b24d7d77e6b0eeee3e5a`
- Wallet identity: `693681fc5bb7c0bbbedc64ebc4550328c7da0298bbd4c7fdc53657d0af89b855`
- Test token category: `34a3757fdbb46ba4cb6a3a795815c71f0b6f82dd2a6074c2b9e96630314efada`, 1000000 tokens made by the funder for the run
- Repository at commit `45c8553`
- Started 2026-11-22T04:08:15.742Z
- The engine ran as published, with no local change, given one server (chipnet.9500.cash), as in run B.

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| fund the wallet | `693681fc5bb7c0bbbedc64ebc4550328c7da0298bbd4c7fdc53657d0af89b855` | 219 | 219 | the funder pays 80000 satoshis to the wallet's funding address |  |
| create | `553bd4e1d78a6d0bd1ad7062051a3050729b033697bed9e7d4aaf813e89c7ffd` | 343 | 343 | the controller and the rest | create (owner) |
| a coin for the test tokens | `34a3757fdbb46ba4cb6a3a795815c71f0b6f82dd2a6074c2b9e96630314efada` | 219 | 219 | the funder pays itself a coin that is output 0 of its transaction, to make a token category from |  |
| make the test tokens | `f36069faab06b678f11f0402ba7a29e03a0b9349f006e58234296b16c741ec31` | 268 | 268 | the funder makes 1000000 fungible tokens of a new category and pays them, with 1000 satoshis, to an address the wallet gave out |  |
| Drip Mine: fund | `c08aa8b1f5f674773629c222c27940695a2fd7aa904d25121da27c2745efd9f7` | 394 | 394 | from the wallet's own list, as the funder role (change 1): 1500 satoshis into the Drip Mine, never to come back by design; 1 input(s), 2 output(s): 1500, 76763 | fund (funder) |
| Revenue Split: fundSplit | `54265d67356ed3b00b0eab9881703be667819ad06cf4290cea17f62004e60990` | 394 | 394 | as the payer: 3000 satoshis into the split; 1 input(s), 2 output(s): 3000, 73369 | fundSplit (payer) |
| Revenue Split: payout | `4da63785025d562e7aa19c79b0565b814e287aa28e86b247d53165689b906f1e` | 653 | 653 | as the trigger, the coin by outpoint: the three shares to the funding address, the wallet pays the fee; 2 input(s), 4 output(s): 1500, 900, 600, 72716 | payout (trigger) |
| Claim-Code Voucher: createVoucher | `77c6e146b391998ba4288a4838392fceac0fd55e39c2947703ce7e0335317b1f` | 394 | 394 | as the issuer: 3000 satoshis locked to the hash of a code; 1 input(s), 2 output(s): 3000, 69322 | createVoucher (issuer) |
| Claim-Code Voucher: claimVoucher | `9219023a54a2ad7dbe71fb2cad3a15af3a4664eeef249ac42e740abb1fe2d7e9` | 188 | 188 | as the claimer, the coin by outpoint, with the code and the hash its script holds (change 4): the voucher's value back to the wallet; 1 input(s), 1 output(s): 2812 | claimVoucher (claimer) |
| Token Burner: depositSatoshis | `31e16cf47e84702af3d1009704c1205cc30850489830c60bf99ef6867e7a11ea` | 394 | 394 | as the depositor: 1000 satoshis to the burner; 1 input(s), 2 output(s): 1000, 67928 | depositSatoshis (depositor) |
| Token Burner: burn satoshis | `6f1f3a965c2f682745a888594dba92d00e3f6d90f8ff8eeb5617955d016896d2` | 101 | 1000 | as the burner, the coin by outpoint (change 3): the coin's satoshis to the fee, no change output; 1 input(s), 1 output(s): 0 (OP_RETURN) | burn (burner) |
| Token Burner: depositFungibleTokens | `ca64494cf34774280bd5f4bcb9d05e811cb1179793dad65272d29c006aece0e1` | 808 | 808 | as the depositor, the category the request gives (change 2): 200 of the wallet's test tokens with 1000 satoshis to the burner, the rest back to the wallet; 2 input(s), 3 output(s): 1000 with 200 tokens, 693 with 999800 tokens, 66427 | depositFungibleTokens (depositor) |
| Token Burner: burn tokens | `073deea996b32e11f6e9b1253ff80c1cd1bd426dc181fd8cd97f6c7a8af2a291` | 101 | 1000 | as the burner, the coin by outpoint (changes 2 and 3): 200 tokens destroyed, the coin's satoshis to the fee; 1 input(s), 1 output(s): 0 (OP_RETURN) | burn (burner) |
| Block Points: fundThread | `d2545ee4100e6fb87bcb63145b7d789ea335ee8dbdb562e851a6a35be33906ba` | 812 | 812 | as the funder, the category the request gives (change 2): 100000 test tokens with 1000 satoshis into the shared vault, where they stay by design; 2 input(s), 3 output(s): 1000 with 100000 tokens, 693 with 899800 tokens, 64615 | fundThread (funder) |
| Drip Mine: drip | `6c987c27e78095c1892442cd434c16e4d6033fb73551df3abbe0d5f03b2cddc8` | 164 | 164 | as the dripper, the coin by outpoint (change 3): the contract's payout of 164 satoshis is the fee, the rest back to the Drip Mine; the run waited 8 minute(s) for the coin's lock after the other steps; 1 input(s), 1 output(s): 1336 | drip (dripper) |
| send the test tokens on | `16412eccf34566fcc5573327cd403f29d81643c9773eceddf4cf0168ca11df6e` | 719 | 719 | 899800 test tokens, unchanged, to the funding address | pay (owner) |
| close | `25ef029be8081ecb7afa4d9b27cefdcc1e51448da8dbb3d1273f734f482c4135` | 1273 | 1273 | everything, and the controller's value, back to the funding address | close (owner) |
| burn the remaining test tokens | `4c147a11e3ec39d5fa62af9814d3fc25fa2b83ed32a58dc0dd50e5a3b334c0c8` | 326 | 326 | the funder destroys the 899800 test tokens that came back and keeps their coins' satoshis |  |

Also observed:

- The five templates' texts were taken from XO Grid at 2026-11-22T04:08:24.206Z; the wallet's reader found each to have the identifier asked for: "Drip Mine", "Revenue Split", "Claim-Code Voucher", "Token Burner", "Block Points".
- The wallet read "Drip Mine" from its file as "new" and trusted it on the user's word; stored in the backup: yes.
- The wallet read "Revenue Split" from its file as "new" and trusted it on the user's word; stored in the backup: yes.
- The wallet read "Claim-Code Voucher" from its file as "new" and trusted it on the user's word; stored in the backup: yes.
- The wallet read "Token Burner" from its file as "new" and trusted it on the user's word; stored in the backup: yes.
- The wallet read "Block Points" from its file as "new" and trusted it on the user's word; stored in the backup: yes.
- Drip Mine, from the wallet's own list of the template's actions: [{"action":"fund","role":"funder"},{"action":"drip","role":"dripper","needsApplication":"It spends a coin of the application's, \"Drip Mine coin\", which only the application can name."},{"action":"terminate","role":"dripper","needsApplication":"It spends a coin of the application's, \"Drip Mine coin\", which only the application can name."}], the role names {"funder":"Funder","dripper":"Dripper"}, no settled role (none).
- Drip Mine: fund: the wallet's review gives 78657, gets 76763, fee 394, into the application 1500, from the application 0 in 0 coin(s).
- Revenue Split: fundSplit: the wallet's review gives 76763, gets 73369, fee 394, into the application 3000, from the application 0 in 0 coin(s).
- Revenue Split: payout: the wallet's review gives 73369, gets 72716, fee 653, into the application 0, from the application 3000 in 1 coin(s).
- Claim-Code Voucher: createVoucher: the wallet's review gives 72716, gets 69322, fee 394, into the application 3000, from the application 0 in 0 coin(s).
- Claim-Code Voucher: claimVoucher: the wallet's review gives 0, gets 2812, fee 188, into the application -3000, from the application 3000 in 1 coin(s).
- Token Burner: depositSatoshis: the wallet's review gives 69322, gets 67928, fee 394, into the application 1000, from the application 0 in 0 coin(s).
- Token Burner: burn satoshis: the wallet's review gives 0, gets 0, fee 1000 (of it 1000 from the application's coin), into the application -1000, from the application 1000 in 1 coin(s).
- Token Burner: depositFungibleTokens: the wallet's review gives 68928, gets 67120, fee 808, into the application 1000, from the application 0 in 0 coin(s); tokens leaving: 200 leaves.
- Token Burner: burn tokens: the wallet's review gives 0, gets 0, fee 1000 (of it 1000 from the application's coin), into the application -1000, from the application 1000 in 1 coin(s).
- Block Points: fundThread: the wallet's review gives 67120, gets 65308, fee 812, into the application 1000, from the application 0 in 0 coin(s); tokens leaving: 100000 leaves.
- Drip Mine: drip: the wallet's review gives 0, gets 0, fee 164 (of it 164 from the application's coin), into the application -164, from the application 1500 in 1 coin(s).
- The Drip Mine's coin was funded in block 342362; the drip was accepted with the tip at 342371.
- Before closing, the wallet's full search over its seed ended as "fully-found".
- The wallet is closed: its controller's history reads closed, with no transition before.
- The funding address held 159506886 satoshis before the run and holds 159494982 after it: 11904 satoshis did not come back (if no other run paid from the same key meanwhile). By design: the Drip Mine's coin (1500 satoshis paid in, its drip's payout the fee and the rest still at the Drip Mine's address, where anyone may drip it to miners), the two burned coins (2000 satoshis, all fee), and the Block Points thread (1000 satoshis and 100000 test tokens in the shared vault, for anyone to claim); the fees of the run's transactions in the table add up to 9568 satoshis, the two burns' and the drip's included. Of the 1000000 test tokens, 200 were burned at the Token Burner, 100000 are in the Block Points vault, and the rest came back to the funder, which destroyed them. Nothing is left at the wallet.
