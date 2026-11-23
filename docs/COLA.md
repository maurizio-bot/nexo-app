# Cola de trabajo para la sesión nueva (lista completa, 20-11; la lee la sesión que arranca tras el reinicio semanal del límite)

Regla: una sesión = un tema; una APK por tanda; antes de subir correr `tamano.js` e `i18n_audit.js` y las pruebas nuevas. Tallas: [c] chico (1–2 horas de trabajo), [m] medio, [g] grande.
Orden fijado por el dueño (19-11, vale desde el domingo 22-11): auditoría de seguridad → Bluetooth en el servicio nativo → auditoría posterior → modo vagón → resto. Lo de Wi-Fi Direct / medición
es lo que el dueño pidió el 20-11 y cabe en una sesión corta antes o después de la auditoría (a elegir por él).

## Estado al 22-11 (madrugada; SIN APK, una sola al terminar lo funcional + estético)
- HECHO y subido: 16 (causa de raíz: Android no corta un enlace entrante que la app no «tiene»; 3262), 16c, 15 (3262), 16b, 34 (de raíz), 35, 29b (lo reproducible), 32 (13 → 2 hallazgos).
- 28: no era un fallo de la app (lo cubren 3016/3058); causa real = 16b + app congelada. Cerrado.
- 20 fase 2 (3263, `GattServerHost`): hecho en código y en sim; ver ESTADO.md si quedó subido. Fases 3 y 4: sin empezar.
- Abiertos de la ola 1: 27 (plan: `reportNetworkConnectivity`), 36, 17, 18, 22, 29. Pruebas reales del dueño: todo lo nativo de hoy.
- Para lo nativo: compilar aquí con `tests/kotlin-android` (comprobación de tipos) y `tests/kotlin` (JVM) antes de subir.
- **22-11 tarde: la APK 3119 NO se lanza hasta que el dueño lo diga; se le suman los pendientes (orden en el TRASPASO de `ESTADO.md`). Hechos además: 3277 miniatura, 3278 audio con otras apps.**
- **22-11 mañana (subido, va en la siguiente APK):** 20 FASE 3 = 29 (bandeja de salida nativa: por internet 3268 y por Bluetooth 3269; app dormida y cerrada, con prueba de
  cada caso), 27 completo (3266 en la app + 3270 en la escucha sin la app), 36 (3267), 30, 33, resto de 32 (nombre largo, botones parejos), 7–11 (medición y tablero).
  También: el nativo ABRE el enlace cuando los dos teléfonos duermen (3271), 3 (dirección del grupo de Wi-Fi Direct caído y texto verdadero; Wi-Fi local atado a la red Wi-Fi
  aunque la red por defecto sean los datos), 4 (causas reproducidas en `wdgrupo.js` y avisos verdaderos) y 5 (`wifidirect.js --broken=fail` pasa: el HD de vídeo vuelve a ir por Bluetooth). 3272.
  FASE 4 hecha (3276, gestor de enlaces: tope 6 y prioridades; opción B del dueño). También 3261, 13 (medición), 22 (tarjeta de cierres), 3273–3275 (miniatura de videollamada).
  **22-11 tarde: remates de la fase 3 HECHOS** (3279 código rotativo en el nativo: sin eso la 3271 no abría el enlace en teléfonos reales; 3280 `BleSinApp` abre enlaces +
  despertador; 3281 adjuntos ≤ 1 MB en la bandeja). Abiertos: probar la fase 4 en multitud real (`multitud.js` y campo), modo vagón, 17, 18, 22, 23–25, 13, 3261, 2, «cancelar» de Wi-Fi Direct (el otro queda ocupado ~90 s tras fallar la unión), grupos G1–G9.

## PLAN 22-11 tarde: quién hace qué y con qué modelo (manda sobre el orden de abajo; detalle de cada punto más abajo en esta cola)
Regla (PLAN_ENTREGA «DECISIONES 21-11 noche»): la sesión principal hace lo pesado (Bluetooth, nativo, Wi-Fi Direct, protocolo); los ayudantes, lo que
no cruza esos archivos. Dos agentes nunca tocan el mismo archivo (`ble_connections.js`, `ble_helpers.js`, `plugins/nexo-ble` son de la sesión principal).
Todo con `[skip ci]`; UNA APK al terminar lo funcional + estético, tras una revisión propia corta; auditoría de seguridad al final (una).

