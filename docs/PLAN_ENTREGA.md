# Plan de entrega (organizado el 21-11, para arrancar el domingo 22-11 tras el reinicio semanal)

Objetivo del dueño: (1) una app de uso diario, útil y robusta; (2) que sea rentable. Antes de publicar en tienda: cerrar fallos funcionales, auditar, decidir el servidor, fijar nombre, identificador de paquete y logo.

Regla de «terminado»: un ítem está terminado cuando (a) tiene prueba en `tests/sim` o JVM que falla antes y pasa después, (b) la batería completa (`ci.js`) y el CI están en verde, (c) si es de Bluetooth o Wi-Fi Direct, el dueño confirma con una prueba real. Sin los tres, no se marca.

> **REVISIÓN 21-11 noche (Opus, sobre lo armado en Haiku): 3 choques con decisiones ANTERIORES del dueño, a confirmar por él antes de arrancar:**
> 1. **Orden.** CLAUDE.md y `nexo-private/negocio/PLAN_DE_BATALLA.md` (19-11): auditoría de seguridad (22–23) → Bluetooth en el servicio (23-11 a 6-12) → tienda (7–17-12). Este plan lo deja en olas 4–5 (mediados de diciembre / enero). Propuesta: A) volver al orden del 19-11, con los bloqueantes cortos de la ola 1 y la interfaz en PARALELO por ayudantes en archivos distintos.
> 2. **Fecha de la prueba cerrada.** PLAN_DE_BATALLA: fecha límite DURA 18-12 (12 personas × 14 días; Google pide 12, no 20). El calendario de abajo la pone ~15-01, lo que deja poco margen para EDC (febrero). Propuesta: A) mantener el 18-12.
> 3. **Builds.** Acuerdo 21-11: un solo build para las olas 1–3; pero la ola 1 dice «una sola subida» y las pruebas reales del dueño (Bluetooth/Wi-Fi Direct) piden APK antes. Propuesta: A) una APK por ola/fase.
> Además corregido: la ola 0 NO lee PENDIENTES/ROBUSTEZ enteros (440 KB ≈ media ventana): un ayudante barato con grep arma `docs/INVENTARIO.md`; COLA 24 y 25 (🔴 4 y 7 de AREAS) no estaban en ninguna ola; 29b no estaba en la COLA; el servidor (ola 6) no está en el plan de batalla y choca con el congelado de funciones del 18-12: confirmar con el dueño si va antes o después de la prueba cerrada.

## Reglas de trabajo (para gastar pocos tokens y no perder robustez)
- Un solo subidón a NEXOCHAT por ola: cada push con APK tarda ~85 min de CI. Se junta todo lo de la ola y se sube una vez. Antes de subir: `tamano.js` e `i18n_audit.js`.
- Ayudantes solo en archivos que no se cruzan. Dos agentes nunca tocan el mismo archivo a la vez (en particular `ble_connections.js`, `ble_helpers.js` y el nativo `plugins/nexo-ble`).
- Cada ayudante recibe un brief corto: ítem, archivos, prueba que debe escribir, criterio de terminado. Nada de releer docs enteros: usar `grep`.
- Modelo por tipo de trabajo (CLAUDE.md, «GASTO»): modelo grande (Opus/Fable) para Kotlin nativo, protocolo, cifrado, auditoría de seguridad y diseño de servidor. Sonnet para JS de interfaz, pruebas de simulador y documentos técnicos. Haiku para listas, registro de diagnósticos, NOVEDADES y textos de la tienda.
- Lo grande va justo después del reinicio: domingo y lunes primero.

