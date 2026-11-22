# 📌 ESTADO ACTUAL DE NEXO — LEER ESTO PRIMERO

> **Este archivo es el punto de encuentro entre el Claude de la compu (Claude Code) y el Claude del teléfono.**
> Quien entre —sea quien sea— lo PRIMERO que hace es leer este archivo para saber en qué punto está el proyecto.
> Vive en GitHub (rama `NEXOCHAT`), así que los dos lo pueden leer desde donde estén.

## ⭐ Regla del dueño (prioridad SIEMPRE)
**Funcional y robustez primero.** El error que aparece se resuelve **en el momento**, no se dejan cabos sueltos.
No preguntar «¿qué priorizo?» cuando hay un error o algo roto: se corrige. (Monetización/entretenimiento van después de que lo funcional esté firme.)

## 🔄 Cómo usar este archivo (la regla)
- **Claude de la compu (yo, Claude Code):** actualizo este archivo al terminar cada bloque de trabajo y lo subo a GitHub. Es lo primero que leo al empezar.
- **Claude del teléfono:** leé este archivo primero (pedí «traé la última versión de `ESTADO.md` de GitHub»). Si hacés algo nuevo:
  1. Anotalo en el apartado **«⚠️ Trabajo del teléfono sin subir»** de abajo.
  2. **Si podés escribir en GitHub:** commiteá tu trabajo a una rama (p. ej. `monetizacion-telefono`) y anotá acá el nombre de la rama. Así el de la compu lo trae.
  3. **Si solo podés leer GitHub:** avisale al dueño que el trabajo quedó en el teléfono, para que lo pegue en la compu. (Si no se sube a GitHub, el otro Claude NO lo puede ver.)
- **Dueño (Maurizio):** si trabajaste en el teléfono y quedó algo sin subir, decímelo en la compu y lo integro.

---

## Dónde estamos (actualizado: 2026-11-10)

### TRASPASO (empezar una sesión limpia desde aquí; MÁXIMO ~60 líneas: lo viejo pasa a `docs/historial/`)
- **Forma de trabajo (dueño 20-11; su límite SEMANAL es lo que frena, plan Max, no sube a Ultra):** ver CLAUDE.md «GASTO». Leer SOLO este bloque + la
  lista 🔴 de `docs/AREAS.md`; lo demás, con grep. Una sesión = un tema; una APK por tanda; sin reloj de ausencia.
- **PRINCIPIO (CLAUDE.md):** NEXO = TODOS los caminos; nunca recortar caminos. Wi-Fi Direct: pendiente reproducir «No se pudo crear el grupo» en `tests/sim` y decidir
  con el dueño A (pasar siempre a Wi-Fi Direct con Bluetooth) o B (dejarlo listo y usarlo con tráfico pesado); preferencia de Claude: B.
- **PUBLICADO:** APK 3111 (3251–3253) y **3113 (20-11 22:05 México): 3254 Bluetooth en el servicio FASE 1** (con NEXO vuelta sola —reinicio, actualización, cierre del sistema,
  toque FCM— el servicio anuncia y recibe por Bluetooth sin la app: `SinAppCore.kt` puro con 9 pruebas JVM, `BleSinApp.kt`, `BleService.startSinApp`, relevo en
  `takeOverFromClosed`; NEXO ID y clave rotativa guardados CIFRADOS en `nexo_ble_sinapp.json`) + 3255 (registro del enlace repetido que vuelve).
  **PRUEBA DEL DUEÑO PENDIENTE:** reiniciar un teléfono, desbloquearlo SIN abrir NEXO y desde otro cercano SIN internet mandarle un texto: debe sonar el aviso y salir ✓✓;
  en su diagnóstico: «[BT_SINAPP] Bluetooth sin la app: anunciando y recibiendo». El dueño debe actualizar SU teléfono primero (el filtro de diagnósticos usa su build).
- **PUBLICADO: APK 3116 (20-11 02:54 México) = 3256–3260** (batería/temperatura en llamadas, enlace repetido, medidas de Wi-Fi Direct, tablero por red `docs/REDES.md`, Wi-Fi Direct en archivos grandes). Las 3114 y 3115
  fallaron SOLO por reglas de estilo (textos fijos 26>25; diccionarios 1.001>1.000 líneas): antes de subir correr `tamano.js` e `i18n_audit.js`. Primer CI donde compila lo nativo nuevo (PluginLog.kt, PluginWifiDirect.kt): OK.
  FALTA: llamadas de GRUPO con batería/temperatura, «cronómetro de actividades», prueba corta del dueño Bluetooth vs Wi-Fi Direct (batería de ambos lados) y primer cuello de botella: preparar archivo grande ≈ 5 MB/s.
