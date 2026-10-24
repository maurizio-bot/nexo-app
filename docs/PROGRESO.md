# NEXO — Estado del proyecto

Última actualización: 2026-10-24 (build 2758)

## Construcción y firma
- Push a `NEXOCHAT` → `.github/workflows/build-apk.yml` publica la pre-release `nightly-<run>` (APK debug).
  En otras ramas (lanzado a mano) solo compila, verifica la firma y sube un artifact; no publica.
- Firma fija: secret `DEBUG_KEYSTORE_BASE64` → `NEXO_DEBUG_KEYSTORE` → `android/app/build.gradle`.
  El paso "Verify APK signature" exige SHA-256 `23d86688…9f865e`. Desde la 2691 se actualiza encima
  sin desinstalar. El dueño guarda copia de la llave (no está en el repo).
- Solo entra en la APK lo que importa `src/main.js` (webpack); el resto de `src/` no se usa aún.

## Qué hace la APK
Mensajería P2P por BLE sin servidores. Identidad `NX` + 8 caracteres (`_generateNexoId` en
`ble_interface.js`, guardada en `nexo_advertising_id.json`; mapas `_nexoIdToMac`/`_macToNexoId` con ID en
minúscula y MAC sin ":"). Cada teléfono es servidor GATT (servicio `0000abcd`, RX `abce`, TX `abcf`) y
cliente; anuncia el NEXO ID en manufacturer data. Chat con estados (pendiente → enviado → entregado →
leído), cola de reenvío, sincronización por `seq`, adjuntos (foto 480 px, vídeo, archivo ≤ ~2,1 MB, voz,
ubicación) y persistencia JSON (`saveToFile`/`loadFromFile`; adjuntos en `nexo_att_<msgId>.b64`).

Archivos clave: `src/main.js`, `src/ui/ble_interface.js`, `src/ui/ble_ack.js` (protocolo: trozos
`c`/`f`, ack de bloque `ba`, NACK `n`, sync `ss`/`sr`, `sendWithRetry`), `src/vault/vault_manager.js`,
`plugins/nexo-ble/.../NexoBlePlugin.kt`.

## Historial
| Build | Commit | Nota |
|---|---|---|
| 2679 | `04960e2` | Base funcional recuperada |
| 2680–2687 | | Rotura del envío (`content` vs `message`), fixes; 2687 subida sin verificar: no usar |
| 2688 | `c45f5f5` | Envío/ACK/historial OK. Fotos lentas, app trabada tras 2ª foto, PDF no llega |
| 2691 | `37152b8` | Firma fija real; sin tormenta de retransmisiones; adjuntos fuera del historial. Prueba real: textos y fotos OK pero lento; al reabrir la app se perdían 1-2 mensajes |
| 2692 | `d6c7fae` | Verificación en rama de trabajo (Kotlin compila, firma OK), sin release |
| 2693 | `c12c974` | Mensajes retenidos al reabrir, control de flujo nativo por callback, progreso visible |
| 2694 | `b75a767` | Verificación en rama de trabajo (Kotlin + firma), sin release |
| 2695 | `37ad25e` | Historial sin carreras (mensajes borrados al reabrir), textos repetidos visibles, reconexión al volver a la app |
| 2696 | `939f4ec` | Vídeo previa 240p + HD automático; lista de contactos por último mensaje |
| 2697 | `2fc0074` | Vídeo/texto a app cerrada ya no se pierden (cola por contacto), vídeo se ve más de una vez, miniatura |
| 2698 | `43256cd` | Vídeo: burbuja con miniatura sin reproductor, visor que libera, previa robusta, diagnóstico en Perfil — **BASE ESTABLE** (rama `base-estable-2698`) |
| 2699 | `d563355` | Compartir contactos (botón contacto): selección múltiple, tarjeta, alta con parpadeo — **BASE ESTABLE** (rama `base-estable-2699`) |
| 2700 | `eef24ed` | Rendimiento: historial paginado, sin congelones al recibir, escrituras agrupadas, radio libre en transferencias |
| 2701 | `cc42d09` | Vídeo: HD recodificado 720p si el original es grande, tiempo restante, tiempos en el diagnóstico |
| 2702 | `d7b85ab` | Cifrado de extremo a extremo (textos, adjuntos, nombre y miniatura); fin de los reenvíos de lo ya entregado. Actualizar todos los teléfonos |
| 2703 | `b611dbd` | Compilación de prueba en la rama de trabajo (Kotlin de archivos), sin release |
| 2704 | `b9c412f` | Archivos: PDF con miniatura y se abre al tocar, APK se instala, selector sin cierre a los 30 s |
| 2705 | `0b04628` | Jump: mensajes de varios saltos (A → B → C) por teléfonos conectados, cifrados para el destino |
| 2706 | `09da6aa` | Compilación de prueba en la rama de trabajo (Kotlin getPowerStatus), sin release |
| 2707 | `48887c1` | Jump con cualquier teléfono NEXO (bajo demanda), protección de batería, selector de camino |
| 2708 | `eeade70` | Compilación de prueba en la rama de trabajo (Kotlin Wi-Fi Direct), sin release |
| 2709 | `b5269f4` | Wi-Fi Direct para fotos, vídeos y archivos (hasta ~22 MB, vídeo original) |
| 2710 | `2947c22` | Compilación de prueba en la rama de trabajo (APK no depurable), sin release |
| 2711 | `5f3a1ad` | Seguridad fase 1: APK no depurable, sin copias, registros sin contenido, anti-suplantación |
| 2712 | `9c33e79` | Seguridad fase 2: protocolo de Signal (Double Ratchet), sobre atado al cifrado, relleno, número de seguridad. Actualizar todos los teléfonos. APK verificada (firma 23d86688…, sin depuración ni copias) |
| 2713 | `4a33565` | Wi-Fi Direct: permiso de Android 13+ (faltaba: nunca funcionaba) y vídeo/archivo que se quedaban en 1 % si fallaba. APK verificada (firma, NEARBY_WIFI_DEVICES presente) |
| 2714 | `cdb3b89` | Ubicación con aviso y alternativas (GPS → red); Wi-Fi Direct ya no reenvía por Bluetooth lo entregado; tiempos por fase. APK verificada |
| 2715 | `8a2d5e7` | Protocolo Fénix fase 1: respaldo automático de la cuenta en 10/20 contactos, pingeo y curación, recuperación con 6 confirmaciones. APK verificada |
| 2716 | `504994f` | Compilación de prueba en la rama de trabajo (limpieza de Kotlin), sin release |
| 2717 | `504994f` | Limpieza: fuera ~10.900 líneas de código sustituido o duplicado. JavaScript idéntico a la 2715; APK 0,5 MB más ligera (sin `client/android` ni iconos sobrantes). APK verificada |
| 2718 | `29bcc90` | Chat tipo WhatsApp (responder, reenviar, eliminar para mí / para todos, copiar) y cámara nueva (VÍDEO/FOTO, revisar antes de enviar, selfie en espejo, fotos a 800 px). APK verificada |
| 2719 | `a217b9e` | Compilación de prueba en la rama de trabajo (Kotlin de la fase 3), sin release |
| 2720 | `a217b9e` | Seguridad fase 3: datos cifrados en el teléfono (Keystore), bloqueo opcional con huella/PIN y bloquear capturas (Perfil → Seguridad). APK verificada (firma 23d86688…, sin copias) |
| 2721 | `e47a031` | Compilación de prueba en la rama de trabajo, sin release |
| 2722 | `e47a031` | Envío fluido: la 2720 hacía lento hasta el texto (releía todos los adjuntos en cada arranque y los archivos bloqueaban la fila única del plugin). Archivos en hilos propios, tiempos de cada texto en el diagnóstico. APK verificada |
| 2723–2724 | | Compilaciones de prueba en la rama de trabajo, sin release |
| 2725 | `3e1d507` | Fotos paradas (20 % / ○) y "mensaje de código" con la 2722: cola nativa que nunca parte un mensaje, resincronización del receptor, comprobación por trozo, paquetes dañados fuera del chat, sin avalancha de avisos nativos. Reproducido y corregido en el simulador |
| 2726–2727 | | Compilaciones de prueba en la rama de trabajo (Wi-Fi normal), sin release |
| 2728 | `93dd9ad` | Wi-Fi normal (misma red) y cambio automático Wi-Fi / Bluetooth / Wi-Fi Direct / Jump (`docs/WIFI.md`). Cabecera del chat con el camino. Probado en simulador y JVM |
| 2729 | `104dcc6` | Compilación de prueba en la rama de trabajo (latido nativo del Wi-Fi), sin release |
| 2730 | `40fe10c` | Wi-Fi según las reglas del dueño (no pasa a Bluetooth por un corte breve ni en segundo plano; mala señal medida), remitente oculto a los puentes de Jump, poscuántico (ML-KEM), QR del número de seguridad. APK verificada (firma 23d86688…, sin copias) |
| 2731 | `9b0250b` | Compilación de prueba en la rama de trabajo (Kotlin del largo alcance), sin release |
| 2732 | `fbeaaed` | Jump con más alcance (Bluetooth de largo alcance LE Coded y hasta 8 saltos), Fénix fase 2 (los mensajes de texto se respaldan en 2 contactos y vuelven al recuperar la cuenta), el "+" de agregar ya no falla. APK verificada (firma 23d86688…, sin copias) |
| 2733 | `d20e1b6` | Compilación de prueba en la rama de trabajo (Kotlin del escaneo de la red), sin release |
| 2734 | `a5f9d77` | Wi-Fi: escaneo activo de la red (idea del dueño): los teléfonos en el mismo Wi-Fi se encuentran aunque el router no deje pasar el anuncio mDNS. APK verificada (firma 23d86688…, sin copias) |
| 2735–2738 | | Compilaciones de prueba en la rama de trabajo (Tor): la 2735 y la 2738 fallaron (versiones de tor-android que el Gradle del proyecto no admite), la 2737 compiló con la 0.4.9.5 |
| 2739 | `f51dec6` | Internet: relés públicos Nostr (buzón cifrado, etiquetas diarias, sin NEXO IDs) y Tor (servicio oculto, directo y sin IP visible). Wi-Fi de módems distintos = internet antes que Bluetooth. `docs/INTERNET.md`. APK verificada (firma 23d86688…, sin copias, TorService y libtor.so ARM 64/32); pesa 26,9 MB (la 2734, 10 MB) |
| 2740–2743 | | Compilaciones de prueba en la rama de trabajo (pruebas automáticas en GitHub); la 2740–2742 pararon en las pruebas por el fallo de Jump con internet |
| 2744 | `56f6991` | Pruebas automáticas antes de cada APK, Jump: fotos ya no se atascan con el puente conectado por internet, vista previa sin medio emoji, limpieza (versiones, manifiesto, tarjetas de pago). APK verificada (firma 23d86688…, sin copias, Tor incluido) |
| 2745–2748 | | Compilaciones de prueba en la rama de trabajo (AGP 9): 2745 y 2746 fallaron (proguard-android.txt, compileSdk 37.1), 2747 (AGP 9.2) y 2748 (AGP 9.4) compilaron con la firma de siempre |
| 2749 | `3180529` | Gradle moderno (AGP 9.4.0, Gradle 9.6.0, Kotlin 2.2.20, compileSdk 37.1) y Tor 0.4.9.14. APK verificada: firma 23d86688…, manifiesto igual que la 2744 (permisos, targetSdk 34, sin copias), Tor nuevo; pesa 24,4 MB (antes 26,9) |
| 2750 | | Compilación de prueba en la rama de trabajo (Kotlin de notificaciones e internet en segundo plano): compila, pruebas en verde |
| 2751 | `769c025` | Notificaciones de mensajes (una por chat, número en el icono), no leídos por todas las vías, "leído" solo con la app a la vista, internet en segundo plano (escucha nativa de los relés), permiso de notificaciones. APK verificada: firma 23d86688…, manifiesto igual que la 2749 + POST_NOTIFICATIONS, clases nuevas presentes |
| 2752 | a468f31 | Reestructuración sin cambios de código: main.js 4.281 → 720 líneas, ble_interface.js 3.732 → 847, en 30 módulos (`docs/ESTRUCTURA.md`). Batería idéntica. APK comprobada: 24,4 MB, cert 23d86688…, sin copia de seguridad, manifiesto idéntico a 2751, clases nativas nuevas presentes. Falta probarla en teléfonos |
| 2753 | `75772b8` | Sin APK: falló en GitHub la prueba nueva `binary.js` (las pérdidas simuladas se aplicaban también al conectar y se perdió el intercambio de claves; ahora solo durante los envíos). El Kotlin compiló bien en las pruebas JVM |
| 2754 | `9dac851` | Bluetooth sin base64: trozos de archivo en binario con quien lo anuncia (−25 % de bytes por la radio, fotos y PDF ~25–35 % más rápidos en el simulador); con builds anteriores, JSON de siempre. APK verificada: 24,5 MB, firma 23d86688…, manifiesto idéntico a la 2752, `BinFrame`/`BinAssembler`/`sendBinary` presentes. Falta probarla en teléfonos |
| 2755 | `c035890` | Solo diagnóstico (el dueño dice que los archivos no llegan; sin cambio de comportamiento): en Perfil → Copiar diagnóstico salen los errores de Bluetooth del nativo (`BT_ERR`: escritura o notificación fallida, mensaje descartado, trozo binario incompleto; uno por tipo cada 5 s) y una línea `[BIN]` por cada envío/recepción en binario. APK verificada (firma 23d86688…, manifiesto igual que la 2754) |
| 2756 | `a7b3641` | Archivos grandes hasta 1 GB por el mismo Wi-Fi / Wi-Fi Direct (informe del dueño: un APK de 24 MB no salía) e ID Bluetooth rotativo (plan punto 4). APK verificada (24,5 MB, firma 23d86688…, manifiesto igual que la 2755, clases nuevas presentes). Falta probarla en teléfonos |
| 2757 | ac3a670 | MTU pequeño (punto 8), Fénix para fotos y archivos (punto 9), Jump por Wi-Fi probado (punto 10), recibir por Bluetooth con la app cerrada (punto 12). APK verificada (nightly-2757); falta probarla en teléfonos |
| 2758 | (este commit) | Archivos grandes por Bluetooth L2CAP sin Wi-Fi (punto 13, fase 1), chats de grupo con textos, fotos, audio y archivos (punto 14), llamadas de voz (punto 16) y videollamadas en el mismo Wi-Fi (punto 17); arreglos: foto por Jump que no se completaba al reenviarse directa, acciones ocultas visibles al reabrir el chat. Falta verificar la APK y probarla en teléfonos |

