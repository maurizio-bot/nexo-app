# Plan «que nada se quede en ✓» (27-11 noche; diagnósticos S24 + S23 del 26-11 22:16–22:19, build 3160)

Origen: el S24 mandó 6 notas de voz y 1 texto al S23 (21:53–21:58). Quedaron en ✓ para siempre; el S23 nunca recibió nada.
Diagnóstico hecho con 4 revisiones del código (solo lectura). Las citas archivo:línea son de esa revisión: verificarlas al tocar.
Orden propuesto: 1 → 3 → 4 → 2 (el 2 es el más grande). Cada punto: reproducir en `tests/sim`, corregir, batería, subir.

## 1. Acuse de entrega: un ✓ sin ✓✓ debe tener consecuencia (dueño: «si no lo recibió, debe haber una consecuencia»)
Hoy: por internet el ✓ se pone con el OK de CUALQUIER relé (`ble_send.js:180` → `handleCustody` `ble_ack.js:575`) y se borra el
pendiente; `_resendPendingMessages`/`_isResendable` (`ble_helpers.js:692`) ignoran 'sent'; `_sendFileViaBlobMailbox`
(`ble_ack_files.js:244`) no repite un puntero ya mandado (7 días). La sincronía ss/sr solo cubre textos y solo al conectar por
Bluetooth/arrancar. La bandeja nativa (`NetOutbox.kt`) sí re-publica, pero la JS la vacía al ver 'sent' (`ble_outbox.js:77`).
Arreglo:
- **Rescate de ✓** `_rescueSent(nx)` al inicio de `_resendPendingMessages` (sirve a `_netUp`, Bluetooth, Wi-Fi, Jump): propios en
  'sent' > 3 min y < 7 días, no en vuelo; calendario por id guardado (3 min, 15 min, 1 h, 6 h, 24 h; máx. 5); tope 20 por vuelta;
  con relé en pausa solo se reprograma. Texto → 'pending' (mismo id, el otro deduplica). Archivo → borrar `live.to[cid]`; si los
  trozos quedaron en < 2 relés o en ninguno que lea el otro, volver a subir (mismo fileId).
- **Pedir la sincronía ss/sr también cuando el contacto aparece por internet** (`_netUp`), y que cubra adjuntos.
- **✓ honesto** (cuando exista el punto 2): ✓ solo si aceptó un relé que el otro lee; si no, ⏳.
Pruebas: `blobmail.js`, `relelimita.js`, `fileabsent.js`, `textonet.js`, `resend.js`. Nueva: relé común limitando → A queda en ✓,
B aparece → llega una sola vez con el mismo id.

## 2. Relés en común y acuerdo entre los dos (dueño: «ponerse de acuerdo en un relé; si falla, moverse a otro»)
Hoy: cada teléfono elige sus relés por su salud LOCAL (`DEFAULT_RELAYS`/`SPARE_RELAYS` `net_link_shared.js:5,10`, `_spareCheck`
`net_relays.js:143`); nadie sabe dónde lee el otro; el saludo no lleva relés (`net_link.js:509`); se publica solo en los míos.
El 26-11 el S24 no llegaba a damus/nos.lol/nostr.mom; el único común era primal.
Arreglo:
- Saludo (cifrado) con `rr` = índices (catálogo fijo DEFAULT+SPARE+OWN, nunca URLs: T-R1) de los relés donde de verdad leo, y `rw` =
  donde puedo publicar ahora. Guardar en `peerRr[nx]` como `peerFcm`. Re-saludar cuando cambie (en `_spareCheck`, `_ownSync`,
  `_cellNote`, con el freno de `_ownAnnounce`).
- Publicar en mis relés ∪ `rr` del otro (socket temporal «solo publicar», hermano de `fetchOnlyOpen`, ~60 s); el envío cuenta
  hecho solo con OK de un relé del `rr` reciente.
- Si la intersección queda vacía (no conecta o pausa): el receptor añade una suscripción, SOLO con las etiquetas de ese contacto, en
  el primer relé de `rw` del emisor que él alcance. `_spareCheck` prefiere reservas que estén en el `rr` de mis contactos.
- Llevar `rr`/`rw` también al nativo (`_bgConfig` → `NetBg.kt` `publishSealed`, saludo `o.r`).
Riesgos: más sobres por IP (tope 3–4 destinos, respetar `relayCooling`/`_bulkWait` también en temporales), batería en datos móviles
(solo un temporal cuando no hay común). Pruebas: `relevo.js` (añadir el caso del 26-11), `relelimita.js`, `releprop.js`,
`datosmoviles.js`, `relayflap.js`; Kotlin `NetBgSavedTest.kt`.