**Sesión principal — Fable (Opus si Fable no está o se acaba el límite):**
1. Modo vagón / multitud (EDC): fase 4 con `multitud.js` (cientos de NEXO cerca, enlaces a demanda, tope 6). [Fable]
2. COLA 23: entrega con la app CERRADA y la pantalla APAGADA que a veces no suena (servicio nativo, avisos). [Fable]
3. Wi-Fi Direct «cancelar» (el otro queda ocupado ~90 s tras fallar la unión). [Fable]
4. COLA 14: archivos medianos por Bluetooth (L2CAP). [Fable]
5. Llamadas: 17 mensaje atorado durante una videollamada, 18 hueco ~25 s al cambiar de red. [Opus vale: protocolo JS de la llamada]
6. COLA 25 eco en llamada de grupo + COLA 24 datos repetidos de los relés y batería en segundo plano. [Opus]
7. Revisión propia corta de todo lo nuevo → APK → auditoría de seguridad final (una, al privado). [Fable]

**Ayudantes (en paralelo, cada uno en su copia `isolation: worktree`, sin tocar los archivos de la sesión principal):**
- A · Grupos G1–G9 (`groups.js`, `groups_ui.js`, `gruposadmin.js`, `tests/sim/groups.js`): estado del grupo firmado y versionado, admins, expulsar/bloquear,
  foto y fondo. [Opus: hay firmas y permisos; G5 y G7 son cortos]
- B · Google Play (COLA 26), parte de código: targetSdk 35/36, permisos, versión de tienda sin actualizador propio; preparar AAB firmado (sin subir nada). [Sonnet;
  la sesión principal revisa lo del manifiesto y el nativo antes de juntarlo]
- C · COLA 22: detectar y explicar al usuario que el teléfono silencia NEXO (canales de aviso, No molestar, ahorro de batería, «quitar de recientes»):
  archivo nativo NUEVO + aviso en la app. [Sonnet]
- D · Icono final con el logo elegido (1b: adaptativo de Android, aviso, tienda 512 px; enseñar antes/después al dueño) y, cuando el dueño elija la A/B,
  COLA 31 (vista previa con logo real en enlaces). [Sonnet]
- E · Menores: `estadovideo.js` falla en el contenedor (HEVC; ¿solo del entorno?), apuntar diagnósticos, NOVEDADES y documentos. [Haiku/Sonnet: lo mecánico
  lo puede hacer el dueño en un modelo ligero]

**Del dueño:** ritmo de búsqueda por Bluetooth de lo ya entregado al buzón (hoy: espaciado hasta 1 h); nombre Kinway (IMPI, dominios, redes);
identificador de paquete antes de la prueba cerrada; cuenta de desarrollador de Play (la verificación tarda días), política de privacidad publicada, 12 probadores;
pruebas reales al final ((a)–(g) y (c2) del TRASPASO). Meta: prueba cerrada de Google Play a más tardar el 1-12.

## 0. Lo que hace el dueño (antes de empezar)
- Noche del 20-11: videollamada S24→S23 de 20–30 min con la 3116 en los dos, con Wi-Fi; copiar el diagnóstico de los dos y anotar el ambiente. Referencia: WhatsApp 0,31 %/min (S24 Ultra); su recuerdo de NEXO 0,14 %/min.
- Prueba del Bluetooth sin la app (3254): reiniciar un teléfono, desbloquearlo SIN abrir NEXO y mandarle un texto desde otro cercano sin internet; en el diagnóstico «[BT_SINAPP]».
- Prueba corta: el mismo archivo por Bluetooth y por Wi-Fi Direct entre dos teléfonos, con la batería de los dos antes y después (para decidir Wi-Fi Direct «montado siempre» o «montado al enviar»).
- Responder: «disponible» de Wi-Fi Direct = verificado y grupo al enviar (≈ 3 s; recomendado) o grupo siempre montado.

## 1. Sesión «Wi-Fi Direct y elección de camino» (lo pedido el 20-11)
1. [m] 3261 — elegir Wi-Fi Direct por TIEMPO estimado (diseño del dueño): sin preferencia sobre internet; con Bluetooth cercano y Wi-Fi encendido; sin enlace Bluetooth y con internet → escaneo rápido,
   si está cerca → comparar velocidad de internet de ese momento con Wi-Fi Direct (≈ 4 s + tamaño/5 MB/s) → pasar a Bluetooth y a Wi-Fi Direct; anotar la decisión y los tiempos estimados. Hallazgo: `_resolveDeviceIdForNexoId`
   ordena lan > internet > Bluetooth y Wi-Fi Direct solo se mira después de elegir Bluetooth.
