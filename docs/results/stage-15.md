# Stage 15: record of the acceptance tests

Made by `node scripts/test-record.mjs 15 PR08-PR09` at revision `0172d16`.
All tests of the repository: 658 passed, 0 failed, of 658.

| No. | Test, as the proposal states it | Expected | Tests that carry the number | Result |
| --- | --- | --- | --- | --- |
| PR08 | A template with a script that takes a key of the device: an action that puts nothing there; an action that would | The finding is that it comes back, and it is carried out; the finding is that it does not, and this wallet refuses with the reason, before the user is asked | a template with a script that takes a key of the device: an action that puts nothing there comes back and is carried out; one that would put something there does not come back, and this wallet refuses it with the reason before the user is asked (`test/action-findings.test.ts`) | passed |
| PR09 | A template that uses something the wallet cannot analyse | The finding is that the wallet cannot tell; this wallet refuses | a template that uses something the wallet cannot analyse: the finding is that the wallet cannot tell, and this wallet refuses (`test/action-findings.test.ts`) | passed |

Every number has at least one test, and all of them pass.
