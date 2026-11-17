#!/usr/bin/env bash
# A local Bitcoin Cash node in regtest mode with Fulcrum in front of it, for
# rehearsing chain runs before they go to chipnet (IMPLEMENTATION_PLAN, "Where
# tests run"). Blocks are made on demand and the test sets the clock.
#
# usage: deploy/regtest/regtest.sh <command>
#   setup      download the pinned releases, check them, unpack, write the configuration
#   services   run both as services of the current user, started at boot
#   start      start both (through the services if they are installed)
#   stop       stop both
#   status     what is running, and the tip of the chain
#   reset      stop, delete the chain and Fulcrum's index, start again from block 0
#   cli ...    bitcoin-cli against the node, e.g.  cli getblockcount
#   unservice  remove the services
#
# Everything lives outside the repository, in $REGTEST_DIR
# (default ~/.local/share/grandmas-wallet/regtest). Both programs listen on
# this machine only: node RPC 18443, Fulcrum TCP 60401 and WebSocket 60403.
set -euo pipefail

DIR="${REGTEST_DIR:-$HOME/.local/share/grandmas-wallet/regtest}"
HERE="$(cd "$(dirname "$0")" && pwd)"
UNITS="$HOME/.config/systemd/user"

NODE_VERSION=29.2.0
NODE_TARBALL="bitcoin-cash-node-$NODE_VERSION-x86_64-linux-gnu.tar.gz"
NODE_URL="https://github.com/bitcoin-cash-node/bitcoin-cash-node/releases/download/v$NODE_VERSION/$NODE_TARBALL"
# As downloaded on 17 November 2026. No published list was found to compare it with.
NODE_SHA256=23bbe9ff749136a9b832a2a59023ce76a5391322c1ea2f4f24b5b91f035081bc
FULCRUM_VERSION=2.1.4
FULCRUM_TARBALL="Fulcrum-$FULCRUM_VERSION-x86_64-linux.tar.gz"
FULCRUM_URL="https://github.com/cculianu/Fulcrum/releases/download/v$FULCRUM_VERSION/$FULCRUM_TARBALL"
# From the release's own list, Fulcrum-2.1.4-shasums.txt.
FULCRUM_SHA256=faf7cb36266c1694c834ad551d9592c0aef357bca66fdb5efdfe0d131c4b38ae

RPC_PORT=18443; ZMQ_PORT=28442; TCP_PORT=60401; WS_PORT=60403
# The address of the key that the trials under spikes/ mine to (a private key of 32 bytes 0x08).
FIRST_BLOCK_TO=bchreg:qqw0au6hr2k4hutpwn5a8xfg45d9w9nkjvd2qjeplc
BITCOIND="$DIR/bitcoin-cash-node-$NODE_VERSION/bin/bitcoind"
BITCOIN_CLI="$DIR/bitcoin-cash-node-$NODE_VERSION/bin/bitcoin-cli"
FULCRUM="$DIR/Fulcrum-$FULCRUM_VERSION-x86_64-linux/Fulcrum"
NODE_UNIT=grandmas-wallet-regtest-node.service
FULCRUM_UNIT=grandmas-wallet-regtest-fulcrum.service

cli() { "$BITCOIN_CLI" -datadir="$DIR/node" "$@"; }
have_units() { [ -f "$UNITS/$NODE_UNIT" ] && [ -f "$UNITS/$FULCRUM_UNIT" ]; }
node_up() { cli getblockcount > /dev/null 2>&1; }
fulcrum_pid() { pgrep -u "$(id -u)" -f "Fulcrum $DIR/fulcrum/fulcrum.conf" || true; }

fetch() { # url, file, sha256
  [ -f "$DIR/dl/$2" ] || curl -sSL --fail -o "$DIR/dl/$2" "$1"
  echo "$3  $DIR/dl/$2" | sha256sum --check --quiet
}

render() { # template, destination, password
  sed -e "s|@DIR@|$DIR|g" -e "s|@PASSWORD@|$3|g" -e "s|@RPC_PORT@|$RPC_PORT|g" -e "s|@ZMQ_PORT@|$ZMQ_PORT|g" \
      -e "s|@TCP_PORT@|$TCP_PORT|g" -e "s|@WS_PORT@|$WS_PORT|g" "$1" > "$2"
  chmod 600 "$2"
}

