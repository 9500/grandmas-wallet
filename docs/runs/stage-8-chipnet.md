# Stage 8 run on chipnet (run D, this wallet): a savings jar through the loss of a device

Written by the run itself (`scripts/run-d.ts chipnet`). The owner's wallet, the recoverer and the new device, each on the XO engine, on chipnet. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template and recovery declaration, as texts; every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent.

- Wallet identity: `591d20db565747906bea81e754476e161af1910f18801038cfdfd37a4dd3a403`
- Jar key (token category): `e75dfc8811bbf24c89b3cc0d74e3f7510cbc3744154275db701f4b27181e7d85`; the jar's date: 2026-11-18T02:16:24.000Z
- Template "Savings Jar" `04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c`; compiled contract `contracts/artifacts/savingsJar.json`
- Repository at commit `5d9591c`
- Started 2026-11-18T02:09:08.689Z
- The engine ran with the local fix for chipnet's block timing (`docs/xo-chipnet-header-verification.md`); without it its header check stops below the tip.
- The engine was given one server.

| Step | Transaction | Bytes | Fee (sat) | Note |
| --- | --- | --- | --- | --- |
| create | `835619f3b244f3af5cab7193a7e08ba2f48f9585b4a1a057e86baebd75a054bc` | 421 | 421 | the controller, the coin for cancelling, an allowance for the recoverer, and the rest |
| open the jar | `2d8b011eb487cf247b1f87ac0baaa48e21008f2341ac49c26a95e20a027a5fee` | 477 | 477 | an action of the application's template: 30,000 satoshis into the jar, the key to a fresh address of the wallet |
| request | `864bdff0979e72cc3cf11741f2e298198c86e45b2a218855ae5d8647205e1764` | 991 | 991 | the recoverer names the new device's key; paid from its fee address |
| complete | `d0c1d5bcf00152e529486203e81de95bb3854ba2e952e082531981642b829c75` | 970 | 970 | after the waiting period (12 minutes); no coin has moved |
| sweep | `a4a8994dcce0aa697d8e97ac452e36079ece721a289c21491ec129783d25f2da` | 2006 | 2006 | 4 coins of the earlier seed, the jar's key among them, to addresses of the new seed |
| empty the jar | `e30e7a470f8b56b21ef4b8287c2798bd6b714c170072187d57bbf8fd721bfcd4` | 520 | 520 | the jar's 1 coin and the key in one transaction; the savings and the key to addresses of the new seed |
| empty the jar again | `654be77a9ea0e223ca7f5a9012fd85c61e53e822edf965107979f7f17086af14` | 520 | 520 | 8,000 satoshis that someone paid in after the first withdrawal, with the same key |
| send the key on | `599b0a7b58b2e0616bd19a9b0065639f1f7dd1bc2d41fff8c13e81c93c1783d4` | 719 | 719 | unchanged, to the address that paid for the run |
| close | `8222ac6d54e668eae13e239fcdf36a371b78836837f1d093ed257c01615ff64f` | 1865 | 1865 | everything, and the controller's value, back to the address that paid for the run |
| return the allowance | `15a0d31b81b887e54b902e0f214bb608e059ecc92d108901b91f340f638e4b6c` | 185 | 185 | what the recoverer did not use |

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
- The funding address held 967233 satoshis before the run and holds 956851 after it: the run cost 10382 satoshis in fees. Nothing is left anywhere else.
