#!/usr/bin/env bash
# The wallet page, the recoverer page, the Savings Jar page and the loan page of this checkout, with two backup stores of
# their own, on this machine only. For looking at the pages by hand before anything public changes: the
# public sites and their stores are not touched, and the preview's stores keep their data in a directory
# of their own.
#
# usage: deploy/preview.sh <command>
#   build           build the four pages
#   start local     serve the pages for the local node (regtest); a block is made every 15 seconds
#   start chipnet   serve the pages for chipnet
#   start <file>    serve the pages with that configuration file: for mainnet, a copy of
#                   deploy/config/mainnet.example.json with the preview's addresses (wallet http://localhost:8101/,
#                   recoverer http://localhost:8102/, stores http://localhost:8111 and 8112). Mainnet is served only
#                   when the file allows it ("mainnetEnabled": true), and every page then shows its warning.
#   stop            stop everything the preview started
#   status          what is running
#
# The pages listen on 127.0.0.1: wallet 8101, recoverer 8102, Savings Jar 8103, loan page 8104, backup stores
# 8111 and 8112. The loan page uses Paryon's deployment on chipnet, whose template names Paryon's public loan service;
# on the local node it says it has none, since the preview deploys none. A configuration file that names a deployment
# of Paryon's contracts on a chain of one's own ("paryon" for regtest or the mockup) gets Paryon's loan service as
# well, on 8106 with the same file: its template names the service at <loanUrl>service/v1, the loan page
# forwards /service/ to it, and the wallet page may connect to the loan page's origin. From another computer, forward those ports (and 60403, the local node's server, for
# `local`) and open http://localhost:8101 and the others. A page at localhost counts as
# secure for the browser, which the pages' cryptography needs; a page at this machine's network address
# over plain HTTP does not.
#
# On the local node, coins come from the command line:
#   npx tsx scripts/local-pay.ts <address> <satoshis>     pay an address
#   npx tsx scripts/local-pay.ts time 600                 let a waiting period of 512 seconds pass
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${GRANDMAS_WALLET_PREVIEW:-$HOME/.local/share/grandmas-wallet/preview}"
NODE="$(command -v node)"
mkdir -p "$STATE"
cd "$ROOT"

running() { [ -f "$STATE/$1.pid" ] && kill -0 "$(cat "$STATE/$1.pid")" 2>/dev/null; }

launch() { # name, command...
  local name="$1"; shift
  if running "$name"; then echo "$name is already running"; return; fi
  setsid nohup "$@" > "$STATE/$name.log" 2>&1 < /dev/null &
  echo $! > "$STATE/$name.pid"
  echo "started $name"
}

