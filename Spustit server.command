#!/bin/bash
# Poklepáním spustí herní server Wingfighter. Poprvé nainstaluje závislosti a sestaví klienta.
# Po spuštění přijímá příkazy z příkazové řádky (r = restart, q = konec, h = nápověda).
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js není nainstalovaný. Stáhni ho z https://nodejs.org (verze 20+) a spusť znovu."
  read -n 1 -s -r -p "Stiskni libovolnou klávesu pro zavření…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "První spuštění – instaluji závislosti…"
  npm install || { echo "Instalace selhala."; read -n 1 -s -r; exit 1; }
fi

SERVER_PID=""

start_server() {
  echo "Sestavuji klienta…"
  if ! npm run build --silent; then
    echo "Sestavení klienta selhalo – server nespouštím. Oprav chybu a zadej r."
    return 1
  fi
  node --import tsx packages/server/src/index.ts &
  SERVER_PID=$!
  sleep 1
}

stop_server() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Zastavuji server…"
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  SERVER_PID=""
}

server_running() {
  [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null
}

show_help() {
  echo ""
  echo "  Příkazy:  r = restart (znovu sestaví klienta a spustí server)"
  echo "            i = npm install + restart (po změně závislostí)"
  echo "            p = git pull + restart"
  echo "            s = stav serveru        h = nápověda        q = ukončit"
  echo ""
}

trap 'echo; stop_server; exit 0' INT TERM

start_server
show_help

while true; do
  if ! read -r -p "wingfighter> " cmd; then
    # konec vstupu (zavřené okno) – ukončit
    stop_server
    exit 0
  fi
  case "$cmd" in
    r|restart)
      stop_server
      start_server
      ;;
    i|install)
      stop_server
      npm install && start_server
      ;;
    p|pull)
      stop_server
      git pull
      start_server
      ;;
    s|status)
      if server_running; then echo "Server běží (PID $SERVER_PID)."; else echo "Server neběží – zadej r."; fi
      ;;
    h|help|"?")
      show_help
      ;;
    q|quit|exit)
      stop_server
      exit 0
      ;;
    "")
      ;;
    *)
      echo "Neznámý příkaz „$cmd“ – h zobrazí nápovědu."
      ;;
  esac
done
