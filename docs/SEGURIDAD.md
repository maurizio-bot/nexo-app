# NEXO — Revisión de seguridad (comparada con Signal)

Fecha: 2026-10-22 (revisión sobre la build 2709; fase 1 en la 2711, fase 2 en la 2712). Objetivo del dueño: estar al nivel de Signal o mejor.
Cada punto está comprobado en el código o en la configuración (no son suposiciones).

## Qué hace Signal (referencia)
- Acuerdo de claves autenticado al iniciar (X3DH → PQXDH, con un componente poscuántico ML-KEM).
- Double Ratchet: cada mensaje con una clave nueva que se borra tras usarla (secreto hacia delante) y
  renovación continua de claves (si roban las claves de hoy, los mensajes futuros vuelven a ser seguros).
- Números de seguridad (60 cifras / QR) para verificar en persona; aviso si cambia la identidad.
- El servidor autentica las cuentas: nadie puede enviar "como" otra persona.
- "Sealed sender": el servidor no ve quién envía. Relleno (padding) para ocultar la longitud.
- Base de datos local cifrada (clave en el Android Keystore), sin copias de seguridad en claro,
  bloqueo de capturas opcional, mensajes temporales, registros sin contenido.
- APK de producción (no depurable), código abierto y auditado.

## Estado de NEXO (antes de las fases; ver al final lo ya hecho)
| Aspecto | NEXO en la 2709 | Signal | Gravedad |
|---|---|---|---|
| Cifrado del contenido | AES-GCM 256 con clave por pareja (ECDH P-256 + HKDF) | Double Ratchet (AES-256 + HMAC) | — |
| Secreto hacia delante / renovación | **No**: la clave por pareja es fija; quien robe la clave privada descifra todo lo capturado | Sí | Alta |
| Suplantación | **Posible**: el mensaje trae la clave del emisor; si cambia, se acepta con un aviso. Sin servidor, cualquiera cerca puede decir "soy A" con otra clave y su mensaje se muestra como de A | No (cuentas autenticadas) | **Crítica** |
| Datos del sobre (quién, a quién, id) | Sin proteger por el cifrado: se pueden intercambiar y **reenviar mensajes viejos con otro id** (se mostrarían otra vez) | Atados al cifrado (contadores del ratchet) | Alta |
| APK | **De depuración**: con un cable USB y "depuración USB" se leen los archivos internos (`run-as`) y se inspecciona la app (WebView depurable) | Producción | **Crítica** |
| Copias de seguridad | `allowBackup="true"`: los archivos de la app pueden salir en copias de Android | Excluidas / cifradas | Alta |
| Clave de identidad | En un archivo JSON en claro (almacenamiento interno) | Protegida con Keystore | Alta |
| Mensajes y adjuntos guardados | JSON y base64 en claro (almacenamiento interno) | Base de datos cifrada | Alta |
| Registros (diagnóstico) | **Guardan en disco los primeros 30 caracteres de cada mensaje recibido**, nombres de archivo y de contactos; salen en "Copiar diagnóstico" | Sin contenido | **Crítica** |
| Rastreo por Bluetooth | El teléfono anuncia siempre el mismo NEXO ID: cualquiera con un escáner puede seguir a una persona | No anuncia nada | Alta |
| Verificación de identidad | Huella de 80 bits al tocar el aviso, sin estado "verificado" ni QR | 60 cifras + QR, estado verificado | Media |
| Metadatos en puentes (Jump) | Ven quién escribe a quién | El servidor no ve el emisor | Media |
| Longitud de los mensajes | Visible | Relleno | Baja |
| Poscuántico | No | Sí (PQXDH) | Media (a futuro) |
| Wi-Fi Direct | Credenciales aleatorias por envío, cifradas E2E; contenido cifrado E2E | n/a | OK |
| Capturas de pantalla | Permitidas | Opción de bloquearlas | Baja |

## Plan
### Fase 1 — urgente (fallos graves y baratos de arreglar) — HECHA (build 2711)
1. **APK de producción** (no depurable), firmada con la misma llave (se instala encima) y `allowBackup="false"`.
2. **Registros sin contenido**: nada de texto de mensajes, nombres de archivo ni de contactos.
3. **Anti-suplantación**: si un mensaje llega con una clave distinta de la guardada, no se acepta como del
   contacto. Queda retenido hasta que el usuario compare huellas y acepte la clave nueva; mientras, no se
   le envía nada cifrado a la clave nueva (podría ser un impostor).

### Fase 2 — protocolo al nivel de Signal — HECHA (build 2712; el QR, en la ronda 2730)
4. **Double Ratchet** con acuerdo inicial tipo X3DH (prekey firmada en el `kx` y en la tarjeta de contacto,
   para poder escribir a quien nunca se ha conectado, como en Jump) → secreto hacia delante y renovación.
