# NEXO en iPhone (iOS) — plan

Pedido del dueño (27-10): «hay que empezar con lo de iOS»; primera meta elegida: **que la app CORRA en un iPhone**.

## 1. Qué se reusa y qué hay que reescribir
- **Interfaz (gratis):** todo `src/` es web dentro de Capacitor (chats, Estados, cámara, buscador, cobros, perfil…). En iOS corre casi igual.
- **Nativo (hay que reescribir en Swift):** el plugin `nexo-ble` es solo Kotlin (Android). En iOS hay que crear `plugins/nexo-ble/ios/` con un plugin Swift que responda a los MISMOS métodos que llama el JS (`initialize`, `startScan`, `sendMessage`, `saveToFile`/`loadFromFile`, `biometricAuth`/`biometricStatus`, `saveToGallery`, net/relé, etc.). Al principio, lo que iOS no permita se deja como *stub* que resuelve sin romper la app.

## 2. Límites de iOS que condicionan el diseño (no se pueden saltar)
- **Bluetooth:** iOS **no deja anunciar «manufacturer data»**, que es donde NEXO pone el NEXO ID para descubrirse (Android). En iPhone hay que **rediseñar el descubrimiento**: anunciar solo el UUID de servicio y exponer el NEXO ID en una **característica GATT legible**, y que el que escanea la lea. Interoperar **Android↔iPhone por BT** obliga a este rediseño en los dos lados → es lo más difícil, va en una fase posterior.
- **Wi-Fi Direct: no existe en iOS.** Alternativa futura: MultipeerConnectivity (solo iOS↔iOS, no interopera con Android). Para iPhone↔Android queda **Wi-Fi/LAN (misma red)** e **internet (relés/Tor)**.
- **Segundo plano / app cerrada:** iOS es muy restrictivo. Recibir con la app cerrada necesita **push de Apple (APNs) = un servidor**. Fase posterior.
- **Face ID:** fácil y de verdad fuerte (`LocalAuthentication`). El bloqueo de la app (#103) mapea directo.
- **Permisos:** `Info.plist` necesita textos de uso (Bluetooth, red local, cámara, micrófono, fotos…).

## 3. Cómo construir SIN comprar Mac
iOS solo se compila con Xcode (solo macOS). Opciones:
- **A. CI con runner macOS (GitHub Actions) — RECOMENDADA.** El mismo flujo que arma la APK arma la de iPhone en una Mac de la nube. **Compilar es gratis y no necesita cuenta** → sirve para verificar el Swift (como el CI ya compila el Kotlin). Sin comprar nada.
- **B. Mac en la nube alquilada** (~20–60 USD/mes): control remoto a una Mac real; para iterar rápido a mano.
- **C. Mac mini física** (1 vez).
- **Emulador local en Windows/Linux: NO es opción** (el Simulador es de Xcode/macOS; una VM de macOS va contra las reglas de Apple y no firma/despliega bien).

**El iPhone del dueño** sirve como **dispositivo de PRUEBA**, no para compilar.

## 4. Lo único obligatorio para instalarla en el iPhone
- **Cuenta Apple Developer (99 USD/año)** + **TestFlight**: con eso el CI firma la app y al dueño le llega por un **link** (sin Mac, sin cable). El compile-check previo NO necesita la cuenta.
- Modelo de trabajo = igual que hoy: **el CI compila, el dueño prueba en su teléfono**.

## 5. Fases
- **Fase 0 — base (sin Mac ni cuenta, se hace ya):** `docs/IOS_PROPUESTA.md` (esto); `npx cap add ios` (scaffold); workflow de CI en runner macOS que **compile** el iOS (verificación); esqueleto del plugin Swift (métodos que llama el JS, con lo que funciona real y el resto en stub); `Info.plist` con permisos.
- **Fase 1 — «corre en iPhone» (meta del dueño):** interfaz + **internet (relés/Tor)** + **Wi-Fi/LAN** + **Face ID**; Bluetooth en stub. Instalable por TestFlight cuando exista la cuenta Apple.
- **Fase 2 — Bluetooth:** descubrimiento rediseñado (NEXO ID en característica GATT), GATT server/client, L2CAP; interoperar con Android.
- **Fase 3 — segundo plano/app cerrada:** APNs (servidor) + lo que iOS permita.

## 6. Qué necesito del dueño
1. Decidir la vía de compilación (recomiendo **A: CI macOS**, sin comprar Mac).
2. Para instalar en el iPhone: **cuenta Apple Developer (99 USD/año)** cuando quieras llegar a TestFlight. El trabajo base y el compile-check en CI arrancan sin eso.

## 7. Nota de método
Desde el entorno actual (Linux) **no se puede compilar ni probar iOS**; la verificación del Swift la hará el **CI macOS** (como el CI compila hoy el Kotlin), y la prueba real la hace el dueño en su iPhone. Mientras tanto, **nada de esto toca ni rompe la app de Android** (la APK sigue igual).