## Base estable: build 2713
Probada por el dueño en teléfonos reales ("funciona como esperado", Wi-Fi Direct incluido), fijada el
22-10-2026. Anteriores: 2699 (rama `base-estable-2699`, commit `d563355`) y 2698 (`base-estable-2698`).
- Código: rama **`base-estable-2713`** (commit `4a33565`). No se toca; el proxy no deja subir etiquetas.
- APK: release `nightly-2713`. Misma llave y mismo `versionCode 1` que todas las builds: se instala
  encima de cualquier build posterior sin desinstalar (el workflow no borra releases antiguas).
- Ojo: volver a una base anterior a la 2712 deja el cifrado en el protocolo 1; los teléfonos con 2712+ no
  vuelven al 1 con un contacto que ya usa el 2 (pasadas 26 h descartan lo que llegue con el 1). Por eso
  la base es la 2713: no conviene bajar de la 2712.
- **Ojo desde la 2720:** los teléfonos con 2720+ tienen los datos cifrados en disco y la 2713 no sabe leerlos
  (vería contactos y chats vacíos y podría sobrescribirlos). Si hay que volver a la base, conservar el
  cifrado: tras el `git restore` de abajo, recuperar de NEXOCHAT `AtRestStore.kt`, los cambios de
  `saveToFile` / `loadFromFile` / `deleteFile` / `atRestDataKey` en `NexoBlePlugin.kt` y la dependencia de
  `build.gradle` del plugin. Lo mejor: fijar una base nueva ≥ 2720 cuando el dueño la confirme.
- Volver a la base (sin reescribir la historia, genera una build nueva con el código de la 2713):
  ```
  git checkout NEXOCHAT && git pull
  git restore --source=base-estable-2713 --staged --worktree -- src plugins android index.html package.json package-lock.json
  git commit -m "Volver a la base estable 2713" && git push origin NEXOCHAT
  ```

## Siguiente paso (al retomar)
- 2751: (1) Al abrir la app debe pedir permiso para notificaciones (Android 13+); aceptar. (2) Con NEXO en
  segundo plano, que el otro mande texto y foto (Bluetooth, Wi-Fi o internet): debe salir una notificación con su
  nombre y el número de mensajes, y el número en el icono de NEXO (si el lanzador lo admite). Tocarla abre ese chat.
  (3) En la lista de chats, la burbuja numerada debe contar también textos largos y fotos, y ponerse a 0 al abrir el
  chat. (4) Con la app en segundo plano el otro NO debe ver ✓✓ azul hasta que abras. (5) Internet en segundo plano:
  los dos en Wi-Fi de casas distintas, cerrar NEXO en uno (sin quitarlo de recientes) y escribirle: debe llegar la
  notificación "Mensaje nuevo". Diagnóstico: líneas `[NOTIF]`, `[NET]`. Con datos de ahorro de batería agresivos
  (Xiaomi, Huawei…) el sistema puede cortar la escucha: decir la marca del teléfono.
- 2739 (internet, decisión del dueño "2 y 3"): con los dos teléfonos en **Wi-Fi de casas distintas** (o uno con datos
  móviles) y NEXO abierto, la cabecera debe pasar a "En línea · Internet" en menos de un minuto; textos y fotos deben
  llegar (con datos móviles solo textos; las fotos esperan al Wi-Fi). Con uno cerrado, el texto queda en ✓ y llega al
  abrirlo (✓✓). Perfil → Internet: estado de los relés y de Tor (Tor tarda hasta un par de minutos la primera vez).
  Diagnóstico: líneas `[NET]` (relés conectados, "en línea por internet", "Tor listo", "conectado por Tor"). Si no
  conecta: puede que la red bloquee los relés o Tor; pedir el diagnóstico de los dos.
- 2734: los dos teléfonos en el mismo Wi-Fi (también con repetidor o red en malla): "En línea · Wi-Fi" en segundos,
  también al apagar y encender el Wi-Fi de uno. Diagnóstico: `[WIFI] nx… está en la misma red (escaneo de la red |
  anuncio mDNS)`. Entre módems distintos sigue sin Wi-Fi hasta decidir el punto de encuentro por internet.
- 2732: (1) Diagnóstico: línea `[JUMP] Largo alcance (LE Coded): sí/no` en cada teléfono (si los dos dicen "sí",
  probar Jump o un chat directo más lejos que antes). (2) Perfil → Fénix: con la cuenta protegida debe salir
  "💬 Mensajes protegidos: N"; tras recuperar la cuenta en otro teléfono, "🔥 Fénix: N mensaje(s) recuperados".
  (3) Agregar contactos: el "+" de un teléfono encontrado debe funcionar siempre.
- 2730: (1) Wi-Fi: los dos en el mismo router, NEXO abierto → "En línea · Wi-Fi"; mandar fotos, también con uno en
  segundo plano: debe seguir "· Wi-Fi" (antes pasaba a Bluetooth). (2) Chat → tocar el aviso 🔒 → "Mostrar mi QR" en
  uno y "Escanear su QR" en el otro: debe salir "✔ Número de seguridad verificado". (3) Tras escribirse, el aviso
  debe decir "Protección poscuántica activa". (4) Jump con 3 teléfonos: debe llegar igual. Diagnóstico si algo
  falla: líneas `[WIFI]`, `LAN`, `[E2E]`, `[JUMP]`.
- 2728 (Wi-Fi normal): con los dos teléfonos en la **misma red Wi-Fi** y NEXO abierto, la cabecera del chat debe
  pasar a "En línea · Wi-Fi" en unos segundos; fotos y vídeos mucho más rápidos. Probar a apagar el Wi-Fi de uno a
  mitad de un envío: debe seguir por Bluetooth ("En línea · Bluetooth"). Si no aparece Wi-Fi: diagnóstico de los
  dos (líneas `[WIFI]` y `LAN`); algunas redes de invitados bloquean hablar entre dispositivos.
- 2725: el dueño probó la 2722 (dos teléfonos a <10 cm): una foto se paró en 20 % con un "mensaje de código" y
  la del otro nunca empezó (○). Reproducido en el simulador (ver ronda 2725) y corregido. Pedir que pruebe fotos
  en las dos direcciones; si algo se para, diagnóstico de los dos: líneas `Write fallo … mensaje descartado`,
  `REASSEMBLY … resincronizado`, `Trozo … dañado`, `Paquete dañado descartado`, `[SEND]`.
- Después: Wi-Fi normal (misma red, NSD + TCP, verificado con E2E) y cambio automático Bluetooth / Wi-Fi Direct /
  Wi-Fi (pedido del dueño). Pensarlo para que sirva también en iOS (explicado al dueño el 23-10).
- 2722: el dueño dijo que con la 2720 "hasta enviar mensajes es lento". Corregido lo encontrado (ver ronda
  2722). Pedir el diagnóstico de los dos teléfonos tras mandar 5-6 textos: líneas `[SEND] Texto entregado en X
  ms (cifrar, salir por Bluetooth, reintentos)`, `[NATIVO] FILE_IO … lento` y `[LOCK] … migración`. Si sigue
  lento, esos números dicen si es el cifrado, la radio o los reintentos. No cambiar a ciegas.
- 2720 (seguridad fase 3): **lo primero**, instalarla encima y comprobar que siguen contactos, chats, NEXO ID y
  Fénix (al arrancar se cifran los archivos de antes; en el diagnóstico: `Cifrado en reposo activo; N
  archivo(s) cifrados ahora`). Perfil → Seguridad debe decir "Tus datos están cifrados en este teléfono".
  Probar: activar el bloqueo (pide huella), salir y volver (inmediatamente / 1 min), que los mensajes lleguen
  con NEXO bloqueado; bloquear capturas (captura en negro, NEXO en blanco en recientes). Si algo falla:
  diagnóstico, líneas `[LOCK]` y `AT_REST`. Volver a la 2718 o anterior tras la 2720 **no** sirve: esas no
  leen los archivos cifrados (la base estable 2713 tampoco).
- 2718: probar en el teléfono (los dos con 2718): mantener pulsada una burbuja → menú; deslizarla a la derecha
  → responder; reenviar a otro chat; eliminar para todos (el otro ve "Se eliminó este mensaje"). Cámara:
  pestañas, foto → revisar → enviar, selfie (debe verse como un espejo y la foto igual), vídeo con contador.
  Ojo: con contactos en builds anteriores a la 2715 las respuestas van como texto normal y no sale
  "Eliminar para todos". Las fotos pesan más (800 px): ~2x de tiempo por Bluetooth.
- Siguiente: seguridad fase 3 (pedido por el dueño tras pulir chat y cámara).
- 2714: probar la ubicación (dentro de casa y fuera): debe salir el aviso "Obteniendo tu ubicación…" y luego
  la burbuja, o un aviso claro. Si no, diagnóstico: líneas `[ATTACH] Ubicación…`.
- 2714 (Wi-Fi Direct lento): pedir al dueño el diagnóstico de **los dos** teléfonos tras mandar un vídeo de
  varios MB. Emisor: `[WIFI-DIRECT] … fases: grupo del otro X s, a Android X s, unirse X s, envío X s (KB/s)`;
  receptor: `Recibido … de Android a la app X s, lectura X s`. Con eso se decide qué acelerar (mantener el
  grupo abierto entre envíos, no pasar el contenido por el WebView, etc.). No cambiar a ciegas.
- 2715 (Fénix): con 10 contactos actualizados a la 2715+, Perfil → Fénix debe decir "Cuenta protegida: N de 10
  fragmentos entregados" (se entregan al estar conectados). Recuperación: en un teléfono nuevo, Perfil →
  Recuperar mi cuenta, con 6 de esos contactos cerca y NEXO abierto; a cada uno le sale el aviso "¿Quién es?".
  Diagnóstico: líneas `[FENIX]`. Pendiente de Fénix: mensajes y archivos, pingeo por Jump, huella (fase 3).
- 2713 (Wi-Fi Direct): el dueño vio en la 2711 un vídeo que se quedaba en 1 % en el emisor. Instalar en los
  dos teléfonos y mandar un vídeo de varios MB: la 1.ª vez Android puede pedir "Dispositivos cercanos" en
  cada teléfono (aceptar). Debe llegar en segundos por Wi-Fi Direct; si Wi-Fi Direct falla, debe llegar
  igualmente como previa + HD por Bluetooth (nunca quedarse en 1 %). Diagnóstico de ambos: líneas
  `[WIFI-DIRECT]` (dicen si se envió, si falló y por qué) y `[VIDEO]`.
- 2712 (cifrado como Signal): instalar en **todos** los teléfonos. Al conectar, el diagnóstico dice
  `[E2E] nx…: protocolo 2`. Tocar el aviso 🔒 del chat en los dos teléfonos: el número de 60 cifras debe ser
  idéntico; si lo es, "Marcar como verificado". Textos, fotos, vídeos y Jump deben seguir llegando.
- Seguridad fase 3 (siguiente): cifrado en reposo con el Keystore, anuncios Bluetooth rotativos, emisor oculto
  para los puentes, QR del número de seguridad, poscuántico.
- 2704: probar enviar un PDF (miniatura, tocar → se abre) y una APK pequeña (tocar → instalar; Android pide
  permiso la 1.ª vez). Una APK grande debe mostrar el aviso de tamaño.
- 2707: igual que la 2705 pero B puede ser un teléfono que NO es contacto de nadie (solo con NEXO abierto
  o en segundo plano). Comprobar también que B no ve chats ni contactos nuevos.
- 2709 (Wi-Fi Direct): con dos teléfonos cerca y NEXO actualizado, mandar una foto, un vídeo y un archivo
  de varios MB: deben llegar en segundos. La 1.ª vez Android pide permiso de "dispositivos cercanos"
  (13+) o ubicación. Diagnóstico: líneas `[WIFI-DIRECT]`.
- Revisión de seguridad hecha: `docs/SEGURIDAD.md` (comparación con Signal y plan en 3 fases). Después:
  Wi-Fi normal y datos (para datos/Wi-Fi entre redes hace falta decidir el servidor de relevo).
- 2705 (Jump): probar con 3 teléfonos A–B–C donde A y C no se alcancen (otra habitación / distancia) y B
  en medio: A escribe a C (texto y foto). Debe salir ✓ al quedar en B y ✓✓ al llegar a C. Diagnóstico:
  líneas `[JUMP]` (rutas, "Puente", "Reenviado").
- Velocidad: el dueño decidió dejar L2CAP; primero **medir** en los teléfonos (MTU, PHY, paquetes por
  segundo, esperas de confirmación) y corregir sobre GATT; L2CAP solo si eso se queda corto.
- 2702 (cifrado): el dueño debe instalarla en **todos** los teléfonos. Comprobar en el chat el aviso 🔒 y
  que textos, fotos y vídeos siguen llegando; si algo queda con reloj, Perfil → Copiar diagnóstico de
  ambos (buscar `[E2E]`: `Sin clave pública`, `No se pudo descifrar`, `La clave de … cambió`).