5. **Datos del sobre atados al cifrado** (AAD: emisor, destino, id) y contador anti-repetición.
6. **Relleno** de longitud por tramos.
7. **Números de seguridad** (60 cifras + QR) con estado "verificado".

### Fase 3 — en el teléfono y en el aire — EN CURSO (hecho: 8 y capturas en la 2720; 10 y 11 en la ronda 2730; falta 9)
8. **Cifrado en reposo**: clave maestra en el Android Keystore (no extraíble); identidad, mensajes y
   adjuntos cifrados en disco. **Hecho**, más el **bloqueo opcional con huella** y la **opción de bloquear
   capturas** (decisiones del dueño, 22-10-2026: los dos opcionales, en Perfil).
9. **Anuncios Bluetooth rotativos**: identificador que cambia cada pocos minutos y que solo los contactos
   saben reconocer (un desconocido no puede seguirte); Jump sigue funcionando.
10. **Emisor oculto para los puentes** (solo ven el destino) y opción de bloquear capturas. **Hecho.**
11. **Poscuántico** (ML-KEM híbrido en el acuerdo inicial), como PQXDH. **Hecho.**

Dónde NEXO puede quedar por encima de Signal: sin servidor ni número de teléfono (ningún tercero ve la
agenda ni los metadatos), funciona sin internet y, con la fase 3, sin identificador rastreable en el aire.

## Fase 1: qué se hizo y cómo se comprobó
- APK no depurable (`debuggable false` en la variante que compila CI, misma firma: se instala encima),
  WebView sin depuración (`webContentsDebuggingEnabled: false`), `allowBackup="false"`,
  `fullBackupContent="false"` y `data_extraction_rules.xml` (nada sale en copias ni en transferencias de
  móvil a móvil; al cambiar de teléfono no se migran los chats, como en Signal sin su copia propia).
- Registros: sin texto de mensajes, nombres de archivo (solo la extensión) ni nombres de contactos; archivo
  de registro nuevo (`nexo_diag_log2.txt`) y el anterior se borra al arrancar.
- Anti-suplantación: la clave de un contacto no cambia sola. Clave distinta → `pendingKey`; lo que llega
  con ella se retiene (no se muestra ni se confirma) y no se envía nada al contacto hasta que el usuario,
  en el aviso del chat (huellas anterior y nueva), pulse Aceptar o Rechazar. Rechazar: lo pendiente sale
  al contacto real con la clave de siempre.
- Pruebas: `tests/sim/impostor.js` (M dice ser B ante A: no se muestra, no recibe nada, al rechazar el B
  real recibe lo pendiente), `e2e.js` (reinstalación de B: retenido hasta aceptar; ningún contenido en los
  registros) y batería completa.
- Verificado en la APK publicada 2711 (manifiesto binario): sin `debuggable`, `allowBackup=false`,
  `dataExtractionRules` presente; firma 23d86688… (se instala encima).
- Limpieza pendiente (no es un riesgo): webpack copia `client/android` (plantilla antigua, sin claves) dentro
  de la APK en `assets/public/android/`; sobra.

## Fase 2: qué se hizo y cómo se comprobó (build 2712)
- **Protocolo 2** (`src/vault/e2e_ratchet.js`), el de Signal con WebCrypto (P-256, HKDF-SHA256, HMAC-SHA256,
  AES-256-GCM):
  - Acuerdo inicial X3DH con la identidad de siempre (la del NEXO ID y las huellas ya aceptadas) y una clave
    previa firmada (ECDSA) que rota cada 30 días (se guardan las 3 últimas). Sin claves de un solo uso: sin
    servidor no hay dónde dejarlas (Signal las usa para el primer mensaje; el resto es igual).
  - Double Ratchet: cada mensaje con su propia clave, borrada al usarla (secreto hacia delante), y renovación
    con cada respuesta (si roban las claves de hoy, las siguientes vuelven a ser seguras). Mensajes en
    desorden o perdidos: claves saltadas (máx. 1000 por cadena, 300 guardadas).
  - El estado se guarda antes de entregar el texto cifrado: tras un cierre nunca se reutiliza una clave.
- **Paquete de claves** (`b2`) en el kx y en las tarjetas de contacto (se puede escribir a quien nunca se ha
  conectado, también por Jump). Solo se acepta si es de la clave aceptada del contacto; el de una clave
  pendiente espera a que el usuario la acepte. Un impostor con claves nuevas no echa las sesiones buenas.