- **PRUEBA DEL DUEÑO (noche del 20-11):** videollamada S24→S23 de 20–30 min con la 3116 en los DOS; en casa con Wi-Fi, más calor que la mañana (13 °C). Referencia WhatsApp (S24 Ultra, mañana): ≈ 0,31 %/min (19 %/h; él estima 25 %/h);
  su recuerdo de NEXO: 1 % cada ~7 min (0,14 %/min) = entre 1/3 y 1/2 de WhatsApp. El diagnóstico de cada teléfono trae %/h, temperatura máxima y estado térmico: comparar con eso y anotar el ambiente en `docs/AREAS.md`.
- **DISEÑO DEL DUEÑO para elegir Wi-Fi Direct (20-11, pendiente de hacer = 3261):** WD NO tiene preferencia sobre internet; entra cuando hay Bluetooth cercano y el Wi-Fi está encendido. Con internet/Wi-Fi y sin enlace Bluetooth:
  escaneo Bluetooth rápido para ver si el contacto está en el radio; si no → seguir por internet/Wi-Fi; si sí → evaluar la velocidad de internet de ESE momento y, si no alcanza, pasar a Bluetooth y luego Wi-Fi Direct. Hallazgo que lo motiva:
  `ble_startup._resolveDeviceIdForNexoId` ordena lan > internet > Bluetooth y WD solo se mira DESPUÉS de elegir Bluetooth (`ble_blobs.sendFile` → `ackSystem.sendFile` → `wd.eligible`): con el contacto en línea por internet (aunque sea lento) un archivo
  de 100 KB–22 MB nunca prueba WD (foto de 3 MB a las 23:20:46 del 19-11: 25 s por internet a 6,8 KB/s; con WD ≈ 3 s). Plan: `wd.planFor(nx, bytes)` pura (tiempo estimado internet = tamaño / velocidad reciente medida; WD ≈ 4 s + tamaño/5 MB/s; Bluetooth cerca = enlace
  listo o visto hace < 30 s en `foundDevices`), anotar la decisión y los tiempos estimados en el diagnóstico (3258) y prueba en sim. DECIDIDO por el dueño (20-11 noche): con enlace Bluetooth, Wi-Fi Direct arranca SOLO en automático y crea el enlace (grupo) con el otro teléfono; si falla, vuelve a Bluetooth; se omite solo si hay Wi-Fi/internet que sea mejor y más rápido. El gasto de batería no es razón para negarlo. Pendiente: MEDIR el retraso de ese paso (Bluetooth listo → Wi-Fi Direct listo) con la prueba de 3 MB ×3 y el diagnóstico de los dos teléfonos.
- **SIGUIENTE (tras el reinicio semanal del límite; el dueño iba al 96 % el 20-11): la lista COMPLETA y ordenada está en `docs/COLA.md`** (26 puntos en 5 sesiones + sesión «Grupos: administración» G1–G8 pedida el 20-11: Wi-Fi Direct y elección de camino con 3261, medición y tablero,
  Bluetooth pulido, Bluetooth en el servicio + seguridad, después). Regla del dueño: lo que él reporta de pruebas reales es un HECHO. Antes de subir: correr `tamano.js` e `i18n_audit.js`.
