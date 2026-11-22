# Five XO Grid templates on the local node

Written by the run itself (`scripts/xo-grid-run.ts`). An owner's wallet on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The wallet has its recovery arrangement and two backup stores (directories of the run, read and written as a store server's are), and each template was stored in the backup before its first action.

The templates' texts were taken from XO Grid (https://xogrid.vercel.app/api/templates/<identifier>/raw) at run time, 2026-11-22T03:38:46.610Z, and checked with the wallet's own reader to have the identifier asked for. They are not this project's and are kept only in the run's git-ignored folder, as are the engine's invitations, which hold them. The wallet took each in as a person adding a file does; the run then asked as an application's page would: a request naming the template, action, role and values, and for an action on a coin of the application's, the coin by outpoint. Drip Mine's `fund` was asked from the wallet's own list of the template's actions instead.

- Template "Drip Mine": `346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185`
- Template "Revenue Split": `b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e`
- Template "Claim-Code Voucher": `317c4947b5b9cc71d1fe01616cdc930b6ca3ef5808700c68d1cb0696e79b4911`
- Template "Token Burner": `1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0`
- Template "Block Points": `9941f723c962e64956c5dcbc9e97e6a735736e4a8e94b24d7d77e6b0eeee3e5a`
- Wallet identity: `b7bf4b3560a11f89b9b18650cf09b754c449c1a02fae2e5f62110ba5dc29dd03`
- Test token category: `4118f7c0145836fc4832bb5169dd1d40113983a71225dd73b434b34c16cb3055`, 1000000 tokens made by the funder for the run
- Repository at commit `91cce48`, with uncommitted changes to scripts/xo-grid-run.ts
- Started 2026-11-22T03:38:45.453Z

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| fund the wallet | `b7bf4b3560a11f89b9b18650cf09b754c449c1a02fae2e5f62110ba5dc29dd03` | 219 | 219 | the funder pays 80000 satoshis to the wallet's funding address |  |
| create | `8e3206303aab56b2077cf6661a3df1c19fae02fb4cf5f1f9e94703d2a6afc531` | 343 | 343 | the controller and the rest | create (owner) |
| a coin for the test tokens | `4118f7c0145836fc4832bb5169dd1d40113983a71225dd73b434b34c16cb3055` | 219 | 219 | the funder pays itself a coin that is output 0 of its transaction, to make a token category from |  |
| make the test tokens | `45db148c2fac106cb2d5031ff831cf30002f0c8fe875c30fe28d5da1c7944255` | 268 | 268 | the funder makes 1000000 fungible tokens of a new category and pays them, with 1000 satoshis, to an address the wallet gave out |  |
| Drip Mine: fund | `de8c1f26e4a4caf485c758ca395fbec05fc1a0c4dc119c10b87cdea73644c0b7` | 394 | 394 | from the wallet's own list, as the funder role (change 1): 1500 satoshis into the Drip Mine, never to come back by design; 1 input(s), 2 output(s): 1500, 76763 | fund (funder) |
| Revenue Split: fundSplit | `d820782e418e600b7812d6de5e14d56044607df838ea21d34ae3dc9d5e435dc0` | 394 | 394 | as the payer: 3000 satoshis into the split; 1 input(s), 2 output(s): 3000, 73369 | fundSplit (payer) |
| Revenue Split: payout | `562068e040ebbcaa0f4d77f03439c823e8c37b1440277181edc24d0c266164c0` | 653 | 653 | as the trigger, the coin by outpoint: the three shares to the funding address, the wallet pays the fee; 2 input(s), 4 output(s): 1500, 900, 600, 72716 | payout (trigger) |
| Claim-Code Voucher: createVoucher | `827267ac3a095d822d73f277564a79c1bfdc2625ed8f9753c41429c82547527c` | 394 | 394 | as the issuer: 3000 satoshis locked to the hash of a code; 1 input(s), 2 output(s): 3000, 69322 | createVoucher (issuer) |
| Claim-Code Voucher: claimVoucher | `81fa5c31fe7d8e862480032d7febfbe4affcf982a27e6e0b48720949d0ec143f` | 188 | 188 | as the claimer, the coin by outpoint, with the code and the hash its script holds (change 4): the voucher's value back to the wallet; 1 input(s), 1 output(s): 2812 | claimVoucher (claimer) |
| Token Burner: depositSatoshis | `a497c58eb06a59e68cd75c8a91dcf41d8e677f6a569e80adcc305bb64c42a37a` | 394 | 394 | as the depositor: 1000 satoshis to the burner; 1 input(s), 2 output(s): 1000, 67928 | depositSatoshis (depositor) |
| Token Burner: burn satoshis | `3c36438b5b20c453b52ec44d8087109a91b6e2438af4617e2f6a6dac73c70010` | 101 | 1000 | as the burner, the coin by outpoint (change 3): the coin's satoshis to the fee, no change output; 1 input(s), 1 output(s): 0 (OP_RETURN) | burn (burner) |
| Token Burner: depositFungibleTokens | `fe793b96353a5df0ac4e1089be3d4a057f0c9324fe681fabf9a51d1efa6033ca` | 808 | 808 | as the depositor, the category the request gives (change 2): 200 of the wallet's test tokens with 1000 satoshis to the burner, the rest back to the wallet; 2 input(s), 3 output(s): 1000 with 200 tokens, 693 with 999800 tokens, 66427 | depositFungibleTokens (depositor) |
| Token Burner: burn tokens | `fc509c55e68e1b6be7bb3d038adafc8021713560c94e51876ca7838593b0c55f` | 101 | 1000 | as the burner, the coin by outpoint (changes 2 and 3): 200 tokens destroyed, the coin's satoshis to the fee; 1 input(s), 1 output(s): 0 (OP_RETURN) | burn (burner) |
| Block Points: fundThread | `c2d1c23ade42180c2ebc5b8c37eb65bbf2434e932de7fa2ab45f811841788903` | 812 | 812 | as the funder, the category the request gives (change 2): 100000 test tokens with 1000 satoshis into the shared vault, where they stay by design; 2 input(s), 3 output(s): 1000 with 100000 tokens, 693 with 899800 tokens, 64615 | fundThread (funder) |
| Drip Mine: drip | `1b94bab10f434e8458f9fd2d7417852be9ea8bb62049ea7844b8d39581c4ccc2` | 164 | 164 | as the dripper, the coin by outpoint (change 3): the contract's payout of 164 satoshis is the fee, the rest back to the Drip Mine; 1 input(s), 1 output(s): 1336 | drip (dripper) |
| send the test tokens on | `296a25dd32b9b48347fd385bc321714c4563abb562a12d07d5b2a917b3efa897` | 719 | 719 | 899800 test tokens, unchanged, to the funding address | pay (owner) |
| close | `ff7c7dd5abc5fd44493094db0648f2fc4663a2e4aa9f4e56eff6fd7b5ff89446` | 1273 | 1273 | everything, and the controller's value, back to the funding address | close (owner) |
| burn the remaining test tokens | `78aba380dda7a7d399ad718c9b79112f013aa2411c882344c98e2a0aee7987c6` | 1031 | 1031 | the funder destroys the 899800 test tokens that came back and keeps their coins' satoshis |  |

Also observed:

- The five templates' texts were taken from XO Grid at 2026-11-22T03:38:46.610Z; the wallet's reader found each to have the identifier asked for: "Drip Mine", "Revenue Split", "Claim-Code Voucher", "Token Burner", "Block Points".
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
- The Drip Mine's coin was funded in block 1088; the drip was accepted with the tip at 1096.
- Before closing, the wallet's full search over its seed ended as "fully-found".
- The wallet is closed: its controller's history reads closed, with no transition before.
- The funding address held 78125000 satoshis before the run and holds 78112391 after it: 12609 satoshis did not come back. By design: the Drip Mine's coin (1500 satoshis paid in, its drip's payout the fee and the rest still at the Drip Mine's address, where anyone may drip it to miners), the two burned coins (2000 satoshis, all fee), and the Block Points thread (1000 satoshis and 100000 test tokens in the shared vault, for anyone to claim); the fees of the run's transactions in the table add up to 10273 satoshis, the two burns' and the drip's included. Of the 1000000 test tokens, 200 were burned at the Token Burner, 100000 are in the Block Points vault, and the rest came back to the funder, which destroyed them. Nothing is left at the wallet.
