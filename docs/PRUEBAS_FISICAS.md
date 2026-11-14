# Pruebas físicas pendientes (dueño 12-11: «la lista de las pruebas físicas que hacen falta»)

Con la **3033 (nightly-3030) o posterior en TODOS los teléfonos** (el actualizador de Perfil → Ajustes lo hace solo).
Si algo falla: **Perfil → Copiar diagnóstico** en los dos teléfonos y pegármelo. Cada prueba dice qué tiene que pasar.
Se marca aquí lo confirmado (✅) o lo que falló (❌ + diagnóstico).

## 0. Lo nuevo del 13-11 (APK 3032 a 3042)
1. **GIF del teclado (3032).** En el S23, abre un chat y manda un GIF o sticker desde el teclado de Samsung o Gboard: sale
   como imagen y llega al otro (ya no «No es posible introducir este contenido aquí»).
2. **Vídeo de TikTok en estados (3032).** Guarda un vídeo de TikTok y súbelo como estado: se publica (recomprimido a ≤ 4,6 MB).
3. **Stickers y gesto atrás (3032).** El panel de stickers ya no tiene la N y trae las caritas nuevas; el gesto atrás cierra
   menús, hojas, búsqueda y juegos antes de salir del chat.
4. **Puente a internet (3033).** Un teléfono SIN datos ni Wi-Fi junto a otro NEXO con internet (contacto suyo, por
   Bluetooth): manda un texto a un contacto LEJOS → le llega y sale ✓✓; la respuesta te llega. En el diagnóstico del que no
   tiene internet sale «internet POR PUENTE: …» y en el del otro «presto internet a 1».
5. **Vivo en segundo plano (3033).** En el Vivo: Ajustes → Batería → NEXO → permitir actividad en segundo plano. Con su
   pantalla apagada, mándale un texto por Bluetooth: tiene que llegar ✓✓ sin abrir su app. Si no, diagnóstico del Vivo.
7. **Compartir pantalla (3034).** En una videollamada por Wi-Fi: toca «Pantalla» → aviso → «Compartir» → permiso de Android.
   El otro ve tu pantalla entera (puede ampliar con dos dedos); arriba en el tuyo, barra roja «Detener». Detén con la barra y
   vuelve la cámara. Si falla, diagnóstico de los dos (líneas «[CALL] Compartiendo la pantalla…» / «ScreenShare»).
8. **GIF a alguien sin conexión (3034).** Manda un GIF grande a un contacto apagado: el ✓ sale en ~1 min (antes ~6).
9. **Honor (3034).** Tras actualizar, el Honor ya no reenvía estados viejos al abrir (su diagnóstico sin «766 chunks»). En el
   Honor: Ajustes → Batería → NEXO → permitir segundo plano.
6. **APK de 25 MB viejo (3033).** El que salía «pendiente viejo» a …c1ee/…707a queda ✗ con «Reintentar» y ya no avisa.
10. **Puente con un desconocido y el regreso (3035).** Teléfono A sin datos ni Wi-Fi; cerca, un NEXO con internet que NO es
    contacto de A (B). A le escribe a un contacto LEJOS (C): llega ✓✓. Luego aleja B (o apágale el Bluetooth) y pon cerca
    otro NEXO con internet (D, tampoco contacto). C contesta: a A le llega en 1–2 min sin que A mande nada. En el diagnóstico
    de A: «[GW] Sin internet ni puente: pruebo con … de paso» y «uso a … de puente».
11. **Respaldo al Vivo dormido (3035).** S24 y Vivo en la misma Wi-Fi, el Vivo con la app en segundo plano un rato: ya no
    llega el aviso automático «reintentos (file fxs_…)» del S24.
13. **Foto por el puente (3036).** El teléfono A sin datos ni Wi-Fi, junto a otro NEXO con internet: el chat con un contacto
    lejano dice «por puente». Manda una foto: llega. Manda un vídeo: queda ⏳ hasta que A tenga internet propio. Que el
    contacto lejano te mande una foto: te llega por el puente.
15. **APK grande por Wi-Fi Direct (3037).** S24 y Vivo juntos por Bluetooth, los dos con el Wi-Fi ENCENDIDO (sin estar en la misma
    red): manda el APK de 25 MB desde el selector de archivos. Tiene que salir como archivo grande (tarjeta «Enviando N %») y
    llegar; en el diagnóstico del S24: «[ATTACH] … espero para mandarlo como archivo grande» (a veces) y «[WIFI-DIRECT]».