## Ola 1 — Bloqueantes (domingo y lunes; modelo grande en lo nativo)
Son los fallos que rompen confianza en el primer uso.
- 16 / 16c: desempate del enlace repetido: todos muertos → cerrar todos y abrir uno limpio; MTU ≤ 23 nunca gana; dos del mismo papel (`bledup.js`). [m]
- 15: escrituras «ocupado» (201) sostenidas ≥ 20 s → esperar callback y, si no llega, cerrar y reabrir. [m]
- 16b: ✓✓ nativas sin firma válida tras agregar un contacto (`ackSign` / NetBgHome). [m]
- 28: reenvío sin fin → tope de vueltas y espera creciente por mensaje. [m]
- 27: Wi-Fi sin internet → pedir red móvil (requestNetwork cellular) cuando ningún relé conecta; revisar la `IllegalStateException` al reabrir relés en NetBg. [m]
- 17 / 18: mensaje atorado y decodificación de vídeo tras cambio de red (hueco de ~25 s). [m]
- 29b (nuevo, a reproducir; NO es la COLA 29): la pantalla de llamada en ventanita (132×236) se queda sin botones y puede caer; el dueño lo reportó como micropantalla que se bloquea o cae. Reproducir con `callpower.js` y las trazas `[CALL] Pantalla de llamada`. [m]
- 34 (21-11): «deslizar para actualizar» salta al desplazar la lista de contactos y cada vez reenvía TODOS los pendientes (10 veces en 26 s en el diagnóstico del S24): martilla enlaces. [c]
- YA HECHO, sin APK aún (21-11, commit e3d5f8c): nombre de la cabecera cortado con letra grande (Redmi Note 11 Pro 5G); NOVEDADES ya escrita. Sale con la APK de esta ola.
Salida de la ola: una sola subida y las pruebas del dueño de la noche del 20-11 repetidas (videollamada 20 min en los dos).

## Ola 2 — Medición y Wi-Fi Direct (Sonnet para JS; modelo grande si toca nativo)
- 1: elegir Wi-Fi Direct por tiempo estimado (3261), como lo decidió el dueño: con enlace Bluetooth arranca solo, y si falla vuelve a Bluetooth. [m]
- 3, 4, 5: textos de Wi-Fi Direct y «No se pudo crear el grupo» en `tests/sim`; correr `wifidirect.js --broken=fail` sin límite de tiempo. [c]
- 2: preparar archivo grande (≈ 5 MB/s, el primer cuello de botella). [m]
- 24: datos repetidos de los relés (55 %) y batería en segundo plano (🔴 4 de AREAS). [m]
- 7–12: tablero por red: llamadas de grupo, medianas y p90, capacidad, fallos por camino, tendencia por hora y build. [c/m]
- 6 (solo si el dueño elige «grupo siempre montado»): grupo caliente nativo. [g]
- Prueba del dueño: mismo archivo por Bluetooth y por Wi-Fi Direct con batería de los dos (pendiente).

## Ola 3 — Bluetooth pulido y grupos (en paralelo, archivos distintos)
- Bluetooth: 13 (MTU 23), 14 (L2CAP para archivos medianos). [m]. Agente A, archivos de BT.
- Grupos G1–G9 (interfaz y estado del grupo). Agente B, archivos `groups*.js`, `gruposadmin.js`. Empieza con G2 (modelo y estado versionado), luego G3–G5, G6–G7, G1 y G9 al final.
- Pruebas G8 en el simulador.
- Interfaz y apariencia (añadido 21-11, agente C, archivos de UI/CSS): 32 (todas las pantallas con letra grande y teléfonos chicos; esperar la captura del probador), 30 (cambiar TODOS los fondos con pulsación larga; grupos con G7), 33 (Ajustes → Apariencia: burbujas 1 o 2 colores, pleno/cristal, tipo de letra), 35 (destinatario «?» en el diagnóstico). [c/m]
- 25: llamadas: eco en grupo, gasto de datos por relés, sin imagen propia al contestar desde el aviso (🔴 7 de AREAS). [m]
- 31 (vista previa y logo real en enlaces): ESPERA decisión del dueño A (la baja quien manda, como Signal; recomendada) o B (la baja quien recibe). [m]

## Ola 4 — Auditoría de seguridad (antes del servidor, en el repo privado)
- 19: auditoría completa (`nexo-private`). Un agente del modelo grande, sin tocar el código público hasta que haya lista de hallazgos.
- Salida: lista de hallazgos con gravedad y ítem de corrección por cada uno. Lo crítico entra antes de publicar.

## Ola 5 — Bluetooth en el servicio nativo (decisión del dueño: va después de la auditoría)
- Incluye COLA 29 (bandeja de salida en el servicio): resolver app CERRADA y app CONGELADA viva (dueño 21-11: los dos).
- 20–23: servidor GATT siempre en el servicio, reenvío desde el servicio, conexiones a demanda (tope ~7), entrega con la app cerrada y la pantalla apagada, modo vagón. Modelo grande, por fases, cada fase con su prueba y su prueba real del dueño.
- 22: detección de «Foreground kill» y de ahorro de batería, con aviso al usuario.

