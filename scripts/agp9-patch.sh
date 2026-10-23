#!/usr/bin/env bash
# Los módulos Android de Capacitor 5 (node_modules) se escribieron para AGP 8. Con AGP 9 se ajusta lo que ya no se
# admite, sin cambiar lo que hace la app (la reducción de código está apagada en todos):
#  - getDefaultProguardFile('proguard-android.txt') → 'proguard-android-optimize.txt'
#  - lintOptions { } → lint { }
# Se ejecuta en el workflow después de "npm install".
set -euo pipefail
cd "$(dirname "$0")/.."
for f in $(find node_modules/@capacitor node_modules/@capacitor-community -path '*/android/*' -name build.gradle 2>/dev/null); do
  sed -i -e "s/proguard-android\.txt/proguard-android-optimize.txt/g" -e "s/^\(\s*\)lintOptions\s*{/\1lint {/" "$f"
  echo "parcheado: $f"
done