14. **Compartir pantalla en grupo (3037).** Llamada de grupo de 3 en la misma Wi-Fi: uno toca «Pantalla» → aviso → «Compartir»
    → permiso de Android. Los otros dos ven su pantalla grande con «Pantalla de …»; arriba en el suyo, barra roja «Detener».
    Si falla, diagnóstico de los tres (líneas «[GCALL] Compartiendo la pantalla…» / «comparte su pantalla»).
16. **Vídeo por el puente con Wi-Fi Direct (3038).** A sin datos ni Wi-Fi conectado (pero con el Wi-Fi ENCENDIDO), junto a B
    con internet por Wi-Fi: A manda a un contacto lejano un vídeo de 2–4 MB → llega (antes quedaba ⏳). En el diagnóstico de A:
    «[GW] Wi-Fi Direct al puente …: N trozo(s)». Si dice «no funcionó», igual llega por Bluetooth (más lento).
17. **Salir del Wi-Fi chateando (3039).** A y B en la misma Wi-Fi: A apaga el Wi-Fi y manda un texto en el mismo segundo → le
    llega a B en 1–2 s por Bluetooth (antes 12–20 s).
18. **Perder el internet con un NEXO cerca (3039).** A con datos, B cerca con internet: A apaga datos y Wi-Fi y manda un texto
    a un contacto lejano → sale en ~10 s y el chat dice «por puente» (antes ~1,5 min).
19. **Vuelve el internet (3039).** Siguiendo la anterior, A vuelve a encender los datos: en ≤ 15 s el chat deja de decir
    «por puente» (antes hasta 2 min).
20. **Pantalla girada y por Bluetooth (3040).** En una videollamada por Wi-Fi comparte la pantalla y GIRA el teléfono: el otro
    la ve en horizontal sin aplastar. Luego apaga el Wi-Fi de los dos (la llamada sigue por Bluetooth): la pantalla sigue
    viéndose, como imágenes que cambian cada ~5 s. Diagnóstico: «Pantalla girada» y «diapositivas de pantalla».
21. **Archivo grande para alguien lejano (3040).** En el vivo, lo pendiente de 25 MB para …707a ya no se lee del disco cada vez
    que ve al S24 (el diagnóstico dice «no caben por Bluetooth: esperan Wi-Fi/internet»).
22. **Videollamada por internet por relés (3041).** Lejos uno del otro y sin Tor: se ve al otro en imágenes pequeñas que cambian
    cada ~2 s (antes, sin imagen) y, si compartes la pantalla, en diapositivas cada ~5 s. El diagnóstico dice «relés: vídeo en
    imágenes pequeñas».
23. **Videollamada por internet DIRECTA (3041).** Lejos uno del otro (cada uno con su internet, Tor apagado): videollamada →
    en unos segundos la imagen se ve bien (como por Wi-Fi). Diagnóstico de los dos: «[P2P] Conexión DIRECTA por internet».
    Si dice «Sin conexión directa … la red no deja», se ve en imágenes pequeñas (por relés). Prueba también con datos móviles.
24. **Volver a llamar por Bluetooth con un contacto dormido cerca (3042).** Lo del diagnóstico de las 07:28: videollamada S24–vivo
    por Wi-Fi, apaga el Wi-Fi de los dos (la voz sigue por Bluetooth) → la imagen del otro ya no se congela: cambia cada ~4 s.
    Cuelga y vuelve a llamar por Bluetooth: tiene que sonar en el vivo en unos segundos, aunque la tablet esté cerca con mensajes
    pendientes. Diagnóstico: «En llamada: … espera a colgar» y, al colgar, «Llamada terminada: sale lo que esperaba».
25. **Contacto dormido (3042).** Con la tablet (u otro) con la app dormida y mensajes pendientes para ella: el diagnóstico del S24
    dice «primero una prueba» y «no confirma ni la prueba: los otros N esperan». Al abrir la app de la tablet le llega todo en
    menos de 2 min.
26. **Estados vistos (3042).** Mira los estados de alguien (el aro se pone gris), cierra NEXO del todo y vuelve a abrirla: el aro
    sigue gris (antes volvía a azul, como nuevos). Un estado nuevo de esa persona sí vuelve a poner el aro azul.
27. **Foto de perfil al abrir la app (3042).** En el Motorola de Roberto: cierra NEXO del todo, ábrela y, nada más abrir,
    Perfil → poner TU foto: la rechaza igual («es la foto de perfil de …»). Antes, en los primeros segundos la aceptaba.
