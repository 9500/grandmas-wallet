# Five XO Grid templates on the local node

Written by the run itself (`scripts/xo-grid-run.ts`). An owner's wallet on the unmodified XO engine, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The wallet has its recovery arrangement and two backup stores (directories of the run, read and written as a store server's are), and each template was stored in the backup before its first action.

The templates' texts were taken from XO Grid (https://xogrid.vercel.app/api/templates/<identifier>/raw) at run time, 2026-11-22T04:03:13.653Z, and checked with the wallet's own reader to have the identifier asked for. They are not this project's and are kept only in the run's git-ignored folder, as are the engine's invitations, which hold them. The wallet took each in as a person adding a file does; the run then asked as an application's page would: a request naming the template, action, role and values, and for an action on a coin of the application's, the coin by outpoint. Drip Mine's `fund` was asked from the wallet's own list of the template's actions instead.

- Template "Drip Mine": `346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185`
- Template "Revenue Split": `b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e`
- Template "Claim-Code Voucher": `317c4947b5b9cc71d1fe01616cdc930b6ca3ef5808700c68d1cb0696e79b4911`
- Template "Token Burner": `1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0`
- Template "Block Points": `9941f723c962e64956c5dcbc9e97e6a735736e4a8e94b24d7d77e6b0eeee3e5a`
- Wallet identity: `148a783da98cbc61fdcf5c274398798510cda87f641aa9f447821a001d4bc1ee`
- Test token category: `c059fefc68f33b884403358cd4fcdadecc1ce3f5987d0d70ab79e2ed79720d04`, 1000000 tokens made by the funder for the run
- Repository at commit `079ec20`
- Started 2026-11-22T04:03:12.023Z

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| fund the wallet | `148a783da98cbc61fdcf5c274398798510cda87f641aa9f447821a001d4bc1ee` | 219 | 219 | the funder pays 80000 satoshis to the wallet's funding address |  |
| create | `64dd7548502812cea39dd368f4cbbcfcc9b43ec4112c23eaeb5475fac0bca2d4` | 343 | 343 | the controller and the rest | create (owner) |
| a coin for the test tokens | `c059fefc68f33b884403358cd4fcdadecc1ce3f5987d0d70ab79e2ed79720d04` | 219 | 219 | the funder pays itself a coin that is output 0 of its transaction, to make a token category from |  |
| make the test tokens | `e56116ecb0c0ec1ec6e9369f73580e8e2f6493fc23a860145066be6263bcb2b3` | 268 | 268 | the funder makes 1000000 fungible tokens of a new category and pays them, with 1000 satoshis, to an address the wallet gave out |  |
| Drip Mine: fund | `61fc90e9130113f7a679ca61d9587c863da35a18a090782d110e98969a4a87eb` | 394 | 394 | from the wallet's own list, as the funder role (change 1): 1500 satoshis into the Drip Mine, never to come back by design; 1 input(s), 2 output(s): 1500, 76763 | fund (funder) |
| Revenue Split: fundSplit | `e1cf1d2ac8c0d95ec03e851fb1e762fd8ddfd924c809a9cd1c90fbd9665072ed` | 394 | 394 | as the payer: 3000 satoshis into the split; 1 input(s), 2 output(s): 3000, 73369 | fundSplit (payer) |
| Revenue Split: payout | `1580411fcd948c4ea0b0c74c62b7138e2390d4db19a952d527d582ddc1c0f5f3` | 653 | 653 | as the trigger, the coin by outpoint: the three shares to the funding address, the wallet pays the fee; 2 input(s), 4 output(s): 1500, 900, 600, 72716 | payout (trigger) |
| Claim-Code Voucher: createVoucher | `acd48f76643e93903eb2c4c47d0bda98e508ceb1f1c2fde7019fa9da67479274` | 394 | 394 | as the issuer: 3000 satoshis locked to the hash of a code; 1 input(s), 2 output(s): 3000, 69322 | createVoucher (issuer) |
| Claim-Code Voucher: claimVoucher | `118ff50485c8d5625994dbbbbd4894cf5106139617c479502df0ecba3d78e250` | 188 | 188 | as the claimer, the coin by outpoint, with the code and the hash its script holds (change 4): the voucher's value back to the wallet; 1 input(s), 1 output(s): 2812 | claimVoucher (claimer) |
| Token Burner: depositSatoshis | `8983b51ac3b0497ee1760b35ca6a16687ba43dfe158f2f229f2d351cf79e3465` | 394 | 394 | as the depositor: 1000 satoshis to the burner; 1 input(s), 2 output(s): 1000, 67928 | depositSatoshis (depositor) |
| Token Burner: burn satoshis | `523d95d5c6e2209e41dea16c05ebfe303ec0ab5d417d8790b024c3c1f4946662` | 101 | 1000 | as the burner, the coin by outpoint (change 3): the coin's satoshis to the fee, no change output; 1 input(s), 1 output(s): 0 (OP_RETURN) | burn (burner) |
| Token Burner: depositFungibleTokens | `be835ebc04d01050dc9478c5d10e653a6e6df3ff53dbdda90e653209200f52a2` | 808 | 808 | as the depositor, the category the request gives (change 2): 200 of the wallet's test tokens with 1000 satoshis to the burner, the rest back to the wallet; 2 input(s), 3 output(s): 1000 with 200 tokens, 693 with 999800 tokens, 66427 | depositFungibleTokens (depositor) |
| Token Burner: burn tokens | `e1818879b2c059789df048464254dbcf969272013890f695767ab679a80fc8a3` | 101 | 1000 | as the burner, the coin by outpoint (changes 2 and 3): 200 tokens destroyed, the coin's satoshis to the fee; 1 input(s), 1 output(s): 0 (OP_RETURN) | burn (burner) |
| Block Points: fundThread | `1ef4d7926f0081cfd6f1e8ff5662b77ec3a8cb54b1ff821a3d3224ade28893a2` | 812 | 812 | as the funder, the category the request gives (change 2): 100000 test tokens with 1000 satoshis into the shared vault, where they stay by design; 2 input(s), 3 output(s): 1000 with 100000 tokens, 693 with 899800 tokens, 64615 | fundThread (funder) |
| Drip Mine: drip | `3965a731efe3417c9d4740d671c365c24ccf7f19137c531a7be7dcf064b0b9d8` | 164 | 164 | as the dripper, the coin by outpoint (change 3): the contract's payout of 164 satoshis is the fee, the rest back to the Drip Mine; 1 input(s), 1 output(s): 1336 | drip (dripper) |
| send the test tokens on | `bed41aa513a6e7f81c7bd49a0ba99f68470d7e9fa55a430abff8ae4371e591b8` | 719 | 719 | 899800 test tokens, unchanged, to the funding address | pay (owner) |
| close | `52278ba13ed5ef8285aa8349f3c7db72fdcc6d590d4422ab59f39d716d302f71` | 1273 | 1273 | everything, and the controller's value, back to the funding address | close (owner) |
| burn the remaining test tokens | `9b59db4ad569da27abb2d5f7b2be38d52b8d57a0c80ae043e76fa2d520f40d5a` | 1031 | 1031 | the funder destroys the 899800 test tokens that came back and keeps their coins' satoshis |  |

Also observed:

- The five templates' texts were taken from XO Grid at 2026-11-22T04:03:13.653Z; the wallet's reader found each to have the identifier asked for: "Drip Mine", "Revenue Split", "Claim-Code Voucher", "Token Burner", "Block Points".
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
- The Drip Mine's coin was funded in block 1675; the drip was accepted with the tip at 1683.
- Before closing, the wallet's full search over its seed ended as "fully-found".
- The wallet is closed: its controller's history reads closed, with no transition before.
- The funding address held 4882812 satoshis before the run and holds 4870203 after it: 12609 satoshis did not come back. By design: the Drip Mine's coin (1500 satoshis paid in, its drip's payout the fee and the rest still at the Drip Mine's address, where anyone may drip it to miners), the two burned coins (2000 satoshis, all fee), and the Block Points thread (1000 satoshis and 100000 test tokens in the shared vault, for anyone to claim); the fees of the run's transactions in the table add up to 10273 satoshis, the two burns' and the drip's included. Of the 1000000 test tokens, 200 were burned at the Token Burner, 100000 are in the Block Points vault, and the rest came back to the funder, which destroyed them. Nothing is left at the wallet.
