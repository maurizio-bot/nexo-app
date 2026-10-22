# NEXO — Revisión de seguridad (comparada con Signal)

Fecha: 2026-10-22 (sobre la build 2709). Objetivo del dueño: estar al nivel de Signal o mejor.
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

## Estado de NEXO
| Aspecto | NEXO hoy | Signal | Gravedad |
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

### Fase 2 — protocolo al nivel de Signal
4. **Double Ratchet** con acuerdo inicial tipo X3DH (prekey firmada en el `kx` y en la tarjeta de contacto,
   para poder escribir a quien nunca se ha conectado, como en Jump) → secreto hacia delante y renovación.
5. **Datos del sobre atados al cifrado** (AAD: emisor, destino, id) y contador anti-repetición.
6. **Relleno** de longitud por tramos.
7. **Números de seguridad** (60 cifras + QR) con estado "verificado".

### Fase 3 — en el teléfono y en el aire
8. **Cifrado en reposo**: clave maestra en el Android Keystore (no extraíble); identidad, mensajes y
   adjuntos cifrados en disco.
9. **Anuncios Bluetooth rotativos**: identificador que cambia cada pocos minutos y que solo los contactos
   saben reconocer (un desconocido no puede seguirte); Jump sigue funcionando.
10. **Emisor oculto para los puentes** (solo ven el destino) y opción de bloquear capturas.
11. **Poscuántico** (ML-KEM híbrido en el acuerdo inicial), como PQXDH.

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