2. [m] Preparar (cifrar a disco) un archivo grande: ≈ 5 MB/s (153 MB = 30 s, el envío por Wi-Fi Direct 6 s). `BigFile.kt` / `big_file.js` (`prepare`, trozos `BIG_SLICE`).
3. [c] Textos y reintentos de Wi-Fi Direct: «Sin Wi-Fi con X (este teléfono no tiene Wi-Fi)» tras bajar el grupo es falso; el vivo reintenta la IP del grupo caído (ENETUNREACH).
4. [c] Reproducir «No se pudo crear el grupo» en `tests/sim` (las causas y códigos ya salen en el diagnóstico con la 3258).
5. [c] Correr de nuevo `wifidirect.js --broken=fail` (no terminó en el límite de 10 min el 20-11).
6. [m] Si el dueño elige «grupo siempre montado»: grupo caliente nativo (paso 2 de `wifi_direct.js`, hoy vacío) y medir su efecto en batería y en el Wi-Fi normal.

## 2. Sesión «Medición y tablero por red» (`docs/REDES.md`)
7. [c] Llamadas de GRUPO con batería/temperatura (`group_call.js`) y «cronómetro de actividades» (envío de archivo, foto…).
8. [c] Mediana y percentil 90 en «conexión lista» y velocidades (las medias engañan: 74 s y 377 s sueltos).
9. [m] Capacidad: pico de enlaces Bluetooth a la vez por día y clientes de Wi-Fi Direct.
10. [m] Fallas por camino con causa y conteo en Wi-Fi local, internet, Jump y Tor (como ya hace Wi-Fi Direct).
11. [c] Tendencia: síntomas por hora de uso y por build en `diag_stats.js` (los diagnósticos recibidos no son un ritmo).
12. [c] Leer el diagnóstico de la noche y el de un día completo con la 3116 (entrega por camino, síntomas, Wi-Fi Direct).

## 3. Sesión «Bluetooth: pulido» (velocidad y MTU)
13. [m] MTU 23 (vivo Y03, Katy): usar L2CAP para lo grande o preferir el enlace donde NEXO es cliente; contar cuántas veces entra MTU 23 por contacto y modelo.
14. [c] Bluetooth ≈ 17 KB/s para archivos medianos sin Wi-Fi: comprobar si se usa L2CAP.
15. [c] Escrituras rechazadas «ocupado» (201): esperar el callback en vez de reintentar 20 veces por segundo (caso Katy). Segunda prueba 20-11 14:09 (Motorola→S24): ≥ 20 s de 201 seguidos en el enlace conservado, reintento con DEFAULT cada ~150 ms; si el callback no llega en pocos s, cerrar y reabrir ese enlace.
16. [m] Enlace repetido que se reabre (S24↔Austin): falta registro NATIVO de esos segundos.
    MÁS 20-11 11:33–11:52 (3116): el desempate cierra el enlace de CLIENTE a MTU 517 y conserva el de SERVIDOR a MTU 23 (3 casos con Roberto y VICK) y de ahí salen «MTU 23», mensaje descartado y zombi (5 en el día). Arreglo candidato: MTU ≤ 23 nunca gana a MTU > 23 en `_dupBleLinksToClose` (prueba en `bledup.js`) y anotar en el nativo el MTU real del servidor; comprobar con el dueño que los dos lados ven el mismo MTU del mismo enlace.
    NUEVO 20-11 11:00 (3116, S24↔Roberto y S24↔Austin): cada lado cierra un enlace repetido DISTINTO (el S24 lista dos enlaces «server» del mismo contacto) y 10 s después sale MTU 23 y zombi: el desempate común no cubre «dos del mismo papel». Reproducir en `bledup.js` con roles iguales y arreglar el desempate (mismo enlace físico en los dos lados, p. ej. por dirección o por el que recibió algo más reciente).
