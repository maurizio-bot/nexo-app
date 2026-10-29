# NEXO — Repositorios de GitHub que pueden ayudar (investigación 29-10-2026)

El dueño pidió investigar qué hay en GitHub que pueda **mejorar NEXO**. NEXO ya implementa mucho propio (cripto Double
Ratchet/X3DH, relés tipo Nostr, Tor nativo, BLE, llamadas, FCM «despertador»), así que esta lista NO es para rehacer lo
que ya funciona, sino para: **(a)** reforzar áreas débiles con librerías ya probadas, **(b)** alternativas sin Google, y
**(c)** referencia/validación de arquitectura.

**Nota de licencias (importante para un producto comercial):**
- **Permisiva** (MIT / Apache‑2.0 / BSD) → se puede **usar en la app** (incluso de pago), citando la licencia.
- **Copyleft** (GPL / **AGPL**) → **solo estudiar**, NO copiar su código dentro de una app cerrada (AGPL además obliga a
  publicar el código si se ofrece como servicio de red). Útiles como referencia, no como dependencia.
- Siempre confirmar el archivo `LICENSE` de la versión exacta antes de integrar.

---

## 1. Despertar sin Google — alternativa a FCM (#87 / #117)
Encaja con la filosofía de NEXO (sin depender de Google) y daría un 2.º camino de «toque» para teléfonos sin Servicios
de Google (GrapheneOS, etc.) o para quien no quiera FCM.
- **UnifiedPush** (estándar abierto, `unifiedpush.org`) — push descentralizado sin FCM. Necesita un «distribuidor» en el
  teléfono y soporte dentro de NEXO. Sin equivalente en iOS (límite de Apple).
- **ntfy** (`binwiederhier/ntfy`, **Apache‑2.0/GPLv2**, ~30k★, muy activo) — servidor de push **autohospedable** que
  funciona como servidor UnifiedPush. El dueño podría autohospedarlo (como el `push-sender` de FCM).
- **Encaje:** alto. Aditivo, no rompe FCM. iOS sigue necesitando servidor central (igual que FCM).

## 2. Bluetooth más robusto (#87: no_service, MTU bajo, reconexión)
Es el área nativa más dolorosa (los diagnósticos del dueño mostraban martilleo GATT). Estas librerías manejan colas,
reintentos y estados de conexión mucho mejor que el BLE «a mano».
- **Nordic Android‑BLE‑Library** (`NordicSemiconductor/Android-BLE-Library`, **BSD‑3**) — el estándar de la industria para
  BLE robusto en Android (cola de operaciones, reconexión, MTU). Muy probada.
- **RxAndroidBle** (`dariuszseweryn/RxAndroidBle`, **Apache‑2.0**, 3.5k★, activo) — alternativa con RxJava.
- **Encaje:** medio‑alto, pero es cirugía en el plugin nativo (`NexoBlePlugin.kt`); se haría por partes y con mucha
  prueba. Vale la pena estudiarlas para copiar su **patrón** de cola/reconexión aunque no se adopte entera.

## 3. Llamadas por internet (#99) — atravesar el NAT (TURN/STUN)
El dueño ya intuyó que haría falta «un servidor TURN». Estos lo dan, autohospedable (NEXO no deja de ser P2P: el TURN
solo reenvía cuando no hay conexión directa).
- **coturn** (`coturn/coturn`, **BSD‑3**, ~12k★) — el servidor TURN/STUN más usado, muy probado.
- **pion/turn** (`pion/turn`, **MIT**, 2.27k★, muy activo) — TURN en Go, fácil de desplegar; de la familia Pion (WebRTC en
  Go), por si algún día se quiere un puente de llamadas propio.
- **Encaje:** medio. Necesita que el dueño levante un servidor pequeño (como el push‑sender). Desbloquea las llamadas
  entre contactos que solo se ven por internet.

## 4. Audio sin eco ni ruido (#93)
NEXO ya tiene `voicefx` (puerta de ruido), pero el eco/realimentación de verdad se resuelve con estos módulos probados.
- **WebRTC Audio Processing Module (APM)** (**BSD‑3** + patente) — el estándar: cancelación de eco (AEC), supresión de
  ruido y control de ganancia. Lo que usan casi todas las apps de llamadas.
- **RNNoise** (`xiph/rnnoise`, **BSD‑3**) — supresión de ruido por red neuronal (hay versión WASM; podría correr en el
  WebView). 