## 3. Saturación de relés: el 3348 llega tarde (dueño: «se suponía arreglado»)
Hoy: el 3348 solo actúa DESPUÉS del primer «no»; no hay ritmo ANTES de publicar. Al volver/arrancar salen juntos: saludo a TODOS
los contactos (`net_link.js:626`, `_helloAll(true)`), 2–3 flush de pendientes (`ble_startup.js:313-347`, 52), reanudaciones, Jump
con 6 en paralelo × 5 intentos (`HOP_MAX_PAR` `ble_relay_conf.js:12`) → ×34 rechazos en un segundo. La pausa (`coolUntil`/`limitN`)
vive solo en memoria: al reiniciar se pierde (incluida la de 6 h de offchain).
Reenvío sin fin: 2 textos largos (msg1795732894955r8yh2amzl, msg17956640630991g2n0x4v7, desde el 26-11) se reanudan en cada vuelta:
`peerSafeAt` solo en memoria; `_dropDeliveredTransfers` (`ble_ack_resume.js:190`) no los encuentra (¿huérfanos?); los registros de
salida no caducan.
Arreglo: (a) ritmo por relé antes de publicar (ráfaga 5, luego ~2/s; mitad tras un «no») con prioridades: lo que escribe el usuario y
llamadas > acuses > reenvíos propios > saludos/toques/sincronías > Jump/Fénix/respaldos; lo encolado no gasta reintento. (b) Guardar
la pausa por relé en el estado. (c) Arranque escalonado: saludos por tandas, UN solo flush por vuelta, Jump por internet con 1–2 en
paralelo. (d) ✓✓ de texto troceado guardado en el registro (`peerSafe`), borrar registros de texto huérfanos, edad máxima (24 h con
✓✓; 7 días sin él → ✗ visible), `_resumeFail` guardado.
Pruebas: `relelimita.js`, `reenviolimite.js`, `resumestorm.js`, `resendloop.js`, `jumptopes.js`. Nuevas: arranque con 20 contactos +
2 textos largos + 21 Jump → ningún relé > N/s y lo del usuario sale primero; la pausa sobrevive al reinicio; huérfano no se reanuda.

## 4. Bluetooth: conectar solo con motivo (DECISIÓN DEL DUEÑO 27-11, reemplaza la del 22-11 de `ble_linkmgr.js:9-16`)
Dueño: escanear y saber quién está cerca, sí; conectarse y mandar cosas sin haber entrado al chat, NO. PORQUÉ: gasta batería y
trabajo del teléfono para nada (su S24 mantenía enlaces con una tablet y un vivo con los que no chateaba).
Hoy: `onDeviceFound` (`ble_conn_scan.js:186-205`) llama `_autoConnectGATT` sin motivo; `linkPlan` (`ble_linkmgr.js:57`) permite 4
contactos «cerca»; `_linkTrimTick` no recorta con < 5 enlaces (`ble_linkmgr.js:239`). Tráfico: ping del vigilante 108 B cada ~18 s
por enlace; al volver `ss` (66 B) y `kx` completo (2433 B) a cada enlace.
Arreglo: conectar solo si hay pendiente para él, chat abierto (o empezar a escribir), llamada/Wi-Fi Direct en curso o «Agregar»; sin
motivo solo se apunta `lastSeen` («cerca» sigue saliendo del escaneo). Cerrar enlaces de contacto sin uso de datos tras 45–60 s (los
pings no cuentan; como `SinAppLinks.kt`); sin ping a enlaces ociosos; `ss`/`kx` solo a los que se quedan. Ojo `NEXO_LINK_CONTACTS=0`
cae a 4 por `||` (`ble_linkmgr.js:52,84`).
Qué se pierde: +1–3 s en el primer mensaje (mitigado abriendo al entrar al chat); entrante sin cambio (el que tiene algo me conecta:
servidor GATT y anuncio siguen); Jump ya conecta de paso a demanda.
Pruebas: cambiar `enlacestope.js` (es la decisión del 22-11); cercanas `enlaces.js`, `multitud.js`, `puentetope.js`, `synclink.js`,
`zombivuelta.js`, `pingcongelado.js`. Nueva: contacto visto sin motivo → ningún `connectToDevice`; con pendiente/chat sí; ocioso
> 60 s se cierra, con transferencia no.
