#!/bin/bash
# Poklepáním spustí herní server SpaceGame. Poprvé nainstaluje závislosti a sestaví klienta.
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

echo "Sestavuji klienta a spouštím server…"
npm start
