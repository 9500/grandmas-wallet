#!/usr/bin/env bash
# The mockup network: a public sandbox chain on which the demonstration's flows can be tried with play coins and
# without waiting. A Bitcoin Cash node in regtest mode, Fulcrum in front of it, and the mockup service
# (deploy/mockup/service.ts), which is the chain's only miner, the owner of its clock and the source of play coins.
# See docs/mockup.md.
#
# usage: deploy/mockup/mockup.sh <command>
#   setup               write the configuration (the programs are those of deploy/regtest/regtest.sh setup)
#   services [checkout] run all three as services of the current user, started at boot; the service runs from
#                       the checkout given (default: the one this script is in)
#   start               start all three (through the services if they are installed)
#   stop                stop all three
#   status              what is running, the tip of the chain and the service's own answer
#   reset               stop, delete the chain, Fulcrum's index and the service's state, start again from block 0
#                       (the treasury's key is kept)
#   cli ...             bitcoin-cli against the node, e.g.  cli getblockcount
#   run-node ...        run the node in the foreground, its clock set to the chain's (what the node's service runs)
#   unservice           remove the services
#
# Everything lives outside the repository, in $MOCKUP_DIR (default ~/.local/share/grandmas-wallet/mockup). The node
# answers on this machine only (RPC 18453); Fulcrum's TCP port is local (60411) and its WebSocket listens on
# $MOCKUP_HOST:8121, the service on $MOCKUP_HOST:8122 (default 192.168.88.112), for the reverse proxy.
set -euo pipefail

DIR="${MOCKUP_DIR:-$HOME/.local/share/grandmas-wallet/mockup}"
PROGRAMS="${REGTEST_DIR:-$HOME/.local/share/grandmas-wallet/regtest}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT="$(cd "$HERE/../.." && pwd)"
UNITS="$HOME/.config/systemd/user"
HOST="${MOCKUP_HOST:-192.168.88.112}"
# The pages that may call the service from a browser; any http://localhost:<port> may as well.
ORIGINS="${MOCKUP_ORIGINS:-https://wallet.9500.cash https://recoverer.9500.cash https://jar.9500.cash https://paryon.9500.cash}"
# Where the service is published: the address PUSD's registry is published under on the chain.
PUBLIC_URL="${MOCKUP_PUBLIC_URL:-https://mockup-api.9500.cash}"

RPC_PORT=18453; ZMQ_PORT=28452; TCP_PORT=60411; WS_PORT=8121; SERVICE_PORT=8122
BITCOIND="$PROGRAMS/bitcoin-cash-node-29.2.0/bin/bitcoind"
BITCOIN_CLI="$PROGRAMS/bitcoin-cash-node-29.2.0/bin/bitcoin-cli"
FULCRUM="$PROGRAMS/Fulcrum-2.1.4-x86_64-linux/Fulcrum"
NODE_UNIT=grandmas-wallet-mockup-node.service
FULCRUM_UNIT=grandmas-wallet-mockup-fulcrum.service
SERVICE_UNIT=grandmas-wallet-mockup-service.service

cli() { "$BITCOIN_CLI" -datadir="$DIR/node" "$@"; }
have_units() { [ -f "$UNITS/$NODE_UNIT" ] && [ -f "$UNITS/$FULCRUM_UNIT" ] && [ -f "$UNITS/$SERVICE_UNIT" ]; }
node_up() { cli getblockcount > /dev/null 2>&1; }
# Without the services, Fulcrum and the service are started here and their process ids kept beside their data.
pid_of() { local file="$DIR/$1.pid"; [ -f "$file" ] && kill -0 "$(cat "$file")" 2> /dev/null && cat "$file" || true; }

render() { # template, destination, password
  sed -e "s|@DIR@|$DIR|g" -e "s|@PASSWORD@|$3|g" -e "s|@RPC_PORT@|$RPC_PORT|g" -e "s|@ZMQ_PORT@|$ZMQ_PORT|g" \
      -e "s|@TCP_PORT@|$TCP_PORT|g" -e "s|@WS_HOST@|$HOST|g" -e "s|@WS_PORT@|$WS_PORT|g" "$1" > "$2"
  chmod 600 "$2"
}

