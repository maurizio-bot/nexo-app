# Diagnóstico del dueño 02-11 (nightly-2882) — hoja de ruta de arreglos

Dos diagnósticos reales: **llamada en el coche** (S24 NX1N36C283 ↔ vivo NX09ACDB61, en movimiento) y **Bluetooth** (S24).
Ningún crash: todo es conectividad/entrega/audio. **Hilo conductor:** MTU 23 (A1) + bucle `no_service` (A2) dejan el
Bluetooth sin ancho de banda → se atascan los archivos (B2/B3) y, al caer el Wi-Fi, mueren (B4). El bucle de
reconexión (A3/A4/A5/D1) consume radio y realimenta todo. La llamada (C) conecta y fluye pero con audio mal ajustado.

Leyenda: **JS** = se reproduce y prueba en el simulador; **NATIVO** = Kotlin, se confirma compilando en CI + el dueño.

## Prioridad (más grave → más leve)

### Conexión Bluetooth
- **A1 · GRAVE · NATIVO — MTU se queda en 23** con varios contactos (a veces el MISMO negocia 512/517 y otras 23 → negociación inestable). Raíz de casi todo. → Arreglo: re-pedir MTU alto si cae a 23; no dar por bueno el 23 al primer intento.
- **A2 · GRAVE · JS — bucle `no_service`** (156 veces contra nx1e29ab2f): conecta pero nunca descubre servicio GATT; «pauso Bluetooth 30 s». → 🔶 **PARCIAL (revisado 2887):** el backoff #87 (streak≥4 → cooldown exponencial en `_bleCooldownUntil`) existe y **se aplica** en el bucle de re-búsqueda (`ble_connections.js` tick: los peers en pausa no disparan re-búsqueda); el streak solo se olvida al conectar BIEN (servicios listos, `_notifyPeerReady`), no en un connect TCP. **Gap que queda:** tras un `no_service`, el handler llama `_autoScanStart()`, y la reconexión por resultado de auto-escaneo **no consulta** `_bleCooldownUntil` → puede re-conectar al peer en pausa saltándose el backoff. Arreglo pendiente (pasada aparte, con diagnóstico del dueño para medir): que el connect por auto-escaneo respete el cooldown `no_service`. A3+D1 (ya hechos) deberían reducir bastante el ruido de reconexión del diagnóstico.
- **A4/A5 · MEDIA-GRAVE · NATIVO — status=133/147/8 + reconexión sin caché + `connectToDevice` 6× en 73 ms** (sin espera). → Arreglo: backoff y de-dup del connectToDevice; recuperar device cuando no está en caché.
- **A3 · MEDIA · JS — «sin respuesta a 2 pings», a veces triplicado** (mismo enlace evaluado 3× a la vez). → ✅ **HECHO (2887):** el vigilante corre cada 6 s pero un ping caduca a los 8 s → se apilaban 2-3 pings del mismo enlace. Ahora **un ping por enlace a la vez** (`_pingInFlight`) y `_forceDisconnectAndReconnect` **idempotente**. Prueba `reconndedup.js`.

