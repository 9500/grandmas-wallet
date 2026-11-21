# Stage 21: record of the acceptance tests

Made by `node scripts/test-record.mjs 21 PR26-PR27` at revision `008bafa` with changes not yet committed.
All tests of the repository: 698 passed, 0 failed, of 698.

| No. | Test, as the proposal states it | Expected | Tests that carry the number | Result |
| --- | --- | --- | --- | --- |
| PR26 | An action that pays a script taking no key, whose rule for following it is an expression; the same rule at a script that takes a key of the wallet's role | Comes back and is carried out; cannot tell, and refused | a script that takes no key comes back even where the template gives the rule for following it as an expression, and the action is carried out; the same rule on a script that takes a key of the wallet's role stays "cannot tell" and is refused (`test/action-findings.test.ts`) | passed |
| PR27 | An action that pays a script taking only a key the template gives to another role: in the wallet's own role; in the role that keeps the key; with a key no role is named for; with a key of each role | Comes back and is carried out; does not come back and is refused, in each of the other three | a script that takes only a key the template gives to another role comes back for the wallet in its own role and is carried out; in the role that keeps the key, with a key no role is named as keeping, and with a key of each role, it does not come back and is refused (`test/action-findings.test.ts`) | passed |

Every number has at least one test, and all of them pass.