28. **Foto quitada que vuelve (3042).** Un contacto pone una foto y la quita estando lejos de ti; cuando vuelve a estar cerca,
    en tu lista sale con sus iniciales, no con la foto que quitó. El diagnóstico del S24 dice ahora, por contacto, «foto»,
    «foto copiada (escondida)» o «sin foto», y a cuánto está de la tuya.
29. **Estados al abrir la app (3042).** Con varios estados de alguien en tu teléfono, cierra NEXO; que esa persona publique uno
    nuevo y abre NEXO enseguida: tienes el nuevo y los de antes (antes podías quedarte solo con el nuevo).
30. **Foto anterior (3043).** Cambia tu foto de perfil. En otro teléfono, Perfil → poner tu foto ANTERIOR: la rechaza. Y tú sí
    puedes volver a poner tu foto anterior.
31. **Vivo con la app cerrada (3043).** Cierra NEXO del todo en el vivo y deja el S24 cerca 30 min: no debe llegar el diagnóstico
    automático «enlace_abre_cierra» del vivo.
32. **«Es mi foto» (3044).** Abre el perfil de Roberto (⋮ → Perfil), toca «Es mi foto» y otra vez para confirmar: su foto deja de
    verse en tu teléfono (también tras cerrar y abrir NEXO). El diagnóstico del S24 dice en Roberto «foto copiada (escondida)».
33. **Foto recortada o con borde (3044).** En otro teléfono, haz una captura de tu foto (perfil de un contacto → tocar la foto),
    recórtala un poco o ponle un marco, y ponla en Perfil: la rechaza («es la foto de perfil de …»).
34. **Tope de 5 MB (3044).** En Perfil, elige una foto de más de 5 MB (por ejemplo, una de la cámara a máxima resolución): sale «La
    foto pesa más de 5 MB: elige una más pequeña». Una normal se acepta.
35. **Cifrado que se recupera solo (3045).** Con el S24 en la 3045 (basta con él) y el Nubia junto, en el mismo Wi-Fi: haz una
    videollamada y, a la mitad, cierra la app del Nubia a la fuerza (Ajustes → Apps → NEXO → Forzar detención) y vuelve a abrirla.
    En menos de 1 min el Wi-Fi entre los dos vuelve a «comprobado» y un texto del Nubia llega al S24 (antes: «Mensaje ya recibido»
    cada 12 s y nada llegaba). Si vuelve a pasar, en el diagnóstico del S24 saldrá «[E2E] Desfase de cifrado con …».
36. **Desatasco automático (3047).** Con los dos teléfonos en la 3047: usa NEXO normal. Si algún día vuelve a haber un atasco, ya no
    deberías notarlo: en segundos se reenvía solo lo que no se pudo leer (sin duplicados ni avisos dobles). En el diagnóstico salen
    «[E2E] Desatasco con …» y, en el que arrancó atrasado, «El estado de cifrado se cargó ATRASADO …»: si ves esa línea, mándame el
    diagnóstico de los dos (es la pista de la causa). Cada arranque dice también «Estado de cifrado: guardado nº …».
37. **Relé en segundo plano (3047, Motorola).** Deja el Motorola con la 3047 una hora en segundo plano (app abierta detrás, pantalla
    apagada) y luego manda su diagnóstico: las líneas «[NET] Relé …: cerrada» ya no salen cada ~25 s; si un relé se corta enseguida,
    dicen «(intento nº N: el siguiente en X s)» con esperas que crecen hasta 300 s.
38. **Bluetooth del Motorola tras apagar y encender (3048).** Con NEXO cerrado en el Motorola, apaga y enciende su Bluetooth.
    Desde el S24 (sin Wi-Fi ni datos) mándale un texto: debe llegar por Bluetooth en segundos. Antes: «sin servicio» hasta abrir
    NEXO en el Motorola. En su diagnóstico: «Bluetooth encendido: rehago el servidor GATT».
39. **Fotos del chat hasta 5 MB (3048).** Elige en la galería una foto de más de 5 MB (una de la cámara a máxima resolución): sale
    «La foto pesa más de 5 MB: elige una más pequeña» y no se manda; si eliges varias, las demás sí salen.
40. **Puente en cadena (3050).** S24 sin Wi-Fi ni datos (solo Bluetooth); cerca, el vivo con la app dormida y la tablet (u otro)
    con internet y NEXO abierto. Manda un texto a alguien lejos (el S23): debe salir en ≤ 30 s por el que sí tiene internet. En el
    diagnóstico del S24: «[GW] … no contesta(n) en 5 s (dormido o sin servicio): pruebo con otro NEXO cercano» y luego «Conectado a
    internet por el puente nx…».
