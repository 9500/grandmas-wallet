#!/usr/bin/env bash
# Runs the web pages and the backup stores as services of the current user.
#
# usage: deploy/install-services.sh <address to listen on> [configuration file] [number of stores]
#   deploy/install-services.sh 192.168.88.112 deploy/config/production.json 2
#
# Each service listens on plain HTTP; a reverse proxy in front provides HTTPS. Ports:
#   8101 wallet, 8102 recoverer, 8103 savings jar application, 8104 loan page, 8105 landing page, 8106 Paryon's
#   service (on 127.0.0.1 only), 8111 and up backup stores. The landing page (deploy/landing) introduces the demonstration and links to the others; the
#   design overview (docs/design_v0.6.html) is served beside it as design.html, and the second design's overview, which it
#   links to, as design_v0.5.html.
# The loan page is an independent demonstration with Paryon's public contracts on chipnet; it is served when
# the configuration names an address for it (loanUrl) and it is built. On mainnet it says that it is off.
# With it runs Paryon's service (apps/paryon-service), which wallets reach at service/v1 on the loan page's host: the
# loan page's server forwards that path to it. It serves the networks the configuration offers that have a deployment
# of Paryon's, mainnet only with "mainnetEnabled": true, runs from the checkout like the stores and keeps nothing.
# A configuration for mainnet (deploy/config/mainnet.example.json) is installed only if it carries
# "mainnetEnabled": true; the services have the same names and ports as a chipnet installation and replace it.
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

# Mainnet only with the parameter that allows it. The services replace this user's others of the same names.
NETWORK="$("$NODE" -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(c.network === "mainnet" ? (c.mainnetEnabled === true ? "mainnet" : "refused") : c.network)' "$CONFIG")"
if [ "$NETWORK" = refused ]; then echo "$CONFIG names mainnet but does not allow it (\"mainnetEnabled\": true)" >&2; exit 2; fi
if [ "$NETWORK" = mainnet ]; then echo "MAINNET: enabled only to meet the requirements of BCH Blaze. Nothing here has been audited; coins can be lost. This project does not recommend enabling it."; fi
# A configuration of both networks (`networks`) offers mainnet on the pages only with the same parameter.
OFFERED="$("$NODE" -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(c.networks === undefined ? c.network : Object.keys(c.networks).filter((n) => n !== "mainnet" || c.mainnetEnabled === true).join(" "))' "$CONFIG")"
case " $OFFERED " in *" mainnet "*) [ "$NETWORK" = mainnet ] || echo "MAINNET offered on the pages beside $NETWORK: enabled only to meet the requirements of BCH Blaze. Nothing here has been audited; coins can be lost. This project does not recommend enabling it." ;; esac

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
LOAN="$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).loanUrl === undefined ? "no" : "yes")' "$CONFIG")"
if [ "$LOAN" = yes ] && [ ! -f "$ROOT/apps/loan/dist/index.html" ]; then echo "apps/loan is not built: deploy/preview.sh build" >&2; exit 1; fi

# The release: the built pages, the server and the configuration, with a record of what they were built from.
RELEASE="$DATA/release"
rm -rf "$RELEASE.new"
mkdir -p "$RELEASE.new"
cp -r "$ROOT/apps/wallet/dist" "$RELEASE.new/wallet"
cp -r "$ROOT/apps/recoverer/dist" "$RELEASE.new/recoverer"
cp -r "$ROOT/$JAR_ROOT" "$RELEASE.new/jar"
if [ "$LOAN" = yes ]; then cp -r "$ROOT/apps/loan/dist" "$RELEASE.new/loan"; fi
cp -r "$ROOT/deploy/landing" "$RELEASE.new/landing"
# The proxy in front lets browsers keep a stylesheet for hours, so the landing page names its stylesheet with a mark
# of the stylesheet's content: a changed stylesheet has a new address, and a visitor who was here before gets it at once.
STYLE_MARK="$(sha256sum "$ROOT/deploy/landing/landing.css" | cut -c1-12)"
sed -i "s|href=\"landing.css\"|href=\"landing.css?v=$STYLE_MARK\"|" "$RELEASE.new/landing/index.html"
# The overview of this design, and beside it under its own name the overview of the second design, which it links to.
cp "$ROOT/docs/design_v0.6.html" "$RELEASE.new/landing/design.html"
cp "$ROOT/docs/design_v0.5.html" "$RELEASE.new/landing/design_v0.5.html"
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

page() { # name, description, port, further arguments of the server...
  local name="$1" description="$2" port="$3"; shift 3
  unit "$name" "$description" "$RELEASE" serve.mjs --root "$name" --config config.json --version version.json --host "$HOST" --port "$port" "$@"
}
page wallet "wallet page" 8101
page recoverer "recoverer page" 8102
page jar "savings jar application" 8103
# The design overviews carry their styles and scripts in the page; the server is told that they are such documents.
page landing "landing page" 8105 --document design.html --document design_v0.5.html
NAMES=(wallet recoverer jar landing)
# The loan page reads the price General Protocols' oracle signs; that server is named for it alone. Its server passes
# /service/ to Paryon's service, which listens on this machine only.
if [ "$LOAN" = yes ]; then
  page loan "loan page" 8104 --connect https://oracles.generalprotocols.com --forward /service/=http://127.0.0.1:8106
  # The public address is behind Cloudflare, then the reverse proxy: the client's address is the one Cloudflare gives.
  unit paryon-service "Paryon's service" "$ROOT" --import tsx apps/paryon-service/src/cli.ts --config "$RELEASE/config.json" --host 127.0.0.1 --port 8106 --client-address-header cf-connecting-ip
  NAMES+=(loan paryon-service)
fi
for number in $(seq 1 "$STORES"); do
  unit "store$number" "backup store $number" "$ROOT" --import tsx apps/archive-store/src/cli.ts \
    --port "$((8110 + number))" --host "$HOST" --directory "$DATA/store$number" --origin "$WALLET_ORIGIN" --origin "$RECOVERER_ORIGIN"
  NAMES+=("store$number")
done

systemctl --user daemon-reload
for name in "${NAMES[@]}"; do systemctl --user enable --quiet "grandmas-wallet-$name.service"; systemctl --user restart "grandmas-wallet-$name.service"; done
sleep 2
for name in "${NAMES[@]}"; do printf '%-15s %s\n' "$name" "$(systemctl --user is-active "grandmas-wallet-$name.service")"; done
echo "To keep the services running when nobody is logged in: sudo loginctl enable-linger $USER"