- **21-11 (plan y calendario):** leer `docs/CALENDARIO_Y_ORDEN.md` (hitos, dependencias, decisiones del dueño con fecha), `docs/PLAN_ENTREGA.md` (olas, modelos y esfuerzo) y `docs/COLA.md`. Mañana (domingo 22): Ola 0 (ordenar documentos e inventario único) y luego Ola 1. Una subida con APK por ola. Lo de horas: 30 a 40 por semana como mínimo.
- **22-11 (madrugada, sesión Fable + 2 ayudantes Sonnet; SIN APK, todo [skip ci]). LEER ESTO PRIMERO:**
  - **HERRAMIENTA NUEVA: el Kotlin del plugin YA SE COMPILA AQUÍ** (comprobación de tipos, ~40 s): `cd tests/kotlin-android && gradle --no-daemon compileKotlin`
    (android-all de Robolectric + Capacitor de Maven Central + sustitutos de AndroidX/Firebase en `stubs/`; Google Maven no se alcanza). Y las pruebas JVM:
    `cd tests/kotlin && gradle --no-daemon test --tests 'X'`. Si Maven da 429, reintentar. Correr las dos ANTES de subir cualquier cambio nativo.
  - **3262 (subido): causa de raíz del «enlace repetido que vuelve» (COLA 16):** Android NO corta un enlace entrante si la app no lo «tiene»
    (`BluetoothGattServer.connect` sobre el enlace abierto); `cancelConnection` no hacía nada (ni el desempate, ni 3251, ni el freno 3203). Ahora
    `holdServerLink`/`cutServerLink` (plugin y `BleSinApp`), solo para quien usa nuestro servicio. Reproducido en sim: `dupserver.js --sin-tomar` FALLA.
    También: `HalfOpenPolicy` (escribe sin estar suscrito → se corta), COLA 15 (201: sin DEFAULT; enlace sin una escritura en ~12 s se cierra, `closeStuckLink`),
    desempate del MISMO papel = el más reciente (`openedAt`; `since` nunca se ponía), 16c (todos muertos → se cierran todos).
  - **3263 = FASE 2 del Bluetooth en el servicio (`GattServerHost.kt`): el servidor GATT es UNO por proceso y NO se cierra al abrir/cerrar la app**; plugin,
    app cerrada y `BleSinApp` solo se enganchan (attach/detach) y heredan enlaces, suscripciones y MTU. Sim: `gattsigue.js` (A no pierde el enlace; contraprueba `--k3262`).
    Un enlace heredado sin identificar recibe «quién eres» con insistencia (`_askWhoIs`, ble_keys.js) y al contestar se trata como recién listo
    (peerReady, sesión, pendientes): sin eso `fotorenueva.js` fallaba. `vivoarriba.js` acepta que la ✓✓ que faltaba llegue sola por el enlace que sigue.
    ESTADO: SUBIDO. **Batería completa (346) corrida aquí con el simulador en modo fase 2 (22-11 ~04:40): todo OK salvo 2 que fallan en ESTE entorno
    también con el código de antes de hoy** (`fotocalidad.js`: el tramo de internet nunca queda listo; `estadovideo.js`: `VB_todos`; comprobado con
    `builds/HEAD~2` + `NEXO_SIM_K3262=1`): no son de los cambios de hoy; las juzga el CI de GitHub al sacar la APK. Los 2 fallos reales que sacó la batería
    (`fotorenueva`, `vivoarriba`) están arreglados (3265). Para comparar con el Kotlin de antes: `NEXO_SIM_K3262=1 node X.js builds/wip`.
  - **3264 (subido; de los diagnósticos del 22-11 03:13):** conectar a un teléfono fuera de la lista de vistos fallaba SIEMPRE («MAC invalida»: Android exige la
    dirección en mayúsculas, `PluginGatt`); la lista de vistos ya no se borra al parar/empezar un escaneo y la reconexión nativa pide la dirección a Android
    en vez de rendirse («No hay device cacheado»); el registro dice qué contestó el relé que no reabre (`failWhy`, JVM); texto de `BT_SINAPP` con Bluetooth apagado.
  - **16b (subido):** ✓✓ nativas «sin firma válida» con contacto recién agregado → `_pushAckKeysIfChanged` en cada repaso (`background.js --scenario=frozen-new`).
  - **34 (subido, de raíz):** la lista de DENTRO (`#main-contacts-list`) era la que se desplazaba; tope 10 s. **28: NO era un fallo** (ya lo cubren 3016/3058; el
    síntoma `reenvio_sin_fin` salta a la 3.ª vuelta por diseño; el arreglo de Sonnet se retiró porque podía retrasar hasta 5 min tras reconectar). La causa real era 16b + app congelada.
  - **Ayudantes (subido):** COLA 35 («→ ?» del diagnóstico), 29b (mini de videollamada sin botones al volver; el «se bloquea o cae» NO se reprodujo: pedir diagnóstico),
    COLA 32 (letra grande/anchos: `letragrande.js`, 13 → 2 hallazgos; queda el nombre del chat a 320 px + letra 160 %, hay que tocar `_fitContactName` en `main.js`).
  - **TODO LO NATIVO DE HOY NECESITA PRUEBA REAL DEL DUEÑO** (al final, como él pidió): 3262 (enlaces repetidos entre S24↔Austin/Roberto: que no «vuelvan»), 3263
    (abrir NEXO con un contacto cerca: el otro no debe ver «desconectado»), 15, 16b.
  - **SIGUIENTE (en orden):** (1) confirmar/subir 3263; (2) **COLA 27 con `ConnectivityManager.reportNetworkConnectivity(red, false)`** cuando ningún relé conecta por
    Wi-Fi (le dice a Android que revalide y pase a datos; NO usar bindProcessToNetwork: rompe el Wi-Fi local); (3) COLA 36 (JS, Jump cierra y 7 ms después escribe);
    (4) FASE 3 (bandeja de salida y conexiones salientes en el servicio = COLA 29) y FASE 4 (a demanda); (5) 17/18 (llamadas), 22 (avisar del teléfono que mata NEXO);
    (6) re-analizar con modelo grande los diagnósticos del 20 y 21-11 apuntados en Haiku; (7) estético: botones parejos, 30/33. Auditoría de seguridad AL FINAL (una).
