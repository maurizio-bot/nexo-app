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
  - **Sí ve**: la dirección IP de cada teléfono y cuándo se conecta. Con Tor (fase 2) los mensajes de la pareja ya no
    pasan por los relés y el contacto no ve la IP del otro; los saludos y el buzón siguen yendo a los relés.
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

## Fase 2: Tor — `src/net/net_link.js` + `NexoBlePlugin.kt` (torStart/torConnect/torSend)
- **Qué es**: cada teléfono arranca Tor (librería oficial `tor-android` del Guardian Project, versión 0.4.9.14) y
  publica un **servicio oculto** con una dirección `.onion` fija (la clave se guarda en el teléfono, `nexo_tor_key.json`).
- **Cómo se encuentran**: la `.onion` viaja **dentro del saludo cifrado** de la pareja (campos `o`/`op`). Nadie más la
  ve. Si los dos tienen Tor, uno llama al otro por Tor y desde entonces todo lo de esa pareja (textos, fotos,
  confirmaciones) va **directo por Tor**: los relés no reciben nada de esa conversación y **nadie ve la IP** de ninguno.
- **Lo que siguen haciendo los relés**: saludos (saber quién está en línea y pasar la `.onion`) y buzón cuando el otro
  no está.
- **Anti-suplantación**: por Tor viaja el mismo sobre cifrado de la pareja. Un paquete que no se descifra con la clave
  de ese contacto cierra la conexión (`torDrop`): conocer la `.onion` no basta para hacerse pasar por nadie.
- **Cuándo**: Tor **arranca solo con Wi-Fi** (bajar el directorio de Tor gasta datos) y solo si hay contactos con
  internet; si falla, reintenta cada 10 min. Se puede **apagar en Perfil → Internet**.
- **Por dentro**: `LanHub` (el mismo enlace del Wi-Fi local) escucha solo en 127.0.0.1 y Tor le pasa las conexiones del
  servicio oculto; para llamar usa el proxy SOCKS de Tor (sin resolver nombres fuera de Tor). Tiempo de conexión
  hasta 90 s.
- **Coste**: más lento que los relés (cada paquete da 6 saltos por la red Tor), algo más de batería, y la APK crece por
  la librería nativa de Tor (solo ARM de 32 y 64 bits): de 10 MB (2734) a 26,9 MB (2739).
- **Versión**: 0.4.9.14 desde la ronda 2749 (antes 0.4.9.5). Pide compileSdk 37.1 y trae clases de Java 24, por eso el
  proyecto pasó a AGP 9.4.0 / Gradle 9.6.0 / Kotlin 2.2.20 (el `targetSdk` sigue en 34: la app se comporta igual en el
  teléfono). Sigue excluida del Jetifier (`android.jetifier.ignorelist`, también en el workflow).
- **Pruebas** (`tests/sim/net.js --tor`, modelo de Tor en `native_mock.js` con arranque, latencia y ancho de banda):
  Tor conectado en 1,6 s del modelo, 0 eventos a los relés durante el envío, impostor cerrado y la pareja sigue
  hablando. `tests/kotlin/LanHubTorTest.kt` prueba `LanHub` con un proxy SOCKS real. **El Tor real solo se puede
  confirmar en los teléfonos** (desde el entorno de desarrollo no hay salida a la red Tor).