### Envío de archivos / mensajes (lo que reportó el dueño)
- **B1 · GRAVE · NATIVO — «mensaje descartado entero» (hasta 126 trozos)** tras ~1,8 s de fallo de escritura; peor con enlace débil (rssi −82/−91). → Arreglo: reintentar por trozo / re-encolar, no tirar el mensaje completo.
- **B2/B3 · GRAVE · JS — «Cola de escritura llena» + «Max window retries» → «sendFile FAIL Abortado» en bucle** (reinicia de cero). Con MTU 23 la ventana nunca se vacía. → ✅ **HECHO (2885 + 2886):** (2885) «Max window retries» en un ARCHIVO ya NO lo marca ✗ — queda **⏳ pendiente** y se reenvía por el mejor camino al volver una ruta (ya no «se pierde»). (2886) **fail-fast / no MARTILLAR:** un archivo GRANDE (b64 > 300 000) cuyo único camino es un Bluetooth de MTU mínimo (≤50) ya NO se arranca — queda ⏳ pendiente y espera Wi-Fi/internet (el registro sigue en el vault); las fotos chicas SÍ se mandan por MTU 23, y tras ~5 min sin camino mejor se intenta por Bluetooth igual (anti-inanición: nunca se pierde). El ritmo por MTU (#129: BLE_BUSY = contrapresión, trozo por MTU, tope de 1 archivo por enlace) ya estaba. Prueba `filetinymtu.js`.
- **B4 · GRAVE · JS — «Wi-Fi caído y no cabe por Bluetooth»**: al cortarse el Wi-Fi a mitad de un archivo grande (coche), se rechaza sin reintento diferido. → ✅ **HECHO (2885):** un archivo que no cabe por el camino de ahora queda **⏳ pendiente** (no ✗); el registro sigue en el vault y `resumeOutgoingTransfers` lo reenvía al volver Wi-Fi/internet. Solo el vídeo original va por su camino (previa+HD). Prueba `filepend.js`. (`relink` + `send.js`.)
- **B5 · MEDIA · JS — Assembly timeout** (4 mensajes a medio reensamblar). **B6 · LEVE — ACK timeout en reenvío JUMP.**

### Llamada / audio (coche; la llamada SÍ fluyó 31 s, opus los dos lados)
- **C · MEDIA-GRAVE · JS/NATIVO** — El que LLAMA (S24): `foco de audio: no (0)` (ya arreglado en 2883 con reintento), micrófono casi mudo 10 s y luego ~1 %, gate/ducking muy agresivo (silencio 77–94 %). El que RECIBE (vivo): volumen de llamada 1/10 y multimedia 0/15 → casi inaudible (ganancia 1.8× en 2883 ayuda; ver si hay que forzar volumen), eco −6 dB al inicio. → Arreglo: suavizar el gate del micro cuando el nivel es muy bajo; revisar que el foco tome bien (2883); valorar subir el volumen del stream al entrar la llamada.

### Jump / Wi-Fi / otros
- **D1 · MEDIA · JS — tormenta «[JUMP] Conectando con»** (12 idénticas en 1 ms; 104 crudas) en cada tick de re-búsqueda. → ✅ **HECHO (2887):** `relay._connect` solo deduplicaba los NO-contactos (ventana transient 15 s); ahora una **ventana de dedup de connect** (`_connecting`) cubre también a los contactos (un connect por peer en vuelo; pasada la ventana reintenta). Prueba `reconndedup.js`.
- **D2 · LEVE-MEDIA · JS — «Remitente sellado ilegible» (vacío)** — sobre JUMP que no parsea remitente.
- **E1 · MEDIA · JS — rebote de Wi-Fi en movimiento** (dispara B4).
- **F1 · MEDIA · NATIVO — FILE_IO «leyendo lento» 1,3–2,2 s en el vivo** (bloquea el envío). **F2 · MEDIA · JS — FENIX re-reparte 21 segmentos de golpe por un «nodo perdido» que parece falso positivo** (nx09acdb61 seguía activo). **F3/F4 · LEVE** — splash not found; install_permission (esperado).

### Aparte (reporte del dueño, no en estos logs)
- **Chat lento al crecer · JS/NATIVO** — al abrir en frío, `vaultLoadMessages` descifra+parsea+ordena el archivo entero (tope 2000 msg). El render ya está paginado (60). → ✅ **HECHO (2888):** archivo de **cola** (`_tailFileName`, últimos 80) escrito junto al completo; al abrir, se pinta al instante con la cola (`vaultLoadRecent`) y el completo se carga perezosamente (`_loadFullHistory`). El completo es la fuente de verdad intacta; la cola, caché aditiva (si falta, cae al completo sin perder nada); `vaultLoadRecent` no cachea (evita truncar al guardar). Prueba `chatlento.js` (sin pérdida: tras leer la cola en frío + enviar, el disco conserva los 300+1).

## Orden de ejecución (robusto, con batería verde + APK, lo nativo lo confirma el dueño)
1. **2883 (hecho):** audio volumen+foco (C parcial) + sticker.
2. **Envío de archivos (B4 + B3 + B2 JS): ✅ HECHO en 2885 + 2886** — (2885) un archivo que no cabe por el camino de ahora queda ⏳ pendiente (no ✗) y se reenvía al volver Wi-Fi/internet (`filepend.js`); (2886) un archivo GRANDE ya no MARTILLA un Bluetooth de MTU mínimo: queda ⏳ pendiente y espera un camino mejor, con anti-inanición para no perderlo nunca (`filetinymtu.js`). **Falta solo B1 nativo** (Kotlin: no descartar el mensaje entero por un corte de escritura de ~1,8 s; reintentar por trozo / re-encolar).
3. **Bluetooth JS (A2/A3/D1):** backoff + de-dup de reconexión y de JUMP.
4. **Nativo (A1 MTU, B1 descarte, A4/A5 reconexión):** re-negociar MTU; no descartar mensaje entero; backoff del connectToDevice.
5. **Audio fino (C):** gate menos agresivo con nivel bajo; volumen del stream.
6. **Chat lento:** cola al instante + carga perezosa del vault.
7. **FENIX falso positivo (F2), D2, F1.**
