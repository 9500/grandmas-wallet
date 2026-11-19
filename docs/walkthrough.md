# Trying Grandma's Wallet by hand

This walks through the wallet's basic course in a browser: a helper sets up a wallet for Grandma from their own coins, Grandma receives and pays, a recovery request nobody asked for is refused, the phone is lost, and the wallet comes back on a new one. It uses the Bitcoin Cash test network; the coins have no value.

- Wallet: <https://wallet.9500.cash/>
- Recoverer: <https://recoverer.9500.cash/>

The public pages are released from this repository; `version.json` at each address names the commit. The same pages run on your own machine (at the end).

The same course runs unattended in `scripts/browser-run.ts`; its last run on the local node is recorded in [runs/wallet-set-up-local-node.md](runs/wallet-set-up-local-node.md), and pictures of the screens are in [screens/](screens/).

## What you need

- **Two browser profiles for phones.** Each profile is one phone: a page keeps its keys in the profile it runs in. Two different browsers, or one browser and a private window, or a computer and a real phone all do. Below they are called **the old phone** and **the new phone**.
- **The recoverer's page** in a third profile, or beside a phone's: it is a different site from the wallet, so it keeps its own data even in the same profile. In life it is a bank's computer, or a friend's.
- **About 0.0005 BCH of test coins**, for the recoverer's balance: each wallet it sets up takes the starting balance of the settings, a reserve of 4,900 satoshis for its own fees, and the network's fees.
- **About twenty minutes.** The shortest waiting period is 512 seconds of the chain's clock, which in practice is ten to fifteen minutes on chipnet.

Both pages are open at the same moment, as they would be in person or on a call. The phone scans the code on the recoverer's screen and everything else goes over the connection the code offers. On a computer without a camera, copy the code's text from **The code as text** under the recoverer's code, and paste it on the wallet's scanner screen under **No camera?**.

## 1. The recoverer starts

