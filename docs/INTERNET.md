# Internet: hablar con un contacto que está lejos

Pedido del dueño (23-10-2026): "si estoy en Wi-Fi y el otro también, sea el mismo módem o no, la conexión debe ser
Wi-Fi". Entre módems distintos solo hay camino por internet, y por internet hace falta un punto de encuentro. El dueño
eligió: **relés públicos (opción 3) y Tor (opción 2)**, sin servidor propio por ahora.

## Fase 1: relés públicos (Nostr) — `src/net/net_link.js`
- **Qué son**: servidores públicos del protocolo Nostr (relay.damus.io, nos.lol, relay.primal.net, nostr.mom). Guardan y
  reparten "eventos" por WebSocket; cualquiera puede usarlos y no son de NEXO. Se usan los cuatro a la vez.
- **Privacidad**:
  - Para cada pareja de contactos hay un secreto que solo ellos dos calculan (ECDH de sus claves de identidad).
  - Todo va cifrado con él (AES-256-GCM) y encima va el cifrado de extremo a extremo de siempre. El relé no ve el
    texto, ni el tipo de mensaje, ni los NEXO IDs.
  - Cada evento va dirigido a una **etiqueta que cambia cada día** y que solo esa pareja sabe calcular. El relé no sabe
    quién es quién ni quién habla con quién, y no puede enlazar dos días distintos.
  - Cada evento lo firma una **clave distinta al azar**: no se puede saber que dos eventos son del mismo teléfono.
  - **Sí ve**: la dirección IP de cada teléfono y cuándo se conecta. Para ocultarla: Tor (fase 2).
  - Los relés que piden identificarse para leer mensajes privados (NIP-42) se atienden con la clave de la etiqueta
    del día, no con el NEXO ID.
- **Buzón**: los eventos quedan guardados en los relés (caducan: textos y confirmaciones 7 días, trozos de archivos
  1 día). Si el otro tiene la app cerrada, lo recoge al abrirla (pide lo nuevo desde la última vez). El emisor ve
  ✓ cuando un relé lo guardó y ✓✓ cuando el otro confirma.
- **En línea**: al conectarse, cada teléfono saluda a sus contactos (y cada minuto mientras la app está abierta). Visto
  hace menos de 150 s = en línea. Entonces el enlace `net:<NEXO ID>` es un camino más (textos, fotos, archivos), con
  el mismo protocolo que por Bluetooth o Wi-Fi. La cabecera del chat dice "En línea · Internet".
- **Orden de caminos** (reglas del dueño):
  1. Wi-Fi del mismo router.
  2. **Internet, si los dos están en Wi-Fi** (aunque sean módems distintos).
  3. Bluetooth directo (Wi-Fi Direct para archivos grandes).
  4. Internet con datos móviles en alguno: **solo textos**; fotos y archivos esperan al Wi-Fi u otro camino.
  5. Jump.
  6. Buzón de internet para textos.
  7. Pendiente.
- Solo con contactos que lo anuncian (`nt:1` en el kx, en el chat y en la tarjeta de contacto) y con la clave aceptada.
- **Límites**:
  - Un evento ocupa como mucho ~64 KB: las fotos y archivos van en trozos de 16 KB.
  - Los relés públicos pueden poner límites de ritmo o caerse; por eso se usan cuatro.
  - Con la app en segundo plano Android no ejecuta el JavaScript: los mensajes esperan en el buzón hasta volver a la
    app. Para recibir en segundo plano haría falta pasar la conexión a la parte nativa (pendiente).
  - Desde el entorno de desarrollo no se alcanzan los relés públicos (política de red). Las pruebas usan un relé local
    con el mismo protocolo (`tests/sim/nostr_relay.js`). Con relés reales solo se puede confirmar en los teléfonos.

## Fase 2: Tor (pendiente)
Servicio oculto (.onion) por teléfono con la librería oficial `tor-android` (Guardian Project): los contactos se
conectan directamente por Tor, sin relés y sin que nadie vea la IP. Más lento y con más batería; la APK crece ~7 MB.
