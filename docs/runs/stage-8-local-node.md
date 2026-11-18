# Stage 8 run on the local node: a savings jar through the loss of a device

Written by the run itself (`scripts/run-d.ts local`). The owner's wallet, the recoverer and the new device, each on the XO engine, against the local node in regtest mode with the public networks' relay rules. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template and recovery declaration, as texts; every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent.

- Wallet identity: `b90041ec1cc92ee48a6d4cd83cb1f5e82a5b6a496b902413e8d651165033290c`
- Jar key (token category): `df23dac6ec05363414fd366557f18e9b628bd364213d389b47f055f5d2be73cf`; the jar's date: 2026-11-18T02:13:09.000Z
- Template "Savings Jar" `04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c`; compiled contract `contracts/artifacts/savingsJar.json`
- Repository at commit `91508ae`
- Started 2026-11-18T02:07:52.862Z

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `b07741687282ff6978bca75b7449e8280373fd00a9db7c278ae4cf7f8ab88154` | 421 | 421 | the controller, the coin for cancelling, an allowance for the recoverer, and the rest |
| open the jar | `be458c9a3a0b5f8a9d86b530e3ddbd561f323541191c00739e64c148111c2b89` | 477 | 477 | an action of the application's template: 30,000 satoshis into the jar, the key to a fresh address of the wallet |
| request | `398745d17f83af1fabbfb1bb7e0c34735fcf4842e10999e044cfe0529a348804` | 991 | 991 | the recoverer names the new device's key; paid from its fee address |
| complete | `6abb4ad43b7a4a15b1f0e43cf15d105e7a6c04d78b948ba8e70d97bec6ae102d` | 970 | 970 | after the waiting period; no coin has moved |
| sweep | `6347d64f963701f4fc729d53faaa14541ca322dce6c88eb13f2bb9aadcc23743` | 2006 | 2006 | 4 coins of the earlier seed, the jar's key among them, to addresses of the new seed |
| empty the jar | `6d658e7c2147060067fd65d29f86e32af8dfc2191b9a952c98a6b174d63960fd` | 520 | 520 | the jar's 1 coin and the key in one transaction; the savings and the key to addresses of the new seed |
| empty the jar again | `9497ada44148b0d49108bac3d066a602b5462dbb0467f70c977002adbef15ef7` | 520 | 520 | 8,000 satoshis that someone paid in after the first withdrawal, with the same key |
| send the key on | `996595af2951cc6291cd63a46c10842659a1a3c8fd65516cb46b95a5be728b7c` | 719 | 719 | unchanged, to the address that paid for the run |
| close | `3eba45265e986a8dbbf4ef0d06e8aef6001003f32a60fa383a2688693f11c851` | 1865 | 1865 | everything, and the controller's value, back to the address that paid for the run |
| return the allowance | `012cce79a3f9d777bcefff90947041fe75cb0beffc101ace5579aaf4dcd695c3` | 185 | 185 | what the recoverer did not use |

Also observed:

- No address was given out before the creation was confirmed: true.
- Recovery is shown as "off" while no receipt of the recoverer exists.
- Before the first action the wallet showed the template "Savings Jar" as "not verified", said that it would be stored in the backup first (true), and showed its own figures: 30000 satoshis to "Savings jar", a fee of 477.
- The wallet finds the jar from its key: open, 30000 satoshis, at the address the application's own code gives for that key (true).
- Emptying the jar before its date was refused by the network: "non-final".
- The old device holds 103202 satoshis at its addresses, the jar's key among them, and 30,000 satoshis are in the jar. Then the device is lost.
- The recoverer's fee address holds 4900 satoshis: enough for a request (991) and a completion (936).
- Completing right after the request was refused: "non-BIP68-final".
- The new device's search over both seeds ended as "fully-found".
- The sweep reported the jar's key as a token of unknown meaning: the wallet moves what it does not understand.
- Before reading the backup the new device listed the swept key as a token of unknown meaning. The backup held 1 template that the earlier owner had stored and 1 note. The device then listed the key as "incomplete": A note says the template "Savings Jar" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet.
- The earlier owner's record does not make the template trusted on the new device: it was offered as "Savings Jar", shown as "not verified", and trusted on the user's word.
- The new device finds the jar from the swept key and the template, with the application's site not consulted: open, 30000 satoshis; the template offers "Pay into a savings jar" and "Empty a savings jar".
- After the withdrawal the key is still in the wallet (at an address of the new seed); the jar holds 0 satoshis.
- The controller's history: requestRecovery, finalizeRecovery, ownerAuthorize, then closed. It has had 2 owners.
- The funding address held 1250000000 satoshis before the run and holds 1249990041 after it: the run cost 9959 satoshis in fees. Nothing is left anywhere else.