- Jump fase 2 (rutas de varios saltos, textos y fotos): descubrimiento de ruta por inundación pequeña
  (ttl + ids vistos), entrega salto a salto con guardado en cada puente, acks de vuelta; el contenido
  ya va cifrado para el destino final (los puentes no lo leen). En el simulador hace falta un modelo de
  alcance (A no ve a C).
- Pruebas rápidas de la 2698 en teléfonos reales: funciona (aceptable; faltan pruebas para afinar).
  Si aparece un fallo, pedir el texto de **Perfil → Copiar diagnóstico** de ambos teléfonos. Pruebas pedidas: vídeo de 5 s con la app del otro cerrada y abierta; abrir el
  vídeo varias veces; ver si aparece la miniatura, cuánto tarda la previa y si pasa a HD.
- Al recibir el diagnóstico, buscar en "eventos clave": `[VIDEO] Previa: …` (¿se generó? ¿motivo si
  no?), `Enviando HD`, `sendFile`, `Reenvi`, `Peer ready`, `El visor no pudo reproducir`, líneas ` W `/` E `.
  Reproducir lo que muestre en `tests/sim/browser.js` (Chromium real) o en el simulador antes de corregir.
- Pendientes ya hablados: transporte binario (sin base64/JSON, ~1,6x) para todos los archivos; recibir
  con la app cerrada (servidor GATT en el `BleService`).

## Ronda 2759 (en curso)
- **Llamada con la app cerrada**: la oferta de llamada lleva la marca `cl:1` (en el sobre o en su primer trozo, que
  el nativo sí ve; el contenido sigue cifrado) y el aviso del teléfono dice "📞 Llamada entrante" en vez de "Mensaje
  nuevo"; al abrir la app antes de 60 s suena y se puede contestar (`calls.js --closed`: aviso, suena al abrir, en
  llamada). JVM: `BgInboxTest`.
- **Prueba de Fénix**: el fallo intermitente (5 de 6 mensajes / 1 de 2 archivos) era de la prueba: daba la copia por
  hecha sin contar los 2 mensajes de archivo y a veces "perdía el teléfono" con el último sin copiar. Ahora espera a
  todos: 6/6 y 2/2 (espejo y normal).

## Ronda 2758: videollamadas (plan del dueño punto 17)
- Botón 🎥 junto al 📞 (chat 1:1): la misma llamada con vídeo VP8 (WebCodecs, cámara frontal a 320x240 y 15 fps,
  ~300 kb/s, imagen completa cada 2 s), cifrado igual que la voz. Solo con el contacto en el mismo Wi-Fi (por
  Bluetooth no cabe: el botón lo avisa). Pantalla: la imagen del otro a pantalla completa, la propia en una esquina
  (en espejo), botones silenciar, cámara y colgar. Si el Wi-Fi se pierde en plena videollamada, el vídeo se para y la
  voz sigue por Bluetooth (si en 3 s no llega voz por el Wi-Fi se pasa al Bluetooth y, si no está conectado, se busca).
- Encontrado al probarlo y arreglado: en una llamada se seguía usando el Wi-Fi durante el margen de espera de lan.js
  tras un corte (silencio); el colgar iba por el chat y, sin Wi-Fi, el otro no se enteraba hasta 12 s después (ahora
  también va cifrado por el canal de la voz); la ruta L2CAP de archivos grandes podía tomar `lan:`/`net:` como
  dirección Bluetooth (ahora usa la conexión Bluetooth lista, `_bleReadyFor`).
- Simulado: `calls.js --wifi` (vídeo 46 imágenes por lado en 3 s; sin Wi-Fi vídeo parado y voz sigue; B se entera al
  colgar; sin Wi-Fi el 🎥 avisa). `calls_browser.js --video` (Chromium, cámara y micrófono de prueba): ~88 imágenes
  decodificadas por lado en 6 s, imagen del otro visible, vista propia, ~22 KB/s, voz Opus a la vez.