41. **Despertador (3050).** Abre el chat de un contacto que tiene NEXO cerrado (también al tocar «adjuntar» o al grabar un audio):
    en tu diagnóstico sale «[WAKE] toque a nx… (al abrir el chat)». Luego manda un audio: debe llegar antes que hoy.
42. **Audio que el otro aún no bajó (3050, los dos teléfonos en la 3050).** Con NEXO cerrado en el S24, el S23 le manda un audio.
    Abre el S24 unos minutos después: el audio baja y se oye (antes: «Faltan 5 de 5 trozos» para siempre). En el diagnóstico del
    S23, «[BLOB] … confirmado por todos: pedí borrar sus N trozos» sale solo DESPUÉS de que el S24 lo bajó, no al marcar ✓✓.
44. **Avisos limpios (3050, todos en la 3050).** Con NEXO cerrado en el S24 un rato: ya no debe salir «NEXO · Mensaje nuevo» sin
    mensaje (ni cuando un probador te manda su diagnóstico). Cada mensaje de verdad avisa una vez, con el nombre de quien lo manda;
    uno de grupo, en el grupo. En el registro nativo, cada toque dice «Despierto: sin aviso (lo pone el mensaje cuando llegue)».
45. **Mensaje de grupo pendiente (3050).** Escribe en un grupo con un miembro sin conexión; cierra y abre NEXO; cuando el miembro
    vuelva (con NEXO cerrado), le llega el aviso del GRUPO (antes: nada).
43. **Sin «zombi» falso con contactos de internet (3050).** Deja NEXO en segundo plano un rato y vuelve: en el registro nativo del
    diagnóstico ya no salen «connectToDevice raw='net:nx…'» ni «zombi» de un contacto que solo está por internet.
46. **Bluetooth solo de emergencia (3052, los dos en la 3051).** S24 y S23 juntos, los dos con datos móviles (sin Wi-Fi) y
    Bluetooth encendido. Manda un texto y una foto: deben ir por internet aunque el Bluetooth esté listo. En el diagnóstico del
    que manda: «[VELOCIDAD] internet enviado: …» para la foto (no «Bluetooth enviado»). Apaga los datos de uno: el siguiente
    mensaje sale por Bluetooth (la emergencia).
47. **Archivo que cambia al Wi-Fi a mitad (3052).** Con el Wi-Fi apagado en uno, empieza a mandar un vídeo de 2–5 MB por
    Bluetooth; a los pocos segundos enciende el Wi-Fi (la misma red que el otro). El vídeo debe seguir por el Wi-Fi y terminar
    mucho antes. En el diagnóstico: «el archivo deja el Bluetooth y sigue por el Wi-Fi (N KB por mandar)».
48. **Velocidad por camino (3052).** Tras mandar un par de fotos o vídeos, Perfil → Copiar diagnóstico: sale el bloque
    «Velocidad de hoy por camino:» con cuántos KB/s dio cada camino (Wi-Fi local, internet, buzón de archivos, Bluetooth) y en
    cuántos segundos quedó lista cada conexión. Mándame ese diagnóstico: con esos números decidimos el paso 4.
49. **Resumen diario con velocidades (3052).** Al día siguiente, el resumen diario automático trae al final «velocidad por
    camino:» con los mismos datos del día.
50. **Bluetooth que vuelve (3052).** S24 sin Wi-Fi ni datos, con el Bluetooth APAGADO; el S23 cerca con NEXO cerrado. Enciende el
    Bluetooth del S24 y mándale un texto al S23: debe salir en segundos (antes, hasta un minuto). En el diagnóstico del S24:
    «Bluetooth encendido otra vez: busco y reintento lo pendiente».
51. **Sin escrituras a ciegas (3052).** Con la tablet lejos (o apagada) y algo pendiente para ella, abre NEXO en el S24 cerca del
    vivo. En el diagnóstico del S24 ya no deben salir, para la tablet, «Resume: … outgoing» seguido de «Texto sobre un Bluetooth que
    el nativo ya soltó», ni en el registro nativo «Write fallo … durante ~6 s» hacia su dirección; sale una vez «sin enlace Bluetooth
    ahora: espera a que vuelva». Cuando la tablet vuelve, lo suyo le llega.
12. **Videollamada por internet (3035).** Si no se ve la imagen, manda el diagnóstico: la línea «[CALL] … s: …» ahora dice
    «por internet (relés: el vídeo no sale; Tor …)» o «por internet (Tor directo)» en vez de «por Bluetooth».