- **Sobre atado al cifrado**: emisor, destino e id del mensaje entran en el cifrado (también nombre y miniatura
  de archivos). Cambiar cualquiera, o reenviar un paquete capturado (con el mismo id o con otro), no muestra
  nada. Tras reiniciar, las repeticiones se siguen detectando.
- **Relleno**: textos en tramos de 160 bytes ("sí" y 120 letras miden lo mismo); archivos hasta un 12 % más.
- **Número de seguridad** de 60 cifras (como Signal, de las dos identidades), igual en los dos teléfonos, al
  tocar el aviso del chat, con "Marcar como verificado" (deja de estarlo si la clave cambia).
- **Compatibilidad**: con builds anteriores sigue el protocolo 1. Con quien ya usa el 2 no se vuelve al 1: no se
  le cifra con el 1 y lo que llegue de él con el 1 se descarta pasadas 26 h (antes puede ser algo que ya
  estaba en camino). Wi-Fi Direct: las credenciales (de un solo uso) siguen con el 1; el contenido va con el 2.
- Pruebas: `tests/sim/ratchet.js` (40 comprobaciones del módulo: desorden, pérdidas, manipulación, reinicio,
  inicio simultáneo, relleno, impostor, estado perdido del otro), `e2e.js` (todo sale como E2, repeticiones,
  vuelta al 1 descartada, número igual en los dos, verificado), `mixed.js` con la 2711 (protocolo 1) y con la
  2704; batería completa (23 pruebas, tiempos iguales que la 2711) y Chromium real.
- Pendiente de la fase 2: **QR** del número de seguridad (hace falta lector con la cámara); hoy se comparan
  las cifras. Límite conocido: un atacante activo en el momento del primer contacto podría quitar el `b2` del
  kx para que sigan con el protocolo 1 (una vez en el 2, ya no se puede).

## Fase 3 (primera parte): qué se hizo y cómo se comprobó (build 2720)
- **Cifrado en reposo** (`plugins/nexo-ble/.../AtRestStore.kt`, usado por `saveToFile` / `loadFromFile` /
  `deleteFile`): todo lo que NEXO guarda (identidad, NEXO ID, claves del protocolo 2, contactos, mensajes,
  adjuntos, Fénix, cola de Jump) va en disco como `NXE1` + iv + AES-256-GCM. La clave de datos es aleatoria y
  se guarda envuelta (AES-GCM) con una clave del **Android Keystore** que no sale del chip; en memoria solo
  mientras la app corre. No pide la huella para usarla: los mensajes tienen que poder guardarse con la app
  bloqueada o en segundo plano (como WhatsApp/Signal en Android).
  - Archivos de versiones anteriores: se leen tal cual y se cifran en segundo plano al arrancar (cada uno se
    comprueba antes de sustituirlo; escritura atómica). Solo los `nexo_*` de la carpeta de la app; el mapa
    nativo NEXO ID → dirección (`nexo_nxid_mac_map.json`, lo lee el Kotlin) sigue en claro (no tiene
    contenido).
  - Sin clave (Keystore roto) no se sobrescribe nunca un archivo cifrado; Perfil → Seguridad lo indica.
  - Qué protege: copiar la carpeta de la app (teléfono rooteado, copia forense, backup) no da nada legible.
    Qué no: alguien con el teléfono desbloqueado y NEXO abierto (para eso, el bloqueo con huella).
- **Bloqueo con huella** (`src/ui/app_lock.js`, Perfil → Seguridad), desactivado por defecto: al abrir y al
  volver tras el tiempo elegido (inmediatamente / 1 min / 30 min) pide huella, cara o PIN del teléfono
  (`BiometricPrompt`). Activarlo y quitarlo exige la huella. Bloqueada, la app sigue funcionando por debajo
  (los mensajes llegan). Con "inmediatamente" se tapa al salir (no se ve en recientes). Si el teléfono deja de
  tener huella y PIN, se quita el bloqueo (si no, el usuario quedaría fuera para siempre).
- **Capturas** (Perfil → Seguridad), permitidas por defecto: al bloquearlas (`FLAG_SECURE`) tampoco se ve NEXO
  en recientes ni en grabaciones de pantalla.
- Fénix: la clave maestra K (`nexo_fenix.json`) queda cifrada en reposo como todo lo demás.
- Pruebas: `tests/kotlin` (JVM, 7 pruebas: cifrado en disco, archivos antiguos y migración, sin clave no se
  sobrescribe, otra clave o manipulado no se lee, rutas fuera de la carpeta, migrar mientras se guarda, 30 MB);
  `tests/sim/lock.js` (bloqueo, tiempos, PIN sin bucle, mensajes llegan bloqueada, reabrir, sin huella,
  capturas; la prueba del bucle se comprobó quitando la protección: falla). La migración real de datos de una
  versión anterior solo se puede confirmar en el teléfono.