On the recoverer's page, choose **I'm helping someone I know** (a bank chooses **I'm a bank**), enter a name (say, Anna) and press **Continue**. Under **Settings**, choose the waiting period **about 9 minutes**, the one for trying things out, and a starting balance, then **Save**. On the first screen, **Your balance** shows an address: send test coins to it. The balance shows them within a few seconds.

## 2. Anna sets up Grandma's wallet

1. On the recoverer's page press **Help someone set up**, enter whose wallet it is (Grandma) and press **Show the code**.
2. On the old phone, open the wallet and choose **Someone I trust is setting it up**. The scanner opens: point it at the code. The phone shows **Setting up…**, then **Waiting for Anna to say yes**.
3. On the recoverer's page: **Set up Grandma's wallet with …?** Press **Set it up**.
4. The phone shows **Your wallet is ready**, with the starting balance and **Protected by Anna**. Press **Open my wallet**. The wallet does not wait for a block: the starting balance can be spent at once.

A bank's page does the same with **New customer**, without the question: the customer chooses **I have a code from my bank** and the wallet is set up the moment their phone asks. Either page can be closed and opened again during the set-up; the phone sends the same request again and gets the same wallet.

Within a short while the home screen says **Protected**: the wallet found Anna's receipt on the backup stores.

## 3. Receive and pay

- On these screens the explanations are behind a small **?**: tap it to read, tap again or anywhere else to close. Warnings that guard against losing coins are always in view.
- **Receive** shows a fresh address each time. "For regular payments" gives a vault address instead, for someone who pays to the same address again and again; the **?** under the choice says what each kind is for.
- **Send** asks for an address and an amount, with what is available beside it, and then shows the fee before anything is sent: one satoshi per byte, exactly.
- The home screen's "What it is made of" shows where the coins are.
- **Tokens.** The Receive screen shows the address in the form that wallets sending tokens ask for; untick **Receiving a token?** for the plain form of the same address. Once the wallet holds a token, **Send** offers **Bitcoin Cash** or **A token**, and each token on the **Apps** screen has a **Send** button. A token goes only to a token address; a plain address is refused, with what to ask the receiver for. The review shows what goes, the token change and the fee; a token that controls something, such as a jar's key, says what, and is sent only after you tick that you understand. Tokens show a name and an amount in dollars and cents, say, only where a template you trust names them, and the **?** beside the amount says which.
- **Templates.** The **Apps** screen lists the templates you trust; open one to see the tokens of it you hold and the apps that are told about them, or to **Stop trusting** it. If you were sent a token of an app you never used, a loan key for example, connect to the app's page and press its **Show the … my wallet holds** button: the wallet shows the page's template, and once you trust it the page lists what you hold.
- **An application's request** opens with a picture: your wallet on one side, the application as its template names it on the other, and what goes each way; under it, by how much your wallet goes up or down. A template that is not verified, tokens that are destroyed and a payment the wallet makes to itself first are said in view. Then the action in the template's words, and, folded, **This wallet's own figures** with every coin in and out, and **The template**. **Approve** and **Decline** stay at the foot of the screen.

## 4. A request nobody asked for

This shows what protects Grandma when her recoverer is deceived, or the recoverer's key is stolen.

1. On the recoverer's page open Grandma's wallet and press **Grandma lost their phone**. A code appears.
2. On the new phone, open the wallet, choose **I lost my phone** and scan that code. The request goes to Anna's page, which asks the network to move the wallet at once: whoever pressed the button has made sure who is asking. Here, nobody did.
3. Within a minute or so the old phone, if its page is open, refuses the request by itself and says so; the wallet's activity keeps it. The wallet stays with the old phone, and the recoverer's page shows that the request was refused.
4. To decide yourself instead, untick **Refuse requests without asking** under **Recovery** beforehand: the old phone then shows a red card, **Someone asked to move your wallet**, with the time until which it can be refused, and **Refuse the request**.
5. Refusing took its fee, about 1,100 satoshis, from the wallet's coins, like a payment. The wallet stays Protected.

## 5. The phone is lost, and the wallet comes back

1. Close the old phone's profile and do not open it again. That is the lost phone.
2. On the recoverer's page, open Grandma's wallet and press **Grandma lost their phone** again; on the new phone, scan the new code (choose **Scan again** first if it still shows the earlier request). The request is sent.
3. The waiting period runs. The recoverer's page shows the chain's clock, which moves with each block, and the time it has to pass. Both pages can stay open; closing them is fine too.
4. When it has passed, the recoverer presses **Complete the move**. If the new phone is still open on its waiting screen, the wallet reaches it over the connection by itself. Otherwise the recoverer's page shows a code: on the new phone, open **Scan the code they show after the waiting period** and scan it.
5. The new phone checks the wallet's history on the chain and brings the coins over: it finds them with the old phone's viewing key, which the recoverer kept, and moves them to its own addresses. Press **Open the wallet**. The balance is back, less the fees, and after a short while the wallet is **Protected** again with the same recoverer.

If you now open the old phone's profile again, it says **This wallet now belongs to another key**. It cannot spend what was moved, and it gives out no address.

## 6. More to try

Under **Recovery** on the wallet page:

- **Move to a new phone** while the old one still works: no waiting period. The new phone starts with "I still have my old phone"; the old one makes one link for the recoverer and one for the new phone.
- **Change your recoverer.** A second recoverer page (another profile) shows its code under its set-up screen; the wallet takes it, sends it a complete kit over the connection, the new recoverer keeps it "as the new recoverer", and the wallet then names them. The first recoverer's key stops working on the wallet.
- **Your own backup:** twelve words and the wallet's identity. On another profile, "I have my own backup" opens the same wallet at once, with no waiting period and without the recoverer.
- **Refuse requests without asking** is on unless you turn it off: while the page is open, a request nobody asked for is refused by the phone itself, and the wallet's activity shows it.
- **Technical details** shows the identity, the keys' fingerprints, the servers and what this phone sent, and erases the phone.
- **Developer mode**, on the Technical details screen and in the recoverer's settings, lists every transaction that browser sent and saves the XO invitation behind each as a file. [xo-invitations.md](xo-invitations.md) says what to do with one.

On the recoverer's page, **Your balance** pays for everything: setting a wallet up, and a request and its completion for any wallet. Nothing is kept with a wallet. **Send all** sends the whole balance to another address.

## What this demonstration does not show

- **Watching in the background.** The page checks the wallet every fifteen seconds while it is open, and says so. A phone with the page closed, or switched off, does not watch, and nothing wakes it when a request appears. A released wallet needs an application that runs in the background, or a service that alerts the phone. The wallet does say afterwards when it was not running during a waiting period.
- **A waiting period worth relying on.** Nine minutes is for trying things out. The choices go up to a week.
- **Both pages at once, really.** The set-up and the lost phone need both pages open at the same moment. That was tried in browsers on one machine through a relay on that machine, not on real phones or through the public relays.
- **The scanner on every phone.** Reading codes was tried in a browser with simulated cameras. Going round a phone's rear cameras, and zoom, have not been tried on real phones.
- **Keys kept safely.** Both pages keep their keys in the browser's storage, unencrypted. That is acceptable for coins without value and nothing else.
- **A real second person.** Pressing "lost their phone" stands for making sure who is asking, by a phone call or a visit.
- **Closing a wallet.** The wallet's code can close a wallet and take the last satoshi out; the page does not offer it.
- **The main network.** The code makes no assumption that holds only on chipnet, and is tested under the main network's rules on a local node, but these pages are set up for test networks.

## On your own machine

The same pages run against a local test node, where blocks come every fifteen seconds and a waiting period passes on command:

```
deploy/regtest/regtest.sh status      # the local node (see docs/local-node.md)
deploy/preview.sh build
deploy/preview.sh start local
npx tsx scripts/local-pay.ts <address> <satoshis>     # pay an address
npx tsx scripts/local-pay.ts time 600                 # let a waiting period of 512 seconds pass
```

The wallet is then at <http://localhost:8101/> and the recoverer at <http://localhost:8102/>. The connection between the two pages goes through the relays named in `deploy/config/local-regtest.json`, which are public ones; `scripts/browser-run.ts` uses a relay on this machine instead. `deploy/preview.sh start chipnet` serves the same pages for chipnet on the same local addresses.
