#!/usr/bin/env bash
# Runs the web pages and the backup stores as services of the current user.
#
# usage: deploy/install-services.sh <address to listen on> [configuration file] [number of stores]
#   deploy/install-services.sh 192.168.88.112 deploy/config/production.json 2
#
# Each service listens on plain HTTP; a reverse proxy in front provides HTTPS. Ports:
#   8101 wallet, 8102 recoverer, 8103 savings jar application, 8111 and up backup stores.
# The pages must have been built first: deploy/preview.sh build
# Where an application of this design is not built yet, a page saying so is served in its place.
set -euo pipefail

HOST="${1:?address to listen on}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$(realpath "${2:-$ROOT/deploy/config/production.json}")"
STORES="${3:-2}"
NODE="$(command -v node)"
UNITS="$HOME/.config/systemd/user"
DATA="${GRANDMAS_WALLET_DATA:-$HOME/.local/share/grandmas-wallet}"
mkdir -p "$UNITS" "$DATA"

# The stores answer browser requests only from the wallet and the recoverer pages.
read -r WALLET_ORIGIN RECOVERER_ORIGIN < <("$NODE" -e '
  const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log(new URL(config.walletUrl).origin, new URL(config.recovererUrl).origin);
' "$CONFIG")

# systemd reads a quoted argument literally except for these characters.
quote() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g; s/\$/$$/g')"; }

unit() { # name, description, arguments...
  local name="$1" description="$2"; shift 2
  local command; command="$(quote "$NODE")"
  for argument in "$@"; do command+=" $(quote "$argument")"; done
  cat > "$UNITS/grandmas-wallet-$name.service" <<UNIT
[Unit]
Description=Grandma's Wallet: $description
After=network-online.target

[Service]
WorkingDirectory=$ROOT
ExecStart=$command
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
}

unit wallet "wallet page" deploy/serve.mjs --root apps/wallet/dist --config "$CONFIG" --host "$HOST" --port 8101
unit recoverer "recoverer page" deploy/serve.mjs --root apps/recoverer/dist --config "$CONFIG" --host "$HOST" --port 8102
if [ -d "$ROOT/apps/jar/src" ] && [ -f "$ROOT/apps/jar/dist/index.html" ]; then JAR_ROOT=apps/jar/dist; else JAR_ROOT=deploy/placeholder/jar; fi
unit jar "savings jar application" deploy/serve.mjs --root "$JAR_ROOT" --config "$CONFIG" --host "$HOST" --port 8103
NAMES=(wallet recoverer jar)
for number in $(seq 1 "$STORES"); do
  unit "store$number" "backup store $number" --import tsx apps/archive-store/src/cli.ts \
    --port "$((8110 + number))" --host "$HOST" --directory "$DATA/store$number" --origin "$WALLET_ORIGIN" --origin "$RECOVERER_ORIGIN"
  NAMES+=("store$number")
done

systemctl --user daemon-reload
for name in "${NAMES[@]}"; do systemctl --user enable --quiet "grandmas-wallet-$name.service"; systemctl --user restart "grandmas-wallet-$name.service"; done
sleep 2
for name in "${NAMES[@]}"; do printf '%-10s %s\n' "$name" "$(systemctl --user is-active "grandmas-wallet-$name.service")"; done
echo "To keep the services running when nobody is logged in: sudo loginctl enable-linger $USER"
