# NEXO — Robustez: registro de revisiones, medición y rutina diaria

Pedido del dueño (25-10-2026), al cerrar la primera revisión completa: tener un registro de cada revisión de robustez,
una medición para saber en qué estado está la app y tareas diarias para seguir mejorando. Se actualiza al terminar cada
bloque de trabajo, igual que `PROGRESO.md` y `PENDIENTES.md`.

## 1. Cómo se mide: el índice de robustez (0–100)
Cada **área** de la app recibe de 0 a 100 puntos, sumando cuatro partes que salen de datos, no de opiniones:

| Parte | Puntos | Qué mide | Qué la sube |
|---|---|---|---|
| **A. Pruebas** | 35 | De los fallos que ya conocemos en el área, cuántos vigila una prueba de la batería diaria que pasa | Escribir pruebas para los fallos sin prueba y meter en la batería las que están fuera |
| **B. Teléfonos** | 35 | Si el área está confirmada en los teléfonos del dueño: confirmada tras el último cambio = 35; funcionaba antes pero cambió y no se ha vuelto a probar = 15; su último informe fue un fallo, o nunca se probó = 0 | Las pruebas del dueño en el Vivo, el S24 y la tablet |
| **C. Puntos débiles** | 20 | 20 menos 8 por cada punto débil grave abierto, 4 por cada medio y 2 por cada leve | Arreglar los puntos débiles |
| **D. Estabilidad** | 10 | 10 menos 2 por cada fallo que encontró la última revisión del área; 0 si el área aún no se ha revisado | Que la siguiente revisión encuentre pocos fallos (la app madura) |

El **índice global** es la media de las áreas ponderada por su importancia: mensajes 15; conexión, archivos, caminos
(Wi-Fi, internet, Jump), llamadas, avisos y seguridad 10 cada una; escaneo y agregar 8; videollamadas 7; grupos e
interfaz 5 cada una.

**Cómo se calcula**: `node tests/sim/robustez.js <salida de la batería>` (la salida de `node tests/sim/ci.js <build>`).
El catálogo `tests/sim/robustez.json` dice, por área, qué fallos conocemos y qué prueba los vigila, cómo está en los
teléfonos, los puntos débiles abiertos y los fallos que encontró la última revisión. Se actualiza al cerrar cada bloque
de trabajo: un fallo nuevo entra en el catálogo con su prueba; una prueba del dueño cambia el estado del área.

**Qué no mide**: los fallos que nadie ha visto todavía; el simulador no sustituye a los teléfonos (por eso B vale tanto
como A); los pesos y puntos son una convención, que se mantiene fija para que las mediciones se puedan comparar día a
día.

## 2. Revisión 1 (24 y 25-10-2026, builds 2766–2771)
Pedida por el dueño el 24-10: revisar la app por partes (escaneo → agregar → conexión → mensajes y archivos → llamadas →
interfaz). Método: cada fallo se reprodujo primero en el simulador con la build anterior, se corrigió y se comprobó con
la batería antes de subir. Detalle de cada fallo: `PROGRESO.md`, rondas 2766 a 2771.

| Parte | Build | Áreas | Fallos encontrados | Arreglados | Pruebas nuevas |
|---|---|---|---|---|---|
| 1 | 2766 | Escaneo, agregar, conexión | 9: los pings no se contestaban (el enlace se rehacía cada ~30 s), un archivo podía salir cifrado para el teléfono equivocado, reintentos sin fin, el Wi-Fi se perdía al volver a la app, BUSCAR colgado, reconexión en ráfagas, caídas del Bluetooth sin avisar, Tor sin dirección .onion, iniciales de los grupos | 9 | `idle.js` (Bluetooth y Wi-Fi), `resume.js`, `misroute.js` caso 4, `alerts.js`, `avatar.js` |
| 2 | 2767 | Mensajes y archivos | 7: textos largos que se perdían mostrando "entregado", nota de voz como "[adjunto]", transferencias de más de 10 min cortadas, Wi-Fi caído a mitad de una foto con un Bluetooth lento, "!" durante un corte del Wi-Fi, orden en el chat, reintento que pisaba lo pendiente | 7 | `pending.js`, `order.js`, `wificut.js`; Kotlin `BgInboxTest` |
| 3 | 2768 | Llamadas y videollamadas | 17 (en `PROGRESO.md` se agrupan en 14), entre ellos uno de seguridad grave (un teléfono cercano con un NEXO modificado podía hacerse pasar por un contacto) | 16 (queda la voz por un Bluetooth lento) | `spoof.js`, `callmedia.js`, `calls2.js` (9 casos); Kotlin `CallDedupeTest` |
| Informe del dueño | 2769 | Videollamadas (Vivo ↔ S24: sin cámara, negro, sin voz) | 16: cámara o micrófono ocupados, cortados o sin imágenes, audio en pausa, codificadores y decodificadores de voz y vídeo que fallan o se paran, negro sin motivo, sin Wi-Fi, cámara del chat, sin micrófono (cortaba a los 12 s), pantalla que se apagaba | 16 | `callmedia.js` (20 casos; con la 2768 fallan 15), `calls2.js` `video-estado` y `sin-micro` |
| — | 2770 | Llamadas con la pantalla bloqueada | 4: micrófono en segundo plano (Android 11+), foco de audio, tono en silencio y dos tonos a la vez, lo que quedaba al cerrar NEXO en plena llamada | 4 (lo nativo, sin probar en teléfonos) | `calls2.js` `timbre` y `sin-micro` |
| 4 | 2771 | Interfaz | 10: "Agregar" vacío aunque hubiera contactos, buscador que no buscaba, dos avisos rotos, textos sin tilde o en inglés, contador de conectados, aviso sin contactos, botón con un número suelto, Perfil con un "0", "Cambiar nombre" escondido | 10 | `ui4.js` (18 comprobaciones; con la 2770 fallan 15) |
| **Total** | | | **63** | **62** | Batería de 29 a 47 escenarios; Kotlin de 65 a 68 pruebas |
| Informe del dueño (después de la revisión 1) | 2772 | Videollamadas, llamadas, avisos | 8: el otro sin espejo, imagen recortada (se veía el 35 %) y que no seguía al girar el teléfono, micrófono sin bajar con la voz del otro, salida de audio creada antes del micrófono (el cancelador del teléfono podía no usarla), con la pantalla apagada el teléfono dormía a medio recibir (no llegaba ni avisaba), aviso de respaldo con un reloj que no avanza dormido, latido del Wi-Fi que cortaba enlaces sanos al despertar | 8 | `videoframe.js`, `voicefx.js`, `notify.js --via=lan` (pantalla apagada, también por Bluetooth y Jump), `callmedia.js` casos 21–22, `alerts.js`; Kotlin `LanHubTest` (3) |

