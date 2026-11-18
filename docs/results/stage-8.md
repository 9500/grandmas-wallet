# Stage 8: record of the acceptance tests

Made by `node scripts/test-record.mjs 8 SJ01-SJ06 AP10-AP10` at revision `f2dc80f` with changes not yet committed.
All tests of the repository: 464 passed, 0 failed, of 464.

| No. | Test, as the proposal states it | Expected | Tests that carry the number | Result |
| --- | --- | --- | --- | --- |
| SJ01 | Withdraw with the key before the time; after the time without the key; with both | Refused; refused; accepted | withdrawing with the key before the time is refused; after the time without the key is refused; with both it is accepted (`test/savings-jar.test.ts`) | passed |
| SJ02 | Open, pay in, withdraw with this wallet on chipnet | Works | a jar was opened, paid into and emptied with this wallet on chipnet (`test/savings-jar-record.test.ts`) | passed |
| SJ03 | The same with Cashonize and the same contract | Works | an ordinary wallet (Cashonize) opened a savings jar with the jar page on chipnet, and emptied it three times, every transaction named and paid for (`test/savings-jar-record.test.ts`)<br>Cashonize connected to the page as an ordinary wallet and signed what the page built, after showing it (`test/savings-jar-record.test.ts`)<br>with the page rebuilt after the run's findings, the list agrees with an outcome as soon as it is shown (`test/savings-jar-record.test.ts`)<br>the page offered no withdrawal before the date, and on chain the jar was at the contract's address, ends empty, and its key stays with Cashonize (`test/savings-jar-record.test.ts`) | passed |
| SJ04 | The device is lost with a jar open; recovery; the application's site not consulted | The new device finds the jar from the swept key and empties it | on chipnet the device was lost with a jar open, and the new device found the jar from the swept key, with the application's site not consulted, and emptied it (`test/savings-jar-record.test.ts`)<br>in real browsers, a new phone found the jar from the swept key and the template without a request to the jar page, and emptied it twice (`test/savings-jar-record.test.ts`)<br>the device is lost with a jar open; the new device finds the jar from the swept key and empties it, with the application's site not consulted (`test/savings-jar.test.ts`) | passed |
| SJ05 | A third party tries to empty a jar or alter a withdrawal | Refused | a third party cannot empty a jar, with a token of its own or without, and cannot alter a withdrawal (`test/savings-jar.test.ts`) | passed |
| SJ06 | Withdraw, then someone pays into the jar again | The key is still in the wallet and the new deposit can be withdrawn; the wallet refuses a withdrawal that would not return the key | after a withdrawal the key is still in the wallet, and what someone pays in later can be withdrawn; a withdrawal that would not return the key is refused (`test/savings-jar.test.ts`) | passed |
| AP10 | The application's site is unavailable | A position stays operable from its token and template | with the application's site unavailable, a position stays operable from its token and template (`test/savings-jar.test.ts`) | passed |

Every number has at least one test, and all of them pass.