## Ronda 2758: llamadas de voz (plan del dueño punto 16)
- **Llamadas** (`calls.js`, `call_media.js`, `calls_ui.js`): botón 📞 en la cabecera de un chat 1:1. Solo con enlace
  directo: el mismo Wi-Fi / Wi-Fi Direct o Bluetooth a alcance (no por Jump ni internet: demasiado retraso). La
  señalización (llamar, contestar, rechazar, ocupado, colgar) va por el chat cifrada de extremo a extremo y no se
  guarda; la voz va en paquetes de ~100 ms cifrados con una clave propia de cada llamada (AES-GCM). Audio: Opus con
  WebCodecs (~3 KB/s en el aire: cabe de sobra por Bluetooth) o μ-law si el teléfono no tiene Opus (~11 KB/s);
  micrófono con cancelación de eco y ruido; reproducción con un colchón de ~150 ms; en Android, modo llamada
  (auricular, `callAudio`). Pantalla de llamada con timbre/vibración, tiempo, silenciar y colgar; sin contestar en
  45 s → perdida; sin voz del otro 12 s → se corta. Queda una línea en el chat ("📞 Llamada · 1:23", "Llamada
  perdida", "Llamada rechazada"…). Con la app en segundo plano: notificación "📞 Llamada entrante".
- Simulado: `calls.js` (señalización y cifrado con micrófono falso, por Bluetooth y `--wifi`): contestada, voz en los
  dos sentidos (40 de 41 paquetes cada 100 ms, en orden, nada en claro en el aire), rechazada, sin respuesta, se corta
  al alejarse (13 s), sin alcance → aviso. `calls_browser.js` (Chromium con micrófono de prueba: audio de verdad):
  Opus 5,9 s de audio del otro en 6 s, ~3 KB/s; `--ulaw` 5,8 s, ~11 KB/s.
- Pendiente (fase 2): sonar con la app cerrada (hoy la oferta llega al buzón y se ve como llamada perdida al abrir),
  altavoz/auricular con un botón, Bluetooth con MTU pequeño (μ-law no cabe; Opus sí).

## Ronda 2758: chats de grupo (plan del dueño punto 14: textos, fotos, audio y archivos)
- **Grupos** (`groups.js`, `groups_ui.js`): botón 👥 arriba en la pantalla principal → nombre y contactos → "Crear
  grupo". Sin servidor: el grupo (id `gr…`, nombre, miembros) se guarda en cada teléfono y cada mensaje va a cada
  miembro por su chat de siempre (cifrado de extremo a extremo, por Bluetooth, Jump, Wi-Fi o internet) dentro de un
  sobre `nexo_grp`; quien lo recibe crea o actualiza el grupo (solo si él y el remitente son miembros). El primer
  mensaje lleva las tarjetas de los miembros (como compartir contactos): así se pueden escribir aunque no se
  conocieran (se añaden como contactos sin resaltarlos). En el chat del grupo cada burbuja dice quién la escribió;
  la propia pasa a ✓✓ cuando les llegó a todos (y a leído cuando todos lo leyeron). Lista de chats: "👥 Nombre",
  último mensaje "B: …" y no leídos; notificación con el nombre del grupo. Menú ⋮: miembros y salir del grupo.
  Cada copia queda oculta en el chat 1:1 del miembro y se reenvía sola si no está a alcance; se borra en cuanto ese
  miembro confirma que le llegó. Fotos, notas de voz, ubicación, contactos y archivos de hasta ~1 MB van igual, dentro
  del sobre; el vídeo, solo la previa (sin HD). Pendiente: el HD de vídeo y los archivos grandes en grupos; avisar con
  la app cerrada con el nombre del grupo (hoy el aviso nativo dice el del remitente).
- Simulado (`groups.js`, en `ci.js`): A crea el grupo con B y C (que no se conocían): aparece en los tres, B y C se
  pueden escribir, ✓✓ en A; B escribe → llega a A (no leído 1, "B: hola grupo…") y a C (burbuja "B: …"), no en los
  chats 1:1; un texto largo de C llega a los dos; A manda un PDF al grupo → llega a B y a C, ✓✓ en A y las copias
  ocultas se borran; C sale → A y B lo ven y ya no le mandan.
- **Arreglado de paso**: la copia oculta de "eliminar para todos" perdía la marca al guardarse y, al reabrir el chat,
  quien borró veía una burbuja con el JSON de la acción (comprobado en `chatactions.js`: 1 burbuja antes, 0 ahora).

## Ronda 2758: arreglos encontrados en la batería
- **Jump, foto que se queda sin llegar**: si el puente empezaba a pasarle una foto al destino y se cortaba, y luego el
  emisor la mandaba directo, el destino mezclaba los trozos de los dos envíos (mismo mensaje troceado distinto) y no
  la completaba nunca (`jump.js --direct-later`: falló 3 de 3 también con la 2757; depende de si llegó algún trozo del
  puente antes del corte). Ahora, si lo que había a medias lleva 4 s parado, se empieza con el nuevo (`ble_ack.js`
  v3.14.0): llega en 12 s (2 de 2).
- Pruebas que miden el límite del Bluetooth de siempre (`files.js`, `perf.js`, `wifidirect.js`) se hacen con teléfonos
  sin L2CAP: con L2CAP esos archivos ya no se rechazan, van como archivo grande (`big.js --l2`).

## Ronda 2758: archivos grandes por Bluetooth L2CAP (plan del dueño punto 13, fase 1)
- Sin Wi-Fi ni Wi-Fi Direct, un archivo grande (más de ~2 MB, hasta 1 GB) ya no se rechaza: va por un canal L2CAP del
  Bluetooth (Android 10+ en los dos; `l2` en el kx). Es un flujo directo sobre la conexión Bluetooth, sin GATT, sin
  trozos con confirmación ni base64; usa lo mismo que el Wi-Fi (archivo cifrado en disco, `BigNet` ahora con flujos):
  A → B `gq` { via:'l2' }, B abre el canal (`bigServeL2`) → `ga` { psm, token }, A lo manda (`bigSendL2`). Orden de
  caminos: mismo Wi-Fi > Wi-Fi Direct > Bluetooth L2CAP. La tarjeta dice "(Bluetooth)"; el diagnóstico,
  `[L2CAP] … KB/s`.
- Simulado (`big.js --l2`, ~100 KB/s supuestos): 4 MB en 43 s, corte a mitad → "Toca para reintentar" → llega; con un
  teléfono sin L2CAP (`--b-no-l2`) o ninguno (`--no-route`) sale el aviso como antes. JVM: `BigFileTest` por flujos.
  La velocidad real del L2CAP no se puede simular: hay que medirla en los teléfonos (`[L2CAP]` en el diagnóstico).
- Fase 2 (pendiente): usar el L2CAP también para fotos, vídeos HD y archivos medianos (hoy por GATT, ~20 KB/s).

## Ronda 2757: MTU pequeño (punto 8), Fénix con fotos y archivos (punto 9), Jump por Wi-Fi (punto 10), app cerrada (punto 12)
- **Recibir por Bluetooth con la app cerrada** (`BgInbox.kt`): al cerrar la app (handleOnDestroy) el servidor GATT y
  las conexiones siguen (el proceso vive por el `BleService`; solo se deja de escanear). Lo que llega: un mensaje de
  un NEXO ID va al buzón en disco (`nexo_bg_inbox.jsonl`, máx. 3 MB), el Kotlin manda la confirmación de entrega
  (✓✓ en el emisor) y avisa "Mensaje nuevo" (sin texto: va cifrado; con el nombre si la escucha de internet lo tiene);
  las acciones ocultas (borrar para todos…) van marcadas `q:1` y no avisan; el primer trozo de una foto/vídeo/archivo
  solo avisa ("📷 Foto"…; el emisor lo manda al abrir). Al abrir la app, la instancia nueva retira a la vieja y
  entrega el buzón en orden. Simulado en `background.js --scenario=closed` (`--old-kotlin` = antes): antes A veía
  m1/m2 en rojo (fallido) y B nada; ahora A los ve entregados con B cerrada, B tiene la notificación (2 mensajes, sin
  duplicar) y al abrir llegan. Encontrado al probarlo: lo que llegaba al abrir la app antes de cargar el NEXO ID
  propio no se podía descifrar (va en los datos autenticados) y se perdía; ahora espera (también arregla mensajes
  retenidos al reabrir). Falta probar en teléfonos: que Android no mate el proceso con la app cerrada (depende del
  fabricante y del ahorro de batería).
- **MTU**: al conectar, el Kotlin pedía el MTU (512) y en el acto activaba las notificaciones; Android hace una sola
  operación GATT a la vez y a menudo se perdía la petición del MTU: la conexión se quedaba en 23 bytes (20 por
  escritura, todo ~20 veces más lento). Ahora: MTU primero, notificaciones al contestar (o a los 2 s); si queda en 23,
  se pide otra vez. No se puede simular (Android): el diagnóstico dice `[MTU] nx…: N` y `BT_ERR` si queda en 23.
- Trozos de texto por bytes reales (`Utf8Split`, MTU − 3, máx. 512) en vez de caracteres con 10 de margen; cada
  escritura sigue siendo UTF-8 válido (las builds anteriores la leen igual). Trozo mínimo con MTU pequeño 240 (antes
  60: con 20 bytes por escritura el 60 % de la radio eran cabeceras). Medido (foto 45 KB): MTU 23 215 → ~95 s;
  con 2 % de pérdidas, 120 → 1018 s, 240 → 423 s, 360 → 567 s (por eso 240); MTU 185/247/512 algo mejor que la 2756.
- **Fénix fase 3** (`fenix.js` v3): fotos, notas de voz, previas de vídeo y archivos de hasta ~1 MB de cada chat, cada
  uno cifrado con K en 2 contactos con Fénix 3 (kx fx:3), en archivos aparte; los de más de 300 KB solo por el mismo
  Wi-Fi; límites 30 MB del dueño y 20 MB por contacto en quien guarda; el pingeo los prueba. Al recuperar vuelven a su
  mensaje (`vaultReplaceAttachment`). No van el vídeo HD ni los archivos grandes. `fenix.js` (sim): 2 archivos en 2
  contactos cada uno, ilegibles para ellos; tras recuperar, historial 6 de 6 y los 2 archivos idénticos. Encontrado al
  probar: un medio se perdía si el archivo aún no estaba en disco al armar el segmento de texto (ahora aparte, con
  reintento) y el límite de los segmentos de texto contaba los de medios (error tras recuperar).
- **Jump por Wi-Fi**: `jump.js --wifi-ab` (A–B solo por Wi-Fi, B–C por Bluetooth): todo llega (foto en 3 s), los
  puentes no leen nada. Ya funcionaba en la 2756: no hizo falta cambiar código.

## Ronda 2756: archivos grandes (pedido del dueño 24-10) e ID Bluetooth rotativo (plan punto 4)
**Archivos grandes.** Informe del dueño con la 2755: una foto llega; un APK de 24 MB "nunca salió ni llegó" y después
no llegaban más archivos. En el simulador (`big.js` con la 2755) el APK se rechaza con el aviso "demasiado grande" (el
máximo era ~22 MB) y lo siguiente sí llega: el bloqueo de después no se reproduce (pendiente del diagnóstico de los
teléfonos). El límite existía porque todo archivo pasaba entero por la memoria de la app (base64, cifrado y copias).
- Ahora, por encima de ~22 MB y con el contacto en el mismo Wi-Fi o con Wi-Fi Direct (hasta 1 GB), como Signal: la app
  lee el archivo a trozos de 512 KB y el nativo (`BigFile.kt`) los cifra a disco con una clave al azar del archivo
  (AES-GCM por trozo, con número de trozo y "último" en los datos asociados: no se pueden quitar, reordenar ni cortar);
  un mensaje normal cifrado lleva nombre, tamaño y la clave; el archivo cifrado va de disco a disco por un socket
  (mismo Wi-Fi: el receptor abre un puerto con un token; Wi-Fi Direct: como siempre, con el token en las credenciales
  cifradas). Al tocarlo se descifra a la caché y se abre (un APK se instala). `big_file.js`, `wifi_direct.js` v1.4.
- La tarjeta del chat dice en qué va: Preparando / Enviando / Recibiendo N %, "Toca para abrir"; si se corta,
  "No se pudo enviar · Toca para reintentar" (emisor) o "Toca para pedirlo" (receptor). Nada se queda bloqueado.
- Sin Wi-Fi ni Wi-Fi Direct con el contacto: aviso claro y no se manda nada. No se pueden reenviar todavía.
- Encontrado al probar: el reenvío automático de pendientes mandaba el mensaje del archivo grande como archivo normal
  (llegaba una tarjeta que no abría nada); y un corte a mitad dejaba Wi-Fi Direct 10 min sin usar con ese contacto
  (ahora solo si falla al conectar). Corregidos.
- Pruebas: `big.js` (mismo Wi-Fi, `--wd`, `--no-route`; en `ci.js`): 24 MB llegan y se abren idénticos (SHA-256) en los
  dos, la app nunca tiene más de un trozo (683 KB en base64), lo pequeño sigue llegando, corte y reintento. Con la
  2755 el archivo no sale. Kotlin: `BigFileTest` (5: idéntico, otra clave/id, cortado/tocado, socket de disco a disco
  con un intruso con token falso, nombres). El Kotlin del plugin solo se compila en GitHub: falta el teléfono.

**ID Bluetooth rotativo** (decidido por el dueño: "empieza por el 4"; diseño de `PENDIENTES.md`):
- En el aire, en vez del NEXO ID, "R" + 9 caracteres: HMAC-SHA256(SHA-256("nexo-rid-key|" + clave pública), época de
  15 min). Solo quien tiene la clave pública (los contactos) lo reconoce; cambia cada 15 min también con la app cerrada
  (lo calcula `BleService` con `RidToken.kt`, idéntico a `ble_rid.js`). El nombre del teléfono deja de anunciarse.
- NEXO ID visible solo con "Agregar" abierto (5 min) o sin contactos. Una build anterior ignora el código ("NX…" o nada).
- Jump y Fénix: los NEXO no reconocidos son "anónimos"; se conecta de paso y el kx dice quién es (`relay.identify`).
  El 'rq' lleva los códigos de ahora del destino ('dk'): un puente que no lo conoce lo reconoce al escanear.
- Pruebas: `rid.js` (épocas de 20 s; en `ci.js`): en el aire solo códigos que cambian, ni NEXO ID ni nombre; un
  desconocido no los ve; tras 2 cambios de código se reconectan y llega lo pendiente; con "Agregar" abierto visible.
  Con la 2752 falla (el NEXO ID sale 6 veces y el desconocido los ve). Kotlin: `RidTokenTest` (vectores de la app).
  `run`, `jump` (desconocidos, cadena), `fenix` (recupera con 5 contactos) y mezcla con la 2752 en verde.
- Diagnóstico (2755, también aquí): `BT_ERR` y `[BIN]`.
- Batería completa (bat39, 62 ejecuciones): igual que bat38 salvo tiempos y textos; nuevas en verde (`rid`, `big`,
  `big --wd`, `big --no-route`); `jump --net` (que en bat38 dejó una foto en "enviando") en verde. Las 13 pruebas de
  GitHub en verde (con `rid.js` y `big.js`).

## Ronda 2753–2754: Bluetooth sin base64 (plan del dueño, punto 7)
- Antes cada trozo de un archivo viajaba como texto JSON con los datos en base64: ~450 bytes por la radio para 270
  bytes reales. Ahora los trozos de datos van en binario (`BinFrame.kt`): `0x01` + largo de la cabecera (2 bytes) +
  largo de los datos (4) + cabecera JSON + bytes. Un mensaje de texto nunca empieza por `0x01`: conviven en el mismo
  canal. Al llegar, el nativo (`BinAssembler`) junta las escrituras y entrega cabecera + datos en base64; la app
  (`_prePayload`) rehace el trozo de siempre, así que lo de arriba (comprobación `k`, cifrado, ensamblado) no cambia.
- Solo con quien lo anuncia: `bf: 1` en `kx`, pings y acks (`ba`, `n`); un `kx` sin `bf` lo quita (build anterior).
  Nunca por Jump (trozos con destino), Wi-Fi ni internet, ni el trozo 0 (lleva la miniatura). Un trozo va en binario
  solo si es base64 canónico (al volver a base64 sale idéntico); los trozos se alinean donde empiezan los datos tras
  la cabecera del cifrado. Si el nativo no tiene `sendBinary`, sigue en JSON.
- Si se pierde el final de un trozo (el emisor descarta el resto tras no poder escribir), el siguiente trozo o mensaje
  se reconoce por su inicio (`{"v":` / `{"type":`) y no se pega al roto; uno a medias más de 4 s se descarta.
- Simulador (`tests/sim/binary.js`, en `ci.js` con 2 % de pérdidas; `native_mock` replica `BinFrame`/`BinAssembler`):

  | Caso | Antes (2752) | Ahora |
  |---|---|---|
  | Foto 45 KB, MTU 512 / 247 / 185 | 6,1 / 10,6 / 15,6 s | 4,5 / 8,5 / 10,6 s |
  | PDF 150 KB, MTU 512 / 247 / 185 (`perf.js`) | 44 / 87 / 125 s | 31 / 65 / 83 s |
  | PDF 150 KB, bytes por la radio (MTU 247) | 254 KB | 190 KB |
  | MTU 185 con 2 % de escrituras perdidas: fotos / PDF | 111 y 47 s / 184 s | 34 y 50 s / 131 s |
  | MTU 23 (foto) | 252 s | 215 s (ahí pesan las cabeceras: punto 8) |

  Nueva ↔ 2752 en los dos sentidos (`--old-a`/`--old-b`): nadie manda binario y todo llega; `mixed.js` y Jump con
  puente 2752 también. Kotlin: `BinFrameTest` (8 pruebas: cualquier MTU, texto que pasa tal cual, datos que parecen
  JSON, varios teléfonos, trozo cortado, trozo sin final, cabecera rota, acentos).
- Batería completa (bat38, 58 ejecuciones): igual que bat37 salvo tiempos (HD de vídeo 42 → 30 s) y una vez la foto de
  `jump.js --net` quedó en "enviando" con ~30 pruebas a la vez; no se repitió en 9 ejecuciones (6 en paralelo) ni
  afecta a ese camino (Jump nunca usa binario). Las 11 pruebas de GitHub en verde.
- Kotlin del plugin: `sendBinary`, la cola de escritura admite bytes, lo recibido se lee como bytes
  (`processReceivedBytes`). Solo se compila en GitHub: falta probarlo en teléfonos.

## Ronda 2752: reestructuración (plan del dueño, punto 6: "con mucho cuidado de no romper nada") — `docs/ESTRUCTURA.md`
- `src/main.js` 4.281 → 720 líneas (punto de entrada) y `src/ui/ble_interface.js` 3.732 → 847 (núcleo de la clase),
  repartidos en 30 módulos por tema (chat, cámara, vídeo, archivos, perfil, Bluetooth: mensajes, conexiones, claves,
  enlaces, interfaz…). Los métodos de la clase se añaden con `Object.assign(BLEInterface.prototype, …)`.
- **Sin cambios de código**: todo se movió con herramientas (`tests/sim/extract.js`, `extract_methods.js`) que cortan
  el texto exacto; en cada paso `same_text.py` comprobó que lo quitado es exactamente lo que está en el módulo y
  `undef.js` que no queda nada sin definir (ahora también en GitHub). Lo que un módulo necesita de main.js se lo da
  main.js al arrancar (pegamento marcado `[pegamento]`); nunca se mueve una variable que otro sitio reasigna.
- Comprobado: 26 pasos; las 10 pruebas de GitHub tras cada tanda; batería completa en 3 puntos de control (bat35,
  bat36, bat37; 53 ejecuciones): idéntica (bat37 sin ninguna diferencia con bat36; antes solo variaciones de tiempo).
- Lo nativo (Kotlin) no cambia.

## Ronda 2751: notificaciones, no leídos e internet en segundo plano (pedido del dueño: puntos 11 + notificaciones + burbujas)
- **No leídos**: reproducido en `tests/sim/unread.js` con la 2744: de texto corto, texto largo y foto solo contaba el
  corto (los largos y los archivos nunca sumaban); con el chat abierto en segundo plano mandaba "leído"; al abrir el
  chat no confirmaba la lectura de lo pendiente. Nuevo `src/ui/notify.js`: un solo punto por el que pasan todos los
  mensajes recibidos (`_handleIncomingMessage`), contador por chat (`bumpUnread/clearUnread/unreadSummary` en
  `ble_interface.js`), "leído" solo con el chat abierto y la app a la vista, sin repetidos.
- **Notificaciones del teléfono** (`MsgNotifier.kt` + `UnreadBook.kt`): una por chat con el nombre y el número
  (el icono de la app muestra la suma en los lanzadores que lo admiten); con el bloqueo de la app activado sin texto;
  en la pantalla de bloqueo solo "Mensaje nuevo"; tocarla abre el chat (también con la app ya abierta:
  `handleOnNewIntent`). **Faltaba declarar `POST_NOTIFICATIONS` en el manifiesto** (en Android 13+ no se podía mostrar
  ninguna) y quien ya tenía los permisos de Bluetooth nunca lo pedía: ahora se pide al arrancar.
- **Internet en segundo plano** (`NetBg.kt`, `WsClient.kt`, `Secp256k1.kt`; `docs/INTERNET.md` § Segundo plano): el
  emisor marca `n` = msgId dentro del sobre cifrado de los mensajes nuevos; con la app en segundo plano la parte nativa
  escucha los relés con las etiquetas del día, se identifica (NIP-42) y avisa. JVM: firmas, etiquetas, sobres e ids
  iguales que la app y de punta a punta con un relé que exige identificación. Sim: 3/3 mensajes con aviso, 0 en
  saludos o confirmaciones.
- Efecto en otras pruebas: varios estados pasan de ✓✓ "entregado" a "leído" (abrir el chat ahora confirma la lectura,
  como debe ser) y en `chatactions` la burbuja de B ya no sube con el chat abierto a la vista (antes subía: fallo).
- Pruebas en GitHub: 10 escenarios del simulador + 34 JVM. Batería completa (bat34, 53 ejecuciones) sin fallos.
- **No comprobado en teléfonos**: la notificación real, el número del icono (depende del lanzador) y la escucha
  nativa con el ahorro de batería de cada marca.

## Ronda 2749: plan del dueño, punto 5 (Gradle moderno y Tor más nuevo)
- AGP 8.2.1 → **9.4.0**, Gradle 8.5 → **9.6.0**, Kotlin 1.9.20 → **2.2.20**, compileSdk 34 → **37.1**; `targetSdk` sigue
  en 34 (lo que cambia el comportamiento de la app en el teléfono no se toca). Tor 0.4.9.5 → **0.4.9.14** (misma API;
  `socksPort` pasó a privado y el código ya usaba `getSocksPort()`).
- Ajustes: `android.builtInKotlin=false` y `android.newDsl=false` (los módulos de Capacitor 5 usan el DSL antiguo y
  `kotlin-android`); `kotlinOptions` → `kotlin { compilerOptions }`; `proguard-android.txt` → `-optimize` (la
  reducción de código está apagada, no cambia la APK); `scripts/agp9-patch.sh` ajusta en GitHub los módulos de
  Capacitor que vienen de npm (después de `cap sync`).
- Comprobado en GitHub: compila (2747 con AGP 9.2, 2748 con AGP 9.4, sin avisos de versión), firma 23d86688…, y las
  pruebas (Kotlin + simulador) pasan. El JavaScript no cambió respecto a la 2744.
- **Riesgo**: compilar con otras herramientas puede cambiar detalles en tiempo de ejecución que el simulador no ve
  (el simulador prueba el JavaScript, no el Kotlin compilado). Probar en los teléfonos: Bluetooth, Wi-Fi, Wi-Fi
  Direct, huella y Tor (Perfil → Internet). Si algo nativo falla, volver a la 2744.

## Ronda 2744: plan del dueño, puntos 1–3 (limpieza, pruebas en cada build, emojis) — `docs/PENDIENTES.md` §5
- **Pruebas en cada build**: el workflow tiene un trabajo `tests` (Kotlin JVM, 25 pruebas, y `tests/sim/ci.js`, 9
  escenarios del simulador en paralelo); si alguno falla no se compila ni se publica la APK y la salida trae los
  registros. Comprobado que falla con una build vieja (`net.js` con la 40fe10c).
- **Fallo real encontrado por GitHub**: allí hay salida a internet y los "teléfonos" se conectaban a los relés
  públicos; Jump mandaba la foto al puente **por internet** (con datos móviles los archivos no van por internet) y
  se quedaba en "enviando" aunque el puente estaba al lado por Bluetooth. Reproducido con `jump.js --net` (relé
  local). `ble_relay.js` v2.3: el vecino por Bluetooth o Wi-Fi local antes que por internet, y los archivos de Jump
  solo por internet si los dos están en Wi-Fi (si no, Bluetooth). Las pruebas ya no usan relés públicos.
- **Emojis**: llegaban bien (los trozos ya respetaban los emojis), pero la vista previa de la lista y las citas cortaban
  un emoji por la mitad (salía "�"). Reproducido en `e2e.js` y corregido (`_cut`).
- **Limpieza**: registros con la versión real (decían v6.1.1 y v3.2.12), fuera `NordicMeshService` (no existe) del
  manifiesto, tarjetas de pago (función antigua) con el texto escapado.
- **ID Bluetooth rotativo**: no aplicado (ver PENDIENTES §5 punto 4).
- Batería completa (bat32, 52 ejecuciones con `jump --net`) sin cambios respecto a la 2739.

## Ronda 2739: internet por relés públicos y Tor (decisión del dueño: "2 y 3 por ahora") — `docs/INTERNET.md`
- Pedido: "si estoy en Wi-Fi y el otro también, sea el mismo módem o no, la conexión debe ser Wi-Fi" y "con Wi-Fi
  debería poder llegar a cualquier lado". Entre módems distintos hace falta un punto de encuentro en internet; el dueño
  eligió relés públicos y Tor, sin servidor propio.
- `src/net/net_link.js` (nuevo): relés Nostr públicos (cuatro a la vez). Cada pareja tiene un secreto propio (ECDH de
  las identidades); los eventos van cifrados (AES-GCM) encima del cifrado de siempre, a una etiqueta que cambia cada día
  y firmados con una clave al azar: el relé no ve texto, tipo de mensaje ni NEXO IDs. Identificación NIP-42 con la
  clave de la etiqueta. Saludos para saber quién está en línea; buzón con caducidad (✓ al guardarse, ✓✓ al confirmar).
- Enlace `net:<NEXO ID>` en `ble_interface.js`/`ble_ack.js`: mismo protocolo que Bluetooth/Wi-Fi. Orden: Wi-Fi del
  mismo router → internet si los dos están en Wi-Fi → Bluetooth → internet con datos móviles (solo textos) → Jump →
  buzón → pendiente. Solo con contactos que lo anuncian (`nt:1`).
- Tor (Kotlin, `tor-android` 0.4.9.5): servicio oculto por teléfono; la `.onion` va dentro del saludo cifrado; si los
  dos tienen Tor, la pareja habla directo por Tor (los relés no reciben nada de la conversación). Lo que no se descifra
  con la clave del contacto cierra la conexión. Arranca solo con Wi-Fi; se apaga en Perfil → Internet.
- Compilación: la 0.4.9.13 (clases Java 24) y la 0.4.9.8 (pide compileSdk 37) no compilan con AGP 8.2; la 0.4.9.5 sí
  (excluida del Jetifier, también en el workflow). Las CPU x86 no se incluyen (solo ARM) para no inflar la APK: aun así pasa de 10 MB (2734) a 26,9 MB.
- Pruebas: `net.js` con un relé Nostr local (`nostr_relay.js`): en línea 0,4 s, texto 0,2 s, foto de 300 KB 2,6 s, 0
  escrituras Bluetooth, los relés no ven nada, buzón y datos móviles correctos. `net.js --tor`: Tor 1,6 s (modelo),
  0 eventos a los relés durante el envío, impostor expulsado. JVM: `LanHubTorTest` (SOCKS real). Batería completa
  (bat30, 51 ejecuciones) igual que la de la 2734.
- **No comprobado**: relés públicos y red Tor reales (desde el entorno de desarrollo no se alcanzan); recibir por
  internet con la app en segundo plano (pendiente).

## Ronda 2734: escaneo de la red Wi-Fi (idea del dueño: "en cuanto tenga Wi-Fi, escanear a través del módem")
- El dueño pidió que, estando los dos en Wi-Fi, la conexión sea Wi-Fi. Reproducido en `tests/sim/lanscan.js`: con un
  router que no deja pasar el anuncio mDNS (habitual en repetidores, mallas y routers de operadora) la 2732 nunca los
  encontraba y, lejos de Bluetooth, el texto no llegaba.
- Kotlin `LanBeacon` (UDP 47824): pregunta a toda la red (difusión) al entrar en una red Wi-Fi (aviso de Android),
  al volver a la app y cada minuto; dirección por dirección (hasta /22) al entrar, al volver y cada 5 min. Contesta
  con la marca del día. 4 pruebas JVM con UDP real (pregunta/respuesta, basura y repetidos, direcciones de la red, del
  escaneo a la conexión LanHub). `lan.js` v1.2: busca al entrar en la red; el diagnóstico dice cómo se encontró.
- Resultado `lanscan.js`: encontrados en 0,2 s por escaneo; texto 0,2 s y foto de 300 KB 0,6 s sin Bluetooth; al volver
  al Wi-Fi 0,2 s. Módems distintos: sin camino (hace falta internet con punto de encuentro; decisión del dueño).
- Batería completa (bat28, 49 ejecuciones) sin cambios.

## Ronda 2732: Jump con más alcance y Fénix fase 2 (pedido del dueño: "termines la seguridad, fénix y mejores jump")
- **Largo alcance** (Kotlin): además del anuncio normal, anuncio extendido en **LE Coded PHY** (~4x distancia) si el
  teléfono lo tiene; el escaneo recibe los dos; se conecta en Coded solo a quien únicamente se ve por largo alcance (en
  1M es más rápido) y ese enlace no pasa a 2M (tiene menos alcance). Sin teléfono no se puede medir la distancia:
  compila (2731) y en el diagnóstico sale si el teléfono lo tiene.
- **Hasta 8 saltos** (`ble_relay` v2.2; antes 4). `jump.js --chain=7` (6 saltos): texto 0,8 s, foto 12,8 s;
  `--chain=9` (8 saltos): texto 1 s, foto 16,8 s; los puentes no ven el remitente.
- **Fénix fase 2** (`docs/FENIX.md`): mensajes de texto en segmentos cifrados con K, cada uno en 2 contactos con
  Fénix 2, pingeo de segmentos, y al recuperar la cuenta los contactos los devuelven (6 de 6 en `fenix.js` y
  `--mirror`). Fotos y archivos: siguiente fase.
- **Encontrado al probar 7 teléfonos**: el "+" de una fila de "dispositivos nuevos" no hacía nada si entretanto empezaba
  otro escaneo automático (la lista interna se vaciaba y la fila seguía en pantalla). Corregido. En las pruebas, el
  teléfono G tenía una dirección no hexadecimal (por eso no conectaba) y el emparejado no esperaba la clave.
- Batería completa (bat27, 48 ejecuciones) sin cambios de tiempos respecto a la 2730.

## Ronda 2730: Wi-Fi con las reglas del dueño + seguridad (remitente oculto, poscuántico, QR)
- **Informe del dueño con la 2728**: "estaba en Wi-Fi y al mandar una foto cambió a Bluetooth" (mismo router).
  Reglas que dio (`docs/PENDIENTES.md`): Wi-Fi del mismo router primero; un corte breve no es motivo para cambiar; con
  mala señal medida puede pasar a Bluetooth y volver. Reproducido en `lan.js`: con la app en segundo plano Android no
  ejecuta el JavaScript, el latido de la app no salía y el otro daba el Wi-Fi por caído. Corregido: latido **nativo**
  en `LanHub` (`h:0`/`h:2` cada 4 s, contestado desde Kotlin; caída a los 30 s, mide el tiempo de ida y vuelta),
  margen de 8 s antes de cambiar de camino, mala señal = ida y vuelta >1,5 s o 12 s sin nada (dos veces seguidas;
  vuelve con <0,8 s). Además: el último trozo de cada ventana esperaba 28 s cuando la cola nativa estaba llena (se
  aparcaba): ahora la cola llena responde "ocupado" y se reintenta al momento.
  Resultados `lan.js`: 40 s en segundo plano → sigue en Wi-Fi, foto en 1 s; corte breve → foto por Wi-Fi en 4,4 s,
  0 trozos por Bluetooth; mala señal → Bluetooth en 5,6 s y vuelta al Wi-Fi en 8 s; salir de la red a mitad →
  Bluetooth tras el margen (8,2 s), archivo completo; caída silenciosa → texto en 19 s.
- **Seguridad** (`docs/SEGURIDAD.md`, fase 3 segunda parte): remitente oculto a los puentes de Jump (sobres `sx`),
  acuerdo poscuántico híbrido ML-KEM-768 (`e2e_ratchet` v1.1; claves de los contactos en `nexo_ratchet_pq.json`
  para no reescribirlas con cada mensaje) y QR del número de seguridad (`src/ui/qr_verify.js`). Librerías nuevas
  (fijadas): `@noble/post-quantum` 0.5.4, `jsqr` 1.4.0, `qrcode-generator` 1.4.4.
  Encontrado y corregido al probar: con un puente 2728 el texto corto sellado no llegaba (lo envolvía como texto
  suyo) → solo se sella si el primer puente lo entiende y el destino desenvuelve ese caso; las confirmaciones
  selladas se acumulaban en la cola del puente (22) → el destino confirma cada sobre al puente (`rk`).
- Pruebas: `ratchet.js` 51/51; `jump.js` normal, cadena, compartido, desconocido, batería baja, reenvío directo y
  puente 2728 (puentes sin ver el remitente salvo con el 2728; todo llega; cola del puente vacía al final);
  `qr.js` en Chromium con cámara falsa; `mixed.js` con la 2728 y la b9c412f; batería completa (45 ejecuciones) sin
  cambios de tiempos. Arreglado en las pruebas: 13 pulsaban el "+" vacío de la barra antes de que apareciera el
  teléfono encontrado (por eso `bg_bg` fallaba a veces: no emparejaban); `bridge.js` y `qr.js` en Chromium ya
  emparejan.
- Visto y no tocado (ya pasaba con la 2728, 3 de 3): `jump.js --direct-later` no entrega la segunda foto en los
  120 s de la prueba cuando A y C quedan a alcance directo. Pendiente de investigar.

## Ronda 2728: Wi-Fi normal y cambio automático de camino (pedido del dueño) — `docs/WIFI.md`
- Kotlin `LanHub.kt` (TCP con marcos, saludo, una conexión si conectan los dos a la vez; 6 pruebas JVM con sockets
  reales) + NSD en el plugin (`lanStart/Connect/Send/Drop/Stop`, avisos `onLan*`), permiso
  `CHANGE_WIFI_MULTICAST_STATE`. `src/ui/lan.js`: marca del día (solo la reconocen contactos), comprobación con el
  cifrado (`lv`/`lw`), latido 8 s / caída a 25 s, impostor cerrado a 30 s.
- `ble_interface`: dispositivo `lan:<NEXO ID>` preferido; `_lanUp/_lanDown/_onLanPayload/linkOf`. `ble_ack`: trozos de
  24 KB por Wi-Fi; `relink` + `ChatStream.useLink` (sigue por Bluetooth a mitad); reanudar por el mejor camino; un
  envío sin camino ya no se reintenta para siempre cada 200 ms (busca otro y, a los ~2 min, queda pendiente).
  Kotlin: un mensaje mayor que la cola entera entra con la cola vacía.
- `tests/sim/lan.js` (modelo de red en `native_mock`): verificado 0,2 s; texto 0,2 s y foto de 400 KB en 1 s sin
  Bluetooth; nada en claro por la red; sin alcance Bluetooth sigue por Wi-Fi; salir de la red a mitad de un archivo de
  1,2 MB → termina por Bluetooth idéntico; caída silenciosa → texto por Bluetooth en 30 s; impostor nunca comprobado y
  cerrado; cabecera "En línea · Wi-Fi" / "· Bluetooth". Batería completa (44) sin cambios.

## Ronda 2725: fotos paradas y "mensaje de código" (informe del dueño con la 2722)
- Reproducido con un modelo fiel de la cola nativa (`native_mock`: `busyFail` = Android rechaza escrituras por
  ocupado, `kotlin2722` = reglas antiguas, `mtu`, `dropMidEvery`, `bridgeMs`): con MTU 185 y 30 % de rechazos,
  las fotos de A y B se quedan en 25 % / "!" para siempre (como en el teléfono); un paquete mutilado sale en el
  chat como "mensaje de código" (y se guardaba dos veces).
- Causas: (1) la cola nativa, tras 3 rechazos por ocupado, descartaba UN trozo del medio de un mensaje (y con la
  cola llena, también); (2) el receptor solo limpiaba el búfer tras 5 s sin trozos nuevos (con reenvíos
  llegando, nunca): todo lo siguiente quedaba tragado; (3) un trozo perdido dentro de los datos deja un JSON
  válido con datos más cortos: se aceptaba y la foto no se podía descifrar (perdida en silencio, emisor con ✓);
  (4) la 2722 escuchaba todos los registros nativos (uno por trozo): más carga en el hilo principal = más
  rechazos por ocupado (por eso "antes no pasaba").
- Correcciones: Kotlin — un mensaje entra entero en la cola o espera; rechazos: reintento 15/50 ms hasta ~1,8 s
  y luego fuera el mensaje entero; receptor: lo pendiente con más de 10 s se descarta (resincroniza); solo
  AT_REST/FILE_IO cruzan a la app. JS — cada trozo lleva comprobación `k` (FNV-1a; builds anteriores la
  ignoran) y uno dañado se vuelve a pedir al momento; paquetes con JSON roto o sin v/t/type no van al chat.
- Resultado (foto 150 KB, MTU 185): sin fallos 46 s; con 85 trozos mutilados 49 s; con 30 % de rechazos 59 s;
  siempre idénticas y sin código. Batería completa sin cambios (43 pruebas).
- Pruebas nuevas: `photos.js` (`--busy`, `--mtu`, `--drop-mid`, `--inject`, `--cut`, `--camera`, `--wd`),
  `bridge.js` (Chromium; no llega a emparejar con la CPU frenada: pendiente).

## Ronda 2722: el envío de textos se volvió lento con la 2720 (informe del dueño)
- Causa 1 (reproducida en `tests/kotlin`): la migración del cifrado en reposo releía enteros todos los
  archivos de NEXO en cada arranque, con un único cerrojo: un guardado pequeño (las claves del protocolo 2
  se guardan antes de cada envío) esperó 4,3 s con 6 archivos de 20 MB. Ahora: un cerrojo por archivo, solo
  se lee la cabecera de lo ya cifrado (240 MB → 0 leídos), migración por trozos y a prioridad baja. 4 ms.
- Causa 2: Capacitor ejecuta todas las llamadas al plugin en un hilo y en fila; guardar/leer un archivo grande
  (ahora además cifrado) retrasaba `sendMessage`. Archivos en hilos propios (adjuntos aparte; el orden de
  cada archivo se mantiene). `native_mock` modela ese hilo (`pluginThread`, `ioOffThread`) y
  `tests/sim/iolatency.js` lo mide (texto tras un archivo de 1,5 MB: 0,5 s → 0,2 s con 150 ms/MB supuestos).
- Interfaz (Chromium, CPU 4x, `stress.js`): igual que la 2717 (ráfaga de textos 7,8 s / 7,6 s; burbuja propia
  ~20 ms); fotos + textos 9,2 s / 7,6 s por las fotos de 800 px.
- El diagnóstico ahora trae el tiempo de cada texto y los avisos nativos de archivos (antes `remLog` no
  llegaba al diagnóstico).
- Ojo: el cifrado de Java en el servidor va a ~60 MB/s; en Android lo hace Conscrypt (sin medir aquí).

## Ronda 2720: seguridad fase 3, primera parte (ver `docs/SEGURIDAD.md`)
- Cifrado en reposo nativo (`AtRestStore.kt`, AES-256-GCM, clave de datos envuelta por el Android Keystore):
  transparente para el JS (`saveToFile` / `loadFromFile`), archivos antiguos se leen y se migran solos (solo
  `nexo_*`). Pruebas JVM en `tests/kotlin` (7, `gradle --no-daemon test`).
- Perfil → Seguridad (`src/ui/app_lock.js`): bloqueo opcional con huella/PIN (inmediatamente / 1 min / 30 min)
  y bloquear capturas (`FLAG_SECURE`). Prueba `tests/sim/lock.js`; encontrado al probar: con el PIN, Android
  abre otra pantalla y la app "se va" y "vuelve"; sin protección, al quitar el bloqueo volvía a pedir la huella
  (bucle). Protegido y comprobado con mutación.
- Batería completa (36 pruebas) sin cambios respecto a la 2718.

## Ronda 2718: chat tipo WhatsApp y cámara
- Chat: menú al mantener pulsado (o clic derecho), deslizar = responder, cita tocable, reenviar a varios chats,
  copiar, eliminar para mí / para todos (24 h, solo mensajes propios). Formatos `nexo_txt` / `nexo_act` solo a
  contactos con `fx` (2715+). Encontrado en la prueba y corregido: tras eliminar para todos, la lista de chats
  seguía mostrando el texto borrado.
- Cámara: rehecha (pestañas, disparador, contador con límite, linterna, galería, revisar/repetir/enviar). El
  selfie no estaba en espejo (por eso se veía "al revés"); ahora la vista frontal es espejo y la foto sale
  igual que se ve (comprobado en Chromium con una imagen asimétrica). El vídeo frontal se graba sin espejo
  (como sale de la cámara). Fotos a 800 px / 1600 con Wi-Fi Direct (antes 480).
- Pruebas: `chatactions.js`, `camera.js`. La batería separa las pruebas largas y de interfaz de las de tiempo
  real (`bg_bg` fallaba solo con la máquina muy cargada; sola pasa siempre).

## Ronda 2715: Protocolo Fénix, fase 1 (la cuenta) — `docs/FENIX.md`
- Definición del dueño en `docs/NEXO_CONTEXTO.md` §7; decisiones: cuenta primero, nodos = contactos
  (automático), 10 → 1.ª copia, 20 → 2.ª, perdido si no pinguea, recuperar con confirmación de los contactos
  (la huella no puede recuperar una clave en otro teléfono: se le explicó).
- `src/fenix/fenix.js` (reusa el Shamir de `shard_crypto.js`; ojo: `splitSecret` ya devuelve hexadecimal —
  el primer intento lo reconvertía y los nodos rechazaban los fragmentos, visto en la prueba).
- La cabecera de los flujos solo lleva campos conocidos: el tipo de paquete de Fénix va dentro del contenido.
- Prueba `tests/sim/fenix.js` (7 teléfonos, umbrales reducidos): reparto 7 s, pingeo, perdido a los 62 s y
  fragmento a otro en 0,5 s, borrado al volver, recuperación con 3 confirmaciones en 14 s (mismo NEXO ID,
  identidad y contactos; sigue hablando cifrado sin aviso de clave). `--mirror`: 2 copias. Batería OK.
- Encontrado de paso (simulador, no la app): el mock solo informa de lo visto al empezar un escaneo.

## Ronda 2714: ubicación y Wi-Fi Direct (informe del dueño con la 2713)
- Ubicación "no se envía ni llega": en el simulador el envío y la recepción funcionaban (`location.js --gps=ok`).
  Lo que fallaba era obtener la posición: sin señal de GPS (interior) no se veía nada ~35 s y el error se
  callaba. Ahora: aviso, GPS 12 s → última conocida/red → aviso claro (`--gps=indoor|timeout|off`). Causa en
  los teléfonos del dueño no confirmada (falta su diagnóstico).
- "HD por Bluetooth si ya va por Wi-Fi Direct": reproducido en `wifidirect.js` con la 2713: si se perdía el
  'wf' (confirmación por Bluetooth), el emisor daba el vídeo por fallido a los 45 s y lo reenviaba como
  previa + HD por Bluetooth aunque ya hubiera llegado. Ahora vale la confirmación del socket.
- "Wi-Fi Direct lento": sin medidas reales todavía; añadidos tiempos por fase al diagnóstico y comprobación
  del grupo cada 250 ms (antes 500).
- Base estable movida a la 2713 (`base-estable-2713`).

## Ronda 2713: Wi-Fi Direct se quedaba en 1 % (informe del dueño con la 2711)
- Causa 1: `NEARBY_WIFI_DEVICES` no estaba en el manifiesto de la app (comprobado en la APK publicada). En
  Android 13+ el permiso se deniega sin preguntar: Wi-Fi Direct nunca funcionó en esos teléfonos.
- Causa 2: con Wi-Fi Direct anunciado, el vídeo iba solo como original por Wi-Fi Direct; al fallar, no cabía
  por Bluetooth y quedaba "pendiente" para siempre (1 %), con la oferta repitiéndose en bucle.
- Reproducido en `tests/sim/wifidirect.js --broken=noperm` y `--broken=fail` con la 2711 (vídeo y archivo
  "enviando" para siempre, 24 ofertas). Corregido: permiso declarado; si falla, el vídeo pasa a previa + HD
  por Bluetooth (previa en 6,5 s) y un archivo que no cabe queda fallido con aviso; 10 min sin reintentar
  con ese contacto; 2 ofertas en vez de 24. Batería completa OK.

## Ronda 2712: seguridad fase 2 (ver `docs/SEGURIDAD.md`)
- Protocolo 2 = X3DH + Double Ratchet (`src/vault/e2e_ratchet.js`), elegido por contacto
  (`src/vault/e2e_proto.js`); kx y tarjetas con paquete de claves `b2`; sobre (emisor|destino|id) atado al
  cifrado; relleno; número de seguridad + verificado. Estado en `nexo_ratchet.json`.
- Fallo encontrado en la prueba y corregido antes de subir: al aceptar una clave nueva, lo pendiente salía
  con el protocolo 1 (el contacto aún no estaba marcado con el 2); ahora se marca antes de reenviar.
- Verificado: `ratchet.js` 40/40, batería completa (sin cambios de tiempos), `mixed.js` con la 2711 y la 2704
  (pasan al 2 al actualizarse), Chromium real (vídeo 38 s, HD 169 s, 3/3 reproducciones).

## Ronda 2711: seguridad fase 1 (ver `docs/SEGURIDAD.md`)
- APK no depurable y sin copias de seguridad; registros sin contenido; anti-suplantación (clave cambiada
  → retenido hasta que el usuario acepte o rechace en el chat). `tests/sim/impostor.js`.
- Ojo al dueño: si un contacto reinstala NEXO, ahora hay que pulsar **Aceptar clave nueva** en su chat
  (antes se aceptaba sola con un aviso). Es lo que impide que otro teléfono se haga pasar por él.

## Ronda 2709: Wi-Fi Direct para fotos, vídeos y archivos
Criterio del dueño: lo más cercano primero, con sentido común de velocidad; para archivos, Wi-Fi Direct
(directo teléfono a teléfono, sin terceros) antes que Jump/Wi-Fi/datos.
- Nativo (`NexoBlePlugin.kt`, Android 10+): `wifiDirectStatus`, `requestWifiDirectPermission`
  (NEARBY_WIFI_DEVICES en 13+, ubicación antes; se pide la primera vez que hace falta), `wifiDirectHost`
  (el que recibe crea un grupo con nombre y contraseña aleatorios en cada envío y abre un socket),
  `wifiDirectSend` (el que envía se une sin aviso del sistema con WifiP2pConfig.Builder, manda el
  contenido —ya cifrado E2E— y espera confirmación); el grupo se cierra al terminar.
- `src/ui/wifi_direct.js`: control por Bluetooth ('wq' oferta con la clave pública del emisor, 'wa'
  credenciales cifradas para el emisor, 'wn' no, 'wf' entregado). Se usa si los dos lo tienen (kx con
  `wd:1`), hay enlace directo y el contenido pasa de ~150 KB; si falla, sigue por Bluetooth (o queda
  pendiente si pasa del límite de Bluetooth). Una transferencia a la vez.
- `main.js`: con Wi-Fi Direct alcanzable el límite de archivo sube a ~22 MB y el vídeo va original sin
  previa ni HD aparte; sin él, todo como antes (el aviso de tamaño menciona Wi-Fi Direct).
- Simulador (`wifidirect.js`, ~2 MB/s): 600 KB en 4,5 s (0 trozos por Bluetooth) frente a 58 s por
  Bluetooth; 6 MB en 7 s; vídeo original en 5 s; si falla, por Bluetooth; credenciales y contenido nunca
  en claro. Batería completa (22 pruebas) en verde; Kotlin compilado en CI (2708). La velocidad real y el
  comportamiento con cada fabricante solo se ven en los teléfonos.

## Ronda 2707: Jump con cualquier teléfono NEXO (bajo demanda) + batería + selector de camino
El dueño: los únicos requisitos para ser puente son estar a alcance y tener NEXO (en la 2705 solo valían
teléfonos conectados, en la práctica contactos). Criterio de caminos acordado (seguridad y velocidad):
textos → directo, Jump, Wi-Fi, datos; archivos → directo (y Wi-Fi Direct cuando exista), Wi-Fi, Jump si el
tiempo es razonable; datos móviles siempre el último (cuestan dinero); sin señal, Jump para todo.
- Vecindario sin conectarse: cada NEXO visto al escanear (contacto o no) se anota 2 min.
- Búsqueda de camino bajo demanda ('rq'/'rp', máx. 4 saltos): cuando un mensaje propio no tiene enlace ni
  ruta; escaneo corto si hace falta, se pregunta a vecinos conectados y a cercanos (conexión de paso);
  quien vio al destino hace poco o tiene ruta contesta y la ruta queda puesta por el camino de vuelta. El
  puente conecta con el destino al usarla. Reintento con espera creciente (45 s … 10 min) solo mientras haya
  mensajes esperando: sin nada que enviar no se gasta nada extra.
- Conexiones de paso con desconocidos: máx. 3, se cierran tras 60 s sin uso; no se agregan como contacto
  ni salen en chats ni en el aviso de dispositivo nuevo. Se responde al kx (el lado que recibe la conexión
  también dice que entiende Jump) y su dirección se asocia al llegar sus paquetes.
- Batería (`getPowerStatus` en el plugin): con <15 % sin cargar o en ahorro de energía no hace de puente
  (no contesta 'rq', retira sus rutas, no da custodia); sus propios mensajes sí salen.
- Selector de camino (`relay.plan`): hoy directo o Jump (registra el tiempo estimado con la velocidad
  medida por salto); es donde se añadirán Wi-Fi Direct, Wi-Fi y datos.
- Fallos encontrados al probar y corregidos: 'rq'/'rp' sin marcar como paquetes de control (el puente los
  mostraba como mensaje y agregaba al emisor como contacto); conexión de paso que caía y no se borraba (el
  puente no volvía a conectar con el destino); al reconectar con un vecino conocido no se le repetía la
  pregunta pendiente.
- Lo más cercano primero: si el destino se vio hace <30 s se intenta directo (8 s) antes de buscar
  puente; un puente solo dice "llego" si lo vio hace <30 s (si no, escanea antes). Lo que salió por un
  puente y aún no tiene ✓✓ se reenvía directo en cuanto hay enlace con el destino (duplicado descartado
  por id): un puente que se quedó sin camino ya no deja el mensaje parado.
- Simulador: `jump.js --stranger` (B no es contacto de nadie), `--stranger --low-battery` y
  `--direct-later`. Resultados: con desconocido en medio el primer texto llega en ~15 s (incluye 8 s de
  intento directo y la búsqueda), largo y foto, ✓✓, leído, respuesta; B sin contactos ni chats;
  conexiones de paso cerradas solas (~80 s). Batería 10 %: B no hace de puente; enchufado, llega en ~55 s.
  Batería completa (21 pruebas) y Chromium real en verde. Kotlin (`getPowerStatus`) compilado en CI.

## Ronda 2705: Jump fase 2 — mensajes de varios saltos (A → B → C)
Pedido del dueño: saltos entre teléfonos, cualquier teléfono NEXO hace de puente, textos y fotos (el
cifrado de extremo a extremo de la 2702 era la fase 1). Nuevo `src/ui/ble_relay.js`:
- Rutas por vector de distancias: cada teléfono anuncia (`rt`) a sus vecinos conectados a quién alcanza y
  en cuántos saltos (máx. 4), sin devolver a un vecino lo aprendido de él; cada 30 s y al cambiar un
  enlace; caducan a los 95 s o al caer el vecino. Solo a vecinos que entienden Jump (su `kx` lleva
  `j:1`): una build anterior mostraba los paquetes desconocidos como mensajes de texto (comprobado con
  la 2701: también le pasa con el `kx` desde la 2702; con la 2704 ya no hay basura).
- Envío: si el contacto no está a alcance pero hay ruta, textos (cortos y largos) y adjuntos salen por el
  siguiente salto con su destino (`to` en paquetes, `dt`/`hp` en la cabecera de flujos), cifrados para el
  destino. El puente confirma que lo guarda (`rk` o el ack final del flujo) → ✓ en el emisor; lo apunta en
  una cola persistente (`nexo_relay_queue.json`, archivos aparte, tope 30 MB, 24 h) y lo reenvía; si se
  queda sin ruta, espera. El destino confirma de extremo a extremo (ack/leído dirigidos al origen) → ✓✓.
  Sin ruta ni enlace, el mensaje espera en el emisor y sale en cuanto aparece una ruta.
- Lo que llega por un puente no se asocia a la dirección del puente (contacto, mapeos). La clave de
  cifrado de un desconocido que escribe por un puente se guarda al crear el contacto; si falta se pide de
  extremo a extremo (`kx` dirigido; un puente nunca puede cambiar una clave ya conocida).
- Los puentes solo ven quién, a quién y los ids; no pueden leer el contenido ni lo muestran.
- Límite (resuelto en la 2707): los puentes eran solo teléfonos ya conectados (en la práctica contactos).
- Simulador: modelo de alcance (`radio.block/unblock`) y `tests/sim/jump.js` (A–B–C conocidos,
  `--shared` A nunca vio a C, `--chain` A–B–C–D con 3 saltos). Verificado: textos, largo y foto llegan,
  ✓✓ y leído vuelven, la respuesta vuelve, los puentes no leen ni guardan nada, custodia (C se aleja
  cuando B ya tiene la foto → la entrega al volver) y batería completa (19 pruebas) + Chromium real.

## Ronda 2704: archivos (APK sin aviso, PDF que no abría)
Dueño: "no puedo enviar APK (no sale ningún aviso)" y "los PDF llegan pero sin vista previa y no abren".
- Sin aviso: el `<input>` del selector se quitaba a los 30 s; si se tardaba más en elegir (buscar la APK en
  Descargas, un vídeo en la galería) lo elegido no hacía nada y sin aviso (reproducido en `files.js` con la
  2702). Ahora vive hasta que se elige (`_pickFile`), un error de lectura avisa y cada paso deja `[ATTACH]`
  en el diagnóstico. Las APK suelen pasar del límite de ~2,1 MB: ahora sale el aviso (subirlo depende de
  L2CAP, siguiente ronda).
- No abría: la burbuja de un archivo que no es foto/vídeo era solo una etiqueta, y el tipo (mime) no
  llegaba al otro teléfono (`_sendAttachment` pisaba `meta.type` con 'file'). Ahora viaja `mime`; la
  burbuja muestra icono, nombre (como texto: antes se metía como HTML), tamaño y páginas, y al tocar el
  plugin `openFile` lo escribe en la caché y lo abre con la app que corresponda (FileProvider +
  ACTION_VIEW). APK: permiso `REQUEST_INSTALL_PACKAGES`; Android pide permitir a NEXO instalar apps la
  primera vez.
- Miniatura PDF: `pdfThumbnail` (PdfRenderer de Android) dibuja la 1.ª página al enviar; viaja cifrada en
  la cabecera (`th`, páginas en `pg`); el receptor la genera si no llega.
- Verificado: batería jsdom (15 pruebas, nueva `files.js`) y Kotlin compilado en CI (run de la rama de
  trabajo, firma OK). La apertura real (lector de PDF, instalador) solo se puede comprobar en el teléfono.

## Ronda 2702: cifrado de extremo a extremo (fase 1 de "jump") + reenvíos inútiles
Plan acordado con el dueño para jump (saltos A → B → C, cualquier teléfono NEXO hace de puente, textos y
fotos): primero cifrar, después las rutas. Esta ronda es el cifrado.
- `src/vault/e2e_crypto.js` (WebCrypto): identidad ECDH P-256 por teléfono (`nexo_e2e_identity.json`,
  la privada no sale), clave por pareja ECDH → HKDF-SHA256 → AES-GCM 256, IV aleatorio por mensaje.
  Formato `E1:<pública emisor>:<iv>:<datos>`. Se cifra el contenido (textos cortos y largos, adjuntos,
  nombre y miniatura del archivo); quién/a quién/ids/acks van en claro (los necesitarán los puentes).
- Claves: paquete `kx` al conectar (y a petición, `rq`); la primera se guarda en el contacto (TOFU); si
  cambia (reinstalación) se acepta y se avisa (`keyChangedAt`). Al compartir un contacto va su clave:
  A puede cifrar para C sin haberlo visto (base de jump). Sin clave del destinatario se pide y se
  espera 5 s; si no llega → `NO_KEY` y el mensaje queda pendiente: **nunca sale en claro**.
- Chat: aviso arriba (🔒 / ⏳ esperando clave / ⚠️ clave cambió); al pulsarlo, huellas de ambos para
  comparar en persona. Líneas `[E2E]` en Perfil → Diagnóstico.
- Compatibilidad: un teléfono con una build anterior no descifra. Lo que se le envía espera (reloj) y
  llega cuando se actualiza; lo que manda él (en claro) sí se recibe. **Actualizar ambos teléfonos.**
- Fallo previo encontrado al probar (desde siempre): el registro de envíos salientes de un texto largo o
  archivo no se borraba al entregarse; al abrir la app (a los 3 s) o al reconectar con algo pendiente
  se volvían a enviar **todos** (hasta 50, vídeos incluidos), ocupando la radio minutos. Ahora se borra
  al entregar, y lo que dejó la build anterior se limpia sin reenviar (consulta el historial). Las
  escrituras de ese registro van en cola por contacto (dos borrados a la vez se pisaban).
- Otros: un ack repetido resuelve el reenvío que lo espera (antes un mensaje entregado acababa en rojo
  tras 5 reintentos si se enviaba dos veces); un mensaje cifrándose cuenta como "en vuelo" (no se
  duplica); la re-búsqueda solo se aplaza por un envío de archivo que avanza (uno parado porque el otro
  cerró la app la bloqueaba hasta su tiempo máximo).
- Verificado: batería jsdom completa (14 pruebas, con `e2e.js`, `mixed.js` contra la 2701 y
  `resend.js`), `browser.js` en Chromium real (WebCrypto real: vídeo 720p, previa 38 s, HD 169 s,
  13,3 KB/s como antes, 3/3 reproducciones). En 1 de ~10 ejecuciones de la batería el escenario
  "app cerrada + vídeo" no entregó nada (sin log; no se volvió a reproducir en 8 repeticiones).

## Ronda 2701: vídeo previa → HD revisado
El dueño no veía el cambio a HD. Causa más probable: vídeos de la galería (cámara del teléfono: 1080p/4K,
10-25 MB por 5 s) superaban `MAX_HD_B64_BYTES` y solo viajaba la previa. Ahora, si el original es >2,5 MB
o >720p, en la MISMA pasada de la previa se graba un HD 720p a 1,2 Mbps (`HD_DIRECT_MAX_BYTES`,
`HD_MAX_SIDE`, `HD_REENCODE_BPS`); si no, el HD es el original. Etiqueta con tiempo restante
("HD 45% · ~2 min"), registro `[VIDEO] Previa entregada en X s` / `HD entregado en Y s (KB, KB/s)` y la
burbuja propia se pinta desde una URL del archivo (sin decodificar base64: quitaba ~1 s de bloqueo).
Chromium real (`browser.js`, `--big`): clip 720p 972 KB → previa 227 KB en 29 s, HD (original) a 126 s;
clip 1080p 2,1 MB → HD recodificado 1,66 MB, previa 33 s, HD 198 s. El simulador va a ~13 KB/s; en los
teléfonos del dueño se midieron ~4,4 KB/s (2695): previa ~1-1,5 min y HD ~5 min. La gran mejora
pendiente de velocidad es el transporte (binario / L2CAP) — ver pendientes.

## Ronda 2700: rendimiento (medido en Chromium real con la CPU frenada 4x)
Nuevo `tests/sim/stress.js` (3 teléfonos precargados, historial de B: 400 mensajes con 8 fotos y 2
vídeos) y `tests/sim/profile.js` (perfil de CPU por función). Misma prueba en 5 builds:

| Receptor B | 2679 (base dueño) | 2691 | 2698 | 2699 | 2700 |
|---|---|---|---|---|---|
| Ráfaga 40 textos: CPU | 100 % | 82 % | 81 % | 84 % | 40 % |
| Ráfaga: congelón máx. | 43 s | 2,4 s | 1,7 s | 2,6 s | 0,08 s |
| Multi-chat: congelón máx. | 3,9 s | 0,17 s | 0,24 s | 0,24 s | 0,08 s |
| Abrir chat 400 msj: CPU | 5,4 s | 6,0 s | 4,8 s | 5,3 s | 1,1 s |
| Abrir chat: congelón máx. | 2,5 s | 2,4 s | 1,8 s | 1,9 s | 0,4 s |

Conclusión: entre 2691 y 2699 no hubo regresión de CPU; la lentitud venía de defectos antiguos que
crecen con el historial (por eso se nota más con el uso):
1. Cada mensaje dibujado programaba `scrollTop = scrollHeight` (relayout de todo el chat por mensaje).
2. Inserción de burbujas recorriendo todas las anteriores (O(n²) al abrir un chat).
3. Al abrir un chat el historial se cargaba y dibujaba DOS veces (`ble_interface.openChat` →
   `nexo:vault:messagesLoaded` con todo y sus adjuntos leídos de disco) y `nexo_app` registraba cada
   mensaje como "recibido".
4. Historial reescrito entero en disco con cada cambio de estado.
Arreglos: página de 60 mensajes (anteriores al subir), inserción desde el final, un scroll por fotograma,
mensajes nuevos al disco al momento y estados agrupados (300 ms). Además:
- **Fallo real**: "atrás" + abrir otro chat en <300 ms dejaba el chat nuevo sin contacto activo (mensajes
  pintados pero no enviados, fotos no enviadas). Afectaba a todas las builds anteriores.
- Radio: la re-búsqueda y el escaneo automático se pausan durante transferencias de archivo (comparten
  la radio). `perf.js --absent --scan-penalty=1.6`: PDF 150 KB 23,5 s (2699) → 18,4 s.
Pendiente medido: al enviar un vídeo, un bloqueo de ~1 s en el emisor (con CPU 4x; también en 2679).

## Ronda 2699 (verificada en simulador + Chromium real)
**Compartir contactos** (último botón del menú de adjuntos), como WhatsApp:
- Abre una hoja con los contactos (buscador, casillas, "Enviar (N)"); se envía un adjunto `contact`
  con `{ contacts: [{ nexoId, name }] }` por el camino de texto (como la ubicación). Sin dirección
  Bluetooth (cambia y no sirve al otro).
- En el chat aparece una tarjeta "👤 Contacto(s)". En el receptor, pulsarla (o "Agregar a contactos")
  llama a `bleInterface.addSharedContacts`: valida `NX`+8, omite el propio y los ya existentes; los
  nuevos quedan arriba **parpadeando** (`isNewShared`, clase `ble-contact-new`) hasta abrir su chat, con
  "Nuevo contacto · listo para escribir", y se empiezan a buscar por radio. "Escribir" abre su chat.
- Para que estén "listos para el uso": `openChat` ya no rechaza un contacto sin dirección conocida, y
  escribirle deja el mensaje en la cola por contacto hasta encontrarlo (antes "Dispositivo no
  encontrado"); adjuntos quedan pendientes (`PEER_ABSENT`).
- Nombres en la lista y la barra "en línea" como texto, no HTML (venían de otros teléfonos).
`tests/sim/share.js`: B nunca había visto a C → tras agregarlo, mensaje B→C en 1 s; con C fuera de
alcance queda "enviando" y llega a los 30 s al volver C. Batería completa y `browser.js` sin cambios.

## Ronda 2698 (verificada en Chromium real + simulador)
Prueba real de la 2697: el vídeo no llega, no pasa a HD, no se ve la miniatura y solo se reproduce una
vez. Nuevo `tests/sim/browser.js` (Chromium real): con la 2697 el ciclo completo funciona en Chromium
(previa real 177-230 KB, miniatura, HD, app cerrada) pero quedaban 3 reproductores vivos tras abrir el
visor 3 veces. Conclusión: lo que falla es propio del WebView de Android.
1. **Reproducir más de una vez**: cada burbuja creaba un `<video>` (preload=metadata) y el visor no se
   liberaba al cerrar; en Android cada reproductor retiene un decodificador de hardware. Ahora la burbuja
   muestra la miniatura (`<img>`), el reproductor solo existe en el visor y se libera
   (`pause`+`removeAttribute('src')`+`load`). Chromium: 0 reproductores vivos (antes 3).
2. **Previa que podía colgarse** (si el grabador no terminaba, el vídeo no se enviaba nunca): vigilante
   general, detección de atasco, vídeo temporal dentro de la pantalla (Android no decodifica ocultos),
   AudioContext reanudado o previa sin audio. Si falla: original con miniatura (`--no-preview`).
3. **Miniatura**: también sin previa (`_makeVideoThumb` del original) y, si un vídeo llega sin ella, se
   genera al dibujarlo y se guarda (`metaMerge`).
4. **Diagnóstico**: Perfil → Diagnóstico (eventos clave + últimas líneas, también de la sesión anterior)
   con botón Copiar. Es la forma de ver qué pasa en el teléfono real.

## Ronda 2697 (verificada en simulador)
Prueba real de la 2696: vídeo + texto a un teléfono con la app cerrada → al abrirla no llegó nada; la
previa no se veía; el vídeo recibido solo se reproducía una vez.
1. **Vídeo a contacto ausente perdido**: `sendFile` esperaba ~40 s a la dirección vieja, rechazaba "not
   ready", `main.js` lo trataba como transitorio y lo dejaba en 'sending'; como la transferencia no había
   empezado no había nada que reanudar y `_isResendable` excluía adjuntos en 'sending'. Ahora falla en 8 s
   (`PEER_ABSENT`), busca al contacto y el adjunto se reenvía al reconectar (adjuntos 'sending' sin
   transferencia viva son reenviables; `_sendFileJS` no duplica). El HD arranca también tras ese reenvío.
2. **Textos que no salían tras reabrir el otro**: `_pendingMessageQueue` iba por dirección Bluetooth; al
   reabrir, Android cambia la dirección y la cola vieja no se vaciaba nunca (y `_isMsgInFlight` impedía
   el reenvío). Ahora la cola es por contacto (`nx:<id>`) y se vacía en `_notifyPeerReady`.
   `background.js --scenario=closed --video --pre-wait=15000 --off=90000 --rotate`: 2696 nada; ahora
   textos 6 s, previa 11 s, HD 41 s tras reabrir.
3. **Vídeo que solo se veía una vez**: cerrar el visor revocaba la URL que usa la burbuja; además cada 50
   mensajes se revocaban todas. Ahora solo al salir del chat (`video.js`: 2696 URL destruida; ahora no).
4. **Miniatura**: fotograma JPEG de la previa en la cabecera (`th`) → `poster` del vídeo (en Android un
   `<video>` sin poster se ve gris/negro hasta reproducirlo).

## Ronda 2696 (verificada en simulador salvo la recodificación)
**Lista de contactos que saltaba**: se ordenaba por `lastSeen` (cambia con cada ping/escaneo/
reconexión). Ahora por `lastMessageAt` (último mensaje enviado o recibido; `noteContactMessage` en
`ble_interface.js`), la fila muestra ese mensaje y su hora, y se redibuja como mucho cada 300 ms (antes
con cada paquete). `window.vaultSaveContacts` no estaba expuesto: último mensaje/no leídos nunca se
guardaban. `tests/sim/contacts.js --churn`: 2695 cambiaba de orden sin mensajes; ahora estable.
**Vídeo en dos pasos** (`main.js` `_sendVideo`): previa recodificada en el teléfono (240p, 60-200
kbps, `_makeVideoPreview`: video → canvas + WebAudio → MediaRecorder) enviada como mensaje normal; al
llegar, el original va solo como transferencia `<msgId>_hd` (cabecera `hf`), con textos intercalados, y
en el receptor sustituye a la previa en el mismo mensaje (`vaultReplaceAttachment`). Estado `hdStatus`
en el historial; se retoma al reconectar (`_resumeHdTransfers`) o al reabrir. Cámara a 1,5 Mbps.
Límites: previa ≤ 60 s de vídeo, HD ≤ ~6 MB; si no se puede recodificar se envía el original como antes.
`tests/sim/video.js` (previa simulada): previa 5 s, texto durante el HD 0,2-0,4 s, HD 300 KB 35 s,
corte de enlace al 30 % → completa (59 s), A cierra la app al 30 % → completa (42 s), 2 MB 213 s.
**Sin verificar**: la recodificación real (MediaRecorder/canvas no existen en jsdom): calidad y tamaño
de la previa solo se ven en el teléfono (log `[VIDEO] Previa WxH N KB`).

## Ronda 2695 (verificada en simulador)
Prueba real de la 2693: con B en segundo plano o cerrada seguían faltando mensajes; vídeo de 5 s = ~8 min.
**Causa principal (reproducida con `--io-delay=25`)**: `vaultAppendMessage`/`vaultUpdateMessageStatus`
leían el historial, lo modificaban y lo guardaban sin exclusión. Con la caché vacía (app recién abierta)
dos mensajes seguidos (y cada uno se guarda dos veces: `ble_interface` y `main.js`) leían el mismo
archivo y el último guardado borraba los demás. A veía "entregado" y B no tenía nada. Arreglo: cola por
contacto (`_withMsgLock`), carga compartida y una lectura lenta ya no pisa una caché más nueva.
Con 2693: 0/3 guardados; ahora 3/3 (25 y 60 ms de latencia).
**Textos repetidos**: `_renderMessage` descartaba un recibido igual a uno de los 5 últimos ("ok") y A
veía ✓✓. 2693: 1 de 3 visibles; ahora 3 de 3.
**Robustez de reconexión** (no reproducía pérdida en el simulador, pero eran puntos frágiles):
`@capacitor/app` no está instalado → al volver a la app no se hacía nada; ahora aviso nativo
`onAppStateChange` + `visibilitychange`. Re-búsqueda sin tope de 10 min (15 s → 60 s; tras 30 min cada
5 min solo si hay pendientes), también oculta con escaneo filtrado (Android no da resultados sin filtro
con pantalla apagada), y 2 min de búsqueda de contactos al abrir/volver.
**Vídeo** (sin cambios aún, pendiente de decisión): grabación a 1280x720 y ~2,5 Mbps (por defecto de
MediaRecorder) = ~1,6 MB por 5 s; medido ~4,4 KB/s reales. Plan propuesto: 1) grabar/recomprimir a
640x360 ~400 kbps (~6x menos); 2) idea del dueño: vista previa rápida y HD después en segundo plano o
bajo demanda; 3) transporte binario (sin base64/JSON, ~1,6x) para todos los archivos.