Además se probaron llamadas y videollamadas de verdad en Chromium (`calls_browser.js`: imagen y voz en los dos sentidos,
Opus y μ-law) y se revisaron las pantallas en capturas a 393 y 360 px de ancho.

**Lo que no cubrió la revisión 1**: avisos, segundo plano y app cerrada (solo se añadieron mejoras); grupos; Fénix,
pasar la cuenta y el bloqueo; Wi-Fi Direct e internet en profundidad. Son lo primero de la revisión 2.

**Lo que dejó claro**: la app tenía muchos fallos escondidos que solo salen con condiciones reales (relojes desfasados,
app reiniciada a medias, cámara ocupada, Wi-Fi que se va sin avisar). Casi todo lo arreglado desde la 2765 está **sin
probar en los teléfonos**: es lo que más baja la medición.

## 3. Medición inicial (25-10-2026, build 2771, batería 47/47)

| Área | Peso | A pruebas (35) | B teléfonos (35) | C débiles (20) | D estabilidad (10) | Índice |
|---|---|---|---|---|---|---|
| Escaneo y agregar contactos | 8 | 35 (4/4) | 0 (falla) | 16 (1) | 8 (1 fallo) | **59** |
| Conexión Bluetooth y enlace | 10 | 21,9 (5/8) | 0 (falla) | 12 (3) | 0 (5 fallos) | **33,9** |
| Mensajes | 15 | 17,5 (5/10) | 15 (antes) | 14 (2) | 2 (4 fallos) | **48,5** |
| Fotos, vídeos y archivos | 10 | 7,8 (2/9) | 0 (falla) | 12 (3) | 6 (2 fallos) | **25,8** |
| Wi-Fi, internet, Jump y caminos | 10 | 31,1 (8/9) | 15 (antes) | 12 (3) | 4 (3 fallos) | **62,1** |
| Llamadas de voz | 10 | 28 (12/15) | 0 (falla) | 10 (4) | 0 (20 fallos) | **38** |
| Videollamadas | 7 | 27,2 (7/9) | 0 (falla) | 14 (2) | 0 (14 fallos) | **41,2** |
| Avisos, segundo plano y app cerrada | 10 | 29,2 (5/6) | 0 (nunca) | 12 (2) | 0 (sin revisar) | **41,2** |
| Seguridad y cuenta | 10 | 24,5 (7/10) | 15 (antes) | 10 (3) | 6 (2 fallos) | **55,5** |
| Grupos | 5 | 23,3 (2/3) | 0 (nunca) | 18 (1) | 0 (sin revisar) | **41,3** |
| Interfaz | 5 | 23,3 (2/3) | 15 (antes) | 16 (2) | 0 (11 fallos) | **54,3** |
| **Global** | 100 | 23,9 | 6 | 12,9 | 2,5 | **45,3** |

**Lectura**:
- **45 sobre 100.** Lo que más baja es **B (6 de 35)**: cinco áreas tienen un fallo informado por el dueño cuyo arreglo
  aún no se ha probado en los teléfonos (escaneo, conexión, archivos, llamadas, videollamadas) y dos nunca se han probado
  (avisos, grupos).
- **A (68 %)**: de 86 fallos conocidos, 59 los vigila la batería; 18 tienen una prueba que existe pero **no está en la
  batería** (Fénix, bloqueo, responder y reenviar, Wi-Fi Direct, vídeo, cámara…) y 9 solo se pueden ver en el teléfono
  (lo nativo de Android). El área más floja es archivos (2 de 9).
