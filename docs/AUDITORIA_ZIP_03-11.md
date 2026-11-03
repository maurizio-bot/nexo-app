# Auditoría del ZIP (03-11-2026) — revisión de verdad/falso, evaluación e implementación

El dueño pasó una auditoría externa (hecha por LECTURA de código, sin reproducir) con 23 hallazgos + 20 pruebas
destructivas. Aquí queda **qué es verdad y qué no** contra el código ACTUAL (build 2891), la **evaluación** de cada
propuesta, y **qué se implementa / difiere / necesita decisión del dueño**. Verificado por lectura directa + 3 revisiones
independientes en paralelo (AtRestStore, vault_manager, NexoBlePlugin/AccountMove).

## Tabla de verdad (resumen)

| # | Hallazgo | Veredicto | Acción |
|---|----------|-----------|--------|
| 1 | SafeJson no se aplica antes de `JSONObject` en BLE → StackOverflow a distancia | **PARCIAL-VERDAD** (el bucle es iterativo/seguro; el `JSONObject(candidate)` sí puede lanzar `StackOverflowError`, que `catch(Exception)` NO atrapa) | ✅ **2892**: cribar con `SafeJson.reject` + `catch(Throwable)` |
| 2 | Reensamblado BLE de TEXTO (`messageBuffers`) sin tope de bytes | **VERDAD** (solo límites por tiempo; la ruta binaria sí está acotada) | ✅ **2892**: tope de bytes por enlace (8 MB) + resync |
| 3 | `MAX_CHUNKS` aún permite un NACK enorme | **YA MITIGADO** (el NACK ya va en rangos compactos `_compressRanges`; `total` acotado a 300k) | ℹ️ Nada (la auditoría sobrevaloró; residual mínimo) |
| 4 | Escritura en claro si falta la clave del Keystore | **VERDAD pero INTENCIONADO** (hay prueba que lo fija como deseado: archivo nuevo/en claro sí se escribe) | ⚠️ **Decisión del dueño** (compromiso «degradar a claro» vs «fallar y arriesgar perder»); no lo toco solo |
| 5 | `replace()` borra el original antes de confirmar el segundo rename | **VERDAD** (sin respaldo, sin atomicidad, sin prueba) | ✅ **2893**: reemplazo atómico (`Files.move ATOMIC_MOVE`) que nunca borra el original |
| 6 | Externalizar adjunto puede perderlo si `saveToFile` resuelve `frozen:true` | **VERDAD** (ventana estrecha: durante migración + si la migración falla) | ✅ **2894**: no dar por guardado un `frozen`/sin `success` |
| 7 | `initVault` se marca hecho ante un error → no reintenta y puede pisar contactos con lista vacía | **VERDAD** | ✅ **2894**: no persistir contactos si la carga falló; reintentar |
| 8 | Errores de persistencia silenciados; `vaultFlushAll` no vuelca el temporizador de contactos; la migración sigue aunque el flush falle | **VERDAD (los 3)** | ✅ **2894**: volcar contactos en el flush + abortar migración si el flush falla + registrar los errores |
| 9 | `saveToFile` con `moveFrozen` devuelve `success:true` sin escribir | **VERDAD** (impacto práctico bajo: ningún caller lee `.frozen` hoy) | ✅ **2894** (lado JS, junto con #6) |
| 10 | Importar cuenta borra (`wipe`) antes de confirmar el import | **VERDAD** (hay pre-check de descifrado que cubre el caso común; SIN rollback; el diseño asume teléfono receptor vacío) | ⚠️ **Alto riesgo**: guardia barata ahora + rediseño transaccional recomendado (ver abajo) |
| 11 | `import()` reserva `ByteArray(len)` hasta 512 MB por archivo de texto, sin tope agregado | **VERDAD** (solo archivos de texto; los grandes van en streaming; ya era F8) | ✅ **2893**: bajar el tope de texto + tope agregado (pure, probado en JVM) |
| 13 | Mapa NEXO ID→MAC (`nexo_nxid_mac_map.json`) fuera del cifrado en reposo | **VERDAD** (metadatos; no contenido) | ⚠️ Evaluado: lo lee/escribe Kotlin directo en varios sitios; medio riesgo. Recomendado, no urgente |
| 14 | Endpoint FCM `/wake` público, límite en memoria | **VERDAD** (= SEC-3, ya conocido) | ⏭️ Tras el despliegue del push-sender (el dueño lo está desplegando) |
| 15 | Alta de contacto `acc` falsificable con solo el NEXO ID | **VERDAD** (= SEC-2, documentado; el contacto queda «sin verificar») | ⏭️ Endurecimiento de identidad, build aparte |
| 16 | Firma Nostr no se verifica al recibir | **VERDAD** (lo dice el propio comentario del código; mitigado: el contenido va cifrado E2E y el `created_at` ya se acota, SEC-1) | ⏭️ **Diferido** a la pasada de seguridad (con #21/#22): es defensa en profundidad (un evento alterado por un relé igual no descifra) y tocar la recepción por internet tiene riesgo; se hará con pruebas dedicadas |
| 17 | Servidor WebSocket viejo sin autorización de salas | **VERDAD pero NO SE USA** (ninguna referencia en la app) | ✅ **HECHO en 2894**: borrado `server/relay/websocket_server.py` (código muerto; queda en el historial de git) |
| 18 | `targetSdkVersion 34` | **VERDAD** | ⚠️ Solo importa para Google Play; cambiarlo es riesgoso (comportamiento). Recomendado, con pruebas, no ahora |
| 19 | `webauthn_helper.js` truncado / error de sintaxis | **FALSO/DESACTUALIZADO** (`node --check` pasa; el archivo está completo) | ℹ️ Nada |
| 20 | `eslint` no está en dependencias | **VERDAD** (solo `eslint-scope` transitivo) | ℹ️ Mantenimiento menor, opcional |
| 21 | Rollback del Double Ratchet (reuso de clave/IV) | **PENDIENTE DOCUMENTADO (P0 cripto)** | ⏭️ Programa dedicado + posible auditoría cripto independiente |
| 22 | Verificación completa de alta y fijación de claves (H3/H4) | **PENDIENTE DOCUMENTADO** | ⏭️ Con #15 |
| 23 | M5/M6/F6/F7/F8 | **PENDIENTE DOCUMENTADO** (F8 = #11) | ⏭️ Revisar uno a uno |

## Lo que se implementa ahora (seguro, alto valor, con prueba)
- **2892 — Bluetooth no te puede tumbar la app (#1, #2):** criba de JSON (SafeJson) + `catch(Throwable)` antes de parsear, y tope de bytes del reensamblado de texto.
- **2893 — Integridad en disco (#5, #11):** guardado atómico que nunca pierde el original; import de cuenta con topes de memoria. Ambos probados en JVM (tests/kotlin).
- **2894 — Durabilidad del Vault (#6, #7, #8, #9):** no perder adjuntos durante la migración, no pisar contactos tras un error de carga, volcar todo antes de migrar y no migrar si el volcado falla. Probado en tests/sim + batería.
- **2895 — Autenticidad de internet (#16):** verificar la firma del evento al recibir (defensa en profundidad). tests/sim + batería.
- **Limpieza (#17):** quitar el servidor Python viejo que no se usa.

## Decisiones del dueño / riesgo alto (NO se tocan sin tu visto bueno)
- **#4 (clave del Keystore):** hoy, si el Keystore falla un momento, un archivo NUEVO se guarda en claro (está puesto así a propósito, con prueba). Alternativa: no guardar y reintentar (no pierde, no deja claro) — pero es más complejo. **¿Qué preferís?**
- **#10 (traer cuenta):** si traés una cuenta a un teléfono que YA TENÍA datos y el import falla a mitad, se pierde lo que había (el diseño asume teléfono nuevo/vacío). Guardia barata: avisar/confirmar fuerte si el teléfono no está vacío. Arreglo completo: importar a un lado y cambiar solo al terminar (transaccional) — es la corrección más grande y toca la orquestación nativa; recomiendo hacerla en su propio bloque con pruebas.

## Difiéridos con plan
- **#14 FCM:** autenticar el `/wake` tras desplegarlo (App Check o capacidad por destinatario + límite persistente).
- **#13 mapa ID→MAC:** cifrarlo en reposo (pasar las lecturas/escrituras nativas por AtRestStore + migración).
- **#15/#22 alta de contacto:** exigir prueba de posesión de clave + confirmación explícita antes de fijar identidad.
- **#21 Ratchet rollback (P0):** contador monotónico + protección anti-rollback + invalidar sesión al traspasar cuenta; merece auditoría cripto aparte.
- **#18 targetSdk 36:** solo si se publica en Google Play; probar BLE/servicios/cámara/llamadas antes.
- **#23 M5/M6/F6/F7:** recuperar sus descripciones y revisar una a una.

## Pruebas destructivas (D01–D20 de la auditoría)
Las que ya cubre la batería/JVM se conservan (`chunkdos`, `ackforge`, `groupforge`, `spoof`, `resume`, `move`, `ratchet`,
`fcmwake`, `xss`, `SafeJsonTest`, `ParserFuzzTest`, `WriteRetryTest`). Las nuevas de este bloque se añaden con su arreglo
(p. ej. import OOM, reemplazo atómico, adjunto en migración). El resto (D16 ratchet, D13 FCM) van con sus bloques diferidos.