16c. [m] Desempate con TODOS los repetidos muertos (20-11 12:32, VICK↔S24, dos enlaces cliente por la dirección que rota): no elegir uno; cerrar todos y abrir uno limpio, sin reconectar a la misma MAC al instante. Y el «MTU 23» que sale antes del onMtuChanged: no tratarlo como real hasta que el nativo lo confirme (primer mensaje en trozos de 20 B). Reproducir en `bledup.js`.
16b. [m] ✓✓ nativas sin firma válida con un contacto recién agregado (20-11 11:09:50, S24↔VICK): el S24 ignora las confirmaciones que manda el nativo con la app cerrada; la buena llega al abrir la app (49 s de retraso). Revisar con qué clave firma el nativo (`ackSign` / NetBgHome) y cuándo la recibe tras agregar un contacto.
17. [m] Mensaje atorado durante una videollamada directa (S23→S24: 9 trozos, ≥ 17 min).
18. [m] Videollamada tras cambio de red: errores de decodificación y hueco de ~25 s.

## 4. Bluetooth en el servicio nativo (PRIORIDAD 1 del domingo 22-11; antes, auditoría de seguridad)
19. [g] Auditoría de seguridad completa (PASO 0, en el repositorio privado).
20. [g] Fase 2: servidor GATT SIEMPRE en el servicio (también con la app abierta); fase 3: conexiones salientes y reenvío desde el servicio; fase 4: conexiones a demanda (tope ~7).
21. [g] Auditoría posterior; modo vagón / multitud para EDC; puente nativo con la app dormida.
22. [m] App dormida o muerta por el sistema (#87): detectar «Foreground kill» (Motorola) y ahorro de batería y explicárselo al usuario; aviso «tu teléfono silencia NEXO»; avisar que quitar NEXO de recientes corta la recepción.
23. [m] Entrega con la app CERRADA y la pantalla APAGADA (no suena ni avisa, ×3) — revisar tras la fase 1.

## 4b. Sesión «Grupos: administración» (pedido y especificado por el dueño el 20-11)
Hoy: crear grupo, abrir, ocultar texto en avisos, salir, renombrar (cualquier miembro). `createdBy` no se usa para permisos. La lista de miembros es fija desde la creación (auditoría 2774: abrirla con permisos es decisión de seguridad del dueño).
Lo que pidió el dueño, en dos modos que el creador elige al crear o en Ajustes del grupo:
- MODO CONTROL (el creador manda): solo los administradores escriben, agregan, renombran, cambian la foto y el fondo. Un administrador tiene lo mismo que el creador, pero no puede expulsar a un administrador: eso solo lo hace el creador. Los administradores se designan con «Designar administradores» (lista de miembros con buscador por nombre).
- MODO COLEGAS (todos hacen lo que quieran): todos escriben, agregan, renombran y cambian el fondo. Lo único restringido es expulsar: lo hace siempre el creador (decisión del dueño 20-11: un supervisor saca a un colaborador que ya no está en el equipo y no quiere salir).
- Fondo: el creador y los administradores lo cambian y lo pueden compartir con el grupo, con los mismos botones de un chat normal.
Expulsar y bloquear (decisión del dueño 20-11 noche): al expulsar, el creador elige «Solo expulsar» o «Expulsar y bloquear». El bloqueo es SOLO para ese grupo. Los bloqueados van en Ajustes del grupo, en la pantalla «Personas bloqueadas» (solo aparece si hay alguno), con el botón «Desbloquear» al lado de cada nombre; solo el creador que bloqueó puede desbloquear. Volver a entrar siempre es por invitación del creador o de un administrador con permiso.
Cómo se cumple (propuesta de Claude, por revisar con el dueño): la lista de bloqueados va en el estado del grupo, versionada, para que TODOS los teléfonos rechacen volver a agregar a esa persona; y los mensajes de un bloqueado se descartan, igual que en «Solo admins escriben» (G5). El bloqueo no toca el contacto fuera del grupo.
Tareas:
- G1 [m] Panel «Ajustes del grupo»: interruptores, «Designar administradores» con buscador, foto, fondo, expulsar, salir.
- G2 [m] Copia cifrada del estado en el buzón de archivos de los relés: SÍ (decisión propuesta 20-11: reusa `blob_mailbox.js`, cifrado, réplica mínima 2, caducidad 7 días; el estado pesa KB; cada cambio sube una copia nueva). Modelo (sin servidor: cada teléfono guarda el estado del grupo; cambios firmados por quien los hace, con versión; gana la versión mayor y en empate el administrador más antiguo; si el creador sale, pasa todo al administrador más antiguo; si ya no queda creador ni administradores, el grupo queda ABIERTO: todos hacen todo; la lista de bloqueados pasa a ser de todos los miembros y cualquiera puede desbloquear o volver a agregar; lo deciden los que queden): `admins` (al inicio solo el creador), `onlyAdminsWrite`, `onlyAdminsAdd`, `v` (versión del estado). Grupos viejos: el creador queda como único admin. Aviso «X hizo admin a Y».
- G3 [m] Agregar personas (admins, o solo el creador si el interruptor lo marca): invitación con el estado completo y las claves; el nuevo no ve el historial; tope 32.
- G4 [m] Expulsar: en control, un administrador expulsa miembros normales; a un administrador y al creador, nunca (solo el creador expulsa administradores). El expulsado recibe aviso y el grupo se cierra en su teléfono; los demás dejan de mandarle.
- G5 [c] «Solo admins escriben»: el receptor descarta lo que no viene de un admin; la barra de escribir se bloquea con el motivo.
- G6 [m] Foto del grupo: creador y admins; viaja como la foto de perfil (reusar `avatar.js`).
- G7 [c] Fondo del grupo: creador y admins; local en cada teléfono; «Compartir» manda la imagen al grupo (si pesa, por el buzón de archivos). Reusar `wallpaper.js` con el id del grupo.
- G9 [m] Expulsar o expulsar y bloquear; pantalla «Personas bloqueadas» (aparece solo si hay alguno) con «Desbloquear» solo del creador; lista de bloqueados en el estado del grupo. Decidido por el dueño: si el creador sale, todo lo suyo (bloqueos incluidos) pasa al administrador más antiguo.
- G8 [m] Pruebas: ampliar `tests/sim/groups.js` y `gruposadmin.js`: permisos, avisos de un no admin descartados, creador no expulsable, versión del estado, expulsado que sigue escribiendo, grupos viejos.
Sin preguntas abiertas de grupos. Supuesto mío, por corregir si no es así: un expulsado puede volver si alguien con permiso lo vuelve a agregar.

## 5. Después
24. [m] Datos repetidos de los relés (55 % de los eventos) y batería en segundo plano (S24 7–9 %/h); margen al reabrir en frío.
25. [m] Llamadas: eco en grupo, gasto de datos por relés, «sin imagen propia al contestar desde el aviso» (a investigar).
27. [m] Wi-Fi SIN internet (20-11 14:07–14:09, S24 y Motorola): 2 min 17 s sin camino por internet hasta que Android cambió a datos. Si ningún relé conecta por Wi-Fi, pedir la red móvil explícitamente (requestNetwork cellular) y usarla para los relés; probar en el simulador con relés caídos solo por Wi-Fi. Vive: de vez en cuando (router sin WAN, Wi-Fi de paga/cautivo). 3.ª prueba: el servicio nativo del HONOR de Austin también quedó 5–6 min sin relés (14:03:35 «connection abort» ×4 y «IllegalStateException» al reabrir; volvió 14:09:16 por datos): revisar esa excepción en NetBg y que el reintento no espere a Android.
28. [m] Reenvío sin fin (20-11 22:31, S23→HONOR de Katy): un mensaje sin ACK dio 3 vueltas y 5 reintentos sin tope; poner tope y espera creciente por mensaje, y revisar si el HONOR congela la app en segundo plano (COLA 22). Reproducir en `bledup.js` o en una prueba nueva de reintentos.
29. [g] **Pendientes que se quedan en la app al ir a segundo plano** (21-11, S23→S24: un mensaje y una foto de 201 KB, 4,5 h ⏳ con internet disponible en el servicio nativo; llegaron en 44 s al reabrir). El servicio nativo escucha y manda ✓✓, pero NO tiene bandeja de salida: los pendientes solo los reintenta la app y Samsung con ahorro de batería la congela. Hacer: al ir a segundo plano, la app entrega al servicio los sobres YA CIFRADOS de los textos pendientes (y los reintentos de la red de seguridad) para que los publique y reintente; archivos: terminar la subida antes de congelarse o seguirla desde el servicio. Reproducir en `tests/sim` (app oculta con pendiente + relés solo nativos). Vive: frecuente (mandar algo y bloquear el teléfono enseguida). Ir junto a la fase 3 del Bluetooth en el servicio (reenvío desde el servicio). Menor: `autoDiagScanPending` no debe saltar en el primer minuto tras volver (antes del reintento). DUEÑO 21-11: se resuelven LOS DOS casos (app CERRADA y app CONGELADA viva con el enlace abierto): en ambos el servicio debe contestar, confirmar ✓✓ y reenviar; prueba en sim para cada uno.
30. [m] **Todos los fondos de pantalla se cambian igual que el de un chat** (dueño 21-11 11:15): en CUALQUIER pantalla con fondo (lista de chats, grupos, llamada y videollamada, perfil, ajustes…), mantener pulsado ~0,8 s un espacio libre abre el mismo menú para elegir qué poner. Hoy `installWallpaperGesture` (`src/ui/wallpaper.js`) solo escucha `#messages-container` y solo en chats 1 a 1 (`NX_RE`); la lista ya tiene fondo propio (`hasListWallpaper`) pero se cambia desde Perfil. Hacer: un gesto común por pantalla (mismo filtro de «solo fondo vacío» y de no pisar scroll ni deslizar para cerrar) y un archivo de fondo por pantalla; los grupos van con G7. Prueba en sim: pulsación larga en cada pantalla abre el menú y no salta sobre mensajes, botones ni al desplazar. Vive: de vez en cuando.
31. [m] **Vista previa (miniatura) y logo real en los enlaces** (dueño 21-11 12:16, captura del chat con J Manuel). **DECIDIDO POR EL DUEÑO 23-11** (requisitos: la vista previa tiene que ser REAL e imposible de falsificar; que el sitio no vea ni a quien manda ni a quien recibe; NEXO no puede servir para dañar desde dentro). Diseño: (1) la vista previa la baja el teléfono que RECIBE, directo del sitio, por TOR (el de la app, `tor-android` por SOCKS; hoy solo se usa para .onion: lo PRIMERO es comprobar que baja páginas normales; si no se puede, avisar al dueño antes de seguir). Nada de lo que mande quien envía se usa como vista previa. (2) Solo título + imagen (`og:`/oEmbed de YouTube); imagen recomprimida en nativo, tope de tamaño, sin cookies, no se ejecuta nada de la página, redirecciones a otro dominio = aviso. (3) Siempre visible el dominio REAL sacado del propio enlace; aviso con confirmación al abrir si el dominio imita a otro (punycode/letras de otro alfabeto) o redirige a otro. (4) Sin internet o si el sitio rechaza Tor (tras reintentar por otro circuito): tarjeta segura con el logo oficial del sitio (SVG de los 4 sitios dentro de la app) y el dominio real; la vista previa aparece sola cuando haya internet. Nunca una vista falsa. Descarga nativa (la WebView choca con CORS). Prueba en sim: vista previa real, sin internet (tarjeta segura y luego aparece), sitio que rechaza, imagen enorme, HTML raro, redirección a otro dominio, dominio imitador. Vive: frecuente (compartir vídeos y publicaciones).
32. [m] **Que la app se vea igual de bien en cualquier teléfono y con cualquier tamaño de letra** (dueño 21-11: le comentaron que el autoajuste puede verse mal según el teléfono y con la letra más grande). Dos ajustes de Android cambian todo: «Tamaño de fuente» (la WebView agranda el texto; hoy no hay `textZoom` ni `fontScale` en el código, NO verificado cómo lo aplica) y «Zoom de pantalla» (cambia el ancho útil: de ~412 a ~320 px CSS). Hacer: 1) en Playwright, capturas de CADA pantalla (lista, chat, llamada, videollamada, grupos, perfil, ajustes, avisos) en anchos 320/360/412/480 y letra 100/130/160/200 %, y una prueba que falle si algo se sale de la pantalla, se corta o se encima (textos, botones, cabecera, barra de escribir); 2) arreglar con medidas relativas (rem/clamp, flex que envuelve, puntos suspensivos en nombres largos); 3) respetar la letra grande del usuario (accesibilidad) con un tope razonable en piezas fijas (cabecera, botones de llamada) para que no se rompan; 4) pedir al dueño capturas con letra máxima en su S24 y en un teléfono chico. PRIMER CASO HECHO (21-11, Redmi Note 11 Pro 5G de un probador, letra grande): nombre de la cabecera cortado a media 2.ª línea por un tope fijo de 48 px en `_fitContactName` (main.js) → tope medido con la línea real; prueba local `tests/sim/nombrecabecera.js` (navegador; falla sin el arreglo). Va en la próxima APK. Vive: siempre (cada usuario con letra grande o teléfono chico).
33. [m] **Ajustes → Apariencia: colores de las burbujas y tipo de letra** (dueño 21-11). Sección nueva en los ajustes generales, solo estética:
    a) **Colores de las burbujas propias**: elegir UN color o DOS colores en degradado (como hoy, celeste→morado); DOS es la opción principal que se ofrece primero. Paleta + selector libre, con una **burbujita de ejemplo** que se actualiza al momento.
    b) **Estilo**: «pleno» (color sólido/degradado como hoy las enviadas) o «cristal» (translúcido con degradado de transparencia, como hoy las RECIBIDAS, que deja ver el fondo).
    c) **Tipo de letra de toda la app**: unas pocas fuentes incluidas en la app (sin bajarlas de internet), con vista previa.
    Cuidar: contraste del texto (si el color elegido es claro, letra oscura automáticamente), que los ✓✓, la hora, enlaces y notas de voz sigan legibles en cualquier combinación; que funcione con el fondo de pantalla de cada chat (COLA 30) y con letra grande (COLA 32). Se guarda en el teléfono (no viaja al otro). Hacer con variables CSS (`--burbuja-1`, `--burbuja-2`, estilo, fuente) para no tocar cada pantalla. Prueba en sim: cada combinación pinta las burbujas y la vista previa, el texto pasa contraste mínimo, y reiniciar la app conserva la elección. Vive: una vez al configurar y siempre al ver los chats.
