# Canal directo de diagnósticos a Claude (build 2993)

Pedido del dueño (10-11): «que los diagnósticos lleguen a Claude directamente, por tiempo, sin copiar y pegar». Visto bueno del dueño a la llave
aparte: «lo de las llaves está bien, estamos en fase de testeo».

## Cómo funciona
1. Cuando la app manda un diagnóstico automático (síntoma: zombi, reintentos, pendiente viejo, error de código) o el resumen diario de uso, **además**
   lo cifra para una **llave de diagnóstico aparte** (no es la identidad del dueño) y lo publica en los 4 relés públicos que NEXO ya usa
   (`relay.damus.io`, `nos.lol`, `relay.primal.net`, `nostr.mom`). Mismo interruptor que el diagnóstico automático (Perfil → Ajustes): apagado = no sale nada.
2. Cada envío es un evento Nostr kind 1065 firmado con una clave de **un solo uso** (anónimo), con una etiqueta `nexo-diag-<huella de la pública>` y
   **caducidad de 7 días**. Contenido: base64( modo ‖ pública efímera ‖ nonce ‖ AES-256-GCM ), con ECDH secp256k1 + gzip. Ningún relé puede leerlo.
3. Una **tarea programada de Claude** (todos los días 8:17 hora de México) corre `node tools/diag_reader.cjs`: baja los eventos de las últimas 26 h,
   verifica id y firma, los **descifra con la mitad privada** y deja un informe en su sesión (nunca en GitHub).
4. Sin internet o sin relé abierto el evento queda en una cola de 3 en el teléfono y se reintenta al volver a la app y cada minuto un rato.

## Qué contiene y qué no
Lo mismo que ya recibe el desarrollador: el texto de «Perfil → Copiar diagnóstico» (registro de la app, IDs y direcciones de los contactos que salen en
el registro, versión) y el resumen diario (solo contadores). **Nunca el contenido de los mensajes.** Está explicado en Perfil → Ajustes → Diagnóstico automático.

## La llave
- **Pública** (va dentro de la app, `src/ui/diag_channel.js`, `DIAG_CHANNEL_PUB`): `03e28bb18b3ce6f1a0c1748b590f8ae73c6d409fe41f1eb660d236b5761f26ef5f`
  (etiqueta `nexo-diag-54dbe395696dabea`).
- **Privada**: archivo de 65 bytes que generó `tools/diag_keygen.cjs`; **no está en el repositorio ni en la app**. Solo la usa la tarea de Claude, desde la
  variable de entorno `NEXO_DIAG_PRIV` de su entorno. Si se pierde o se filtra: se genera otra pareja con `diag_keygen.cjs`, se cambia la pública en la app
  (una build nueva) y la variable; lo que ya esté publicado con la anterior caduca solo a los 7 días.

## Pasos del dueño (una sola vez)
1. (Hecho) Permitir en la red del entorno de Claude los 4 relés.
2. Guardar la llave privada como **variable de entorno `NEXO_DIAG_PRIV`** del entorno de Claude (menú del entorno en la barra del título de la sesión →
   Edit → variables de entorno): el valor es el contenido del archivo `diag_private_key.txt` que Claude dejó en la carpeta temporal de la sesión; después se
   borra ese archivo. (Claude no puede poner secretos por sí mismo ni se pegan en el chat.)
3. Decirle a Claude «listo»: se prueba con un diagnóstico real de un teléfono con la build 2993 o más nueva. La tarea diaria ya está creada.

## Archivos
`src/ui/diag_channel.js` (app) · `tools/diag_keygen.cjs` · `tools/diag_reader.cjs` · prueba `tests/sim/diagchannel.js`.