## Ola 6 — Servidor (decidir antes de programar)
- Primero un documento de decisión (Sonnet): qué ve el servidor (solo metadatos mínimos o nada), qué hace (relevo para entrega con la app cerrada, administración de grupos, respaldo, panel B2B). Sin esto no se programa.
- Luego implementación por fases, con la auditoría de la ola 4 aplicada al diseño.
- Pendiente del dueño: quién paga y por qué (define qué necesita el servidor).

## Ola 7 — Publicación (en paralelo con la ola 6, las decisiones son del dueño)
- Decidir nombre, identificador de paquete y llave de firma ANTES de la primera subida. Revisar marca en IMPI y búsqueda en Play y Galaxy Store. Decidir logo con prueba a 48 px.
- Política de privacidad pública, textos en español, capturas, clasificación de contenido, permisos justificados (Bluetooth, ubicación).
- 26: targetSdk, firma, prueba cerrada de 14 días en Play (con 12 probadores si la cuenta es personal y nueva; PLAN_DE_BATALLA: empezar a más tardar el 18-12), y prueba beta en Galaxy Store.
- Decisión del dueño: publicación pública o pista de prueba con contactos y gente que reporte fallos. Recomendación: pista de prueba primero (ver la opinión del 21-11).

## Decisiones que solo toma el dueño (lista corta)
1. Wi-Fi Direct: ya decidido (automático al enlazar Bluetooth con vuelta a Bluetooth si falla); confirmar si quiere grupo caliente.
2. Grupo: los supuestos que anotó Claude en 4b (expulsado puede volver si alguien lo agrega; bloqueo en el estado del grupo) — confirmar.
3. Servidor: qué puede ver y para qué (ola 6).
4. Nombre, logo, paquete y modelo de ingreso (ola 7).
5. Pista de prueba o publicación pública.

## Estado al cierre de este documento
Ola 1 pendiente (empieza el domingo 22-11). Nada de esto está hecho en código: es el plan y el orden.

## Tiempos aproximados (horas de trabajo activo, no de espera; rango honesto)
- Ola 1 (bloqueantes, 7 ítems [m]): ~15 h en serie; 6–8 h con 2–3 ayudantes en archivos separados. CI: 85 min. Prueba tuya: 1 sesión corta.
- Ola 2 (Wi-Fi Direct y tablero): ~12–14 h en serie; ~1,5 días con ayudantes. Si eliges «grupo caliente» (ítem 6): +1 día.
- Ola 3 (Bluetooth pulido y grupos G1–G9): BT ~5 h; grupos ~20 h; con dos ayudantes ~1,5 días.
- Ola 4 (auditoría de seguridad): 1–2 días.
- Ola 5 (Bluetooth en el servicio, fases 2–4): 1–2 semanas, con pruebas reales en cada fase.
- Ola 6 (servidor): diseño 1–2 días; implementación 1–3 semanas, según el alcance que elijas.
- Ola 7 (tienda): 2–4 días de trabajo; la prueba cerrada de 14 días es tiempo de calendario, no de trabajo.
Estas cifras son mi mejor estimación y pueden variar; las corrijo con lo que tarde cada ola.

## Un solo build para la robustez
Olas 1–3 (todos los arreglos, sin servidor y sin el servicio nativo nuevo) van en un solo build, después de que `ci.js` completo y JVM estén en verde en el simulador. Las olas 4–6 (auditoría, servicio nativo, servidor) van en builds aparte, porque cambian más código.

## Modelo y esfuerzo por tarea (Fable con criterio)
Cada tarea lleva su nivel [c], [m] o [g] en `docs/COLA.md`, y eso decide el modelo y el esfuerzo del ayudante:
- Trivial ([c]: textos, registros, constantes, documentos): Haiku o Sonnet, esfuerzo bajo. No se usa Fable.
- Medio ([m] de JS, pruebas en el simulador, interfaz de grupos): Sonnet, esfuerzo medio. Fable solo si el ítem se atora dos veces.
- Difícil ([m] de nativo, protocolo, desempate Bluetooth, reenvío, crash de llamada): Fable con esfuerzo alto.
- Muy difícil ([g]: auditoría de seguridad, diseño del servidor, servicio nativo): Fable con esfuerzo máximo, solo en esas tareas.
Regla de control: el coordinador (Claude) asigna el nivel antes de lanzar cada ayudante, y el ayudante devuelve un informe corto. Si un ayudante de nivel bajo se atora, sube un nivel en vez de dar vueltas.