- **D (2,5 de 10)**: la revisión 1 encontró 63 fallos: la app aún no es madura. La revisión 2 debería encontrar muchos
  menos; si no, el índice no sube por aquí.
- **C**: quedan 26 puntos débiles abiertos (ninguno grave, 11 medios, 15 leves).

**Cuánto subiría** (calculado con el mismo programa):
- Las pruebas del dueño confirman las 7 áreas que están en "falla" o "nunca": 45 → **66** (y si además vuelve a
  probar las otras 4: **74**).
- Las 17 pruebas de fuera (vigilan 18 fallos conocidos) entran en la batería: 45 → **53**.
- Se arreglan los puntos débiles medios: 45 → **50**.
- La revisión 2 encuentra ~1 fallo por área: 45 → **51**.
- Todo junto (las 7 áreas confirmadas, las pruebas de fuera en la batería, sin puntos débiles medios y ~1 fallo por
  área en la revisión 2): **84**.

## 4. Historial de mediciones
Una línea por medición (al terminar cada día de trabajo, con la batería del día).

| Fecha | Build | Batería | Índice | A | B | C | D | Nota |
|---|---|---|---|---|---|---|---|---|
| 25-10-2026 | 2771 | 47/47 | 45,3 | 23,9 | 6 | 12,9 | 2,5 | Medición inicial, al cerrar la revisión 1 |
| 25-10-2026 | 2772 (APK 2773) | 50/50 | 44 | 23,8 | 6 | 11,7 | 2,5 | Informe del dueño: 8 fallos arreglados (sin probar en teléfonos: B igual) y 4 puntos débiles nuevos que sacó la investigación (latido del Wi-Fi que gasta batería, audio en el hilo de la interfaz, sin DTX, copia de cada imagen por un lienzo): baja C. Si el dueño confirma videollamadas, llamadas y avisos: 53,5 |
| 25-10-2026 | 2774 | 51/51 | 41,8 | 22 | 6,8 | 10,7 | 2,3 | Auditoría (ronda 2774, `docs/AUDITORIA.md`): 8 arreglos + grupos + WebView, con 16 pruebas nuevas (Kotlin 87/87). **Baja de 44 a 41,8 porque se añadió un área nueva y exigente «Seguridad frente a ataques» (peso 10 → total 110)**: su A es baja (4,4) porque sus pruebas corren en el job de Kotlin, que `ci.js` no lee (solo `groupforge` está en la batería), y su C es 0 porque la auditoría dejó 9 puntos débiles abiertos (C1 grave + H3/H4 + leves). No es regresión: la seguridad mejoró. Sube al arreglar C1 y meter las pruebas de ataque en una medición que cuente el job de Kotlin |
| 25-10-2026 | 2777 | 52/52 | 42,1 | 22,3 | 6,8 | 10,7 | 2,3 | Auditoría fase 2: **C1 arreglado** (confirmaciones ✓✓ firmadas con el secreto de la pareja, también en modo cerrado con el ack nativo firmado; `tests/sim/ackforge.js`). En el área de auditoría: un punto débil grave menos (de 9 a 8 débiles) y una prueba más en la batería (A pasa de 4,4 a 7,8; 2/9 modos con prueba que pasa). Kotlin 90/90. ⚠️ Falta confirmar C1 en los dos teléfonos del dueño |
| 25-10-2026 | 2778 | 52/52 | 42,1 | 22,3 | 6,8 | 10,7 | 2,3 | Llamadas (informe del dueño): puerta de ruido del micrófono más profunda (−22 dB en silencio; `voicefx` baja 22 dB sin comerse el arranque), pantalla que se enciende al entrar una llamada (MainActivity) y contestar deslizando. Índice sin cambio: son mejoras de calidad/experiencia, no nuevos modos de fallo con prueba. ⚠️ Pantalla y desliz a confirmar en los teléfonos del dueño |
| 25-10-2026 | 2779 | 53/53 | 42,1 | 22,3 | 6,8 | 10,7 | 2,3 | Alta por ID (informe del dueño): agregar a alguien lejano con su NEXO ID + solicitudes aceptar/eliminar (`tests/sim/reqadd.js`). Índice sin cambio: es una funcionalidad nueva, no un modo de fallo del catálogo (la clave que llega entra "sin verificar", riesgo H3 conocido, hasta comparar el número de seguridad). ⚠️ A confirmar en los teléfonos del dueño |
| 26-10-2026 | 2780 | 53/53 | 41,4 | 22,4 | 6,8 | 9,9 | 2,3 | Fotos/archivos por internet SIEMPRE mandables (buzón de los relés o Tor, ~6 MB) + botón «Reintentar» a los 30 s y reenvío solo al volver la conexión (`net.js` ampliado: foto por datos móviles y por buzón, botón sin internet y reenvío al volver; `_bigLocalRoute` mantiene L2CAP/Wi-Fi para lo cercano). **Baja de 42,1 a 41,4**: A sube (+0,1, nuevo modo cubierto por la prueba `internet (relés)`) pero C baja (−0,8) porque se apuntó como punto débil **grave** el informe del dueño «con Wi-Fi bueno la app se pasa a Internet y no deja llamar» (tarea #83, para 2781). No es regresión del código de la 2780. Kotlin 90/90 (sin cambios nativos). ⚠️ A confirmar en los teléfonos del dueño |
| 26-10-2026 | 2781 | 54/54 | 41,7 | 22,6 | 6,8 | 9,9 | 2,3 | Notas de voz (informe del dueño): parar el audio que suena al grabar o al entrar llamada/videollamada (una sola suena a la vez), pausar/reanudar la grabación y borrarla antes de enviar. Prueba nueva `tests/sim/voicenote.js`. **Sube de 41,4 a 41,7**: en «Fotos, vídeos y archivos» A sube (un modo más cubierto por prueba, 3/10). Kotlin 90/90 (sin cambios nativos). ⚠️ A confirmar en los teléfonos del dueño |
| 26-10-2026 | 2782 | 55/55 | 42,3 | 23,3 | 6,8 | 9,9 | 2,3 | Editar un mensaje ya enviado (etiqueta "editado"), pedido del dueño. Prueba `chatactions.js` ampliada y **metida en la batería** (tag CHATACT). **Sube de 41,7 a 42,3**: en «Mensajes» A sube bastante (7/11) porque la suite del chat (responder/deslizar/copiar/reenviar/eliminar + editar) entra en la batería diaria, antes solo a mano. Kotlin 90/90 (sin cambios nativos). ⚠️ A confirmar en los teléfonos del dueño |
| 26-10-2026 | 2783 | 56/56 | 42 | 23,7 | 6,8 | 9,2 | 2,3 | Reacciones (doble toque ❤️ + menú «Reaccionar»), gestos (deslizar izq/der responder, deslizar abajo cerrar, pellizco/doble toque ampliar foto), palomitas iguales en todas las redes (enviado ✓, entregado/leído ✓✓) y micrófono más silencioso (gate −34 dB). Pruebas `palomitas.js` (tag PALOM) + `chatactions.js` ampliada; `voicefx.js` umbral de silencio ≥20 dB. **Baja de 42,3 a 42**: sube la cobertura (reaccionar/palomitas/gestos con prueba) pero se registró como punto débil GRAVE el bug de la app cerrada que reportó el dueño (26-10, #87); no es regresión. Kotlin 90/90 (sin cambios nativos). ⚠️ A confirmar en los teléfonos del dueño |
| 26-10-2026 | 2784 | 56/56 | 42 | 23,7 | 6,8 | 9,1 | 2,3 | Llamadas a pantalla completa (#81: se pide el permiso de Android 14 al arrancar), zoom de foto limitado al borde, franja de conectados sin parpadeo (histéresis 60 s) y «Copiar diagnóstico» de la última hora. Todo JS. Prueba `alerts.js` ampliada (teléfono con batería concedida → pide la pantalla completa). **Se mantiene en 42**: +1 modo cubierto (#81) en «Avisos» sin cambiar el resto. Kotlin 90/90 (sin cambios nativos). ⚠️ A confirmar en los teléfonos del dueño |
| 26-10-2026 | 2785 | 56/56 | 42 | 23,7 | 6,8 | 9,1 | 2,3 | Las dos prioridades del dueño, NATIVO: **#1** llamada entrante con `CallStyle` de verdad (pantalla de llamada real con Contestar/Rechazar grandes, antes Samsung/Android 14 la bajaba a aviso pequeño); **#87** WifiLock (FULL_HIGH_PERF) mientras NetBg escucha en segundo plano/cerrada + **registro nativo persistente** (`NativeLog`) que ahora sí muestra en «Copiar diagnóstico» qué hizo el nativo con la app cerrada (antes remLog solo iba a logcat/puente, muerto sin WebView). Kotlin 90→**95/95** (+5 `NativeLogTest`). **Se mantiene en 42**: los cambios son nativos (no hay prueba JS nueva en la batería; el log tiene prueba Kotlin, que `ci.js` no mide) y el punto débil GRAVE del #87 **sigue abierto** hasta confirmarlo en los teléfonos con el nuevo diagnóstico. ⚠️ #1 y #87 a confirmar en los teléfonos del dueño |
| 26-10-2026 | 2786 | 58/58 | 42,1 | 23,8 | 6,8 | 9,1 | 2,3 | Archivos grandes por internet (informe del dueño: «que permita el envío de archivos grandes cuando hay internet; otra vez no mandó nada ni avisó si es por dimensiones»). Tope por internet **según el camino**: por **Tor directo** los grandes salen por internet (~22 MB); por los relés se quedan los medianos (~6 MB). Y **nunca más «no manda nada ni avisa»**: aviso claro y accionable siempre (incluye el vídeo que antes fallaba en silencio). Pruebas nuevas `tests/sim/bignet.js` (relés y Tor) en la batería. **Sube de 42 a 42,1**: en «Fotos, vídeos y archivos» A sube (un modo más cubierto por la prueba `archivos grandes por internet`). Kotlin 95/95 (sin cambios nativos). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2787 | 59/59 | 42,1 | 23,8 | 6,8 | 9,1 | 2,3 | Pagos Fase 1: adjunto «Cobro» (💵) en el chat — importe, moneda, concepto y «cómo te pagan» (alias/CBU, enlace/QR de Mercado Pago/PayPal, efectivo); NEXO nunca toca el dinero (mensajería de cobros, sin licencia ni servidor); tarjeta con «Copiar datos»/«Abrir enlace», cifrada, por cualquier red. `src/ui/cobro.js` + prueba `tests/sim/cobro.js` (tag COBRO). **Índice sin cambio (42,1)**: es una funcionalidad nueva, no un modo de fallo del catálogo (como pasó con «alta por ID» en la 2779); cuando los cobros crezcan tendrán su propia área. Kotlin 95/95 (sin cambios nativos). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2788 | 60/60 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | Auditoría **F9**: solo relés de internet cifrados (`wss://`); los en claro (`ws://`) vetados salvo loopback (pruebas/relé propio). Antes, un relé en claro filtraba las etiquetas de la suscripción (tu buzón). `net_link.js` `relayUrls()`+`_relaySafe`; prueba `tests/sim/relaytls.js` (tag RELAYTLS). **Sube de 42,1 a 42,5**: en «Seguridad frente a ataques» A sube (un modo más cubierto, 3/10) y C sube (un débil leve menos: queda F8; de 8 a 7 débiles). Los demás puntos de auditoría (M5/M6 autenticar control, H3/H4) tocan el núcleo del protocolo (enlaces/nombres/sincronización), solo se verifican en el simulador → se dejan para hacerlos con cuidado y que el dueño los pruebe en los teléfonos. Kotlin 95/95 (sin cambios nativos). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2789 | 60/60 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | Dos detalles del dueño + arreglo del flake que impidió publicar la APK de la 2788. (1) **Palomitas**: «entregado» y «leído» eran los dos ✓✓ y el color de «entregado» (#cdd9e5) se parecía al de «leído»; ahora entregado ✓✓ gris (#8696a0) y leído ✓✓ azul (#00d4ff) con brillo (regresión mía de la 2783; la lógica del «leído» estaba bien, era el color). (2) **Pantalla**: un mensaje encendía el brillo pleno; `wakeOnMsg()` por defecto pasa a false → solo la notificación (las llamadas siguen encendiendo; regresión mía de la 2765). (3) **Flake de CI**: `misroute.js` (enrutado BLE/Jump, sin internet) no aislaba la red — jsdom trae `WebSocket` y `relayUrls()` caía a relés públicos reales; en CI conectaban y el archivo «ausente» volvía «entregado». Stub de `WebSocket` que nunca abre → red offline determinista (verificado 3/3: estado `sending`, nunca `delivered`). La 2789 lleva también el código F9 de la 2788. **Índice sin cambio (42,5)**: son correcciones de UX y de una prueba, no nuevos modos de fallo del catálogo. Kotlin 95/95 (sin cambios nativos). ⚠️ El stub de misroute fue INSUFICIENTE: otra prueba volvió a conectar a relés reales → la APK 2789 TAMPOCO se publicó (causa raíz y arreglo en la 2790) |
| 27-10-2026 | 2790 | 60/60 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | Arreglo de RAÍZ que impedía publicar las APK 2788 y 2789. El cambio F9 (2788) dejó `relayUrls()` con `return safe.length ? safe : DEFAULT_RELAYS`; como el simulador marca «sin internet» con `NEXO_NET_RELAYS=[]`, esa lista vacía (tras filtrar) caía a los relés PÚBLICOS reales, y en CI (con internet) varias pruebas se conectaban de verdad → resultado al azar → el job «tests» fallaba y no se construía la APK (en local no se veía). Arreglo (`net_link.js`): una lista vacía explícita = «sin relés» (se respeta); se mantiene F9 (lista solo-en-claro → `wss://` por defecto); sin configurar (producción) usa los por defecto, sin cambio. Revertido el stub de `misroute.js`; `relaytls.js` gana aserciones que lo fijan (vacía→sin relés, solo-en-claro→wss://). La 2790 lleva TODO lo de la 2789 (palomitas, pantalla) + F9, y por fin publica APK. **Índice sin cambio (42,5)**: arreglo de una prueba, no un modo de fallo del catálogo. Kotlin 95/95 (sin cambios nativos). APK publicada (nightly-2790, 24,56 MB, sha256 7616419f…; firma verificada en CI). ⚠️ Palomitas y pantalla a confirmar en los teléfonos del dueño |
| 27-10-2026 | 2791 | 60/60 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | Interfaz (informe del dueño): (1) la barra de adjuntar se salía de la pantalla con 6 iconos (el $ de Cobro cortado) → iconos más pequeños + `max-width:calc(100vw-24px)` + `flex-wrap` (nunca se corta); al Cobro le faltaba color/etiqueta (a medias en la 2787) → círculo teal + «Cobro». (2) La tarjeta de Cobro tenía borde grueso → igual que Ubicación (sin borde, mismo tamaño). Solo CSS/HTML. **Índice sin cambio (42,5)**: no hay lógica nueva. En revisión para la 2792 (reportados por el dueño): APK grande por internet (no avisa ni se manda; falta diagnóstico) y crear grupo con un contacto en línea (investigando). Kotlin 95/95 (sin cambios nativos). APK publicada (nightly-2791, 24,56 MB, sha256 88bb2359…; firma verificada en CI). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2792 | 60/60 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | Detalles del dueño (con su diagnóstico): (1) el botón «Crear grupo» no se habilitaba y no decía por qué → ahora el texto del botón dice qué falta (nombre / contacto); sus contactos tienen ID nx limpio, así que sí aparecen en la hoja (no era el filtro). (2) El aviso de «archivo demasiado grande» salía 4 s y se perdía → ahora dura 8 s (`_showPermissionError` con duración). Solo CSS/JS de interfaz. **Índice sin cambio (42,5)**. El diagnóstico aclaró: llamadas/videollamadas solo con el contacto cerca (hubo una videollamada real de 17 s), no por internet (#3); APK de 23 MB no cabe por internet (#2); ○+«Reintentar» = Bluetooth inestable (MTU 23) nativo. Kotlin 95/95. APK publicada (nightly-2792, 24,56 MB, sha256 82d97559…; firma verificada en CI). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2793 | 60/60 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | Rápidos de `A_LA_PAR.md` (interfaz): (1) **autocorrecto** activado — el campo tenía `spellcheck="false"`; ahora el teclado de Android corrige/capitaliza/sugiere. (2) **Moneda del Cobro automática por país** (`_defaultMoneda()` por idioma/región; antes fija en ARS). Solo CSS/HTML/JS de interfaz. **Índice sin cambio (42,5)**. Kotlin 95/95 (sin cambios nativos). APK publicada (nightly-2793, 24,56 MB, sha256 c7d4d992…; firma verificada en CI). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2794 | 61/61 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | Último rápido de `A_LA_PAR.md`: **buscar dentro del chat**. Lupa 🔍 en la cabecera → barra debajo que **filtra** las burbujas (propias y recibidas), **resalta** las que coinciden y **cuenta**; insensible a mayúsculas; vaciar/cerrar restaura; al abrir/cerrar un chat se resetea; también en grupos. No toca almacenamiento ni envío (solo muestra/oculta burbujas de `#messages-container`). `src/ui/search_ui.js` (`installSearchUi`), cableado en `main.js`; CSS en `nexo_theme.css`. Prueba nueva `tests/sim/search.js` (tag SEARCH) → la batería pasa de 60 a **61**. **Índice sin cambio (42,5)**: funcionalidad nueva de interfaz, no un modo de fallo del catálogo (`search`/`buscar` del catálogo es el BUSCAR del escaneo BLE, otra cosa). Kotlin 95/95 (sin cambios nativos). APK publicada (nightly-2794, 24,56 MB, sha256 6c8de6b5…; firma verificada en CI). Con esto, los 3 rápidos quedan completos; siguiente bloque: internet de verdad (#2/#3). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2795 | 62/62 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | **Fotos de una sola vista («ver una vez», #94)**, 1.º del trabajo autónomo por los pendientes. Botón 👁 en la revisión de la cámara; el receptor ve «Toca para ver · una vez», y al abrirla el medio se **consume de verdad** (`vaultConsumeOnceMessage` borra payload, `attachmentRef`, el blob del disco y **también `content`** —podía llevar el payload como JSON—, marca `onceSeen`); no se reabre ni al cerrar y volver al chat; una retransmisión no lo revive. El flag viaja en el chunk-0 del protocolo de archivo (`o1`). v1 solo fotos. `tests/sim/once.js` (tag ONCE) → batería 61→**62**. **Índice sin cambio (42,5)**: funcionalidad nueva de interfaz/almacenamiento, no un modo de fallo del catálogo. Kotlin 95/95 (sin cambios nativos). APK publicada (nightly-2795, 24,56 MB, sha256 d2e3c21a…; rebotó una vez por un flake de tiempos en `AtRestStoreTest`, re-ejecutado el CI → verde; firma verificada). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2796 | 62/62 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | **Limpieza: prototipo MUERTO de pagos/transferencias fuera** (`src/app/nexo_app.js`): `payment`/`transfer`, modal, «firma» inventada y `_showPaymentModal` con bug (`self` sin definir). Nada lo disparaba; los cobros reales son el adjunto 💵 Cobro. Reduce superficie de ataque (pendiente «antes de la tienda»). Solo borrado de código muerto, sin cambio de comportamiento ni de Kotlin. **Índice sin cambio (42,5)**. APK publicada (nightly-2796, 24,56 MB, sha256 40e4fe02…; firma verificada). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2797 | 63/63 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | **Contacto: foto→visor grande, nombre→chat** (#100). El avatar de la lista recibe su propio toque (con foto abre el visor, sin foto cae a la fila→chat); el nombre entra al chat. `tests/sim/photo_tap.js` (tag PHOTOTAP) → batería 63. **Robustez de CI**: estabilizado el flake de tiempos `AtRestStoreTest.migrarArchivoGrandeNoBloqueaOtros` (tumbó la APK 2795): ventana de migración 1,5 s→4 s para que los 40 guardados cifrados quepan en un runner lento; la propiedad sigue cubierta por `esperaMax<1000` (test-only, no cambia la APK). **Índice sin cambio (42,5)**. APK publicada (nightly-2797, 24,56 MB, sha256 998d42a8…; el flake Kotlin no reapareció; firma verificada). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2798 | 64/64 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | **Aviso de mala señal** (#102): por Bluetooth con MTU bajo (<60; el «muy lento» del dueño con MTU 23) el subtítulo marca «⚠ señal débil» para explicar la lentitud. `main.js _refreshLinkSubtitle` + `getMtu`. Prueba nueva `tests/sim/malasenal.js` (tag MALASENAL). **Índice sin cambio (42,5)**: ayuda de interfaz, no un modo de fallo del catálogo. APK publicada (nightly-2798, 24,56 MB, sha256 43af9213…; firma verificada). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2799 | 65/65 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | **Stream fase 1 — Estados** entre contactos (#104, pedido estrella de la madrugada «empezamos con cercanos»): texto, 24 h, privado y **cifrado de extremo a extremo**, como **acción oculta del chat** (`nexo_act act:'st'`), sin mensaje visible; copia oculta borrada al entregarse. Robustez del diseño: texto acotado a 280 car. **al enviar y al recibir**, solo NEXO IDs válidos, caducidad 24 h aplicada al leer/guardar/pintar, texto escapado al mostrar (sin inyección de HTML). `src/ui/estados.js` + `chat_actions.js` (recibo) + `main.js` (arranque). Prueba nueva `tests/sim/estados.js` (tag ESTADOS) → batería 65. **Índice sin cambio (42,5)**: funcionalidad nueva, no un modo de fallo del catálogo. APK publicada (nightly-2799, 24,56 MB, sha256 c53f30e3…; firma verificada). ⚠️ A confirmar en los teléfonos del dueño |
| 27-10-2026 | 2800 | 65/65 | 42,5 | 24,1 | 6,8 | 9,3 | 2,3 | **Auditoría «verificar robustez y fallas» (#106)**: repaso de la superficie nueva (2794–2799) + revisión adversarial independiente; batería de ataque/caos VERDE (`spoof`/`ackforge`/`groupforge`/`misroute`/`relaytls`). 2 fallas reales arregladas y **reproducidas**: (A) **ALTA** la foto «de una vez» ya abierta **revivía** al retransmitirse (el merge en `vault_manager` no borraba `content`, que por relé lleva el payload → `render` la repintaba); se iguala al borrado de consumir. (B) **MEDIA** Estado (Stream) con `ts` futuro no caducaba; se acota a «ahora». Pruebas: `once.js` (`retransmision_no_revive_*`) y `estados.js` (`futuro_acotado`); los dos modos en `robustez.json` (auditoría). Ver `AUDITORIA.md` §3bis. **Índice sin cambio (42,5)**: ya cubiertos por el catálogo; refuerzan la robustez real. APK en compilación (nightly-2800; sha256 al publicarse). ⚠️ A confirmar en los teléfonos del dueño |

## 5. Rutina diaria
Cada día de trabajo, en este orden:
1. **Lo del dueño primero**: sus pruebas y diagnósticos (Perfil → Copiar diagnóstico de los dos teléfonos). Cada fallo
   se reproduce en el simulador, se arregla y entra en el catálogo con su prueba. Cada prueba que confirma un área sube
   B (se apunta en `robustez.json`).
2. **El bloque del día** (calendario de la revisión 2, abajo): revisar un área a fondo con escenarios nuevos de fallo
   (también con un agente revisor), reproducir, arreglar y dejar la prueba en la batería.
3. **Un punto débil abierto**: el más grave del área del día o, si no hay, el más grave en general.
4. **Medir**: batería completa y Kotlin; `node tests/sim/robustez.js <salida>`; una línea en el historial (§4).
5. **Subir** si hay cambios (normalmente una APK al día; las urgencias, cuando hagan falta) y dejar al dueño **3–5
   pruebas cortas** para sus teléfonos, empezando por las que confirman un área en "falla" (son las que más suben B).

## 6. Revisión 2: calendario (empieza el 26-10-2026)
Un área por día, empezando por lo que la revisión 1 no tocó. Si el dueño trae un fallo, va primero y el calendario se
corre un día.

| Día | Área | Qué se hace |
|---|---|---|
| 1 | Avisos, segundo plano y app cerrada (sin revisar) | App congelada (Vivo), cerrada y con la pantalla apagada; notificaciones; recibir con la app cerrada sin que Android cierre el proceso; meter `lifecycle.js` en la batería |
| 2 | Grupos (sin revisar) | Crear, escribir, adjuntos, salir, alguien lejos o con la app cerrada; meter `share.js` en la batería |
| 3 | Seguridad y cuenta | Firmar el "no soy yo" y las confirmaciones (punto débil medio); Fénix, pasar la cuenta y el bloqueo en la batería (`fenix.js`, `lock.js`, `qr.js`) |
| 4 | Fotos, vídeos y archivos (el área más floja) | Meter `photos.js`, `video.js`, `files.js`, `wifidirect.js` y `camera.js` en la batería; transferencias largas y con Bluetooth lento como pruebas; registro de envíos (memoria) |
| 5 | Mensajes | ✓✓ con la app cerrada antes de descifrar (punto débil medio); meter `chatactions.js`, `contacts.js`, `resend.js`, `mixed.js` y `location.js` en la batería |
| 6 | Conexión Bluetooth | Varios enlaces con el mismo contacto; identidad por dirección; MTU pequeño con prueba |
| 7 | Wi-Fi, internet, Jump y caminos | Wi-Fi Direct (medir y acelerar, tarea #19); decisión §4.8 del dueño; meter `lan.js` en la batería |
| 8 | Llamadas de voz | Medir el retraso de la voz (aviso "Bluetooth lento"); "Rechazar" firmado si el dueño elige la opción 3 (§4.7) |
| 9 | Videollamadas | `calls_browser.js` (llamada de verdad en Chromium) en la batería; videollamada por Wi-Fi Direct (estudio) |
| 10 | Escaneo y agregar | Ubicación apagada en Android 8–11 (aviso); agregar con 3 o más teléfonos cerca |
| 11 | Interfaz | "Tu nombre" si el dueño lo decide; foto del contacto en sus notificaciones; texto grande (accesibilidad) |
| 12 | Cierre | Medición, comparación con la revisión 1, comparativa con la competencia e informe al dueño |

**Metas**: al final de la semana, **55 o más** (pruebas de fuera en la batería y primeras confirmaciones del dueño); al
cerrar la revisión 2, **70 o más** y menos de la mitad de fallos que la revisión 1.

## 7. Pruebas fuera de la batería (25-10-2026, build 2771)
Hay 17 pruebas del simulador que no están en la batería diaria: imprimen sus valores pero no dicen por sí solas "pasa"
o "falla", así que se revisaron a mano con la 2771. Hasta que entren en la batería con comprobaciones (calendario de la
revisión 2), no cuentan para A.

| Prueba | Qué comprueba | Con la 2771 |
|---|---|---|
| `chatactions.js` | Responder, reenviar, copiar, eliminar, deslizar para responder | Bien: la cita se ve en los dos, el archivo reenviado llega idéntico, lo eliminado no queda guardado |
| `contacts.js` | Nombres y orden de la lista | Bien: el orden no salta sin mensajes; quien escribe sube arriba |
| `fenix.js` | Copia repartida de la cuenta y recuperación | Bien: nadie puede leer lo que guarda; recuperada en 38 s con el mismo NEXO ID, historial 6 de 6, archivos 2 de 2 |
| `files.js` | Archivos: límite, error de lectura, nombres con HTML, PDF | Bien: avisos claros, nada inyectado, llegan idénticos |
| `lan.js` | Wi-Fi en la misma red y cambio de camino | Bien: texto 0,2 s y foto de 400 KB en 1 s por Wi-Fi; mala señal → Bluetooth en 8,2 s; caída silenciosa: el texto llega por Bluetooth a los 27,6 s; el impostor no se usa; nada en claro |
| `lifecycle.js` | App cerrada y reabierta | Bien: los 3 mensajes llegan 4 s después de reabrir y la respuesta vuelve |
| `location.js` | Enviar la ubicación | Bien (llega en 0,5 s, no viaja en claro) tras actualizar la prueba: la 2771 escribe "Ubicación" con tilde y la prueba buscaba "Ubicacion" |
| `lock.js` | Bloqueo con huella y capturas | Bien: 24 de 24 comprobaciones; desbloquea en 0,3 s |
| `photos.js` | Foto de 300 KB solo por Bluetooth | Bien: 21,8 s, idéntica, ✓✓ |
| `resend.js` | No reenviar lo ya entregado al reconectar o reiniciar | Bien: 0 envíos repetidos |
| `share.js` | Compartir un contacto | Bien |
| `video.js` | Vídeo: previa y HD | Bien: previa 4,3 s, HD 25 s, un texto en medio llega en 0,6 s |
| `wifidirect.js` | Archivos grandes por Wi-Fi Direct | Bien: grande en 4,8 s sin pasar por Bluetooth; si Wi-Fi Direct falla, termina por Bluetooth |
| `camera.js` | Cámara del chat (foto, vídeo, frontal en espejo) | Bien |
| `qr.js` | Verificar el número de seguridad con QR | Bien: detecta al impostor, a otro contacto y un QR que no es de NEXO |
| `calls_browser.js --video` | Videollamada de verdad en Chromium | Bien: imagen y voz en los dos sentidos (86 y 87 imágenes, Opus, 0 paquetes malos) |
| `mixed.js` | Un teléfono con la 2771 y otro con una build anterior al cifrado de extremo a extremo | Lo importante, bien: nada sale en claro; lo enviado queda pendiente (no fallido) y llega cifrado cuando el otro se actualiza. La prueba aún espera que llegue lo que manda la build vieja sin cifrar; desde la 2768 eso se descarta a propósito (un contacto conocido no puede mandar sin cifrar: protección contra suplantación, `spoof.js`). Hay que actualizar la prueba, no la app |

**Resultado**: las 17 se comportan como se espera; ningún fallo de la app. Dos pruebas estaban desfasadas respecto a la
app: `location.js` (corregida el 25-10) y `mixed.js` (se corrige al meterla en la batería, día 5).
