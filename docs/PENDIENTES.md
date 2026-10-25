# NEXO — Lo que falta (lista viva)

Lista pedida por el dueño el 23-10-2026 para no olvidar nada. Leer al empezar cada sesión (CLAUDE.md lo indica) y
actualizar al terminar cada bloque. Estado al día de cada build: `docs/PROGRESO.md`.

## Reglas para elegir el camino de envío (decididas por el dueño, 23-10-2026; revisadas el 24-10-2026, build 2761)
1. **Wi-Fi en el mismo router/módem: prioridad sobre todo** (seguro, rápido, no gasta datos) y **se mantiene, sin
   brincar**: no se deja por un pico ni por un corte breve (primero se intenta recuperar, 15 s); solo si está muy mal
   un rato (~12 s seguidos). Se vuelve a él cuando lleva ~30 s bien. Una foto a medias no cambia de camino por un pico.
2. **Wi-Fi muy malo o caído → internet** (los dos en Wi-Fi). **Sin internet → Bluetooth** (y Jump si no hay alcance).
3. **Wi-Fi Direct**: para fotos, vídeos y archivos grandes cuando no hay Wi-Fi común ni internet, antes que Bluetooth.
4. **Con datos móviles**: los archivos no van por datos (esperan al Wi-Fi o van por Bluetooth); los textos van por
   Bluetooth si está conectado y si no por internet.
5. **Ningún camino**: pendiente, intentando Bluetooth cada poco; sale por internet o Wi-Fi, lo que llegue primero.

## 1. Pendiente de pruebas del dueño en el teléfono
- **Qué APK probar (25-10)**: la 2771 (nightly-2771) para todo. Desde la 2763 no hay pruebas en teléfonos: todo lo de
  abajo desde la 2765 está sin confirmar (salvo el informe de videollamada Vivo ↔ S24 con la 2768, ver 2769).
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
- **Pagos**: decidir modelo (saldo propio, tarjeta/banco, cripto); doble gasto sin conexión, conciliación,
  regulación del país (posible licencia). Asesoría legal antes de programar.
- **Stream** (vídeos tipo TikTok + estados de contactos, gestos: tap arriba izq. vídeos, arriba der. estados, doble tap
  "me gusta", deslizar der→izq comentarios, izq→der volver): **SIN DECIDIR** (sí/no; solo cercanos o con servidor).
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

## 4. Decisiones pendientes del dueño
1. Stream: ¿sí o no? ¿solo cercanos o con servidor?
2. ~~Internet: punto de encuentro~~ — decidido el 23-10: relés públicos + Tor, sin servidor propio por ahora
   (ronda 2739). Queda abierto si más adelante se quiere un servidor propio.
3. Pagos: modelo y país.
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
