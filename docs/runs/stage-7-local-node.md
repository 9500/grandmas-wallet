# Stage 7 run on the local node

Written by the run itself (`scripts/stage-7-run.ts`). The owner's wallet on the unmodified XO engine carries out actions of two unrelated application templates, with the wallet's own coins as inputs and the wallet's own addresses as outputs, against the local node in regtest mode with the public networks' relay rules.

- Repository at commit `613a29f`
- Wallet identity: `4db02123ee0959075b85da3bb133345d57de7239c30336841f4320109dec9c45`
- Templates: "Strongbox" `6f5eda800ce05176126f0efdb3e8ec1e22d7fc51b09c083424ab085f7d8fa401` and "Bond" `bf1bf117b1dd6d87d3ded3f0ea5095b5bdb444a190f7ae25a3ba572cd713617f`, made for the tests (`packages/testing/src/templates.ts`). Each reached the wallet as a text with its recovery declaration; the wallet's code names neither.
- Every transaction below is an invitation of the application's template, built and signed by the engine. Before that, the wallet's own code worked the same transaction out from the template, chose the coins and the exact fee, and showed its figures; what the engine built was compared with it, output by output, before sending. Nothing here was built outside the engine.
- Each template was stored in the backup before its first action (2 stores, in memory for this run).

| Step | Template | Transaction | Bytes | Fee (sat) | Invitation | Note |
| --- | --- | --- | --- | --- | --- | --- |
| open | Strongbox | `db78a02f48636356f02378d1647332f53d22b1ae92436660745cc4651579a777` | 432 | 432 | `14b3d098c996f3f0b558ed4e437bb5da` | creates the key's category from a coin of the wallet; the key goes to a fresh address of the wallet |
| add | Strongbox | `22335c5bc408b9affb0d0145d2ba3ebe00bce7d72e8d2c50a93a00956b54fc18` | 394 | 394 | `4ce9faac684d44bf4c11b0380c3c2d7a` | pays into the box found from the key; the key is not spent |
| take | Strongbox | `eb0f43875c874153eedce016422889f4f1ed8bbbf0c53b929fee4dddbee80ab3` | 588 | 588 | `34e05769510e37451c917f7457c35327` | spends both coins of the box and the key in one transaction; the key returns to a new address |
| post | Bond | `681684e4817e96299e9cd854c51803623c3f8779c107151ca518314dc535e942` | 588 | 588 | `59caaa6ec45eacdb688eec663fed396d` | the address the bond returns to is a vault address of the wallet, written on the companion coin |
| redeem | Bond | `5065ed1780a0caac8e75da3e724837aeaad0b3fce6d5ce679dcb8bbb06ae89a1` | 887 | 887 | `1a19991b35f72fada9d4e890020ec98d` | the bond returns to the vault address; the key returns to the script it left |

Also observed: the node accepted every transaction; each fee was exactly the size, and was the fee the wallet showed beforehand; the Strongbox template was shown as "not verified" before its first action and as "verified" once its key had led to the box on chain; the bond returned to the vault address in full; both keys are still in the wallet.
