# Stage 6: record of the acceptance tests

Made by `node scripts/test-record.mjs 6 OP02-OP03` at revision `2d954e4`.
All tests of the repository: 390 passed, 0 failed, of 390.

| No. | Test, as the proposal states it | Expected | Tests that carry the number | Result |
| --- | --- | --- | --- | --- |
| OP02 | The coin for cancelling is spent or missing; the device was not running for part of a wait | The wallet says that it cannot cancel, or could not watch; it does not show full protection | with the coin for cancelling spent or missing, it says that it cannot cancel and does not show full protection (`packages/app/test/protection.test.ts`)<br>a device that was not running for part of a wait says that it could not watch then (`packages/app/test/protection.test.ts`) | passed |
| OP03 | The public sites are switched to this design and switched back | Services installed from the intended checkout; the running version, the stores' data and the public walkthrough checked; the way back tried | the sites were switched to this design and back; the version, the stores' data and the pages were checked, and the way back was tried (`test/deployment-record.test.ts`)<br>the public walkthrough was carried out on the public addresses, every step of it (`test/deployment-record.test.ts`) | passed |

Every number has at least one test, and all of them pass.
