# Pruebas REALES sin depender de los probadores — investigación y plan (09-11-2026)

**Pregunta del dueño:** «Las pruebas reales las tengo limitadas porque las personas a quienes pasé la app casi nunca me
mandan el diagnóstico. ¿Hay forma de investigar cómo prueban las grandes compañías y los desarrolladores para cubrir más
situaciones reales con pruebas y simulaciones?»

**Respuesta corta:** sí, y hay tres caminos que se complementan. (1) Que el diagnóstico deje de depender del probador:
**diagnóstico automático** al desarrollador (hecho en la **2974**). (2) Un **laboratorio casero** con tus tres aparatos
conectados por USB a una computadora, con guiones que reproducen a voluntad lo que hoy solo pasa «cuando pasa» (app
cerrada, pantalla apagada, Doze, Bluetooth sin Wi-Fi). (3) **Emuladores Android con Bluetooth virtual** en la integración
continua, que es lo más nuevo y lo que más se parece a lo que hacen Google y Meta a escala. Lo que NO sirve: las nubes de
dispositivos reales (BrowserStack, Firebase Test Lab, AWS Device Farm), porque ninguna permite Bluetooth entre dos
dispositivos de la misma sesión.

Método: cuatro investigaciones en paralelo (emulación BLE, laboratorios de dispositivos y cómo prueban las grandes,
reproducción con ADB y reglas de Android/FCM/fabricantes, recolección de diagnósticos con privacidad), con fuentes
primarias donde la red del entorno las dejó leer; lo que viene de extractos o no se pudo confirmar está marcado.

## 1. Lo que se confirmó (y lo que no)

### 1a. Nubes de dispositivos reales: no sirven para NEXO
- **Ninguna** permite Bluetooth ENTRE dos dispositivos de la misma sesión. BrowserStack lo dice en su FAQ («Bluetooth
  está desactivado por seguridad y estabilidad»); Firebase Test Lab no lo soporta (un ingeniero del equipo, 2023; hay una
  petición abierta de BLE simulado); AWS Device Farm solo deja fijar el estado inicial de las radios; HeadSpin tiene
  Bluetooth de hardware propio para audio/llamadas, no entre teléfonos. Sauce Labs y Kobiton: sin confirmar.
- Sí sirven para OTRA cosa: ver la app en un modelo concreto. **Android Device Streaming** (desde Android Studio) presta
  teléfonos reales de Samsung, Xiaomi, OPPO, OnePlus, **vivo** y Transsion, 30 min/mes gratis y luego US$0,15/min, pero
  uno por sesión y sin Bluetooth entre ellos.
- Doze, pantalla apagada y cortar Wi-Fi: en todas se reduce a lo que se pueda hacer por `adb` dentro de la sesión.

### 1b. Cómo prueban las grandes y las apps P2P
- **Meta**: racks de 32 teléfonos en su centro de datos (~2000 teléfonos), `adb` por túneles para que parezcan locales,
  Sapienz sobre cientos de emuladores. **WhatsApp**: herramientas de software (selección de pruebas, Sapienz, Infer).
- **Google** (lo más útil): sus pruebas de conectividad entre DOS teléfonos reales usan **Mobly** (Python, código abierto,
  «especializado en casos que requieren varios dispositivos») con *snippets* Android para Bluetooth/GATT/BLE/Wi-Fi; las
  pruebas multi-dispositivo de CTS (Wi-Fi Direct, Aware, GATT) «solo corren en dispositivos físicos». BeToCQ mide
  descubrimiento, conexión y velocidad entre 2 teléfonos por USB.
- **Signal**: su integración continua corre en Linux sin dispositivos reales visibles. **Briar**: issues por modelo («no
  pudimos hacerlo fiable»). **bitchat-android** admite que «el comportamiento a nivel radio necesita dispositivos reales».
  **Berty, Bridgefy**: nada publicado. Es decir: **ninguna app P2P offline publica infraestructura de pruebas de campo.
  Están igual que NEXO.**