## Ronda 2693 (verificada en simulador)
**Pérdida al reabrir / segundo plano** (reproducida con `tests/sim/lifecycle.js`):
1. Capacitor descarta `notifyListeners` si el JS aún no escucha → `onPayloadReceived` ahora con
   `retainUntilConsumed=true`.
2. Si el otro tenía la app cerrada, la conexión quedaba abierta sin servicio NEXO y bloqueaba la
   reconexión → se cierra (`closeClientWithoutService`) y el JS reintenta también desde ERROR.
3. Conexiones abiertas antes de que el JS arrancara → `getConnectedDevices` (con `ready`) al iniciar.
4. Cola de pendientes enviada sin ack → `sendWithRetry`; cualquier paquete del otro dispara el reenvío.
5. Sync de sesión comparaba `seq` mezclados → solo el `seq` del otro; reenvía lo propio sin confirmar.
Resultado: 3/3 mensajes llegan ~2 s después de que arranca el JS de B, estado "entregado", también
con direcciones asimétricas y `seq` altos. 2691 en el mismo escenario: perdidos o hasta 43 s.

**Velocidad**: el nativo esperaba fijo 40 ms (cliente) / 80 ms (servidor) por escritura y reintentaba
con `Thread.sleep` en el hilo principal. Ahora envía la siguiente en cuanto Android confirma
(`onCharacteristicWrite` / `onNotificationSent`, respaldo 300/200 ms), la cola solo se procesa en el
hilo principal, PHY 2M. JS: ventana de archivo 12, pausa 2 ms.
Foto 60 KB / PDF 150 KB (MTU 512): antes 11 s / 36 s → radio rápida (15 ms) 5,6 s / 18,6 s; lenta
(30 ms) 8,1 s / 26,9 s. 0 descartes de cola. Con 3 % de pérdida (3 corridas): fotos 13-21 s (una vez 45 s),
PDF 74-106 s, siempre completan; igual que la 2691 (en BLE real la capa de enlace reenvía: peor caso artificial).
**Percepción**: "○ N%" en la burbuja propia y "📷 Recibiendo foto… N%" en el chat del receptor.

