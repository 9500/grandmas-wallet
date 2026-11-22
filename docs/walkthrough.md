# Trying Grandma's Wallet by hand

This is the walkthrough of the third design (design 3, on `main`). The second design's is at the tag `design-2`: `git show design-2:docs/walkthrough.md`.

It walks through the wallet in a browser: a helper sets up a wallet for Grandma from their own coins, Grandma receives and pays, opens a savings jar and a loan from their pages, a recovery request nobody asked for is refused, the phone is lost, and the wallet comes back on a new one, with the jar and the loan. It uses chipnet, the Bitcoin Cash test network; the coins have no value. The wallet and the recoverer ask a first-time visitor where to try them: choose **Chipnet** on both. The same course runs on the **mockup**, a chain of the site's own where play coins come at a press and a button lets a waiting period pass ([mockup.md](mockup.md)), and on mainnet, which is offered only to meet the requirements of BCH Blaze, with a warning.

| Page | Address |
| --- | --- |
| Wallet, for the phone | <https://wallet.9500.cash/> |
| Recoverer, for a bank or a friend | <https://recoverer.9500.cash/> |
| Savings Jar | <https://jar.9500.cash/> |
| Loan desk, an independent page for ParyonUSD's contracts, not affiliated with Paryon | <https://paryon.9500.cash/> |

The public pages are released from this repository; `version.json` at each address names the commit and the branch, `main` for this design. The same pages run on your own machine (at the end).

The same course runs unattended in scripts on the local node: setting up and recovering in `scripts/browser-run.ts` ([runs/wallet-set-up-local-node.md](runs/wallet-set-up-local-node.md)), the jar in `scripts/stage-17-jar-browser.ts` ([runs/stage-17-jar-browser-local-node.md](runs/stage-17-jar-browser-local-node.md)) and the loan in `scripts/stage-17-loan-browser.ts` ([runs/stage-17-loan-browser-local-node.md](runs/stage-17-loan-browser-local-node.md)). Pictures of their screens are in [screens/](screens/), those of the applications as `live-jar-*` and `live-loan-*`.

## What you need

- **Two browser profiles for phones.** Each profile is one phone: a page keeps its keys in the profile it runs in. Two different browsers, or one browser and a private window, or a computer and a real phone all do. Below they are called **the old phone** and **the new phone**.
- **The recoverer's page** in a third profile, or beside a phone's: it is a different site from the wallet, so it keeps its own data even in the same profile. In life it is a bank's computer, or a friend's. The jar and loan pages go beside it, on the computer.
- **About 0.0005 BCH of test coins**, for the recoverer's balance: each wallet it sets up takes the starting balance of the settings, a reserve of 4,900 satoshis for its own fees, and the network's fees.
- **For the loan, about 0.61 BCH of test coins more**, sent to the wallet: 100 PUSD, the smallest loan, takes about 0.6 BCH of collateral at a price near $210. The loan page shows the figure before anything is asked of the wallet. The jar takes 0.0001 BCH and its fees: a starting balance of 20,000 satoshis covers them.
- **About half an hour.** The shortest waiting period is 512 seconds of the chain's clock, which in practice is ten to fifteen minutes on chipnet.

The pages are open at the same moment, as they would be in person or on a call. The phone scans the code on the recoverer's screen, or on an application's page, and everything else goes over the connection the code offers. On a computer without a camera, copy the code's text (**The code as text** under the recoverer's code, **Copy address** under an application's) and paste it on the phone instead of scanning: under **No camera?** on the wallet's scanner screen, or **Paste a link instead** on its **Apps** screen.

## 1. The recoverer starts