### 1c. Emuladores con Bluetooth virtual: FUNCIONA (con matices)
- El emulador de Android trae desde la versión **33.1.4** un controlador Bluetooth virtual (*netsim*, núcleo *rootcanal*).
  Todos los emuladores del mismo usuario comparten la radio virtual: **se ven y se conectan por BLE**. Google lo documenta
  oficialmente para emparejar un reloj emulado con un teléfono emulado. Un tercero verificó (emulador 37.1, Android 15):
  anunciar → escanear → conectar → descubrir → leer → notificaciones, todo OK.
- No probado todavía: L2CAP, escrituras sin respuesta, Linux con KVM. Limitaciones: la radio virtual es compartida (sin
  aislamiento por defecto), un periférico conectado deja de anunciar, la pila del invitado es inestable sin KVM, y
  rootcanal no modela el planificador ni la banda base (no sirve para medir velocidad real ni congestión).
- **Cuttlefish** (dispositivo virtual de AOSP, Linux+KVM): varias instancias comparten Wi-Fi y Bluetooth virtuales sin
  configurar nada. Más pesado (imágenes AOSP, sin Google Play).
- **Doze y buckets** se pueden forzar en el emulador oficialmente: `dumpsys deviceidle force-idle`, `am set-standby-bucket
  <pkg> restricted`. No confirmado en emulador: `am freeze`, pantalla apagada por `keyevent`.
- **Bumble** (Google, Python): un «par» programable que habla BLE contra UN emulador por netsim; permite inyectar fallos
  del otro lado (no contestar, cortar a mitad). Verificado en CI con KVM.
- **GitHub Actions** ya tiene KVM en los runners Linux (abril 2024) → emuladores acelerados en la integración continua.
- Lo que no: Waydroid/Anbox no tienen Bluetooth; un dongle USB por emulador no sirve para CI; Corellium es de pago (sin
  verificar).

### 1d. Reproducir en TUS teléfonos lo que vimos hoy (ADB, sin root)
- **Doze**: `dumpsys battery unplug` → `dumpsys deviceidle force-idle` → … → `dumpsys deviceidle unforce` →
  `dumpsys battery reset`. **Standby**: `am set-inactive <pkg> true`. **Buckets**: `am set-standby-bucket <pkg>
  rare|restricted`. **Restricción de fondo**: `cmd appops set <pkg> RUN_ANY_IN_BACKGROUND ignore|allow`.
- **Congelador** (Android 11+; en 14+ congela a los 10 s de pasar a *cached*): `am freeze [--sticky] <pid>` /
  `am unfreeze`; ver congelados con `dumpsys activity | grep -A20 "Apps frozen:"`. En qué versión entró `am freeze` no
  está confirmado: probar `adb shell am help | grep freeze` en el S24 y el vivo.
- **Pantalla**: `input keyevent 223` (apagar) / `224` (despertar). **Radios**: `svc bluetooth disable|enable`,
  `svc wifi disable|enable`, `cmd connectivity airplane-mode enable|disable`. **Matar**: `am force-stop <pkg>`.
- **FCM** (confirmado): desde Android 13 el sistema **degrada** la alta prioridad a las apps cuyos avisos de alta
  prioridad no terminan en una notificación visible; Firebase mira 7 días por instalación. El «despertador» de NEXO
  (data-only, alta prioridad, sin notificación visible) es justo ese patrón. El servicio nativo ya registra con qué
  prioridad llega cada despertar (`prio=…/…` en el registro nativo): hay que mirarlo en los próximos diagnósticos.
- **Fabricantes**: vivo → Inicio automático + «Consumo alto en segundo plano: no restringir» + candado en Recientes;
  Samsung → Batería → Límites de uso en segundo plano → «Nunca suspendidas». Hay intents comunitarios para abrir esas
  pantallas desde la app (vivo: `com.vivo.permissionmanager/.activity.BgStartUpManagerActivity`; Samsung tiene uno
  oficial, `com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY`).