setup() {
  [ -x "$BITCOIND" ] && [ -x "$FULCRUM" ] || { echo "The programs are not in $PROGRAMS: run deploy/regtest/regtest.sh setup first." >&2; exit 1; }
  mkdir -p "$DIR/node" "$DIR/fulcrum" "$DIR/service"
  chmod 700 "$DIR" "$DIR/service"
  local password
  password="$(sed -n 's/^rpcpassword=//p' "$DIR/node/bitcoin.conf" 2> /dev/null || true)"
  [ -n "$password" ] || password="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')"
  render "$HERE/bitcoin.conf.template" "$DIR/node/bitcoin.conf" "$password"
  render "$HERE/fulcrum.conf.template" "$DIR/fulcrum/fulcrum.conf" "$password"
  echo "Set up in $DIR"
}

# A node refuses to start when its last block is more than two hours ahead of its clock, which the chain's is after a
# skip: the node starts with its clock at real time plus what the service has skipped. The service sets it from then on.
run_node() {
  local skipped args=()
  skipped="$(sed -n 's/^ *"skipped": *\([0-9]*\).*/\1/p' "$DIR/service/state.json" 2> /dev/null || true)"
  if [ -n "$skipped" ] && [ "$skipped" != 0 ]; then args=("-mocktime=$(($(date +%s) + skipped))"); fi
  exec "$BITCOIND" -datadir="$DIR/node" "${args[@]}" "$@"
}

# The service's command line, as words.
service_command() { # checkout
  printf '%s\n' "$(command -v node)" --import tsx "$1/deploy/mockup/service.ts" --host "$HOST" --port "$SERVICE_PORT" \
    --data "$DIR" --rpc "127.0.0.1:$RPC_PORT" --public-url "$PUBLIC_URL"
  for origin in $ORIGINS; do printf '%s\n' --origin "$origin"; done
}

wait_for() { # what, test command...
  local what="$1"; shift
  for _ in $(seq 1 120); do "$@" && return 0; sleep 0.5; done
  echo "$what did not answer." >&2; return 1
}
port_open() { (exec 3<> "/dev/tcp/$1/$2") 2> /dev/null; }

start() {
  [ -f "$DIR/node/bitcoin.conf" ] || { echo "Run 'setup' first." >&2; exit 1; }
  if have_units; then
    systemctl --user start "$NODE_UNIT" "$SERVICE_UNIT" "$FULCRUM_UNIT"
  else
    node_up || "$HERE/mockup.sh" run-node -daemon > /dev/null
    wait_for "The node (port $RPC_PORT)" node_up
    if [ -z "$(pid_of service)" ]; then
      local words=(); mapfile -t words < <(service_command "$CHECKOUT")
      (cd "$CHECKOUT" && nohup "${words[@]}" >> "$DIR/service/service.log" 2>&1 & echo $! > "$DIR/service.pid")
    fi
    if [ -z "$(pid_of fulcrum)" ]; then
      (nohup "$FULCRUM" "$DIR/fulcrum/fulcrum.conf" >> "$DIR/fulcrum/fulcrum.log" 2>&1 & echo $! > "$DIR/fulcrum.pid")
    fi
  fi
  wait_for "The node (port $RPC_PORT)" node_up
  # On a new chain the service mines the treasury first; Fulcrum starts indexing once the chain has a recent block.
  wait_for "The service (port $SERVICE_PORT)" port_open "$HOST" "$SERVICE_PORT"
  wait_for "Fulcrum (port $TCP_PORT; see the service's journal or $DIR/fulcrum/fulcrum.log)" port_open 127.0.0.1 "$TCP_PORT"
  status
}

stop() {
  if have_units; then
    systemctl --user stop "$SERVICE_UNIT" "$FULCRUM_UNIT" "$NODE_UNIT"
  else
    local pid
    for name in service fulcrum; do
      pid="$(pid_of "$name")"
      if [ -n "$pid" ]; then kill "$pid"; for _ in $(seq 1 60); do kill -0 "$pid" 2> /dev/null || break; sleep 0.5; done; fi
      rm -f "$DIR/$name.pid"
    done
    if node_up; then
      cli stop > /dev/null
      for _ in $(seq 1 60); do [ -f "$DIR/node/regtest/bitcoind.pid" ] || break; sleep 0.5; done
    fi
  fi
  echo "Stopped."
}