On the recoverer's page, choose **I'm helping someone I know** (a bank chooses **I'm a bank**), enter a name (say, Anna) and press **Continue**. The page then asks for coins, since it pays for every wallet it sets up and for every move to a new phone: **Add coins to your balance** shows an address and what a new wallet takes. Send test coins to it. The page shows them within a few seconds, and **Continue** opens once the balance covers a new wallet; until then the page offers nothing else. Then, under **Settings**, choose the waiting period **about 9 minutes**, the one for trying things out, and a starting balance (20,000 satoshis leaves room for the jar below), then **Save**.

## 2. Anna sets up Grandma's wallet

1. On the recoverer's page press **Help someone set up**, enter whose wallet it is (Grandma) and press **Show the code**.
2. On the old phone, open the wallet and choose **Someone I trust is setting it up**. The scanner opens: point it at the code. The phone shows **Setting up…**, then **Waiting for Anna to say yes**.
3. On the recoverer's page: **Set up Grandma's wallet with …?** Press **Set it up**.
4. The phone shows **Your wallet is ready**, with the starting balance and **Protected by Anna**. Press **Open my wallet**. The wallet does not wait for a block: the starting balance can be spent at once.

A bank's page does the same with **New customer**, without the question: the customer chooses **I have a code from my bank** and the wallet is set up the moment their phone asks. Either page can be closed and opened again during the set-up; the phone sends the same request again and gets the same wallet.

Within a short while the home screen says **Protected**: the wallet found Anna's receipt on the backup stores.

## 3. Receive and pay

- On these screens the explanations are behind a small **?**: tap it to read, tap again or anywhere else to close. Warnings that guard against losing coins are always in view.
- **Receive** shows a fresh address each time. "For regular payments" gives a vault address instead, for someone who pays to the same address again and again; the **?** under the choice says what each kind is for. For the loan, send the test coins of "What you need" here.
- **Send** asks for an address and an amount, with what is available beside it, and then shows the fee before anything is sent: one satoshi per byte, exactly.
- The home screen's "What it is made of" shows where the coins are.
- **Tokens.** The Receive screen shows the address in the form that wallets sending tokens ask for; untick **Receiving a token?** for the plain form of the same address. Once the wallet holds a token, **Send** offers **Bitcoin Cash** or **A token**, and each token on the **Apps** screen has a **Send** button. A token goes only to a token address; a plain address is refused, with what to ask the receiver for. A fungible token whose issuer published a registry on chain is shown by its name and in its own units, PUSD on chipnet as "100.00 PUSDTEST", with the raw amount and the category behind the **?**; any other by its category and in raw units ([token-registries.md](token-registries.md)).

## 4. Applications: a savings jar and a loan

The wallet uses an application from its XO template alone. Before it signs anything that leaves a position, such as a jar, it writes a record of the position to the backup: that is how a new phone finds it again.

**Connecting.** On the computer, open the application's page; it shows a code under **Connect your wallet**. On the phone, open **Apps**, press **Scan the app's code** and scan it. The page says **Connected to Grandma's Wallet**, and the wallet lists it under **Connected apps** as "Its own name, not verified".

**A savings jar.**

1. On the Savings Jar page, under **Open a jar**, keep the first amount, 0.0001 BCH, choose **10 minutes** under **Opens in**, and press **Open the jar**.
2. The phone shows **Savings Jar asks for your decision**: your wallet on one side, the jar on the other, what goes each way, and by how much your wallet goes down, the fee included. Under it, the action in the template's words; folded, **This wallet's own figures** with every coin in and out, and **The template**. The first time, it says that approving trusts the template on this phone and stores it in your backup first. Press **Approve**.
3. The page says **The jar is open. Its key is in your wallet.**, with its date. On the phone, **Apps** lists under **Tokens** "**Jar key** · Savings Jar", **Open**, "Holds 0.0001 BCH", and the action **Empty a savings jar**, which the wallet carries out by itself.

**A loan.**

1. On the loan desk's page, connect as above. Under **Open a loan**, press **Make a loan key**. The phone's review has a box to tick, **I understand that whoever gets this token gets what it controls**: the key is made from your wallet's coin and waits in Paryon's contract until the loan is opened. Tick it and press **Approve**. This is asked once per loan.
2. If the page says the contracts are behind, press **Bring the contracts up to date** and approve; it costs only the network's fee.
3. Keep 100 PUSD and the proposed collateral of 125%, check the figures, and press **Borrow 100.00 PUSD**. The phone's review shows the BCH going into the loan, the PUSD and the key coming back, and a token of Paryon's that is destroyed. **Approve**.
4. The page lists the loan under **Your loans**, with its collateral, **Change the collateral**, **Change the interest rate** and **Repay and close**. On the phone, **Apps** lists "**Loan key** · ParyonUSD loan (chipnet-fast-periods-6)" under **Tokens**, with the same actions. The loan's template names the loan service that runs beside the page, which brings Paryon's coins and their values, so the wallet carries these out by itself, with the page closed; what the service states is shown in the review under **From the service**, apart from the wallet's own figures. The PUSD are listed in their units.

**Sending a token that controls something.** On **Send**, choose **A token** and the jar's key: the review says which template's position it controls and what it holds now, or, for the loan key, that the application shows what it holds, with the page's address. It is sent only once you tick **I understand that whoever receives this token gets what it controls**. Do not send them now: the recovery below brings them back.

The **Apps** screen also lists the templates you trust; open one to see its service, its actions, its tokens and the apps that are told about them, or to **Stop trusting** it, and delete it too if you like. **Add from a file** under **Templates** adds a template from a JSON file on the phone, or **Paste it instead**: the wallet shows it as it shows an app's offer, and trusts it only on your word.

## 5. A request nobody asked for

This shows what protects Grandma when her recoverer is deceived, or the recoverer's key is stolen.

1. On the recoverer's page open Grandma's wallet and press **Grandma lost their phone**. A code appears.
2. On the new phone, open the wallet, choose **I lost my phone** and scan that code. The request goes to Anna's page, which asks the network to move the wallet at once: whoever pressed the button has made sure who is asking. Here, nobody did.
3. Within a minute or so the old phone, if its page is open, refuses the request by itself and says so; the wallet's activity keeps it. The wallet stays with the old phone, and the recoverer's page shows that the request was refused.
4. To decide yourself instead, untick **Refuse requests without asking** under **Recovery** beforehand: the old phone then shows a red card, **Someone asked to move your wallet**, with the time until which it can be refused, and **Refuse the request**.
5. Refusing took its fee, about 1,100 satoshis, from the wallet's coins, like a payment. The wallet stays Protected.

## 6. The phone is lost, and the wallet comes back

1. Close the old phone's profile and do not open it again. That is the lost phone, with the jar and the loan open.
2. On the recoverer's page, open Grandma's wallet and press **Grandma lost their phone** again; on the new phone, scan the new code (choose **Scan again** first if it still shows the earlier request). The request is sent.
3. The waiting period runs. The recoverer's page shows the chain's clock, which moves with each block, and the time it has to pass. Both pages can stay open; closing them is fine too.
4. When it has passed, the recoverer presses **Complete the move**. If the new phone is still open on its waiting screen, the wallet reaches it over the connection by itself. Otherwise the recoverer's page shows a code: on the new phone, open **Scan the code they show after the waiting period** and scan it.
5. The new phone checks the wallet's history on the chain and brings the coins over: it finds them with the old phone's viewing key, which the recoverer kept, and moves them to its own addresses, the jar's key, the loan key and the PUSD among them. Press **Open the wallet**. The balance is back, less the fees, and after a short while the wallet is **Protected** again with the same recoverer.

If you now open the old phone's profile again, it says **This wallet now belongs to another key**. It cannot spend what was moved, and it gives out no address.

## 7. The jar and the loan on the new phone

The new phone reads the old phone's records from the backup, with the templates it stored. It does not trust a template until you say so.

1. On the new phone, open **Apps**. Under **Tokens**, the jar's key and the loan key are each listed by their template's name, with **Template not trusted** and **Trust this template**.
2. Press **Trust this template** under the jar's key. The phone shows the template: "An earlier owner of this wallet stored this template in the backup". Press **Trust this template**. The wallet checks the record against the chain and lists the jar as before the loss: "**Jar key** · Savings Jar", **Open**, "Holds 0.0001 BCH".
3. Press **Empty a savings jar**. Every value comes from the record or from the wallet itself. The review, **Check and carry out**, shows what comes back, and from when the network accepts it: the jar's date, by the chain's clock, which runs a little behind the real one. Once that has passed, press **Carry it out**. The jar's page is not needed: the list then shows the jar as **Closed**.
4. Trust the loan's template the same way. The loan key is listed under the template's name with **Connect**: a template trusted again from the backup asks its service nothing until you say so.
5. Press **Connect**. The wallet asks the loan service what can be done, and lists the loan's actions under the key, with what the service says the loan holds.
6. Press **Repay and close the loan**. The review, **Check and carry out**, shows the PUSD repaid and destroyed and the collateral coming back. Press **Carry it out**. The key is then listed with "Its service offers nothing for it now."

The loan page can do the same: open it on the computer, connect the new phone, press **Allow** when the phone asks **Loan desk asks to see your tokens**, and the page finds the loan from its key and offers **Repay and close**.

## 8. More to try

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
- **A position for a token from someone else.** The wallet finds a position only from its own record. A jar's key or a loan key sent to you is held and can be sent on; the wallet does not say what it controls, unless the template's service says what can be done with it.
- **Closing a wallet.** The wallet's code can close a wallet and take the last satoshi out; the page does not offer it.
- **The main network, in full.** The pages offer mainnet beside chipnet, with a warning, and a first use with small amounts and a recovery ran there ([runs/mainnet-recovery-completed.md](runs/mainnet-recovery-completed.md)). Nothing is audited, and no loan has been opened on mainnet.

## On your own machine

The same pages run against a local test node, where blocks come every fifteen seconds and a waiting period passes on command:

```
deploy/regtest/regtest.sh status      # the local node (see docs/local-node.md)
deploy/preview.sh build
deploy/preview.sh start local
npx tsx scripts/local-pay.ts <address> <satoshis>     # pay an address
npx tsx scripts/local-pay.ts time 600                 # let a waiting period of 512 seconds pass
deploy/preview.sh stop
```

The wallet is then at <http://localhost:8101/>, the recoverer at <http://localhost:8102/>, the Savings Jar at <http://localhost:8103/> and the loan page at <http://localhost:8104/>. The connection between the pages goes through the relays named in `deploy/config/local-regtest.json`, which are public ones; the scripted courses use a relay on this machine instead. A jar opened here can be emptied once the chain's clock passes its date: `local-pay.ts time` moves the clock on.

The loan page needs Paryon's contracts deployed on the local chain, and the preview deploys none: the page says "No deployment of Paryon's contracts". `scripts/stage-17-loan-browser.ts` deploys them for its run and serves the loan page with that deployment in its configuration.

`deploy/preview.sh start chipnet` serves the same pages for chipnet on the same local addresses, the loan page with Paryon's deployment there.

To check a set of pages without coins before trying them by hand: `npx tsx scripts/page-smoke.ts deploy/config/local-regtest.json` (or `local.json` for the chipnet preview, `production.json` for the public pages).