- **Hallazgo clave sobre el «zombi»**: en AOSP puro un proceso con servicio en primer plano NO se congela. Si el nativo
  seguía aceptando escrituras GATT mientras el JavaScript no corría, lo congelado era probablemente el **renderer del
  WebView** (`com.nexo.app:sandboxed_process0`, un proceso aparte) o, como mostró el segundo diagnóstico del vivo, la app
  estaba directamente **cerrada** (`handleOnDestroy`) y el servicio nativo contestaba «IGNORE». Para verificarlo en el vivo:
  `adb shell dumpsys activity processes | grep -B2 -A2 sandboxed`.

### 1e. Cómo recogen diagnósticos las apps serias (privacidad)
- **Signal**: todo manual («Submit debug log» → gzip → enlace); redacta teléfonos, IDs e IPs; «vitals» semi-automático:
  si detecta un patrón de fallo, muestra un aviso que pide permiso para subir el log (máx. 1 por día). **Element**:
  agitar el teléfono → informe con confirmación; nunca proactivo. **Briar** (el más parecido a NEXO): tras un fallo,
  informe **cifrado a la clave pública del desarrollador**, guardado en disco y enviado por Tor cuando hay transporte;
  se borra al enviarse. **Telegram**: sin crash reporting en producción. **Crashlytics**: automático por defecto (y pasa
  por Google). **ACRA** (código abierto): silencioso por defecto, cola offline, «solo el primer informe de una excepción
  repetida».
- **Google Play (Data safety)**: un diagnóstico cifrado hacia el NEXO ID del desarrollador **lo lee el desarrollador**, así
  que al publicar en Play hay que declararlo (Crash logs + Diagnostics, opcional, cifrado en tránsito) y reflejarlo en
  la política de privacidad. Sin IDs de dispositivo (IMEI, Android ID).

## 2. El plan para NEXO (en orden de rendimiento por esfuerzo)

### Nivel 0 — ya hecho hoy: que el diagnóstico no dependa del probador (2974)
La app detecta el síntoma (enlace zombi, reintentos agotados, pendiente viejo con camino, error) y manda el diagnóstico
**cifrado de extremo a extremo al NEXO ID del dueño** como mensaje oculto, con límites (uno cada 2 h, 3 por día, mismo
síntoma una vez al día), interruptor en Perfil y bandeja «Diagnósticos recibidos» con «Copiar los nuevos». Nada sale a un
servicio externo (el repositorio es público; el diagnóstico lleva IDs y direcciones de terceros). Detalle: `ESTADO.md`
(2974) y `src/ui/autodiag.js`. Pendiente del dueño: encendido por defecto (mi recomendación para estas builds de prueba)
o apagado con pregunta única; y declararlo en Play cuando toque.

### Nivel 1 — laboratorio casero con tus 3 aparatos (una tarde de armado, uso diario)
1. Un **hub USB alimentado** (USB 2.0, 7 puertos, 60 W; los laboratorios evitan los hubs USB 3.0 por desconexiones),
   cables buenos, una laptop con `adb` y Python.
2. En los tres: depuración USB, `settings put global stay_on_while_plugged_in 7`, bloqueo de pantalla deshabilitado
   (`locksettings set-disabled true`) y los ajustes de batería como los vaya a usar un usuario real.
3. `pip install mobly` + instalar `mobly-bundled-snippets` en cada teléfono; un *testbed* con los tres números de serie
   (S24 = A, vivo = B, tablet = T).
4. En NEXO: que el diagnóstico pueda **escribirse a un archivo** y regenerarse con un `am broadcast` (hoy solo copia al
   portapapeles) para que el guion lo recoja con `adb pull`. Es un cambio chico.
5. Guiones que reproducen lo de hoy, con aserciones leyendo `logcat` y el diagnóstico de cada teléfono:
   - «Zombi»: A manda una foto a B; a los 2 s, B `am force-stop com.nexo.app` (o `am freeze` si existe) → en A debe salir
     «sin respuesta a 2 pings: desconectado para reconectar» en < 90 s; B vuelve → la foto llega.
   - «APK grande por Bluetooth»: con un archivo > 5 MB pendiente y sin Wi-Fi/internet, mover la app de A al frente y
     atrás 10 veces → ninguna línea «leyendo lento (adjunto)» nueva.
   - «Receptor dormido»: B con pantalla apagada + `deviceidle force-idle` → A manda texto → medir cuánto tarda el toque
     FCM y con qué prioridad llega (`prio=` en el registro nativo de B).
   - Variantes: `svc wifi disable` en B (solo Bluetooth), `svc bluetooth disable` en A (fuerza internet), ambos sin
     internet (`airplane-mode` + Bluetooth encendido).