- **⚠ ARRANQUE 22-11 (dueño 21-11 noche, MANDA):** leer «DECISIONES DEL DUEÑO 21-11 noche» al inicio de `docs/PLAN_ENTREGA.md`. Resumen: PRIMERO LO FUNCIONAL (Bluetooth, zombis, servicio nativo, Wi-Fi Direct, llamadas) en la sesión principal con Fable; ayudantes con diagnósticos y lo estético (nombre encimado, letra grande, botones parejos); re-revisar con modelo grande lo apuntado/arreglado en Haiku; UNA APK al final tras una revisión propia; auditoría al final; prueba cerrada de Play ≤ 1-12; servidor de paga lo antes posible; iOS después.
- **Logo: DIRECCIÓN ELEGIDA por el dueño (21-11 noche)** y nombre favorito: detalle y bocetos SOLO en el privado (`negocio/NOMBRE.md`, `negocio/logo_bocetos/`).
- **Pruebas reales al final; nombre y logo con ayudante en paralelo** (puntos 9 y 10 de las DECISIONES 21-11 noche; detalle de nombre SOLO en el privado).
- **21-11 tarde (sin APK; todo con [skip ci]):** COLA 30–35 nuevas (fondos con pulsación larga en todas las pantallas; vista previa/logo real en enlaces —DECISIÓN A/B del dueño pendiente—; pantallas con letra grande; Apariencia; deslizar-para-actualizar que salta al desplazar contactos; «→ ?» en el diagnóstico). HECHO sin APK: nombre de la cabecera cortado con letra grande (`_fitContactName`, prueba local `tests/sim/nombrecabecera.js`, NOVEDADES escrita). Ya repartido en `docs/PLAN_ENTREGA.md` (34 en Ola 1; 30/32/33/35 en Ola 3 agente C; 29 en Ola 5). Para correr pruebas con navegador aquí: `tests/sim/build.sh wip`, `npm install` en `tests/sim` y quitar su `node_modules/playwright*` (usa el Chromium preinstalado).
- **Diagnósticos:** solo los de la última build (3116); se apuntan en `docs/diagnosticos.json` (`node tests/sim/diag_stats.js`). Abiertos de la app: mensaje atorado durante una
  videollamada (S23→S24 21:28), datos repetidos al abrir en frío, enlace repetido; costumbres del teléfono: quitar NEXO de recientes corta la recepción (Cari), Honor/Vivo congelan la app.
- **Nombres:** dueño = S24 (nx1n36c283) · Cari = S23 Ultra (nx1e50c95d) · Roberto = Motorola (nx0g6ef54e) · Austin = Honor (nx1905c1ee) · Marcos (nx01992876) · Zhelowsky (nx0x4029e6) ·
  Yael = Redmi (nx16386482) · Katy = Honor (nx126df3f4) · Vivo Y03 (nx09acdb61) · tablet A7 Lite (nx1e29ab2f).
- **Reglas vivas:** español, breve, horas de México; reproducir en `tests/sim` antes de arreglar; NOVEDADES solo en español; el Kotlin no se compila aquí (lo compila el CI, ~85 min):
  juntar cambios en UNA subida; decisiones al dueño en forma A/B con lo que vive el usuario.
- Historial anterior: `docs/historial/ESTADO_hasta_2026-11-19.md`.

## ✅ Trabajo del teléfono — YA INTEGRADO
> Acá se anota lo que se hizo en el teléfono y se trajo al repo.

- **[✅ 04-11] Monetización + entretenimiento** — el dueño avanzó el plan en el teléfono; se integró a `nexo-private/negocio/MONETIZACION_Y_ENTRETENIMIENTO.md`. Tiene las fuentes de ingreso (Fundador 199 MXN, Negocios, etc.), el modo entretenimiento para el **15-nov** (sala de juegos: Conecta 4 + piedra-papel-tijera) y una **checklist de decisiones del dueño**.

---

## Documentos de referencia (el detalle largo)
- `docs/PROGRESO.md` — historial completo de builds.
- `docs/PENDIENTES.md` — todo lo que falta + reglas del dueño.
- `docs/ROBUSTEZ.md` — índice de robustez, mediciones y rutina diaria.
- `nexo-private/seguridad/AUDITORIA_COMPLETA_03-11.md` — última auditoría completa.
- `CLAUDE.md` — instrucciones del proyecto.