case "${1:-}" in
  build)
    for app in wallet recoverer jar loan; do (cd "apps/$app" && npx vite build); done
    ;;
  start)
    case "${2:-}" in
      local) CONFIG="deploy/config/local-regtest.json" ;;
      chipnet) CONFIG="deploy/config/local.json" ;;
      *.json) CONFIG="$2"; [ -f "$CONFIG" ] || { echo "no configuration file $CONFIG" >&2; exit 2; } ;;
      *) echo "usage: deploy/preview.sh start <local|chipnet|configuration file>" >&2; exit 2 ;;
    esac
    for app in wallet recoverer jar loan; do
      [ -f "apps/$app/dist/index.html" ] || { echo "apps/$app is not built: deploy/preview.sh build" >&2; exit 1; }
    done
    NETWORK="$("$NODE" -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(c.network === "mainnet" ? (c.mainnetEnabled === true ? "mainnet" : "refused") : c.network)' "$CONFIG")"
    if [ "$NETWORK" = refused ]; then echo "$CONFIG names mainnet but does not allow it (\"mainnetEnabled\": true)" >&2; exit 2; fi
    if [ "$NETWORK" = mainnet ]; then echo "MAINNET: enabled only to meet the requirements of BCH Blaze. Nothing here has been audited; coins can be lost. This project does not recommend enabling it."; fi
    # A configuration of both networks (`networks`) offers mainnet on the pages only with the same parameter.
    OFFERED="$("$NODE" -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(c.networks === undefined ? c.network : Object.keys(c.networks).filter((n) => n !== "mainnet" || c.mainnetEnabled === true).join(" "))' "$CONFIG")"
    case " $OFFERED " in *" mainnet "*) [ "$NETWORK" = mainnet ] || echo "MAINNET offered on the pages beside $NETWORK: enabled only to meet the requirements of BCH Blaze. Nothing here has been audited; coins can be lost. This project does not recommend enabling it." ;; esac
    for number in 1 2; do
      launch "store$number" "$NODE" --import tsx apps/archive-store/src/cli.ts --port "$((8110 + number))" --host 127.0.0.1 \
        --directory "$STATE/store$number" --origin http://localhost:8101 --origin http://localhost:8102
    done
    # Paryon's loan service, for a deployment on a chain of one's own, which no public service serves. The wallet page
    # reaches it beside the loan page, so it may connect to the loan page's origin (its template names the service there).
    SERVICE_ORIGINS="$("$NODE" -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const parts = c.networks === undefined ? [c] : Object.entries(c.networks).map(([network, part]) => ({ ...c, ...part, network })); const own = parts.filter((part) => ["regtest", "mockup"].includes(part.network) && typeof part.paryon === "object" && part.paryon !== null); console.log(own.length === 0 ? "none" : [...new Set(own.flatMap((part) => (typeof part.loanUrl === "string" ? [new URL(part.loanUrl).origin] : [])))].join(" "))' "$CONFIG")"
    FORWARD=()
    WALLET_CONNECT=()
    if [ "$SERVICE_ORIGINS" != none ]; then
      launch paryon-service "$NODE" --import tsx apps/paryon-service/src/cli.ts --config "$CONFIG" --host 127.0.0.1 --port 8106
      FORWARD=(--forward /service/=http://127.0.0.1:8106)
      for origin in $SERVICE_ORIGINS; do WALLET_CONNECT+=(--connect "$origin"); done
    fi
    launch wallet "$NODE" deploy/serve.mjs --root apps/wallet/dist --config "$CONFIG" --host 127.0.0.1 --port 8101 "${WALLET_CONNECT[@]}"
    launch recoverer "$NODE" deploy/serve.mjs --root apps/recoverer/dist --config "$CONFIG" --host 127.0.0.1 --port 8102
    launch jar "$NODE" deploy/serve.mjs --root apps/jar/dist --config "$CONFIG" --host 127.0.0.1 --port 8103
    # The loan page reads the price General Protocols' oracle signs; that server is named for it alone.
    launch loan "$NODE" deploy/serve.mjs --root apps/loan/dist --config "$CONFIG" --host 127.0.0.1 --port 8104 --connect https://oracles.generalprotocols.com "${FORWARD[@]}"
    if [ "$2" = local ]; then
      # Blocks come by themselves, as on a public network, only sooner.
      launch blocks bash -c "cd '$ROOT' && while true; do npx tsx scripts/local-pay.ts mine 1 > /dev/null; sleep 15; done"
    fi
    echo "$2" > "$STATE/chain"
    echo "wallet: http://localhost:8101   recoverer: http://localhost:8102   jar: http://localhost:8103   loan: http://localhost:8104   (chain: $2)"
    ;;
  stop)
    for name in wallet recoverer jar loan paryon-service store1 store2 blocks; do
      if running "$name"; then
        # The whole group: a loop and what it started.
        kill -- "-$(cat "$STATE/$name.pid")" 2>/dev/null || kill "$(cat "$STATE/$name.pid")" 2>/dev/null || true
        echo "stopped $name"
      fi
      rm -f "$STATE/$name.pid"
    done
    ;;
  status)
    for name in wallet recoverer jar loan paryon-service store1 store2 blocks; do
      if running "$name"; then echo "$name: running"; else echo "$name: not running"; fi
    done
    [ -f "$STATE/chain" ] && echo "chain: $(cat "$STATE/chain")"
    ;;
  *)
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
