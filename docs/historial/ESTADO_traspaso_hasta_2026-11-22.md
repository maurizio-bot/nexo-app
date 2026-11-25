# Bloques del TRASPASO de ESTADO.md retirados el 22-11-2026 (ya publicados o resueltos)

- **3257 (PUBLICADO en la 3116):** causa del bucle «enlace repetido» con el vivo (diagnóstico del dueño 20-11 22:22, build 3113): 3019 reabre un
  enlace de cliente (mtu517) si el que hay va a MTU 23, y el desempate de 3027 (soy el ID mayor → conserva el de SERVIDOR) lo vuelve a cerrar; los dos viven ~20–80 s. Arreglo:
  `_newClientWouldBeClosed` (ble_helpers.js) + rama en `ble_connections.js` (no reabre si el enlace que hay es el que conserva el desempate). Prueba pura en `bledup.js`; cercanas
  (dupserver, dupscan, reconndedup, dedupreenlaza, vivoarriba) OK. Queda: el enlace conservado va a MTU 23 (lento por Bluetooth con el vivo Y03; internet/Wi-Fi local lo cubren).
- **3258 (PUBLICADO en la 3116): medidas de Wi-Fi Direct en el diagnóstico** (pedido del dueño 20-11: que cuando entre WD «sí o sí» salgan datos reales).
  `usage_stats.js` (`usageNoteWd`, líneas dentro de «Velocidad de hoy por camino»): intentos y salidos por lado (envía/recibe), fallos con causa, crear grupo (con reintentos y código del
  sistema), unirse, velocidad PURA, tiempo trabajando, Wi-Fi normal (seguía/cambió de canal/se cayó), por qué sí/no se eligió WD (`_whyNot`); `wifi_direct.js` los anota y deja una línea de
  batería y temperatura por transferencia (≥ 5 s); «conexión lista» de WD entra en la tabla. Nativo (`PluginWifiDirect.kt`, NO compilado aquí): `groupMs/attempts/reasons/apStart` al montar el
  grupo, `apStart/apJoined` al unirse, `apMhz` al recibir (frecuencia del Wi-Fi normal, 0 = sin Wi-Fi). Pruebas: `wdmedidas.js` (en ci.js) y `wifidirect.js` (de punta a punta, local).
  Con eso se decide Wi-Fi Direct A/B con números del dueño; falta una prueba corta de archivo Bluetooth vs Wi-Fi Direct entre dos teléfonos (él la hace; los números salen solos).
- **3259 (PUBLICADO en la 3116): tablero por red** (dueño 20-11: «revisar red por red… ya no es resolver, es pulir»). Nuevo `docs/REDES.md` (qué se mide, datos reales con fecha,
  cuellos de botella ordenados y qué falta). Código: `usage_stats.js` (`usageNoteSent/Delivered/Symptom`: mensajes por camino al salir con ✓✓ y tiempo en cubetas, síntomas del día por tipo) y
  gancho en `diag_state.js`; prueba `redesmedidas.js`. Primer cuello de botella a trabajar: preparar archivo grande ≈ 5 MB/s (30 s para 153 MB). OJO: en `diag_stats.js` los fallos
  NO bajan por día (1, 5, 23, 29 del 16 al 19-11), pero cuenta lo que se pega/registra, no un ritmo; medir síntomas por hora de uso y build.
- **3260 (PUBLICADO en la 3116): Wi-Fi Direct en archivos grandes** (dueño 20-11: «con el vivo, en los de 160 MB no vi Wi-Fi Direct; por arriba de 5 MB sí o sí debe entrar»). Verificado
  en los registros: los 3 envíos (5,4/23/153 MB) SÍ fueron por WD («[BIG] Enviando … por Wi-Fi Direct», el vivo «Grupo creado»), pero la tarjeta solo decía «(Wi-Fi Direct)» durante «Enviando» (~6 s) y en «Preparando»
  (30 s) no decía nada: el grupo se monta y se baja en cada envío (nombre y clave nuevos), por eso no «se mantiene». Cambios: la tarjeta termina con «Enviado por Wi-Fi Direct · X MB/s»; `big_file.route` ya no deja
  que un castigo por fallo reciente cierre WD a un archivo grande (`canReach(nx, true)`); cada envío grande anota «por WD» o POR QUÉ no (`_noteRoute`/`_whyNot(dev, bytes, true)`). Si el dueño quiere el grupo
  siempre arriba (opción A), falta el «grupo caliente» nativo (paso 2 de wifi_direct.js, hoy vacío). Pruebas: `wdmedidas.js` (M7), bigroute/bigsend/big/wdoff OK.
- **20-11 tarde (diagnósticos 3116 apuntados, sin código):** 15 (escrituras 201 sostenidas, 2.ª prueba), 16 (dedup con enlaces muertos; «MTU 23» antes del intercambio), 16c nuevo, 27 nuevo (Wi-Fi sin internet 2–6 min en 3 teléfonos; pedir la red móvil explícitamente), 22 (HONOR mata la app: PowerGenie). Wi-Fi Direct no elegido en archivos de 74 KB–22 MB: confirma 3261. Todo en `docs/diagnosticos.json` (92 entradas) y `docs/COLA.md`. El cambio de modelo a Haiku fue solo para apuntar: el análisis del Kotlin nativo queda para un modelo grande.
- **21-11 10:42 (diagnósticos 3116 apuntados, sin código):** S23→S24 un mensaje y una foto 4,5 h ⏳ porque la app pasó a segundo plano a mitad del envío y el servicio nativo no tiene bandeja de salida → **COLA 29** (grande, va con la fase 3). Cierre nativo SIGABRT del S23 al quitar de recientes: sin efecto, falta la línea «Abort message». 101 entradas en `docs/diagnosticos.json`.
- **FASES SIGUIENTES del Bluetooth (sin hacer):** 2) servidor GATT SIEMPRE en el servicio (también con la app abierta); 3) conexiones salientes y reenvío desde el servicio; 4) conexiones
  a demanda (tope ~7); luego auditoría posterior y modo vagón. Los «Foreground kill» de Motorola a la hora en punto no los arregla el código: detectarlos y explicárselo al usuario.
- **Enlace repetido que se reabre (S24↔Austin), INVESTIGADO SIN ARREGLAR:** el enlace que el desempate cierra vuelve ~63 s después por `_seedNativeConnections` («Conexión existente
  recuperada al arrancar»), el nativo lo sigue listando tras `disconnectDevice({server:true})`, entra sin MTU y deja reconectar la otra dirección. Falta saber por qué lo sigue teniendo:
  hace falta el registro NATIVO de esos segundos (3255 ya añade papel/MTU al cerrar y «cerrada hace N s»). No arreglar a ciegas.
- **Videollamada del dueño 19-11 (83 min, caminando, «de las mejores»):** anotada en AREAS (Llamadas); batería/calor son percepción: medirlos con 3256.
