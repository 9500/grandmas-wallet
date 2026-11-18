# Trying Grandma's Wallet by hand

This walks through the wallet's basic course in a browser: making a wallet with a recoverer, receiving and paying, refusing a recovery request nobody asked for, losing the phone, and getting the wallet back on a new one. It uses the public pages on chipnet, the Bitcoin Cash test network. The coins have no value.

- Wallet: <https://wallet.9500.cash/>
- Recoverer: <https://recoverer.9500.cash/>

The same course runs unattended in `scripts/browser-run.ts`; its last runs are recorded in [runs/stage-6-local-node.md](runs/stage-6-local-node.md) and [runs/stage-6-chipnet.md](runs/stage-6-chipnet.md), and pictures of every screen are in [screens/](screens/).

## What you need

- **Two browser profiles.** Each profile is one phone: a page keeps its keys in the profile it runs in. Two different browsers, or one browser and a private window, or a computer and a real phone all do. Below they are called **the old phone** and **the new phone**.
- **The recoverer's page** in any of them. It is a different site from the wallet, so it keeps its own data even in the same profile. In life it is another person's device.
- **About 0.0002 BCH of chipnet coins** in any chipnet wallet, to send to the new wallet. Creating the wallet takes 8,173 satoshis with the allowance for the recoverer; the rest is yours to play with.
- **About twenty minutes.** A block comes about once a minute on chipnet, and the shortest waiting period is 512 seconds of the chain's clock, which in practice is ten to fifteen minutes.

Links carry everything between the pages. Where the text says "send the link", copy it with the button beside it and open it in the other page's profile. Between a computer and a real phone, the **Scan** button beside each field of the wallet reads the QR code instead: with the phone's camera, or from a picture. When the recoverer's page is open at the same time as the wallet, setting up recovery needs no link at all (steps 1 to 3).

## 1. The recoverer gives their link

On the recoverer's page, open **Your link**, enter a name (say, Anna) and copy the link. Note the fingerprint beside it.

The page also shows a QR code. With the wallet on a real phone, leave this page open and let the phone scan the code in step 2 instead of copying the link: the code also opens a connection between the two pages, and the kit comes back over it by itself. The link works at any time; the code's connection only while this page stays open.

## 2. Grandma makes a wallet

1. On the old phone, open the recoverer's link. The wallet page opens and says whose link it is. Choose **Make a new wallet**. Or, with the code: choose **Make a new wallet**, press **Scan** beside "Your recoverer's link", point the phone at the code on the recoverer's page, and press **Use this link**. The recoverer's page then says that a phone is connected.
2. Compare the fingerprint with the one the recoverer's page shows, and tick **The fingerprints are the same**. In life this is done over the phone or face to face: it is what makes sure the kit is sealed to the right person.
3. Choose the waiting period. Take **about 9 minutes**, the one for trying things out.
4. Leave the allowance ticked and press **Continue**.
5. The page shows an address and the amount it needs. Send chipnet coins to it. When they have arrived, press **Create the wallet**.
6. The page makes the **recovery kit** at once: the wallet does not wait for a block. If the phone scanned the recoverer's code and their page is still open, the kit goes straight there, and the wallet says that the recoverer's page has it; the link is folded away under "Send it as a link instead". Otherwise the page shows the link: send it to the recoverer.

The page can be closed and opened again at any step; it continues where it was.

## 3. The recoverer takes the kit in

Open the kit link on the recoverer's page; a kit that came over the connection is already shown at the top of the page, as if its link had been opened. Enter whose wallet it is, and press **Check and keep the kit**. The wallet, if the kit came over the connection, says that it was kept. The recoverer's page checks the kit against the chain, keeps it, and leaves a receipt in the backup stores.

Within a short while the wallet's home screen changes from "Recovery is not on yet" to **Protected**. Recovery is on only from this moment: the wallet does not say so because it sent a kit, but because it found the recoverer's receipt for exactly what it sent.

## 4. Receive and pay

- On these screens the explanations are behind a small **?**: tap it to read, tap again or anywhere else to close. Warnings that guard against losing coins are always in view.
- **Receive** shows a fresh address each time. "For regular payments" gives a vault address instead, for someone who pays to the same address again and again; the **?** under the choice says what each kind is for.
- **Send** asks for an address and an amount, with what is available beside it, and then shows the fee before anything is sent: one satoshi per byte, exactly.
- The home screen's "What it is made of" shows where the coins are.
- **Tokens.** To receive one, tick **Receiving a token?** on the Receive screen: the same address, written in the form that wallets sending tokens ask for. Once the wallet holds a token, **Send** offers **Bitcoin Cash** or **A token**, and each token on the **Apps** screen has a **Send** button. A token goes only to a token address; a plain address is refused, with what to ask the receiver for. The review shows what goes, the token change and the fee; a token that controls something, such as a jar's key, says what, and is sent only after you tick that you understand. Tokens show a name and an amount in dollars and cents, say, only where a template you trust names them, and the **?** beside the amount says which.
- **An application's request** opens with a picture: your wallet on one side, the application as its template names it on the other, and what goes each way; under it, by how much your wallet goes up or down. A template that is not verified, tokens that are destroyed and a payment the wallet makes to itself first are said in view. Then the action in the template's words, and, folded, **This wallet's own figures** with every coin in and out, and **The template**. **Approve** and **Decline** stay at the foot of the screen.

