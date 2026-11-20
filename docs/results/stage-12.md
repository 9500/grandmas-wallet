# Stage 12: record of the acceptance tests

Made by `node scripts/test-record.mjs 12 PR01-PR02 PR10-PR11` at revision `cf02e67`.
All tests of the repository: 636 passed, 0 failed, of 636.

| No. | Test, as the proposal states it | Expected | Tests that carry the number | Result |
| --- | --- | --- | --- | --- |
| PR01 | An action that leaves a position: with a store that confirms; with no store reachable | The record is on the store before a signature leaves the wallet; refused, and nothing is signed | an action that leaves a position has its record on a store before a signature leaves the wallet; with no store reachable it is refused and nothing is signed (`test/position-records.test.ts`) | passed |
| PR02 | An action that leaves nothing outside the wallet's addresses, with no store reachable | Carried out; no record is written | an action that leaves nothing outside the wallet's addresses is carried out with no store reachable, and no record is written (`test/position-records.test.ts`) | passed |
| PR10 | A record of an action that was never sent | Nothing is listed for it; it is not copied into a new archive | a record of an action that was never sent: nothing is listed for it, and it is not copied into a new archive (`test/position-records.test.ts`) | passed |
| PR11 | The earlier archive's position records after a recovery, while a store cannot be reached or the device stops | Copied as suggestions; nothing is removed before the copy is complete; a record is written as the new owner's only after the chain has confirmed it | after a recovery, while a store cannot be reached or the device stops, the records are copied as suggestions, nothing is removed before the copy is complete, and a record becomes the new owner's only once the chain has confirmed it (`test/position-records.test.ts`) | passed |

Every number has at least one test, and all of them pass.