## A. Lo arreglado hoy (12-11) — rápidas, 2–3 min cada una
1. **Foto de perfil (3028).** En tu teléfono: Roberto y Marcos salen con sus iniciales, no con tu foto. Toca la foto de
   un contacto: se abre grande **sin** botón de guardar. En otro teléfono, Perfil → poner TU foto: la rechaza con
   «es la foto de perfil de …».
2. **Enlaces que se abren y cierran (3027).** Dos teléfonos juntos con la app abierta 5 min: el chat entre ellos sigue
   en Bluetooth sin cortes (no llega el aviso automático «enlace_abre_cierra»).
3. **Reenvío sin fin (3026 + 3029).** Deja los teléfonos juntos 30 min con la app en segundo plano: el respaldo Fénix no
   repite el mismo envío (no llega el aviso «reintentos» de un `fxs_…`).
4. **Bluetooth con un teléfono que no responde (3025).** Uno con el Bluetooth del otro apagado 5 min: el primero deja de
   insistir (en su diagnóstico sale «pausa» y no 20 líneas «no_service» seguidas).

4a. **Pausa de Bluetooth (3033).** S24 y Motorola juntos 10 min con la app abierta: si sale «pauso Bluetooth» en el
   diagnóstico del S24, debe salir UNA vez (no 15–20 seguidas) y los mensajes siguen por Wi-Fi/internet.
4d. **Mensajes al volver (3033).** Deja tu app en segundo plano 5 min; que otro te escriba 3 mensajes por internet (lejos). Al tocar
   el aviso, los 3 ya están en el chat al abrirlo (no aparecen después).
4c. **Foto de perfil (3033).** En el Honor: tu foto se ve en tu contacto y la copia del otro contacto sale con iniciales.

4b. **Estados v3 (3032).** Publica 3 estados (uno con foto grande): en otro teléfono salen «(3)», se recorren con ‹ ›, la foto
   carga al abrirla. Dale me gusta y comenta uno: en «Mis estados» del dueño se ve quién y el comentario. En Contactos, desliza
   hacia abajo: «Actualizando estados…». Mantén pulsado un sticker propio que te mandaron → «Agregar a mis stickers».

## B. Cambio de camino y archivos
5. **Wi-Fi que se corta (3022/3023).** Los dos en el mismo Wi-Fi, chat abierto; apaga el Wi-Fi de uno y escribe enseguida:
   el texto llega en 2–5 s por Bluetooth. Vuelve a encenderlo: sigue por Wi-Fi.
6. **Foto a alguien lejos (solo internet).** Manda una foto a un contacto que NO esté cerca: llega una sola vez y no se
   queda «enviando» por Bluetooth.
7. **Wi-Fi Direct (abierto).** Los dos con el **Wi-Fi ENCENDIDO** (sin estar en la misma red), cerca, manda un vídeo de
   1–5 MB. Diagnóstico de los dos aunque funcione (líneas `[WIFI-DIRECT]`).
8. **Archivo grande por Wi-Fi.** En el mismo Wi-Fi, un vídeo o APK de 20–25 MB: avanza hasta el final.

## C. Avisos
9. **Avisos fantasma (3012).** Durante un día normal: ¿sale algún aviso de NEXO sin mensaje nuevo al abrir el chat? Si
   sale, diagnóstico del teléfono que lo mostró en ese momento.
10. **Pantalla apagada.** Un teléfono con la pantalla apagada 3 min; mándale un texto: suena el aviso y en el que manda
    sale ✓✓. Repite con la app quitada de recientes.
11. **Tocar el aviso** abre el chat de quien escribió (también con Ajustes o un perfil abiertos encima).

## D. Llamadas (lo más viejo sin confirmar)
12. **Voz con altavoz en habitaciones distintas:** ¿eco? ¿se cortan al hablar los dos? Diagnóstico de los dos (`[CALL]`).
13. **Videollamada** Vivo ↔ S24 tres veces seguidas: imagen y voz en las dos; contestar con la pantalla bloqueada.
14. **Llamada con la app cerrada:** llamar a un teléfono con NEXO quitado de recientes: suena a pantalla completa.

## E. Agregar y actualizar
15. **«Agregar»** con 3 teléfonos cerca: salen todos con su nombre en segundos (también uno con la app en segundo plano).
16. **Actualizador:** Perfil → Ajustes → Actualizaciones en un teléfono atrasado: descarga e instala la última.

---
La lista anterior (de la build 2899) quedó en el historial de git (`git show 24dca8f8:docs/PRUEBAS_FISICAS.md`); lo suyo que sigue vigente está arriba.
