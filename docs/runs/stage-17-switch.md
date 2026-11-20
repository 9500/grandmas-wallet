# Switching the public sites to the third design, and back

Carried out on 20 November 2026 at 21:13 UTC, on the machine that serves `wallet.9500.cash`, `recoverer.9500.cash`, `jar.9500.cash`, `paryon.9500.cash`, `blaze2026.9500.cash`, `store1.9500.cash` and `store2.9500.cash` behind a reverse proxy, as the owner decided. The proxy was not touched: it reaches the same ports before and after. The switch interrupted the sites for about three seconds.

## Before

The pages were served from the release copy in `~/.local/share/grandmas-wallet/release`, built from the second design on `main` (commit `1db8029` with changes not committed, released on 19 November). The two stores ran from the main checkout (`/home/ubuntu/projects/grandma's-wallet`), with their data outside every checkout in `~/.local/share/grandmas-wallet/store1` and `store2`. The overview at `blaze2026.9500.cash/design.html` was the second design's (`docs/design_v0.5.html`).

```
$ node deploy/check-public.mjs deploy/config/production.json
wallet: https://wallet.9500.cash/ answers 200, "Grandma's Wallet", content security policy sent; commit 1db8029 of main with uncommitted changes, network chipnet, released 2026-11-19T21:23:11Z
recoverer: https://recoverer.9500.cash/ answers 200, "Recoverer · Grandma's Wallet", content security policy sent; commit 1db8029 of main with uncommitted changes, network chipnet, released 2026-11-19T21:23:11Z
savings jar: https://jar.9500.cash/ answers 200, "Savings Jar", content security policy sent; commit 1db8029 of main with uncommitted changes, network chipnet, released 2026-11-19T21:23:11Z
loan page: https://paryon.9500.cash/ answers 200, "Loan desk · independent, not affiliated with Paryon", content security policy sent; commit 1db8029 of main with uncommitted changes, network chipnet, released 2026-11-19T21:23:11Z
store: https://store1.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
store: https://store2.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
```

## What was kept

In `~/.local/share/grandmas-wallet/switches/2026-11-20-to-design-3/`:

- `release/`: the release copy as it was served, compared with the original and found the same. Since that release was built with changes that were never committed, this copy, not a build from `main`, is what the second design's pages were.
- `units/`: every `grandmas-wallet-*.service` definition as it was running (the seven of the sites, and the two of the local test node, which the installer does not touch).
- `store1/`, `store2/`: a copy of each store's data, taken right before the switch: 94 files in 25 archives each, compared with the original and found the same.

## The check before the release

People have wallets of the second design in their browsers at `https://wallet.9500.cash/`, which now serves the third. Before the release, copies of browser profiles that pages of the second design had filled were opened with this checkout's build served at the public addresses (`scripts/earlier-profile-check.ts`: requests to the page's origin answered from `apps/<page>/dist` with `deploy/config/production.json`; the chain's servers and the public stores reached as configured; only the copy opened):

- **A closed wallet of the second design's chipnet jar course** (`.chipnet/browser-run-jar-chipnet/profiles/new-phone`, after it was closed with the leftovers): it opened, showed 0 BCH and "This wallet has been closed", its earlier activity, the Applications screen with its connection to the jar page and the template "Savings Jar" as trusted and in the backup, and its technical details. The page reported one error from the XO engine, which had not finished checking block headers when a transaction update arrived ("Could not validate a block header on height 340071 … ahead of the current checkpoint"); it did not recur in the later checks.
- **The same run's taken-over old phone** and **its recoverer**: they opened ("This wallet has been closed"; on the recoverer's page "Closed", "The owner closed this wallet"), with no error.
- **A wallet of the second design with coins and a jar key.** None of the earlier ones held anything any more, so one was made for the check on the public pages, which still served the second design: a recoverer's page funded with 400,000 sat set up a wallet with 100,000 sat (`1c0fd638…0832`), and the public jar page opened a jar of 30,000 sat through it (transaction `66e581f557a2a2a65884bcaf244f1a74f6ab0721baa11bf059c730026ed1df32`). The second design's run script for this (`scripts/browser-run-jar.ts chipnet` on `main`) stopped after the wallet was made, because the recoverer's page as released no longer says what it waited for; the rest was done by a short driver of the same pages. A copy of the phone's profile opened with this build: 68,173 sat in the wallet, the earlier activity, recovery on with Anna, the template "Savings Jar" trusted and in the backup (the second design's record of it carried a recovery declaration, which was not read), and the jar's key listed as a token, with no position claimed for it. A copy of the recoverer's profile opened on its list of people with the wallet "Quiet" and its balance. Neither page reported an error.
- **One defect** showed there: the key was listed as "A token of unknown meaning", although the phone kept the second design's note that the template "Savings Jar" made it, and the proposal (section 17) lists such a token by the template's name where an earlier note gives one. Corrected in `cd18348` with a test: the list and the Send screen now name the template the note gives, and say that no record ties the token to a position.
- The jar of the check was then emptied with the second design's pages, as the proposal (section 15.3) has it for jars of the earlier template (the wallet's list: "Closed", "It holds nothing now"), the wallet was closed to the funding address with its key destroyed (`afd7e303ce00f49341881d49b1e12cd812328698d3c468b1c34b798eb07b78c3`, 1,569 bytes, fee 1,569 sat, 98,084 sat arrived) and the recoverer's balance was sent back from her page (`3bd958e7d1cb2c4865c33d21b6988560026e16c64e7bf78cf318de54c7fe91f9`, fee 185 sat, 298,438 sat arrived). The funding address held 60,423,704 sat before the check and 60,418,597 after it: the check cost 5,107 sat in fees.

