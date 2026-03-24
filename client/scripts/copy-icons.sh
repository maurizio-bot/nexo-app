#!/bin/bash

# Script para copiar íconos al proyecto Android
# Ubicación: client/scripts/copy-icons.sh

cd "$(dirname "$0")/.."

echo "📁 Creando carpetas de recursos..."
mkdir -p android/app/src/main/res/mipmap-mdpi
mkdir -p android/app/src/main/res/mipmap-hdpi
mkdir -p android/app/src/main/res/mipmap-xhdpi
mkdir -p android/app/src/main/res/mipmap-xxhdpi
mkdir -p android/app/src/main/res/mipmap-xxxhdpi

echo "🎨 Copiando logo a todas las densidades..."
cp assets/logo.png android/app/src/main/res/mipmap-mdpi/ic_launcher.png
cp assets/logo.png android/app/src/main/res/mipmap-hdpi/ic_launcher.png
cp assets/logo.png android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
cp assets/logo.png android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
cp assets/logo.png android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png

echo "✅ Íconos copiados correctamente"

