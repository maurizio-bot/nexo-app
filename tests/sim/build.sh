#!/usr/bin/env bash
# Compila el bundle web de una versión (git ref o "wip" = árbol de trabajo) en tests/sim/builds/<nombre>.
# Uso: tests/sim/build.sh [ref]     (por defecto: wip)
set -euo pipefail
REF="${1:-wip}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
OUT="$ROOT/tests/sim/builds/$REF"
DEPS="$ROOT/tests/sim/.deps"
rm -rf "$OUT"; mkdir -p "$OUT"
if [ "$REF" = "wip" ]; then
  cp -r "$ROOT/src" "$ROOT/index.html" "$ROOT/webpack.config.js" "$ROOT/package.json" "$OUT/"
else
  git -C "$ROOT" archive "$REF" src index.html webpack.config.js package.json | tar -x -C "$OUT"
fi
# node_modules del repo está incompleto (falta webpack-cli): se instalan aparte una sola vez
if [ ! -d "$DEPS/node_modules/webpack-cli" ]; then
  mkdir -p "$DEPS"; cp "$ROOT/package.json" "$ROOT/package-lock.json" "$DEPS/"
  (cd "$DEPS" && npm install --no-audit --no-fund >/dev/null)
fi
ln -s "$DEPS/node_modules" "$OUT/node_modules"
(cd "$OUT" && npx webpack --mode development --devtool false | tail -1)
echo "$OUT"
