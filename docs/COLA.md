# Cola de trabajo para la sesión nueva (lista completa, 20-11; la lee la sesión que arranca tras el reinicio semanal del límite)

Regla: una sesión = un tema; una APK por tanda; antes de subir correr `tamano.js` e `i18n_audit.js` y las pruebas nuevas. Tallas: [c] chico (1–2 horas de trabajo), [m] medio, [g] grande.
Orden fijado por el dueño (19-11, vale desde el domingo 22-11): auditoría de seguridad → Bluetooth en el servicio nativo → auditoría posterior → modo vagón → resto. Lo de Wi-Fi Direct / medición
es lo que el dueño pidió el 20-11 y cabe en una sesión corta antes o después de la auditoría (a elegir por él).

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

## 4b. Sesión «Grupos: administración» (pedido del dueño 20-11; revisado el 20-11, solo lectura del código)
Hoy existe: crear grupo (nombre + elegir miembros, hasta 32), abrir, ocultar el texto en los avisos, SALIR del grupo, renombrar desde la cabecera (cualquier miembro). El grupo guarda `createdBy` pero NO se usa para permisos.
La lista de miembros es FIJA desde que se crea (auditoría ronda 2774, `groups.js` `receive`: un sobre no reescribe la lista; la única baja es salir). No existe: agregar personas después, expulsar, admins, «solo admins escriben», foto del grupo,
fondo del grupo (el fondo por contacto existe en `wallpaper.js` —`setChatWallpaperFor(nx, imagen)`—, la foto por contacto en `avatar.js`; ninguno se ofrece para grupos).
Cada mensaje va cifrado a cada miembro por su chat (no hay clave de grupo): expulsar = dejar de mandarle; no hace falta rotar claves. DECISIÓN DE SEGURIDAD que es del dueño: la auditoría fijó la lista a propósito; el modelo nuevo
la abre con permisos (los avisos de admin solo valen si los manda alguien de la lista de admins que cada teléfono guarda, con versión del estado del grupo para resolver choques). Detalle a decidir con él: ver «A/B» abajo.
- G1 [m] Pantalla «Ajustes del grupo» (hoy solo hay un menú con 3 botones): miembros con su rol, botón «Agregar personas», expulsar, hacer/quitar admin, interruptor «solo admins escriben», foto, fondo, salir.
- G2 [m] Modelo de permisos y estado versionado del grupo: `admins` (al inicio solo `createdBy`), `onlyAdmins`, `v`; reglas de recepción; los grupos que ya existen pasan a tener como admin a quien los creó; aviso «X hizo admin a Y».
- G3 [m] Agregar personas: invitación con el estado completo y las tarjetas de claves (el nuevo no ve el historial); los demás actualizan su lista; tope 32; llamadas de grupo en curso no cambian.
- G4 [m] Expulsar: el expulsado recibe «te sacaron del grupo» y el grupo queda cerrado en su teléfono; los demás dejan de mandarle; también «quitar admin».
- G5 [c] «Solo admins escriben»: el receptor descarta lo que no viene de un admin y el emisor ve la barra de escribir bloqueada con el motivo.
- G6 [m] Foto del grupo: solo admins la cambian; viaja como la foto de perfil (chica) con su huella y la piden los miembros nuevos (reusar `avatar.js` con el id del grupo).
- G7 [c] Fondo del grupo LOCAL de cada teléfono (reusar `wallpaper.js` con el id del grupo; falta la opción en el menú). [m] Opcional: fondo COMPARTIDO elegido por un admin (imagen grande: puntero por el buzón de archivos).
- G8 [m] Pruebas: ampliar `tests/sim/groups.js` y una nueva (`gruposadmin.js`): permisos, forja de avisos por un no admin, orden/pérdida de avisos (versión), expulsado que sigue escribiendo, nuevo miembro, migración de grupos viejos.
- A/B para el dueño: (1) renombrar y cambiar la foto: SOLO admins (como WhatsApp con «solo admins edita») o cualquiera (hoy renombrar es de cualquiera); recomendado: solo admins, con interruptor. (2) fondo: LOCAL de cada quien (se vive siempre,
  barato; recomendado) o COMPARTIDO por un admin (de vez en cuando; más pesado). (3) ¿varios admins desde el principio o solo el creador hasta que él haga admin a otro? (recomendado: varios).

## 5. Después
24. [m] Datos repetidos de los relés (55 % de los eventos) y batería en segundo plano (S24 7–9 %/h); margen al reabrir en frío.
25. [m] Llamadas: eco en grupo, gasto de datos por relés, «sin imagen propia al contestar desde el aviso» (a investigar).
27. [m] Wi-Fi SIN internet (20-11 14:07–14:09, S24 y Motorola): 2 min 17 s sin camino por internet hasta que Android cambió a datos. Si ningún relé conecta por Wi-Fi, pedir la red móvil explícitamente (requestNetwork cellular) y usarla para los relés; probar en el simulador con relés caídos solo por Wi-Fi. Vive: de vez en cuando (router sin WAN, Wi-Fi de paga/cautivo). 3.ª prueba: el servicio nativo del HONOR de Austin también quedó 5–6 min sin relés (14:03:35 «connection abort» ×4 y «IllegalStateException» al reabrir; volvió 14:09:16 por datos): revisar esa excepción en NetBg y que el reintento no espere a Android.
26. [g] Publicación en Google Play: Android más reciente (targetSdk 35/36), actualizador propio de la tienda, permisos, privacidad, firma, prueba cerrada de 14 días; novedades en los 5 idiomas al acercarse.
