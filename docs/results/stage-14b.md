# Stage 14b: record of the acceptance tests

Made by `node scripts/test-record.mjs 14b PR21-PR21` at revision `30f9455`.
All tests of the repository: 660 passed, 0 failed, of 660.

| No. | Test, as the proposal states it | Expected | Tests that carry the number | Result |
| --- | --- | --- | --- | --- |
| PR21 | Wallet and recoverer code searched for a reader of declarations, and for any application's name | None | their code holds no reader of a recovery declaration (`test/wallet-knows-no-application.test.ts`)<br>their code names no application (`test/wallet-knows-no-application.test.ts`) | passed |

Every number has at least one test, and all of them pass.
