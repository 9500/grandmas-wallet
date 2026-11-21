# Stage 19: record of the acceptance tests

Made by `node scripts/test-record.mjs 19 TR01-TR14` at revision `9103f3b` with changes not yet committed.
All tests of the repository: 718 passed, 0 failed, of 718.

| No. | Test, as the proposal states it | Expected | Tests that carry the number | Result |
| --- | --- | --- | --- | --- |
| TR01 | A category whose authchain publishes a registry whose file has the published hash | Name, symbol and decimals are kept and shown | a category whose authchain publishes a file with the published hash: name, symbol and decimals are kept and shown (`test/token-registries.test.ts`) | passed |
| TR02 | The file has another hash; the host is down; the file is too large | Nothing is shown; raw units; tried again next session | another hash, a host that is down, a file too large: nothing is shown, and it is tried again next session (`test/token-registries.test.ts`) | passed |
| TR03 | The registry's `token.category` is another category's; its symbol breaks the rule; decimals of 19 | Nothing is shown | another category, a symbol that breaks the rule, decimals of 19: nothing (`test/token-registries.test.ts`)<br>the registry names another category, breaks the symbol rule, or gives 19 decimals: nothing is shown (`test/token-registries.test.ts`) | passed |
| TR04 | A second publication later on the authchain | The new one replaces the kept result after the next look | a second publication later on the authchain replaces the kept result after the next look (`test/token-registries.test.ts`) | passed |
| TR05 | An authchain of 25 links; a link at a script with 5,000 history entries | Resolved over three passes; left unresolved, never at a link that is not the head | an authchain of 25 links is resolved over three passes; a link at a busy script is left unresolved, never at a link that is not the head (`test/token-registries.test.ts`) | passed |
| TR06 | A burned identity | Nothing is shown | a burned identity: nothing is shown (`test/token-registries.test.ts`) | passed |
| TR07 | Snapshots in the past and the future | The latest one reached; the oldest when none is reached | the latest snapshot reached; the oldest when none is reached (`test/token-registries.test.ts`) | passed |
| TR08 | A typed amount with the token's decimals; with too many decimal places | The exact raw amount is sent; refused | an amount typed with the token's decimals is sent exactly; one with too many places is refused (`test/token-registries.test.ts`) | passed |
| TR09 | Two held categories with the same symbol; a reserved symbol | Shown apart with their categories; not shown | two held categories with the same symbol are marked; a reserved symbol is not shown (`test/token-registries.test.ts`) | passed |
| TR10 | An NFT of a position whose category also has a registry | The template's name | a position's NFT keeps the template's name; another NFT takes the registry's name for its sequential type (`test/token-registries.test.ts`) | passed |
| TR11 | A registry resolves while a review is open | The review does not change | a registry that resolves while a review is open does not change the review (`test/token-registries.test.ts`) | passed |
| TR12 | After a recovery | The new device resolves again and shows the same; nothing of it was in the backup | after a recovery the new device resolves again and shows the same; nothing of it was in the backup (`test/token-registries.test.ts`) | passed |
| TR13 | Wallet code searched for a token's category or symbol | None | their code names no token: no category of a token the tests or the demonstrations use, and no symbol (`test/wallet-knows-no-application.test.ts`) | passed |
| TR14 | `mode` off or absent | No request beyond today's; raw units | with the mode off or absent, nothing is asked and the token stays in raw units (`test/token-registries.test.ts`) | passed |

Every number has at least one test, and all of them pass.
