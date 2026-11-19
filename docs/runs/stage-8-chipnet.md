# Stage 8 run on chipnet (run D, this wallet): a savings jar through the loss of a device

Written by the run itself (`scripts/run-d.ts chipnet`). The owner's wallet, the recoverer and the new device, each on the XO engine, on chipnet. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template and recovery declaration, as texts; every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent.

- Wallet identity: `b69206ad0be9b0a5263d09484f3e52059853ce5e9ea04f931a6156435f69e797`
- Jar key (token category): `d8092603f0efd13d3d23e7584bd6a538ae652aec10110b628c2a5e9773a01a74`; the jar's date: 2026-11-19T19:53:07.000Z
- Template "Savings Jar" `04db6aef50ad127d6f34c7a6bdb3872007995e375b14437e1e9a2ca2b0a5ee5c`; compiled contract `contracts/artifacts/savingsJar.json`
- Repository at commit `f561647`
- Started 2026-11-19T19:49:43.586Z
- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: `docs/runs/invitations/stage-8-chipnet/`, with `index.json` naming the template, action and role of each.
- The engine ran as published, with no local change.
- The engine was given one server.

| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |
| --- | --- | --- | --- | --- | --- |
| create | `7fb012cc39b36b0236fb3eee432a9ffe883c3163637348a13680027289060d3e` | 343 | 343 | the controller and the rest | [create](invitations/stage-8-chipnet/01-the-owner-s-device-create-7fb012cc.json) |
| open the jar | `04cc1dd74d8acfd1f07f493bfbf464dd91bf5afbcb543298cfc9a4856e6a25ec` | 477 | 477 | an action of the application's template: 30,000 satoshis into the jar, the key to a fresh address of the wallet | [open](invitations/stage-8-chipnet/03-the-owner-s-device-open-04cc1dd7.json) |
| request | `9fcce3b48dc3efb7e5911d07f92b1d61dffa87c03dc68a3cae98a77feeb70c9f` | 991 | 991 | the recoverer names the new device's key; paid from its balance in the same transaction | [pay](invitations/stage-8-chipnet/04-the-recoverer-pay-9fcce3b4.json) |
| complete | `6f8e9afa82960cf521aeca4c20be69a4f836c8b089a4f98471ecf70e10e470dd` | 970 | 970 | after the waiting period (10 minutes); no coin has moved | [pay](invitations/stage-8-chipnet/05-the-recoverer-pay-6f8e9afa.json) |
| sweep | `39d1d106f5f132913a2d10d5dff7644012dd18653fb52d4e06772b91f4be7854` | 1702 | 1702 | 3 coins of the earlier seed, the jar's key among them, to addresses of the new seed | [approve](invitations/stage-8-chipnet/06-the-new-device-approve-39d1d106.json) |
| empty the jar | `36d7f16503290929111895836397bb921758ac90b080532cf7e68e5a1a3ea04a` | 520 | 520 | the jar's 1 coin and the key in one transaction; the savings and the key to addresses of the new seed | [withdraw](invitations/stage-8-chipnet/07-the-new-device-withdraw-36d7f165.json) |
| empty the jar again | `209ba8f8396f672c505ea856a96f147a1f24d4b8f3eaa71a4c31be2f42082664` | 520 | 520 | 8,000 satoshis that someone paid in after the first withdrawal, with the same key | [withdraw](invitations/stage-8-chipnet/08-the-new-device-withdraw-209ba8f8.json) |
| send the key on | `84951986f0d8b27eff7498ab6bf61dec3433757532ad13bb1d6a6a7d3f7f74c1` | 719 | 719 | unchanged, to the address that paid for the run | [pay](invitations/stage-8-chipnet/09-the-new-device-pay-84951986.json) |
| close | `0b7f27373587d8dd5970f58633f36d5f9da4289d86f201afebed955eef20f49a` | 1569 | 1569 | everything, and the controller's value, back to the address that paid for the run | [close](invitations/stage-8-chipnet/10-the-new-device-close-0b7f2737.json) |
| return the recoverer's balance | `f4f0dd3e957fe67ba076f8a3410a2a8289e88e1a6261d40ea5000d01e8fb13ac` | 185 | 185 | what the recoverer did not use | [pay](invitations/stage-8-chipnet/11-the-recoverer-pay-f4f0dd3e.json) |

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
- The funding address held 60551300 satoshis before the run and holds 60541635 after it: the run cost 9665 satoshis in fees. Nothing is left anywhere else.