## Switched to the third design

```
$ deploy/preview.sh build
$ deploy/install-services.sh 192.168.88.112 deploy/config/production.json 2
wallet     active
recoverer  active
jar        active
landing    active
loan       active
store1     active
store2     active
$ node deploy/check-public.mjs deploy/config/production.json --expect cd18348
wallet: https://wallet.9500.cash/ answers 200, "Grandma's Wallet", content security policy sent; commit cd18348 of design-3, network chipnet, released 2026-11-20T21:13:24Z
recoverer: https://recoverer.9500.cash/ answers 200, "Recoverer · Grandma's Wallet", content security policy sent; commit cd18348 of design-3, network chipnet, released 2026-11-20T21:13:24Z
savings jar: https://jar.9500.cash/ answers 200, "Savings Jar", content security policy sent; commit cd18348 of design-3, network chipnet, released 2026-11-20T21:13:24Z
loan page: https://paryon.9500.cash/ answers 200, "Loan desk · independent, not affiliated with Paryon", content security policy sent; commit cd18348 of design-3, network chipnet, released 2026-11-20T21:13:24Z
store: https://store1.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
store: https://store2.9500.cash answers 200, lists an unused archive as empty and allows https://wallet.9500.cash
```

- **What is public:** commit `cd18348` of the branch `design-3`, with nothing uncommitted (`https://wallet.9500.cash/version.json`: `{"commit":"cd18348","branch":"design-3","uncommittedChanges":false,"releasedAt":"2026-11-20T21:13:24Z"}`). The loan page uses Paryon's deployment `chipnet-fast-periods-6`, the default for chipnet: the production configuration names none of its own.
- **The stores** now run from the design-3 checkout (`/home/ubuntu/projects/grandmas-wallet-design-3`) with the same data directories; the store's server is the same code in both designs. After the switch each store's data was still the same as the copy, and a record of an existing archive was served whole (17,552 bytes, as on disk).
- **The overview:** `blaze2026.9500.cash/design.html` is now the third design's (`docs/design_v0.6.html`, "Grandma's Wallet Design 3"). The second design's is published beside it as `design_v0.5.html`, the name the third design's page links to, so the link works both there and when the file is opened from `docs/`; both are served as documents complete in themselves. The introduction links to both.
- **The pages work there**, without coins (`scripts/page-smoke.ts deploy/config/production.json`): the recoverer's page started, read its balance and showed its code; the wallet page took the code in and asked over the session; the recoverer's page asked "Set up Grandma's wallet?" and, with an empty balance, refused with what it would take; the Savings Jar page and the loan page showed the address a wallet connects with; no page logged an error. Each page was also opened at 390 and 1440 pixels wide: none is wider than the screen, none reported an error, and the overview's link to the second design opened it. With coins: the chipnet runs of stage 17 ([run G](stage-17-jar-browser-chipnet.md), [run H](stage-17-loan-browser-chipnet.md), [the jar page with Cashonize](stage-17-jar-cashonize-chipnet.md)).

## What a browser that used the second design's pages sees

The third design's pages keep their data under the same names as the second's and read what they kept: a wallet made with the second design's page opens with its coins, its recoverer and its trusted templates, and a recoverer's page with its wallets. A template the second design stored with a recovery declaration is read as the template alone. A token of the second design has no position record: it is listed as a token, by the name of the template the second design's note gives, and can be sent. Whether the third design's pages empty a jar of the second design that is still open was not tried: the proposal (section 15.3) has such jars emptied with the second design's build first, and none of this project's was left open on chipnet.

## The way back

The installer of the second design would build from `main` as it is now, which is not what was served. The way back is the kept copy:

```
$ S=~/.local/share/grandmas-wallet/switches/2026-11-20-to-design-3
$ rm -rf ~/.local/share/grandmas-wallet/release && cp -a $S/release ~/.local/share/grandmas-wallet/release
$ cp $S/units/grandmas-wallet-*.service ~/.config/systemd/user/
$ systemctl --user daemon-reload
$ for name in wallet recoverer jar landing loan store1 store2; do systemctl --user restart grandmas-wallet-$name.service; done
$ node deploy/check-public.mjs deploy/config/production.json --expect 1db8029
```

The stores then run from the main checkout again, on the same data. It was not tried this time. To come back to the third design, run the installer from the design-3 checkout as above.

## Since then

On 20 November 2026 at 23:04 UTC the pages were released again, from commit `b67f221`, with the same installer and the same check from outside (all pages at `b67f221` of `design-3`, both stores answering, `scripts/page-smoke.ts` without an error). The one change to the pages: the loan page takes one of Paryon's manage function coins at random rather than always the first, after run H's first closing was refused as a conflict over such a coin ([run H](stage-17-loan-browser-chipnet.md)). The stores held 117 files each by then, the 94 of the copy and the records the runs wrote. The way back above is unchanged.
