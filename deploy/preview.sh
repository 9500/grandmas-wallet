#!/usr/bin/env bash
# The wallet page, the recoverer page and the Savings Jar page of this checkout, with two backup stores of
# their own, on this machine only. For looking at the pages by hand before anything public changes: the
# public sites and their stores are not touched, and the preview's stores keep their data in a directory
# of their own.
#
# usage: deploy/preview.sh <command>
#   build           build the three pages (with the local fix for the engine's header check on chipnet applied
#                   while building, and taken out again afterwards)
#   start local     serve the pages for the local node (regtest); a block is made every 15 seconds
#   start chipnet   serve the pages for chipnet
#   stop            stop everything the preview started
#   status          what is running
#
# The pages listen on 127.0.0.1: wallet 8101, recoverer 8102, Savings Jar 8103, backup stores 8111 and 8112.
# From another computer, forward those ports (and 60403, the local node's server, for `local`) and open
# http://localhost:8101, http://localhost:8102 and http://localhost:8103. A page at localhost counts as
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
    "$NODE" spikes/xo-engine/patches/chipnet-faster-blocks.mjs
    trap '"$NODE" spikes/xo-engine/patches/chipnet-faster-blocks.mjs --revert' EXIT
    for app in wallet recoverer jar; do (cd "apps/$app" && npx vite build); done
    ;;
  start)
    case "${2:-}" in
      local) CONFIG="deploy/config/local-regtest.json" ;;
      chipnet) CONFIG="deploy/config/local.json" ;;
      *) echo "usage: deploy/preview.sh start <local|chipnet>" >&2; exit 2 ;;
    esac
    for app in wallet recoverer jar; do
      [ -f "apps/$app/dist/index.html" ] || { echo "apps/$app is not built: deploy/preview.sh build" >&2; exit 1; }
    done
    for number in 1 2; do
      launch "store$number" "$NODE" --import tsx apps/archive-store/src/cli.ts --port "$((8110 + number))" --host 127.0.0.1 \
        --directory "$STATE/store$number" --origin http://localhost:8101 --origin http://localhost:8102
    done
    launch wallet "$NODE" deploy/serve.mjs --root apps/wallet/dist --config "$CONFIG" --host 127.0.0.1 --port 8101
    launch recoverer "$NODE" deploy/serve.mjs --root apps/recoverer/dist --config "$CONFIG" --host 127.0.0.1 --port 8102
    launch jar "$NODE" deploy/serve.mjs --root apps/jar/dist --config "$CONFIG" --host 127.0.0.1 --port 8103
    if [ "$2" = local ]; then
      # Blocks come by themselves, as on a public network, only sooner.
      launch blocks bash -c "cd '$ROOT' && while true; do npx tsx scripts/local-pay.ts mine 1 > /dev/null; sleep 15; done"
    fi
    echo "$2" > "$STATE/chain"
    echo "wallet: http://localhost:8101   recoverer: http://localhost:8102   jar: http://localhost:8103   (chain: $2)"
    ;;
  stop)
    for name in wallet recoverer jar store1 store2 blocks; do
      if running "$name"; then
        # The whole group: a loop and what it started.
        kill -- "-$(cat "$STATE/$name.pid")" 2>/dev/null || kill "$(cat "$STATE/$name.pid")" 2>/dev/null || true
        echo "stopped $name"
      fi
      rm -f "$STATE/$name.pid"
    done
    ;;
  status)
    for name in wallet recoverer jar store1 store2 blocks; do
      if running "$name"; then echo "$name: running"; else echo "$name: not running"; fi
    done
    [ -f "$STATE/chain" ] && echo "chain: $(cat "$STATE/chain")"
    ;;
  *)
    sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