## Regla de trabajo (pedida por el dueño)
Reproducir el fallo en el simulador, corregir, confirmar y solo entonces subir y avisar. Nunca dar
resultados no comprobados. Respetar la estructura existente (NEXO ID, mapas, vault). Batería mínima:
```
tests/sim/build.sh && node tests/sim/run.js tests/sim/builds/wip --content-fallback
node tests/sim/perf.js tests/sim/builds/wip --pdf-kb=150 [--pace=15,15 | --mtu=247 | --loss=0.03]
node tests/sim/lifecycle.js tests/sim/builds/wip --retain --close-no-service --asymmetric --js-delay=6000 --io-delay=25
node tests/sim/background.js tests/sim/builds/wip --scenario=closed --rotate --no-m3 --io-delay=25 --app-events
node tests/sim/contacts.js tests/sim/builds/wip --churn --io-delay=25
node tests/sim/browser.js tests/sim/builds/wip [--closed | --no-preview]   # Chromium real
node tests/sim/share.js tests/sim/builds/wip --io-delay=25 [--c-away]
node tests/sim/stress.js tests/sim/builds/wip    # rendimiento (Chromium real, CPU 4x, ~10 min)
node tests/sim/video.js tests/sim/builds/wip --io-delay=25 [--cut | --restart-a]
node tests/sim/background.js tests/sim/builds/wip --scenario=closed --video --no-m3 --pre-wait=15000 --off=90000 --rotate --io-delay=25 --app-events
```
Ver `tests/sim/README.md`. Límites: no simula la radio real (velocidad, alcance) ni Kotlin en sí.