status() {
  if node_up; then
    echo "node: running, block $(cli getblockcount), median time $(date -u -d "@$(cli getblockchaininfo | sed -n 's/.*"mediantime": \([0-9]*\).*/\1/p')" +%FT%TZ)"
  else
    echo "node: not running"
  fi
  if port_open 127.0.0.1 "$TCP_PORT"; then echo "fulcrum: running, tcp://127.0.0.1:$TCP_PORT ws://$HOST:$WS_PORT"; else echo "fulcrum: not running"; fi
  if port_open "$HOST" "$SERVICE_PORT"; then
    echo "service: running, http://$HOST:$SERVICE_PORT"
    curl -sS --max-time 5 "http://$HOST:$SERVICE_PORT/status" && echo
  else
    echo "service: not running"
  fi
  if have_units; then echo "services: installed"; else echo "services: not installed"; fi
}

reset() {
  stop
  # The treasury's key (service/treasury.json) is kept: the same key mines the new chain.
  rm -rf "$DIR/node/regtest" "$DIR/fulcrum/data" "$DIR/service/state.json" "$DIR/service/paryon.json"
  start
}

# systemd reads a quoted argument literally except for these characters.
quote() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g; s/\$/$$/g')"; }

unit() { # file, description, command, extra [Unit] lines, extra [Service] lines
  cat > "$UNITS/$1" <<UNIT
[Unit]
Description=Grandma's Wallet: $2
$4

[Service]
ExecStart=$3
Restart=on-failure
RestartSec=3
$5

[Install]
WantedBy=default.target
UNIT
}

services() {
  local checkout; checkout="$(cd "${1:-$CHECKOUT}" && pwd)"
  [ -f "$checkout/deploy/mockup/service.ts" ] || { echo "No deploy/mockup/service.ts in $checkout" >&2; exit 1; }
  [ -f "$DIR/node/bitcoin.conf" ] || setup
  have_units || stop > /dev/null 2>&1 || true
  mkdir -p "$UNITS"
  local words=() command=""; mapfile -t words < <(service_command "$checkout")
  for word in "${words[@]}"; do command+="${command:+ }$(quote "$word")"; done
  unit "$NODE_UNIT" "mockup network node (Bitcoin Cash Node, regtest)" "$(quote "$checkout/deploy/mockup/mockup.sh") run-node -daemon=0" "" "Environment=$(quote "MOCKUP_DIR=$DIR") $(quote "REGTEST_DIR=$PROGRAMS")"
  unit "$FULCRUM_UNIT" "Fulcrum on the mockup network" "\"$FULCRUM\" \"$DIR/fulcrum/fulcrum.conf\"" "After=$NODE_UNIT
Requires=$NODE_UNIT" ""
  unit "$SERVICE_UNIT" "mockup network service (miner, clock, play coins)" "$command" "After=$NODE_UNIT network-online.target
Wants=$NODE_UNIT" "WorkingDirectory=$checkout"
  systemctl --user daemon-reload
  systemctl --user enable --quiet "$NODE_UNIT" "$FULCRUM_UNIT" "$SERVICE_UNIT"
  # A service already running picks up a changed command line.
  systemctl --user restart "$SERVICE_UNIT"
  start
}

unservice() {
  have_units && systemctl --user disable --now --quiet "$SERVICE_UNIT" "$FULCRUM_UNIT" "$NODE_UNIT" || true
  rm -f "$UNITS/$NODE_UNIT" "$UNITS/$FULCRUM_UNIT" "$UNITS/$SERVICE_UNIT"
  systemctl --user daemon-reload
  echo "Services removed."
}

case "${1:-}" in
  setup) setup ;;
  services) shift; services "$@" ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  reset) reset ;;
  cli) shift; cli "$@" ;;
  run-node) shift; run_node "$@" ;;
  unservice) unservice ;;
  *) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