## 5. A request nobody asked for

This shows what protects Grandma when her recoverer is deceived, or the recoverer's key is stolen.

1. On the new phone, open the recoverer's link and choose **Take over my wallet on this phone**. Tick the fingerprint box and press **Make my request**. Send the link it shows to the recoverer. (If the new phone scanned the code of the recoverer's **Your link** screen instead, with that page open, the request goes there by itself and is already among the recoverer's requests.)
2. On the recoverer's page, open that link, choose **See the request**, pick Grandma's wallet, tick **I have made sure who is asking**, and press **Save it for this wallet**. Then press **Ask the network to move the wallet**.
3. Within a minute or so the old phone shows a red card: **Someone asked to move your wallet**, with the fingerprint of the key that would get it and the time until which it can be refused.
4. Press **Refuse the request**. The wallet stays with the old phone. The recoverer's page shows that the request was refused.
5. Refusing took its fee, about 1,100 satoshis, from the wallet's coins, like a payment. The wallet stays Protected.

## 6. The phone is lost, and the wallet comes back

1. Close the old phone's profile and do not open it again. That is the lost phone.
2. The new phone still shows its request from step 5, and the recoverer still has it saved. On the recoverer's page, open Grandma's wallet and press **Ask the network again**. (Starting fresh works too: repeat the first two parts of step 5.)
3. The waiting period runs. The recoverer's page shows when it ends by the chain's clock. Both pages can be closed meanwhile.
4. When it has passed, the recoverer presses **Complete the move**. The recoverer's page then shows a link for the new phone at once. Send it there.
5. The new phone opens the link, or scans its code from the recoverer's screen with the **Scan** button beside "The link from your recoverer". It checks the wallet's history on the chain, and brings the coins over: it finds them with the old phone's viewing key, which the recoverer kept, and moves them to its own addresses. Press **Open the wallet**. The balance is back, less the fees, and after a short while the wallet is **Protected** again with the same recoverer.

If you now open the old phone's profile again, it says **This wallet now belongs to another key**. It cannot spend what was moved, and it gives out no address.

## 7. More to try

All of these are under **Recovery** on the wallet page.

- **Move to a new phone** while the old one still works: no waiting period. The new phone starts with "Move from my other phone"; the old one makes one link for the recoverer and one for the new phone.
- **Change your recoverer.** A second recoverer page (another profile) gives its link; the wallet sends it a kit; the new recoverer keeps it "as the new recoverer"; the wallet then names them. The first recoverer's key stops working on the wallet.
- **Change the waiting period.**
- **Your own backup:** twelve words and the wallet's identity. On another profile, "Restore from my own backup" opens the same wallet at once, with no waiting period and without the recoverer.
- **Refuse requests without asking**, for a phone that is left running.
- **Technical details** shows the identity, the keys' fingerprints, the servers and what this phone sent, and erases the phone.

On the recoverer's page, each wallet shows its **fee coins**: what the recoverer's fee address holds and what a request and a completion cost. A recoverer with no allowance sends coins to that address from any wallet.

## What this demonstration does not show

- **Watching in the background.** The page checks the wallet every fifteen seconds while it is open, and says so. A phone with the page closed, or switched off, does not watch, and nothing wakes it when a request appears. A released wallet needs an application that runs in the background, or a service that alerts the phone. The wallet does say afterwards when it was not running during a waiting period.
- **A waiting period worth relying on.** Nine minutes is for trying things out. The choices go up to a week.
- **The scanner on every phone.** Reading codes was tried in a browser with simulated cameras. Going round a phone's rear cameras, and zoom, have not been tried on real phones.
- **Keys kept safely.** Both pages keep their keys in the browser's storage, unencrypted. That is acceptable for coins without value and nothing else.
- **A real second person.** The fingerprint comparisons and the recoverer's "I have made sure who is asking" stand for a phone call or a visit. Ticking a box in the next tab shows the step, not its worth.
- **Applications.** The wallet page is a wallet only. The Savings Jar application that uses it through XO templates comes in a later stage; its address shows a notice until then.
- **Closing a wallet.** The wallet's code can close a wallet and take the last satoshi out; the page does not offer it yet.
- **The main network.** The code makes no assumption that holds only on chipnet, and is tested under the main network's rules on a local node, but these pages are set up for chipnet.

## On your own machine

The same pages run against a local test node, where blocks come every fifteen seconds and a waiting period passes on command:

```
deploy/regtest/regtest.sh status      # the local node (see docs/local-node.md)
deploy/preview.sh build
deploy/preview.sh start local
npx tsx scripts/local-pay.ts <address> <satoshis>     # pay an address
npx tsx scripts/local-pay.ts time 600                 # let a waiting period of 512 seconds pass
```

The wallet is then at <http://localhost:8101/> and the recoverer at <http://localhost:8102/>. `deploy/preview.sh start chipnet` serves the same pages for chipnet on the same local addresses.