- **SpeexDSP** (`xiph/speexdsp`, **BSD‑3**) — AEC + ruido + remuestreo clásico, ligero.
- **Encaje:** medio. Todas permisivas. El AEC del WebRTC APM es lo que más subiría la calidad de llamada.

## 5. Tor más robusto (capa de internet anónima)
NEXO ya tiene `TorOnion.kt`; estas librerías mantenidas podrían reforzarlo o reemplazarlo.
- **kmp‑tor** (`05nelsonm/kmp-tor`, **Apache‑2.0**, activo) — embebe Tor en apps Kotlin Multiplatform (Android/iOS), con
  binarios incluidos. La más madura.
- **ArtiTor** (`yet300/ArtiTor`, **Apache‑2.0**) — envoltorio sobre **Arti** (el Tor nuevo en Rust); joven pero moderno.
- **Encaje:** bajo‑medio (lo de NEXO ya funciona), pero útil para iOS (#107) y para no mantener binarios de Tor a mano.

## 6. Referencia de arquitectura — ESTUDIAR, no copiar (licencias copyleft)
- **SimpleX Chat** (`simplex-chat/simplex-chat`, **AGPL‑3.0**, 19.6k★, muy activo) + **simplexmq** — hace EXACTAMENTE el
  «modelo B» de NEXO para el #87: un **servicio en primer plano** que recibe con la app cerrada **sin Google**, y relés
  (SMP) que guardan el mensaje un tiempo. **Valida el camino de NEXO** y es la mejor fuente para pulir el segundo plano.
- **Briar** (`briarproject`, **GPL**, en **modo mantenimiento** desde jul‑2026) — su equipo reconoció que el 100 %
  sin‑servidor chocó con **batería y segundo plano poco fiable en Android** (justo el muro del #87). Lección: el enfoque
  híbrido de NEXO (relés + FCM + BLE) va por mejor camino. Su **Briar Mailbox** (app compañera que recibe cuando estás
  desconectado) se parece a la idea del buzón/Fénix de NEXO.
- **libsignal** (`signalapp/libsignal`, **AGPL‑3.0**) — Double Ratchet + X3DH + **Kyber (post‑cuántico)**. NEXO ya tiene lo
  suyo; sirve de **referencia** para la campaña de seguridad final (#112) y la migración post‑cuántica (PQXDH).

## 7. Capa de relés (Nostr) — opcional
- **rust‑nostr** (`rust-nostr/nostr`, **MIT**, activo, API en alpha) — protocolo/relés/cliente Nostr. NEXO usa una versión
  propia; serviría para **validar/alinear** el protocolo de relés si se quiere. Alpha → la API aún cambia.

---

## Recomendación (orden sugerido, de más útil a menos)
1. **UnifiedPush + ntfy** (#87/#117): camino de despertar sin Google; aditivo y alineado con la filosofía. Permisivo.
2. **Patrón de BLE de Nordic/RxAndroidBle** (#87): estudiar y, por partes, endurecer el BLE nativo (lo que más falla).
3. **coturn / pion‑turn** (#99): desbloquea llamadas por internet (el dueño ya lo preveía). Necesita servidor.
4. **WebRTC APM / RNNoise / SpeexDSP** (#93): subir la calidad de audio (eco).
5. **Estudiar SimpleX** para pulir la entrega con app cerrada; **libsignal** para el post‑cuántico (#112).

Todo lo permisivo (MIT/Apache/BSD) se puede integrar en NEXO; lo AGPL/GPL (SimpleX, Briar, libsignal) es **solo para
aprender**, no para copiar al código. Confirmar `LICENSE` antes de depender de cualquiera.

## Fuentes
- ntfy / UnifiedPush: https://github.com/binwiederhier/ntfy · https://f-droid.org/en/2022/12/18/unifiedpush.html · https://docs.ntfy.sh/subscribe/phone/
- SimpleX: https://github.com/simplex-chat/simplex-chat · https://simplex.chat/blog/20220404-simplex-chat-instant-notifications.html
- Briar (mantenimiento): https://f-droid.org/packages/org.briarproject.briar.android/
- TURN: https://github.com/coturn/coturn · https://github.com/pion/turn
- Audio: https://github.com/xiph/rnnoise · https://en.wikipedia.org/wiki/Speex
- Tor: https://github.com/05nelsonm/kmp-tor · https://klibs.io/project/yet300/ArtiTor
- BLE: https://github.com/NordicSemiconductor/Android-BLE-Library · https://github.com/dariuszseweryn/RxAndroidBle
- Cripto: https://github.com/signalapp/libsignal
- Nostr: https://github.com/rust-nostr/nostr
