# NEXO — Lo que falta (lista viva)

Lista pedida por el dueño el 23-10-2026 para no olvidar nada. Leer al empezar cada sesión (CLAUDE.md lo indica) y
actualizar al terminar cada bloque. Estado al día de cada build: `docs/PROGRESO.md`.

## Bloque autónomo 28-10 (madrugada→mañana): FCM + archivos por internet + AUDITORÍA SEVERA
El dueño (1 AM): «termina lo del ping a los servidores de Google robusto y probado; luego la parte internet del tamaño
de los archivos y verifícalo (ya no quiero mandar una APK por internet y que ni la vea enviada); luego los pendientes
activos; luego la prueba de tiempo/ciclo/CPU/API y **la auditoría más severa posible** en seguridad/robustez/fluidez,
corrige lo que encuentres, y dame **una puntuación** y **la comparativa con la competencia**». Estado:
- ✅ **FCM «despertador» (#87) Fase 1+2b** (builds 2816/2817/2819): recibir (Firebase nativo), token que se intercambia
  cifrado y dispara el «toque» al mandar por el buzón. **Robusto y probado en el simulador** (`fcmwake.js`). **Falta del
  dueño:** desplegar `push-sender/` (su cuenta, Blaze) y, si el URL difiere, pasármelo (`net.setSender`); prueba real en
  el móvil (la gran incógnita: ¿despierta el Vivo cerrado?). El disparo real por Google no se puede simular.
- ✅ **Archivos grandes por internet (#99 Fase A)** (build 2818): tope ~6 MB → ~22 MB (Tor directo o relés). **Nunca más
  «enviada» en silencio**: si un archivo no cabe por el camino de ahora, sale un aviso claro (ya estaba desde la 2786; el
  revisor de robustez lo confirmó). **Falta (Fase B, pendiente):** >22 MB (p. ej. una APK de 24 MB) por **Tor directo**
  en bulk — necesita que Tor conecte de verdad en el Vivo (hoy el diagnóstico muestra internet solo por relés). Honesto:
  mandar una APK por internet de punta a punta sigue sin estar hasta la Fase B + Tor conectando.
- ✅ **Auditoría severa + puntuación + comparativa** (build 2820): dos revisores adversariales; 7 fallas reales
  arregladas (SEC-1 ALTA, G1 GRAVE, M1, M2, SEC-4/L1/L2/L3), con prueba. **Puntuación: índice de robustez 43,1/100**
  (`ROBUSTEZ.md` §4; el techo es B=confirmación en teléfonos, 6,8/35). **Comparativa** actualizada en `COMPARATIVA.md`
  (§1 tabla + §1bis puntuación). Detalle de seguridad en `AUDITORIA.md` §3quater. Quedan abiertos, para rondas propias y
  decisión del dueño (tocan el estado de claves/protocolo): **H3, H4, M5, M6, F6, F7, F8** y los nuevos **SEC-2** (alta
  por ID auto-agrega desde una `acc` forjable) y **SEC-3** (autenticar el endpoint `/wake` al desplegar; quitar el token
  del diagnóstico tras probar la Fase 1).
- ▶️ **Pendientes activos restantes** (no bloqueados por el dueño): #19 (Wi-Fi Direct HD), #50 (texto en el margen 15 s),
  #83 (Wi-Fi no soltar a internet), #89 (notif heads-up — falta decisión de privacidad del dueño), #93 (micrófono AEC),
  #95 (Stream fase 2), #105 (pagos socio), #107 (iOS Fase 1 Bluetooth), #111 (logo/sonidos — elige el dueño). Varios
  dependen de decisiones o de pruebas en teléfonos.

## Decisiones del dueño 27-10 (madrugada) y nuevos pedidos
El dueño pidió trabajar autónomo por los pendientes, «cerrar algunos de forma robusta», orden a mi criterio. Decisiones:

**Bloque autónomo 27-10 tarde (orden del dueño: PRIMERO las implementaciones, las PRUEBAS al final «cuando esté completo todo»):**
- ✅ **Juego secreto «Defensor NEXO» — HECHO (2806).** Mini-arcade oculto (`src/ui/nexo_game.js`, `attachNexoUnlockGesture`): nave, meteoros (amenazas), mejoras de disparo, **salvar contactos**, clasificación. El dueño pidió dejarlo **sencillo** (lo simplifiqué). Prueba `tests/sim/juego.js`. El juego real se ve en el teléfono (jsdom no tiene Canvas).
  - ✅ **2810 (informe del dueño): el gesto de la «N» pasa de Ajustes a PERFIL.** En Ajustes el scroll se comía el trazo; ahora va en una zona dedicada del espacio negro de abajo de Perfil (`#nexo-gesture-zone`, `touch-action:none`). Batería 71/71.
- 💡 **Idea del dueño para #87 (app dormida): latido/ping mutuo entre contactos para mantenerse despiertos.** Honesto: por **internet** no despierta a un teléfono que Android ya congeló (Doze) sin un servidor de avisos (rompe el no-servidor); por **Bluetooth con contactos CERCA sí** ayuda (Android deja que la señal BT despierte la app un momento, como con las llamadas). Propuesta: **latido/despertar por Bluetooth entre cercanos** (lógica + prueba en sim; el efecto real del sueño solo se ve en los teléfonos → falta el «Copiar diagnóstico» de los dos). **Pendiente de que el dueño diga si arranco.**
- ⏳ **Logo y sonidos — mandados al dueño para que JUZGUE, sin desplegar (es muy exigente con la marca, rechazó un logo 2 veces).** Sonidos: 3 tonos originales (mensaje/llamada/videollamada), estéreo, campana de cristal, motivo de marca común. Logo: 2 tomas limpias (B = N cuya diagonal une dos nodos = «nexo», recomendada; C = N pura). Al elegir → pulir + generar todo el juego de iconos + cablear sonidos (res/raw + Kotlin + Web Audio).
- ✅ **Reorganizar Perfil + Ajustes (2807) — HECHO.** Perfil (identidad) separado del menú **⚙️ Ajustes** (seguridad, avisos, llamadas, internet, diagnóstico, cuenta); el **gesto de la «N» ya vive en Ajustes**. Una sola hoja a la vez. Pruebas actualizadas, batería 69/69.
- ✅ **Rendimiento de NEXO (2808) — HECHO.** Sección **⚡ Rendimiento** en Ajustes que mide y muestra en vivo: latencia (ping ida y vuelta), contactos en línea, mensajes entregados y %, tiempo de confirmación de entrega y de transferencia. Pasivo (escucha eventos ya existentes + reusa el RTT del supervisor). `src/ui/perf.js` + prueba `tests/sim/perfmetrics.js`. Batería 70/70.
- ▶️ **Pendiente del dueño (sin desplegar hasta su OK): logo (B/C) y sonidos.** Al elegir → pulir + generar iconos + cablear sonidos.
- 🔒 **Campaña de seguridad/robustez (orden del dueño: al final):**
  - ✅ **P0-4 (XSS) — HECHO (2809).** Confirmado que todo el contenido del remitente se pinta como texto; vigilante `tests/sim/xss.js` + CSP endurecida. Batería 71/71.
  - ▶️ Pendientes (endurecimiento del PROTOCOLO, más delicado — tocan estado de claves/control, solo verificables en el simulador; el dueño debe probarlos en los teléfonos): **H3** (tarjetas de contacto fijan claves sin verificar → marcarlas «de oídas»), **H4** (petición Fénix sin autenticar), **M5** (control `ni`/`kx`/`nm` sin autenticar), **M6** (`ss` sin autenticar), **F6** (wakelock/sonido por flujo sin autenticar), **F7** (FileProvider acotar). También: replay del ratchet, VOPR de fallos inyectados, fuzzing de medios.
  - Haré estos con cuidado, de a uno, cada uno con su prueba; antes de los más delicados (H3) confirmo con el dueño por ser estado de claves.
- ▶️ **AL FINAL (orden del dueño): campaña de seguridad/robustez** (XSS+CSP, H3/H4/M5, replay del ratchet, inyección de fallos, fuzzing).
- **Stream**: empezar por **Estados entre contactos, solo cercanos** (sin servidor), «luego vemos». Cifrados, caducidad 24 h (molde del cobro). Ver `STREAM_PROPUESTA.md`. (#104) → ✅ **HECHO en la 2799 (fase 1)**: `src/ui/estados.js`, tira «Estados» arriba de contactos, publicar/ver/quitar, texto 24 h cifrado como acción oculta del chat, prueba `tests/sim/estados.js`. Falta (más adelante, cuando el dueño lo pida): **foto/clip** de estado, y lo público/con-servidor («luego vemos»).
- **Pagos**: «lo implementamos y después vemos lo del socio». OJO: saldo/custodia real exige licencia o socio (Mercado Pago/CoDi) = Fase 2. Autónomo-seguro ahora: ampliar UX, maquetar; **recargas celulares** necesitan proveedor/API. (#105)
- **Archivos grandes + llamadas + videollamadas «siempre»** (incluido por internet). Archivos grandes por internet ya van (Tor ~22 MB). Llamada/videollamada por internet (#3) NO está y es dura (media en tiempo real sobre Tor/relés, quizá requiere TURN=servidor) — investigar y ser honesto. (#99)
- **Avisos de mala señal** (calidad de enlace). (#102)
- **Contacto**: tocar la FOTO → verla grande; tocar el NOMBRE → entrar al chat. (#100)
- **Gestos de deslizar-atrás** funcionales y ajustados. (#101)
- **Face ID** (desbloqueo por rostro) además de huella, más rápido. (#103) → **Análisis (necesita DECISIÓN del dueño; nativo, no se prueba en el simulador):** en Android no hay un «Face ID» aparte — el desbloqueo va por `BiometricPrompt` (plugin `nexo-auth`, `AuthPlugin.kt`), que **ya ofrece el rostro SI el teléfono tiene sensor facial FUERTE (Clase 3, p. ej. Pixel 4/algunos)**. Nuestro bloqueo exige `BIOMETRIC_STRONG` porque descifra la identidad con una clave del **Keystore atada a la autenticación** (`setUserAuthenticationRequired(true)`), y Android **no deja** atar esa clave a un rostro **DÉBIL (Clase 2)** — el que traen casi todos los teléfonos (cámara, se engaña con una foto). Por eso en el teléfono del dueño seguramente solo sale la huella: su rostro es Clase 2. Permitir el rostro débil significaría **soltar el cifrado del bloqueo** (autenticar solo «presencia», sin `CryptoObject`) = **menos seguro** para una app cuyo fuerte es la privacidad. **Pregunta para el dueño:** ¿quieres un «desbloqueo rápido por rostro (menos seguro)» como opción aparte, o mantener solo biometría fuerte (huella/rostro Clase 3)? **Diagnóstico útil:** ¿tu banco u otra app con biometría segura te ofrece el rostro? Si **sí** → tu sensor es Clase 3 y basta revisar por qué nuestro prompt no lo ofrece (fácil y seguro); si **no** → es Clase 2 y es la disyuntiva de arriba. NO lo toco a ciegas (método obligatorio: no afirmar/subir lo no comprobado; y no bajar la seguridad sin que lo decidas).
- **Auditoría** para verificar robustez y fallas. (#106)
- Buenas noches: el dueño se fue a dormir (~1:40 am), trabajo mientras tanto.

Orden que sigo (robusto, de a uno, con batería verde + APK): 2794 buscar ✓, 2795 ver una vez ✓, 2796 limpieza pagos ✓, 2797 foto/nombre (#100) ✓, 2798 mala señal (#102) ✓, **2799 Stream Estados fase 1 (#104) ✓**, **2800 auditoría (#106) ✓** (2 fallas reales arregladas), **2801 guardar en galería (#92) ✓**.

**Decisiones del dueño al despertar (27-10 mañana), respondiendo mis preguntas:** «1 dejalo opcional que el user decida, osea agregá Face ID. 4 ta. 5 si» →
- **#92 descargar a galería: SÍ** → ✅ **hecho en la 2801** (nativo `saveToGallery` + botón en el visor; no en «ver una vez»). **Validó mi flujo de builds NATIVOS** (sin SDK local: Kotlin se compila en CI; lo real se prueba en el teléfono).
- **#101 gestos deslizar-atrás: SÍ** («ta») → ✅ **hecho en la 2802**. `onBackPressed` en `MainActivity.java` → `window.__nexoHandleBack` (chat_nav): cierra en orden visor/estado/cámara/chat; sin dependencia nueva (`@capacitor/app` no hizo falta). Prueba `backbtn.js`. Nativo → a confirmar en el teléfono.
- **#103 Face ID: SÍ, OPCIONAL (el usuario decide)** → ✅ **hecho en la 2803**. El bloqueo real es `biometricAuth`/`biometricStatus` en **NexoBlePlugin** (el `AuthPlugin`/nexo-auth que miré primero está muerto, no se registra): es una puerta de PRESENCIA, no cifra. Ajuste «desbloqueo rápido por rostro (menos seguro)» en Perfil → Seguridad permite `BIOMETRIC_WEAK`; default fuerte, sin Keystore. Prueba `lock.js` (paso 12). Nativo → a confirmar en el teléfono.

**Los 3 nativos de la mañana subidos (2801/2802/2803), a confirmar en el teléfono.** Quedan, dependientes del dueño: pagos con saldo real/recargas (socio/proveedor #105), llamadas por internet (#99, quizá servidor TURN), y los bugs que no reproduzco en el simulador (#87 app cerrada, ○+Reintentar) que esperan su diagnóstico.

Siguen dependiendo del dueño: pagos con saldo real/recargas (socio/proveedor #105), llamadas por internet (#99, quizá servidor TURN), y los bugs que no reproduzco en el simulador (#87 app cerrada, ○+Reintentar) que esperan su diagnóstico.

## 0. Robustez: medición y tareas diarias (pedido del dueño 25-10)
`docs/ROBUSTEZ.md`: registro de la revisión 1 (24 y 25-10, builds 2766–2771: 63 fallos encontrados, 62 arreglados),
índice de robustez (medición inicial **45,3 sobre 100**; lo que más baja: casi nada confirmado en los teléfonos desde la
2765) y rutina diaria. Con la 2772: **44**. Con la 2774 (auditoría de seguridad): **41,8** — baja porque se añadió un área nueva y exigente
«Seguridad frente a ataques» (peso 10) con 9 puntos débiles abiertos que sacó la auditoría; no es regresión (la
seguridad mejoró: 8 arreglos + 16 pruebas, batería 51/51, Kotlin 87/87; ver `docs/AUDITORIA.md` y §0c). Con la 2777
(fase 2, C1 arreglado): **42,1** — las confirmaciones (✓✓) ya van firmadas con la pareja (un punto débil grave menos,
una prueba más), batería 52/52, Kotlin 90/90. Informe del dueño: 2778 (llamadas: menos ruido, pantalla al entrar llamada,
contestar deslizando) y 2779 (alta por ID: agregar a alguien lejano con su NEXO ID + solicitudes aceptar/eliminar; batería
53/53). Con la 2780 (informe del dueño: las fotos/archivos a un contacto lejano no llegaban): fotos y archivos medianos
(~6 MB) ahora SIEMPRE se pueden mandar por internet (buzón de los relés o Tor), botón «Reintentar» a los 30 s y reenvío
solo al volver la conexión; batería 53/53, índice **41,4** (baja de 42,1 al apuntar el bug del Wi-Fi→internet del dueño como punto débil grave abierto; no es regresión). Con la 2781 (informe del dueño: notas de voz): al grabar o al entrar una
llamada se para el audio que suena; pausar/reanudar la grabación; borrarla antes de enviar (`tests/sim/voicenote.js`);
batería 54/54, índice **41,7**. Con la 2782 (pedido del dueño): **editar un mensaje ya enviado** con etiqueta "editado"
(`chatactions.js` ampliada y metida en la batería, tag CHATACT); batería 55/55, índice **42,3**. Con la 2783 (pedido del dueño, todo en una APK): **reaccionar** (doble toque ❤️ + menú),
**gestos** (deslizar la burbuja izq/der para responder, deslizar el chat abajo para cerrar, pellizco/doble toque para
ampliar la foto), **palomitas iguales** en todas las redes (enviado ✓, entregado y leído ✓✓) y **micrófono** más
silencioso (gate −34 dB); `palomitas.js` + `chatactions.js` ampliada; batería 56/56, índice **42** (baja 0,3: se registró
como punto débil GRAVE el bug de la app cerrada del dueño; no es regresión). Con la 2784 (informe del dueño, todo JS): **#81** llamadas/videollamadas a pantalla completa en Android 14 — se pide el permiso al arrancar (sin él la llamada entra solo como aviso, sin Contestar/Rechazar); zoom de foto limitado al borde; franja de conectados sin parpadeo (histéresis 60 s); «Copiar diagnóstico» de la última hora. Batería 56/56, índice 42. El dueño confirmó que con la batería «Sin restricciones» las llamadas ya entran (faltaba la pantalla completa, ya en #81) pero los mensajes aún NO llegan con la app cerrada. Con la 2785 (NATIVO, las dos prioridades del dueño): **#1** la llamada entrante usa ahora `CallStyle` de verdad (pantalla de llamada real con Contestar/Rechazar grandes, en vez de un aviso normal que Samsung/Android 14 bajaba a aviso pequeño); **#87** WifiLock (FULL_HIGH_PERF) mientras NetBg escucha en segundo plano/cerrada (Android duerme la radio Wi-Fi con la pantalla apagada y tira el socket del relé) + **registro nativo persistente** (`NativeLog`) que ahora SÍ muestra en «Copiar diagnóstico» qué hizo el nativo con la app cerrada (antes el diagnóstico se armaba en el WebView, muerto con la app cerrada, y el hueco salía vacío). Batería 56/56, Kotlin 95/95 (+5 de `NativeLogTest`). **#87 sigue ABIERTO**: nativo, no reproducible en el simulador; a confirmar con el nuevo diagnóstico de los dos teléfonos (probar: app cerrada + pantalla apagada, mandar un mensaje, esperar ~2 min, abrir, copiar diagnóstico de los dos). #1 a confirmar con el permiso de pantalla completa concedido. Con la 2786 (informe del dueño: «que permita el envío de archivos grandes cuando hay internet; otra vez no mandó nada ni avisó si es por dimensiones»): el tope por internet pasa a ser **según el camino** — por los **relés** los medianos (~6 MB), por **Tor DIRECTO** también los **grandes (~22 MB)** (`_torDirect` en `media_limits.js`); y si un archivo no cabe por el camino de ahora **siempre sale un aviso claro** (tope + salida: activar Tor en Perfil o el contacto en el mismo Wi-Fi / Wi-Fi Direct / cerca), nunca más «no manda nada ni avisa»; además el **vídeo** que no se podía preparar antes fallaba en silencio y ahora avisa. Pruebas nuevas `tests/sim/bignet.js` (relés y Tor) en la batería. Con la 2787 (el dueño pidió avanzar «todos, uno a la vez, del más rápido al más complejo»): **Pagos Fase 1** — adjunto **"Cobro"** (💵) en el chat: importe, moneda, concepto y «cómo te pagan» (alias/CBU, enlace/QR de Mercado Pago/PayPal o efectivo); NEXO **nunca toca el dinero** (mensajería de cobros, sin licencia ni servidor); tarjeta con «Copiar datos»/«Abrir enlace», cifrada, por cualquier red. `src/ui/cobro.js` + prueba `tests/sim/cobro.js` en la batería (tag COBRO). Índice sin cambio (es una funcionalidad nueva, no un modo de fallo del catálogo). Con la 2788 (auditoría, lo seguro primero): **F9** — NEXO ya solo usa relés de internet **cifrados** (`wss://`); los en claro (`ws://`) quedan vetados salvo a loopback (pruebas/relé propio), porque por uno en claro un espía vería las etiquetas de tu buzón (`net_link.js` `relayUrls`+`_relaySafe`; prueba `relaytls.js`). Índice 42,1 → **42,5**. **Ojo: la APK de la 2788 NO se publicó** — el job «tests» de CI falló por un flake de `misroute.js` (la prueba, de enrutado BLE/Jump, no aislaba la red: jsdom trae `WebSocket` y `relayUrls()` caía a relés PÚBLICOS reales; en CI conectaban y el archivo «ausente» volvía «entregado»). El código F9 sí quedó en `NEXOCHAT`. La 2789 corrigió **dos detalles del dueño** —palomitas (entregado ✓✓ gris vs. leído ✓✓ azul; regresión mía de la 2783, era el color) y la **pantalla que se encendía con cada mensaje** (`wakeOnMsg()` por defecto false; regresión mía de la 2765; las llamadas siguen encendiéndola)— e intentó arreglar el flake con un stub de `WebSocket` en `misroute.js`, pero fue **INSUFICIENTE**: otra prueba volvió a conectar a relés reales y **la APK 2789 TAMPOCO se publicó**. Con la **2790** el arreglo de RAÍZ: el repliegue de F9 (`return safe.length ? safe : DEFAULT_RELAYS`) convertía la lista vacía del simulador (`NEXO_NET_RELAYS=[]`) en los relés PÚBLICOS reales; ahora `relayUrls()` respeta una lista vacía explícita como «sin relés» (se mantiene F9: una lista solo-en-claro cae a los `wss://` por defecto; producción no fija la variable → sin cambio). Revertido el stub; `relaytls.js` gana aserciones que fijan esto para siempre. La 2790 lleva TODO lo de la 2789 + F9 y por fin publica APK; índice sin cambio (42,5). El **○+«Reintentar»** (acuse que no vuelve) y el **#87** no se reproducen en el simulador → esperan el diagnóstico del dueño. El **○+«Reintentar»** (acuse que no vuelve) y el **#87** no se reproducen en el simulador → esperan el diagnóstico del dueño. **Siguiente (plan «todos, uno a la vez»): 2b) el RESTO de la auditoría (M5/M6 autenticar control, H3/H4) — toca el núcleo del protocolo (enlaces/nombres/sincronización), solo verificable en el simulador → hacerlo con cuidado y que el dueño lo pruebe en los teléfonos antes de confiarlo; 3) Stream (el más grande; además está «SIN DECIDIR»: sí/no y solo-cercanos/con-servidor). El #87 (endurecer NetBg) se intercala apenas lleguen los diagnósticos de los dos teléfonos (nativo; sin ellos no se puede medir). El bug GRAVE de
APP CERRADA (#87)** — con la app deslizada + pantalla apagada no llegan mensajes ni avisos (ni Wi-Fi ni internet) hasta
abrir; es nativo (la recepción vive en el proceso del WebView: al cerrar se apaga el LAN, y Doze duerme el proceso sin
WifiLock ni exención de batería), no reproducible en el simulador → falta el **diagnóstico de los dos teléfonos**. Después:
el aviso que solo sale como icono con la pantalla apagada (#89); el micrófono de calidad (loopback AEC de Chrome, investigado, #93),
el botón de descarga de foto/vídeo (#92); los medios de una sola vista (#94) — ✅ **fotos hechas en la 2795** («ver una vez», se borra al abrir; falta el vídeo de una vez); empezar la pantalla infinita / Stream (#95); el bug
del Wi-Fi→internet (#83, con ambas apps abiertas NO se reproduce, se mantiene en Wi-Fi); después el juego secreto (lluvia de
núcleos); y terminar la auditoría (H3, H4, M5, M6, F6–F9). El permiso de pantalla completa (#81) ya quedó hecho en la 2784.

## 0b. Hoja de ruta (opinión del 25-10, aceptada por el dueño)
Lo que más falta ya no es código nuevo, sino confirmar en el mundo real lo que existe. En orden de importancia:
1. **Confirmar en teléfonos** (3–4 distintos, uno barato o viejo) lo pendiente de §1, empezando por la 2773. Es lo que
   más fiabilidad da (y el índice: de 44 a ~65).
2. **Medir la batería**: 24 h con NEXO en segundo plano frente a WhatsApp, y recortar lo que sobre (el latido del Wi-Fi
   despierta al otro teléfono cada 4 s; búsquedas Bluetooth). Hoy no se sabe cuánto gasta.
3. **Muchos teléfonos a la vez**: todo se ha probado con 2–3; los núcleos son decenas. Simular 20 teléfonos virtuales
   (conexiones, búsquedas, Jump) y luego probar con 5–6 reales.
4. **Auditoría de seguridad externa** (plan del dueño, punto 19).
5. **Google Play**: target 36 (§3), política de privacidad, declarar los permisos (servicio en primer plano, micrófono,
   pantalla completa, batería), empresa y marca (`PLAN_NEGOCIO.md` §6–8).
6. **Núcleos y cobros**: perfil de negocio, cola de impresión de la papelería y "Cobros" sin licencia
   (`PLAN_NEGOCIO.md` §4–5, después de la consulta legal). Es lo que distingue a NEXO y lo que daría ingresos.
7. **iPhone**, después de un piloto que funcione en un núcleo.
8. **Frente a WhatsApp**: buscar en los chats, "Tu nombre" en Perfil (decisión, §6 punto 4), llamadas en grupo, estados.
- Técnico ya anotado: revisión 2 (`ROBUSTEZ.md` §6), meter en la batería las 18 pruebas de fuera, voz por un Bluetooth
  lento, AudioWorklet y DTX (§3), internet (relés y Tor) nunca probado en teléfonos.
- Decisiones del dueño: §4 y `PLAN_NEGOCIO.md` §8.
- **Semana 1 (26-10 → 1-11)**: lo del dueño primero (sus pruebas con la 2773); medir la batería; simulación de 20
  teléfonos; revisión 2, días 1–3 (avisos, grupos, seguridad).
- **Semana 2 (2-11 → 8-11)**: lo que salga de las pruebas; Google Play (target 36, permisos); diseño del perfil de
  negocio y de "Cobros".

## 0c. Auditoría de seguridad y robustez (ronda 2774): lo que queda
Informe completo, modelo de amenazas y plan: `docs/AUDITORIA.md`. En la 2774 se arreglaron 8 cosas (Wi-Fi: saludo
gigante, avalancha, archivo abortado, inundación de escaneo; JSON anidado que cerraba la app; intent de llamada
exportado; anuncio con ID mal formado; grupos que reescribían la lista y colaban claves) y la recuperación del WebView.
Queda, por prioridad (cada uno necesita un cambio de protocolo y probarse en los dos teléfonos del dueño):
1. ✅ **C1 ARREGLADO (grave, P0) en la 2777: confirmaciones (✓✓) ahora autenticadas.** Van firmadas con un MAC derivado
   del secreto de la pareja (`e2eAckTag`), también en modo cerrado: la app le pasa a la parte nativa una clave de firma
   por contacto (`setAckKeys`, en memoria del proceso, no a disco) y el Kotlin firma el ack del buzón igual. Una falsa
   (sin firma o con firma que no cuadra) se ignora, así que ya no para los reintentos ni hace perder un mensaje con ✓✓.
   Lo vigila `tests/sim/ackforge.js` (batería 52/52). ⚠️ Falta confirmarlo en los dos teléfonos del dueño.
2. **P0-1 ratchet: repetir (clave, IV)** al restaurar un estado viejo (copia, Fénix, pasar la cuenta sin apagar el
   teléfono viejo). Probar que nunca se repite y que el teléfono viejo deja de servir.
3. **H3 (media): tarjetas de contacto** fijan la clave de un contacto nuevo sin verificar. Marcarlas «de oídas»
   (pendientes) hasta el flujo normal de aceptación.
4. **H4 (media): Fénix** acepta la petición de recuperación sin autenticar. Exigir sesión E2E y mostrar solo la
   identidad verificada.
5. **Leves**: M5 (`ni`/`kx`/`nm` sin autenticar), M6 (`ss` sin autenticar), F6 (la radio renueva el wakelock/suena sin
   autenticar), F7 (FileProvider con rutas amplias), F8 (reservas de 40/512 MB de una vez), ~~F9 (`ws://` en claro)~~
   **HECHO en la 2788** (solo `wss://`; `ws://` solo a loopback), e IDs con `Math.random` (derivarlos de `getRandomValues`).
6. **Plan de pruebas «al límite»** (AUDITORIA.md §4): «VOPR de NEXO» (mundo determinista con fallos inyectados),
   fuzzing de medios (imagen/vídeo/Opus/VP8), GATT/BLE (MTU, muchas conexiones), y un modelo formal del protocolo.
   Ya hecho el primer tramo: fuzzing con semilla de los analizadores (Kotlin `ParserFuzzTest`) y pruebas de ataque de
   red y de grupos.

## Reglas para elegir el camino de envío (decididas por el dueño, 23-10-2026; revisadas el 24-10-2026, build 2761)
1. **Wi-Fi en el mismo router/módem: prioridad sobre todo** (seguro, rápido, no gasta datos) y **se mantiene, sin
   brincar**: no se deja por un pico ni por un corte breve (primero se intenta recuperar, 15 s); solo si está muy mal
   un rato (~12 s seguidos). Se vuelve a él cuando lleva ~30 s bien. Una foto a medias no cambia de camino por un pico.
2. **Wi-Fi muy malo o caído → internet** (los dos en Wi-Fi). **Sin internet → Bluetooth** (y Jump si no hay alcance).
3. **Wi-Fi Direct**: para fotos, vídeos y archivos grandes cuando no hay Wi-Fi común ni internet, antes que Bluetooth.
4. **Con datos móviles / contacto lejano**: los textos y, desde la 2780 (nueva decisión del dueño: «las fotos/archivos
   siempre se pueden mandar»), **también las fotos y archivos medianos (~6 MB)** van por internet. Antes los archivos
   esperaban al Wi-Fi; ya no. **Desde la 2786** (informe del dueño: «que permita el envío de archivos grandes cuando hay
   internet; otra vez no mandó nada ni avisó si es por dimensiones») el tope por internet es **según el camino**: por los
   **relés** van los medianos (~6 MB; cientos de eventos pequeños saturan los relés públicos), pero por **Tor DIRECTO**
   (una conexión .onion entre los dos teléfonos, sin relés) van también los **grandes (~22 MB)**, como por Wi-Fi Direct.
   Los que no caben por internet (o >22 MB) esperan al Wi-Fi común, Wi-Fi Direct o Bluetooth cerca (hasta 1 GB). Clave:
   **nunca se queda sin mandar y sin avisar** — si un archivo no cabe por el camino de ahora, sale un aviso claro que dice
   el tope y la salida (activar Tor en Perfil, o el contacto en el mismo Wi-Fi / Wi-Fi Direct / cerca). Si algo no sale en
   30 s o falla, en la burbuja sale «Reintentar» y, al volver el internet/Wi-Fi, se reenvía solo.
5. **Ningún camino**: pendiente, intentando Bluetooth cada poco; sale por internet o Wi-Fi, lo que llegue primero.

## 0d. #87 — cómo lo hace la competencia (investigación 26-10; `docs/ENTREGA_CERRADA_INVESTIGACION.md`)
Pedida por el dueño ("no hay que inventar nada, ya existe"). Conclusión con fuentes: **no hay un tercer truco mágico.**
Para recibir con la app CERRADA solo hay dos caminos: **(A) un PUSH por servidor/puente** (FCM/APNs/UnifiedPush: alguien
con un servidor encendido conoce tu token y te "despierta"; es lo de WhatsApp/Signal-Play/Telegram) o **(B) una CONEXIÓN
VIVA** en el teléfono (servicio en primer plano + socket + exención de batería + WifiLock; es lo de Signal-sin-Google,
Briar, Pokey y **el NetBg de NEXO**). **NEXO ya va por (B), el correcto para un P2P sin servidores.** El #87 no es que
falte una pieza secreta: es que (B) todavía no sobrevive bien a Doze ni a los ahorradores de cada marca (Vivo/Xiaomi
matan la app; el dueño ya vio que con batería "Sin restricciones" las llamadas SÍ entran → el cuello es la salud del
servicio, no un push). **No hay un push de Nostr aprovechable** listo: los eventos de NEXO son a medida y doblemente
cifrados, ningún push-server genérico sabe que son "para ti"; tener push exigiría que ALGUIEN corra un puente
Nostr→FCM/UnifiedPush = un servidor (decisión del dueño; rompe en parte el "cero servidores"; iOS necesitaría APNs).
Límite honesto: **"exactamente como WhatsApp" (que suene tras horas dormido) necesita push (A)**; sin push, NEXO queda
como Briar/Signal-sin-Google (va con batería exenta y la app sin matar, pero es "lo mejor posible", no garantizado).
Plan sin servidor (orden de impacto), a cerrar con el diagnóstico de los dos teléfonos en 2785:
1. **Endurecer NetBg / modelo B** (ataca el #87): tipo de foreground service de Android 14, `START_STICKY` + reinicio en
   `onTaskRemoved` + `BOOT_COMPLETED`, websocket con reconexión/keepalive/re-auth NIP-42; guía de batería por marca.
2. **Llamada entrante con app cerrada SIN push**: si NetBg vive, el relé ya trae la oferta; marcar la oferta de llamada
   en el sobre para que NetBg lance la pantalla completa (CallStyle/#1 y permiso/#81 ya están) y el emisor la mantenga
   "caliente" ~30-60 s. (Si NetBg está muerto, no suena — igual que Jami/SimpleX.)
3. **Red de seguridad WorkManager (~15 min)**: si NetBg no vive, despertar, reconectar, bajar el buzón y avisar (sirve
   para mensajes en ≤15 min, no para llamadas).
4. (Opcional, decisión del dueño) **Fase 4**: montar/confiar un puente de push Nostr→FCM/UnifiedPush = lo único que daría
   "igual que WhatsApp" aun con el socket caído, pero es un servidor.
Siguiente paso real: el dueño instala la 2785 en los DOS teléfonos de prueba (batería "Sin restricciones") y manda el
diagnóstico con REGISTRO NATIVO; con eso se ve si el camino de internet (relé, modelo B, YA en 2785) entrega el texto
cerrado — en cuyo caso el #87 de mensajes ya está, y solo queda la llamada cerrada (punto 2).

## 1. Pendiente de pruebas del dueño en el teléfono
- **Qué APK probar (25-10)**: la 2773 (nightly-2773; la 2772 no salió) para todo. Desde la 2763 no hay pruebas completas en teléfonos:
  todo lo de abajo desde la 2765 está sin confirmar (salvo los informes de videollamada con la 2768 y del 25-10 con la
  2771, ver 2769 y la ronda 2772).
- **2773** (ronda 2772: informe del dueño del 25-10; actualizar los dos teléfonos): (1) **Pantalla apagada con Wi-Fi**: los dos en
  el mismo Wi-Fi, uno con la pantalla apagada 2–3 min; mandarle un texto y una foto: debe sonar el aviso sin encender
  la pantalla y en el que manda salir ✓✓ enseguida. Si no, en el que tenía la pantalla apagada: Perfil → "Avisos con
  la pantalla apagada" → todo en ✅ y, en el Vivo, "Abrir" en su fila (activar «Inicio automático» y «Alto consumo en
  segundo plano»), y repetir; si sigue, diagnóstico de los dos (líneas `[ENERGIA]`). (2) **Videollamada**: girar la
  cara a la derecha: en el otro teléfono se ve como en un espejo (igual que tu vista pequeña); la imagen se ve entera y
  no estirada; dos toques en la imagen la ponen a toda la pantalla (y otros dos la devuelven); con la cámara de detrás,
  sin espejo; Perfil → Videollamadas → quitar "Ver al otro como en un espejo" lo deja al derecho. (3) **Micrófono**:
  llamada con altavoz, uno habla 10 s y el otro calla: ¿se oye eco? Hablar los dos a la vez: ¿se cortan? Con cascos,
  igual. Mejor con los teléfonos en habitaciones distintas: juntos en la misma sala y con altavoz siempre hay eco entre
  ellos (en cualquier app). Diagnóstico de los dos (`[CALL] Al colgar: … filtros: …, cancelador de eco …`). (4)
  **Escaneo**: "Agregar" con la tablet y los dos teléfonos (el dueño no lo ha probado desde la 2765).
- **2771** (revisión, parte 4: interfaz): (1) "Agregar" (botón redondo): salen tus contactos y los teléfonos cerca;
  escribir en el buscador un nombre o parte del NEXO ID los filtra. (2) En la lista, ⋮ de un contacto → "Cambiar
  nombre": se abre su chat con el nombre listo para escribir; el nombre nuevo se queda. (3) Perfil: tus iniciales y
  "Tus contactos te ven como «…»". (4) Quitar el permiso del micrófono y grabar una nota de voz: el aviso dice "Permiso
  de micrófono denegado" y dónde darlo. Decir cualquier texto raro, cortado o en inglés que se vea.
- **2770** (llamadas con la pantalla bloqueada): (1) en una llamada de voz y en una videollamada, bloquear la pantalla
  con el botón 30 s y luego ir a otra app 30 s: el otro debe seguir oyendo todo el rato (diagnóstico: `en segundo plano:
  micrófono`); en la videollamada la imagen se para mientras (el otro ve tu foto) y vuelve al regresar a NEXO. (2) Con música o un vídeo sonando en otra app, hacer o recibir una llamada: se para y vuelve al colgar.
  (3) En una llamada con el teléfono en la oreja, cerrar NEXO (quitarla de recientes): al tapar el sensor ya no se apaga
  la pantalla y la música vuelve. (4) Recibir una llamada con NEXO abierto y el teléfono en silencio (no suena), en
  vibración (solo vibra) y normal (suena); y con NEXO en segundo plano: suena solo el aviso del sistema, una vez.
- **2769** (videollamada robusta; informe del dueño: el S24 a veces salía sin cámara, negro en el Vivo y no se le oía):
  (1) varias videollamadas Vivo ↔ S24 seguidas (colgar y volver a llamar enseguida; contestar con la app en segundo
  plano y con la pantalla bloqueada): imagen y voz en los dos. Si falla, sin apagar ni encender nada, decir qué se ve
  arriba (avisos amarillos) y pasar **Perfil → Copiar diagnóstico de los dos** (línea `[CALL] Micrófono: …`).
  (2) Dejar una videollamada 2–3 min sin tocar: la pantalla no se apaga. (3) Llamada de voz en la oreja: la pantalla se
  apaga al acercarla y vuelve al apartarla; el otro sigue oyendo. (4) Que el otro apague y encienda su cámara: sale su
  foto con "Cámara apagada" y luego vuelve la imagen. (5) Abrir la cámara del chat y, sin cerrarla, recibir una
  videollamada y contestar: imagen y voz.
- **2768** (revisión, parte 3: llamadas): (1) con la app del otro cerrada (quitada de recientes), llamarle y que toque
  "Rechazar": su teléfono suena una sola vez (antes volvía a sonar cada pocos segundos). (2) Con su app en segundo
  plano, "Rechazar" en el aviso: en el que llama sale "Rechazada" al momento. (3) Llamarse los dos a la vez: quedan en
  llamada. (4) Videollamada con el permiso de cámara quitado (Ajustes → Apps → NEXO → Permisos): sigue con voz. (5) En
  una videollamada, girar la cámara y colgar: se apaga la luz de la cámara. (6) Llamada por Wi-Fi y apagar el Wi-Fi de
  uno: la voz sigue por Bluetooth. (7) Llamada de 1–2 min con la pantalla apagada (el teléfono en la oreja, sin tocarlo):
  decir si el otro dejó de oír (riesgo de Android 11+; en el diagnóstico `[CALL]`, el micrófono a 0 %). Diagnóstico de
  los dos teléfonos.
- **2767** (revisión, parte 2: mensajes y archivos): con el otro teléfono lejos (o con su Bluetooth apagado), escribir
  varios textos cortos y largos y grabar una nota de voz; cerrar NEXO (quitarla de recientes) y volver a abrirla; acercar
  el otro teléfono: todo debe llegar una sola vez, legible, en el orden en que se escribió y como nota de voz (no
  "[adjunto]"); ninguna burbuja debe pasar a "!" al rato. Un vídeo o archivo grande por Bluetooth debe avanzar hasta el
  final aunque tarde más de 10 min.
- **2766** (revisión, parte 1): (1) dejar un chat abierto 1–2 min sin escribir y luego escribir: debe llegar al momento;
  en el diagnóstico no deben salir `sin respuesta a 2 pings` ni `Peer ready` cada ~30 s. (2) Repetir tablet → S24 con
  el Vivo cerca (archivo y llamada): solo el S24. (3) En el mismo Wi-Fi, mandar una foto elegida de la galería: debe ir
  por Wi-Fi (rápida). (4) BUSCAR: a los ~15 s el botón vuelve solo a BUSCAR. (5) Foto de perfil: Perfil → tocar el
  círculo → Cambiar foto; en el otro teléfono sale en la lista y en la llamada. (6) Con la pantalla apagada: un mensaje
  la enciende y una llamada suena a pantalla completa encima del bloqueo; Perfil → "Avisos con la pantalla apagada"
  todo en ✅ (con "Arreglar"). (7) Perfil → Internet: Tor con su dirección .onion (antes "sin dirección .onion").
- **2765** (la 2764 no salió): **repetir la prueba de la tablet → S24 con el Vivo cerca** (archivos y llamada: solo debe sonar/avisar el S24)
  y pasar el diagnóstico de los tres; en la tablet, "Agregar": deben salir los teléfonos cercanos con su nombre (aunque
  el otro no tenga "Agregar" abierto) y agregarse con "+"; con el teléfono girado, que no salga la barra gris a la izquierda; en un grupo, un vídeo (llega el HD a
  todos) y un archivo grande (con los demás en el mismo Wi-Fi).
- **2763** (la 2762 no llegó a salir): llamada y videollamada (que se oigan los dos; diagnóstico `[CALL]` de los dos
  teléfonos), pantalla de llamada nueva (girar cámara, imagen propia arrastrable), llamada entrante con tono y
  Contestar / Rechazar (también con la app cerrada), estilo NEXO en toda la app, avisos de grupo con su nombre,
  pasar la cuenta a un teléfono nuevo (mismo Wi-Fi).
- **2761**: fotos por Bluetooth entre los dos teléfonos (sin Wi-Fi ni internet), que el enlace no se rehaga cada ~30 s
  (diagnóstico de los dos: líneas `Enlace … desconectado` / `sin respuesta a 2 pings`), Wi-Fi sin brincar, avisos con
  la app en segundo plano en el Vivo (que congela la app) y con la app cerrada por Jump.
- 2718: chat (responder, reenviar, eliminar, copiar) y cámara nueva.
- 2720: los datos siguen tras actualizar; huella y bloqueo de capturas.
- 2725: fotos en las dos direcciones sin quedarse paradas.
- 2728: Wi-Fi normal y cambio de camino. **Informe del dueño: estando en Wi-Fi, al mandar una foto pasó a
  Bluetooth (los dos en el mismo router)** → corregido en la ronda 2730 (reglas del dueño; ver PROGRESO).
- 2730: Wi-Fi (seguir en Wi-Fi con la app en segundo plano y en cortes breves), QR del número de seguridad,
  aviso "Protección poscuántica activa", Jump con remitente oculto.
- Wi-Fi Direct: falta el diagnóstico con tiempos para acelerarlo.
- 2749: Tor nuevo (0.4.9.14) e internet en general (relés y Tor reales no se alcanzan desde el entorno de desarrollo).
- 2751/2752: notificaciones (permiso, una por chat, número en el icono, tocar abre el chat), contadores de no leídos,
  "leído" solo con la app a la vista, recibir por internet con la app en segundo plano.
- 2754: fotos, vídeo y PDF por Bluetooth en binario (deben llegar enteros y algo más rápido); y con un teléfono en la
  2752, que todo siga llegando.

## 2. Funciones nuevas
- **Llamadas de voz**: hechas en la 2758 (Bluetooth a alcance o mismo Wi-Fi / Wi-Fi Direct, Opus cifrado); con la app
  cerrada avisa "Llamada entrante" y botón de altavoz (2759); suena como una llamada del teléfono con Contestar /
  Rechazar (2763). Falta: probar en teléfonos (eco, volumen, Bluetooth con MTU pequeño).
- **Videollamadas**: hechas en la 2758 (mismo Wi-Fi). Falta: por Wi-Fi Direct (hoy su enlace es por transferencia,
  no continuo), probar en teléfonos. Cámara trasera: hecho (botón Girar, 2762).
- **Pagos**: investigación en `docs/PAGOS_PROPUESTA.md` (regla de oro: lo que exige licencia es CUSTODIAR el dinero; si
  NEXO nunca toca fondos, es "mensajería de cobros" sin licencia). **Fase 1 HECHA en la 2787**: el adjunto **"Cobro"**
  en el menú (💵) — importe, moneda, concepto y "cómo te pagan" (alias/CBU, enlace/QR de Mercado Pago/PayPal, o
  efectivo); viaja cifrado como cualquier mensaje (Bluetooth/Wi-Fi/Jump/internet); tarjeta en el chat con "Copiar datos"
  y "Abrir enlace"; NEXO nunca toca el dinero (`src/ui/cobro.js`, prueba `tests/sim/cobro.js`). **Falta**: Fase 2 "un
  toque" con proveedor licenciado (Mercado Pago/PayPal, comercios) y, si el volumen lo justifica, "tipo PayPal" con un
  socio con licencia (NEXO como proveedor técnico). Marca: no "NEXO Pay". **Pendiente de limpieza antes de la tienda**:
  borrar el prototipo viejo y MUERTO de "payment/transfer" con firma inventada en `src/app/nexo_app.js` (sin UI que lo
  dispare hoy; no choca con el tipo nuevo 'cobro'). Asesoría legal del flujo (ver `PAGOS_PROPUESTA.md` §4) antes de la
  Fase 2.
- **Stream** (vídeos tipo TikTok + estados de contactos, gestos: tap arriba izq. vídeos, arriba der. estados, doble tap
  "me gusta", deslizar der→izq comentarios, izq→der volver): **SIN DECIDIR** (sí/no; solo cercanos o con servidor).
  **Propuesta en `docs/STREAM_PROPUESTA.md`** (27-10): los 3 caminos (A solo-cercanos / B buzón de relés / C servidor);
  recomendación = empezar por **"Estados" entre contactos, E2E, 24 h** (sin servidor, un tipo de mensaje con caducidad,
  como el cobro); el feed público global necesitaría servidor (C). Falta que el dueño decida arquitectura y alcance.
- **Chats de grupo**: hechos en la 2758 (textos y adjuntos de hasta ~1 MB); HD de vídeo y archivos grandes (hasta
  1 GB) en grupos: hechos en la 2764. Nombre del grupo en el aviso con la app cerrada o congelada: hecho (2763).
- **Internet** (contactos lejos, Wi-Fi de módems distintos): hecho en la ronda 2739 con relés públicos Nostr y Tor
  (decisión del dueño 23-10, "2 y 3"; ver `docs/INTERNET.md`). Falta: confirmar en los teléfonos (los relés y Tor
  reales no se alcanzan desde el entorno de desarrollo); servidor propio si los relés públicos fallan o limitan.
  Recibir con la app en segundo plano: hecho en la 2751 (NetBg nativo).
- **iPhone**: plugin en Swift, cuenta Apple Developer (99 USD/año), Mac o runners macOS, iPhones para probar.
- **Núcleos** (universidad, papelería, cafetería…) y **caso papelería** (PDF → imprimir → pagar).
- **Fénix**: hecho en la ronda 2732 el respaldo de los mensajes de texto (fase 2). Falta: fotos, vídeos y archivos
  (mejor por Wi-Fi); pingeo por Jump (hoy solo con el contacto conectado).

## 3. Mejoras de lo que ya existe
- **Archivos grandes** (pedido del dueño 24-10, un APK de 24 MB no salía): hecho en la 2756, hasta 1 GB por el mismo
  Wi-Fi o Wi-Fi Direct, a disco por trozos y con clave propia por archivo. Falta: reenviarlos, y por Bluetooth/Jump
  (demasiado lento) o internet (relés: no admiten archivos así).
- **Velocidad**: archivos en binario hecho (2754); L2CAP; Wi-Fi Direct más rápido; detectar y renegociar MTU
  pequeño (algunos teléfonos se quedan en 20 bytes por escritura).
- **Jump con más alcance**: hecho en la ronda 2731 (en el teléfono, por confirmar): Bluetooth de largo alcance (LE
  Coded PHY, ~4x distancia entre teléfonos que lo tengan; el diagnóstico dice `[JUMP] Largo alcance (LE Coded): sí/no`)
  y hasta 8 saltos (antes 4). Ya existía guardar y reenviar (el puente guarda hasta 24 h). Falta: Jump también por
  Wi-Fi; Jump con la app en segundo plano o cerrada.
- **Seguridad (resto de la fase 3)**: identificador Bluetooth rotativo hecho (2756). Hechos en la
  ronda 2730: remitente oculto a los puentes, poscuántico (ML-KEM) y QR del número de seguridad.
- **Compatibilidad (visto en la batería de la 2757)**: con un puente Jump en una build anterior a la 2755
  (`jump.js --bridge-build=builds/93dd9ad`), lo que el puente guarda tarda ~80 s en llegar al destino cuando vuelve
  (antes de la 2756, ~14 s; con el puente en la build actual, ~14 s). Pasa igual con el código de la 2756: no lo
  causan los cambios de la 2757. Causa sin confirmar (probablemente el ID rotativo: la build vieja no reconoce el
  código del destino y sus reintentos van al enlace anterior hasta que aborta y vuelve a empezar). Solo afecta si
  algún teléfono sigue en una build vieja.
- **Fiabilidad**: recibir por Bluetooth con la app cerrada hecho (2757; falta comprobar en teléfonos que Android no
  cierre el proceso); falta `@capacitor/app`.
  Hecho en la ronda 2744: fuera `NordicMeshService` del manifiesto, emojis y acentos (prueba en `e2e.js`; la vista
  previa partía emojis), nombres ya iban como texto en la lista.
- **Base estable nueva** (≥ 2725) cuando el dueño confirme.
- **Llamadas (de la investigación del 25-10, ronda 2772)**: pasar el micrófono a un AudioWorklet (hoy ScriptProcessor en
  el hilo de la interfaz: si se atasca, cortes de voz); DTX en Opus (no mandar voz en los silencios: batería y datos;
  hace falta que el que recibe rellene los huecos); avisar al otro de "estoy hablando" en cada paquete (mejor detección
  de los dos hablando a la vez); vídeo sin pasar por el lienzo (MediaStreamTrackProcessor: menos copias y batería);
  probar el codificador de vídeo por hardware en los dos teléfonos; calidad de vídeo según la conexión (240x320 a
  10 fps si va mal).
- **Batería con la pantalla apagada (2772)**: el latido del Wi-Fi (cada 4 s) despierta al otro teléfono aunque tenga la
  pantalla apagada; que el despierto mande menos latidos cuando el otro está en segundo plano (hace falta avisarlo sin
  romper las versiones anteriores).
- **Google Play (de la investigación del 25-10)**: desde el 31-08-2026 las apps nuevas y actualizaciones en Play deben
  apuntar a Android 16 (target 36; prórroga posible hasta el 1-11-2026); NEXO apunta a 34. Pasar a 36 antes de subir a
  Play (cambios de comportamiento que revisar). Además, desde 2027 Android exigirá desarrolladores verificados también
  para instalar APK fuera de Play (ya en Brasil, Indonesia, Singapur y Tailandia desde el 30-09-2026).

## 4. Decisiones pendientes del dueño
1. Stream: ¿sí o no? ¿solo cercanos o con servidor?
2. ~~Internet: punto de encuentro~~ — decidido el 23-10: relés públicos + Tor, sin servidor propio por ahora
   (ronda 2739). Queda abierto si más adelante se quiere un servidor propio.
3. Pagos: modelo y país. Propuesta en `docs/PLAN_NEGOCIO.md` (25-10), con las decisiones de su §8: país, ¿código
   abierto?, empresa, nombre del módulo de pagos, precio de NEXO Plus.
4. iPhone: ¿cuenta de Apple?
5. ~~Identificador Bluetooth rotativo~~ — decidido el 24-10 ("empieza por el 4"): hecho en la ronda 2756 con la
   propuesta (ver §5 punto 4). La opción "Ayudar a la red" no hizo falta como interruptor: el código rotativo ya es
   la marca anónima de la red; queda pendiente decidir si se quiere un interruptor para no contestar a desconocidos
   (ver los límites en §5 punto 4).
6. Orden propuesto: lo que falle en sus pruebas → velocidad (binario, L2CAP) → llamadas de voz → Jump de más
   alcance → seguridad restante → grupos → videollamadas.
7. **"Rechazar" con la app cerrada** (revisión de llamadas, 2768): la parte nativa no tiene las claves (están en la
   app), así que no puede mandar nada cifrado. Opciones: (1) solo deja de sonar en este teléfono y el que llama ve "No
   contesta" a los 45 s; nada sale sin cifrar. (2) Aviso al momento sin cifrar: el que llama ve "Rechazada" enseguida,
   pero un teléfono cercano con un NEXO modificado podría hacer que sus llamadas salgan "Rechazada". (3) Aviso al
   momento firmado: con la app abierta, cada pareja de contactos se pasa (cifrada) una clave pequeña solo para estos
   avisos y la parte nativa la usa sin abrir la app; nadie lo puede falsificar y sirve también para que el aviso deje
   de sonar en cuanto el otro cuelga de verdad. Es más trabajo (una build más). Propuesta: la (3); mientras
   tanto, la 2768 va con la (1). **Decidir con el dueño.**
8. **Texto durante el margen de 15 s del Wi-Fi**: ver §6 punto 1 (propuesta: si el Bluetooth está listo, mandar los
   textos por él al momento). **Decidir con el dueño.**

## 5. Plan del dueño (23-10): completar lo que falta y mejorar los puntos débiles de la comparativa (sin iPhone)
De lo más simple a lo más complejo. Estado:
1. ✅ (2744) Limpieza: versiones reales en los registros, fuera `NordicMeshService`, tarjetas de pago escapadas.
2. ✅ (2744) Pruebas en cada build: trabajo `tests` en el workflow (Kotlin JVM + `tests/sim/ci.js`, 9 escenarios); si
   falla, no hay APK. Ya encontró un fallo real (Jump + internet, ver ronda 2744).
3. ✅ (2744) Emojis y acentos: llegan idénticos; la vista previa ya no parte emojis.
4. ✅ (2756) ID Bluetooth rotativo: en el aire, un código que cambia cada 15 min y que solo reconocen los contactos
   (sale de su clave pública); ni NEXO ID ni nombre del teléfono. El NEXO ID solo con "Agregar" abierto (5 min) o sin
   contactos todavía: **para agregarse cerca, los dos abren "Agregar"**. Jump y Fénix conectan de paso con los NEXO
   "anónimos" y saben quién es cada uno al conectar; quien busca camino manda los códigos del destino ('dk').
   Límites (honestos): quien se conecta a tu teléfono sí recibe tu NEXO ID (lo necesitan Jump y Fénix); el Wi-Fi
   local sigue usando la marca del día sacada del NEXO ID; Android cambia la dirección Bluetooth por su cuenta (no
   siempre a la vez que el código); una build anterior no reconoce el código (nosotros sí nos conectamos con ella).
5. ✅ (2749) AGP 9.4.0 / Gradle 9.6.0 / Kotlin 2.2.20 / compileSdk 37.1 y Tor 0.4.9.14 (targetSdk sigue en 34).
6. ✅ (2752) Dividir `main.js` (4.281 → 720 líneas) y `ble_interface.js` (3.732 → 847) en 30 módulos sin cambiar el
   código (`docs/ESTRUCTURA.md`). 7. ✅ (2754) Bluetooth sin base64: los trozos de datos de fotos, vídeos y archivos
   van en binario (−25 % de bytes por la radio, ~25–35 % más rápido en el simulador); solo con teléfonos que lo
   anuncian (`bf`), con builds anteriores sigue el JSON de siempre.
8. ✅ (2757) MTU pequeño: el Kotlin pedía el MTU y activaba las notificaciones a la vez (Android hace una operación
   GATT a la vez: a menudo se perdía el MTU y la conexión quedaba en 23 bytes); ahora en orden, con un reintento y
   `[MTU]` en el diagnóstico. Trozos por bytes reales (MTU − 3) y trozo mínimo 240 con MTU pequeño (foto con MTU 23:
   215 → ~95 s). 9. ✅ (2757) Fénix para fotos, notas de voz, previas de vídeo y archivos de hasta ~1 MB (fase 3).
   10. ✅ Jump por Wi-Fi: ya funcionaba (el enlace Wi-Fi es un vecino más); ahora probado (`jump.js --wifi-ab`).
11. ✅ (2751) Recibir por internet en segundo plano (NetBg nativo) + notificaciones del teléfono + número en el icono
   + contadores de no leídos por todas las vías (pedido del dueño 23-10). 12. ✅ (2757) Recibir por Bluetooth con la app
   cerrada: buzón nativo, ✓✓ al emisor y notificación; al abrir llega todo (`BgInbox.kt`). 13. L2CAP: fase 1 ✅
   (2758) archivos grandes por Bluetooth L2CAP sin Wi-Fi; fase 2: fotos, vídeo HD y archivos medianos por L2CAP.
14. Grupos ✅ (2758): textos, fotos, audio, ubicación y archivos de hasta ~1 MB; HD de vídeo y archivos grandes ✅
   (2764). 15. Varios dispositivos: decidido por el dueño el 24-10 → **opción A primero: pasar la cuenta a un teléfono nuevo**
   (QR en el nuevo, el viejo lo escanea y le pasa por Wi-Fi/L2CAP, cifrado, NEXO ID, claves, contactos, historial,
   fotos y grupos; el viejo se desactiva). La B (varios dispositivos activos a la vez) queda para más adelante.
   ✅ A hecha en la 2759 (Perfil → Cambiar de teléfono; mismo Wi-Fi). Falta: probar en teléfonos; sin Wi-Fi común. 16. Llamadas de voz ✅ (2758, fase 1: con el
   contacto cerca o en el mismo Wi-Fi; suena como una llamada del teléfono, también con la app cerrada: 2763). 17. Videollamadas ✅ (2758, mismo Wi-Fi).
- (Resuelto en la 2759: era la prueba) `fenix.js` a veces recuperaba 5 de 6 mensajes y 1 de 2 archivos.
18–20 (del dueño): pruebas reales con 3–4 teléfonos, auditoría externa, Play Store.


## 6. Revisión completa por partes (pedida por el dueño el 24-10)
**Revisión 1 cerrada el 25-10 (builds 2766–2771)**: registro, cifras y medición en `docs/ROBUSTEZ.md`; la revisión 2
sigue el calendario de ese documento (§6). Lo de abajo es el detalle de la revisión 1 y sus puntos débiles abiertos.
Orden: escaneo → agregar → conexión → mensajes cortos y largos y archivos → llamadas y videollamadas → interfaz; con
mejoras donde se vea la oportunidad. Método: cada fallo se reproduce en el simulador antes de corregirlo.
1. **Escaneo, agregar y conexión** — hecha en la 2766 (ver PROGRESO, "Ronda 2766"). Quedan puntos débiles, sin fallo
   visto todavía en las pruebas:
   - Varios enlaces con el mismo contacto a la vez (Android usa direcciones distintas) y conexiones de paso que no
     llegan a identificarse; en algunos sitios la identidad aún se deduce de la dirección.
   - Nativo: `disconnectDevice` solo cierra los enlaces en los que este teléfono es el cliente (si el otro es el
     cliente, el enlace sigue: no se usa `cancelConnection`). Señalado por la revisión, sin comprobar aún: la
     reconexión nativa necesita haberlo visto al escanear.
   - El "no soy yo" (`ni`) y las confirmaciones no van firmados (un teléfono cercano malicioso podría desviar o marcar
     ✓✓); el código rotativo se puede calcular con la clave pública (quien la tenga reconoce el código).
   - Android 8–11 necesita la ubicación activada para escanear y el nativo no lo comprueba: falta avisar si está
     apagada.
   - Wi-Fi: si se va el Wi-Fi, un texto escrito en el margen de 15 s (regla del dueño: no brincar) espera a que acabe
     y llega por Bluetooth a los ~15 s (desde la 2767 ya no sale "!" mientras tanto). Propuesta: si el Bluetooth está
     listo, mandar los textos por él al momento sin cambiar el camino (las fotos seguirían esperando al Wi-Fi).
     **Decidir con el dueño.**
2. **Mensajes y archivos** — hecha en la 2767 (ver PROGRESO, "Ronda 2767"): textos largos que se perdían mostrando
   "entregado", nota de voz como "[adjunto]", transferencias de más de 10 min cortadas, Wi-Fi caído a mitad de una foto
   con un Bluetooth lento, orden en el chat (también lo recibido con la app cerrada), reintento que pisaba la entrada
   pendiente. Quedan puntos débiles, sin fallo visto todavía en las pruebas:
   - Con la app cerrada, la parte nativa confirma ✓✓ en cuanto guarda el mensaje, antes de que la app lo descifre; si
     la app falla al arrancar, ese mensaje se pierde con ✓✓ en el otro.
   - Si el receptor perdió lo que llevaba (se reinició), pide de nuevo todos los trozos sin límite de ritmo (NACK).
   - El registro de envíos guarda el cifrado de hasta 50 transferencias en un solo archivo por contacto (riesgo de
     memoria con varios vídeos HD).
   - Si se perdió la confirmación final de un archivo, al reconectar se manda entero otra vez (el receptor solo
     recuerda 60 s lo recibido) y sale otra notificación.
3. **Llamadas y videollamadas** — hecha en la 2768 (ver PROGRESO, "Ronda 2768"): 14 fallos, arreglados 13, entre ellos
   el de seguridad (un teléfono cercano con un NEXO modificado podía hacerse pasar por un contacto en textos, archivos y
   llamadas). **2769** (informe del dueño: videollamada Vivo ↔ S24 a veces sin cámara, negra y sin voz): cámara y
   micrófono con reintentos y vigilante, codificadores y decodificadores que se rehacen, foto y motivo en vez de negro,
   avisos de los dos, sin micrófono la llamada sigue, pantalla encendida en llamada y sensor de proximidad (ver
   PROGRESO, "Ronda 2769"); falta el diagnóstico de una videollamada que falle para confirmar la causa.
   Queda: el punto 2 (voz por Bluetooth con MTU pequeño: "carril de voz" nativo y aviso "Bluetooth lento"; para el
   aviso no basta el MTU (con MTU 185 y sin Opus también hay 3,2 s de retraso): medir el retraso de la voz con la hora
   de envío en cada paquete y el mínimo de la llamada como base (así no dependen de que los relojes coincidan); solo
   afecta a teléfonos viejos: el Vivo y el S24, con Opus y MTU grande, ~66 ms);
   lo que solo se ve en el teléfono, sin probar aún: la pantalla encendida y el sensor de proximidad de la 2769; el
   micrófono con la pantalla bloqueada, el foco de audio y el tono según el modo del teléfono de la 2770; la decisión
   §4.7. Puntos débiles sin fallo visto todavía:
   - Con la app cerrada, si el que llama cuelga, el aviso sigue sonando hasta 45 s (lo arreglaría la opción (3) de §4.7).
   - Con la app cerrada, el aviso dice siempre "Llamada" (también en videollamada) y el nombre sale "NEXO" si el nativo no
     lo conoce.
   - La identidad de una conexión aún se deduce de lo que dice el paquete (el arreglo de la 2768 cubre lo que llega sin
     cifrar diciendo ser de un contacto; las confirmaciones y el `ni` siguen sin firmar, ver punto 1).
4. **Interfaz** — primera pasada en la 2771 (ver PROGRESO, "Ronda 2771"): "Agregar" con tus contactos y buscador,
   avisos rotos, textos sin tilde o en inglés, Perfil, "Cambiar nombre". Queda (decisión del dueño): "Tu nombre" en
   Perfil (hoy tus contactos ven el nombre Bluetooth del teléfono: "Galaxy S24", "vivo 1951"…).
Mejoras pendientes: la foto del contacto en sus notificaciones (como icono grande).
