# Stage 8 run on the local node: a savings jar through the loss of a device

Written by the run itself (`scripts/run-d.ts local`). The owner's wallet, the recoverer and the new device, each on the XO engine, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template and recovery declaration, as texts; every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent.

- Wallet identity: `9a9b84597944cefcd75efdb0c34c70520c0405871e401ee88de346aae051e952`
- Jar key (token category): `2bd479922845794087a4375ac9bdd54bc5550908c33287b7db88702963eac205`; the jar's date: 2026-11-19T19:50:34.000Z
- Template "Savings Jar" `04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c`; compiled contract `contracts/artifacts/savingsJar.json`
- Repository at commit `8616e45`
- Started 2026-11-19T19:43:06.356Z
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `.chipnet/invitations/stage-8-local-node/`, with `index.json` naming the template, action and role of each.

| Step | Transaction | Invitation | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- | --- |
| create | `7e65db8ea440a3ebefac1e1d776d646b5cb8f2e5021015a782b584a5194eca34` | `01-the-owner-s-device-create-7e65db8e.json` | 343 | 343 | the controller and the rest |
| open the jar | `d961fe08a0018a7bafe90a631efe7c5fc76241f524a14d2a8e1b59ebfc6f239b` | `03-the-owner-s-device-open-d961fe08.json` | 477 | 477 | an action of the application's template: 30,000 satoshis into the jar, the key to a fresh address of the wallet |
| request | `a459da77aa0121c3c9a0a50983b9c09faff5e43861c55bd4acc2e17b226c17c9` | `04-the-recoverer-pay-a459da77.json` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction |
| complete | `b4976e2ea396850581b582977feaff6a31e40c659054f68c0efafc6300fdf0a1` | `05-the-recoverer-pay-b4976e2e.json` | 970 | 970 | after the waiting period; no coin has moved |
| sweep | `6ca0b432c6c123121903a8ef9a638ed3d10f8d6f5a0b3c27d663c974bc4bdfd0` | `06-the-new-device-approve-6ca0b432.json` | 1702 | 1702 | 3 coins of the earlier seed, the jar's key among them, to addresses of the new seed |
| empty the jar | `a98919dfb2f56b29fdccfbf9101f44d87d0f5ba0f8166614520986ab55b4f90f` | `07-the-new-device-withdraw-a98919df.json` | 520 | 520 | the jar's 1 coin and the key in one transaction; the savings and the key to addresses of the new seed |
| empty the jar again | `ead5bc4a77b3e144df55271b57d5a3decd15091dcc433a8d1bfb8f8f93ff31bb` | `08-the-new-device-withdraw-ead5bc4a.json` | 520 | 520 | 8,000 satoshis that someone paid in after the first withdrawal, with the same key |
| send the key on | `986eee17b26571f01dbef6bec594c99f569ea82c15ce3384fda4c0536d6f6b7e` | `09-the-new-device-pay-986eee17.json` | 719 | 719 | unchanged, to the address that paid for the run |
| close | `aea7c83ef47244444fd09ddfd671515745e664fcb36f3d859c4217e1498f73e2` | `10-the-new-device-close-aea7c83e.json` | 1569 | 1569 | everything, and the controller's value, back to the address that paid for the run |
| return the recoverer's balance | `af4dd34a01e54eb58a9577d6329fb82e937f40f8e65f53b9f8b005658b92bcd9` | `11-the-recoverer-pay-af4dd34a.json` | 185 | 185 | what the recoverer did not use |

Also observed:

- Recovery is shown as "off" while no receipt of the recoverer exists.
- Before the first action the wallet showed the template "Savings Jar" as "not verified", said that it would be stored in the backup first (true), and showed its own figures: 30000 satoshis to "Savings jar", a fee of 477.
- The wallet finds the jar from its key: open, 30000 satoshis, at the address the application's own code gives for that key (true).
- Emptying the jar before its date was refused by the network: "non-final".
- The old device holds 102796 satoshis at its addresses, the jar's key among them, and 30,000 satoshis are in the jar. Then the device is lost.
- The recoverer's balance holds 5000 satoshis: enough for a request (991) and a completion (970).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's search over both seeds ended as "fully-found".
- The sweep reported the jar's key as a token of unknown meaning: the wallet moves what it does not understand.
- Before reading the backup the new device listed the swept key as a token of unknown meaning. The backup held 1 template that the earlier owner had stored and 1 note. The device then listed the key as "incomplete": A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet.
- The earlier owner's record does not make the template trusted on the new device: it was offered as "Savings Jar", shown as "not verified", and trusted on the user's word.
- The new device finds the jar from the swept key and the template, with the application's site not consulted: open, 30000 satoshis; the template offers "Pay into a savings jar" and "Empty a savings jar".
- After the withdrawal the key is still in the wallet (at an address of the new seed); the jar holds 0 satoshis.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 625000000 satoshis before the run and holds 624990335 after it: the run cost 9665 satoshis in fees. Nothing is left anywhere else.