setup() {
  mkdir -p "$DIR/dl" "$DIR/node" "$DIR/fulcrum"
  fetch "$NODE_URL" "$NODE_TARBALL" "$NODE_SHA256"
  fetch "$FULCRUM_URL" "$FULCRUM_TARBALL" "$FULCRUM_SHA256"
  [ -x "$BITCOIND" ] || tar xzf "$DIR/dl/$NODE_TARBALL" -C "$DIR"
  [ -x "$FULCRUM" ] || tar xzf "$DIR/dl/$FULCRUM_TARBALL" -C "$DIR"
  # One password for both files, kept if a configuration exists already.
  local password
  password="$(sed -n 's/^rpcpassword=//p' "$DIR/node/bitcoin.conf" 2> /dev/null || true)"
  [ -n "$password" ] || password="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')"
  render "$HERE/bitcoin.conf.template" "$DIR/node/bitcoin.conf" "$password"
  render "$HERE/fulcrum.conf.template" "$DIR/fulcrum/fulcrum.conf" "$password"
  echo "Set up in $DIR"
}

wait_for_node() {
  for _ in $(seq 1 60); do node_up && return 0; sleep 0.5; done
  echo "The node did not answer on port $RPC_PORT." >&2; return 1
}

wait_for_fulcrum() {
  for _ in $(seq 1 60); do (exec 3<> "/dev/tcp/127.0.0.1/$TCP_PORT") 2> /dev/null && return 0; sleep 0.5; done
  echo "Fulcrum did not open port $TCP_PORT; see $DIR/fulcrum/fulcrum.log or the service's journal." >&2; return 1
}

start() {
  [ -f "$DIR/node/bitcoin.conf" ] || { echo "Run 'setup' first." >&2; exit 1; }
  if have_units; then
    systemctl --user start "$NODE_UNIT" "$FULCRUM_UNIT"
    wait_for_node
  else
    node_up || "$BITCOIND" -datadir="$DIR/node" -daemon > /dev/null
    wait_for_node
    [ -n "$(fulcrum_pid)" ] || (nohup "$FULCRUM" "$DIR/fulcrum/fulcrum.conf" > "$DIR/fulcrum/fulcrum.log" 2>&1 &)
  fi
  # A chain without a recent block counts as still downloading, and Fulcrum waits for it.
  # One block, paid to the trials' mining key, ends that.
  [ "$(cli getblockcount)" != 0 ] || cli generatetoaddress 1 "$FIRST_BLOCK_TO" > /dev/null
  wait_for_fulcrum
  status
}

stop() {
  if have_units; then
    systemctl --user stop "$FULCRUM_UNIT" "$NODE_UNIT"
  else
    local pid; pid="$(fulcrum_pid)"
    [ -z "$pid" ] || kill $pid
    node_up && cli stop > /dev/null
    for _ in $(seq 1 60); do pgrep -u "$(id -u)" -f "bitcoind -datadir=$DIR/node( |\$)" > /dev/null || break; sleep 0.5; done
  fi
  echo "Stopped."
}

status() {
  if node_up; then
    echo "node: running, block $(cli getblockcount), median time $(date -u -d "@$(cli getblockchaininfo | sed -n 's/.*"mediantime": \([0-9]*\).*/\1/p')" +%FT%TZ)"
  else
    echo "node: not running"
  fi
  if [ -n "$(fulcrum_pid)" ]; then echo "fulcrum: running, tcp://127.0.0.1:$TCP_PORT ws://127.0.0.1:$WS_PORT"; else echo "fulcrum: not running"; fi
  if have_units; then echo "services: installed"; else echo "services: not installed"; fi
}

reset() {
  stop
  rm -rf "$DIR/node/regtest" "$DIR/fulcrum/data"
  start
}

unit() { # file, description, command, extra lines
  cat > "$UNITS/$1" <<UNIT
[Unit]
Description=Grandma's Wallet: $2
$4

[Service]
ExecStart=$3
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
UNIT
}

services() {
  [ -f "$DIR/node/bitcoin.conf" ] || setup
  have_units || stop > /dev/null 2>&1 || true
  mkdir -p "$UNITS"
  unit "$NODE_UNIT" "local test node (Bitcoin Cash Node, regtest)" "\"$BITCOIND\" \"-datadir=$DIR/node\" -daemon=0" ""
  unit "$FULCRUM_UNIT" "Fulcrum on the local test node" "\"$FULCRUM\" \"$DIR/fulcrum/fulcrum.conf\"" "After=$NODE_UNIT
Requires=$NODE_UNIT"
  systemctl --user daemon-reload
  systemctl --user enable --quiet "$NODE_UNIT" "$FULCRUM_UNIT"
  start
}

unservice() {
  have_units && systemctl --user disable --now --quiet "$FULCRUM_UNIT" "$NODE_UNIT" || true
  rm -f "$UNITS/$NODE_UNIT" "$UNITS/$FULCRUM_UNIT"
  systemctl --user daemon-reload
  echo "Services removed."
}

case "${1:-}" in
  setup) setup ;;
  services) services ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  reset) reset ;;
  cli) shift; cli "$@" ;;
  unservice) unservice ;;
  *) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
