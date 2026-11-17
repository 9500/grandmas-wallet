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
#
# The pages are served from a copy of the build, made here, so that building again in the checkout changes
# nothing that is public until this script is run again. The copy before it is kept beside it. The stores
# run from the checkout and keep their data outside it.
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

unit() { # name, description, working directory, arguments...
  local name="$1" description="$2" directory="$3"; shift 3
  local command; command="$(quote "$NODE")"
  for argument in "$@"; do command+=" $(quote "$argument")"; done
  cat > "$UNITS/grandmas-wallet-$name.service" <<UNIT
[Unit]
Description=Grandma's Wallet: $description
After=network-online.target

[Service]
WorkingDirectory=$directory
ExecStart=$command
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
}

for app in wallet recoverer; do
  [ -f "$ROOT/apps/$app/dist/index.html" ] || { echo "apps/$app is not built: deploy/preview.sh build" >&2; exit 1; }
done
if [ -d "$ROOT/apps/jar/src" ] && [ -f "$ROOT/apps/jar/dist/index.html" ]; then JAR_ROOT=apps/jar/dist; else JAR_ROOT=deploy/placeholder/jar; fi

# The release: the built pages, the server and the configuration, with a record of what they were built from.
RELEASE="$DATA/release"
rm -rf "$RELEASE.new"
mkdir -p "$RELEASE.new"
cp -r "$ROOT/apps/wallet/dist" "$RELEASE.new/wallet"
cp -r "$ROOT/apps/recoverer/dist" "$RELEASE.new/recoverer"
cp -r "$ROOT/$JAR_ROOT" "$RELEASE.new/jar"
cp "$ROOT/deploy/serve.mjs" "$RELEASE.new/serve.mjs"
cp "$CONFIG" "$RELEASE.new/config.json"
(
  cd "$ROOT"
  printf '{"commit":"%s","branch":"%s","uncommittedChanges":%s,"releasedAt":"%s"}\n' \
    "$(git rev-parse --short HEAD)" "$(git rev-parse --abbrev-ref HEAD)" \
    "$([ -z "$(git status --porcelain)" ] && echo false || echo true)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
) > "$RELEASE.new/version.json"
rm -rf "$RELEASE.previous"
if [ -d "$RELEASE" ]; then mv "$RELEASE" "$RELEASE.previous"; fi
mv "$RELEASE.new" "$RELEASE"

page() { # name, description, port
  unit "$1" "$2" "$RELEASE" serve.mjs --root "$1" --config config.json --version version.json --host "$HOST" --port "$3"
}
page wallet "wallet page" 8101
page recoverer "recoverer page" 8102
page jar "savings jar application" 8103
NAMES=(wallet recoverer jar)
for number in $(seq 1 "$STORES"); do
  unit "store$number" "backup store $number" "$ROOT" --import tsx apps/archive-store/src/cli.ts \
    --port "$((8110 + number))" --host "$HOST" --directory "$DATA/store$number" --origin "$WALLET_ORIGIN" --origin "$RECOVERER_ORIGIN"
  NAMES+=("store$number")
done

systemctl --user daemon-reload
for name in "${NAMES[@]}"; do systemctl --user enable --quiet "grandmas-wallet-$name.service"; systemctl --user restart "grandmas-wallet-$name.service"; done
sleep 2
for name in "${NAMES[@]}"; do printf '%-10s %s\n' "$name" "$(systemctl --user is-active "grandmas-wallet-$name.service")"; done
echo "To keep the services running when nobody is logged in: sudo loginctl enable-linger $USER"