34. [c] **«Deslizar para actualizar» salta al desplazar la lista de contactos** (dueño 21-11 14:38; su diagnóstico lo confirma: 10 «[ACTUALIZAR] Deslizar» en 26 s, cada uno con «Flush global pending» = reenvía TODOS los pendientes y pide estados; martilla enlaces y relés). Debe saltar SOLO al tirar hacia abajo estando ya arriba del todo. Sospecha (sin comprobar): `attachPullRefresh(#contacts-view)` en `src/ui/estados.js` mira `el.scrollTop <= 0`, pero lo que se desplaza puede ser una lista INTERNA (scrollTop de #contacts-view siempre 0) → cualquier gesto hacia abajo cuenta. Arreglo: mirar el scroll del elemento que de verdad se desplaza (o el del dedo: `e.target.closest` con overflow), exigir que ya estuviera arriba al EMPEZAR y durante el gesto, y un tope de 1 actualización cada ~10 s. Prueba en sim (jsdom/navegador): desplazar la lista hacia arriba desde la mitad NO actualiza; tirar estando arriba SÍ; dos tirones seguidos = 1 actualización. Revisar también los otros `attachPullRefresh` (estados a pantalla completa). Vive: frecuente.
35. [c] Diagnóstico: en «Mensajes propios recientes» los mensajes que salieron sin camino (y el archivo grande a Cesar) muestran el destinatario como «→ ?» (S24 y S23, 21-11): la línea de tiempo debe tomar el contacto del propio mensaje aunque no haya ruta. Prueba en `diag_*` del sim.
29b. [m] Pantalla de llamada en ventanita (132×236) que se queda sin botones y puede caer (reporte del dueño: «micropantalla que se bloquea o cae»); reproducir con `callpower.js` y las trazas `[CALL] Pantalla de llamada`. (Estaba solo en PLAN_ENTREGA, ola 1.)
36. [c] Envío a un enlace que se está cerrando (20-11 12:23:58, nx10b6f4ac): Jump cierra la «conexión de paso» con VICK (`disconnectDevice` 40eff85cf5af) y 7 ms después sale un `sendMessage` de 216 B a esa misma MAC → 6 s de escrituras fallidas y «mensaje descartado entero (11 trozos)». Al cerrar un enlace de paso, no encolar nada a esa MAC (o mandar lo pendiente por otro camino ANTES de cerrar); y no cerrar «sin uso» si hay algo en cola para él. Reproducir en sim con el cierre de paso de Jump.
26. [g] Publicación en Google Play: Android más reciente (targetSdk 35/36), actualizador propio de la tienda, permisos, privacidad, firma, prueba cerrada de 14 días; novedades en los 5 idiomas al acercarse.
