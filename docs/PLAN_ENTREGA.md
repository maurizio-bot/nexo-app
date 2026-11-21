# Plan de entrega (organizado el 21-11, para arrancar el domingo 22-11 tras el reinicio semanal)

Objetivo del dueño: (1) una app de uso diario, útil y robusta; (2) que sea rentable. Antes de publicar en tienda: cerrar fallos funcionales, auditar, decidir el servidor, fijar nombre, identificador de paquete y logo.

Regla de «terminado»: un ítem está terminado cuando (a) tiene prueba en `tests/sim` o JVM que falla antes y pasa después, (b) la batería completa (`ci.js`) y el CI están en verde, (c) si es de Bluetooth o Wi-Fi Direct, el dueño confirma con una prueba real. Sin los tres, no se marca.

## DECISIONES DEL DUEÑO 21-11 noche (MANDAN sobre todo lo de abajo; respuesta a la revisión de Opus)
1. **Primero lo funcional, sólido.** Los «bloqueantes» INCLUYEN todo lo grave de Bluetooth: zombis, app dormida/congelada/cerrada (COLA 22, 23, 29 —los dos casos—, fases 2–4 del servicio), enlaces repetidos y MTU 23 (13, 15, 16, 16b, 16c), reenvío sin fin (28), Wi-Fi sin internet (27), Wi-Fi Direct (1–6, 3261), llamadas (17, 18, 25, 29b), datos repetidos (24) y el 34. Meta del dueño: al terminar la PRIMERA sesión grande, lo funcional al 98–100 %.
2. **Reparto.** La sesión principal, en Fable (el dueño la pone), hace lo pesado: Bluetooth, zombis, servicio nativo, Wi-Fi Direct, protocolo. Los ayudantes (Haiku/Sonnet) hacen diagnósticos y lo menor, incluido lo ESTÉTICO de otros teléfonos: nombre encimado/cortado, letra grande (32), BOTONES PAREJOS (aún no lo son), 35. Grupos G1–G9 y 30/31/33 después de lo funcional.
3. **Revisar lo hecho en Haiku.** Los diagnósticos del 20 y 21-11 se apuntaron en Haiku: re-analizarlos con el modelo grande y revisar los arreglos recientes (3251–3260 y el nombre de la cabecera) para que sean ROBUSTOS y PERMANENTES: que no rompan otra cosa y que esa falla no vuelva (cada una con su prueba en `tests/sim/robustez.json`).
4. **APKs: NO una por ola.** Los usuarios no actualizan seguido y pedirles actualizar una y otra vez es perjudicial. Se arregla TODO lo funcional + estético, luego UNA revisión propia buena (más corta que lo que costaría una APK por ola: ~3 h cada una) y entonces UNA APK.
5. **Auditoría de seguridad:** el dueño duda entre antes+después o solo después (según tokens y tiempo). Recomendación de Claude: UNA sola, después de lo funcional (el servicio nativo cambia la superficie; una auditoría antes quedaría vieja), sobre lo que cambió + la lista abierta del plan maestro (adjuntos por contenido real, relleno en puentes, identidad en la Wi-Fi, «Rechazar» firmado, confirmaciones firmadas).
6. **Fechas.** Prueba cerrada de Google Play a más tardar el **1-12** (el dueño cree que antes: todos los pendientes en días, no más de una semana). El 18-12/EDC queda como límite RELATIVO: sin versión de iOS aún, el plan es lanzar Android lo antes posible (ya con el SERVIDOR DE PAGA) y con eso activo intentar iOS antes de EDC (aunque sea de prueba; hace falta una Mac).
7. **Servidor:** lo antes posible si el precio es razonable y contratarlo es fácil y rápido. Claude prepara opciones con costo y tiempo de puesta en marcha para que el dueño elija.
8. **Ruta crítica que NO es código (para el 1-12):** cuenta de desarrollador de Play (personal o empresa; la verificación de identidad tarda días), nombre en la tienda, 12 probadores, política de privacidad publicada, targetSdk 36 y AAB firmado. Hay que avisarle al dueño desde el arranque.
9. **Pruebas reales del dueño AL FINAL** (21-11 noche): primero se termina todo lo que ya sabemos que hay que hacer; cuando esté estable, el dueño hace las pruebas reales (Bluetooth sin la app 3254, recuperación de cuenta —nunca probada aún—, Bluetooth vs Wi-Fi Direct, videollamada larga) y se cierra con lo que salga. La cuenta de Play la abre el dueño lo antes posible, pero después de dejar listo lo funcional.
10. **Nombre y logo: PENDIENTE, preocupa al dueño.** Todo el detalle y el plan, SOLO en el repositorio privado (`negocio/NOMBRE.md`, sección «Plan 21-11 noche»). Un ayudante lo trabaja en paralelo a lo funcional. Lo único que no se puede cambiar tras la primera subida a Play es el identificador de paquete: decidirlo antes de la prueba cerrada.

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
