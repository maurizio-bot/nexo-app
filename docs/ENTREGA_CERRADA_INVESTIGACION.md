# NEXO — Entrega con la app CERRADA: cómo lo hace la competencia y qué le falta a NEXO

Investigación pedida por el dueño (26-10-2026). Objetivo: entender cómo la competencia logra que lleguen
**mensajes** (con aviso) y **llamadas/videollamadas** (que suenen a pantalla completa) cuando el teléfono que
**recibe tiene la app cerrada (deslizada) y la pantalla apagada** — lo que hoy en NEXO sigue abierto (bug #87) y
lo que el dueño exige "igual que WhatsApp".

Este documento es **solo investigación**: no toca código. Todo lo afirmado lleva su fuente (URL). Lo que no pude
verificar en fuente oficial queda marcado como "no confirmado".

---

## 0. Resumen en una frase (lo más importante)

**No existe un tercer truco mágico.** Para que un teléfono con la app cerrada reciba algo, solo hay dos caminos:

- **(A) Un PUSH por un servidor/puente** (FCM en Android, APNs en iPhone, o UnifiedPush): *alguien* con un servidor
  siempre encendido conoce tu "token" de dispositivo, vigila si hay algo para ti, y manda un aviso de **alta prioridad**
  por el carril de push del sistema operativo. El sistema despierta tu app aunque esté cerrada y en Doze. **Requiere
  un servidor/puente que conozca tu token.** (WhatsApp, Signal-Play, Telegram, Messenger, Amethyst).
- **(B) Una CONEXIÓN VIVA en el propio teléfono**: la app mantiene un socket abierto 24/7 dentro de un **servicio en
  primer plano** (con aviso permanente), con **exención de batería** y, en Wi-Fi, un **WifiLock** para que Doze no
  mate el socket. **No necesita servidor de push.** (Signal sin Google Play, Molly-FOSS, Briar, Pokey… y **el NetBg de
  NEXO**).

Todo lo demás son variantes de estos dos. Las apps de **malla Bluetooth** (Bridgefy en modo difusión) son un tercer
grupo solo en apariencia: **no entregan con la app cerrada**, funcionan únicamente en primer plano.

**NEXO ya está en el camino (B)** — su NetBg es exactamente lo mismo que hacen Signal-sin-Google, Briar y Pokey. El
problema #87 no es que falte "la pieza secreta": es que la conexión viva (B) todavía no es lo bastante robusta para
sobrevivir a Doze y a los ahorradores de batería de cada marca.

---

## 1. Tabla: cada app → mecanismo exacto (mensajes y llamadas) con la app cerrada

| App | Mensajes con app cerrada | Llamadas con app cerrada | ¿Servidor / push? |
|---|---|---|---|
| **WhatsApp** | PUSH FCM de **alta prioridad** despierta la app; el aviso lo muestra la app o Google Play Services | PUSH FCM alta prioridad → la app usa Telecom/ConnectionService + **full-screen intent/CallStyle** y suena a pantalla completa | **Sí**: servidores de WhatsApp + FCM |
| **Signal (build de Google Play)** | PUSH FCM alta prioridad, normalmente **sin contenido** ("despierta y baja el mensaje"); la app descarga el mensaje cifrado del servidor | PUSH FCM alta prioridad → suena (full-screen) | **Sí**: servidor Signal + FCM |
| **Signal SIN Google Play (modo websocket) / Molly-FOSS** | **Servicio en primer plano + websocket persistente** al servidor Signal + **exención de batería**. Sin ella: solo llegan al abrir la app | Igual, por el **websocket vivo** | Servidor Signal, **SIN FCM**; la conexión vive en el teléfono (B) |
| **Telegram** | Su propia conexión (MTProto) + PUSH FCM de aviso; el contenido se baja | PUSH alta prioridad → pantalla de llamada | **Sí**: servidores Telegram + FCM |
| **Messenger (Meta)** | PUSH FCM alta prioridad | PUSH FCM → Telecom/full-screen | **Sí** |
| **Briar** | **Servicio en primer plano 24/7 + Tor + exención de batería**; o un **Briar Mailbox** (otro dispositivo propio, siempre encendido) que guarda tus mensajes mientras estás offline | **No tiene llamadas** | **SIN servidor central, SIN FCM**; conexión viva (B). La batería alta es su problema conocido (pasó a "modo mantenimiento") |
| **SimpleX Chat** | Modo "siempre activo": **servicio en segundo plano persistente** con conexión a los servidores de colas; o modo periódico (ahorra batería, avisos tardíos). En iOS, push por su propio servidor | Con el servicio vivo, las llamadas suenan; con VPN o tras mucho rato en Doze, **a veces no despierta** | Servidores de colas SimpleX; el modo instantáneo = conexión viva + exención (B) |
| **Jami** | DHT propio + **push opcional** vía un *DHT proxy* + *push relay* (FCM o UnifiedPush; para SIP usa RFC 8599 con el token en la cabecera `Contact`). Sin push: servicio en segundo plano | Llamadas por push; hay reportes de que **tras mucho rato dormido NO timbra**, y de que un *force-stop* o el antispam de Xiaomi lo bloquean | Puente de push (opcional) **o** conexión viva (B) |
| **Session** | Red de nodos (*swarm*) que **almacenan** tus mensajes; el cliente los baja. Avisos por su **propio servidor de push** (enrutado tipo onion) | Mensajería sobre todo | *Swarm* + servidor de push propio (ofuscado) |
| **Bridgefy (malla BLE)** | **Solo en primer plano**: al salir de la app deja de recibir | — | Sin servidor; **NO entrega con la app cerrada** |
| **Berty** | Malla BLE + relés; depende de servicio en segundo plano (no encontré fuente clara de su comportamiento cerrado) | — | Conexión viva (B); sin confirmar |
| **Amethyst (Nostr, build Play)** | **Servidor de push que VIGILA los relés** por ti + FCM; los eventos van envueltos en **GiftWrap (NIP-59)** para que Google **no pueda ligar token ↔ clave pública** | — (Nostr no hace llamadas) | **Sí**: su servidor de push + FCM |
| **Amethyst (build FOSS)** | **UnifiedPush** (distribuidor *ntfy* en el teléfono) + GiftWrap | — | Puente que vigila relés → UnifiedPush; el distribuidor (ntfy) mantiene la conexión viva (B) |
| **Pokey (Nostr)** | App que **se conecta a TUS relés de inbox y mantiene la conexión abierta todo el tiempo** (= modelo B, en el teléfono) | — | **SIN servidor**: conexión viva (B) |

Fuentes: FCM alta prioridad / Doze
([Firebase: message priority](https://firebase.google.com/docs/cloud-messaging/android/message-priority),
[Firebase: About FCM messages](https://firebase.google.com/docs/cloud-messaging/concept-options),
[Firebase blog 2025: FCM on Android](https://firebase.blog/posts/2025/04/fcm-on-android));
Signal sin Google Play / Molly
([GrapheneOS: Molly-FOSS battery](https://discuss.grapheneos.org/d/1211-molly-foss-battery-drain),
[GrapheneOS: battery with/without GPS](https://discuss.grapheneos.org/d/6349-battery-life-with-and-without-gpsgsf-google-signal-app/14));
Briar ([F-Droid: Briar](https://f-droid.org/en/packages/org.briarproject.briar.android/),
[F-Droid: Briar Mailbox](https://f-droid.org/en/packages/org.briarproject.mailbox/index.html),
[Briar en modo mantenimiento](https://zeli.app/story/48919869));
SimpleX ([SimpleX: instant notifications](https://forgejo.multed.com/android-apps-mirrors/SimpleX-Chat/src/commit/43adb7de82cf33dcbb551542af1f53d8c6404313/blog/20220404-simplex-chat-instant-notifications.md),
[GrapheneOS: SimpleX y VPN/Doze](https://discuss.grapheneos.org/d/28632-delayed-notificarions-and-sometimes-no-notifications-at-all/22));
Jami ([forum.jami.net: por qué el push no reinicia Jami](https://forum.jami.net/t/why-does-not-push-restart-jami/1975),
[forum.jami.net: no timbra tras dormir](https://forum.jami.net/t/jami-not-ringing-on-android-after-a-certain-time-asleep/1544));
Bridgefy ([SCMP: prueba de Bridgefy](https://amp.scmp.com/abacus/culture/article/3026527/we-tested-messaging-app-used-hong-kong-protesters-works-without),
[docs.bridgefy.me: Android SDK](https://docs.bridgefy.me/sdk/android), [Sacra: control del SO amenaza la malla](https://sacra.com/chat/h/2f1a6a36-524c-42a4-afe6-a4103dc80d79/));
Amethyst ([Amethyst v0.80.1: FOSS push](https://www.nobsbitcoin.com/amethyst-v0-80-1/),
[Amethyst v0.76.0: GiftWrapped push](https://nobsbitcoin.com/amethyst-v0-76-0)).

### ¿Qué datos van en el push?
La tendencia en apps privadas es **"despierta y busca"**: el push no lleva el contenido del mensaje, solo un aviso
(o incluso solo el id del evento) para que la app se despierte, se conecte y baje el mensaje cifrado. Así el servidor
de push (Google/Apple) no ve de qué hablas. Es el patrón de Matrix/UnifiedPush ("wake-up call" con solo ids) y el que
usan las apps cifradas. Firebase incluso **recomienda al revés** (meter el contenido en el push para que se muestre
sin abrir conexión), pero eso expone el contenido al carril de push, así que las apps privadas no lo usan.
Fuentes: [UnifiedPush FAQ](https://unifiedpush.org/users/faq/),
[F-Droid: UnifiedPush](https://f-droid.org/2022/12/18/unifiedpush.html),
[Firebase: message priority](https://firebase.google.com/docs/cloud-messaging/android/message-priority).

---

## 2. El patrón claro (A) vs (B), sin adornos

**(A) PUSH por servidor/puente.** Para que un push llegue hace falta, sí o sí, un **servidor siempre encendido** que:
1) conozca tu **token** de dispositivo, 2) sepa (o descubra) que hay algo para ti, y 3) mande el aviso por FCM/APNs/
UnifiedPush. En apps centralizadas ese servidor es el de la empresa. En apps Nostr (Amethyst, Damus, Pokey-servidor)
ese servidor es **un "puente" que se suscribe a los relés** en tu nombre y, al ver un evento tuyo, dispara el push. Un
desarrollador de Nos lo resume: *"las notificaciones necesitan un servidor; o un bot que rastrea los relés, o un push
silencioso que le dice a la app que arranque y mire los relés… lo primero necesita un servicio en la nube corriendo"*
([nostr.at](https://nostr.at/nevent1qqsq8rw3s5ehdv07yyg9ur27e32d4698tles2u8x4nyz6yp8l7sjl9qn6kv7j)).

**(B) CONEXIÓN VIVA en el teléfono.** La app no delega en nadie: mantiene ella misma un socket abierto dentro de un
servicio en primer plano, con exención de batería. Signal sin Google Play lo hace con un websocket a su servidor; Briar
con Tor; Pokey con los relés Nostr. El autor de Pokey lo dice explícito: *"Pokey se conecta a tus relés de inbox y
mantiene la conexión abierta en todo momento"*, en contraste con *"el enfoque habitual, donde un servidor vigila los
relés y envía los eventos por Google/Apple/UnifiedPush"*
([nostr.at](https://nostr.at/nevent1qqszjeacgu6f7cevtcdr4wdc2yuysjyl55gzlj9yuvhl9y9u7uqw2ag49wekx)).

**La consecuencia para NEXO:** o **hay un push-server** (alguien con un servidor que conoce tu token y vigila los
relés por ti), **o hay una conexión viva** (tu NetBg). No hay una tercera opción. UnifiedPush **no** es esa tercera
opción (ver §4): solo cambia *quién* mantiene la conexión viva o *qué* servidor manda el push.

---

## 3. Mecánica de Android (resumen práctico, para decidir)

- **FCM alta prioridad vs normal + Doze.** La alta prioridad intenta entregar **de inmediato** y puede **despertar un
  teléfono dormido**; Google nombra chat y avisos de llamada como su caso típico. La prioridad normal se difiere hasta
  que el teléfono sale de Doze. Ojo: si tus pushes de alta prioridad **no** producen avisos visibles, FCM puede
  **degradarte** a prioridad normal (mira 7 días de comportamiento). Google Play Services puede **mostrar el aviso sin
  arrancar la app**.
  ([Firebase: message priority](https://firebase.google.com/docs/cloud-messaging/android/message-priority),
  [Firebase: concept-options](https://firebase.google.com/docs/cloud-messaging/concept-options)).
- **Servicios en primer plano (Android 14+).** Hay que **declarar un tipo** en el manifiesto y su permiso; si no, al
  llamar `startForeground()` salta `MissingForegroundServiceTypeException`. Tipos nuevos: `health`, **`remoteMessaging`**,
  `shortService`, `specialUse`, `systemExempted` (además de `dataSync`, `connectedDevice`, etc.). Lo que no encaje,
  Google empuja a WorkManager. **El NetBg de NEXO encaja en `remoteMessaging` / `connectedDevice` / `dataSync` /
  `specialUse`.**
  ([Android: tipos de FGS obligatorios](https://developer.android.com/about/versions/14/changes/fgs-types-required),
  [Google Play: FGS y full-screen intent](https://support.google.com/googleplay/android-developer/answer/13392821)).
- **WorkManager periódico.** Mínimo **15 minutos** de intervalo, y Doze puede retrasarlo más. Sirve como **red de
  seguridad** (bajar el buzón cada ~15 min), **no** para entrega instantánea ni para hacer sonar una llamada.
  ([Android: PeriodicWorkRequest](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest)).
- **Llamada entrante a pantalla completa con la app cerrada.** Dos piezas:
  - **Full-screen intent.** Desde Android 14 (en vigor el **22-ene-2025** para apps con target 14+), el permiso
    `USE_FULL_SCREEN_INTENT` **solo se concede por defecto a apps de llamada o alarma**; las demás deben pedirlo al
    usuario. Comprobar con `NotificationManager.canUseFullScreenIntent()` y, si falta, abrir
    `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`. **NEXO es app de llamada**, así que califica (ya se pide en #81/2784).
    ([Google Play: FGS y full-screen intent](https://support.google.com/googleplay/android-developer/answer/13392821),
    [proandroiddev: FSI en Android 14/15](https://proandroiddev.com/full-screen-intent-fsi-notifications-in-android-14-15-what-changed-why-its-breaking-and-e5e862a75936)).
  - **CallStyle + ConnectionService.** La plantilla **CallStyle** existe desde Android 12 y da prioridad alta en la
    bandeja; con `setOngoing(true)` (Android 14) el aviso no se puede descartar. Si usas un **ConnectionService
    auto-gestionado**, Telecom **NO** toca el tono ni pone el aviso por ti: llama a `onShowIncomingCallUi()` y **tú**
    pones tu aviso full-screen con su tono; al Contestar/Rechazar debes informar a Telecom con `Connection.setActive()`
    o `setDisconnected()`.
    ([Android: CallStyle](https://developer.android.com/develop/ui/views/notifications/call-style),
    [Android: ConnectionService](https://developer.android.com/reference/android/telecom/ConnectionService),
    [Voximplant: ConnectionService](https://voximplant.com/docs/guides/sdk/connectionservice)).
  - NEXO ya metió **CallStyle de verdad** en la 2785 (#1) y el permiso full-screen en la 2784 (#81). Lo que falta es
    que **el nativo dispare esa pantalla al ver una llamada entrante con la app cerrada** (ver §4).
- **Exención de batería + WifiLock + ahorradores de marca.** La exención ("ignorar optimización de batería") es
  imprescindible para mantener el socket vivo en Doze; el **WifiLock** evita que la radio Wi-Fi se duerma con la
  pantalla apagada (NEXO ya lo añadió en 2785). Aun así, los **ahorradores de Xiaomi/Samsung/Huawei** pueden matar el
  servicio: es el punto más frágil de **(B)** y el motivo de que Signal/Briar insistan tanto en que el usuario ponga la
  app en "Sin restricciones". El dueño ya comprobó que con batería "Sin restricciones" **las llamadas sí entran** →
  confirma que el cuello de botella es la salud del servicio, no el carril de push.

---

## 4. Qué le falta a NEXO EXACTAMENTE (en orden de impacto y realismo)

Punto de partida clave: **NetBg ya ES el modelo (B)**, el mismo que Pokey/Signal-sin-Google/Briar. NEXO no necesita
"descubrir" nada nuevo; necesita **endurecer (B)** y, opcionalmente, decidir si añade un push (A).

### 4.1 Lo que SÍ se puede hacer ya, sin servidor ni decisión del dueño

1. **Robustez de NetBg (ataca directamente el #87).** El servicio en primer plano con el tipo correcto de Android 14
   (`remoteMessaging`/`connectedDevice`/`dataSync`/`specialUse`), `START_STICKY`, reinicio en `onTaskRemoved`, receptor
   de `BOOT_COMPLETED`, y un **websocket a los relés con reconexión (backoff), ping keepalive y re-auth NIP-42** al
   reconectar. La lección de Signal/Briar: *servicio en primer plano + socket + exención ≈ FCM, pero el SO/OEM aún lo
   mata de vez en cuando → el servicio debe resucitarse solo*. Esto es puro nativo y **no se reproduce en el
   simulador** (por eso hace falta el diagnóstico nativo de los dos teléfonos, ya preparado en 2785).

2. **Guía de batería por marca (estilo Briar).** Detectar fabricante y llevar al usuario al ajuste exacto
   ("Sin restricciones" en Samsung, "Sin restricciones" + autoarranque en MIUI, etc.). Es lo que más sube la
   fiabilidad real de (B) en teléfonos baratos/viejos.

3. **Llamada entrante con la app cerrada — SIN push.** Si NetBg está vivo (4.1.1), **el relé ya trae la oferta de
   llamada en vivo**: NetBg la recibe casi al instante y dispara la pantalla de llamada (CallStyle + full-screen intent,
   ya presentes en 2784/2785). **No hace falta push.** Lo que falta es:
   - marcar en el **sobre de la pareja** el evento de **oferta de llamada** (igual que hoy se marca `n`=msgId para los
     mensajes), para que NetBg lo reconozca **sin descifrar el interior**;
   - que **NetBg lance la Activity de llamada a pantalla completa** desde el lado nativo al ver esa oferta, y que
     Contestar/Rechazar responda por el relé;
   - que el **emisor mantenga la oferta "caliente" ~30–60 s** (reintentos mientras timbra) para que la vea el NetBg del
     receptor aunque tarde unos segundos en reconectar.
   - **Limitación honesta (decírselo al dueño):** si NetBg está muerto (Doze mató el socket y no resucitó), **la llamada
     no suena**. La fiabilidad de la llamada = la salud de NetBg. Es exactamente la limitación de Jami ("no timbra tras
     dormir") y de SimpleX ("no despertó con VPN"). Sin push no hay forma de garantizar el 100 %; con (B) bien hecho se
     llega muy cerca.

4. **Red de seguridad con WorkManager (~15 min).** Si NetBg no está vivo, un trabajo periódico despierta, reconecta a
   los relés, baja el **buzón** y avisa de lo que falte. No es instantáneo y **no sirve para llamadas**, pero garantiza
   que los **mensajes** llegan en ≤15 min aunque se haya caído el socket. Barato e implementable ya.

### 4.2 La pregunta del dueño: ¿puede NEXO usar un "push de Nostr" existente, sin montar servidor?

**Respuesta corta: no hay un servicio público listo para usar que sirva a NEXO.** Y con matices importantes:

- Los "push de Nostr" que existen (el servidor de push de **Amethyst**, **notify.damus.io** de Damus, el servidor de
  **Pokey**) están atados a los **DMs/eventos estándar de Nostr** y a los **servidores de push de esas apps**. NEXO **no**
  publica eventos estándar: publica **eventos a medida, doblemente cifrados, dirigidos a una etiqueta que cambia cada
  día y firmados con una clave distinta al azar** (por diseño de privacidad, ver `docs/INTERNET.md`). Un servidor de
  push genérico de Nostr **no puede saber que un evento es "para ti"** — justamente lo que hace a NEXO privado es lo que
  impide que un push ajeno lo reconozca.
- Por tanto, para tener un push, NEXO necesitaría que **alguien corra un PUENTE** que: conozca un **identificador opaco**
  de tu dispositivo, **se suscriba a los relés**, **calcule tu etiqueta del día** y mande un **aviso sin contenido**
  ("despierta") a tu token FCM/UnifiedPush. **Eso es un servidor.** (Es literalmente el modelo (A) aplicado a Nostr:
  "un bot que rastrea los relés", [nostr.at](https://nostr.at/nevent1qqsq8rw3s5ehdv07yyg9ur27e32d4698tles2u8x4nyz6yp8l7sjl9qn6kv7j)).
- **Precedente técnico** de que se puede: Amethyst y el PR de notificaciones de **Notedeck** ya hacen "FCM para la build
  de Google + websocket/UnifiedPush para los que evitan Google", y envuelven los eventos en GiftWrap para no filtrar el
  token ↔ clave. Hay incluso propuestas de estándar para la privacidad del token (NIP-59 gift wrap, y las propuestas
  NIP-63 y MIP-05 de Marmot cifran el token para que el push-server no te espíe). Pero **todas asumen un push-server**.
  ([Amethyst v0.76.0](https://nobsbitcoin.com/amethyst-v0-76-0),
  [Notedeck: revisión del sistema de notificaciones](https://raw.githack.com/alltheseas/notedeck-vid/notedeck-notifications/docs/notification-system-review.html),
  [NIPs de Nostr](https://github.com/nostr-protocol/nips)).

### 4.3 ¿Vale UnifiedPush?

UnifiedPush es un **protocolo abierto** para recibir push sin depender de una sola empresa: un *distribuidor* (p. ej. la
app **ntfy**) recibe los avisos y los reparte a las apps; el contenido suele ir cifrado o ser un simple "ping".
([F-Droid: UnifiedPush](https://f-droid.org/2022/12/18/unifiedpush.html),
[UnifiedPush FAQ](https://unifiedpush.org/users/faq/),
[ntfy como distribuidor](https://etke.cc/help/extras/ntfy/)).

**Pero no es un atajo para NEXO**, por tres motivos:
1. UnifiedPush **mueve** la conexión viva a la app distribuidora (ntfy mantiene su propio socket + exención de batería)
   **o** a un carril de push — no la elimina.
2. Sigues necesitando un **puente que vigile los relés por tu etiqueta del día y haga el POST** a tu "topic" de ntfy.
   El ntfy público tiene límites de ritmo; self-hosting = un servidor.
3. **UnifiedPush no existe en iPhone** (allí mandan APNs).

O sea: UnifiedPush es viable **solo si el dueño acepta correr (o confiar en) un pequeño puente**. No evita la necesidad
de "o push-server, o conexión viva".

---

## 5. Plan por fases (concreto, mínimo, sin romper el modelo P2P)

**Fase 0 — Diagnóstico (ya, sin código).** Confirmar con el **registro nativo de los dos teléfonos** (2785, app cerrada
+ pantalla apagada + mandar mensaje + esperar ~2 min + abrir + copiar diagnóstico) **por qué muere NetBg**. Es nativo y
no simulable; manda el camino de la Fase 1.

**Fase 1 — Endurecer NetBg = modelo (B) robusto (implementable YA, sin servidor).**
- Tipo correcto de servicio en primer plano Android 14 (`remoteMessaging`/`connectedDevice`/`dataSync`/`specialUse`).
- `START_STICKY` + reinicio en `onTaskRemoved` + receptor `BOOT_COMPLETED` → el servicio resucita solo.
- Websocket a los relés con **reconexión (backoff)**, **ping keepalive** y **re-auth NIP-42** al reconectar; renovar la
  etiqueta del día a medianoche (ya se hace).
- WifiLock ✓ (2785) y exención de batería ✓; **añadir guía de batería por marca** (Xiaomi/Samsung/Huawei).
- **Medir batería** (rutina diaria, `docs/ROBUSTEZ.md`): (B) gasta más; recortar latidos y reconexiones.

**Fase 2 — Llamada entrante con la app cerrada (implementable YA; depende de la Fase 1).**
- Marcar la **oferta de llamada** en el sobre de la pareja (como `n`=msgId, pero tipo "llamada") para que NetBg la
  reconozca sin abrir el interior.
- NetBg, al ver la oferta viva, **lanza la Activity de llamada a pantalla completa** (full-screen intent + CallStyle, ya
  en 2784/2785) y suena; Contestar/Rechazar responde por el relé.
- El emisor mantiene la oferta **"caliente" ~30–60 s** mientras timbra.
- Documentar la **limitación**: si NetBg está muerto, la llamada no suena (como Jami/SimpleX). Sin push no hay 100 %.

**Fase 3 — Red de seguridad (implementable YA).**
- **WorkManager periódico (~15 min)**: si NetBg no vive, despierta, reconecta, baja el buzón y avisa de lo que falte.
  Garantiza mensajes en ≤15 min aunque muera el socket. No cubre llamadas instantáneas.

**Fase 4 — PUSH de Nostr (requiere DECISIÓN del dueño).** Solo si se quiere "instantáneo garantizado con la pantalla
apagada e incluso con NetBg muerto", como WhatsApp:
- Montar (o confiar en) un **puente Nostr→push** (UnifiedPush/ntfy propio, o FCM) que vigile los relés con un
  identificador **opaco** del dispositivo y mande un **"wake" sin contenido**. Es un **servidor pequeño**; rompe en parte
  el "cero servidores"; iOS exigiría APNs aparte. **No existe un servicio público listo** para los eventos a medida de
  NEXO: habría que escribir el puente. Es decisión de **producto y de confianza**, no una implementación rápida.
- Buena noticia: la privacidad se puede mantener (GiftWrap / token cifrado, como Amethyst y las propuestas NIP-63 /
  MIP-05) para que el puente **no sepa quién eres ni qué dices**, solo "despierta a este dispositivo opaco".

### Qué es implementable ya vs qué necesita decisión
- **Ya, sin decisión:** Fases 0, 1, 2 y 3. Cubren mensajes y llamadas con la app cerrada **al nivel de Briar/Pokey/
  Signal-sin-Google** (lo máximo posible manteniendo el modelo P2P puro).
- **Necesita decisión del dueño:** Fase 4 (depender de un puente de push externo o propio). Es lo único que daría el
  "exactamente como WhatsApp" (push garantizado aun con el socket caído), a cambio de un servidor y de confianza.

---

## 6. Fuentes (todas las URLs citadas)

- Firebase — prioridad de mensajes: https://firebase.google.com/docs/cloud-messaging/android/message-priority
- Firebase — sobre los mensajes FCM: https://firebase.google.com/docs/cloud-messaging/concept-options
- Firebase blog (2025) — FCM en Android: https://firebase.blog/posts/2025/04/fcm-on-android
- GrapheneOS — Molly-FOSS y batería (Signal websocket): https://discuss.grapheneos.org/d/1211-molly-foss-battery-drain
- GrapheneOS — batería con/sin Google Play (Signal): https://discuss.grapheneos.org/d/6349-battery-life-with-and-without-gpsgsf-google-signal-app/14
- GrapheneOS — SimpleX, VPN y Doze (no despierta en llamada): https://discuss.grapheneos.org/d/28632-delayed-notificarions-and-sometimes-no-notifications-at-all/22
- F-Droid — Briar: https://f-droid.org/en/packages/org.briarproject.briar.android/
- F-Droid — Briar Mailbox: https://f-droid.org/en/packages/org.briarproject.mailbox/index.html
- Briar en modo mantenimiento (batería): https://zeli.app/story/48919869
- SimpleX — notificaciones instantáneas: https://forgejo.multed.com/android-apps-mirrors/SimpleX-Chat/src/commit/43adb7de82cf33dcbb551542af1f53d8c6404313/blog/20220404-simplex-chat-instant-notifications.md
- Jami — por qué el push no reinicia Jami (RFC 8599, DHT proxy): https://forum.jami.net/t/why-does-not-push-restart-jami/1975
- Jami — no timbra tras dormir: https://forum.jami.net/t/jami-not-ringing-on-android-after-a-certain-time-asleep/1544
- Bridgefy — prueba (solo primer plano): https://amp.scmp.com/abacus/culture/article/3026527/we-tested-messaging-app-used-hong-kong-protesters-works-without
- Bridgefy — SDK Android (escaneo en primer plano): https://docs.bridgefy.me/sdk/android
- Sacra — el control del SO amenaza la mensajería de malla: https://sacra.com/chat/h/2f1a6a36-524c-42a4-afe6-a4103dc80d79/
- Amethyst v0.80.1 — push FOSS (UnifiedPush): https://www.nobsbitcoin.com/amethyst-v0-80-1/
- Amethyst v0.76.0 — push con GiftWrap (token ↔ clave): https://nobsbitcoin.com/amethyst-v0-76-0
- Nos — las notificaciones necesitan un servidor (bot que rastrea relés): https://nostr.at/nevent1qqsq8rw3s5ehdv07yyg9ur27e32d4698tles2u8x4nyz6yp8l7sjl9qn6kv7j
- Pokey — conexión viva a tus relés de inbox vs servidor que vigila: https://nostr.at/nevent1qqszjeacgu6f7cevtcdr4wdc2yuysjyl55gzlj9yuvhl9y9u7uqw2ag49wekx
- Notedeck — revisión del sistema de notificaciones (FCM + websocket): https://raw.githack.com/alltheseas/notedeck-vid/notedeck-notifications/docs/notification-system-review.html
- NIPs de Nostr (NIP-59 gift wrap, NIP-63, etc.): https://github.com/nostr-protocol/nips
- UnifiedPush — F-Droid (qué es): https://f-droid.org/2022/12/18/unifiedpush.html
- UnifiedPush — FAQ: https://unifiedpush.org/users/faq/
- ntfy como distribuidor UnifiedPush: https://etke.cc/help/extras/ntfy/
- Android 14 — tipos de servicio en primer plano obligatorios: https://developer.android.com/about/versions/14/changes/fgs-types-required
- Google Play — servicio en primer plano y full-screen intent: https://support.google.com/googleplay/android-developer/answer/13392821
- proandroiddev — full-screen intent en Android 14/15 (qué cambió): https://proandroiddev.com/full-screen-intent-fsi-notifications-in-android-14-15-what-changed-why-its-breaking-and-e5e862a75936
- Android — CallStyle (plantilla de aviso de llamada): https://developer.android.com/develop/ui/views/notifications/call-style
- Android — ConnectionService (self-managed, onShowIncomingCallUi): https://developer.android.com/reference/android/telecom/ConnectionService
- Voximplant — ConnectionService (full-screen recomendado): https://voximplant.com/docs/guides/sdk/connectionservice
- Android — WorkManager PeriodicWorkRequest (mínimo 15 min): https://developer.android.com/reference/androidx/work/PeriodicWorkRequest

> Nota de método (CLAUDE.md): esto es **solo investigación**. Lo que toque código (Fases 1–3) debe reproducirse primero
> en `tests/sim`, confirmarse con la batería y el diagnóstico nativo de los dos teléfonos, y solo entonces subirse.
> La Fase 4 (puente de push) es una **decisión del dueño** antes de escribir nada.