## Problemas conocidos (sin corregir)
- Recibir con la app cerrada (deslizada) necesita mover el servidor GATT al `BleService`.
- `window.vaultSaveContacts` no expuesto: algunos cambios de contacto no se guardan.
- HTML sin escapar con datos del otro teléfono (nombre de contacto, último mensaje; el de archivo ya no).
- Transferencias en base64 dentro de JSON (+33 %). `FileTransferManager.kt` (binario) desconectado:
  siguiente gran mejora de velocidad.
- Trozos con emojis/acentos pueden superar el MTU en bytes (el nativo trocea por caracteres).
- Cifrado E2E desde la 2702 (`e2e_crypto.js`; `crypto_vault.js` sigue sin usarse). La clave de un
  contacto se acepta con aviso si cambia (sin verificación automática: comparar huellas en persona).
  `quickScanForNexoId` bloquea hasta 5 s.
- Manifest declara `.mesh.NordicMeshService` inexistente; falta `@capacitor/app`;
  `_showPaymentModal` usa `self` sin definir.

## Código no usado (visión a futuro)
Limpieza del 22-10-2026 (pedida por el dueño): se borró lo sustituido por código vivo — `src/media/*` (ahora
`ble_ack.js`), `src/mesh/*` (ahora Jump), `src/fenix/fenix_backup.js` (ahora `fenix.js`), `autoscan`,
`ble_permissions`, `utils/permissions`, `SetupManager`, `SetupWizard`, copias en `src/main/`, la app antigua
`client/` (webpack la copiaba dentro de la APK: 49 archivos + 3 iconos) y sus workflows, `dist/android/`, y en
Kotlin `FileTransferManager`, `FileTranferProtocol`, `MessageChunker`, `NexoBleServer`, `NexoGattService` y
`sendFileNative` (el JS no los usaba); después, `src/vault/chispas/` (el dueño: se puede eliminar). El JavaScript de la APK quedó idéntico byte a byte.
Se conservan para más adelante: `src/net/*` + `server/relay/` (Wi-Fi/datos), `plugins/nexo-auth` +
`src/vault/crypto_vault.js` + `src/auth/*` (huella y cifrado en reposo, fase 3). Pendiente de que el dueño
explique: nada (revisado el 22-10).
Borrados después (sin función real): `virtual_engine.js` (lista virtual, no el "motor" de la app),
`vault_fs.js` (guardado antiguo, sustituido por `vault_manager.js`), `vault_panel.js` (maqueta con contactos
inventados y Chispas), `the_stream.js` (era una lista de mensajes de chat, no el feed), `core/gesture_engine.js`.
Se conservan `src/stream/pulse_algorithm.js` (orden de publicaciones) y `src/ui/gesture_engine.js` (gestos
desde los bordes) para **Stream**: pantalla con Vídeos (arriba izq.) y Estados de contactos (arriba der.),
deslizar arriba = siguiente, doble toque = me gusta, deslizar a la izquierda = comentarios, a la derecha =
volver a contactos. El dueño decidió dejarlo para más adelante (propuesta: Estados primero, cifrados y sin
Internet; Vídeos cuando haya núcleos o servidor).
`gesture_engine.js`, `vault_fs.js`, `vault_panel.js`.