- Pendiente de la fase 3: anuncios Bluetooth rotativos (9), emisor oculto para los puentes (10), poscuántico
  (11).

## Fase 3 (segunda parte): qué se hizo y cómo se comprobó (ronda 2730)
- **Remitente oculto a los puentes** (`sx`, como el "sealed sender" de Signal; `ble_interface` v6.11–6.12,
  `e2e_crypto.e2eSealAnon/e2eOpenAnon`, `ble_relay` v2.1): lo que va por Jump a un contacto que lo entiende
  viaja en un **sobre anónimo** para el destino: clave efímera ECDH P-256 + clave de identidad del destino →
  HKDF → AES-GCM (datos adicionales: la clave del destino). El puente ve a quién va y un id, no quién lo manda
  ni qué es (mensaje, confirmación, lectura o kx). Los textos largos, fotos y archivos llevan el remitente
  dentro del sobre (`fr: "sx:…"`). La búsqueda de caminos (`rq`) lleva huellas con sal en vez de NEXO IDs.
  - Solo si el primer puente reenvía bien los sobres (lo dice en su kx, `ss:1`): una build anterior los
    envolvía como texto suyo y no llegaban; con un puente así va como antes (sin sellar) y llega igual. El
    destino también sabe desenvolver ese caso.
  - El destino confirma cada sobre al puente que se lo trae (`rk`): sin eso, las confirmaciones selladas se
    quedaban en la cola del puente reintentándose.
  - Cómo sabe que el otro lo entiende: kx (`ss:1`), el propio chat (`ss:1`, solo si se descifra bien) y la
    tarjeta de contacto compartido (así el primer mensaje a un contacto compartido ya va sellado).
  - Límites: el primer puente sabe qué vecino le entregó el paquete (inevitable en una red de saltos); por el
    momento en que pasan las cosas un puente podría adivinar quién habla con quién (como en Signal con el
    servidor).
- **Poscuántico** (`e2e_ratchet` v1.1, como el PQXDH de Signal): cada clave previa lleva una clave
  **ML-KEM-768** (estándar NIST FIPS 203, librería `@noble/post-quantum`) firmada con la clave de firma. Quien
  empieza encapsula un secreto con ella (va en la cabecera del primer mensaje) y ese secreto entra en el acuerdo
  junto a los tres DH: un ordenador cuántico futuro que rompa P-256 no puede descifrar lo grabado hoy sin romper
  también ML-KEM.
  - Con builds anteriores (sin clave ML-KEM), el acuerdo clásico de siempre. Una vez que un contacto la
    publicó, un paquete suyo sin ella se rechaza (un puente no puede quitarla para rebajar el acuerdo).
  - El kx dice qué clave ML-KEM del otro tengo (`ph`): los 1,6 KB solo viajan cuando hacen falta.
  - El aviso de cifrado del chat dice "Protección poscuántica activa" cuando la sesión empezó así.
  - Límite: protege el acuerdo inicial (lo que dura una sesión); los pasos del ratchet siguen siendo P-256,
    como en el PQXDH de Signal.
- **QR del número de seguridad** (`src/ui/qr_verify.js`): en el aviso de cifrado del chat, "Mostrar mi QR" /
  "Escanear su QR". El QR lleva `NEXO-SN1|quien lo muestra|para quien|60 cifras` (nada secreto). Quien escanea
  calcula el número con las claves que tiene: si coincide queda verificado; si no, avisa de posible impostor
  y no lo marca. Lector con la cámara (`getUserMedia` + `jsQR`), todo en el teléfono, sin Google.
- Pruebas: `ratchet.js` (51 comprobaciones, 11 nuevas del poscuántico: sesión híbrida, build anterior, firma
  falsa, rebaja rechazada, secreto alterado, actualizar desde una build anterior); `jump.js` (normal, cadena de 3
  saltos, contacto compartido, desconocido en medio, batería baja, reenvío directo y **puente con la 2728**):
  los puentes no ven el remitente de nada salvo con el puente 2728 (como antes) y todo llega; `qr.js` en
  Chromium con una cámara falsa que muestra el QR del otro (correcto → verificado; impostor, otro contacto y
  algo que no es de NEXO → aviso, sin verificar; lectura en 0,3–0,4 s); `mixed.js` con la 2728 y la b9c412f;
  batería completa.
- Pendiente de la fase 3: anuncios Bluetooth rotativos (9). Necesita una decisión del dueño (ver
  `docs/PENDIENTES.md`): hoy cualquiera ve el NEXO ID en el aire y eso es lo que permite agregar a alguien y
  que un desconocido haga de puente en Jump.

