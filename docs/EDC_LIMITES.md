# Estudio de límites para EDC (17-11-2026, idea del dueño) — multitud y capacidad

Herramientas: `tests/sim/multitud.js` y `tests/sim/capacidad.js` (Chromium, CPU ×4 más lenta; no van en ci.js). Build b3181.
Supuestos de Android ajustables: 7 enlaces máximo, conexiones de una en una, 15 s para que falle una conexión.

## A. Multitud (NEXO alrededor de A; B es un contacto que entra en medio)
| NEXO | avisos/s | CPU | lag p95 / máx | B enlace listo | B mensaje entregado |
|---|---|---|---|---|---|
| 0 | 1 | 5 % | 3 ms / 24 ms | 2,5 s | 2,8 s |
| 50 | 18 | 8 % | 4 ms / 43 ms | 2,3 s | 2,8 s |
| 200 | 70 | 19 % | 20 ms / 180 ms | 2–7 s | 7,4 s |
| 500 | 207 | 64 % | 0,4 s / 2,5 s | 12 s (49 s fuera de la multitud) | 13 s |
| 1000 | 627 | saturada | 45 s / 45 s | no conecta en 120 s | 144 s |
- **Lo que traba:** `renderNewDeviceBar` (`ble_ui.js` ~796, llamada desde `onDeviceFound` en `ble_connections.js` 768/776): redibuja la
  lista de «Agregar» con cada aviso de un NEXO con su ID visible, aunque el panel esté cerrado, y recorre toda la libreta por fila:
  90–98 % del tiempo de JS.
- **Sin prioridad de contactos** (`_autoConnectGATT`, `ble_connections.js` ~880): con 10 contactos dormidos alrededor, B no conecta
  nunca (7 enlaces ocupados; 222 intentos rechazados en 2 min). Las conexiones de paso (Jump, puente: `gw_link.js` prueba 2 desconocidos
  cada 30 s) se llevan huecos antes que los contactos. Un contacto dormido no suelta su enlace (su nativo contesta los pings).
- Todos con ID visible (usuarios nuevos): con 200, lag de 42 s; con 500 la página se cuelga (cola de avisos +1,9 MB/s).
- Radio (estimación, sin medir): con anuncio a máxima frecuencia + potencia alta + largo alcance, ~200 NEXO en alcance mutuo → ~4 % de
  anuncios sin choque; ~500 → 0,03 %. Con 1 anuncio/s y sin largo alcance, a 1000 llegaría ~47 %.

## B. Capacidad
| | 100 contactos | 1000 | 5000 |
|---|---|---|---|
| Arranque / lista pintada | 0,65 / 1,5 s | 1,8 / 3,0 s | 10,8 / 19,5 s |
| Redibujar la lista de contactos | 37 ms | 0,4 s | 2,1–2,5 s |
| Volver a la app | lag 5,0 s | 6,2 s | **38,6 s** |
- **Cada chat guarda como máximo 2000 mensajes** (`slice(-2000)` en `vault_messages.js` `_persistMessages`/`_saveMessagesNow`): lo más
  viejo se BORRA sin avisar. El buscador del chat solo mira lo pintado (~60 mensajes).
- **Historiales completos leídos sin necesidad:** `_flushAllPendingMessages` (`ble_messages.js` ~16) al arrancar, al volver y al volver la
  red; `relay._periodic` → `_lostPeersWithPending` (`ble_relay.js` ~293) cada 30 s: 120 MB leídos en 65 s, lag de ~10 s.
- La lista de contactos se redibuja entera en cada cambio; ver a un contacto en el escaneo guarda toda la libreta (67 ms con 5000).
- Cada mensaje ~800 B (el texto va dos veces: `text` y `content`).
- Crecen sin tope: `_nexoIdToMac`/`_macToNexoId`, `_deviceStates`/`_supervisorStates`/`_mtuByDevice`/`_binPeers`; en Kotlin
  `seen1M`, `seenCoded`, `scanLogLast` (NexoBlePlugin.kt), `nxidToMacMap` (reescribe el archivo entero), `scanResults.none{}` lineal
  (PluginScan.kt), 2 líneas de logcat por anuncio.

## Límites propuestos
Contactos 1000 con la lista actual (5000 con lista por partes) · 2000 mensajes por chat EN MEMORIA, lo viejo archivado (no borrado) ·
seguir ~100 desconocidos (mejor RSSI) y siempre los contactos · «Agregar» ~30 filas · RSSI mínimo −80 dBm para desconocidos en multitud
(contactos −95) · 6 enlaces: hasta 4 de contactos + 1 libre para un contacto con pendientes + 1 de paso · prioridad: pendientes > chat
abierto > reciente; soltar a un contacto inactivo a los ~2 min en multitud.

## Cambios recomendados (por importancia para EDC)
1. «Agregar» con freno: solo con el panel visible, ≤ 2 veces/s, ≤ 30 filas, conjunto de IDs de contactos (horas, solo JS).
2. Gestor de enlaces con prioridad de contactos y hueco reservado; nada de conexiones de paso con un contacto esperando (1–2 días).
3. Índice de pendientes por contacto en vez de leer historiales completos (medio, vault).
4. Escaneo en Kotlin: mapa en vez de búsqueda lineal, sin logcat por anuncio, podar `seen*`, escritura agrupada de `nxidToMacMap`.
   **HECHO 23-11** (`ScanBook.kt`: un mapa con tope 1200 que olvida lo menos reciente; `scanResults` fuera; mapa NEXO ID ↔ dirección
   con tope 1500 y guardado cada 5 s; también el escaneo del servicio sin la app). Falta medirlo en teléfono entre mucha gente.
5. Avisos de escaneo agrupados en el nativo (uno por segundo).
   **HECHO 23-11**: hasta 12 avisos/s van sueltos (en casa nada cambia); con más, una tanda cada 0,5 s (`onDevicesFound`), los más
   cercanos primero; un contacto con algo esperando sale siempre al momento. Pruebas: `ScanBookTest` (JVM) y `escaneotanda.js`.
6. «Modo multitud» de radio: menos frecuencia, sin largo alcance y menos potencia con > ~100 NEXO (probar en campo).
7. Lista de contactos por partes; guardar solo lo que cambia.
8. Más de 2000 mensajes: archivar y buscar en todo el historial.
9. Pequeños: `relay.noteAnon` y `RidBook.refresh` sin trabajo por aviso.

10. **«Encontrar a los tuyos» (dueño 25-11, lo primero del modo multitud). HECHO 25-11 (3345)**: «Buscar a X entre la gente» (señal,
    hacer sonar, pantalla de luz, ubicación compartida con brújula) y «¿Quién del grupo está cerca?» (`find_ui.js`, `buscarcerca.js`);
    el contacto visto por el escaneo ya no guarda la libreta cada segundo. Falta medirlo en campo (señal real entre gente).

Arreglo aparte (hecho el 17-11): `pw_harness.js` deja sin relés a las pruebas que no fijan los suyos (una prueba sin `NEXO_NET_RELAYS`
habló con los relés públicos reales).