6. `scrcpy -s <serie>` ×3 en pantalla para mirar; cada corrida guarda `logcat` + diagnóstico en `tests/real/<fecha>/`.
7. Correr el guion antes de cada build nocturna; cuando falle, reproducir en `tests/sim` como pide el método del repo.

### Nivel 2 — emuladores con Bluetooth virtual en la integración continua (una o dos semanas, por fases)
- **Fase 1**: un emulador Android 14/15 (google_apis x86_64) en GitHub Actions con KVM + un par **Bumble** en Python
  sobre netsim. Cubre anunciar, escanear, GATT, notificaciones, y permite que el «otro» falle a propósito (no contestar,
  cortar a mitad): justo lo que el simulador jsdom no modela.
- **Fase 2**: dos emuladores en el mismo netsim con la APK real en ambos, dirigidos por `adb`/Espresso; captura HCI
  (`--pcap`) como diagnóstico; `--rssi` y `netsim move` para alcance.
- **Fase 3**: en uno, `force-idle` + `set-standby-bucket restricted` para «app cerrada / pantalla apagada».
- Antes de automatizar, validar a mano lo no probado: L2CAP, escrituras sin respuesta, Telecom/audio. Wi-Fi local entre
  emuladores vía netsim: no investigado.
- Límite honesto: rootcanal no modela velocidad ni congestión de radio. Para eso sigue haciendo falta el nivel 1.

### Lo que no haría
- Pagar una nube de dispositivos para probar NEXO entre teléfonos: no tienen Bluetooth entre dispositivos.
- Mandar diagnósticos a Crashlytics o similares: pasan por Google y el modelo de NEXO es sin servidor y sin terceros.

## 3. Siguientes pasos concretos
1. Probar la 2974 en tus teléfonos (§A.27 de `docs/PRUEBAS_FISICAS_PENDIENTES_2026-11-08.md`).
2. En el vivo: `adb shell am help | grep freeze` y `adb shell dumpsys activity processes | grep -B2 -A2 sandboxed` para
   confirmar qué se congela.
3. Si querés el nivel 1, decime y armo: el cambio en NEXO (diagnóstico a archivo + broadcast), el testbed Mobly y los
   tres guiones de arriba, listos para correr con tus seriales.
4. El nivel 2 lo dejaría para después de la Fase E (archivos grandes nativos), salvo que prefieras priorizarlo.

## 4. Fuentes principales
Android: developer.android.com (doze-standby, behavior-changes-all 13, emulator-networking-advanced,
android-device-streaming, test-bluetooth-audio, collect-share), source.android.com (cached-apps-freezer, binder-freezer,
cuttlefish/connectivity, tests/mobly); código AOSP (ActivityManagerShellCommand, DeviceIdleController, OomAdjuster).
Google: github.com/google/mobly, mobly-bundled-snippets, bumble (docs/platforms/android.md), android/betocq,
msft-mirror-aosp/platform.tools.netsim. Meta: engineering.fb.com (mobile-device-lab 2016, one-world 2017, sapienz 2018).
Nubes: browserstack.com FAQ Bluetooth, firebase usage-quotas-pricing, docs.aws.amazon.com devicefarm. Apps:
signalapp/Signal-Android (Scrubber.kt, VitalsViewModel.kt, SubmitDebugLogRepository.java), briar/briar
(DevReporterImpl.java), element-hq/element-android (BugReporter.kt), matrix-org/rageshake, ACRA/acra, DrKLO/Telegram
(FileLog.java), permissionlesstech/bitchat-android. Fabricantes: dontkillmyapp.com (vivo, samsung),
developer.samsung.com app-management. CI: github.blog (KVM en Actions, 04-2024). Verificaciones de terceros:
github.com/kaeawc/auto-mobile issues 14265 y 17555, jappeace/hatter (ble-emulator-simulation.md).
