# Five XO Grid templates on the local node

Written by the run itself (`scripts/xo-grid-run.ts`). An owner's wallet on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The wallet has its recovery arrangement and two backup stores (directories of the run, read and written as a store server's are), and each template was stored in the backup before its first action.

The templates' texts were taken from XO Grid (https://xogrid.vercel.app/api/templates/<identifier>/raw) at run time, 2026-11-22T03:50:18.742Z, and checked with the wallet's own reader to have the identifier asked for. They are not this project's and are kept only in the run's git-ignored folder, as are the engine's invitations, which hold them. The wallet took each in as a person adding a file does; the run then asked as an application's page would: a request naming the template, action, role and values, and for an action on a coin of the application's, the coin by outpoint. Drip Mine's `fund` was asked from the wallet's own list of the template's actions instead.

- Template "Drip Mine": `346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185`
- Template "Revenue Split": `b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e`
- Template "Claim-Code Voucher": `317c4947b5b9cc71d1fe01616cdc930b6ca3ef5808700c68d1cb0696e79b4911`
- Template "Token Burner": `1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0`
- Template "Block Points": `9941f723c962e64956c5dcbc9e97e6a735736e4a8e94b24d7d77e6b0eeee3e5a`
- Wallet identity: `05de806aed2b160c0e889ee42dd4189055f5f1b0c25526c78aeffd8742940176`
- Test token category: `98ff2ae3056ee1fad9d28b3470653a312f9b682f2889224d9ca0a5e01f3ec733`, 1000000 tokens made by the funder for the run
- Repository at commit `4e297de`
- Started 2026-11-22T03:50:17.281Z

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| fund the wallet | `05de806aed2b160c0e889ee42dd4189055f5f1b0c25526c78aeffd8742940176` | 219 | 219 | the funder pays 80000 satoshis to the wallet's funding address |  |
| create | `6218e367186a6d9f19f08e35d046eb7ead5c242b9d88473fae097f360a394300` | 343 | 343 | the controller and the rest | create (owner) |
| a coin for the test tokens | `98ff2ae3056ee1fad9d28b3470653a312f9b682f2889224d9ca0a5e01f3ec733` | 219 | 219 | the funder pays itself a coin that is output 0 of its transaction, to make a token category from |  |
| make the test tokens | `35772c2b50b0d50d9803bc15dba1cd7bede48fb3c59207dcab5ae6bd5f7e0e0e` | 268 | 268 | the funder makes 1000000 fungible tokens of a new category and pays them, with 1000 satoshis, to an address the wallet gave out |  |
| Drip Mine: fund | `df90002f847f2a69da3752734640670843670c28c786213ce4c5e0268bb7fee7` | 394 | 394 | from the wallet's own list, as the funder role (change 1): 1500 satoshis into the Drip Mine, never to come back by design; 1 input(s), 2 output(s): 1500, 76763 | fund (funder) |
| Revenue Split: fundSplit | `82ecfbf8a743ccbaddb61fc0b35b2c27a3fca0451097fd2cddfb6d5b671308e5` | 394 | 394 | as the payer: 3000 satoshis into the split; 1 input(s), 2 output(s): 3000, 73369 | fundSplit (payer) |
| Revenue Split: payout | `24a411cd84774fb6c335761b23a2465b70f5ac69f28fa24bc72a05a53a7aa637` | 653 | 653 | as the trigger, the coin by outpoint: the three shares to the funding address, the wallet pays the fee; 2 input(s), 4 output(s): 1500, 900, 600, 72716 | payout (trigger) |
| Claim-Code Voucher: createVoucher | `47d0c618b0807a55fb7e151cfcd80f122d7b6755f0aa2172990693d93f300656` | 394 | 394 | as the issuer: 3000 satoshis locked to the hash of a code; 1 input(s), 2 output(s): 3000, 69322 | createVoucher (issuer) |
| Claim-Code Voucher: claimVoucher | `7e0202e598c3539a6ba0d25080b0a0088117c3ca0ed58773caa6d4ef072a0e21` | 188 | 188 | as the claimer, the coin by outpoint, with the code and the hash its script holds (change 4): the voucher's value back to the wallet; 1 input(s), 1 output(s): 2812 | claimVoucher (claimer) |
| Token Burner: depositSatoshis | `3c8c809d005dfc78a7d3eec257c70426b22e379d9bff3430686e54b90ebd0cb3` | 394 | 394 | as the depositor: 1000 satoshis to the burner; 1 input(s), 2 output(s): 1000, 67928 | depositSatoshis (depositor) |
| Token Burner: burn satoshis | `7089aec015ea1c5bc6c59d85a4000062e0a1353582d21248dd930ec6c1f97d1b` | 101 | 1000 | as the burner, the coin by outpoint (change 3): the coin's satoshis to the fee, no change output; 1 input(s), 1 output(s): 0 (OP_RETURN) | burn (burner) |
| Token Burner: depositFungibleTokens | `58c3ee16d4f98b4a74c1900593fa7d8b4edd48b34c919d3b94a8e86ac37a1a29` | 808 | 808 | as the depositor, the category the request gives (change 2): 200 of the wallet's test tokens with 1000 satoshis to the burner, the rest back to the wallet; 2 input(s), 3 output(s): 1000 with 200 tokens, 693 with 999800 tokens, 66427 | depositFungibleTokens (depositor) |
| Token Burner: burn tokens | `33fb307d88323b6bddabca687ca414ccc47777e6e03180339f5644254d6e3d33` | 101 | 1000 | as the burner, the coin by outpoint (changes 2 and 3): 200 tokens destroyed, the coin's satoshis to the fee; 1 input(s), 1 output(s): 0 (OP_RETURN) | burn (burner) |
| Block Points: fundThread | `a45e0e448a32169c11f38f470975078cc50269a6075766d12ff084e2d844cf5f` | 812 | 812 | as the funder, the category the request gives (change 2): 100000 test tokens with 1000 satoshis into the shared vault, where they stay by design; 2 input(s), 3 output(s): 1000 with 100000 tokens, 693 with 899800 tokens, 64615 | fundThread (funder) |
| Drip Mine: drip | `441bf60f8343a2b0fdb97d2d8471d10c447af47396688f607578f24301fec5b6` | 164 | 164 | as the dripper, the coin by outpoint (change 3): the contract's payout of 164 satoshis is the fee, the rest back to the Drip Mine; 1 input(s), 1 output(s): 1336 | drip (dripper) |
| send the test tokens on | `8aeb31bf1ab6781e8d8b1b5620a9eb763f97fc5315e1eae4d479a300bcad1b26` | 719 | 719 | 899800 test tokens, unchanged, to the funding address | pay (owner) |
| close | `44f5f8407dc1a2d86393cf20c92bd5eb989f24024a66219074175437dabb299e` | 1273 | 1273 | everything, and the controller's value, back to the funding address | close (owner) |
| burn the remaining test tokens | `53cd00ff358313fd5fe75eb25759b2c836c11195333c9d3623ad4c0b130aa193` | 1031 | 1031 | the funder destroys the 899800 test tokens that came back and keeps their coins' satoshis |  |

Also observed:

- The five templates' texts were taken from XO Grid at 2026-11-22T03:50:18.742Z; the wallet's reader found each to have the identifier asked for: "Drip Mine", "Revenue Split", "Claim-Code Voucher", "Token Burner", "Block Points".
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
- The Drip Mine's coin was funded in block 1443; the drip was accepted with the tip at 1451.
- Before closing, the wallet's full search over its seed ended as "fully-found".
- The wallet is closed: its controller's history reads closed, with no transition before.
- The funding address held 19531250 satoshis before the run and holds 19518641 after it: 12609 satoshis did not come back. By design: the Drip Mine's coin (1500 satoshis paid in, its drip's payout the fee and the rest still at the Drip Mine's address, where anyone may drip it to miners), the two burned coins (2000 satoshis, all fee), and the Block Points thread (1000 satoshis and 100000 test tokens in the shared vault, for anyone to claim); the fees of the run's transactions in the table add up to 10273 satoshis, the two burns' and the drip's included. Of the 1000000 test tokens, 200 were burned at the Token Burner, 100000 are in the Block Points vault, and the rest came back to the funder, which destroyed them. Nothing is left at the wallet.
