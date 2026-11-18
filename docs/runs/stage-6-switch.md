# Switching the public sites to this design, and back (OP03)

Carried out on 17 November 2026 between 23:55 and 23:57 UTC, on the machine that serves `wallet.9500.cash`, `recoverer.9500.cash`, `jar.9500.cash`, `store1.9500.cash` and `store2.9500.cash` behind a reverse proxy. The proxy was not touched: it reaches the same ports before and after.

## Before

The five services ran from the checkout of the tag `design-1` (`/home/ubuntu/projects/grandmas-wallet-design-1`), the pages from that checkout's builds. The stores keep their data outside every checkout, in `~/.local/share/grandmas-wallet/store1` and `store2`.

```
$ node deploy/check-public.mjs deploy/config/production.json
wallet: https://wallet.9500.cash/ answers 200, "Grandma's Wallet", content security policy sent; no version record (a server of the first design)
recoverer: https://recoverer.9500.cash/ answers 200, "Recoverer · Grandma's Wallet", content security policy sent; no version record (a server of the first design)
savings jar: https://jar.9500.cash/ answers 200, "Savings Jar", content security policy sent; no version record (a server of the first design)
store: https://store1.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
store: https://store2.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
```

## What was kept

In `~/.local/share/grandmas-wallet/switches/2026-11-18-to-design-2/`:

- the five service definitions as they were running (`units/`);
- a copy of each store's data: 41 files in 7 archives each, compared with the original and found the same.

The checkout of `design-1` stays where it is, with its builds.

## Switched to this design

```
$ deploy/preview.sh build
$ deploy/install-services.sh 192.168.88.112 deploy/config/production.json 2
$ node deploy/check-public.mjs deploy/config/production.json --expect 7ef8e7e
wallet: https://wallet.9500.cash/ answers 200, "Grandma's Wallet", content security policy sent; commit 7ef8e7e of design-2, network chipnet, released 2026-11-17T23:55:55Z
recoverer: https://recoverer.9500.cash/ answers 200, "Recoverer · Grandma's Wallet", content security policy sent; commit 7ef8e7e of design-2, network chipnet, released 2026-11-17T23:55:55Z
savings jar: https://jar.9500.cash/ answers 200, "Savings Jar", content security policy sent; commit 7ef8e7e of design-2, network chipnet, released 2026-11-17T23:55:55Z
store: https://store1.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
store: https://store2.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
```

- **Installed from the intended checkout.** The pages are served from a copy of the build made by the installer (`~/.local/share/grandmas-wallet/release`), which records the commit it was built from and that the checkout had no uncommitted changes. Building again in the checkout changes nothing that is public until the installer is run again. The stores run from this checkout.
- **The running version** is read from the public addresses, above: commit `7ef8e7e`, the checkout's own.
- **The stores' data** was the same as the copy after the switch: 41 files each, no difference.
- **The pages work there.** Without coins: the recoverer's page gave its link, and the wallet page took it in, opened its keys in the XO engine in 8 seconds and showed the address for the first coins, with no error logged by either page (`scripts/page-smoke.ts deploy/config/production.json`). With coins: the whole course, in [stage-6-chipnet.md](stage-6-chipnet.md).
- **The Savings Jar** of the first design is no longer served. Its address shows a notice that the application is being rebuilt.

## The way back, tried once

```
$ cd /home/ubuntu/projects/grandmas-wallet-design-1
$ deploy/install-services.sh 192.168.88.112 deploy/config/production.json 2
$ node deploy/check-public.mjs deploy/config/production.json        (from this checkout)
wallet: https://wallet.9500.cash/ answers 200, "Grandma's Wallet", content security policy sent; no version record (a server of the first design)
recoverer: https://recoverer.9500.cash/ answers 200, "Recoverer · Grandma's Wallet", content security policy sent; no version record (a server of the first design)
savings jar: https://jar.9500.cash/ answers 200, "Savings Jar", content security policy sent; no version record (a server of the first design)
store: https://store1.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
store: https://store2.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
```

The first design's pages and its Savings Jar were served again from its checkout, and the stores' data was still the same as the copy. Then the installer of this design was run again:

```
wallet: https://wallet.9500.cash/ answers 200, "Grandma's Wallet", content security policy sent; commit 7ef8e7e of design-2, network chipnet, released 2026-11-17T23:56:43Z
recoverer: https://recoverer.9500.cash/ answers 200, "Recoverer · Grandma's Wallet", content security policy sent; commit 7ef8e7e of design-2, network chipnet, released 2026-11-17T23:56:43Z
savings jar: https://jar.9500.cash/ answers 200, "Savings Jar", content security policy sent; commit 7ef8e7e of design-2, network chipnet, released 2026-11-17T23:56:43Z
store: https://store1.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
store: https://store2.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
```

Each switch interrupted the sites for about three seconds.

## What a browser that used the first design's pages sees

The new pages keep their data under names of their own and never read what the first design's pages kept in the same browser. A wallet made with the first design's page is not shown by the new page; its data stays in the browser until the site's data is cleared or the new page's "Erase this phone" is used, which clears everything the site keeps. The wallet made on the first design's public page was emptied by its owner before the switch.

## Since then

On 18 November 2026 at 00:40 UTC the pages were released again from commit `c15a069`, with one change: a page whose first chipnet server takes no connection opens its account through the next one. The same installer and the same check from outside were used. What is public at any time is at `https://wallet.9500.cash/version.json`.
